import { createHash, randomUUID } from 'node:crypto';
import type { ToolAction, UserIdentity } from './types.js';

export function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function requestId(): string {
  return randomUUID();
}

export function sameIdentity(a: UserIdentity, b: UserIdentity): boolean {
  return a.corpId === b.corpId && a.userId === b.userId;
}

export function actionHash(action: ToolAction): string {
  return sha256({ name: action.name, target: action.target, parameters: action.parameters });
}
