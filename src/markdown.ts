import type { AgentRequest, ApprovalChallenge, ConversationSurface, TaskRecord } from './types.js';

function escapeText(value: string): string {
  return value.replace(/[\\\\*_{}[\\]()#+.!<>|]/g, '\\\\$&');
}

export function accepted(task: TaskRecord): string {
  return [
    '### 已受理',
    '',
    '- 任务编号：' + task.id,
    '- 当前状态：排队中',
    '- 来源：' + (task.request.surface.type === 'group' ? '群聊' : '私聊'),
    '',
    '任务执行期间可发送 `取消 ' + task.id + '`。'
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

export function confirmation(challenge: ApprovalChallenge): string {
  const parameters = JSON.stringify(challenge.action.parameters ?? '未指定', (key, value) => {
    if (/token|secret|password|credential|api.?key|authorization/i.test(key)) return '[已隐藏]';
    return value;
  });
  const impact = challenge.action.risk === 'high'
    ? '高风险操作；确认后将按上述参数执行，可能产生不可逆或对他人可见的影响。'
    : '确认后将按上述参数写入或变更目标资源。';
  return [
    '### 等待确认',
    '',
    '- 任务编号：' + challenge.taskId,
    '- 操作：' + escapeText(challenge.action.name),
    '- 目标：' + escapeText(challenge.action.target ?? '未指定'),
    '- 参数：' + escapeText(parameters),
    '- 影响：' + impact,
    '- 有效期：' + new Date(challenge.expiresAt).toLocaleString('zh-CN'),
    '',
    '确认请回复 `确认 ' + challenge.taskId + '`。',
    '取消请回复 `取消 ' + challenge.taskId + '`。'
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

export function cancelled(taskId: string): string {
  return '### 已取消\n\n任务编号：' + taskId + '\n\n已停止后续执行。';
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
