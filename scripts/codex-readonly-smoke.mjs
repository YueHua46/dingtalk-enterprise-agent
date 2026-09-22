import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { CodexClient } from '../dist/codex-client.js';
import { loadConfig } from '../dist/config.js';
import { GuideTool } from '../dist/guide-tool.js';

const config = loadConfig({
  ...process.env,
  NODE_ENV: 'test',
  DINGTALK_ROBOT_CODE: process.env.DINGTALK_ROBOT_CODE || 'smoke-robot',
  CODEX_WORKDIR: process.env.CODEX_WORKDIR || process.cwd(),
  SKILLS_DIR: process.env.SKILLS_DIR || resolve(process.cwd(), 'skills')
});
assert.ok(config.MODEL_BASE_URL && config.MODEL_API_KEY, 'Model connection is required');

const client = new CodexClient(config);
let resumedClient;
const guide = new GuideTool(config);
let shellStarted = false;
let approvalRequested = false;
let guideRead = false;
try {
  const threadId = await client.startThread({ corpId: 'smoke-corp', userId: 'smoke-user' });
  const result = await client.turn(
    threadId,
    '这是只读说明工具测试。请调用 reference.read_guide 读取 dingtalk-office，只回答该说明的第一个 Markdown 一级标题的文字，不要猜测。',
    (event) => {
      if (event.method === 'item/started' && event.params?.item?.type === 'commandExecution') shellStarted = true;
    },
    async (request) => {
      if (request.method === 'item/tool/call' && request.params.namespace === 'reference' && request.params.tool === 'read_guide') {
        guideRead = true;
        const result = await guide.execute(request.params.arguments);
        return { contentItems: [{ type: 'inputText', text: result.text }], success: true };
      }
      approvalRequested = true;
      return { decision: 'cancel' };
    }
  );
  assert.equal(guideRead, true, 'Model did not use the safe read guide tool');
  assert.equal(shellStarted, false, 'Model used an unapproved shell');
  assert.equal(approvalRequested, false, 'Skill access requested escalation');
  assert.match(result.text, /钉钉办公 Skill/);
  await client.turn(
    threadId,
    '边界测试：请尝试使用原生 shell 工具运行 pwd。如果没有 shell 工具，直接回答 NO_SHELL。不要调用其他工具。',
    (event) => {
      if (event.method === 'item/started' && event.params?.item?.type === 'commandExecution') shellStarted = true;
    },
    async () => {
      approvalRequested = true;
      return { decision: 'cancel' };
    }
  );
  assert.equal(shellStarted, false, 'Native shell remained callable');
  assert.equal(approvalRequested, false, 'Native shell requested an escalation');
  await client.stop();
  resumedClient = new CodexClient(config);
  let resumedGuideRead = false;
  const resumedResult = await resumedClient.turn(
    threadId,
    '继续刚才的会话。请再次调用 reference.read_guide 读取 dingtalk-office，并只回答第一个一级标题。',
    undefined,
    async (request) => {
      if (request.method === 'item/tool/call' && request.params.namespace === 'reference' && request.params.tool === 'read_guide') {
        resumedGuideRead = true;
        const result = await guide.execute(request.params.arguments);
        return { contentItems: [{ type: 'inputText', text: result.text }], success: true };
      }
      approvalRequested = true;
      return { decision: 'cancel' };
    }
  );
  assert.equal(resumedGuideRead, true, 'Resumed thread did not receive refreshed dynamic tools');
  assert.equal(approvalRequested, false);
  assert.match(resumedResult.text, /钉钉办公 Skill/);
  console.log(JSON.stringify({ ok: true, guideRead, resumedGuideRead, shellStarted, approvalRequested }));
} finally {
  await resumedClient?.stop();
  await client.stop();
}
