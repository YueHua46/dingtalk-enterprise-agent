import {describe, expect, it, vi} from 'vitest';
import {requestReadWithRetry} from '../src/read-request-retry.js';

describe('read transport retry', () => {
  it('retries five transient responses with exactly the original identity and query', async () => {
    const body = JSON.stringify({corp_id: 'corp', dingtalk_user_id: 'employee', params: {site: 'DE', days: 7}});
    let calls = 0;
    const http: typeof fetch = async (_url, init) => {
      expect(init?.body).toBe(body);
      return ++calls < 6 ? new Response('gateway unavailable', {status: 502, headers: {'retry-after': '0'}})
        : new Response('{"success":true}');
    };
    const result = await requestReadWithRetry('https://data.example/query', {method: 'POST', body}, http);
    expect(await result.json()).toEqual({success: true});
    expect(calls).toBe(6);
  });
  it('does not retry or transform a permission denial', async () => {
    const http = vi.fn(async () => new Response('{"success":false}', {status: 403}));
    expect((await requestReadWithRetry('https://data.example/scope', {method: 'GET'}, http)).status).toBe(403);
    expect(http).toHaveBeenCalledOnce();
  });
});
