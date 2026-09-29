import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, chown, link, lstat, mkdir, open, readFile, realpath, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { WebSocketServer, type WebSocket } from 'ws';
import { issueModelTaskToken } from './file-worker-auth.js';

interface WorkerSettings {
  secret: string;
  root: string;
  skillsDir: string;
  modelProxyUrl: string;
  codexBin: string;
  port: number;
  maxBytes: number;
}

interface TaskPaths {
  root: string;
  input: string;
  output: string;
  tmp: string;
  home: string;
  workspace: string;
  uid: number;
}

const settings: WorkerSettings = {
  secret: required('FILE_WORKER_SECRET'),
  root: resolve(process.env.FILE_WORKER_ROOT ?? '/work/tasks'),
  skillsDir: resolve(process.env.FILE_SKILLS_DIR ?? '/opt/file-skills'),
  modelProxyUrl: required('WORKER_MODEL_PROXY_URL'),
  codexBin: process.env.CODEX_BIN ?? 'codex',
  port: Number(process.env.FILE_WORKER_PORT ?? 8081),
  maxBytes: Number(process.env.MEDIA_MAX_BYTES ?? 50 * 1024 * 1024)
};

const active = new Map<string, ChildProcessWithoutNullStreams>();
const owners = join(settings.root, '.owners');
const wsServer = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
const execFileAsync = promisify(execFile);

