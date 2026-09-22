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
