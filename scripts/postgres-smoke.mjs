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
let recoveryTask;
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
  const recoverySurface = {type:'group',id:'smoke-recovery-' + suffix};
  const recoveryRequest = {...request,requestId:'recovery-' + suffix,messageId:'recovery-' + suffix,surface:recoverySurface};
  const recoverySurfaceId = await repo.ensureSurface(user,recoverySurface);
  recoveryTask = await repo.createTask(recoveryRequest,recoverySurfaceId);
  await repo.updateTask(recoveryTask.id,'failed',{threadId:'saved-thread',errorCode:'MODEL_REQUEST_RETRY_EXHAUSTED'});
  await repo.saveWorkflow(recoveryTask.id,{revision:1,evidence:[],evidenceFiles:[{file:'evidence/index.json'}]});
  for(const eventType of ['tool.call_started','tool.call_finished']) await repo.audit({requestId:recoveryRequest.requestId,taskId:recoveryTask.id,user,
    surfaceId:recoverySurfaceId,eventType,payload:{namespace:'analysis',tool:'python',capabilityId:'analysis.python',argumentHash:'smoke'}});
  const recoveryInput={requestId:'explicit-recovery-' + suffix,user,surface:recoverySurface};
  const attempts=await Promise.allSettled([repo.prepareTaskRecovery(recoveryTask.id,recoveryInput),repo.prepareTaskRecovery(recoveryTask.id,recoveryInput)]);
  assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
  assert.equal((await repo.findTask(recoveryTask.id))?.status,'queued');
  assert.equal((await repo.findTask(recoveryTask.id))?.threadId,'saved-thread');
  assert.equal((await repo.getWorkflow(recoveryTask.id))?.manualRecoveries?.[0]?.requestId,recoveryInput.requestId);
  console.log(JSON.stringify({ ok: true, checks: ['task', 'inbox', 'approval', 'idempotency', 'memory', 'recovery-cas'] }));
} finally {
  if (task) {
    await pool.query('DELETE FROM tool_invocations WHERE task_id=$1', [task.id]).catch(() => undefined);
    await pool.query('DELETE FROM approvals WHERE task_id=$1', [task.id]).catch(() => undefined);
    await pool.query('DELETE FROM audit_events WHERE task_id=$1', [task.id]).catch(() => undefined);
    await pool.query('DELETE FROM tasks WHERE id=$1', [task.id]).catch(() => undefined);
  }
  if(recoveryTask) {
    await pool.query('DELETE FROM audit_events WHERE task_id=$1',[recoveryTask.id]).catch(()=>undefined);
    await pool.query('DELETE FROM tasks WHERE id=$1',[recoveryTask.id]).catch(()=>undefined);
  }
  await pool.query('DELETE FROM inbox_events WHERE event_id=$1', [request.messageId]).catch(() => undefined);
  await pool.query('DELETE FROM conversation_surfaces WHERE corp_id=$1 AND user_id=$2', [user.corpId, user.userId]).catch(() => undefined);
  await pool.query('DELETE FROM user_memories WHERE corp_id=$1 AND user_id=$2', [user.corpId, user.userId]).catch(() => undefined);
  await pool.query('DELETE FROM users WHERE corp_id=$1 AND user_id=$2', [user.corpId, user.userId]).catch(() => undefined);
  await pool.end();
}
