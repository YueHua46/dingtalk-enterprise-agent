import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { CodexClient } from '../dist/codex-client.js';
import { loadConfig } from '../dist/config.js';
import { NativeWebTool } from '../dist/native-web-tool.js';

const config = loadConfig({
  ...process.env,
  NODE_ENV: 'test',
  DINGTALK_ROBOT_CODE: process.env.DINGTALK_ROBOT_CODE || 'smoke-robot',
  CODEX_BIN: process.env.CODEX_BIN || 'codex',
  CODEX_WORKDIR: process.env.CODEX_WORKDIR || process.cwd(),
  SKILLS_DIR: process.env.SKILLS_DIR || resolve(process.cwd(), 'skills')
});
assert.ok(config.MODEL_BASE_URL && config.MODEL_API_KEY, 'MODEL_BASE_URL and MODEL_API_KEY are required');

const client = new CodexClient(config);
const webTool = new NativeWebTool(config);
const eventTypes = [];
let webToolCalls = 0;
let grounded = false;
try {
  const threadId = await client.startThread({ corpId: 'smoke-corp', userId: 'smoke-user' });
  const result = await client.turn(threadId,
    '请联网核实今天的日期，并从一个公开权威来源找出今天的最新科技新闻标题。给出来源链接。如果没有实际联网结果，不要猜测。',
    (event) => {
      const item = event.params?.item;
      if (item?.type && !eventTypes.includes(item.type)) eventTypes.push(item.type);
    },
    async (request) => {
      if (request.method !== 'item/tool/call' || request.params?.namespace !== 'internet' || request.params?.tool !== 'search') {
        console.log(JSON.stringify({ stage: 'other-tool-call', namespace: request.params?.namespace, tool: request.params?.tool }));
        return { contentItems: [{ type: 'inputText', text: 'Tool unavailable in this isolated smoke test.' }], success: false };
      }
      webToolCalls += 1;
      console.log(JSON.stringify({ stage: 'search-started', webToolCalls }));
      try {
        const answer = await webTool.search(request.params.arguments);
        grounded = /Web search queries:/i.test(answer) && /Sources:/i.test(answer);
        console.log(JSON.stringify({ stage: 'search-completed', grounded, answerLength: answer.length }));
        return { contentItems: [{ type: 'inputText', text: answer }], success: true };
      } catch (error) {
        console.log(JSON.stringify({ stage: 'search-failed', reason: error instanceof Error ? error.message : 'search failed' }));
        return { contentItems: [{ type: 'inputText', text: error instanceof Error ? error.message : 'search failed' }], success: false };
      }
    }
  );
  const text = result.text.trim();
  const hasSource = /https?:\/\//i.test(text);
  console.log(JSON.stringify({ hasSource, webToolCalls, grounded, eventTypes, answerPreview: text.slice(0, 1000) }));
  assert.ok(webToolCalls > 0, 'Model did not choose web.search');
  assert.ok(grounded, 'Gemini did not return native grounding');
  assert.ok(hasSource, 'No source URL in final answer');
} finally {
  await client.stop();
}
