import type { ToolAction, RiskLevel } from './types.js';

const highRiskWords = ['删除', '权限', '审批', '批量', '群发', '撤销', '财务', '转账'];
const writeWords = ['创建', '更新', '修改', '发送', '编辑', '完成', '指派', '回复', '发起'];

export function classifyAction(action: ToolAction): RiskLevel {
  if (action.risk !== 'read') return action.risk;
  const text = [action.name, action.target ?? ''].join(' ');
  if (highRiskWords.some((word) => text.includes(word))) return 'high';
  if (writeWords.some((word) => text.includes(word))) return 'write';
  return 'read';
}

export function requiresConfirmation(risk: RiskLevel): boolean {
  return risk === 'write' || risk === 'high';
}

function escapeRegExp(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function isConfirmation(text: string, taskId: string): boolean {
  return new RegExp('^\\s*确认\\s+' + escapeRegExp(taskId) + '\\s*$').test(text);
}

export function isCancellation(text: string, taskId?: string): boolean {
  if (taskId) return new RegExp('^\\s*取消\\s+' + escapeRegExp(taskId) + '\\s*$').test(text);
  return /^\s*取消(?:当前任务)?\s*$/.test(text);
}

export function parseTaskControl(text: string): { action: 'confirm' | 'cancel'; taskId: string } | undefined {
  const match = /^\s*(确认|取消)\s+([0-9a-zA-Z_-]+)\s*$/.exec(text);
  if (!match) return undefined;
  return { action: match[1] === '确认' ? 'confirm' : 'cancel', taskId: match[2]! };
}
