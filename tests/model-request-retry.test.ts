import { describe, expect, it } from 'vitest';
import { requestModelWithRetry } from '../src/model-request-retry.js';

describe('model request retry', () => {
  const sse = (text: string) => new Response(text, { headers: { 'content-type': 'text/event-stream' } });
  const emptyStream = ': ping\n\nevent: error\ndata: {"type":"error","error":{"type":"upstream_error","message":"empty_stream"}}\n\n';
  const completed = 'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n';

  it('recovers the exact Antigravity heartbeat/empty_stream failure with the same request', async () => {
    const bodies: unknown[] = [], reasons: string[] = [];
    const result = await requestModelWithRetry('https://model.example/responses', { method: 'POST', body: 'saved-tool-results' }, {
      maxAttempts: 3, budgetMs: 1000, retryEmptySse: true, retryDelayMs: () => 0,
      http: async (_url, init) => { bodies.push(init?.body); return sse(bodies.length === 1 ? emptyStream : completed); },
      onRetry: event => reasons.push(event.reason)
    });
    expect(await result.response.text()).toBe(completed);
    expect(bodies).toEqual(['saved-tool-results', 'saved-tool-results']);
    expect(reasons).toEqual(['empty_stream']);
    expect(result.attempts).toBe(2);
  });

  it('never replays a stream after a tool call even when followed by empty_stream', async () => {
    let calls = 0;
    const wire = 'data: {"type":"response.output_item.added","item":{"type":"function_call","name":"write"}}\n\n' + emptyStream;
    const result = await requestModelWithRetry('https://model.example/responses', {}, {
      maxAttempts: 3, budgetMs: 1000, retryEmptySse: true,
      http: async () => { calls++; return sse(wire); }
    });
    expect(await result.response.text()).toBe(wire);
    expect(calls).toBe(1);
  });

  it('recovers protocol-native empty failure after empty lifecycle metadata', async () => {
    let calls = 0;
    const created = 'data: {"type":"response.created","response":{"output":[]}}\n\n';
    const progress = 'data: {"type":"response.in_progress","response":{"output":[]}}\n\n';
    const failed = 'data: {"type":"response.failed","response":{"output":[],"error":{"code":"empty_stream"}}}\n\n';
    const success = created + completed;
    const result = await requestModelWithRetry('https://model.example/responses', {}, {
      maxAttempts: 2, budgetMs: 1000, retryEmptySse: true, retryDelayMs: () => 0,
      http: async () => sse(++calls === 1 ? created + progress + failed : success)
    });
    expect(await result.response.text()).toBe(success);
    expect(calls).toBe(2);
  });

  it.each([
    'data: {"type":"response.created","response":{"output":[{"type":"function_call"}]}}\n\n',
    'data: {"type":"response.failed","response":{"output":[{"type":"message"}],"error":{"code":"empty_stream"}}}\n\n',
    'data: {"type":"response.created"}\n\n',
    'data: {"type":"unrecognized.event"}\n\n'
  ])('never retries when lifecycle output or unknown data may carry state: %s', async prefix => {
    let calls = 0;
    const wire = prefix + emptyStream;
    const result = await requestModelWithRetry('https://model.example/responses', {}, {
      maxAttempts: 2, budgetMs: 1000, retryEmptySse: true,
      http: async () => { calls++; return sse(wire); }
    });
    expect(await result.response.text()).toBe(wire);
    expect(calls).toBe(1);
  });

  it('shares the attempt limit between HTTP failures and empty streams', async () => {
    let calls = 0;
    await expect(requestModelWithRetry('https://model.example/responses', {}, {
      maxAttempts: 3, budgetMs: 1000, retryEmptySse: true, retryDelayMs: () => 0,
      http: async () => ++calls === 1 ? new Response('', { status: 503 }) : sse(emptyStream)
    })).rejects.toThrow('MODEL_REQUEST_RETRY_EXHAUSTED');
    expect(calls).toBe(3);
  });

  it('handles heartbeat-only EOF and fragmented UTF-8 without losing response bytes', async () => {
    let calls = 0;
    const wire = 'data: {"type":"response.output_text.delta","delta":"广告诊断"}\n\n' + completed;
    const bytes = new TextEncoder().encode(wire);
    const result = await requestModelWithRetry('https://model.example/responses', {}, {
      maxAttempts: 2, budgetMs: 1000, retryEmptySse: true, retryDelayMs: () => 0,
      http: async () => ++calls === 1 ? sse(': ping\n\n') : new Response(new ReadableStream({
        start(controller) { for (let i = 0; i < bytes.length; i++) controller.enqueue(bytes.slice(i, i + 1)); controller.close(); }
      }), { headers: { 'content-type': 'text/event-stream' } })
    });
    expect(await result.response.text()).toBe(wire);
    expect(calls).toBe(2);
  });

  it('cancels a waiting heartbeat stream without starting another attempt', async () => {
    const controller = new AbortController();
    let calls = 0, cancelled = false;
    const request = requestModelWithRetry('https://model.example/responses', { signal: controller.signal }, {
      maxAttempts: 3, budgetMs: 1000, retryEmptySse: true,
      http: async () => { calls++; return new Response(new ReadableStream({
        start(stream) { stream.enqueue(new TextEncoder().encode(': ping\n\n')); },
        cancel() { cancelled = true; }
      }), { headers: { 'content-type': 'text/event-stream' } }); }
    });
    setTimeout(() => controller.abort(), 10);
    await expect(request).rejects.toThrow();
    expect(calls).toBe(1);
    expect(cancelled).toBe(true);
  });

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
