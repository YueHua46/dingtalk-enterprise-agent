import { describe, expect, it, vi } from 'vitest';
import type { DwsBroker } from '../src/dws-broker.js';
import { DwsTool } from '../src/dws-tool.js';

describe('DwsTool capability registry', () => {
  it('accepts generated capabilities and rejects arbitrary command paths', () => {
    const tool = new DwsTool({} as DwsBroker);
    expect(tool.parse({ capability: 'doc.search', args: ['--query', '周报'] })).toEqual({
      capability: 'doc.search',
      args: ['--query', '周报']
    });
    expect(() => tool.parse({ capability: 'shell.rm', args: [] })).toThrow('not registered');
    expect(() => tool.parse({ capability: 'doc.search', args: ['--profile', 'admin'] })).toThrow('forbidden');
  });

  it('uses registry risk and injects identity/output/confirmation flags in the broker layer', async () => {
    const runCommand = vi.fn(async () => ({ ok: true }));
    const tool = new DwsTool({ runCommand } as unknown as DwsBroker);
    const user = { corpId: 'corp', userId: 'user' };
    const read = tool.parse({ capability: 'doc.search', args: ['--query', '周报'] });
    expect(tool.classify(read)).toBe('read');
    await tool.execute(user, read, true);
    expect(runCommand).toHaveBeenLastCalledWith(user, ['doc', '+search', '--query', '周报']);

    const destructive = tool.parse({ capability: 'drive.delete', args: ['--node', 'node-1'] });
    expect(tool.classify(destructive)).toBe('high');
    await expect(tool.execute(user, destructive, false)).rejects.toThrow('DWS_CONFIRMATION_REQUIRED');
    await tool.execute(user, destructive, true);
    expect(runCommand).toHaveBeenLastCalledWith(user, ['drive', '+delete', '--node', 'node-1', '--yes']);
  });
});
