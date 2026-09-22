import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import { Registry, collectDefaultMetrics } from 'prom-client';
import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Config } from './config.js';
import type { AgentRequest } from './types.js';
import { requestId } from './security.js';
import { TaskOrchestrator } from './task-orchestrator.js';
import { adaptModelRequest, restoreModelResponse, restoreSseChunk } from './model-tool-proxy.js';

export interface ReadinessProbe {
  check(): Promise<Record<string, string>>;
}

export async function createServer(config: Config, orchestrator: TaskOrchestrator, readiness?: ReadinessProbe): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });
  await app.register(helmet);
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async (request, reply) => {
    try {
      const dependencies = readiness ? await readiness.check() : { mode: 'in-memory-test' };
      return reply.send({ ok: true, dependencies });
    } catch (error) {
      request.log.error({ err: error }, 'readiness check failed');
      return reply.code(503).send({ ok: false, error: 'dependency_unavailable' });
    }
  });
  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });

  if (config.MODEL_TOOL_COMPAT_PROXY === 'true' && config.MODEL_BASE_URL) {
    app.post<{ Body: Record<string, unknown> }>('/internal/model/v1/responses', { bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
      if (!isLoopback(request.ip)) return reply.code(403).send({ error: 'local_only' });
      let adapted;
      try { adapted = adaptModelRequest(request.body); }
      catch { return reply.code(400).send({ error: 'invalid_model_request' }); }
      const upstream = config.MODEL_BASE_URL!.replace(/\/+$/, '') + '/responses';
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (typeof request.headers.authorization === 'string') headers.authorization = request.headers.authorization;
      let response: Response;
      try {
        response = await fetch(upstream, {
          method: 'POST', headers, body: JSON.stringify(adapted.body), signal: AbortSignal.timeout(10 * 60 * 1000)
        });
      } catch (error) {
        request.log.error({ error: error instanceof Error ? error.name : 'UnknownError' }, 'model upstream unavailable');
        return reply.code(502).send({ error: 'model_upstream_unavailable' });
      }
      const contentType = response.headers.get('content-type') ?? 'application/json';
      reply.code(response.status).header('content-type', contentType);
      const requestIdHeader = response.headers.get('x-request-id');
      if (requestIdHeader) reply.header('x-request-id', requestIdHeader);
      if (!response.body) return reply.send();
      if (!contentType.includes('text/event-stream')) {
        const raw = await response.text();
        try { return reply.send(restoreModelResponse(JSON.parse(raw), adapted.toolNames)); }
        catch { return reply.send(raw); }
      }
      reply.hijack();
      reply.raw.writeHead(response.status, { 'content-type': contentType, 'cache-control': 'no-cache' });
      const decoder = new TextDecoder();
      let pending = '';
      try {
        for await (const part of Readable.fromWeb(response.body as any)) {
          pending += decoder.decode(part as Uint8Array, { stream: true });
          if (pending.length > 2_000_000) throw new Error('model SSE event too large');
          let match: RegExpExecArray | null;
          while ((match = /\r?\n\r?\n/.exec(pending)) !== null) {
            const event = pending.slice(0, match.index);
            pending = pending.slice(match.index + match[0].length);
            reply.raw.write(restoreSseChunk(event, adapted.toolNames) + '\n\n');
            if (isTerminalSseEvent(event)) {
              reply.raw.end();
              return;
            }
          }
        }
        pending += decoder.decode();
        if (pending) reply.raw.write(restoreSseChunk(pending, adapted.toolNames));
        reply.raw.end();
      } catch (error) {
        request.log.error({ error: error instanceof Error ? error.name : 'UnknownError' }, 'model stream interrupted');
        reply.raw.destroy();
      }
    });
  }

  app.post<{ Body: AgentRequest }>('/internal/messages', async (request, reply) => {
    if (config.NODE_ENV === 'production' && !safeTokenEqual(request.headers['x-internal-token'], config.INTERNAL_API_TOKEN)) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
    const body = request.body;
    if (!body || !body.user || !body.surface || typeof body.text !== 'string') {
      return reply.code(400).send({ ok: false, error: 'invalid_message' });
    }
    const input: AgentRequest = {
      ...body,
      requestId: body.requestId || requestId(),
      messageId: body.messageId || requestId(),
      attachments: body.attachments ?? [],
      receivedAt: body.receivedAt || Date.now()
    };
    if (await orchestrator.handleControl(input)) return { ok: true, handled: 'control' };
    const task = await orchestrator.accept(input);
    if (!task) return reply.code(200).send({ ok: true, handled: 'duplicate' });
    return reply.code(202).send({ ok: true, taskId: task.id });
  });
  return app;
}

function safeTokenEqual(received: string | string[] | undefined, expected: string | undefined): boolean {
  if (typeof received !== 'string' || !expected) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function isTerminalSseEvent(event: string): boolean {
  return /(?:^|\n)event: response\.(?:completed|failed|incomplete)(?:\r?$|\n)/m.test(event) ||
    /(?:^|\n)data: \[DONE\](?:\r?$|\n)/m.test(event);
}
