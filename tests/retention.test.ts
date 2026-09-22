import { mkdtemp, mkdir, stat, utimes, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { InMemoryRepository } from '../src/persistence.js';
import { RetentionService } from '../src/retention.js';
import type { AgentRequest } from '../src/types.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('RetentionService', () => {
  it('removes expired terminal task state and old media while preserving active data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-retention-'));
    temporaryRoots.push(root);
    const oldMedia = join(root, 'old-request');
    const currentMedia = join(root, 'current-request');
    await mkdir(oldMedia);
    await mkdir(currentMedia);
    await writeFile(join(oldMedia, 'old.txt'), 'old');
    await writeFile(join(currentMedia, 'current.txt'), 'current');
    const oldTime = new Date('2026-01-01T00:00:00Z');
    await utimes(oldMedia, oldTime, oldTime);

    const repo = new InMemoryRepository();
    const input: AgentRequest = {
      requestId: 'retention-request',
      messageId: 'retention-message',
      user: { corpId: 'corp', userId: 'user' },
      surface: { type: 'direct', id: 'user' },
      text: 'test',
      attachments: [],
      receivedAt: Date.now()
    };
    await repo.ensureUser(input.user);
    const surfaceId = await repo.ensureSurface(input.user, input.surface);
    const terminal = await repo.createTask(input, surfaceId);
    terminal.createdAt = oldTime.getTime();
    await repo.updateTask(terminal.id, 'completed');
    const active = await repo.createTask({ ...input, messageId: 'active-message' }, surfaceId);

    const service = new RetentionService(loadConfig({
      DINGTALK_ROBOT_CODE: 'robot',
      NODE_ENV: 'test',
      MEDIA_DIR: root,
      TASK_RETENTION_DAYS: '90'
    }), repo);
    await service.run(new Date('2026-09-21T00:00:00Z').getTime());

    expect(await repo.findTask(terminal.id)).toBeUndefined();
    expect(await repo.findTask(active.id)).toBeDefined();
    await expect(stat(oldMedia)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(currentMedia)).resolves.toBeDefined();
  });
});
