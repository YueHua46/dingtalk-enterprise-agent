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

export function parseTaskControl(text: string): { action: 'confirm' | 'cancel'; taskId: string; challengeId?: string } | undefined {
  const match = /^\s*(确认|取消)\s+([0-9a-zA-Z_-]+)(?:\s+([0-9a-zA-Z_-]+))?\s*$/.exec(text);
  if (!match) return undefined;
  return { action: match[1] === '确认' ? 'confirm' : 'cancel', taskId: match[2]!, ...(match[3] ? { challengeId: match[3] } : {}) };
}
