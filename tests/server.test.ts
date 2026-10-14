import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './test-config.js';
import { createServer } from '../src/server.js';
import type { TaskOrchestrator } from '../src/task-orchestrator.js';
import { issueModelTaskToken } from '../src/file-worker-auth.js';
import { randomUUID } from 'node:crypto';

afterEach(() => vi.unstubAllGlobals());

describe('HTTP server', () => {
  it('recovers a real compatibility empty-stream envelope before exposing SSE to Codex', async () => {
    let calls = 0;
    const complete = 'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n';
    const fetchMock = vi.fn(async () => new Response(++calls === 1
      ? ': ping\n\nevent: error\ndata: {"type":"error","error":{"type":"upstream_error","message":"empty_stream"}}\n\n'
      : complete, { headers: { 'content-type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    const app = await createServer(loadConfig({ DINGTALK_ROBOT_CODE: 'robot', MODEL_BASE_URL: 'https://model.example/v1', MODEL_TOOL_COMPAT_PROXY: 'true' }), {} as TaskOrchestrator);
    try {
      const result = await app.inject({ method: 'POST', url: '/internal/model/v1/responses', payload: { input: ['already queried advertising evidence'] } });
      expect(result.statusCode).toBe(200);
      expect(result.body).toBe(complete);
      expect(result.headers['x-model-request-attempts']).toBe('2');
      expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
    } finally { await app.close(); }
  });

  it('returns search failures as tool results to prevent HTTP retry loops', async () => {
    const secret = 'w'.repeat(32);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('Timed out', 'TimeoutError'); }));
    const app = await createServer(loadConfig({ DINGTALK_ROBOT_CODE: 'robot', MODEL_BASE_URL: 'https://model.example/v1', MODEL_API_KEY: 'model-key', MODEL_TOOL_COMPAT_PROXY: 'true', FILE_WORKER_SECRET: secret }), {} as TaskOrchestrator);
    try {
      const result = await app.inject({ method: 'POST', url: '/internal/model/v1/alpha/search', headers: { authorization: `Bearer ${issueModelTaskToken(secret, randomUUID())}` }, payload: { id: 'session-failed', commands: { search_query: [{ q: 'news' }] } } });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject({ encrypted_output: null, results: [{ type: 'error' }] });
      expect(result.json().output).toContain('failed:');
      expect(result.json().output).toContain('do not repeat');
    } finally { await app.close(); }
  });
  it('serves standalone Codex web search only to an authenticated worker task', async () => {
    const secret = 'w'.repeat(32);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ output: [{ content: [{ text: 'Example Domain\nWeb search queries: example.com\nSources:\n[1] [example.com](https://example.com/)' }] }] }),
      { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const observeWebSearch = vi.fn(async (_task, _request, result) => result ? 'evidence-web-1' : undefined);
    const app = await createServer(loadConfig({ DINGTALK_ROBOT_CODE: 'robot', MODEL_BASE_URL: 'https://model.example/v1', MODEL_API_KEY: 'model-key', MODEL_NAME: 'gemini-test', MODEL_TOOL_COMPAT_PROXY: 'true', FILE_WORKER_SECRET: secret }), { observeWebSearch } as unknown as TaskOrchestrator);
    const payload = { id: 'session-1', commands: { search_query: [{ q: 'example.com' }] } };
    const denied = await app.inject({ method: 'POST', url: '/internal/model/v1/alpha/search', payload });
    expect(denied.statusCode).toBe(403);
    const allowed = await app.inject({ method: 'POST', url: '/internal/model/v1/alpha/search', headers: { authorization: `Bearer ${issueModelTaskToken(secret, randomUUID())}` }, payload });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({ encrypted_output: null, results: [{ ref_id: 'turn0search0', url: 'https://example.com/' }] });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(observeWebSearch).toHaveBeenCalledTimes(2);
    expect(allowed.json().output).toContain('evidence-web-1');
    await app.close();
  });
  it('keeps the directory endpoint behind the internal token', async () => {
    const app = await createServer(loadConfig({ DINGTALK_ROBOT_CODE: 'robot', INTERNAL_API_TOKEN: 'x'.repeat(32) }), {} as TaskOrchestrator);
    const denied = await app.inject({ method: 'GET', url: '/internal/directory/candidates' });
    expect(denied.statusCode).toBe(401);
    const unconfigured = await app.inject({ method: 'GET', url: '/internal/directory/candidates', headers: { 'x-internal-token': 'x'.repeat(32) } });
    expect(unconfigured.statusCode).toBe(503);
    await app.close();
  });
  it('forwards namespace calls through a general protocol bridge without inspecting the prompt', async () => {
    const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      expect(body.tools).toEqual([{ type: 'function', name: 'dingtalk__dws', parameters: { type: 'object' } }]);
      return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'dingtalk__dws', arguments: '{}', call_id: 'call-1' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await createServer(loadConfig({ DINGTALK_ROBOT_CODE: 'robot', MODEL_BASE_URL: 'https://model.example/v1', MODEL_TOOL_COMPAT_PROXY: 'true' }), {} as TaskOrchestrator);
    const result = await app.inject({ method: 'POST', url: '/internal/model/v1/responses', payload: {
      input: 'arbitrary request', tools: [{ type: 'namespace', name: 'dingtalk', tools: [{ type: 'function', name: 'dws', parameters: { type: 'object' } }] }]
    } });
    expect(result.statusCode).toBe(200);
    expect(result.json().output[0]).toMatchObject({ type: 'function_call', namespace: 'dingtalk', name: 'dws' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await app.close();
  });
  it('restores namespace identity in streamed Responses events and closes on completion', async () => {
    const stream = [
      'event: response.output_item.added',
      'data: ' + JSON.stringify({ type: 'response.output_item.added', item: { type: 'function_call', name: 'internet__search', call_id: 'call-1', arguments: '{}' } }),
      '',
      'event: response.completed',
      'data: ' + JSON.stringify({ type: 'response.completed', response: { output: [{ type: 'function_call', name: 'internet__search', call_id: 'call-1', arguments: '{}' }] } }),
      '',
      ''
    ].join('\n');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })));
    const app = await createServer(loadConfig({ DINGTALK_ROBOT_CODE: 'robot', MODEL_BASE_URL: 'https://model.example/v1', MODEL_TOOL_COMPAT_PROXY: 'true' }), {} as TaskOrchestrator);
    const result = await app.inject({ method: 'POST', url: '/internal/model/v1/responses', payload: {
      input: 'arbitrary request', tools: [{ type: 'namespace', name: 'internet', tools: [{ type: 'function', name: 'search', parameters: { type: 'object' } }] }]
    } });
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('"namespace":"internet"');
    expect(result.body).not.toContain('"name":"internet__search"');
    await app.close();
  });
  it('serves health and rejects invalid internal messages', async () => {
    const orchestrator = {
      handleControl: async () => false,
      accept: async () => undefined
    } as unknown as TaskOrchestrator;
    const app = await createServer(loadConfig({ DINGTALK_ROBOT_CODE: 'robot', NODE_ENV: 'test' }), orchestrator);
    const health = await app.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true });
    const ready = await app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ ok: true });
    const invalid = await app.inject({ method: 'POST', url: '/internal/messages', payload: { text: 'x' } });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });

  it('returns 503 when a required dependency is unavailable', async () => {
    const orchestrator = {
      handleControl: async () => false,
      accept: async () => undefined
    } as unknown as TaskOrchestrator;
    const app = await createServer(
      loadConfig({ DINGTALK_ROBOT_CODE: 'robot', NODE_ENV: 'test' }),
      orchestrator,
      { check: async () => { throw new Error('postgres offline'); } }
    );
    const ready = await app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ ok: false, error: 'dependency_unavailable' });
    await app.close();
  });

  it('requires the internal token in production', async () => {
    const token = 'a'.repeat(32);
    const orchestrator = {
      handleControl: async () => false,
      accept: async () => undefined
    } as unknown as TaskOrchestrator;
    const app = await createServer(loadConfig({
      NODE_ENV: 'production',
      DINGTALK_CLIENT_ID: 'client',
      DINGTALK_CLIENT_SECRET: 'secret',
      DINGTALK_ROBOT_CODE: 'robot',
      DWS_BOT_PROFILE: 'corp:user',
      MODEL_BASE_URL: 'https://model.example.com/v1',
      MODEL_API_KEY: 'model-key',
      CLAMAV_HOST: 'clamav',
      INTERNAL_API_TOKEN: token
    }), orchestrator);
    const denied = await app.inject({ method: 'POST', url: '/internal/messages', payload: { text: 'x' } });
    expect(denied.statusCode).toBe(401);
    const allowed = await app.inject({
      method: 'POST',
      url: '/internal/messages',
      headers: { 'x-internal-token': token },
      payload: { text: 'x' }
    });
    expect(allowed.statusCode).toBe(400);
    await app.close();
  });
});
