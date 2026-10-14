/** An explicit incomplete response is a semantic model outcome, not a
 * transport TypeError. Repeating the same request cannot raise its budget. */
export class ModelIncompleteResponseError extends Error {
  constructor(reason: unknown) {
    const safeReason = reason === 'max_output_tokens' || reason === 'content_filter' ? reason : 'unknown';
    super(`MODEL_STREAM_response.incomplete:${safeReason}`);
    this.name='ModelIncompleteResponseError';
  }
}

/** Normalize a complete Responses SSE stream into its final JSON envelope.
 * Partial output never becomes a successful verdict. */
export async function readModelResponseBody(response: Response): Promise<string> {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return response.text();
  if (!response.body) throw new TypeError('MODEL_STREAM_MISSING_BODY');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '', output = '', completed: Record<string, unknown> | undefined;
  const event = (raw: string) => {
    const data = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    const item = JSON.parse(data);
    if (item.type === 'response.output_text.delta') output += item.delta ?? '';
    if (item.type === 'response.completed') completed = item.response;
    if (item.type === 'response.incomplete') throw new ModelIncompleteResponseError(item.response?.incomplete_details?.reason);
    if (['response.failed','error'].includes(item.type)) throw new TypeError(`MODEL_STREAM_${item.type}`);
  };
  try {
    while (true) {
      const {value, done} = await reader.read();
      pending += decoder.decode(value, {stream: !done});
      const chunks = pending.split(/\r?\n\r?\n/);
      pending = chunks.pop() ?? '';
      for (const chunk of chunks) event(chunk);
      if (done) break;
    }
    if (pending.trim()) event(pending);
    if (completed?.status === 'incomplete') throw new ModelIncompleteResponseError((completed.incomplete_details as {reason?:unknown} | undefined)?.reason);
    if (!completed || completed.status === 'failed') throw new TypeError('MODEL_STREAM_INCOMPLETE');
    if (!Array.isArray(completed.output) || !completed.output.length) completed.output = [{content: [{type: 'output_text', text: output}]}];
    return JSON.stringify(completed);
  } finally {await reader.cancel().catch(() => undefined); reader.releaseLock();}
}
