import type { Config } from './config.js';
import { CodexClient, type CodexApprovalRequest, type CodexClientLike, type CodexEvent } from './codex-client.js';
import { RemoteCodexClient } from './remote-codex-client.js';
import type { Attachment, CodexTurnResult, UserIdentity } from './types.js';

export class HybridCodexClient implements CodexClientLike {
  private readonly local: CodexClient;
  private readonly remote: RemoteCodexClient;
  private readonly routes = new Map<string, CodexClientLike>();
  private readonly threadRoutes = new Map<string, CodexClientLike>();
  public constructor(private readonly config: Config) {
    this.local = new CodexClient(config);
    this.remote = new RemoteCodexClient(config);
  }
  public selectTask(taskId: string, surface: { type: string; id: string }, mode?: 'local' | 'worker'): void {
    const allowed = new Set(this.config.FILE_WORKER_TEST_SURFACES.split(',').map((item) => item.trim()).filter(Boolean));
    const enabled = this.config.FILE_WORKER_MODE === 'all' || (this.config.FILE_WORKER_MODE === 'test' && allowed.has(`${surface.type}:${surface.id}`));
    this.routes.set(taskId, (mode ? mode === 'worker' : enabled) ? this.remote : this.local);
  }
  private route(taskId?: string): CodexClientLike {
    return (taskId ? this.routes.get(taskId) : undefined)
      ?? (this.config.FILE_WORKER_MODE === 'all' ? this.remote : this.local);
  }
  public async start(): Promise<void> {
    if (this.config.FILE_WORKER_MODE !== 'all') await this.local.start();
    if (this.config.FILE_WORKER_MODE !== 'off') await this.remote.start();
  }
  public async stop(): Promise<void> { await Promise.all([this.local.stop(), this.remote.stop()]); }
  public isReady(): boolean {
    return (this.config.FILE_WORKER_MODE === 'all' || this.local.isReady())
      && (this.config.FILE_WORKER_MODE === 'off' || this.remote.isReady());
  }
  public async startThread(user: UserIdentity, taskId?: string): Promise<string> {
    const client = this.route(taskId);
    const threadId = await client.startThread(user, taskId);
    this.threadRoutes.set(threadId, client);
    return threadId;
  }
  public async ensureThread(threadId: string, user: UserIdentity, taskId: string): Promise<string> {
    const client = this.route(taskId);
    const actual = client.ensureThread ? await client.ensureThread(threadId, user, taskId) : threadId;
    this.threadRoutes.set(actual, client);
    return actual;
  }
  public async interrupt(threadId: string): Promise<void> { await (this.threadRoutes.get(threadId) ?? this.local).interrupt(threadId); }
  public async turn(threadId: string, input: string, onEvent?: (event: CodexEvent) => void, onApproval?: (request: CodexApprovalRequest) => Promise<unknown>, attachments?: Attachment[], taskId?: string): Promise<CodexTurnResult> {
    const client = this.route(taskId);
    this.threadRoutes.set(threadId, client);
    return client.turn(threadId, input, onEvent, onApproval, attachments, taskId);
  }
  public async inspectOutput(taskId: string, path: string): Promise<{ name: string; path: string; size: number; sha256: string }> {
    if (this.route(taskId) !== this.remote) throw new Error('FILE_WORKER_NOT_ENABLED');
    return this.remote.inspectOutput(taskId, path);
  }
  public async downloadOutput(taskId: string, name: string): Promise<Buffer> {
    if (this.route(taskId) !== this.remote) throw new Error('FILE_WORKER_NOT_ENABLED');
    return this.remote.downloadOutput(taskId, name);
  }
  public async importFile(taskId: string, attachment: Attachment): Promise<Attachment> {
    if (this.route(taskId) !== this.remote) throw new Error('FILE_WORKER_NOT_ENABLED');
    return this.remote.importFile(taskId, attachment);
  }
  public async inspectInput(taskId: string, name: string, excerpt: string, pages?: number[]): Promise<{ name: string; size: number; sha256: string; pageCount?: number }> {
    if (this.route(taskId) !== this.remote) throw new Error('FILE_WORKER_NOT_ENABLED');
    return this.remote.inspectInput(taskId, name, excerpt, pages);
  }
  public async writeEvidence(taskId: string, evidenceId: string, content: string): Promise<string> {
    if (this.route(taskId) !== this.remote) throw new Error('FILE_WORKER_NOT_ENABLED');
    return this.remote.writeEvidence(taskId, evidenceId, content);
  }
  public async runPython(taskId: string, code: string): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
    if (this.route(taskId) !== this.remote) throw new Error('FILE_WORKER_NOT_ENABLED');
    return this.remote.runPython(taskId, code);
  }
  public usesWorker(taskId: string): boolean { return this.route(taskId) === this.remote; }
}
