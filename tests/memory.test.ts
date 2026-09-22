import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import type { CodexApprovalRequest, CodexClient } from '../src/codex-client.js';
import type { DwsBroker } from '../src/dws-broker.js';
import { MemoryTool } from '../src/memory-tool.js';
import { InMemoryRepository } from '../src/persistence.js';
import { TaskOrchestrator, type MessageSender } from '../src/task-orchestrator.js';
import type { AgentRequest, ConversationSurface } from '../src/types.js';

function input(messageId: string, text: string, surface: ConversationSurface = { type: 'direct', id: 'user-1' }): AgentRequest {
  return {
    requestId: 'request-' + messageId,
    messageId,
    user: { corpId: 'corp-1', userId: 'user-1', displayName: '测试用户' },
    surface,
    text,
    attachments: [],
    receivedAt: Date.now()
  };
}

describe('user memory', () => {
  it('rejects secrets and isolates memories by user', async () => {
    const repo = new InMemoryRepository();
    const tool = new MemoryTool(repo);
    expect(() => tool.parse({ operation: 'set', key: 'API key', value: 'abc' })).toThrow('MEMORY_SENSITIVE_CONTENT_REJECTED');
    await tool.execute({ corpId: 'corp', userId: 'alice' }, tool.parse({ operation: 'set', key: '语言', value: '中文' }));
    expect(await repo.listUserMemories({ corpId: 'corp', userId: 'alice' })).toHaveLength(1);
    expect(await repo.listUserMemories({ corpId: 'corp', userId: 'bob' })).toHaveLength(0);
  });

  it('requires confirmation and shares filtered preferences across conversation surfaces', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const prompts: string[] = [];
    const codex = {
      startThread: vi.fn(async (user: AgentRequest['user']) => 'thread-' + user.userId + '-' + Math.random()),
      turn: vi.fn(async (
        threadId: string,
        prompt: string,
        _onEvent: unknown,
        onRequest: (request: CodexApprovalRequest) => Promise<any>
      ) => {
        prompts.push(prompt);
        if (prompt.includes('请记住')) {
          const response = await onRequest({
            method: 'item/tool/call',
            params: {
              namespace: 'agent',
              tool: 'memory',
              arguments: { operation: 'set', key: '回复语言', value: '中文' }
            }
          });
          expect(response.success).toBe(true);
        }
        return { text: '完成', threadId };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = {
      async send(_surface, markdown) { sent.push(markdown); }
    };
    const orchestrator = new TaskOrchestrator(
      loadConfig({ DINGTALK_ROBOT_CODE: 'robot', NODE_ENV: 'test' }),
      repo,
      codex,
      {} as DwsBroker,
      sender
    );

    const task = await orchestrator.accept(input('remember-1', '请记住以后用中文回复'));
    await vi.waitFor(() => expect(sent.some((message) => message.includes('等待确认'))).toBe(true));
    expect(await repo.listUserMemories(input('x', '').user)).toHaveLength(0);
    await orchestrator.handleControl(input('remember-confirm', '确认 ' + task!.id));
    await vi.waitFor(() => expect(sent.some((message) => message === '完成')).toBe(true));
    expect(await repo.listUserMemories(input('x', '').user)).toMatchObject([{ key: '回复语言', value: '中文' }]);

    await orchestrator.accept(input('remember-2', '总结本周事项', { type: 'group', id: 'group-1' }));
    await vi.waitFor(() => expect(prompts.length).toBe(2));
    expect(prompts[1]).toContain('"key":"回复语言"');
    expect(prompts[1]).toContain('"value":"中文"');
  });
});
