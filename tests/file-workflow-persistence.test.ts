import { describe, expect, it } from 'vitest';
import { InMemoryRepository } from '../src/persistence.js';

describe('file workflow durable state', () => {
  it('keeps the first execution mode across rollout changes', async () => {
    const repo = new InMemoryRepository();
    expect(await repo.bindTaskExecutionMode('task-1', 'worker')).toBe('worker');
    expect(await repo.bindTaskExecutionMode('task-1', 'local')).toBe('worker');
  });

  it('deduplicates submitted files while preserving distinct results', async () => {
    const repo = new InMemoryRepository();
    const first = { name: 'report.pdf', size: 12, sha256: 'a'.repeat(64) };
    await repo.saveTaskArtifact('task-1', first);
    await repo.saveTaskArtifact('task-1', first);
    await repo.saveTaskArtifact('task-1', { ...first, sha256: 'b'.repeat(64) });
    expect(await repo.listTaskArtifacts('task-1')).toHaveLength(2);
  });
});
