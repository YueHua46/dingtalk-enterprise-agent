import { describe, expect, it } from 'vitest';
import { adaptModelRequest, restoreModelResponse, restoreSseChunk, modelResponseDiagnostics } from '../src/model-tool-proxy.js';

describe('Responses namespace compatibility', () => {
  it('records structural response diagnostics without exposing content or promoting text to tools',()=>{
    const response={status:'completed',output:[{type:'message',content:[{type:'output_text',text:'call:default_api:tool{secret:value}'}]},
      {type:'function_call',name:'real_tool',arguments:'{"token":"secret"}'},{type:'reasoning'}],
      usage:{input_tokens:100,output_tokens:20,output_tokens_details:{reasoning_tokens:10}}};
    const diagnostics=modelResponseDiagnostics({type:'response.completed',response});
    expect(diagnostics).toMatchObject({responseStatus:'completed',outputTypes:{message:1,function_call:1,reasoning:1},
      messagePhases:{absent:1},inputTokens:100,outputTokens:20,reasoningTokens:10});
    expect(JSON.stringify(diagnostics)).not.toContain('secret');
    expect((restoreModelResponse(response,new Map()) as any).output[0]).toEqual(response.output[0]);
  });
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

  it('sanitizes dotted child names for strict Responses providers', () => {
    const adapted = adaptModelRequest({ tools: [{ type: 'namespace', name: 'agent', tools: [
      { type: 'function', name: 'ui.render', parameters: { type: 'object' } }
    ] }] });
    expect((adapted.body.tools as any[])[0].name).toBe('agent__ui_render');
    expect(adapted.toolNames.get('agent__ui_render')).toEqual({ namespace: 'agent', name: 'ui.render' });
    expect(restoreModelResponse({ output: [{ type: 'function_call', name: 'agent__ui_render', arguments: '{}' }] }, adapted.toolNames))
      .toEqual({ output: [{ type: 'function_call', name: 'ui.render', namespace: 'agent', arguments: '{}' }] });
  });
});
