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
    expect(() => tool.parse({ capability: 'doc.create', args: ['--help'] })).toThrow('forbidden');
  });

  it('rejects guessed write flags against the installed leaf schema before approval', async () => {
    const schemaForCapability = vi.fn(async () => ({ cli_path: 'doc +create', parameters: { name: {}, content: {}, folder: {} } }));
    const tool = new DwsTool({ schemaForCapability } as unknown as DwsBroker);
    await expect(tool.validateArgs(tool.parse({ capability: 'doc.create', args: ['--title', '错误参数'] })))
      .rejects.toThrow('DWS_PARAMETER_NOT_IN_SCHEMA:--title');
    await expect(tool.validateArgs(tool.parse({ capability: 'doc.create', args: ['--name', '测试', '--content', '正文'] })))
      .resolves.toBeUndefined();
    expect(schemaForCapability).toHaveBeenCalledWith('doc.create');
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

  it('executes message-delivery capabilities without confirmation and always passes --yes', async () => {
    const runCommand = vi.fn(async () => ({ ok: true }));
    const tool = new DwsTool({ runCommand } as unknown as DwsBroker);
    const user = { corpId: 'corp', userId: 'user' };
    const dm = tool.parse({ capability: 'chat.dm', args: ['--to', '盛喜', '--content', '部门信息'] });
    expect(tool.isConfirmationFree(dm)).toBe(true);
    expect(tool.classify(dm)).toBe('write');
    await tool.execute(user, dm, false);
    expect(runCommand).toHaveBeenLastCalledWith(user, ['chat', '+dm', '--to', '盛喜', '--content', '部门信息', '--yes']);

    // Non-free writes without confirmation run WITHOUT --yes so the CLI's own
    // ConfirmSafety gate can refuse them (the orchestrator handles that error).
    const todo = tool.parse({ capability: 'todo.task.create', args: ['--title', '测试'] });
    expect(tool.isConfirmationFree(todo)).toBe(false);
    await tool.execute(user, todo, false);
    expect(runCommand).toHaveBeenLastCalledWith(user, ['todo', 'task', 'create', '--title', '测试']);
  });
});
