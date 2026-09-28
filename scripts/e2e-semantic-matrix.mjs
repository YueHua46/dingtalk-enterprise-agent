/** Real model and connector replay with the original DingTalk identity and a captured sender. */
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadConfig } from '../dist/config.js';
import { InMemoryRepository } from '../dist/persistence.js';
import { CodexClient } from '../dist/codex-client.js';
import { DwsBroker } from '../dist/dws-broker.js';
import { TaskOrchestrator } from '../dist/task-orchestrator.js';

const [seedTaskId, questionsPath, selectedCase] = process.argv.slice(2);
if (!seedTaskId || !questionsPath) throw new Error('Usage: node scripts/e2e-semantic-matrix.mjs <seed-task-id> <questions.json> [case-number]');
const questions = JSON.parse(await readFile(questionsPath, 'utf8'));
if (!Array.isArray(questions) || questions.length < 1 || questions.length > 20 || questions.some((q) =>
  typeof q === 'string' ? !q.trim() : !q || typeof q.question !== 'string' || !q.question.trim() || !['completed', 'clarification', 'clarification_or_partial', 'authorization', 'authorized_or_explained'].includes(q.expected))) {
  throw new Error('Questions must be 1–20 strings or {question, expected} entries');
}
if (selectedCase && (!/^\d+$/.test(selectedCase) || Number(selectedCase) < 1 || Number(selectedCase) > questions.length)) {
  throw new Error('case-number must identify a question in the JSON array');
}
const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
const row = (await pool.query('SELECT request_payload FROM tasks WHERE id=$1', [seedTaskId])).rows[0];
if (!row) throw new Error('Seed task not found');
const seed = row.request_payload;
const repository = new InMemoryRepository();
const codex = new CodexClient(config);
const delivered = [];
const directAuthorizationPrompts = [];
const sender = {
  async send(surface, markdown, title) {
    if (surface.type !== seed.surface.type || surface.id !== seed.surface.id) throw new Error('RESULT_SENT_TO_WRONG_SURFACE');
    delivered.push({ markdown, title });
  },
  async sendDirect(user, markdown, title) {
    if (user.corpId !== seed.user.corpId || user.userId !== seed.user.userId || !['DWS 授权', '紫鸟授权'].includes(title)) {
      throw new Error('UNEXPECTED_DIRECT_DELIVERY');
    }
    directAuthorizationPrompts.push({ markdown, title });
  },
};
const orchestrator = new TaskOrchestrator(config, repository, codex, new DwsBroker(config), sender);

try {
  await codex.start();
  const failures = [];
  for (const [index, entry] of questions.entries()) {
    if (selectedCase && index + 1 !== Number(selectedCase)) continue;
    const question = typeof entry === 'string' ? entry : entry.question;
    const expected = typeof entry === 'string' ? 'completed' : entry.expected;
    const request = { ...seed, requestId: randomUUID(), messageId: randomUUID(), text: question,
      receivedAt: Date.now(), attachments: [], quotedText: undefined, quotedMessageId: undefined };
    const before = delivered.length;
    const beforeAuthorization = directAuthorizationPrompts.length;
    const task = await orchestrator.accept(request);
    const deadline = Date.now() + (Number(process.env.E2E_CASE_TIMEOUT_MS) || 8 * 60_000);
    let current;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      current = await repository.findTask(task.id);
      if (['completed', 'failed', 'waiting_clarification', 'waiting_confirmation', 'cancelled'].includes(current?.status)
        && (current.status === 'completed' ? delivered.slice(before).some((item) => item.title === 'Agent智能助手')
          : current.status === 'failed' ? delivered.slice(before).some((item) => item.title === '暂时无法处理')
            : current.status === 'waiting_clarification' ? delivered.slice(before).some((item) => item.title === '需要补充信息') : true)) break;
      if (current?.status === 'waiting_oauth' && directAuthorizationPrompts.length > beforeAuthorization) break;
    }
    const state = await repository.getWorkflow(task.id);
    const replyOnOriginalSurface = delivered.slice(before).some((entry) => entry.title === 'Agent智能助手');
    const failedOnOriginalSurface = delivered.slice(before).find((entry) => entry.title === '暂时无法处理');
    const clarificationOnOriginalSurface = delivered.slice(before).find((entry) => entry.title === '需要补充信息');
    console.log(JSON.stringify({ case: index + 1, question, status: current?.status ?? 'missing',
      completionStatus: state?.completion?.status, goal: state?.contract?.goal,
      deliverables: state?.contract?.deliverables, assumptions: state?.contract?.assumptions,
      factShapes: state?.contract?.requiredFacts?.map(({ id, acceptableSources, enumeration, grain }) => ({ id, acceptableSources, enumeration, grain })),
      capabilities: state?.evidence.map((record) => ({ id: record.capabilityId, status: record.status,
        ...(record.pagination ? { page: { total: record.pagination.total, offset: record.pagination.offset, returned: record.pagination.returned,
          dimensions: record.pagination.dimensions, fixedDimensions: record.pagination.fixedDimensions } } : {}) })),
      replyOnOriginalSurface,
      failedOnOriginalSurface: Boolean(failedOnOriginalSurface),
      failureExplanation: failedOnOriginalSurface?.markdown ?? null,
      clarificationOnOriginalSurface: Boolean(clarificationOnOriginalSurface),
      clarificationQuestion: state?.clarification?.question ?? null,
      completionRejections: repository.audits.filter((entry) => entry.taskId === task.id && entry.eventType === 'workflow.complete_rejected')
        .map((entry) => entry.payload?.reason),
      authorizationPromptSentPrivately: directAuthorizationPrompts.length > beforeAuthorization,
      answer: current?.resultSummary ?? null,
      error: current?.errorCode ?? null }));
    if (!current || current.status === 'running') {
      if (current?.threadId) await codex.interrupt(current.threadId).catch(() => undefined);
      throw new Error(`Case ${index + 1} exceeded eight minutes`);
    }
    const authorizedOrExplained = current.status === 'completed' && replyOnOriginalSurface
      || current.status === 'waiting_oauth' && directAuthorizationPrompts.length > beforeAuthorization
      || current.status === 'failed' && Boolean(failedOnOriginalSurface)
        && typeof current.errorCode === 'string' && /^ZINIAO_[A-Z_]+$/.test(current.errorCode);
    const passed = expected === 'authorization'
      ? current.status === 'waiting_oauth' && directAuthorizationPrompts.length > beforeAuthorization
      : expected === 'clarification' ? current.status === 'waiting_clarification' && Boolean(clarificationOnOriginalSurface)
      : expected === 'clarification_or_partial' ? current.status === 'waiting_clarification' && Boolean(clarificationOnOriginalSurface)
        || current.status === 'completed' && state?.completion?.status === 'partial' && replyOnOriginalSurface
      : expected === 'authorized_or_explained' ? authorizedOrExplained : current.status === 'completed' && replyOnOriginalSurface;
    if (!passed) failures.push(index + 1);
  }
  if (failures.length) throw new Error(`E2E_CASES_FAILED: ${failures.join(',')}`);
} finally {
  await orchestrator.stop().catch(() => undefined);
  await codex.stop().catch(() => undefined);
  await pool.end();
}
