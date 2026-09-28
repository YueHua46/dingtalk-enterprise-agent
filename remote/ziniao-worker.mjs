import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdir, open, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// This program is the forced command for the gateway's dedicated SSH key.
// It never accepts a shell command, filesystem path, or plaintext identity.
// Ziniao officially does not support two accounts calling the CLI at the same
// time, so every CLI-spawning operation holds a machine-global lock file.
const root = process.env.ZINIAO_WORKER_ROOT || '/home/jennov/.local/share/dingtalk-ziniao/users';
const cli = '/home/jennov/.local/ziniao-cli/node_modules/.bin/ziniao-cli';
const lockPath = join(root, 'cli.lock');
const lockWaitMs = Number(process.env.ZINIAO_LOCK_WAIT_MS || 10_000);
const lockStaleMs = Number(process.env.ZINIAO_LOCK_STALE_MS || 20 * 60_000); // authorize cap 15min + margin
const allowed = new Set(['account', 'staff', 'department', 'role', 'device', 'store', 'page', 'automation', 'utility', 'zclaw', 'api']);
const urlPattern = /https:\/\/open\.ziniao\.com\/memberAuth\?[^\s"'<>]+/;

function emit(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
function fail(code) { emit({ type: 'result', ok: false, code }); }
function profile(digest) { return 'dingtalk-' + digest.slice(0, 24); }
function homeFor(digest) { return join(root, digest); }
function cliEnv(digest) {
  const home = homeFor(digest);
  return {
    PATH: process.env.PATH,
    LANG: process.env.LANG || 'C.UTF-8',
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_RUNTIME_DIR: '/run/user/1000',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
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
  const child = spawn(cli, args, { env: cliEnv(digest), stdio: ['ignore', 'pipe', 'pipe'] });
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
  try {
    await stat(join(homeFor(digest), '.ziniao-cli', 'config.json'));
    await stat(join(homeFor(digest), '.ziniao-auth-invalid'));
    return false;
  } catch (error) {
    if (error?.path?.endsWith('.ziniao-cli/config.json')) return false;
  }
  const check = await execute(['config', 'show'], digest);
  return check.code === 0;
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
      if (!await bridgeReady()) return fail('ZINIAO_LOCAL_CLIENT_REQUIRED');
      let output = '';
      let prompted = false;
      const result = await execute(['config', 'init', '--new', '--profile', profile(digest)], digest, (chunk) => {
        output = (output + chunk).slice(-8192);
        const url = output.match(urlPattern)?.[0];
        if (url && !prompted) { prompted = true; emit({ type: 'prompt', url }); }
      }, 15 * 60 * 1000);
      if (result.code !== 0) {
        if (/紫鸟客户端未登录|启动并登录后再执行初始化/.test(output)) return fail('ZINIAO_LOCAL_CLIENT_REQUIRED');
        return fail('ZINIAO_AUTH_FAILED');
      }
      await unlink(join(homeFor(digest), '.ziniao-auth-invalid')).catch(() => undefined);
      if (!await configured(digest)) return fail('ZINIAO_AUTH_NOT_SAVED');
      return emit({ type: 'result', ok: true, profileKey: profile(digest) });
    }
    if (!await configured(digest)) return fail('ZINIAO_AUTH_REQUIRED');
    const args = request.args;
    if (!Array.isArray(args) || args.length < 2 || args.length > 42 ||
        args.some((arg) => typeof arg !== 'string' || arg.length > 4000 || /[\0\r\n]/.test(arg)) ||
        !allowed.has(args[0]) || /^(config|doctor|skills)$/.test(args[0])) return fail('INVALID_COMMAND');
    const result = await execute([...args, '--format', 'json'], digest);
    let parsed;
    try { parsed = JSON.parse(result.stdout); } catch { return fail('ZINIAO_INVALID_RESPONSE'); }
    if (result.code !== 0 || parsed?.ok === false) {
      const message = String(parsed?.error?.message ?? result.stderr);
      if (/需要\s*Boss|Boss\s*权限|permission denied|权限不足/i.test(message)) return fail('ZINIAO_PERMISSION_DENIED');
      if (parsed?.error?.type === 'auth' || /unauthori[sz]ed|api.?key|credential|keychain/i.test(message)) {
        await writeFile(join(homeFor(digest), '.ziniao-auth-invalid'), '', { mode: 0o600 });
        return fail('ZINIAO_AUTH_REQUIRED');
      }
      return fail('ZINIAO_COMMAND_FAILED');
    }
    emit({ type: 'result', ok: true, data: parsed?.data ?? parsed });
  } finally {
    await releaseCliLock();
  }
}

main().catch(() => fail('ZINIAO_WORKER_FAILED'));
