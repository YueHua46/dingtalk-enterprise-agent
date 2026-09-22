import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PgRepository } from '../dist/persistence.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://agent:agent@localhost:5432/agent' });
const repo = new PgRepository(pool);
const suffix = randomUUID();
const user = { corpId: 'smoke-corp-' + suffix, userId: 'smoke-user-' + suffix, displayName: 'Smoke User' };
const request = {
  requestId: 'smoke-request-' + suffix,
  messageId: 'smoke-message-' + suffix,
  user,
  surface: { type: 'direct', id: user.userId },
  text: 'postgres smoke',
  attachments: [],
  receivedAt: Date.now()
};

let task;
try {
  await repo.ping();
  await repo.ensureUser(user);
  const surfaceId = await repo.ensureSurface(user, request.surface);
  task = await repo.createTask(request, surfaceId);
  assert.equal((await repo.findTask(task.id))?.request.messageId, request.messageId);
  assert.equal(await repo.markInbox(request.messageId, 60_000), true);
  assert.equal(await repo.markInbox(request.messageId, 60_000), false);

  const challenge = {
    taskId: task.id,
    user,
    action: { name: 'Smoke write', risk: 'write', target: 'smoke', parameters: { value: 1 } },
    parameterHash: 'smoke-hash-' + suffix,
    expiresAt: Date.now() + 60_000
  };
  await repo.saveApproval(challenge, 'business');
  assert.equal((await repo.getApproval(task.id))?.status, 'pending');
  await repo.decideApproval(task.id, 'approved');
  assert.equal((await repo.getApproval(task.id))?.status, 'approved');

  const idempotencyKey = 'smoke-idempotency-' + suffix;
  assert.equal(await repo.beginToolInvocation({ idempotencyKey, taskId: task.id, actionHash: challenge.parameterHash, toolName: 'smoke' }), true);
  assert.equal(await repo.beginToolInvocation({ idempotencyKey, taskId: task.id, actionHash: challenge.parameterHash, toolName: 'smoke' }), false);
  await repo.finishToolInvocation(idempotencyKey, 'completed', { ok: true });
  assert.deepEqual((await repo.getToolInvocation(idempotencyKey))?.result, { ok: true });

  await repo.upsertUserMemory(user, { key: 'language', value: 'zh-CN', sensitivity: 'normal' });
  assert.deepEqual(await repo.listUserMemories(user), [{ key: 'language', value: 'zh-CN', sensitivity: 'normal' }]);
  assert.equal(await repo.deleteUserMemory(user, 'language'), true);

  await repo.updateTask(task.id, 'completed', { resultSummary: 'ok' });
  assert.equal((await repo.findTask(task.id))?.status, 'completed');
  console.log(JSON.stringify({ ok: true, checks: ['task', 'inbox', 'approval', 'idempotency', 'memory'] }));
} finally {
  if (task) {
    await pool.query('DELETE FROM tool_invocations WHERE task_id=$1', [task.id]).catch(() => undefined);
    await pool.query('DELETE FROM approvals WHERE task_id=$1', [task.id]).catch(() => undefined);
    await pool.query('DELETE FROM audit_events WHERE task_id=$1', [task.id]).catch(() => undefined);
    await pool.query('DELETE FROM tasks WHERE id=$1', [task.id]).catch(() => undefined);
  }
  await pool.query('DELETE FROM inbox_events WHERE event_id=$1', [request.messageId]).catch(() => undefined);
  await pool.query('DELETE FROM conversation_surfaces WHERE corp_id=$1 AND user_id=$2', [user.corpId, user.userId]).catch(() => undefined);
  await pool.query('DELETE FROM user_memories WHERE corp_id=$1 AND user_id=$2', [user.corpId, user.userId]).catch(() => undefined);
  await pool.query('DELETE FROM users WHERE corp_id=$1 AND user_id=$2', [user.corpId, user.userId]).catch(() => undefined);
  await pool.end();
}
