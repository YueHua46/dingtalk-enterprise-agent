import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import { Gauge, Registry, collectDefaultMetrics } from 'prom-client';
import { knowledgeMetrics } from './knowledge-metrics.js';
import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Config } from './config.js';
import type { AgentRequest } from './types.js';
import { requestId } from './security.js';
import { TaskOrchestrator } from './task-orchestrator.js';
import { adaptModelRequest, restoreModelResponse, restoreSseChunk } from './model-tool-proxy.js';
import type { ZiniaoGateMetrics } from './ziniao-gate.js';
import { DingTalkDirectory, type DirectoryCandidate } from './dingtalk-directory.js';
import { verifyModelTaskToken } from './file-worker-auth.js';
import { NativeWebTool } from './native-web-tool.js';
import { StandaloneWebSearch } from './standalone-web-search.js';
import { requestModelWithRetry } from './model-request-retry.js';

export interface ReadinessProbe {
  check(): Promise<Record<string, string>>;
}

export async function createServer(
  config: Config,
  orchestrator: TaskOrchestrator,
  readiness?: ReadinessProbe,
  ziniaoMetrics?: () => ZiniaoGateMetrics
): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });
  await app.register(helmet);
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  if (ziniaoMetrics) {
    const gauges: Array<{ name: string; help: string; read: (metrics: ZiniaoGateMetrics) => number }> = [
      { name: 'ziniao_gate_queue_depth', help: 'Ziniao executor gate main queue depth', read: (m) => m.queueDepth },
      { name: 'ziniao_gate_busy', help: '1 when the ziniao executor is occupied', read: (m) => m.busy ? 1 : 0 },
      { name: 'ziniao_gate_holder_held_ms', help: 'Current executor hold duration in ms', read: (m) => m.holderHeldMs },
      { name: 'ziniao_gate_busy_total', help: 'Requests rejected because the gate queue was full', read: (m) => m.busyTotal },
      { name: 'ziniao_gate_queue_timeout_total', help: 'Requests that hit the gate wait timeout', read: (m) => m.queueTimeoutTotal },
      { name: 'ziniao_gate_cancelled_total', help: 'Gate waiters cancelled by their task', read: (m) => m.cancelledTotal },
      { name: 'ziniao_gate_lease_lost_total', help: 'Leases force-released by hard caps', read: (m) => m.leaseLostTotal },
      { name: 'ziniao_gate_session_expired_total', help: 'Bridge sessions expired by idle TTL', read: (m) => m.sessionExpiredTotal }
    ];
    for (const gauge of gauges) {
      new Gauge({ name: gauge.name, help: gauge.help, registers: [registry], collect() { this.set(gauge.read(ziniaoMetrics())); } });
    }
  }

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
    return (await registry.metrics()) + '\n' + (await knowledgeMetrics.metrics());
  });

  // Server-to-server only. The web UI must obtain candidates through its own
  // authenticated backend, never by calling this endpoint or DingTalk directly.
  const directory = new DingTalkDirectory(config);
  let directoryCache: { expiresAt: number; candidates: DirectoryCandidate[] } | undefined;
  app.get('/internal/directory/candidates', async (request, reply) => {
    if (!config.INTERNAL_API_TOKEN || !safeTokenEqual(request.headers['x-internal-token'], config.INTERNAL_API_TOKEN)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (!config.DINGTALK_DIRECTORY_FACTORY_DEPT_ID) return reply.code(503).send({ error: 'directory_not_configured' });
    try {
      if (!directoryCache || directoryCache.expiresAt <= Date.now()) {
        directoryCache = { candidates: await directory.candidates(), expiresAt: Date.now() + 10 * 60 * 1000 };
      }
      reply.header('cache-control', 'no-store');
      return { candidates: directoryCache.candidates, fetchedAt: new Date(directoryCache.expiresAt - 10 * 60 * 1000).toISOString() };
    } catch (error) {
      request.log.warn({ code: error instanceof Error ? error.message : 'UNKNOWN' }, 'DingTalk directory unavailable');
      return reply.code(503).send({ error: 'directory_unavailable' });
    }
  });

  if (config.MODEL_TOOL_COMPAT_PROXY === 'true' && config.MODEL_BASE_URL) {
    const standaloneSearch = new StandaloneWebSearch(new NativeWebTool(config));
    app.post<{ Body: Record<string, unknown> }>('/internal/model/v1/alpha/search', { bodyLimit: 64 * 1024 }, async (request, reply) => {
      const workerTaskId = config.FILE_WORKER_SECRET && typeof request.headers.authorization === 'string'
        ? verifyModelTaskToken(config.FILE_WORKER_SECRET, request.headers.authorization) : undefined;
      if (!workerTaskId) return reply.code(403).send({ error: 'worker_only' });
      await orchestrator.observeWebSearch?.(workerTaskId, request.body);
      try {
        reply.header('cache-control', 'no-store');
        // A caller-selected session ID must not mix references across tasks.
        const result = await standaloneSearch.execute({ ...request.body, id: workerTaskId });
        const evidenceId = await orchestrator.observeWebSearch?.(workerTaskId, request.body, result);
        if (evidenceId) result.output += `\n本次公开网页查询证据 ID：${evidenceId}；可用于 agent.workflow complete 的 factEvidence。`;
        return result;
      } catch (error) {
        request.log.warn({ code: error instanceof Error ? error.message : 'WEB_SEARCH_FAILED' }, 'standalone web search failed');
        // Deliver a tool failure to Codex instead of a transport error, which
        // the client retries automatically and leaves the task spinning.
        const result = {
          encrypted_output: null,
          output: `Web search failed: ${error instanceof Error ? error.message : 'WEB_SEARCH_FAILED'}. No verified search results are available. Do not retry this failed search in this turn; explain the failure to the user and do not invent current news or sources.`,
          results: []
        };
        await orchestrator.observeWebSearch?.(workerTaskId, request.body, result);
        return result;
      }
    });
    app.post<{ Body: Record<string, unknown> }>('/internal/model/v1/responses', { bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
      const workerTaskId = config.FILE_WORKER_SECRET && typeof request.headers.authorization === 'string'
        ? verifyModelTaskToken(config.FILE_WORKER_SECRET, request.headers.authorization) : undefined;
      if (!isLoopback(request.ip) && !workerTaskId) return reply.code(403).send({ error: 'local_only' });
      let adapted;
      try { adapted = adaptModelRequest(request.body); }
      catch { return reply.code(400).send({ error: 'invalid_model_request' }); }
      const upstream = config.MODEL_BASE_URL!.replace(/\/+$/, '') + '/responses';
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (workerTaskId && config.MODEL_API_KEY) headers.authorization = `Bearer ${config.MODEL_API_KEY}`;
      else if (typeof request.headers.authorization === 'string') headers.authorization = request.headers.authorization;
      let response: Response;
      const cancellation=new AbortController();
      reply.raw.once('close',()=>{if(!reply.raw.writableFinished)cancellation.abort();});
      try {
        const result=await requestModelWithRetry(upstream,{
          method:'POST',headers,body:JSON.stringify(adapted.body),
          signal:AbortSignal.any([AbortSignal.timeout(10*60*1000),cancellation.signal])
        },{maxAttempts:config.MODEL_REQUEST_MAX_ATTEMPTS,budgetMs:config.MODEL_REQUEST_RETRY_BUDGET_MS,
          onRetry:event=>request.log.warn(event,'model request retry scheduled')});
        response=result.response;
        reply.header('x-model-request-attempts',String(result.attempts));
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
