import { createHmac, timingSafeEqual } from 'node:crypto';

const TASK_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function issueModelTaskToken(secret: string, taskId: string, now = Date.now()): string {
  const expires = String(now + TASK_TOKEN_TTL_MS);
  const payload = `${taskId}.${expires}`;
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

export function verifyModelTaskToken(secret: string, authorization: string | undefined, now = Date.now()): string | undefined {
  const token = authorization?.replace(/^Bearer\s+/i, '') ?? '';
  const match = /^([a-f0-9-]{36})\.(\d{13})\.([a-f0-9]{64})$/.exec(token);
  if (!match || Number(match[2]) <= now) return undefined;
  const payload = `${match[1]}.${match[2]}`;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const actual = Buffer.from(match[3]!, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? match[1] : undefined;
}
