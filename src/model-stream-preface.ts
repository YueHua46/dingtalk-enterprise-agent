/** Raised only before any model event has been exposed to the caller. */
export class EmptyModelStreamError extends Error {
  constructor() { super('MODEL_EMPTY_STREAM'); this.name = 'EmptyModelStreamError'; }
}

/** Sub2API can commit HTTP 200 with heartbeat comments, then return empty_stream.
 * Hold that preface until the first real event, so the same request can be
 * retried without replaying previously executed tools or an entire task.
 * Empty lifecycle metadata is held too. Any output/tool/unknown data event
 * commits the stream, so an already exposed tool call can never be replayed.
 */
export async function primeModelStream(response: Response, signal: AbortSignal): Promise<Response> {
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const decoder = new TextDecoder();
  let pending = '', size = 0;
  const abort = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) throw new EmptyModelStreamError();
      chunks.push(part.value);
      size += part.value.byteLength;
      if (size > 2_000_000) throw new Error('MODEL_SSE_PREFACE_TOO_LARGE');
      pending += decoder.decode(part.value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(pending)) !== null) {
        const frame = pending.slice(0, match.index);
        pending = pending.slice(match.index + match[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).replace(/^ /, '')).join('\n');
        if (!data) continue; // comment/event-only heartbeats carry no model output
        type StreamError = { type?: string; code?: string; message?: string };
        let value: { type?: string; error?: StreamError; response?: { output?: unknown[]; error?: StreamError } } | undefined;
        try { value = JSON.parse(data); } catch { /* Unknown data must never be replayed. */ }
        const emptyOutput = Array.isArray(value?.response?.output) && value.response.output.length === 0;
        if ((value?.type === 'response.created' || value?.type === 'response.in_progress') && emptyOutput) continue;
        const streamError = value?.type === 'response.failed' && emptyOutput ? value.response?.error : value?.error;
        if (streamError?.type === 'empty_stream' || streamError?.code === 'empty_stream'
          || (streamError?.type === 'upstream_error' && streamError.message === 'empty_stream')) throw new EmptyModelStreamError();
        // Reconstruct the exact bytes already read, then stream the rest. Once
        // returned, failures are handled by the caller and cannot cause replay.
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) { for (const chunk of chunks) controller.enqueue(chunk); },
          async pull(controller) {
            try {
              const next = await reader.read();
              if (next.done) { reader.releaseLock(); controller.close(); }
              else controller.enqueue(next.value);
            } catch (error) { reader.releaseLock(); controller.error(error); }
          },
          async cancel(reason) { await reader.cancel(reason); reader.releaseLock(); }
        }), { status: response.status, statusText: response.statusText, headers: response.headers });
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    throw error;
  } finally { signal.removeEventListener('abort', abort); }
}
