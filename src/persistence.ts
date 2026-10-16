import type { ArtifactBudgetHistory } from './execution-budget.js';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { AgentRequest, ApprovalChallenge, ConversationSurface, StoredApproval, TaskRecord, TaskStatus, ToolInvocationRecord, UserIdentity, UserMemory } from './types.js';
import type { WorkflowState } from './task-workflow.js';
import { assertTaskRecoverySafe, TaskRecoveryError } from './task-recovery.js';
import type { TaskRecoveryRequest, RecoveryAudit } from './task-recovery.js';

export interface Repository {
  ping(): Promise<void>;
  prune(cutoff: Date): Promise<void>;
  listUserMemories(user: UserIdentity): Promise<UserMemory[]>;
  upsertUserMemory(user: UserIdentity, memory: UserMemory): Promise<void>;
  deleteUserMemory(user: UserIdentity, key: string): Promise<boolean>;
  ensureUser(user: UserIdentity): Promise<void>;
  setDwsProfile(user: UserIdentity, profileKey: string): Promise<void>;
  setZiniaoProfile(user: UserIdentity, profileKey: string): Promise<void>;
  ensureSurface(user: UserIdentity, surface: ConversationSurface): Promise<string>;
  getSurfaceThread(surfaceId: string): Promise<string | undefined>;
  setSurfaceThread(surfaceId: string, threadId: string): Promise<void>;
  resetSurfaceThread(surfaceId: string): Promise<void>;
  listRecentDirectContext(user: UserIdentity, surfaceId: string, beforeTaskId: string): Promise<Array<{ request: string; answer: string }>>;
  listRecentPublicGroupContext(user: UserIdentity, surfaceId: string, beforeTaskId: string): Promise<Array<{ request: string; answer: string }>>;
  createTask(request: AgentRequest, surfaceId: string): Promise<TaskRecord>;
  updateTask(id: string, status: TaskStatus, fields?: { threadId?: string; resultSummary?: string; resultVisibility?: 'surface' | 'private'; errorCode?: string }): Promise<void>;
  findTask(id: string): Promise<TaskRecord | undefined>;
  prepareTaskRecovery(id: string, input: TaskRecoveryRequest): Promise<TaskRecord>;
  findTaskByMessageReference(user: UserIdentity, surface: ConversationSurface, referenceId: string): Promise<TaskRecord | undefined>;
  setTaskCard(id: string, bizId: string): Promise<void>;
  setApprovalCard(id: string, bizId: string): Promise<void>;
  setClarificationCard(id: string, bizId: string): Promise<void>;
  findTaskByClarificationCard(user: {corpId?: string; userId: string}, bizId: string): Promise<TaskRecord | undefined>;
  consumeClarification(id: string, createdAt: string, answer: string, cancelled: boolean): Promise<boolean>;
  listRecoverableTasks(): Promise<TaskRecord[]>;
  saveApproval(challenge: ApprovalChallenge, method: string): Promise<void>;
  getApproval(taskId: string): Promise<StoredApproval | undefined>;
  listApprovals(taskId: string): Promise<StoredApproval[]>;
  decideApproval(taskId: string, status: 'approved' | 'cancelled' | 'expired'): Promise<void>;
  markApprovalExecuted(taskId: string): Promise<void>;
  getToolInvocation(idempotencyKey: string): Promise<ToolInvocationRecord | undefined>;
  beginToolInvocation(record: Omit<ToolInvocationRecord, 'status' | 'result'> & { toolName: string }): Promise<boolean>;
  finishToolInvocation(idempotencyKey: string, status: 'completed' | 'failed' | 'unknown', result?: unknown, errorMessage?: string): Promise<void>;
  markInbox(eventId: string, ttlMs: number): Promise<boolean>;
  audit(event: { requestId: string; taskId?: string; user: UserIdentity; surfaceId?: string; eventType: string; riskLevel?: string; toolName?: string; payload?: unknown }): Promise<void>;
  saveWorkflow(taskId: string, state: WorkflowState): Promise<void>;
  getWorkflow(taskId: string): Promise<WorkflowState | undefined>;
  getArtifactBudgetHistory(taskId: string): Promise<ArtifactBudgetHistory>;
  bindTaskExecutionMode(taskId: string, desired: 'local' | 'worker'): Promise<'local' | 'worker'>;
  saveTaskArtifact(taskId: string, artifact: { name: string; size: number; sha256: string }): Promise<void>;
  listTaskArtifacts(taskId: string): Promise<Array<{ name: string; size: number; sha256: string }>>;
  findPendingClarification(user: UserIdentity, surface: ConversationSurface): Promise<TaskRecord | undefined>;
  listPendingClarifications(): Promise<TaskRecord[]>;
}

export class InMemoryRepository implements Repository {
  private users = new Set<string>();
  private surfaces = new Map<string, { id: string; type: ConversationSurface['type']; threadId?: string; contextResetAt?: number }>();
  private tasks = new Map<string, TaskRecord>();
  private events = new Map<string, number>();
  private approvals = new Map<string, StoredApproval>();
  private approvalHistory = new Map<string, StoredApproval[]>();
  private invocations = new Map<string, ToolInvocationRecord & {toolName: string}>();
  private memories = new Map<string, Map<string, UserMemory>>();
  private workflows = new Map<string, WorkflowState>();
  private artifacts = new Map<string, Array<{ name: string; size: number; sha256: string }>>();
  private executionModes = new Map<string, 'local' | 'worker'>();
  public audits: unknown[] = [];

  public async ping(): Promise<void> {}

