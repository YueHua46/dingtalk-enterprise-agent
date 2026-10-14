import {requestWithRetry} from './model-request-retry.js';

/** Only for explicitly read-only operations, including POST query endpoints.
 * Buffers the body within the attempt deadline. Authentication failures return
 * immediately and every retry preserves the caller's identity and filters. */
export async function requestReadWithRetry(url: string, init: RequestInit, http: typeof fetch, timeoutMs = 60_000): Promise<Response> {
  const buffered: typeof fetch = async (target, options) => {
    const response = await http(target, options);
    const raw = await response.arrayBuffer();
    return new Response(response.status === 204 ? null : raw, {status: response.status, headers: response.headers});
  };
  const {response} = await requestWithRetry(url, init, {http: buffered, maxAttempts: 6,
    attemptTimeoutMs: timeoutMs, budgetMs: timeoutMs * 6 + 70_000, errorPrefix: 'READ_REQUEST'});
  return response;
}
