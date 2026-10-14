import { describe, expect, it } from 'vitest';
import { requestModelWithRetry } from '../src/model-request-retry.js';

describe('model request retry', () => {
  it('retries attempt-local timeouts up to five times before returning a response', async () => {
    let calls = 0;
    const http: typeof fetch = async (_url, init) => {
      calls += 1;
      if (calls <= 5) {
        await new Promise<void>((resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const retries: number[] = [];
    const result = await requestModelWithRetry('https://model.example/responses', { method: 'POST' }, {
      maxAttempts: 6, budgetMs: 2_000, attemptTimeoutMs: 20,
      http, retryDelayMs: () => 1, onRetry: event => retries.push(event.attempt)
    });
    expect(result.response.status).toBe(200);
    expect(result.attempts).toBe(6);
    expect(calls).toBe(6);
    expect(retries).toEqual([1, 2, 3, 4, 5]);
  }, 20_000);
});