  public async prune(cutoff: Date): Promise<void> {
    const removed = new Set(
      [...this.tasks.values()]
        .filter((task) => ['completed', 'cancelled', 'failed'].includes(task.status) && task.createdAt < cutoff.getTime())
        .map((task) => task.id)
    );
    for (const taskId of removed) {
      this.tasks.delete(taskId);
      this.approvals.delete(taskId);
      this.approvalHistory.delete(taskId);
      this.workflows.delete(taskId);
      this.artifacts.delete(taskId);
      this.executionModes.delete(taskId);
    }
    for (const [key, invocation] of this.invocations) {
      if (removed.has(invocation.taskId)) this.invocations.delete(key);
    }
    const now = Date.now();
    for (const [eventId, expiresAt] of this.events) {
      if (expiresAt <= now) this.events.delete(eventId);
    }
    for (const values of this.memories.values()) {
      for (const [key, memory] of values) {
        if (memory.expiresAt && memory.expiresAt <= now) values.delete(key);
      }
    }
  }

  public async listUserMemories(user: UserIdentity): Promise<UserMemory[]> {
    const values = this.memories.get(user.corpId + ':' + user.userId);
    if (!values) return [];
    const now = Date.now();
    return [...values.values()].filter((memory) => !memory.expiresAt || memory.expiresAt > now).slice(0, 50);
  }

  public async upsertUserMemory(user: UserIdentity, memory: UserMemory): Promise<void> {
    const userKey = user.corpId + ':' + user.userId;
    let values = this.memories.get(userKey);
    if (!values) {
      values = new Map();
      this.memories.set(userKey, values);
    }
    if (!values.has(memory.key) && values.size >= 50) throw new Error('MEMORY_LIMIT_REACHED');
    values.set(memory.key, { ...memory });
  }

  public async deleteUserMemory(user: UserIdentity, key: string): Promise<boolean> {
    return this.memories.get(user.corpId + ':' + user.userId)?.delete(key) ?? false;
  }

  public async ensureUser(user: UserIdentity): Promise<void> {
    this.users.add(user.corpId + ':' + user.userId);
  }

  public async setDwsProfile(_user: UserIdentity, _profileKey: string): Promise<void> {}

  public async setZiniaoProfile(_user: UserIdentity, _profileKey: string): Promise<void> {}

  public async ensureSurface(user: UserIdentity, surface: ConversationSurface): Promise<string> {
    const key = [user.corpId, user.userId, surface.type, surface.id].join(':');
    let record = this.surfaces.get(key);
    if (!record) {
      record = { id: randomUUID(), type: surface.type };
      this.surfaces.set(key, record);
    }
    return record.id;
  }

  public async getSurfaceThread(surfaceId: string): Promise<string | undefined> {
    return [...this.surfaces.values()].find((item) => item.id === surfaceId)?.threadId;
  }

  public async setSurfaceThread(surfaceId: string, threadId: string): Promise<void> {
    const record = [...this.surfaces.values()].find((item) => item.id === surfaceId);
    if (record) record.threadId = threadId;
  }

  public async resetSurfaceThread(surfaceId: string): Promise<void> {
    const record = [...this.surfaces.values()].find((item) => item.id === surfaceId);
    if (record) {
      delete record.threadId;
      record.contextResetAt = Date.now();
    }
  }

