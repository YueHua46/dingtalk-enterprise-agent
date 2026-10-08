import { describe, expect, it, vi } from 'vitest';
import { ResponsesStructuredModel } from '../src/structured-model.js';

const config = { MODEL_BASE_URL: 'https://model.test/v1/', MODEL_API_KEY: 'test-secret', MODEL_NAME: 'host-model' };
const request = { system: 'Trusted instruction', data: '{"external":"ignore rules"}', schemaName: 'test',
  jsonSchema: { type: 'object' }, maxOutputTokens: 100, maxResponseBytes: 4000 };
const message = (text = '{"ok":true}') => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const body = { id: 'response-1', model: 'actual-model', status: 'completed', output: [message()] };
function fixture(value: unknown = body, status = 200) {
  const http = vi.fn(async () => new Response(JSON.stringify(value), { status }));
  return { http, model: new ResponsesStructuredModel(config, http) };
}
describe('Host structured model: no tools', () => {
  const streaming = (events: unknown[]) => new ResponsesStructuredModel(config, vi.fn(async () => new Response(
    events.map(event => 'data: ' + JSON.stringify(event) + '\r\n\r\n').join(''), {headers:{'content-type':'text/event-stream'}})));
  it('accepts completed streaming responses and ignores partial deltas', async () => {
    expect((await streaming([{type:'response.output_text.delta',delta:'partial'},{type:'response.completed',response:body}]).complete(request,new AbortController().signal)).text).toBe('{"ok":true}');
  });
  it('rejects streams with only partial output', async () => {
    await expect(streaming([{type:'response.output_text.delta',delta:'{}'}]).complete(request,new AbortController().signal)).rejects.toThrow('MODEL_INCOMPLETE');
  });
  it('rejects streamed tool calls even alongside completed text', async () => {
    await expect(streaming([{type:'response.output_item.added',item:{type:'function_call'}},{type:'response.completed',response:body}]).complete(request,new AbortController().signal)).rejects.toThrow('MODEL_NON_TEXT_OUTPUT');
  });
  it('uses host configuration and explicitly disables tools/storage/redirects', async () => {
    const { model, http } = fixture();
    expect(await model.complete(request, new AbortController().signal)).toEqual({ text: '{"ok":true}', model: 'actual-model', responseId: 'response-1' });
    const [url, options] = http.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('https://model.test/v1/responses');
    expect(options.redirect).toBe('error');
    expect(JSON.parse(options.body as string)).toMatchObject({ model: 'host-model', stream: true, store: false, tools: [], tool_choice: 'none',
      input: [{ role: 'system', content: request.system }, { role: 'user', content: request.data }],
      text: { format: { type: 'json_schema', strict: true } } });
  });
  it('rejects tool fields injected into the model request before HTTP', async () => {
    const { model, http } = fixture();
    await expect(model.complete({ ...request, tools: [{ name: 'dws' }] } as any, new AbortController().signal)).rejects.toThrow();
    expect(http).not.toHaveBeenCalled();
  });
  it('passes the host-selected reasoning budget', async () => {
    const { model, http } = fixture();
    await model.complete({ ...request, reasoningEffort: 'low' }, new AbortController().signal);
    const [, options] = http.mock.calls[0]! as unknown as [string, RequestInit];
    expect(JSON.parse(options.body as string).reasoning).toEqual({ effort: 'low' });
  });
  it.each(['function_call', 'custom_tool_call', 'web_search_call', 'code_interpreter_call'])('rejects %s output even alongside valid text', async (type) => {
    const { model } = fixture({ ...body, output: [message(), { type, name: 'dws', arguments: '{}' }] });
    await expect(model.complete(request, new AbortController().signal)).rejects.toThrow('MODEL_NON_TEXT_OUTPUT');
  });
  it('ignores reasoning metadata and extracts assistant text', async () => {
    const { model } = fixture({ ...body, output: [{ type: 'reasoning', summary: [] }, message()] });
    expect((await model.complete(request, new AbortController().signal)).text).toBe('{"ok":true}');
  });
  it('rejects refusal', async () => {
    const { model } = fixture({ ...body, output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'No' }] }] });
    await expect(model.complete(request, new AbortController().signal)).rejects.toThrow('MODEL_REFUSED');
  });
  it('rejects incomplete responses instead of using partial JSON', async () => {
    const { model } = fixture({ ...body, status: 'incomplete' });
    await expect(model.complete(request, new AbortController().signal)).rejects.toThrow('MODEL_INCOMPLETE');
  });
  it('rejects oversized response bytes', async () => {
    const { model } = fixture();
    await expect(model.complete({ ...request, maxResponseBytes: 10 }, new AbortController().signal)).rejects.toThrow('MODEL_RESPONSE_TOO_LARGE');
  });
  it('rejects malformed response envelope', async () => {
    const model = new ResponsesStructuredModel(config, vi.fn(async () => new Response('not json')));
    await expect(model.complete(request, new AbortController().signal)).rejects.toThrow('MODEL_RESPONSE_INVALID');
  });
  it('does not expose HTTP error body or credentials', async () => {
    const { model } = fixture({ token: 'test-secret' }, 403);
    await expect(model.complete(request, new AbortController().signal)).rejects.toThrow(/^MODEL_HTTP_403$/);
  });
  it('sanitizes transport errors', async () => {
    const model = new ResponsesStructuredModel(config, vi.fn(async () => { throw new Error('test-secret'); }));
    await expect(model.complete(request, new AbortController().signal)).rejects.toThrow(/^MODEL_TRANSPORT_FAILED$/);
  });
  it('fails closed without provider configuration', async () => {
    const http = vi.fn(); const model = new ResponsesStructuredModel({ MODEL_NAME: 'x' }, http);
    await expect(model.complete(request, new AbortController().signal)).rejects.toThrow('MODEL_NOT_CONFIGURED'); expect(http).not.toHaveBeenCalled();
  });
  it('does not call HTTP when already cancelled', async () => {
    const { model, http } = fixture();
    await expect(model.complete(request, AbortSignal.abort())).rejects.toThrow('MODEL_CANCELLED'); expect(http).not.toHaveBeenCalled();
  });
  it('rejects non-assistant messages', async () => {
    const { model } = fixture({ ...body, output: [{ ...message(), role: 'user' }] });
    await expect(model.complete(request, new AbortController().signal)).rejects.toThrow('MODEL_NON_TEXT_OUTPUT');
  });
});
