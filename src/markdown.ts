import type { AgentRequest, ApprovalChallenge, ConversationSurface, TaskRecord } from './types.js';
import { defaultImpact, fallbackSummary } from './action-summarizer.js';

function escapeText(value: string): string {
  return value.replace(/[\\\\*_{}[\\]()#+.!<>|]/g, '\\\\$&');
}

/** Business-language content for the interactive approval card. */
function confirmationBody(challenge: ApprovalChallenge): string[] {
  const summary = challenge.action.summary ?? fallbackSummary(challenge.action);
  const impact = summary.impact ?? defaultImpact(challenge.action);
  const lines = [
    escapeText(summary.description),
    '',
    '- 影响：' + escapeText(impact),
    ...(summary.details ?? []).map((item) => '- ' + escapeText(item))
  ];
  return lines;
}

export function accepted(task: TaskRecord): string {
  return [
    '### 已受理',
    '',
    '- 任务编号：' + task.id,
    '- 当前状态：排队中',
    '- 来源：' + (task.request.surface.type === 'group' ? '群聊' : '私聊'),
    '',
    '如需停止任务，请引用这条任务消息后发送 `取消`；无需复制任务编号。'
  ].join('\n');
}

export function progress(taskId: string, stage: string): string {
  return '### 处理中 · ' + taskId + '\n\n当前阶段：' + escapeText(stage);
}

export function needOAuth(reason: string): string {
  return [
    '### 需要用户授权',
    '',
    escapeText(reason),
    '',
    '请等待机器人私聊发送一次性 DWS 设备授权链接。授权完成后，原任务会自动继续。',
    '',
    '> 授权仅绑定当前聊天用户，不要把验证码或链接转发给其他人。'
  ].join('\n');
}

/** Body of the interactive approval card (agree/reject buttons). */
export function approvalCardContent(challenge: ApprovalChallenge): string {
  const riskLabel = challenge.action.risk === 'high' ? '⚠️ 高风险操作确认' : '操作确认';
  const minutes = Math.max(1, Math.round((challenge.expiresAt - Date.now()) / 60000));
  return [
    '**' + riskLabel + '**',
    '',
    ...confirmationBody(challenge),
    '',
    '仅任务发起人点击有效。请在 ' + minutes + ' 分钟内确认；超时将自动取消，任务会按未执行处理。'
  ].join('\n');
}

export function completed(_taskId: string, result: string): string {
  return result;
}

export function failed(taskId: string, message: string): string {
  return [
    '### 执行失败',
    '',
    '- 任务编号：' + taskId,
    '- 原因：' + escapeText(message),
    '',
    '如果任务没有产生写入，可以修改参数后重新发送。'
  ].join('\n');
}

export function cancelled(_taskId: string): string {
  return '### 已取消\n\n已停止后续执行。';
}

export function route(surface: ConversationSurface, body: string): { surface: ConversationSurface; body: string } {
  return { surface, body };
}

export function summarizeInput(request: AgentRequest): string {
  const attachments = request.attachments.length > 0
    ? '\n附件：' + request.attachments.map((item) => item.name).join('、')
    : '';
  return request.text + attachments;
}
