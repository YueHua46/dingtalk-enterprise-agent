import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexClient } from '../src/codex-client.js';
import { HybridCodexClient } from '../src/hybrid-codex-client.js';
import { RemoteCodexClient } from '../src/remote-codex-client.js';

afterEach(() => vi.restoreAllMocks());

describe('all-task worker mode', () => {
  it('starts only the worker client and routes new tasks there', async () => {
    const localStart = vi.spyOn(CodexClient.prototype, 'start').mockResolvedValue();
    const workerStart = vi.spyOn(RemoteCodexClient.prototype, 'start').mockResolvedValue();
    vi.spyOn(RemoteCodexClient.prototype, 'isReady').mockReturnValue(true);
    const client = new HybridCodexClient({ FILE_WORKER_MODE: 'all', FILE_WORKER_TEST_SURFACES: '' } as any);

    await client.start();
    client.selectTask('task-1', { type: 'direct', id: 'user-1' });

    expect(localStart).not.toHaveBeenCalled();
    expect(workerStart).toHaveBeenCalledOnce();
    expect(client.usesWorker('task-1')).toBe(true);
    expect(client.usesWorker('task-without-explicit-route')).toBe(true);
    expect(client.isReady()).toBe(true);
  });
});
