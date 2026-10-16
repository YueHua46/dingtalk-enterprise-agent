import type { ToolAction, RiskLevel } from './types.js';

export function classifyAction(action: ToolAction): RiskLevel {
  return action.risk === 'read' || action.risk === 'write' || action.risk === 'high' ? action.risk : 'high';
}

export function requiresConfirmation(risk: RiskLevel): boolean {
  return risk === 'write' || risk === 'high';
}

function escapeRegExp(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function isConfirmation(text: string, taskId: string, challengeId?: string): boolean {
  return new RegExp('^\\s*确认\\s+' + escapeRegExp(taskId) + (challengeId ? '\\s+' + escapeRegExp(challengeId) : '') + '\\s*$').test(text);
}

export function isCancellation(text: string, taskId?: string): boolean {
  if (taskId) return new RegExp('^\\s*取消\\s+' + escapeRegExp(taskId) + '\\s*$').test(text);
  return /^\s*取消(?:当前任务)?\s*$/.test(text);
}

/** Exact control phrases only; quoted task lookup supplies identity and scope. */
export function isReferencedTaskCancellation(text: string): boolean {
  const normalized=text.replace(/^\s*(?:(?:<@[^>]+>|@[\p{L}\p{N}_-]+)\s*)+/u,'').trim();
  return /^(?:取消(?:任务|该任务|这个任务)?|终止任务|停止任务)[。！!]?$/u.test(normalized);
}

export function parseTaskControl(text: string): { action: 'confirm' | 'cancel'; taskId: string; challengeId?: string } | undefined {
  const match = /^\s*(确认|取消)\s+([0-9a-zA-Z_-]+)(?:\s+([0-9a-zA-Z_-]+))?\s*$/.exec(text);
  if (!match) return undefined;
  return { action: match[1] === '确认' ? 'confirm' : 'cancel', taskId: match[2]!, ...(match[3] ? { challengeId: match[3] } : {}) };
}
