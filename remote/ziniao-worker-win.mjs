import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdir, open, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Forced SSH command on the dedicated Windows execution machine. The SSH
// account is only the runtime; each DingTalk identity selects one CLI profile.
// Ziniao officially does not support two accounts calling the CLI at the same
// time, so every CLI-spawning operation holds a machine-global lock file.
const root = process.env.ZINIAO_WORKER_ROOT || 'C:\\ProgramData\\DingtalkZiniao\\users';
const cli = 'C:\\Users\\info\\AppData\\Roaming\\npm\\node_modules\\@ziniao-open\\cli\\bin\\ziniao-cli.exe';
const lockPath = join(root, 'cli.lock');
const lockWaitMs = Number(process.env.ZINIAO_LOCK_WAIT_MS || 10_000);
const lockStaleMs = Number(process.env.ZINIAO_LOCK_STALE_MS || 20 * 60_000); // authorize cap 15min + margin
const allowed = new Set(['account', 'staff', 'department', 'role', 'device', 'store', 'page', 'automation', 'utility', 'zclaw', 'api']);
const bridgeCommands = new Set(['store', 'page', 'automation', 'utility', 'zclaw']);
const forbiddenFlags = new Set(['--profile', '--api-key', '--token', '--config', '--format', '--yes', '-y']);
const authUrlPattern = /https:\/\/open\.ziniao\.com\/memberAuth\?[^\s"'<>]+/;

function emit(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
function fail(code) { emit({ type: 'result', ok: false, code }); }
function parseSuccessOutput(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { message: text.slice(0, 4096) }; }
}
async function attachScreenshotData(args, parsed) {
  if (!Array.isArray(args) || args[0] !== 'page' || args[1] !== 'screenshot') return parsed;
  const data = parsed && typeof parsed === 'object' && parsed.data && typeof parsed.data === 'object'
    ? parsed.data : parsed;
  const filePath = data && typeof data.filePath === 'string' ? data.filePath : undefined;
  if (!filePath) return parsed;
  try {
    const bytes = await readFile(filePath);
    if (bytes.length > 12 * 1024 * 1024) return parsed;
    return { ...(data ?? {}), base64: bytes.toString('base64') };
  } catch {
    return parsed;
  }
}
function profile(digest) { return 'dingtalk-' + digest.slice(0, 24); }
function homeFor(digest) { return join(root, digest); }
function cliEnv(digest) {
  const home = homeFor(digest);
  return {
    ...process.env,
    USERPROFILE: home,
    HOME: home,
    ZINIAO_CLI_NO_UPDATE_CHECK: '1'
  };
}

async function readCliLock() {
  try {
    return JSON.parse(await readFile(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

async function breakStaleCliLock() {
  const lock = await readCliLock();
  if (lock && typeof lock.at === 'number' && Date.now() - lock.at > lockStaleMs) {
    await rm(lockPath, { force: true }).catch(() => undefined);
    return true;
  }
  return false;
}

async function acquireCliLock(op, digest) {
  const deadline = Date.now() + lockWaitMs;
  for (;;) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, op, digest, at: Date.now() }));
      await handle.close();
      return true;
    } catch (error) {
      if (error?.code !== 'EEXIST') return false;
      if (await breakStaleCliLock()) continue;
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function releaseCliLock() {
  const lock = await readCliLock();
  if (lock && lock.pid === process.pid) await rm(lockPath, { force: true }).catch(() => undefined);
}

async function readRequest() {
  let data = '';
  for await (const chunk of process.stdin) {
    data += String(chunk);
    if (data.length > 64 * 1024) throw new Error('REQUEST_TOO_LARGE');
  }
  return JSON.parse(data);
}

async function bridgeReady() {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: 9481 });
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

function execute(args, digest, onOutput, timeoutMs = 60_000) {
  const child = spawn(cli, args, {
    env: cliEnv(digest),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stdout = '';
  let stderr = '';
  const inspect = (which, chunk) => {
    const value = String(chunk);
    if (which === 'stdout') stdout = (stdout + value).slice(-12 * 1024 * 1024);
    else stderr = (stderr + value).slice(-8192);
    onOutput?.(value);
  };
  child.stdout.on('data', (chunk) => inspect('stdout', chunk));
  child.stderr.on('data', (chunk) => inspect('stderr', chunk));
  const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
  return new Promise((resolve) => {
    child.once('error', () => { clearTimeout(timer); resolve({ code: -1, stdout, stderr }); });
    child.once('exit', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

async function configured(digest) {
  let config;
  try {
    config = JSON.parse(await readFile(join(homeFor(digest), '.ziniao-cli', 'config.json'), 'utf8'));
    await stat(join(homeFor(digest), '.ziniao-auth-invalid'));
    return false;
  } catch (error) {
    if (!config) return false;
    if (error?.code !== 'ENOENT') return false;
  }
  const key = profile(digest);
  if (config.currentProfile !== key || !config.profiles?.[key]?.apiKey) return false;
  const check = await execute(['config', 'show'], digest);
  return check.code === 0;
}

function validArgs(args) {
  return Array.isArray(args) && args.length >= 2 && args.length <= 42 &&
    allowed.has(args[0]) &&
    args.every((arg) => typeof arg === 'string' && arg.length <= 4000 && !/[\0\r\n]/.test(arg)) &&
    args.every((arg) => {
      const lower = arg.toLowerCase();
      return !forbiddenFlags.has(lower) &&
        !['--profile=', '--api-key=', '--token=', '--config=', '--format='].some((prefix) => lower.startsWith(prefix));
    });
}

async function main() {
  const request = await readRequest();
  if (!request || !['probe', 'status', 'authorize', 'run'].includes(request.op)) return fail('INVALID_OPERATION');
  if (request.op === 'probe') return emit({ type: 'result', ok: true, bridgeReady: await bridgeReady() });
  const digest = request.digest;
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) return fail('INVALID_USER');
  await mkdir(root, { recursive: true });
  await mkdir(homeFor(digest), { recursive: true, mode: 0o700 });
  // Every op below spawns ziniao-cli, so the machine-global lock applies.
  // The gateway queue normally serializes callers; this lock is the backstop
  // that keeps the official "never two accounts at once" invariant even if
  // that queue is bypassed. Waiting is bounded so callers fail fast.
  if (!(await acquireCliLock(request.op, digest))) return fail('ZINIAO_BUSY');
  try {
    if (request.op === 'status') {
      return emit({ type: 'result', ok: true, configured: await configured(digest), profileKey: profile(digest) });
    }
    if (request.op === 'authorize') {
      let output = '';
      let prompted = false;
      const result = await execute(['config', 'init', '--new', '--profile', profile(digest)], digest, (chunk) => {
        output = (output + chunk).slice(-8192);
        const url = output.match(authUrlPattern)?.[0];
        if (url && !prompted) { prompted = true; emit({ type: 'prompt', url }); }
      }, 15 * 60 * 1000);
      if (result.code !== 0) return fail('ZINIAO_AUTH_FAILED');
      await unlink(join(homeFor(digest), '.ziniao-auth-invalid')).catch(() => undefined);
      if (!await configured(digest)) return fail('ZINIAO_AUTH_NOT_SAVED');
      return emit({ type: 'result', ok: true, profileKey: profile(digest) });
    }
    if (!await configured(digest)) return fail('ZINIAO_AUTH_REQUIRED');
    const args = request.args;
    if (!validArgs(args)) return fail('INVALID_COMMAND');
    if (bridgeCommands.has(args[0]) && !await bridgeReady()) return fail('ZINIAO_LOCAL_CLIENT_REQUIRED');
    // --format is a leaf flag, not a CLI-wide flag. In particular `store open`,
    // `page screenshot` and `zclaw invoke` reject it. JSON is the CLI default
    // for commands that support structured output.
    const result = await execute(args, digest);
    if (result.code !== 0) {
      const message = String(result.stderr || result.stdout);
      if (/需要\s*Boss|Boss\s*权限|permission denied|权限不足/i.test(message)) return fail('ZINIAO_PERMISSION_DENIED');
      if (/unauthori[sz]ed|api.?key|credential|keychain|未找到配置文件/i.test(message)) {
        await writeFile(join(homeFor(digest), '.ziniao-auth-invalid'), '', { mode: 0o600 });
        return fail('ZINIAO_AUTH_REQUIRED');
      }
      return fail(/unknown flag/i.test(message) ? 'ZINIAO_CLI_UNKNOWN_FLAG' : 'ZINIAO_COMMAND_FAILED');
    }
    const parsed = parseSuccessOutput(result.stdout);
    if (parsed?.ok === false) {
      const message = String(parsed?.error?.message ?? result.stderr);
      if (/需要\s*Boss|Boss\s*权限|permission denied|权限不足/i.test(message)) return fail('ZINIAO_PERMISSION_DENIED');
      if (parsed?.error?.type === 'auth' || /unauthori[sz]ed|api.?key|credential|keychain/i.test(message)) {
        await writeFile(join(homeFor(digest), '.ziniao-auth-invalid'), '', { mode: 0o600 });
        return fail('ZINIAO_AUTH_REQUIRED');
      }
      return fail('ZINIAO_COMMAND_FAILED');
    }
    const normalized = parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed;
    emit({ type: 'result', ok: true, data: await attachScreenshotData(args, normalized) });
  } finally {
    await releaseCliLock();
  }
}

main().catch(() => fail('ZINIAO_WORKER_FAILED'));
