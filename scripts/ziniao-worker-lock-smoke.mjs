// Smoke test for the ziniao worker machine lock. Run this ON the ziniao
// execution machine (Windows or Linux) with Node available:
//
//   node scripts/ziniao-worker-lock-smoke.mjs [path/to/ziniao-worker-win.mjs]
//
// It never spawns the real ziniao-cli: every case uses 'status' for a random
// digest whose per-user config.json does not exist, which the worker resolves
// from the filesystem alone. The worker runs against a temporary
// ZINIAO_WORKER_ROOT, so real user data is untouched.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const workerPath = resolve(process.argv[2] ?? new URL('../remote/ziniao-worker-win.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);
let failures = 0;

function check(name, ok, detail = '') {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures += 1;
}

function runWorker(op, digest, extraEnv = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [workerPath], {
      env: {
        ...process.env,
        ZINIAO_WORKER_ROOT: tempRoot,
        ZINIAO_LOCK_WAIT_MS: String(process.env.SMOKE_LOCK_WAIT_MS ?? 1500),
        ZINIAO_LOCK_STALE_MS: String(process.env.SMOKE_LOCK_STALE_MS ?? 20 * 60_000),
        ...extraEnv
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let out = '';
    child.stdout.on('data', (chunk) => { out += String(chunk); });
    child.stderr.resume();
    child.stdin.end(JSON.stringify({ op, digest }));
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.once('exit', () => {
      clearTimeout(timer);
      const lines = out.trim().split('\n').filter(Boolean);
      let event = null;
      for (const line of lines) {
        try { event = JSON.parse(line); } catch { /* ignore non-JSON lines */ }
      }
      resolvePromise(event);
    });
  });
}

async function lockExists() {
  try { await access(join(tempRoot, 'cli.lock')); return true; } catch { return false; }
}

const tempRoot = await mkdtemp(join(tmpdir(), 'ziniao-lock-smoke-'));
try {
  const probe = await runWorker('probe', digestA);
  check('probe works without the lock', probe?.ok === true, JSON.stringify(probe));

  const first = await runWorker('status', digestA);
  check('status succeeds when the lock is free', first?.ok === true && first.configured === false, JSON.stringify(first));
  check('lock file is removed after success', !(await lockExists()));

  const now = Date.now();
  await writeFile(join(tempRoot, 'cli.lock'), JSON.stringify({ pid: 999999, op: 'run', digest: digestB, at: now }));
  const contended = await runWorker('status', digestA);
  check('a held lock yields ZINIAO_BUSY after the bounded wait', contended?.ok === false && contended.code === 'ZINIAO_BUSY', JSON.stringify(contended));
  check('a held lock is preserved when not stale', await lockExists());

  await writeFile(join(tempRoot, 'cli.lock'), JSON.stringify({ pid: 999999, op: 'run', digest: digestB, at: now - 5000 }));
  const recovered = await runWorker('status', digestA, { ZINIAO_LOCK_STALE_MS: '1000' });
  check('a stale lock is broken automatically', recovered?.ok === true && recovered.configured === false, JSON.stringify(recovered));
  check('lock file is removed after stale recovery', !(await lockExists()));
} finally {
  await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
}

console.log(failures === 0 ? '\nAll lock smoke checks passed.' : '\n' + failures + ' lock smoke check(s) failed.');
process.exit(failures === 0 ? 0 : 1);