const server = createServer(async (request, response) => {
  try {
    if (request.url === '/healthz') return json(response, 200, { ready: true });
    if (!authorized(request)) return json(response, 401, { error: 'unauthorized' });
    const url = new URL(request.url ?? '/', 'http://worker');
    const segments = url.pathname.split('/').filter(Boolean);
    if (request.method === 'GET' && segments.length === 1 && segments[0] === 'tasks') {
      const ids = (await readdir(settings.root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && validId(entry.name)).map((entry) => entry.name);
      return json(response, 200, { taskIds: ids });
    }
    if (segments[0] !== 'tasks' || !validId(segments[1])) return json(response, 404, { error: 'not_found' });
    const taskId = segments[1]!;
    if (request.method === 'POST' && segments.length === 2) {
      const task = await ensureTask(taskId);
      return json(response, 200, { cwd: task.workspace, inputDir: task.input, outputDir: task.output });
    }
    if (request.method === 'PUT' && segments[2] === 'inputs' && /^[a-f0-9]{64}$/.test(segments[3] ?? '') && segments.length === 4) {
      const task = await ensureTask(taskId);
      const name = safeName(url.searchParams.get('name') ?? 'attachment');
      const path = join(task.input, `${segments[3]}-${name}`);
      const { size, sha256 } = await saveInput(request, path, task.uid);
      return json(response, 200, { path, size, sha256 });
    }
    if (request.method === 'POST' && segments[2] === 'outputs' && segments[3] === 'inspect') {
      const task = await loadTask(taskId);
      const body = JSON.parse(await readBody(request, 4096)) as { path?: unknown };
      const file = await checkedOutput(task, body.path);
      const digest = createHash('sha256');
      const handle = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if ((await handle.stat()).size !== file.size) throw new Error('OUTPUT_CHANGED');
        for await (const chunk of handle.createReadStream()) digest.update(chunk as Buffer);
      } finally { await handle.close().catch(() => undefined); }
      return json(response, 200, { name: basename(file.path), path: file.path, size: file.size, sha256: digest.digest('hex') });
    }
    if (request.method === 'POST' && segments[2] === 'inputs' && segments[3] === 'inspect') {
      const task = await loadTask(taskId);
      const body = JSON.parse(await readBody(request, 16000)) as { name?: unknown; excerpt?: unknown; pages?: unknown };
      const file = await checkedInput(task, body.name);
      if (typeof body.excerpt !== 'string' || !body.excerpt.trim() || body.excerpt.length > 12000) throw new Error('EXCERPT_INVALID');
      if (body.pages !== undefined && (!Array.isArray(body.pages) || body.pages.length > 20 || body.pages.some((page) => !Number.isInteger(page) || page < 1))) throw new Error('PAGES_INVALID');
      const { stdout } = await execFileAsync('/opt/venv/bin/python', [join(settings.skillsDir, 'verify_input.py'), file.path, body.excerpt, JSON.stringify(body.pages ?? [])],
        { uid: task.uid, gid: task.uid, timeout: 90_000, maxBuffer: 256 * 1024 });
      const verification = JSON.parse(stdout) as { verified: boolean; pageCount?: number };
      if (verification.verified !== true) throw new Error('EXCERPT_NOT_FOUND');
      const digest = createHash('sha256');
      const handle = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { for await (const chunk of handle.createReadStream()) digest.update(chunk as Buffer); }
      finally { await handle.close().catch(() => undefined); }
      return json(response, 200, { name: basename(file.path), size: file.size, sha256: digest.digest('hex'), pageCount: verification.pageCount });
    }
    if (request.method === 'PUT' && segments[2] === 'evidence' && /^[A-Za-z0-9._-]{1,120}\.json$/.test(segments[3] ?? '') && !segments[3]!.startsWith('.') && segments.length === 4) {
      const task = await loadTask(taskId);
      const body = await readBody(request, 4 * 1024 * 1024);
      const directory = await ensureOwnedDirectory(join(task.root, 'evidence'), task.uid);
      const path = join(directory, segments[3]!);
      if (await lstat(path).then((info) => info.isSymbolicLink(), () => false)) throw new Error('EVIDENCE_SYMLINK');
      await writeFile(path, body, { mode: 0o600 });
      if (process.getuid?.() === 0) await chown(path, task.uid, task.uid);
      return json(response, 200, { path: `evidence/${segments[3]}` });
    }
    if (request.method === 'POST' && segments[2] === 'python' && segments.length === 3) {
      const task = await loadTask(taskId);
      const body = JSON.parse(await readBody(request, 64 * 1024)) as { code?: unknown };
      if (typeof body.code !== 'string' || !body.code.trim() || body.code.length > 20_000) throw new Error('ANALYSIS_CODE_INVALID');
      return json(response, 200, await runPython(task, body.code));
    }
    if (request.method === 'GET' && segments[2] === 'outputs' && segments.length === 4) {
      const task = await loadTask(taskId);
      const file = await checkedOutput(task, decodeURIComponent(segments[3]!));
      const handle = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      if ((await handle.stat()).size !== file.size) { await handle.close(); throw new Error('OUTPUT_CHANGED'); }
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': file.size, 'cache-control': 'no-store' });
      handle.createReadStream().pipe(response);
      return;
    }
    if (request.method === 'DELETE' && segments.length === 2) {
      if (active.has(taskId)) return json(response, 409, { error: 'active_task' });
      await rm(join(settings.root, taskId), { recursive: true, force: true });
      await rm(join(owners, `${taskId}.json`), { force: true });
      return json(response, 200, { removed: true });
    }
    return json(response, 404, { error: 'not_found' });
  } catch (error) {
    return json(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.on('upgrade', async (request, socket, head) => {
  const segments = new URL(request.url ?? '/', 'http://worker').pathname.split('/').filter(Boolean);
  if (!authorized(request) || segments[0] !== 'tasks' || !validId(segments[1]) || segments[2] !== 'rpc' || segments.length !== 3) {
    socket.destroy();
    return;
  }
  const taskId = segments[1]!;
  try {
    const task = await loadTask(taskId);
    if (active.has(taskId)) throw new Error('TASK_ALREADY_ACTIVE');
    wsServer.handleUpgrade(request, socket, head, (ws) => attachRpc(ws, taskId, task));
  } catch {
    socket.destroy();
  }
});

await mkdir(settings.root, { recursive: true, mode: 0o700 });
await chmod(settings.root, 0o711);
await mkdir(owners, { recursive: true, mode: 0o700 });
await chmod(owners, 0o700);
server.listen(settings.port, '0.0.0.0');

function attachRpc(ws: WebSocket, taskId: string, task: TaskPaths): void {
  const args = [
    'app-server', '-c', 'features.shell_tool=true', '-c', 'features.standalone_web_search=true', '-c', 'web_search="live"',
    '-c', 'model_provider="enterprise_proxy"',
    '-c', 'model_providers.enterprise_proxy.name="Enterprise Proxy"',
    '-c', `model_providers.enterprise_proxy.base_url=${JSON.stringify(settings.modelProxyUrl)}`,
    '-c', 'model_providers.enterprise_proxy.env_key="OPENAI_API_KEY"',
    '-c', 'model_providers.enterprise_proxy.wire_api="responses"',
    '-c', 'model_providers.enterprise_proxy.supports_standalone_web_search=true',
    '-c', 'model_providers.enterprise_proxy.supports_websockets=false'
  ];
  const child = spawn(settings.codexBin, args, {
    cwd: task.root,
    uid: task.uid,
    gid: task.uid,
    env: {
      PATH: process.env.PATH,
      HOME: task.home,
      CODEX_HOME: join(task.home, '.codex'),
      TMPDIR: task.tmp,
      OPENAI_API_KEY: issueModelTaskToken(settings.secret, taskId),
      PYTHONUNBUFFERED: '1'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  active.set(taskId, child);
  let pending = '';
  child.stdout.on('data', (chunk: Buffer) => {
    pending += chunk.toString('utf8');
    for (let end = pending.indexOf('\n'); end !== -1; end = pending.indexOf('\n')) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      if (ws.readyState === ws.OPEN) ws.send(line);
    }
  });
  child.stderr.on('data', (chunk: Buffer) => console.error(`[file-worker ${taskId}] ${String(chunk).slice(0, 1000)}`));
  child.on('error', (error) => {
    console.error(`[file-worker ${taskId}] child process error: ${error.message}`);
    active.delete(taskId);
    if (ws.readyState === ws.OPEN) ws.close(1011, 'app-server error');
  });
  ws.on('message', (data) => {
    if (!child.stdin.destroyed) child.stdin.write(String(data) + '\n');
  });
  ws.on('close', () => {
    if (child.exitCode === null) {
      try { child.kill('SIGTERM'); } catch (error) { console.error(`[file-worker ${taskId}] failed to stop child`, error); }
    }
  });
  child.on('exit', () => {
    active.delete(taskId);
    if (ws.readyState === ws.OPEN) ws.close(1011, 'app-server exited');
  });
}

async function ensureTask(taskId: string): Promise<TaskPaths> {
  try { return await loadTask(taskId); } catch (error) {
    if (!(error instanceof Error) || !/ENOENT/.test(error.message)) throw error;
  }
  const root = join(settings.root, taskId);
  await mkdir(root, { recursive: false, mode: 0o700 });
  const occupied = new Set<number>();
  for (const entry of await readdir(settings.root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !validId(entry.name)) continue;
    try { occupied.add((await loadTask(entry.name)).uid); } catch { /* incomplete task is handled by operations */ }
  }
  let uid: number;
  do { uid = randomInt(200_000, 2_000_000_000); } while (occupied.has(uid));
  const task = paths(root, uid);
  const directories = [task.input, task.output, task.tmp, task.home, task.workspace, join(task.home, '.codex'), join(root, 'evidence')];
  for (const path of directories) {
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
  if (process.getuid?.() === 0) for (const path of directories.reverse()) await chown(path, uid, uid);
  await writeFile(join(owners, `${taskId}.json`), JSON.stringify({ uid }), { flag: 'wx', mode: 0o600 });
  if (process.getuid?.() === 0) await chown(root, uid, uid);
  return task;
}

async function loadTask(taskId: string): Promise<TaskPaths> {
  const root = join(settings.root, taskId);
  const metadata = JSON.parse(await readFile(join(owners, `${taskId}.json`), 'utf8')) as { uid: number };
  if (!Number.isInteger(metadata.uid) || metadata.uid < 200_000) throw new Error('TASK_OWNER_INVALID');
  return paths(root, metadata.uid);
}

async function ensureOwnedDirectory(path: string, uid: number): Promise<string> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if ((await lstat(path)).isSymbolicLink()) throw new Error('DIRECTORY_SYMLINK');
  if (process.getuid?.() === 0) await chown(path, uid, uid);
  return path;
}

/** Runs analysis code as the task's own uid inside its directory; no network on this service's network. */
async function runPython(task: TaskPaths, code: string): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  const script = join(task.tmp, `analysis-${randomUUID()}.py`);
  await writeFile(script, code, { flag: 'wx', mode: 0o600 });
  if (process.getuid?.() === 0) await chown(script, task.uid, task.uid);
  const clip = (value: unknown, limit: number) => String(value ?? '').slice(0, limit);
  try {
    const { stdout, stderr } = await execFileAsync('/opt/venv/bin/python', [script], {
      cwd: task.root, uid: task.uid, gid: task.uid, timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
      env: { PATH: process.env.PATH, HOME: task.home, TMPDIR: task.tmp, MPLBACKEND: 'Agg', MPLCONFIGDIR: task.tmp, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' }
    });
    return { exitCode: 0, stdout: clip(stdout, 64_000), stderr: clip(stderr, 8_000), timedOut: false };
  } catch (error) {
    const failure = error as { code?: unknown; killed?: boolean; signal?: unknown; stdout?: unknown; stderr?: unknown; message?: string };
    return { exitCode: typeof failure.code === 'number' ? failure.code : 1, stdout: clip(failure.stdout, 64_000),
      stderr: clip(failure.stderr ?? failure.message, 8_000), timedOut: Boolean(failure.killed && failure.signal) };
  } finally {
    await rm(script, { force: true });
  }
}

function paths(root: string, uid: number): TaskPaths {
  return { root, uid, input: join(root, 'input'), output: join(root, 'output'), tmp: join(root, 'tmp'), home: join(root, 'home'), workspace: join(root, 'workspace') };
}

async function saveInput(request: IncomingMessage, path: string, uid: number): Promise<{ size: number; sha256: string }> {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error('INPUT_SYMLINK');
    const existingHandle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let existing: Buffer;
    try {
      if ((await existingHandle.stat()).size > settings.maxBytes) throw new Error('FILE_TOO_LARGE');
      existing = await existingHandle.readFile();
    } finally { await existingHandle.close(); }
    const oldHash = createHash('sha256').update(existing).digest('hex');
    const incoming = createHash('sha256');
    let incomingSize = 0;
    for await (const chunk of request) {
      incomingSize += (chunk as Buffer).length;
      if (incomingSize > settings.maxBytes) throw new Error('FILE_TOO_LARGE');
      incoming.update(chunk as Buffer);
    }
    if (incomingSize !== existing.length || incoming.digest('hex') !== oldHash) throw new Error('INPUT_CONFLICT');
    return { size: existing.length, sha256: oldHash };
  } catch (error) {
    if (!(error instanceof Error) || !/ENOENT/.test(error.message)) throw error;
  }
  const digest = createHash('sha256');
  let size = 0;
  const temporary = join(dirname(path), `.upload-${randomUUID()}`);
  const output = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    for await (const chunk of request) {
      const buffer = chunk as Buffer;
      size += buffer.length;
      if (size > settings.maxBytes) throw new Error('FILE_TOO_LARGE');
      digest.update(buffer);
      let written = 0;
      while (written < buffer.length) written += (await output.write(buffer, written, buffer.length - written)).bytesWritten;
    }
    await output.close();
    if (process.getuid?.() === 0) await chown(temporary, uid, uid);
    await link(temporary, path);
    await rm(temporary, { force: true });
    return { size, sha256: digest.digest('hex') };
  } catch (error) {
    await output.close().catch(() => undefined);
    await rm(temporary, { force: true });
    throw error;
  }
}

async function checkedOutput(task: TaskPaths, value: unknown): Promise<{ path: string; size: number }> {
  if (typeof value !== 'string' || !value || value.includes('..') || value.includes('\\') || value.includes('/') || value.startsWith('/')) throw new Error('OUTPUT_PATH_INVALID');
  const root = await realpath(task.output);
  if ((await lstat(join(root, value))).isSymbolicLink()) throw new Error('OUTPUT_SYMLINK');
  const path = await realpath(join(root, value));
  if (!path.startsWith(root + sep)) throw new Error('OUTPUT_OUTSIDE_TASK');
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > settings.maxBytes) throw new Error('OUTPUT_INVALID');
  return { path, size: metadata.size };
}

async function checkedInput(task: TaskPaths, value: unknown): Promise<{ path: string; size: number }> {
  if (typeof value !== 'string' || !value || value.includes('..') || value.includes('\\') || value.includes('/') || value.startsWith('/')) throw new Error('INPUT_PATH_INVALID');
  const root = await realpath(task.input);
  const candidates = (await readdir(root)).filter((name) => name === value || name.endsWith(`-${value}`));
  if (candidates.length !== 1) throw new Error(candidates.length ? 'INPUT_NAME_AMBIGUOUS' : 'INPUT_NOT_FOUND');
  const path = await realpath(join(root, candidates[0]!));
  if (!path.startsWith(root + sep)) throw new Error('INPUT_OUTSIDE_TASK');
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > settings.maxBytes) throw new Error('INPUT_INVALID');
  return { path, size: metadata.size };
}

function authorized(request: IncomingMessage): boolean {
  const received = request.headers['x-file-worker-secret'];
  if (typeof received !== 'string') return false;
  const left = Buffer.from(received);
  const right = Buffer.from(settings.secret);
  return left.length === right.length && timingSafeEqual(left, right);
}

function validId(value: string | undefined): boolean {
  return Boolean(value && /^[a-f0-9-]{36}$/.test(value));
}

function safeName(value: string): string {
  return basename(value).replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_').slice(0, 140) || 'attachment';
}

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function json(response: ServerResponse, code: number, value: unknown): void {
  response.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  let value = '';
  for await (const chunk of request) {
    value += String(chunk);
    if (value.length > maxBytes) throw new Error('REQUEST_TOO_LARGE');
  }
  return value;
}
