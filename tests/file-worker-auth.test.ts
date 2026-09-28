import { describe, expect, it } from 'vitest';
import { issueModelTaskToken, verifyModelTaskToken } from '../src/file-worker-auth.js';

describe('file worker model token', () => {
  const secret = 'x'.repeat(40);
  const taskId = '12345678-1234-1234-1234-123456789abc';

  it('accepts only the signed task token before expiry', () => {
    const now = Date.now();
    const token = issueModelTaskToken(secret, taskId, now);
    expect(verifyModelTaskToken(secret, `Bearer ${token}`, now + 1)).toBe(taskId);
    expect(verifyModelTaskToken('y'.repeat(40), `Bearer ${token}`, now + 1)).toBeUndefined();
    expect(verifyModelTaskToken(secret, `Bearer ${token}`, now + 24 * 60 * 60 * 1000)).toBeUndefined();
    const forged = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
    expect(verifyModelTaskToken(secret, `Bearer ${forged}`, now + 1)).toBeUndefined();
  });
});
