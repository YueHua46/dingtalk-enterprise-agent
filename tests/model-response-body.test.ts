import {describe, expect, it} from 'vitest';
import {readModelResponseBody} from '../src/model-response-body.js';
const sse = (raw: string) => new Response(new ReadableStream({start(controller) {
  for (const byte of new TextEncoder().encode(raw)) controller.enqueue(new Uint8Array([byte]));
  controller.close();
}}), {headers: {'content-type': 'text/event-stream'}});
describe('complete streamed model response', () => {
  it('reads split UTF-8 chunks and preserves the final usage and verdict', async () => {
    const raw = 'data: '+JSON.stringify({type:'response.output_text.delta',delta:'中文'})+'\n\n'
      +'data: '+JSON.stringify({type:'response.completed',response:{status:'completed',usage:{input_tokens:20}}})+'\n\n';
    expect(JSON.parse(await readModelResponseBody(sse(raw)))).toMatchObject({usage:{input_tokens:20},output:[{content:[{text:'中文'}]}]});
  });
  it('rejects partial text without a completion event and explicit incomplete results', async () => {
    await expect(readModelResponseBody(sse('data: {"type":"response.output_text.delta","delta":"pass"}\n\n'))).rejects.toThrow('MODEL_STREAM_INCOMPLETE');
    await expect(readModelResponseBody(sse('data: {"type":"response.incomplete"}\n\n'))).rejects.toThrow('MODEL_STREAM_response.incomplete');
  });
});
