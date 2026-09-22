import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { CodexClient } from '../dist/codex-client.js';
import { loadConfig } from '../dist/config.js';
import { generatedDwsCapabilities } from '../dist/generated-dws-capabilities.js';

const config = loadConfig({
  NODE_ENV: 'test',
  DINGTALK_ROBOT_CODE: 'smoke-robot',
  CODEX_BIN: process.env.CODEX_BIN || 'codex',
  CODEX_WORKDIR: process.env.CODEX_WORKDIR || process.cwd(),
  SKILLS_DIR: process.env.SKILLS_DIR || resolve(process.cwd(), 'skills'),
  MODEL_NAME: process.env.MODEL_NAME || 'gpt-5.6-sol'
});
const client = new CodexClient(config);

try {
  await client.start();
  const threadId = await client.startThread({ corpId: 'smoke-corp', userId: 'smoke-user' });
  assert.ok(threadId.length > 0);
  assert.equal(Object.keys(generatedDwsCapabilities).length, 507);
  console.log(JSON.stringify({ ok: true, threadCreated: true, dwsCapabilities: 507 }));
} finally {
  await client.stop();
}
