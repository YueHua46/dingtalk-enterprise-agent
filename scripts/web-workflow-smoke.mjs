// Run inside gateway with an isolated one-off file-worker whose model proxy
// points to gateway:8082. Uses the invoking task's identity and captures replies
// in memory: no DingTalk messages, business writes, or production task inserts.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadConfig } from '../dist/config.js';
import { InMemoryRepository } from '../dist/persistence.js';
import { HybridCodexClient } from '../dist/hybrid-codex-client.js';
import { TaskOrchestrator } from '../dist/task-orchestrator.js';
import { createServer } from '../dist/server.js';

const sourceTaskId = process.argv[2];
assert.match(sourceTaskId ?? '', /^[0-9a-f-]{36}$/i, 'Pass the invoking production task ID');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query('SELECT request_payload FROM tasks WHERE id=$1', [sourceTaskId]);
await pool.end();
assert.ok(rows[0]?.request_payload?.user, 'Invoking user identity not found');
const original = rows[0].request_payload;
const config = loadConfig({ ...process.env, PORT: '8082', LOG_LEVEL: 'warn',
  FILE_WORKER_MODE: 'all', FILE_WORKER_URL: 'http://agent-web-smoke-worker:8081',
  CROSSBORDEROPS_API_URL: undefined, CROSSBORDEROPS_INTERNAL_TOKEN: undefined });
const repo = new InMemoryRepository();
const codex = new HybridCodexClient(config);
const replies = [];
const broker = { async runCommand() { throw new Error('BUSINESS_TOOLS_DISABLED_IN_SMOKE'); } };
const orchestrator = new TaskOrchestrator(config, repo, codex, broker, { async send(_surface, text) { replies.push(text); } });
const server = await createServer(config, orchestrator);
const started = Date.now();
try {
  await server.listen({ host: '0.0.0.0', port: 8082 });
  await codex.start();
  const id = randomUUID();
  const task = await orchestrator.accept({ requestId: id, messageId: id,
    user: original.user, surface: original.surface,
    text: '联网了解下今天有什么新闻。请给出3条新闻和来源链接。',
    attachments: [], receivedAt: Date.now() });
  assert.ok(task);
  console.log(JSON.stringify({ stage: 'started', taskId: task.id }));
  let result;
  let lastEvidenceCount = -1;
  while (Date.now() - started < 300_000) {
    result = await repo.findTask(task.id);
    const workflow = await repo.getWorkflow(task.id);
    if ((workflow?.evidence.length ?? 0) !== lastEvidenceCount) {
      lastEvidenceCount = workflow?.evidence.length ?? 0;
      console.log(JSON.stringify({ stage: 'progress', elapsedMs: Date.now() - started, status: result?.status, evidenceCount: lastEvidenceCount }));
    }
    if (['completed', 'failed', 'cancelled'].includes(result?.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const workflow = await repo.getWorkflow(task.id);
  const verified = workflow?.evidence.filter((e) => e.capabilityId === 'internet.search' && e.status === 'success') ?? [];
  const answer = result?.resultSummary ?? '';
  const sources = [...new Set(answer.match(/https:\/\/[^\s)]+/g) ?? [])];
  console.log(JSON.stringify({ stage: 'finished', elapsedMs: Date.now() - started, status: result?.status,
    completionStatus: workflow?.completion?.status, verifiedWebCalls: verified.length, sourceCount: sources.length,
    reviewRounds: workflow?.reviewRounds, answerLength: answer.length, error: result?.errorCode,
    answerPreview: answer.slice(0, 1200) }));
  assert.equal(result?.status, 'completed');
  assert.ok(verified.length > 0, 'Native web results were not registered as evidence');
  assert.ok(sources.length >= 3, 'News answer did not contain three source links');
  assert.notEqual(workflow?.completion?.status, 'blocked');
} finally {
  await orchestrator.stop();
  await codex.stop();
  await server.close();
}
