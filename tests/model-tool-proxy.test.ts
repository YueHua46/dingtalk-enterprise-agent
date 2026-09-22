import { describe, expect, it } from 'vitest';
import { adaptModelRequest, restoreModelResponse, restoreSseChunk } from '../src/model-tool-proxy.js';

describe('Responses namespace compatibility', () => {
  it('flattens namespaced tools and history without inspecting prompt keywords', () => {
    const request = {
      model: 'example',
      input: [
        { type: 'message', role: 'user', content: 'anything' },
        { type: 'function_call', namespace: 'internet', name: 'search', call_id: 'call-1', arguments: '{}' },
        { type: 'additional_tools', tools: [{ type: 'namespace', name: 'internet', tools: [
          { type: 'function', name: 'search', parameters: { type: 'object' } }
        ] }] }
      ]
    };
    const adapted = adaptModelRequest(request);
    expect((adapted.body.input as any[])[1]).toMatchObject({ name: 'internet__search', call_id: 'call-1' });
    expect((adapted.body.input as any[])[1]).not.toHaveProperty('namespace');
    expect((adapted.body.input as any[])[2].tools[0]).toMatchObject({ type: 'function', name: 'internet__search' });
    expect(request.input[1]).toHaveProperty('namespace', 'internet');
    expect(adapted.toolNames.get('internet__search')).toEqual({ namespace: 'internet', name: 'search' });
  });

  it('restores buffered and streamed function calls to Codex namespace identity', () => {
    const adapted = adaptModelRequest({ tools: [{ type: 'namespace', name: 'dingtalk', tools: [
      { type: 'function', name: 'dws', parameters: { type: 'object' } }
    ] }] });
    const call = { type: 'function_call', name: 'dingtalk__dws', arguments: '{}', call_id: 'call-1' };
    expect(restoreModelResponse({ output: [call] }, adapted.toolNames)).toEqual({ output: [{ ...call, name: 'dws', namespace: 'dingtalk' }] });
    const stream = 'event: response.output_item.added\ndata: ' + JSON.stringify({ type: 'response.output_item.added', item: call });
    expect(restoreSseChunk(stream, adapted.toolNames)).toContain('"namespace":"dingtalk"');
    expect(restoreSseChunk('data: [DONE]', adapted.toolNames)).toBe('data: [DONE]');
  });
});
