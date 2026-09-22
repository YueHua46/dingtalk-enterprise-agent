import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { CodexClient } from '../dist/codex-client.js';
import { loadConfig } from '../dist/config.js';

const expected = 'MODEL_E2E_OK';
const config = loadConfig({
  ...process.env,
  NODE_ENV: 'test',
  DINGTALK_ROBOT_CODE: process.env.DINGTALK_ROBOT_CODE || 'smoke-robot',
  CODEX_BIN: process.env.CODEX_BIN || 'codex',
  CODEX_WORKDIR: process.env.CODEX_WORKDIR || process.cwd(),
  SKILLS_DIR: process.env.SKILLS_DIR || resolve(process.cwd(), 'skills')
});
assert.ok(config.MODEL_BASE_URL, 'MODEL_BASE_URL is required for the real model smoke test');
assert.ok(config.MODEL_API_KEY, 'MODEL_API_KEY is required for the real model smoke test');

const client = new CodexClient(config);

try {
  const threadId = await client.startThread({ corpId: 'smoke-corp', userId: 'smoke-user' });
  const result = await client.turn(
    threadId,
    `只回复字符串 ${expected}，不要调用任何工具，也不要添加标点或解释。`
  );
  assert.equal(result.text.trim(), expected);
  console.log(JSON.stringify({ ok: true, responseMatched: true, transport: 'http-responses' }));
} finally {
  await client.stop();
}
