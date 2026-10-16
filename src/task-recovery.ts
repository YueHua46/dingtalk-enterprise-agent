import { capabilityById } from './capability-catalog.js';
import type { WorkflowState } from './task-workflow.js';
import type { ConversationSurface, TaskRecord, UserIdentity } from './types.js';

export interface TaskRecoveryRequest {
  requestId: string;
  user: UserIdentity;
  surface: ConversationSurface;
}

export interface RecoveryAudit {
  eventType: string;
  payload?: Record<string, unknown>;
}

export class TaskRecoveryError extends Error {
  constructor(public readonly code: string) { super(code); }
}

function deny(code: string): never { throw new TaskRecoveryError(code); }

/** Only task-local computation and read capabilities may precede a recovery.
 * Report submission is allowed through its normal review/delivery gates. */
export function recoveryToolAllowed(namespace: string, tool: string, capabilityId?: string): boolean {
  if (namespace === 'agent' && ['workflow', 'capabilities'].includes(tool)) return true;
  if (namespace === 'artifact' && ['record_read', 'render_document', 'revise_document', 'submit'].includes(tool)) return true;
  return Boolean(capabilityId && capabilityById(capabilityId)?.risk === 'read');
}

export function assertTaskRecoverySafe(task: TaskRecord | undefined, input: TaskRecoveryRequest,
  workflow: WorkflowState | undefined, audits: RecoveryAudit[], protectedState: boolean): asserts task is TaskRecord {
  if (!task || task.request.user.corpId !== input.user.corpId || task.request.user.userId !== input.user.userId
    || task.request.surface.type !== input.surface.type || task.request.surface.id !== input.surface.id) deny('TASK_RECOVERY_NOT_FOUND');
  if (task.status !== 'failed') deny('TASK_RECOVERY_NOT_FAILED');
  if (!task.errorCode || !/(?:MODEL_REQUEST_RETRY_(?:EXHAUSTED|BUDGET_EXCEEDED)|model_upstream_unavailable|stream closed before response\.completed|stream disconnected before completion)/i.test(task.errorCode)) deny('TASK_RECOVERY_NOT_MODEL_FAILURE');
  if (!workflow || !task.threadId || !workflow.evidenceFiles?.length || workflow.contract?.mode === 'write') deny('TASK_RECOVERY_NO_READ_CHECKPOINT');
  if (workflow.manualRecoveries?.some(item => item.requestId === input.requestId)) deny('TASK_RECOVERY_DUPLICATE');
  if (protectedState || workflow.completion || workflow.ziniao?.screenshotDeliveries.length) deny('TASK_RECOVERY_SIDE_EFFECT_STATE');
  if (workflow.evidence.some(item => capabilityById(item.capabilityId)?.risk !== 'read'
    && !(item.capabilityId === 'artifact.submit' && item.status === 'failed'))) deny('TASK_RECOVERY_UNSAFE_EVIDENCE');
  if (Object.values(workflow.toolCheckpoints ?? {}).some(item => capabilityById(item.capabilityId)?.risk !== 'read')) deny('TASK_RECOVERY_UNSAFE_CHECKPOINT');
  const pending = new Map<string, number>();
  for (const audit of audits) {
    if (['artifact.submitted', 'artifact.delivered', 'task.completed', 'codex.tool_event'].includes(audit.eventType)) deny('TASK_RECOVERY_SIDE_EFFECT_STATE');
    if (!['tool.call_started', 'tool.call_finished'].includes(audit.eventType)) continue;
    const p = audit.payload ?? {};
    if (!recoveryToolAllowed(String(p.namespace ?? ''), String(p.tool ?? ''), typeof p.capabilityId === 'string' ? p.capabilityId : undefined)) deny('TASK_RECOVERY_UNSAFE_TOOL');
    const key = JSON.stringify([p.namespace, p.tool, p.argumentHash]);
    pending.set(key, (pending.get(key) ?? 0) + (audit.eventType === 'tool.call_started' ? 1 : -1));
  }
  if (!audits.some(item => item.eventType === 'tool.call_finished') || [...pending.values()].some(n => n !== 0)) deny('TASK_RECOVERY_UNKNOWN_TOOL_OUTCOME');
}

export function taskRecoveryPrompt(workflow: WorkflowState): string {
  return [
    '宿主已明确恢复原任务：从已保存检查点继续未完成的部分，不要从头重跑；本次仅允许读取、计算及经正常审核后的原会话文件交付。',
    '先读取本任务 evidence/index.json 和既有计算结果，保留原时间窗、数据口径及覆盖限制；除非现有证据确有缺口，不重新查询。',
    '证据索引：' + JSON.stringify(workflow.evidenceFiles ?? []),
    '已完成步骤：' + JSON.stringify(Object.values(workflow.toolCheckpoints ?? {}).map(c => ({capabilityId:c.capabilityId,evidenceId:c.evidenceId,completedAt:c.completedAt}))),
    '待修正的文件审核反馈：' + JSON.stringify(Object.values(workflow.artifactReviews ?? {}).filter(r => r.status === 'revise').map(r => ({reason:r.reason,issues:r.issues}))),
    '逐条修正已有审核问题，重新生成文件并调用 artifact.submit；宿主仍须完成内容审核和原会话投递，禁止声称已交付未经确认的文件。'
  ].join('\n');
}