  public async listRecentDirectContext(user: UserIdentity, surfaceId: string, beforeTaskId: string): Promise<Array<{ request: string; answer: string }>> {
    const surface = [...this.surfaces.values()].find((item) => item.id === surfaceId);
    if (!surface || surface.type !== 'direct') return [];
    const current = this.tasks.get(beforeTaskId);
    if (!current || current.request.surface.type !== 'direct') return [];
    return [...this.tasks.values()].filter((task) => task.id !== beforeTaskId && task.request.surface.type === 'direct'
      && task.request.user.corpId === user.corpId && task.request.user.userId === user.userId
      && task.request.surface.id === current?.request.surface.id && task.status === 'completed'
      && task.resultSummary && task.createdAt > (surface.contextResetAt ?? 0))
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, 2).reverse()
      .map((task) => ({ request: task.request.text.slice(0, 1000), answer: task.resultSummary!.slice(0, 1500) }));
  }

  public async listRecentPublicGroupContext(user: UserIdentity, surfaceId: string, beforeTaskId: string): Promise<Array<{ request: string; answer: string }>> {
    const surface = [...this.surfaces.values()].find((item) => item.id === surfaceId);
    const current = this.tasks.get(beforeTaskId);
    if (!surface || surface.type !== 'group' || !current || current.request.surface.type !== 'group') return [];
    return [...this.tasks.values()].filter((task) => task.id !== beforeTaskId && task.request.surface.type === 'group'
      && task.request.user.corpId === user.corpId && task.request.user.userId === user.userId
      && task.request.surface.id === current.request.surface.id && task.status === 'completed'
      && task.resultVisibility === 'surface' && task.resultSummary
      && task.createdAt > (surface.contextResetAt ?? 0))
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, 2).reverse()
      .map((task) => ({ request: task.request.text.slice(0, 1000), answer: task.resultSummary!.slice(0, 1500) }));
  }

  public async createTask(request: AgentRequest, surfaceId: string): Promise<TaskRecord> {
    const task: TaskRecord = { id: randomUUID(), request, status: 'queued', createdAt: Date.now() };
    this.tasks.set(task.id, task);
    return task;
  }

  public async updateTask(id: string, status: TaskStatus, fields: { threadId?: string; resultSummary?: string; resultVisibility?: 'surface' | 'private'; errorCode?: string } = {}): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = status;
    if (fields.threadId) task.threadId = fields.threadId;
    if (fields.resultSummary) task.resultSummary = fields.resultSummary;
    if (fields.resultVisibility) task.resultVisibility = fields.resultVisibility;
    if (fields.errorCode) task.errorCode = fields.errorCode;
  }

  public async findTask(id: string): Promise<TaskRecord | undefined> {
    return this.tasks.get(id);
  }

  public async prepareTaskRecovery(id: string, input: TaskRecoveryRequest): Promise<TaskRecord> {
    const task = this.tasks.get(id);
    const workflow = this.workflows.get(id);
    const audits = (this.audits as Array<RecoveryAudit & {taskId?:string}>).filter(event => event.taskId === id);
    const protectedState = Boolean(this.approvals.get(id) || this.approvalHistory.get(id)?.length
      || [...this.invocations.values()].some(item => item.taskId === id) || this.artifacts.get(id)?.length);
    assertTaskRecoverySafe(task,input,workflow,audits,protectedState);
    const previousError = task.errorCode!;
    const recovery = {requestId:input.requestId,requestedAt:new Date().toISOString(),previousError};
    workflow!.manualRecoveries = [...(workflow!.manualRecoveries ?? []),recovery];
    task.status = 'queued';
    delete task.errorCode;
    this.audits.push({requestId:input.requestId,taskId:id,user:input.user,eventType:'task.recovery_requested',payload:recovery});
    return task;
  }

  public async findTaskByMessageReference(user: UserIdentity, surface: ConversationSurface, referenceId: string): Promise<TaskRecord | undefined> {
    return [...this.tasks.values()]
      .filter((task) => task.request.user.corpId === user.corpId
        && task.request.user.userId === user.userId
        && task.request.surface.type === surface.type
        && task.request.surface.id === surface.id
        && [task.request.messageId, task.cardBizId, task.approvalCardBizId, task.clarificationCardBizId].includes(referenceId))
      .sort((left, right) => right.createdAt - left.createdAt)[0];
  }

  public async saveWorkflow(taskId: string, state: WorkflowState): Promise<void> { this.workflows.set(taskId, structuredClone(state)); }
  public async bindTaskExecutionMode(taskId: string, desired: 'local' | 'worker'): Promise<'local' | 'worker'> {
    const existing = this.executionModes.get(taskId);
    if (existing) return existing;
    this.executionModes.set(taskId, desired);
    return desired;
  }
  public async saveTaskArtifact(taskId: string, artifact: { name: string; size: number; sha256: string }): Promise<void> {
    const entries = this.artifacts.get(taskId) ?? [];
    if (!entries.some((entry) => entry.name === artifact.name && entry.sha256 === artifact.sha256)) entries.push({ ...artifact });
    this.artifacts.set(taskId, entries);
  }
  public async listTaskArtifacts(taskId: string): Promise<Array<{ name: string; size: number; sha256: string }>> {
    return (this.artifacts.get(taskId) ?? []).map((entry) => ({ ...entry }));
  }
  public async getWorkflow(taskId: string): Promise<WorkflowState | undefined> { return structuredClone(this.workflows.get(taskId)); }
  public async getArtifactBudgetHistory(taskId: string): Promise<ArtifactBudgetHistory> {
    return {calls: (this.audits as Array<ArtifactBudgetHistory['calls'][number] & {taskId?:string}>)
      .filter(event => event.taskId === taskId && ['tool.call_started','tool.call_finished'].includes(event.eventType)
        && event.payload?.namespace === 'artifact' && ['render_document','revise_document','submit'].includes(event.payload?.tool ?? '')),
      deliveryAttempts: [...this.invocations.values()].filter(item => item.taskId === taskId && item.toolName === 'artifact.send').length};
  }

  public async findPendingClarification(user: UserIdentity, surface: ConversationSurface): Promise<TaskRecord | undefined> {
    return [...this.tasks.values()].find((task) => task.status === 'waiting_clarification' && task.request.user.corpId === user.corpId && task.request.user.userId === user.userId && task.request.surface.type === surface.type && task.request.surface.id === surface.id);
  }
  public async listPendingClarifications(): Promise<TaskRecord[]> { return [...this.tasks.values()].filter((task) => task.status === 'waiting_clarification'); }

  public async setTaskCard(id: string, bizId: string): Promise<void> {
    const task = this.tasks.get(id);
    if (task) task.cardBizId = bizId;
  }

  public async setApprovalCard(id: string, bizId: string): Promise<void> {
    const task = this.tasks.get(id);
    if (task && !task.approvalCardBizId) task.approvalCardBizId = bizId;
  }

  public async setClarificationCard(id: string, bizId: string): Promise<void> {
    const task = this.tasks.get(id);
    if (task) task.clarificationCardBizId = bizId;
  }

  public async findTaskByClarificationCard(user: {corpId?: string; userId: string}, bizId: string): Promise<TaskRecord | undefined> {
    return [...this.tasks.values()].find((task) => task.clarificationCardBizId === bizId
      && (!user.corpId || task.request.user.corpId === user.corpId) && task.request.user.userId === user.userId);
  }

  public async consumeClarification(id: string, createdAt: string, answer: string, cancelled: boolean): Promise<boolean> {
    const task = this.tasks.get(id);
    const state = this.workflows.get(id);
    const question = state?.clarification;
    if (task?.status !== 'waiting_clarification' || !question || question.answer || question.createdAt !== createdAt || Date.parse(question.expiresAt) <= Date.now()) return false;
    question.answer = answer;
    task.status = cancelled ? 'cancelled' : 'queued';
    return true;
  }

  public async listRecoverableTasks(): Promise<TaskRecord[]> {
    return [...this.tasks.values()].filter((task) => ['queued', 'running', 'waiting_oauth', 'waiting_confirmation'].includes(task.status));
  }

  public async saveApproval(challenge: ApprovalChallenge, method: string): Promise<void> {
    const previous = this.approvals.get(challenge.taskId);
    if (previous && ['pending', 'approved'].includes(previous.status)) previous.status = 'cancelled';
    const approval: StoredApproval = { challenge, method, status: 'pending' };
    this.approvals.set(challenge.taskId, approval);
    const history = this.approvalHistory.get(challenge.taskId) ?? [];
    history.push(approval);
    this.approvalHistory.set(challenge.taskId, history);
  }

  public async getApproval(taskId: string): Promise<StoredApproval | undefined> {
    return this.approvals.get(taskId);
  }

  public async listApprovals(taskId: string): Promise<StoredApproval[]> {
    return [...(this.approvalHistory.get(taskId) ?? [])];
  }

  public async decideApproval(taskId: string, status: 'approved' | 'cancelled' | 'expired'): Promise<void> {
    const value = this.approvals.get(taskId);
    if (value) value.status = status;
  }

  public async markApprovalExecuted(taskId: string): Promise<void> {
    const value = this.approvals.get(taskId);
    if (value) value.status = 'executed';
  }

  public async getToolInvocation(idempotencyKey: string): Promise<ToolInvocationRecord | undefined> {
    return this.invocations.get(idempotencyKey);
  }

  public async beginToolInvocation(record: Omit<ToolInvocationRecord, 'status' | 'result'> & { toolName: string }): Promise<boolean> {
    if (this.invocations.has(record.idempotencyKey)) return false;
    this.invocations.set(record.idempotencyKey, { ...record, status: 'started' });
    return true;
  }

  public async finishToolInvocation(idempotencyKey: string, status: 'completed' | 'failed' | 'unknown', result?: unknown): Promise<void> {
    const record = this.invocations.get(idempotencyKey);
    if (record) {
      record.status = status;
      if (result !== undefined) record.result = result;
    }
  }

  public async markInbox(eventId: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const expiry = this.events.get(eventId);
    if (expiry && expiry > now) return false;
    this.events.set(eventId, now + ttlMs);
    return true;
  }

  public async audit(event: { requestId: string; taskId?: string; user: UserIdentity; surfaceId?: string; eventType: string; riskLevel?: string; toolName?: string; payload?: unknown }): Promise<void> {
    this.audits.push(event);
  }
}

