import { mkdir } from 'node:fs/promises';
import { Pool } from 'pg';
import { loadConfig } from './config.js';
import { CodexClient } from './codex-client.js';
import { HybridCodexClient } from './hybrid-codex-client.js';
import { DingTalkStreamAdapter } from './dingtalk-stream.js';
import { DwsBroker } from './dws-broker.js';
import { KnowledgeModel } from './knowledge-model.js';
import { KnowledgeStore } from './knowledge-store.js';
import { KnowledgeSource } from './knowledge-source.js';
import { KnowledgeSync } from './knowledge-sync.js';
import { KnowledgeTool } from './knowledge-tool.js';
import { ListingTool, PgListingSessionStore, MemoryListingSessionStore } from './listing-tool.js';
import { PgListingRevisionStore, MemoryListingRevisionStore } from './listing-revision-store.js';
import { ResponsesStructuredModel } from './structured-model.js';
import { AmazonTool } from './amazon-tool.js';
import { McpReadTool } from './mcp-read-tool.js';
import { registerKnowledgeDatabaseMetrics } from './knowledge-metrics.js';
import { InMemoryRepository, PgRepository, type Repository } from './persistence.js';
import { createServer } from './server.js';
import { TaskOrchestrator } from './task-orchestrator.js';
import { RedisTaskQueue } from './task-queue.js';
import { RetentionService } from './retention.js';
import { DingTalkNativeCardBroker } from './dingtalk-card.js';
import { A2uiTaskCards, type TaskCardView } from './a2ui-task-card.js';
import { ZiniaoBroker } from './ziniao-broker.js';
import { ZiniaoRemoteBroker } from './ziniao-remote-broker.js';
import * as md from './markdown.js';
import type { AgentRequest, ApprovalChallenge, ConversationSurface, TaskRecord, ToolAction } from './types.js';

const config = loadConfig();
await mkdir(config.CODEX_WORKDIR, { recursive: true });
await mkdir(config.MEDIA_DIR, { recursive: true });

let pool: Pool | undefined;
let repository: Repository;
if (config.NODE_ENV === 'production') {
  pool = new Pool({ connectionString: config.DATABASE_URL, max: 20 });
  repository = new PgRepository(pool);
} else {
  repository = new InMemoryRepository();
}

