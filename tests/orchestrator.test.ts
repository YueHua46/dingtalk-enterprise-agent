import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import type { CodexClient, CodexApprovalRequest } from '../src/codex-client.js';
import type { DwsBroker } from '../src/dws-broker.js';
import { InMemoryRepository } from '../src/persistence.js';
import { TaskOrchestrator, type MessageSender } from '../src/task-orchestrator.js';
import { actionHash } from '../src/security.js';
import type { AgentRequest, ConversationSurface, ToolAction, UserIdentity } from '../src/types.js';

const writeArguments = {
  capability: 'todo.create',
  args: ['--title', '测试待办']
};

const writeAction: ToolAction = {
  name: '钉钉 todo.create',
  risk: 'write',
  target: '--title 测试待办',
  parameters: writeArguments
};

function writeToolRequest(): CodexApprovalRequest {
  return {
    method: 'item/tool/call',
    params: {
      namespace: 'dingtalk',
      tool: 'dws',
      arguments: writeArguments
    }
  };
}

function request(messageId: string, text = '查找文档'): AgentRequest {
  return {
    requestId: 'request-' + messageId,
    messageId,
    user: { corpId: 'corp-1', userId: 'user-1', displayName: '测试用户' },
    surface: { type: 'direct', id: 'user-1' },
    text,
    attachments: [],
    receivedAt: Date.now()
  };
}

async function waitUntil(check: () => boolean): Promise<void> {
  await vi.waitFor(() => expect(check()).toBe(true), { timeout: 2000, interval: 10 });
}