export class PgRepository implements Repository {
  public constructor(private readonly pool: Pool) {}

  public async prepareTaskRecovery(id: string, input: TaskRecoveryRequest): Promise<TaskRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [id]);
      const row = locked.rows[0];
      const task: TaskRecord | undefined = row ? {
        id:row.id,request:row.request_payload,status:row.status,createdAt:row.created_at.getTime(),
        ...(row.codex_thread_id ? {threadId:row.codex_thread_id} : {}),
        ...(row.card_biz_id ? {cardBizId:row.card_biz_id} : {}),
      ...(row.approval_card_biz_id ? {approvalCardBizId:row.approval_card_biz_id} : {}),
      ...(row.clarification_card_biz_id ? {clarificationCardBizId:row.clarification_card_biz_id} : {}),
        ...(row.result_summary ? {resultSummary:row.result_summary} : {}),
        ...(row.result_visibility !== 'unknown' ? {resultVisibility:row.result_visibility} : {}),
        ...(row.error_code ? {errorCode:row.error_code} : {})
      } : undefined;
      const saved = await client.query<{state:WorkflowState}>('SELECT state FROM task_workflows WHERE task_id=$1 FOR UPDATE',[id]);
      const workflow = saved.rows[0]?.state;
      const history = await client.query<{event_type:string;payload:Record<string,unknown>}>(
        'SELECT event_type,payload FROM audit_events WHERE task_id=$1 ORDER BY created_at,id',[id]);
      const protectedState = await client.query<{present:boolean}>(`SELECT
        EXISTS(SELECT 1 FROM approvals WHERE task_id=$1)
        OR EXISTS(SELECT 1 FROM tool_invocations WHERE task_id=$1)
        OR EXISTS(SELECT 1 FROM task_artifacts WHERE task_id=$1) AS present`,[id]);
      assertTaskRecoverySafe(task,input,workflow,history.rows.map(e=>({eventType:e.event_type,payload:e.payload})),
        protectedState.rows[0]?.present !== false);
      if (row.corp_id !== input.user.corpId || row.user_id !== input.user.userId) throw new TaskRecoveryError('TASK_RECOVERY_NOT_FOUND');
      const previousError = task.errorCode!;
      const recovery = {requestId:input.requestId,requestedAt:new Date().toISOString(),previousError};
      workflow!.manualRecoveries = [...(workflow!.manualRecoveries ?? []),recovery];
      const updated = await client.query(`UPDATE tasks SET status='queued',error_code=NULL,finished_at=NULL
        WHERE id=$1 AND status='failed' AND error_code=$2 AND corp_id=$3 AND user_id=$4`,
        [id,previousError,input.user.corpId,input.user.userId]);
      if (updated.rowCount !== 1) throw new TaskRecoveryError('TASK_RECOVERY_CONFLICT');
      await client.query('UPDATE task_workflows SET state=$2,updated_at=now() WHERE task_id=$1',[id,JSON.stringify(workflow)]);
      await client.query(`INSERT INTO audit_events(request_id,task_id,corp_id,user_id,surface_id,event_type,payload)
        VALUES($1,$2,$3,$4,$5,'task.recovery_requested',$6)`,
        [input.requestId,id,input.user.corpId,input.user.userId,row.surface_id,JSON.stringify(recovery)]);
      await client.query('COMMIT');
      task.status = 'queued';
      delete task.errorCode;
      return task;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  public async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  public async prune(cutoff: Date): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("DELETE FROM tool_invocations WHERE task_id IN (SELECT id FROM tasks WHERE status IN ('completed','cancelled','failed') AND created_at < $1)", [cutoff]);
      await client.query("DELETE FROM approvals WHERE task_id IN (SELECT id FROM tasks WHERE status IN ('completed','cancelled','failed') AND created_at < $1)", [cutoff]);
      await client.query("DELETE FROM audit_events WHERE created_at < $1", [cutoff]);
      await client.query("DELETE FROM tasks WHERE status IN ('completed','cancelled','failed') AND created_at < $1", [cutoff]);
      await client.query('DELETE FROM inbox_events WHERE expires_at < now()');
      await client.query('DELETE FROM user_memories WHERE expires_at IS NOT NULL AND expires_at < now()');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async listUserMemories(user: UserIdentity): Promise<UserMemory[]> {
    const result = await this.pool.query<{
      memory_key: string;
      memory_value: { text?: string } | string;
      expires_at: Date | null;
    }>(
      "SELECT memory_key,memory_value,expires_at FROM user_memories WHERE corp_id=$1 AND user_id=$2 AND sensitivity='normal' AND (expires_at IS NULL OR expires_at > now()) ORDER BY updated_at DESC LIMIT 50",
      [user.corpId, user.userId]
    );
    return result.rows.map((row) => ({
      key: row.memory_key,
      value: typeof row.memory_value === 'string' ? row.memory_value : String(row.memory_value?.text ?? ''),
      sensitivity: 'normal',
      ...(row.expires_at ? { expiresAt: row.expires_at.getTime() } : {})
    }));
  }

  public async upsertUserMemory(user: UserIdentity, memory: UserMemory): Promise<void> {
    const count = await this.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM user_memories WHERE corp_id=$1 AND user_id=$2 AND memory_key<>$3',
      [user.corpId, user.userId, memory.key]
    );
    if (Number(count.rows[0]?.count ?? 0) >= 50) throw new Error('MEMORY_LIMIT_REACHED');
    await this.pool.query(
      "INSERT INTO user_memories(corp_id,user_id,memory_key,memory_value,sensitivity,expires_at) VALUES($1,$2,$3,$4,'normal',$5) ON CONFLICT(corp_id,user_id,memory_key) DO UPDATE SET memory_value=EXCLUDED.memory_value,sensitivity='normal',expires_at=EXCLUDED.expires_at,updated_at=now()",
      [user.corpId, user.userId, memory.key, JSON.stringify({ text: memory.value }), memory.expiresAt ? new Date(memory.expiresAt) : null]
    );
  }

  public async deleteUserMemory(user: UserIdentity, key: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM user_memories WHERE corp_id=$1 AND user_id=$2 AND memory_key=$3', [user.corpId, user.userId, key]);
    return result.rowCount === 1;
  }

  public async ensureUser(user: UserIdentity): Promise<void> {
    await this.pool.query(
      'INSERT INTO users (corp_id,user_id,display_name) VALUES ($1,$2,$3) ON CONFLICT (corp_id,user_id) DO UPDATE SET display_name=COALESCE(EXCLUDED.display_name,users.display_name),updated_at=now()',
      [user.corpId, user.userId, user.displayName ?? null]
    );
  }

  public async setDwsProfile(user: UserIdentity, profileKey: string): Promise<void> {
    await this.pool.query(
      'UPDATE users SET dws_profile_key=$3,dws_authenticated_at=now(),updated_at=now() WHERE corp_id=$1 AND user_id=$2',
      [user.corpId, user.userId, profileKey]
    );
  }

  public async setZiniaoProfile(user: UserIdentity, profileKey: string): Promise<void> {
    await this.pool.query(
      'UPDATE users SET ziniao_profile_key=$3,ziniao_authenticated_at=now(),updated_at=now() WHERE corp_id=$1 AND user_id=$2',
      [user.corpId, user.userId, profileKey]
    );
  }

  public async ensureSurface(user: UserIdentity, surface: ConversationSurface): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      'INSERT INTO conversation_surfaces (corp_id,user_id,surface_type,surface_id,last_message_at) VALUES ($1,$2,$3,$4,now()) ON CONFLICT (corp_id,user_id,surface_type,surface_id) DO UPDATE SET last_message_at=now(),updated_at=now() RETURNING id',
      [user.corpId, user.userId, surface.type, surface.id]
    );
    return result.rows[0]!.id;
  }

  public async getSurfaceThread(surfaceId: string): Promise<string | undefined> {
    const result = await this.pool.query<{ codex_thread_id: string | null }>('SELECT codex_thread_id FROM conversation_surfaces WHERE id=$1', [surfaceId]);
    return result.rows[0]?.codex_thread_id ?? undefined;
  }

  public async setSurfaceThread(surfaceId: string, threadId: string): Promise<void> {
    await this.pool.query('UPDATE conversation_surfaces SET codex_thread_id=$2,updated_at=now() WHERE id=$1', [surfaceId, threadId]);
  }

  public async resetSurfaceThread(surfaceId: string): Promise<void> {
    await this.pool.query('UPDATE conversation_surfaces SET codex_thread_id=NULL,context_reset_at=now(),updated_at=now() WHERE id=$1', [surfaceId]);
  }

  public async listRecentDirectContext(user: UserIdentity, surfaceId: string, beforeTaskId: string): Promise<Array<{ request: string; answer: string }>> {
    const result = await this.pool.query<{ input_text: string; result_summary: string }>(
      `SELECT task.input_text,task.result_summary FROM tasks task
       JOIN conversation_surfaces surface ON surface.id=task.surface_id
       WHERE task.surface_id=$1 AND task.corp_id=$2 AND task.user_id=$3
         AND surface.surface_type='direct' AND task.id<>$4 AND task.status='completed'
         AND task.created_at>=surface.context_reset_at AND task.result_summary IS NOT NULL
       ORDER BY task.created_at DESC LIMIT 2`,
      [surfaceId, user.corpId, user.userId, beforeTaskId]
    );
    return result.rows.reverse().map((row) => ({ request: row.input_text.slice(0, 1000), answer: row.result_summary.slice(0, 1500) }));
  }

  public async listRecentPublicGroupContext(user: UserIdentity, surfaceId: string, beforeTaskId: string): Promise<Array<{ request: string; answer: string }>> {
    const result = await this.pool.query<{ input_text: string; result_summary: string }>(
      `SELECT task.input_text,task.result_summary FROM tasks task
       JOIN conversation_surfaces surface ON surface.id=task.surface_id
       WHERE task.surface_id=$1 AND task.corp_id=$2 AND task.user_id=$3
         AND surface.surface_type='group' AND task.id<>$4 AND task.status='completed'
         AND task.result_visibility='surface' AND task.created_at>=surface.context_reset_at
         AND task.result_summary IS NOT NULL
       ORDER BY task.created_at DESC LIMIT 2`,
      [surfaceId, user.corpId, user.userId, beforeTaskId]
    );
    return result.rows.reverse().map((row) => ({ request: row.input_text.slice(0, 1000), answer: row.result_summary.slice(0, 1500) }));
  }

  public async createTask(request: AgentRequest, surfaceId: string): Promise<TaskRecord> {
    const result = await this.pool.query<{ id: string; created_at: Date }>(
      'INSERT INTO tasks (corp_id,user_id,surface_id,status,input_text,request_payload) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,created_at',
      [request.user.corpId, request.user.userId, surfaceId, 'queued', request.text, JSON.stringify(request)]
    );
    return { id: result.rows[0]!.id, request, status: 'queued', createdAt: result.rows[0]!.created_at.getTime() };
  }

  public async updateTask(id: string, status: TaskStatus, fields: { threadId?: string; resultSummary?: string; resultVisibility?: 'surface' | 'private'; errorCode?: string } = {}): Promise<void> {
    await this.pool.query(
      "UPDATE tasks SET status=$2,codex_thread_id=COALESCE($3,codex_thread_id),result_summary=COALESCE($4,result_summary),error_code=COALESCE($5,error_code),result_visibility=COALESCE($6,result_visibility),started_at=CASE WHEN $2='running' AND started_at IS NULL THEN now() ELSE started_at END,finished_at=CASE WHEN $2 IN ('completed','failed','cancelled') THEN now() ELSE finished_at END WHERE id=$1",
      [id, status, fields.threadId ?? null, fields.resultSummary ?? null, fields.errorCode ?? null, fields.resultVisibility ?? null]
    );
  }

  public async findTask(id: string): Promise<TaskRecord | undefined> {
    const result = await this.pool.query<{
      id: string;
      request_payload: AgentRequest;
      status: TaskStatus;
      created_at: Date;
      codex_thread_id: string | null;
      card_biz_id: string | null;
      approval_card_biz_id: string | null;
      clarification_card_biz_id: string | null;
      result_summary: string | null;
      result_visibility: 'surface' | 'private' | 'unknown';
      error_code: string | null;
    }>('SELECT id,request_payload,status,created_at,codex_thread_id,card_biz_id,approval_card_biz_id,clarification_card_biz_id,result_summary,result_visibility,error_code FROM tasks WHERE id=$1', [id]);
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      request: row.request_payload,
      status: row.status,
      createdAt: row.created_at.getTime(),
      ...(row.codex_thread_id ? { threadId: row.codex_thread_id } : {}),
      ...(row.card_biz_id ? { cardBizId: row.card_biz_id } : {}),
      ...(row.approval_card_biz_id ? { approvalCardBizId: row.approval_card_biz_id } : {}),
      ...(row.clarification_card_biz_id ? { clarificationCardBizId: row.clarification_card_biz_id } : {}),
      ...(row.result_summary ? { resultSummary: row.result_summary } : {}),
      ...(row.result_visibility !== 'unknown' ? { resultVisibility: row.result_visibility } : {}),
      ...(row.error_code ? { errorCode: row.error_code } : {})
    };
  }

  public async findTaskByMessageReference(user: UserIdentity, surface: ConversationSurface, referenceId: string): Promise<TaskRecord | undefined> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT t.id
       FROM tasks t
       JOIN conversation_surfaces s ON s.id=t.surface_id
       WHERE t.corp_id=$1 AND t.user_id=$2
         AND s.surface_type=$3 AND s.surface_id=$4
         AND (
           t.request_payload->>'messageId'=$5
           OR t.card_biz_id=$5
           OR t.approval_card_biz_id=$5
           OR t.clarification_card_biz_id=$5
         )
       ORDER BY t.created_at DESC
       LIMIT 1`,
      [user.corpId, user.userId, surface.type, surface.id, referenceId]
    );
    return result.rows[0] ? this.findTask(result.rows[0].id) : undefined;
  }

  public async saveWorkflow(taskId: string, state: WorkflowState): Promise<void> {
    await this.pool.query('INSERT INTO task_workflows(task_id,state) VALUES ($1,$2) ON CONFLICT (task_id) DO UPDATE SET state=EXCLUDED.state,updated_at=now()', [taskId, JSON.stringify(state)]);
  }

  public async bindTaskExecutionMode(taskId: string, desired: 'local' | 'worker'): Promise<'local' | 'worker'> {
    const result = await this.pool.query<{ mode: 'local' | 'worker' }>(
      'INSERT INTO task_execution_modes(task_id,mode) VALUES ($1,$2) ON CONFLICT (task_id) DO UPDATE SET mode=task_execution_modes.mode RETURNING mode',
      [taskId, desired]
    );
    return result.rows[0]!.mode;
  }

  public async saveTaskArtifact(taskId: string, artifact: { name: string; size: number; sha256: string }): Promise<void> {
    await this.pool.query('INSERT INTO task_artifacts(task_id,sha256,name,size_bytes) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [taskId, artifact.sha256, artifact.name, artifact.size]);
  }

  public async listTaskArtifacts(taskId: string): Promise<Array<{ name: string; size: number; sha256: string }>> {
    const result = await this.pool.query<{ name: string; size_bytes: string; sha256: string }>('SELECT name,size_bytes,sha256 FROM task_artifacts WHERE task_id=$1 ORDER BY created_at,name', [taskId]);
    return result.rows.map((row) => ({ name: row.name, size: Number(row.size_bytes), sha256: row.sha256 }));
  }

  public async getWorkflow(taskId: string): Promise<WorkflowState | undefined> {
    const result = await this.pool.query<{ state: WorkflowState }>('SELECT state FROM task_workflows WHERE task_id=$1', [taskId]);
    return result.rows[0]?.state;
  }

  public async getArtifactBudgetHistory(taskId: string): Promise<ArtifactBudgetHistory> {
    const result = await this.pool.query<{event_type:string; payload: NonNullable<ArtifactBudgetHistory['calls'][number]['payload']>}>(
      `SELECT event_type, json_build_object('namespace',payload->>'namespace','tool',payload->>'tool','argumentHash',payload->>'argumentHash') AS payload
       FROM audit_events WHERE task_id=$1 AND event_type IN ('tool.call_started','tool.call_finished')
       AND payload->>'namespace'='artifact' AND payload->>'tool' IN ('render_document','revise_document','submit') ORDER BY id`, [taskId]);
    const attempts = await this.pool.query<{count:string}>(
      "SELECT count(*)::text AS count FROM tool_invocations WHERE task_id=$1 AND tool_name='artifact.send'", [taskId]);
    return {calls:result.rows.map(row => ({eventType:row.event_type,payload:row.payload})), deliveryAttempts:Number(attempts.rows[0]!.count)};
  }

  public async findPendingClarification(user: UserIdentity, surface: ConversationSurface): Promise<TaskRecord | undefined> {
    const result = await this.pool.query<{ id: string }>("SELECT t.id FROM tasks t JOIN conversation_surfaces s ON s.id=t.surface_id WHERE t.corp_id=$1 AND t.user_id=$2 AND s.surface_type=$3 AND s.surface_id=$4 AND t.status='waiting_clarification' ORDER BY t.created_at DESC LIMIT 1", [user.corpId, user.userId, surface.type, surface.id]);
    return result.rows[0] ? this.findTask(result.rows[0].id) : undefined;
  }

  public async listPendingClarifications(): Promise<TaskRecord[]> {
    const result = await this.pool.query<{ id: string }>("SELECT id FROM tasks WHERE status='waiting_clarification'");
    return (await Promise.all(result.rows.map((row) => this.findTask(row.id)))).filter((task): task is TaskRecord => Boolean(task));
  }

  public async setTaskCard(id: string, bizId: string): Promise<void> {
    await this.pool.query('UPDATE tasks SET card_biz_id=$2 WHERE id=$1 AND card_biz_id IS NULL', [id, bizId]);
  }

  public async setApprovalCard(id: string, bizId: string): Promise<void> {
    await this.pool.query('UPDATE tasks SET approval_card_biz_id=$2 WHERE id=$1 AND approval_card_biz_id IS NULL', [id, bizId]);
  }

  public async setClarificationCard(id: string, bizId: string): Promise<void> {
    await this.pool.query('UPDATE tasks SET clarification_card_biz_id=$2 WHERE id=$1', [id, bizId]);
  }

  public async findTaskByClarificationCard(user: {corpId?: string; userId: string}, bizId: string): Promise<TaskRecord | undefined> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT t.id FROM tasks t
       WHERE ($1::text IS NULL OR t.corp_id=$1) AND t.user_id=$2 AND t.clarification_card_biz_id=$3
       LIMIT 1`, [user.corpId ?? null, user.userId, bizId]);
    return result.rows[0] ? this.findTask(result.rows[0].id) : undefined;
  }

  public async consumeClarification(id: string, createdAt: string, answer: string, cancelled: boolean): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT status FROM tasks WHERE id=$1 FOR UPDATE', [id]);
      const saved = await client.query<{state: WorkflowState}>('SELECT state FROM task_workflows WHERE task_id=$1 FOR UPDATE', [id]);
      const state = saved.rows[0]?.state;
      const question = state?.clarification;
      if (locked.rows[0]?.status !== 'waiting_clarification' || !question || question.answer || question.createdAt !== createdAt || Date.parse(question.expiresAt) <= Date.now()) {
        await client.query('ROLLBACK'); return false;
      }
      question.answer = answer;
      await client.query('UPDATE task_workflows SET state=$2,updated_at=now() WHERE task_id=$1', [id, JSON.stringify(state)]);
      await client.query('UPDATE tasks SET status=$2 WHERE id=$1', [id, cancelled ? 'cancelled' : 'queued']);
      await client.query('COMMIT'); return true;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  public async listRecoverableTasks(): Promise<TaskRecord[]> {
    const result = await this.pool.query<{
      id: string;
      request_payload: AgentRequest;
      status: TaskStatus;
      created_at: Date;
      codex_thread_id: string | null;
      card_biz_id: string | null;
      approval_card_biz_id: string | null;
      clarification_card_biz_id: string | null;
    }>("SELECT id,request_payload,status,created_at,codex_thread_id,card_biz_id,approval_card_biz_id,clarification_card_biz_id FROM tasks WHERE status IN ('queued','running','waiting_oauth','waiting_confirmation') ORDER BY created_at");
    return result.rows.map((row) => ({
      id: row.id,
      request: row.request_payload,
      status: row.status,
      createdAt: row.created_at.getTime(),
      ...(row.codex_thread_id ? { threadId: row.codex_thread_id } : {}),
      ...(row.card_biz_id ? { cardBizId: row.card_biz_id } : {}),
      ...(row.approval_card_biz_id ? { approvalCardBizId: row.approval_card_biz_id } : {}),
      ...(row.clarification_card_biz_id ? { clarificationCardBizId: row.clarification_card_biz_id } : {})
    }));
  }

  public async saveApproval(challenge: ApprovalChallenge, method: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE approvals SET status='cancelled' WHERE task_id=$1 AND status IN ('pending','approved')", [challenge.taskId]);
      await client.query(
        "INSERT INTO approvals(id,task_id,corp_id,user_id,action_type,target_summary,parameter_hash,action_payload,method,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10)",
        [challenge.challengeId ?? randomUUID(), challenge.taskId, challenge.user.corpId, challenge.user.userId, challenge.action.name, challenge.action.target ?? '', challenge.parameterHash, JSON.stringify(challenge.action), method, new Date(challenge.expiresAt)]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async getApproval(taskId: string): Promise<StoredApproval | undefined> {
    const result = await this.pool.query<{
      id: string;
      corp_id: string;
      user_id: string;
      action_payload: ApprovalChallenge['action'];
      parameter_hash: string;
      expires_at: Date;
      method: string;
      status: StoredApproval['status'];
    }>('SELECT id,corp_id,user_id,action_payload,parameter_hash,expires_at,method,status FROM approvals WHERE task_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [taskId]);
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      challenge: {
        challengeId: row.id,
        taskId,
        user: { corpId: row.corp_id, userId: row.user_id },
        action: row.action_payload,
        parameterHash: row.parameter_hash,
        expiresAt: row.expires_at.getTime()
      },
      method: row.method,
      status: row.status
    };
  }

  public async listApprovals(taskId: string): Promise<StoredApproval[]> {
    const result = await this.pool.query<{
      id: string; corp_id: string; user_id: string; action_payload: ApprovalChallenge['action'];
      parameter_hash: string; expires_at: Date; method: string; status: StoredApproval['status'];
    }>('SELECT id,corp_id,user_id,action_payload,parameter_hash,expires_at,method,status FROM approvals WHERE task_id=$1 ORDER BY created_at,id', [taskId]);
    return result.rows.map((row) => ({
      challenge: { challengeId: row.id, taskId, user: { corpId: row.corp_id, userId: row.user_id },
        action: row.action_payload, parameterHash: row.parameter_hash, expiresAt: row.expires_at.getTime() },
      method: row.method,
      status: row.status
    }));
  }

  public async decideApproval(taskId: string, status: 'approved' | 'cancelled' | 'expired'): Promise<void> {
    await this.pool.query(
      "UPDATE approvals SET status=$2,approved_at=CASE WHEN $2='approved' THEN now() ELSE approved_at END WHERE id=(SELECT id FROM approvals WHERE task_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1) AND status IN ('pending','approved')",
      [taskId, status]
    );
  }

  public async markApprovalExecuted(taskId: string): Promise<void> {
    await this.pool.query("UPDATE approvals SET status='executed',consumed_at=now() WHERE id=(SELECT id FROM approvals WHERE task_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1) AND status='approved'", [taskId]);
  }

  public async getToolInvocation(idempotencyKey: string): Promise<ToolInvocationRecord | undefined> {
    const result = await this.pool.query<{
      idempotency_key: string;
      task_id: string;
      action_hash: string;
      status: ToolInvocationRecord['status'];
      result: unknown;
    }>('SELECT idempotency_key,task_id,action_hash,status,result FROM tool_invocations WHERE idempotency_key=$1', [idempotencyKey]);
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      idempotencyKey: row.idempotency_key,
      taskId: row.task_id,
      actionHash: row.action_hash,
      status: row.status,
      ...(row.result !== null ? { result: row.result } : {})
    };
  }

  public async beginToolInvocation(record: Omit<ToolInvocationRecord, 'status' | 'result'> & { toolName: string }): Promise<boolean> {
    const result = await this.pool.query(
      "INSERT INTO tool_invocations(idempotency_key,task_id,action_hash,tool_name,status) VALUES($1,$2,$3,$4,'started') ON CONFLICT DO NOTHING",
      [record.idempotencyKey, record.taskId, record.actionHash, record.toolName]
    );
    return result.rowCount === 1;
  }

  public async finishToolInvocation(idempotencyKey: string, status: 'completed' | 'failed' | 'unknown', result?: unknown, errorMessage?: string): Promise<void> {
    await this.pool.query(
      'UPDATE tool_invocations SET status=$2,result=$3,error_message=$4,updated_at=now() WHERE idempotency_key=$1',
      [idempotencyKey, status, result === undefined ? null : JSON.stringify(result), errorMessage ?? null]
    );
  }

  public async markInbox(eventId: string, ttlMs: number): Promise<boolean> {
    const result = await this.pool.query(
      'INSERT INTO inbox_events(event_id,expires_at) VALUES ($1,now()+($2::text)::interval) ON CONFLICT DO NOTHING',
      [eventId, Math.ceil(ttlMs / 1000) + ' seconds']
    );
    return result.rowCount === 1;
  }

  public async audit(event: { requestId: string; taskId?: string; user: UserIdentity; surfaceId?: string; eventType: string; riskLevel?: string; toolName?: string; payload?: unknown }): Promise<void> {
    await this.pool.query(
      'INSERT INTO audit_events(request_id,task_id,corp_id,user_id,surface_id,event_type,risk_level,tool_name,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [event.requestId, event.taskId ?? null, event.user.corpId, event.user.userId, event.surfaceId ?? null, event.eventType, event.riskLevel ?? null, event.toolName ?? null, JSON.stringify(event.payload ?? {})]
    );
  }
}