const codex = config.FILE_WORKER_MODE === 'off' ? new CodexClient(config) : new HybridCodexClient(config);
const dws = new DwsBroker(config);
const knowledgeModel = new KnowledgeModel(config);
const knowledgeStore = pool ? new KnowledgeStore(pool, config.EMBEDDING_MODEL) : undefined;
const knowledgeSource = new KnowledgeSource(config, dws, knowledgeModel,knowledgeStore);
const knowledgeSync = knowledgeStore ? new KnowledgeSync(config, knowledgeStore, dws, knowledgeSource, knowledgeModel) : undefined;
const knowledgeTool = knowledgeStore && knowledgeSync ? new KnowledgeTool(config, knowledgeStore, knowledgeSync, knowledgeModel) : undefined;
if (pool) registerKnowledgeDatabaseMetrics(pool);
const nativeCards = new DingTalkNativeCardBroker(config);
const taskCards = new A2uiTaskCards(dws, repository);
let stream: DingTalkStreamAdapter | undefined;
const sender = {
  ...(config.DINGTALK_A2UI_TASK_CARDS === 'true' ? {
    async beginTaskCard(task: TaskRecord): Promise<string> {
      return taskCards.create(task);
    },
    async updateTaskProcess(task: TaskRecord, view: TaskCardView): Promise<void> {
      await taskCards.update(task, view);
    }
  } : {}),
  async send(surface: ConversationSurface, markdown: string, title?: string): Promise<void> {
    const delivered = stream ? await stream.send(surface, markdown, title) : false;
    if (delivered) return;
    if (config.DWS_BOT_PROFILE) {
      await dws.sendBotMarkdown(surface, markdown, title ?? 'Agent智能助手');
      return;
    }
    console.log(JSON.stringify({ surface, markdown, title }));
  },
  async sendDirect(user: AgentRequest['user'], markdown: string, title?: string): Promise<void> {
    const directTitle = title ?? 'Agent智能助手';
    // Primary: native robot single-chat push with app credentials only. This
    // keeps the per-employee OAuth guidance fully self-service — no DWS bot
    // profile is involved, and each user authorizes their own identity.
    try {
      await nativeCards.sendRobotDirectMessage(user.userId, markdown, directTitle);
      return;
    } catch (error) {
      if (!config.DWS_BOT_PROFILE) throw error;
      console.log(JSON.stringify({ event: 'native_direct_send_failed', reason: error instanceof Error ? error.message : String(error) }));
    }
    await dws.sendBotMessage(user, markdown, directTitle);
  },
  async sendFile(user: AgentRequest['user'], surface: ConversationSurface, filePath: string): Promise<unknown> {
    return dws.sendBotFile(user, surface, filePath);
  },
  async beginApprovalCard(task: TaskRecord, _action: ToolAction, challenge: ApprovalChallenge): Promise<string | undefined> {
    return nativeCards.createApprovalCard(task.request.surface, md.approvalCardContent(challenge), challenge.challengeId!);
  },
  async updateApprovalCard(bizId: string, content: string, status: string, challengeId?: string): Promise<void> {
    await nativeCards.updateApprovalCard(bizId, content, status, challengeId);
  }
};
const taskQueue = config.NODE_ENV === 'production' ? new RedisTaskQueue(config) : undefined;
const ziniaoBroker = config.ZINIAO_REMOTE_HOST ? new ZiniaoRemoteBroker(config) : new ZiniaoBroker(config);
const listingTool = await ListingTool.create(pool ? new PgListingSessionStore(pool) : new MemoryListingSessionStore(),
  pool ? new PgListingRevisionStore(pool) : new MemoryListingRevisionStore(),new ResponsesStructuredModel(config),new AmazonTool(),new McpReadTool(config));
const orchestrator = new TaskOrchestrator(config, repository, codex, dws, sender, undefined, taskQueue, ziniaoBroker, undefined, knowledgeTool, listingTool);
const retention = new RetentionService(config, repository);
const streamAdapter = new DingTalkStreamAdapter(config, async (request: AgentRequest) => {
  if (await orchestrator.handleControl(request)) return;
  await orchestrator.accept(request);
  await knowledgeSync?.enqueue(request.user).catch(() => undefined);
});
streamAdapter.setCardActionHandler(async (event) => {
  await orchestrator.handleApprovalCardClick(event);
});
stream = streamAdapter;

await repository.ping();
if (knowledgeSync && (config.KNOWLEDGE_ENABLED === 'true' || config.KNOWLEDGE_TEST_USERS.trim())) await knowledgeSync.start();
await codex.start();
await streamAdapter.start();
await orchestrator.start();
await orchestrator.recover();
await retention.start();
const app = await createServer(config, orchestrator, {
  async check() {
    await repository.ping();
    await orchestrator.pingQueue();
    if (!codex.isReady()) throw new Error('Codex App Server is unavailable');
    if (!streamAdapter.isReady()) throw new Error('DingTalk Stream is unavailable');
    return {
      postgres: config.NODE_ENV === 'production' ? 'ready' : 'in-memory',
      redis: taskQueue ? 'ready' : 'in-memory',
      codex: 'ready',
      dingtalk: 'ready'
    };
  }
}, () => ziniaoBroker.gateMetrics());
await app.listen({ host: config.HOST, port: config.PORT });
console.log('Agent gateway listening on ' + config.HOST + ':' + config.PORT);

const shutdown = async () => {
  stream?.stop();
  retention.stop();
  await knowledgeSync?.stop();
  await orchestrator.stop();
  await codex.stop();
  await app.close();
  await pool?.end();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