describe('TaskOrchestrator integration', () => {
  it('resets only the current surface thread for a new-session control command', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const codex = { startThread: vi.fn(async () => 'thread'), turn: vi.fn(), interrupt: vi.fn(async () => undefined) } as unknown as CodexClient;
    const sender: MessageSender = { async send(_surface, markdown) { sent.push(markdown); } };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, {} as DwsBroker, sender);
    const first = await orchestrator.accept(request('session-seed', '你好'));
    await waitUntil(() => sent.length > 0);
    const surfaceId = await repo.ensureSurface(request('session-seed').user, request('session-seed').surface);
    await repo.setSurfaceThread(surfaceId, 'old-thread');
    expect(await repo.getSurfaceThread(surfaceId)).toBe('old-thread');
    expect(await orchestrator.handleControl({ ...request('session-new', '新会话') })).toBe(true);
    expect(await repo.getSurfaceThread(surfaceId)).toBeUndefined();
    expect(sent.at(-1)).toContain('已开启新会话');
    expect(first).toBeDefined();
  });
  it('routes tool progress to activity and streams only answer text to content', async () => {
    const repo = new InMemoryRepository();
    const answer = '这是自然语言最终答案。'.repeat(7);
    const writes: Array<{ kind: 'answer' | 'activity'; content: string; status: number }> = [];
    const codex = {
      startThread: vi.fn(async () => 'thread-dual'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<any>) => {
        await onRequest({ method: 'item/tool/call', params: { namespace: 'reference', tool: 'read_guide', arguments: { name: 'dingtalk-office' } } });
        return { text: answer, threadId: 'thread-dual' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = {
      async send() { throw new Error('must stay in one card'); },
      async beginTaskCard() { return 'dual-card'; },
      async updateTaskCard(_bizId, content, status) { writes.push({ kind: 'answer', content, status }); },
      async updateTaskActivity(_bizId, activity, status) { writes.push({ kind: 'activity', content: activity, status }); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot', DINGTALK_CARD_ACTIVITY_IN_PROCESSING: 'true' }), repo, codex, {} as DwsBroker, sender);
    await orchestrator.accept(request('message-dual', '测试'));
    await waitUntil(() => writes.at(-1)?.content === answer && writes.at(-1)?.status === 3);
    const toolWrite = writes.find((item) => item.kind === 'activity' && item.content.includes('读取 Skill'));
    const firstAnswer = writes.findIndex((item) => item.kind === 'answer');
    const activityClear = writes.findIndex((item) => item.kind === 'activity' && item.content === '');
    expect(toolWrite?.status).toBe(1);
    expect(firstAnswer).toBeGreaterThan(writes.indexOf(toolWrite!));
    expect(activityClear).toBe(firstAnswer + 1);
    expect(writes[activityClear]?.status).toBe(2);
    expect(writes.filter((item) => item.kind === 'activity' && item.status === 3)).toHaveLength(0);
    expect(writes.filter((item) => item.kind === 'answer').every((item) => !item.content.includes('正在使用工具'))).toBe(true);
  });

  it('uses one persistent card for thinking, tool activity and the final answer', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const updates: Array<{ content: string; status: number; mode?: string }> = [];
    const codex = {
      startThread: vi.fn(async () => 'thread-card'),
      turn: vi.fn(async (_thread: string, _input: string, onEvent: (event: any) => void, onRequest: (request: CodexApprovalRequest) => Promise<any>) => {
        onEvent({ method: 'item/started', params: { item: { type: 'agentMessage', id: 'comment-1', phase: 'commentary' } } });
        onEvent({ method: 'item/agentMessage/delta', params: { threadId: 'thread-card', itemId: 'comment-1', delta: '我先查看资料，稍后回答。' } });
        await onRequest({ method: 'item/tool/call', params: { namespace: 'reference', tool: 'read_guide', arguments: { name: 'dingtalk-office' } } });
        return { text: '测试回答', threadId: 'thread-card' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = {
      async send(_surface, markdown) { sent.push(markdown); },
      async beginTaskCard() { return 'card-1'; },
      async updateTaskCard(_bizId, content, status, mode) { updates.push({ content, status, mode }); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, {} as DwsBroker, sender);
    const task = await orchestrator.accept(request('message-card', '测试'));
    expect(task?.cardBizId).toBe('card-1');
    await waitUntil(() => updates.some((item) => item.status === 3));
    expect(updates.some((item) => item.status === 2)).toBe(true);
    expect(updates.at(-1)).toMatchObject({ status: 3 });
    expect(updates.at(-1)?.content).toBe('测试回答');
    expect(updates.some((item) => item.mode === 'static' && item.content.includes('正在使用工具'))).toBe(true);
    expect(updates.some((item) => item.mode === 'static' && item.content.includes('已完成：读取 Skill'))).toBe(true);
    expect(updates.every((item) => item.content !== '')).toBe(true);
    expect(sent).toHaveLength(0);
    expect((await repo.findTask(task!.id))?.cardBizId).toBe('card-1');
  });

  it('falls back to one natural-language answer if card creation fails without retrying the external write', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const beginTaskCard = vi.fn(async () => { throw new Error('card create failed'); });
    const codex = {
      startThread: vi.fn(async () => 'thread-fallback'),
      turn: vi.fn(async () => ({ text: '可读结果', threadId: 'thread-fallback' })),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = {
      async send(_surface, markdown) { sent.push(markdown); },
      beginTaskCard,
      async updateTaskCard() { throw new Error('should not update a missing card'); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, {} as DwsBroker, sender);
    await orchestrator.accept(request('message-fallback', '测试'));
    await waitUntil(() => sent.some((item) => item.includes('可读结果')));
    expect(beginTaskCard).toHaveBeenCalledTimes(1);
    expect(sent).toEqual(['可读结果']);
  });

  it('finalizes a failed card with a safe public message while retaining internal diagnostics', async () => {
    const repo = new InMemoryRepository();
    const internalError = 'unexpected status 503 Service Unavailable: No available accounts; request_id=req-secret; url=http://internal.example/v1';
    const writes: Array<{ kind: 'answer' | 'activity'; content: string; status: number }> = [];
    const sent: string[] = [];
    const codex = {
      startThread: vi.fn(async () => 'thread-failed-card'),
      turn: vi.fn(async () => { throw new Error(internalError); }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = {
      async send(_surface, markdown) { sent.push(markdown); },
      async beginTaskCard() { return 'failed-card'; },
      async updateTaskCard(_bizId, content, status) { writes.push({ kind: 'answer', content, status }); },
      async updateTaskActivity(_bizId, activity, status) { writes.push({ kind: 'activity', content: activity, status }); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({
      DINGTALK_ROBOT_CODE: 'robot',
      DINGTALK_CARD_ACTIVITY_IN_PROCESSING: 'true'
    }), repo, codex, {} as DwsBroker, sender);

    const task = await orchestrator.accept(request('message-failed-card', '联网查询今天新闻'));
    await waitUntil(() => writes.some((item) => item.kind === 'answer' && item.status === 3));

    const final = writes.findLast((item) => item.kind === 'answer');
    expect(final).toEqual({ kind: 'answer', content: '当前模型服务暂时不可用，请稍后再试。', status: 3 });
    expect(writes.some((item) => item.status === 5)).toBe(false);
    expect(writes.some((item) => item.kind === 'activity' && item.content === '' && item.status === 2)).toBe(true);
    expect(final?.content).not.toContain('request_id');
    expect(final?.content).not.toContain('internal.example');
    expect(final?.content).not.toContain(task!.id);
    expect(sent).toHaveLength(0);

    const stored = await repo.findTask(task!.id);
    expect(stored?.status).toBe('failed');
    expect(stored?.errorCode).toContain(internalError);
  });

  it('serves the public skill guide as a read-only dynamic tool without confirmation', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const codex = {
      startThread: vi.fn(async () => 'thread-guide'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<any>) => {
        const response = await onRequest({ method: 'item/tool/call', params: {
          namespace: 'reference', tool: 'read_guide', arguments: { name: 'dingtalk-office' }
        } });
        expect(response.success).toBe(true);
        expect(response.contentItems[0].text).toContain('# 钉钉办公 Skill');
        return { text: '已读取说明', threadId: 'thread-guide' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = { async send(_surface, markdown) { sent.push(markdown); } };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, {} as DwsBroker, sender);
    await orchestrator.accept(request('message-guide', '读取说明'));
    await waitUntil(() => sent.some((item) => item === '已读取说明'));
    expect(sent.some((item) => item.includes('等待确认'))).toBe(false);
  });

  it('starts user OAuth only when the model invokes a DWS tool', async () => {
    const repo = new InMemoryRepository();
    const direct: string[] = [];
    const codex = {
      startThread: vi.fn(async () => 'thread-oauth-preflight'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<any>) => {
        const response = await onRequest({ method: 'item/tool/call', params: {
          namespace: 'dingtalk', tool: 'dws', arguments: { capability: 'contact.me' }
        } });
        expect(response.success).toBe(true);
        return { text: '授权后查询结果', threadId: 'thread-oauth-preflight' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const dws = {
      status: vi.fn(async () => null),
      beginDeviceAuthorization: vi.fn(async () => ({ prompt: '请打开设备授权链接', completion: Promise.resolve({ corpId: 'corp-1', userId: 'user-1', profileKey: 'corp-1:user-1' }) })),
      runCommand: vi.fn(async () => ({ userId: 'user-1' }))
    } as unknown as DwsBroker;
    const sender: MessageSender = {
      async send() { throw new Error('group card should be used when available'); },
      async beginTaskCard() { return 'oauth-card'; },
      async updateTaskCard() { },
      async sendDirect(_user, markdown) { direct.push(markdown); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, dws, sender);
    await orchestrator.accept(request('message-oauth-preflight', '使用钉钉工具查我的部门'));
    await waitUntil(() => direct.some((item) => item.includes('设备授权链接')));
    expect(dws.status).toHaveBeenCalledWith(expect.objectContaining({ corpId: 'corp-1', userId: 'user-1' }));
    expect(dws.beginDeviceAuthorization).toHaveBeenCalledTimes(1);
    expect(direct[0]).toContain('设备授权链接');
    expect(dws.runCommand).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }), expect.any(Array));
  });

  it('retries device authorization once and continues the task after a transient failure', async () => {
    const repo = new InMemoryRepository();
    const direct: string[] = [];
    const codex = {
      startThread: vi.fn(async () => 'thread-oauth-retry'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<any>) => {
        const response = await onRequest({ method: 'item/tool/call', params: {
          namespace: 'dingtalk', tool: 'dws', arguments: { capability: 'contact.me' }
        } });
        expect(response.success).toBe(true);
        return { text: '授权后查询结果', threadId: 'thread-oauth-retry' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const dws = {
      status: vi.fn(async () => null),
      beginDeviceAuthorization: vi.fn()
        .mockRejectedValueOnce(new Error('DWS_AUTH_INIT_FAILED: 设备授权进程在输出授权链接前退出（code 3）'))
        .mockResolvedValueOnce({ prompt: '请打开设备授权链接', completion: Promise.resolve({ corpId: 'corp-1', userId: 'user-1', profileKey: 'corp-1:user-1' }) }),
      runCommand: vi.fn(async () => ({ userId: 'user-1' }))
    } as unknown as DwsBroker;
    const sender: MessageSender = {
      async send() { throw new Error('group card should be used when available'); },
      async beginTaskCard() { return 'oauth-retry-card'; },
      async updateTaskCard() { },
      async sendDirect(_user, markdown) { direct.push(markdown); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, dws, sender);
    const task = await orchestrator.accept(request('message-oauth-retry', '使用钉钉工具查我的部门'));
    await waitUntil(() => direct.some((item) => item.includes('设备授权链接')));
    expect(dws.beginDeviceAuthorization).toHaveBeenCalledTimes(2);
    expect(dws.runCommand).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }), expect.any(Array));
    const stored = await repo.findTask(task!.id);
    expect(stored?.status).toBe('completed');
  });

  it('returns actionable guidance instead of raw errors when device authorization cannot start', async () => {
    const repo = new InMemoryRepository();
    const direct: string[] = [];
    let toolResponse: { success?: boolean; text?: string } | undefined;
    const codex = {
      startThread: vi.fn(async () => 'thread-oauth-init-failed'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<any>) => {
        const response = await onRequest({ method: 'item/tool/call', params: {
          namespace: 'dingtalk', tool: 'dws', arguments: { capability: 'contact.me' }
        } });
        toolResponse = { success: response.success, text: response.contentItems[0].text };
        return { text: '授权服务暂时不可用，请稍后重新发送任务。', threadId: 'thread-oauth-init-failed' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const dws = {
      status: vi.fn(async () => null),
      beginDeviceAuthorization: vi.fn(async () => { throw new Error('DWS_AUTH_INIT_FAILED: 设备授权进程在输出授权链接前退出（code 3）；进程输出尾部：oauth client not configured'); }),
      runCommand: vi.fn()
    } as unknown as DwsBroker;
    const sender: MessageSender = {
      async send() { throw new Error('group card should be used when available'); },
      async beginTaskCard() { return 'oauth-failed-card'; },
      async updateTaskCard() { },
      async sendDirect(_user, markdown) { direct.push(markdown); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, dws, sender);
    const task = await orchestrator.accept(request('message-oauth-init-failed', '使用钉钉工具查我的部门'));
    await waitUntil(() => toolResponse !== undefined);
    expect(dws.beginDeviceAuthorization).toHaveBeenCalledTimes(2);
    expect(toolResponse?.success).toBe(false);
    expect(toolResponse?.text).toContain('授权服务暂时不可用');
    expect(toolResponse?.text).toContain('重新发送原任务');
    expect(toolResponse?.text).not.toContain('code 3');
    expect(toolResponse?.text).not.toContain('oauth client not configured');
    // No authorization link was ever produced, so the bot must not claim one was sent.
    expect(direct.some((item) => item.includes('设备授权'))).toBe(false);
    const stored = await repo.findTask(task!.id);
    expect(['completed', 'running']).toContain(stored?.status);
  });

  it('does not route or start OAuth from message keywords alone', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const codex = {
      startThread: vi.fn(async () => 'thread-no-keywords'),
      turn: vi.fn(async () => ({ text: '我会按需查询。', threadId: 'thread-no-keywords' })),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const dws = {
      status: vi.fn(async () => null),
      beginDeviceAuthorization: vi.fn()
    } as unknown as DwsBroker;
    const sender: MessageSender = { async send(_surface, markdown) { sent.push(markdown); } };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, dws, sender);
    await orchestrator.accept(request('message-no-keywords', '使用钉钉工具查我的部门'));
    await waitUntil(() => sent.includes('我会按需查询。'));
    expect(dws.status).not.toHaveBeenCalled();
    expect(dws.beginDeviceAuthorization).not.toHaveBeenCalled();
  });

  it('denies Codex shell escalation without asking a chat user to approve it', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const codex = {
      startThread: vi.fn(async () => 'thread-shell'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<unknown>) => {
        expect(await onRequest({ method: 'item/commandExecution/requestApproval', params: {
          command: '/bin/sh -lc "cat /var/lib/dws/keychain/secret"', cwd: '/app/workspaces'
        } })).toEqual({ decision: 'cancel' });
        return { text: '未读取凭证', threadId: 'thread-shell' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = { async send(_surface, markdown) { sent.push(markdown); } };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, {} as DwsBroker, sender);
    await orchestrator.accept(request('message-shell', '你好'));
    await waitUntil(() => sent.some((item) => item === '未读取凭证'));
    expect(sent.some((item) => item.includes('等待确认'))).toBe(false);
  });

  it('deduplicates inbound events and serializes tasks per user', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    let active = 0;
    let maxActive = 0;
    const codex = {
      startThread: vi.fn(async () => 'thread-1'),
      turn: vi.fn(async (_thread: string, input: string) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 25));
        active -= 1;
        return { text: '完成：' + input.split('\n').at(-1), threadId: 'thread-1' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const dws = {} as DwsBroker;
    const sender: MessageSender = {
      async send(_surface: ConversationSurface, markdown: string) { sent.push(markdown); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, dws, sender);

    const first = await orchestrator.accept(request('message-1'));
    const duplicate = await orchestrator.accept(request('message-1'));
    const second = await orchestrator.accept(request('message-2', '查日历'));

    expect(first).toBeDefined();
    expect(duplicate).toBeUndefined();
    expect(second).toBeDefined();
    await waitUntil(() => sent.filter((item) => item.startsWith('完成：')).length === 2);
    expect(maxActive).toBe(1);
    expect(codex.turn).toHaveBeenCalledTimes(2);
  });

  it('does not execute a DWS write before the originating user confirms', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const executed: Array<{ user: UserIdentity; args: string[] }> = [];
    const broker = {
      status: vi.fn(async (user: UserIdentity) => ({ ...user, profileKey: user.corpId + ':' + user.userId })),
      runCommand: vi.fn(async (user: UserIdentity, args: string[]) => {
        executed.push({ user, args });
        return { ok: true };
      })
    } as unknown as DwsBroker;
    const codex = {
      startThread: vi.fn(async () => 'thread-write'),
      turn: vi.fn(async (
        _thread: string,
        _input: string,
        _onEvent: unknown,
        onRequest: (request: CodexApprovalRequest) => Promise<unknown>
      ) => {
        const result = await onRequest(writeToolRequest());
        expect(result).toMatchObject({ success: true });
        return { text: '待办已创建', threadId: 'thread-write' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = {
      async send(_surface: ConversationSurface, markdown: string) { sent.push(markdown); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, broker, sender);
    const task = await orchestrator.accept(request('message-write', '创建一个测试待办'));
    expect(task).toBeDefined();
    await waitUntil(() => sent.some((item) => item.includes('等待确认')));
    expect(executed).toHaveLength(0);

    const handled = await orchestrator.handleControl(request('message-confirm', '确认 ' + task!.id));
    expect(handled).toBe(true);
    await waitUntil(() => executed.length === 1 && sent.some((item) => item === '待办已创建'));
    expect(executed[0]!.user.userId).toBe('user-1');
    expect(executed[0]!.args).toContain('--yes');
  });

  it('reuses a completed DWS write result instead of executing the write twice', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const broker = {
      status: vi.fn(async (user: UserIdentity) => ({ ...user, profileKey: user.corpId + ':' + user.userId })),
      runCommand: vi.fn(async () => ({ id: 'todo-1', ok: true }))
    } as unknown as DwsBroker;
    const codex = {
      startThread: vi.fn(async () => 'thread-idempotent'),
      turn: vi.fn(async (
        _thread: string,
        _input: string,
        _onEvent: unknown,
        onRequest: (request: CodexApprovalRequest) => Promise<any>
      ) => {
        const first = await onRequest(writeToolRequest());
        expect(first.success).toBe(true);
        const second = await onRequest(writeToolRequest());
        expect(second).toEqual(first);
        return { text: '待办已创建', threadId: 'thread-idempotent' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = {
      async send(_surface: ConversationSurface, markdown: string) { sent.push(markdown); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, broker, sender);
    const task = await orchestrator.accept(request('message-idempotent', '创建一个测试待办'));
    await waitUntil(() => sent.some((item) => item.includes('等待确认')));
    await orchestrator.handleControl(request('confirm-idempotent', '确认 ' + task!.id));
    await waitUntil(() => sent.some((item) => item === '待办已创建'));
    expect(broker.runCommand).toHaveBeenCalledTimes(1);
  });

  it('does not retry a DWS write whose outcome is unknown', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const responses: any[] = [];
    const broker = {
      status: vi.fn(async (user: UserIdentity) => ({ ...user, profileKey: user.corpId + ':' + user.userId })),
      runCommand: vi.fn(async () => { throw new Error('network timeout after dispatch'); })
    } as unknown as DwsBroker;
    const codex = {
      startThread: vi.fn(async () => 'thread-unknown'),
      turn: vi.fn(async (
        _thread: string,
        _input: string,
        _onEvent: unknown,
        onRequest: (request: CodexApprovalRequest) => Promise<any>
      ) => {
        responses.push(await onRequest(writeToolRequest()));
        responses.push(await onRequest(writeToolRequest()));
        return { text: '写入结果未知，已停止重试', threadId: 'thread-unknown' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = {
      async send(_surface: ConversationSurface, markdown: string) { sent.push(markdown); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, broker, sender);
    const task = await orchestrator.accept(request('message-unknown', '创建一个测试待办'));
    await waitUntil(() => sent.some((item) => item.includes('等待确认')));
    await orchestrator.handleControl(request('confirm-unknown', '确认 ' + task!.id));
    await waitUntil(() => sent.some((item) => item === '写入结果未知，已停止重试'));
    expect(broker.runCommand).toHaveBeenCalledTimes(1);
    expect(responses[0]).toMatchObject({ success: false });
    expect(responses[1]).toMatchObject({ success: false });
    expect(responses[1].contentItems[0].text).toContain('WRITE_OUTCOME_UNKNOWN');
  });

  it('recovers an approved persisted write after a process restart', async () => {
    const repo = new InMemoryRepository();
    const original = request('message-recover', '创建一个测试待办');
    await repo.ensureUser(original.user);
    const surfaceId = await repo.ensureSurface(original.user, original.surface);
    const task = await repo.createTask(original, surfaceId);
    await repo.updateTask(task.id, 'waiting_confirmation', { threadId: 'thread-recover' });
    await repo.saveApproval({
      taskId: task.id,
      user: original.user,
      action: writeAction,
      parameterHash: actionHash(writeAction),
      expiresAt: Date.now() + 60_000
    }, 'business');
    await repo.decideApproval(task.id, 'approved');

    const sent: string[] = [];
    const broker = {
      status: vi.fn(async (user: UserIdentity) => ({ ...user, profileKey: user.corpId + ':' + user.userId })),
      runCommand: vi.fn(async () => ({ id: 'todo-recovered', ok: true }))
    } as unknown as DwsBroker;
    const codex = {
      startThread: vi.fn(async () => 'thread-recover'),
      turn: vi.fn(async (
        _thread: string,
        _input: string,
        _onEvent: unknown,
        onRequest: (request: CodexApprovalRequest) => Promise<any>
      ) => {
        const result = await onRequest(writeToolRequest());
        expect(result.success).toBe(true);
        return { text: '恢复完成', threadId: 'thread-recover' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = {
      async send(_surface: ConversationSurface, markdown: string) { sent.push(markdown); }
    };
    const restarted = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, broker, sender);
    await restarted.recover();
    await waitUntil(() => sent.some((item) => item === '恢复完成'));
    expect(broker.runCommand).toHaveBeenCalledTimes(1);
    expect((await repo.findTask(task.id))?.status).toBe('completed');
  });
});
