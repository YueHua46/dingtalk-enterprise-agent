import { describe, expect, it, vi } from 'vitest';
import { CodexClient } from '../src/codex-client.js';
import { RemoteCodexClient } from '../src/remote-codex-client.js';

describe('Codex turn interruption', () => {
  it('passes the active local turn ID and ignores finished or unrelated turns', async () => {
    const client = new CodexClient({} as any);
    const request = vi.fn().mockResolvedValue({});
    (client as any).request = request;
    (client as any).turns = new Map([
      ['finished', { threadId: 'thread', turnId: 'finished', completed: {} }],
      ['other', { threadId: 'other', turnId: 'other' }],
      ['active', { threadId: 'thread', turnId: 'active' }]
    ]);
    await client.interrupt('thread');
    expect(request).toHaveBeenCalledWith('turn/interrupt', { threadId: 'thread', turnId: 'active' });
    await client.interrupt('missing');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('passes the active worker turn ID and skips an idle worker', async () => {
    const client = new RemoteCodexClient({} as any);
    const request = vi.fn().mockResolvedValue({});
    (client as any).active.set('thread', { request });
    (client as any).activeTurnIds.set('thread', 'active');
    await client.interrupt('thread');
    expect(request).toHaveBeenCalledWith('turn/interrupt', { threadId: 'thread', turnId: 'active' });
    (client as any).activeTurnIds.clear();
    await client.interrupt('thread');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
