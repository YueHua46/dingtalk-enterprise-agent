import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { CodexClient } from '../dist/codex-client.js';
import { loadConfig } from '../dist/config.js';

const config = loadConfig({
  NODE_ENV: 'test',
  DINGTALK_ROBOT_CODE: 'smoke-robot',
  CODEX_BIN: process.env.CODEX_BIN || 'codex',
  CODEX_WORKDIR: process.env.CODEX_WORKDIR || process.cwd(),
  SKILLS_DIR: process.env.SKILLS_DIR || resolve(process.cwd(), 'skills')
});
const client = new CodexClient(config);

try {
  await client.start();
  assert.equal(client.isReady(), true);
  const first = client.process;
  assert.ok(first);
  first.kill();

  const deadline = Date.now() + 10_000;
  while (client.isReady() && Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  assert.equal(client.isReady(), false);

  await client.start();
  assert.equal(client.isReady(), true);
  assert.notEqual(client.process?.pid, first.pid);
  console.log(JSON.stringify({ ok: true, restarted: true }));
} finally {
  await client.stop();
}
