import { describe, expect, it, vi } from 'vitest';
import { ZiniaoBroker } from '../src/ziniao-broker.js';
import { ZiniaoTool } from '../src/ziniao-tool.js';

const user = { corpId: 'corp-a', userId: 'seller-1' };

describe('Ziniao user isolation and command policy', () => {
  it('uses a distinct opaque home for each DingTalk identity', () => {
    const broker = new ZiniaoBroker({ ZINIAO_BIN: 'ziniao-cli', ZINIAO_USERS_DIR: '/var/lib/ziniao/users' });
    const first = broker.userHome(user);
    expect(first).toBe(broker.userHome(user));
    expect(first).not.toBe(broker.userHome({ corpId: 'corp-a', userId: 'seller-2' }));
    expect(first).not.toBe(broker.userHome({ corpId: 'corp-b', userId: 'seller-1' }));
    expect(first).not.toContain('seller-1');
  });

  it('executes only explicit reads without confirmation and rejects profile overrides', async () => {
    const broker = { runCommand: vi.fn(async () => ({ ok: true })) } as unknown as ZiniaoBroker;
    const tool = new ZiniaoTool(broker);
    const read = tool.parse({ capability: 'account.list', args: ['--name', 'shop'] });
    expect(tool.action(read).risk).toBe('read');
    await tool.execute(user, read, false, { taskId: 'task-1' });
    expect(broker.runCommand).toHaveBeenCalledWith(user, ['account', 'list', '--name', 'shop'], { taskId: 'task-1' });
    const write = tool.parse({ capability: 'account.update', args: ['--name', 'shop'] });
    expect(tool.action(write).risk).toBe('write');
    await expect(tool.execute(user, write, false)).rejects.toThrow('ZINIAO_CONFIRMATION_REQUIRED');
    expect(() => tool.parse({ capability: 'account.list', args: ['--profile', 'other-user'] })).toThrow('ZINIAO_CREDENTIAL_ARGUMENT_FORBIDDEN');
    expect(() => tool.parse({ capability: 'config.use', args: ['other-user'] })).toThrow('ZINIAO_CAPABILITY_NOT_ALLOWED');
    expect(tool.action(tool.parse({ capability: 'api.call', args: ['GET', '/app/builtin/company'] })).risk).toBe('write');
  });

  it('serves the queue snapshot in-process without confirmation or CLI calls', async () => {
    const snapshot = { busy: false, heldByMe: false, position: null, depth: 0, holder: null };
    const broker = { queueStatus: vi.fn(() => snapshot), runCommand: vi.fn() } as unknown as ZiniaoBroker;
    const tool = new ZiniaoTool(broker);
    const input = tool.parse({ capability: 'utility.queue-status' });
    expect(tool.action(input).risk).toBe('read');
    const result = await tool.execute(user, input, false);
    expect(result).toBe(snapshot);
    expect(broker.queueStatus).toHaveBeenCalledWith(user);
    expect(broker.runCommand).not.toHaveBeenCalled();
  });
});
