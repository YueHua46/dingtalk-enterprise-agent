import { readdir, rm, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { Config } from './config.js';
import type { Repository } from './persistence.js';

export class RetentionService {
  private timer?: NodeJS.Timeout;

  public constructor(private readonly config: Config, private readonly repo: Repository) {}

  public async start(): Promise<void> {
    await this.run();
    this.timer = setInterval(() => void this.run().catch((error) => {
      console.error('Retention cleanup failed:', error instanceof Error ? error.message : String(error));
    }), 6 * 60 * 60 * 1000);
    this.timer.unref();
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  public async run(now = Date.now()): Promise<void> {
    const cutoff = new Date(now - this.config.TASK_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await this.repo.prune(cutoff);
    await pruneMedia(this.config.MEDIA_DIR, cutoff.getTime());
    if (this.config.FILE_WORKER_MODE !== 'off' && this.config.FILE_WORKER_URL && this.config.FILE_WORKER_SECRET) {
      await this.pruneWorker(cutoff.getTime());
    }
  }

  private async pruneWorker(cutoffMs: number): Promise<void> {
    const base = this.config.FILE_WORKER_URL!.replace(/\/$/, '');
    const headers = { 'x-file-worker-secret': this.config.FILE_WORKER_SECRET! };
    const response = await fetch(base + '/tasks', { headers, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('FILE_WORKER_LIST_FAILED');
    const body = await response.json() as { taskIds?: string[] };
    for (const taskId of body.taskIds ?? []) {
      const task = await this.repo.findTask(taskId);
      if (task && (task.createdAt >= cutoffMs || !['completed', 'cancelled', 'failed'].includes(task.status))) continue;
      const deletion = await fetch(base + '/tasks/' + taskId, { method: 'DELETE', headers, signal: AbortSignal.timeout(30_000) });
      if (!deletion.ok && deletion.status !== 409) throw new Error('FILE_WORKER_DELETE_FAILED:' + taskId);
    }
  }
}

async function pruneMedia(mediaDir: string, cutoffMs: number): Promise<void> {
  const root = resolve(mediaDir);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const target = resolve(root, entry.name);
    if (!target.startsWith(root + sep)) throw new Error('Refusing to prune media outside configured root');
    const metadata = await stat(target);
    if (metadata.mtimeMs < cutoffMs) await rm(target, { recursive: true, force: false });
  }
}
