import { z } from 'zod';
import type { Config } from './config.js';

const requestSchema = z.strictObject({
  system: z.string().min(1), data: z.string().min(1), schemaName: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  jsonSchema: z.record(z.string(), z.unknown()), maxOutputTokens: z.number().int().positive(),
  maxResponseBytes: z.number().int().positive(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
});
export type StructuredModelRequest = z.infer<typeof requestSchema>;
export interface StructuredModelResponse { text: string; model: string; responseId: string | null }
/** A host-owned text-only interface. No tool callback, thread, shell or execution facility. */
export interface StructuredModel {
  complete(request: StructuredModelRequest, signal: AbortSignal): Promise<StructuredModelResponse>;
}
export class StructuredModelError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'StructuredModelError'; }
}

async function boundedBody(response: Response, limit: number): Promise<string> {
  if (!response.body) throw new StructuredModelError('MODEL_EMPTY');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new StructuredModelError('MODEL_RESPONSE_TOO_LARGE'); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

/** Uses the same host MODEL_* configuration as the conversation runtime, with zero tools. */
export class ResponsesStructuredModel implements StructuredModel {
  constructor(private readonly config: Pick<Config, 'MODEL_BASE_URL' | 'MODEL_API_KEY' | 'MODEL_NAME'>,
    private readonly http: typeof fetch = fetch) {}

  async complete(raw: StructuredModelRequest, signal: AbortSignal): Promise<StructuredModelResponse> {
    const request = requestSchema.parse(raw);
    if (signal.aborted) throw new StructuredModelError('MODEL_CANCELLED');
    if (!this.config.MODEL_BASE_URL || !this.config.MODEL_API_KEY) throw new StructuredModelError('MODEL_NOT_CONFIGURED');
    let response: Response;
    try {
      response = await this.http(this.config.MODEL_BASE_URL.replace(/\/+$/, '') + '/responses', {
        method: 'POST', headers: { authorization: `Bearer ${this.config.MODEL_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.config.MODEL_NAME, stream: true, store: false,
          tools: [], tool_choice: 'none', max_output_tokens: request.maxOutputTokens,
          ...(request.reasoningEffort ? { reasoning: { effort: request.reasoningEffort } } : {}),
          input: [{ role: 'system', content: request.system }, { role: 'user', content: request.data }],
          text: { format: { type: 'json_schema', name: request.schemaName, strict: true, schema: request.jsonSchema } } }),
        signal, redirect: 'error',
      });
    } catch { throw new StructuredModelError(signal.aborted ? 'MODEL_CANCELLED' : 'MODEL_TRANSPORT_FAILED'); }
    if (!response.ok) { await response.body?.cancel(); throw new StructuredModelError(`MODEL_HTTP_${response.status}`); }
    let body: Record<string, any>;
    try {
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        // Keep the transport active for long generations; accept only a completed response,
        // never partial deltas. Bound framing overhead separately from the final JSON.
        const events = await boundedBody(response, request.maxResponseBytes * 16);
        let completed: Record<string, any> | undefined;
        for (const frame of events.replace(/\r\n/g, '\n').split('\n\n')) {
          const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data || data === '[DONE]') continue;
          const event = JSON.parse(data);
          if (event.type === 'error' || event.type === 'response.failed' || event.type === 'response.incomplete') throw new StructuredModelError('MODEL_INCOMPLETE');
          if (event.type === 'response.output_item.added' && !['message', 'reasoning'].includes(event.item?.type)) throw new StructuredModelError('MODEL_NON_TEXT_OUTPUT');
          if (event.type === 'response.completed') {
            if (completed) throw new StructuredModelError('MODEL_RESPONSE_INVALID');
            completed = event.response;
          }
        }
        if (!completed) throw new StructuredModelError('MODEL_INCOMPLETE');
        if (Buffer.byteLength(JSON.stringify(completed), 'utf8') > request.maxResponseBytes) throw new StructuredModelError('MODEL_RESPONSE_TOO_LARGE');
        body = completed;
      } else body = JSON.parse(await boundedBody(response, request.maxResponseBytes));
    }
    catch (error) {
      if (error instanceof StructuredModelError) throw error;
      throw new StructuredModelError(signal.aborted ? 'MODEL_CANCELLED' : 'MODEL_RESPONSE_INVALID');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new StructuredModelError('MODEL_RESPONSE_INVALID');
    if (body.error || (body.status && body.status !== 'completed')) throw new StructuredModelError('MODEL_INCOMPLETE');
    if (!Array.isArray(body.output)) throw new StructuredModelError('MODEL_RESPONSE_INVALID');
    const texts: string[] = [];
    for (const item of body.output) {
      if (item?.type === 'reasoning') continue;
      // Reject tool output before extracting any message; never dispatch it.
      if (item?.type !== 'message' || item.role !== 'assistant' || !Array.isArray(item.content)) throw new StructuredModelError('MODEL_NON_TEXT_OUTPUT');
      for (const part of item.content) {
        if (part?.type === 'refusal') throw new StructuredModelError('MODEL_REFUSED');
        if (part?.type !== 'output_text' || typeof part.text !== 'string') throw new StructuredModelError('MODEL_NON_TEXT_OUTPUT');
        texts.push(part.text);
      }
    }
    const text = texts.join('\n').trim();
    if (!text) throw new StructuredModelError('MODEL_EMPTY');
    return { text, model: typeof body.model === 'string' ? body.model : this.config.MODEL_NAME,
      responseId: typeof body.id === 'string' ? body.id : null };
  }
}
