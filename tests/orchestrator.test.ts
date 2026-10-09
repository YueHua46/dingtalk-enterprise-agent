import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from './test-config.js';
import type { CodexClient, CodexApprovalRequest } from '../src/codex-client.js';
import type { DwsBroker } from '../src/dws-broker.js';
import type { ZiniaoBroker } from '../src/ziniao-broker.js';
import { InMemoryRepository } from '../src/persistence.js';
import { isScreenshotDeliveryRequest, isWhitelistedReadOnlyMcpElicitation, TaskOrchestrator, type MessageSender } from '../src/task-orchestrator.js';
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

describe('native MCP elicitation policy', () => {
  it('does not approve native MCP calls outside the host broker', () => {
    expect(isWhitelistedReadOnlyMcpElicitation({
      method: 'mcpServer/elicitation/request',
      params: {
        serverName: 'sif',
        mode: 'form',
        message: 'Allow the sif MCP server to run tool "ping"?',
        requestedSchema: { type: 'object', properties: {} }
      }
    })).toBe(false);
  });

  it('rejects unknown tools, input forms, and non-form elicitations', () => {
    const base = {
      method: 'mcpServer/elicitation/request',
      params: {
        serverName: 'lingxing',
        mode: 'form',
        message: 'Allow the lingxing MCP server to run tool "action"?',
        requestedSchema: { type: 'object', properties: {} }
      }
    } satisfies CodexApprovalRequest;
    expect(isWhitelistedReadOnlyMcpElicitation(base)).toBe(false);
    expect(isWhitelistedReadOnlyMcpElicitation({
      ...base,
      params: { ...base.params, message: 'Allow the lingxing MCP server to run tool "help"?', requestedSchema: { type: 'object', properties: { value: { type: 'string' } } } }
    })).toBe(false);
    expect(isWhitelistedReadOnlyMcpElicitation({ ...base, params: { ...base.params, mode: 'url' } })).toBe(false);
  });
});

describe('screenshot delivery intent', () => {
  it('recognizes group delivery wording as direct screenshot intent', () => {
    expect(isScreenshotDeliveryRequest('截图发我')).toBe(true);
    expect(isScreenshotDeliveryRequest('把当前页面截图直接发到群里，不要说明文字')).toBe(true);
    expect(isScreenshotDeliveryRequest('获取当前页面截图')).toBe(false);
  });
});

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
  it.each([true, false])('finalizes image delivery immediately only with finalizeTask=%s', async (finalizeTask) => {
    const repo = new InMemoryRepository();
    let interruptTurn!: () => void;
    const interrupted = new Promise<void>((resolve) => { interruptTurn = resolve; });
    const codex = {
      startThread: vi.fn(async () => 'thread-image-fast'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<any>) => {
        const response = await onRequest({ method: 'item/tool/call', params: {
          namespace: 'image', tool: 'generate', arguments: { operation: 'generate', prompt: 'A red apple', finalizeTask }
        } });
        expect(response.success).toBe(true);
        if (finalizeTask) {
          await interrupted;
          throw new Error('turn interrupted');
        }
        return { text: '图片和文案已完成。', threadId: 'thread-image-fast' };
      }),
      interrupt: vi.fn(async () => { interruptTurn(); })
    } as unknown as CodexClient;
    const sender: MessageSender = { async send() {} };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, {} as DwsBroker, sender);
    vi.spyOn(orchestrator as any, 'generateAndDeliverImages').mockResolvedValue({ publicResult: {
      delivered: true, provider: 'gemini', model: 'gemini-3.1-flash-image', operation: 'generate', images: []
    } });

    const task = await orchestrator.accept(request('image-fast', '生成一张苹果图片'));
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));

    if (finalizeTask) expect(codex.interrupt).toHaveBeenCalledWith('thread-image-fast');
    else expect(codex.interrupt).not.toHaveBeenCalled();
    expect((await repo.findTask(task!.id))?.resultSummary).toBe(finalizeTask ? '图片已生成并发送到当前会话。' : '图片和文案已完成。');
    expect(repo.audits.some((item: any) => item.eventType === 'workflow.complete' && item.payload.source === 'image_delivery')).toBe(finalizeTask);
  });

  it('authorizes the invoking seller by private message and resumes a read', async () => {
    const repo = new InMemoryRepository();
    const direct: string[] = [];
    const broker = {
      status: vi.fn().mockResolvedValueOnce(null).mockResolvedValue({ profileKey: 'dingtalk-user-1' }),
      beginAuthorization: vi.fn(async () => ({ prompt: '授权地址：https://open.ziniao.com/memberAuth?cliRequestId=test', completion: Promise.resolve() })),
      runCommand: vi.fn(async () => ({ shops: [] }))
    } as unknown as ZiniaoBroker;
    const codex = {
      startThread: vi.fn(async () => 'thread-ziniao'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<any>) => {
        const response = await onRequest({ method: 'item/tool/call', params: {
          namespace: 'ziniao', tool: 'cli', arguments: { capability: 'account.list' }
        } });
        expect(response.success).toBe(true);
        return { text: '已查询店铺', threadId: 'thread-ziniao' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = {
      async send() {},
      async sendDirect(user, markdown) { expect(user.userId).toBe('user-1'); direct.push(markdown); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, {} as DwsBroker, sender, undefined, undefined, broker);
    const task = await orchestrator.accept(request('ziniao-first', '查我的紫鸟店铺'));
    await waitUntil(() => direct.length === 1);
    expect(broker.beginAuthorization).toHaveBeenCalledWith(expect.objectContaining({ corpId: 'corp-1', userId: 'user-1' }), expect.anything());
    expect(broker.runCommand).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }), ['account', 'list'], expect.anything());
    expect(direct[0]).toContain('memberAuth');
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));
    const toolEvents = repo.audits.filter((item: any) => item.eventType === 'tool.call_started' || item.eventType === 'tool.call_finished') as any[];
    expect(toolEvents.map((item) => item.eventType)).toEqual(['tool.call_started', 'tool.call_finished']);
    expect(toolEvents[0].payload).toMatchObject({ namespace: 'ziniao', tool: 'cli', argumentKeys: ['capability'] });
    expect(toolEvents[1].payload).toMatchObject({ status: 'success', evidenceId: expect.any(String) });
    expect(JSON.stringify(toolEvents)).not.toContain('account.list');
  });

  it('uses a saved Ziniao authorization without starting another authorization', async () => {
    const repo = new InMemoryRepository();
    const broker = {
      status: vi.fn(async () => ({ profileKey: 'saved' })),
      beginAuthorization: vi.fn(),
      runCommand: vi.fn(async () => ({ shops: [] }))
    } as unknown as ZiniaoBroker;
    const codex = {
      startThread: vi.fn(async () => 'thread-ziniao-saved'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<any>) => {
        const response = await onRequest({ method: 'item/tool/call', params: { namespace: 'ziniao', tool: 'cli', arguments: { capability: 'account.list' } } });
        expect(response.success).toBe(true);
        return { text: '已查询店铺', threadId: 'thread-ziniao-saved' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, {} as DwsBroker, { async send() {} }, undefined, undefined, broker);
    await orchestrator.accept(request('ziniao-saved', '查我的紫鸟店铺'));
    await waitUntil(() => (broker.runCommand as ReturnType<typeof vi.fn>).mock.calls.length === 1);
    expect(broker.beginAuthorization).not.toHaveBeenCalled();
  });

  it('does not reuse one DingTalk user\'s Ziniao authorization for another user', async () => {
    const repo = new InMemoryRepository();
    const direct: Array<{ userId: string; markdown: string }> = [];
    const authorized = new Set(['user-1']);
    const broker = {
      status: vi.fn(async (user: UserIdentity) => authorized.has(user.userId) ? { profileKey: 'dingtalk-' + user.userId } : null),
      beginAuthorization: vi.fn(async (user: UserIdentity) => {
        authorized.add(user.userId);
        return { prompt: '授权地址：https://open.ziniao.com/memberAuth?cliRequestId=' + user.userId, completion: Promise.resolve() };
      }),
      runCommand: vi.fn(async (user: UserIdentity) => ({ owner: user.userId }))
    } as unknown as ZiniaoBroker;
    const codex = {
      startThread: vi.fn(async (user: UserIdentity) => 'thread-' + user.userId),
      turn: vi.fn(async (threadId: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<any>) => {
        const response = await onRequest({ method: 'item/tool/call', params: {
          namespace: 'ziniao', tool: 'cli', arguments: { capability: 'store.list' }
        } });
        expect(response.success).toBe(true);
        return { text: '完成', threadId };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = {
      async send() {},
      async sendDirect(user, markdown) { direct.push({ userId: user.userId, markdown }); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, {} as DwsBroker, sender, undefined, undefined, broker);
    const first = await orchestrator.accept(request('ziniao-user-a', '查店铺'));
    await vi.waitFor(async () => expect((await repo.findTask(first!.id))?.status).toBe('completed'));
    expect(broker.beginAuthorization).not.toHaveBeenCalled();

    const secondRequest = { ...request('ziniao-user-b', '查店铺'), user: { corpId: 'corp-1', userId: 'user-2' }, surface: { type: 'direct' as const, id: 'user-2' } };
    const second = await orchestrator.accept(secondRequest);
    await vi.waitFor(async () => expect((await repo.findTask(second!.id))?.status).toBe('completed'));
    expect(broker.beginAuthorization).toHaveBeenCalledTimes(1);
    expect(broker.beginAuthorization).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-2' }), expect.anything());
    expect(direct).toEqual([expect.objectContaining({ userId: 'user-2', markdown: expect.stringContaining('memberAuth') })]);
    expect(broker.runCommand).toHaveBeenNthCalledWith(1, expect.objectContaining({ userId: 'user-1' }), ['store', 'list'], expect.anything());
    expect(broker.runCommand).toHaveBeenNthCalledWith(2, expect.objectContaining({ userId: 'user-2' }), ['store', 'list'], expect.anything());
  });

  it('opens a store and takes a screenshot without creating an approval', async () => {
    const repo = new InMemoryRepository();
    const broker = {
      status: vi.fn(async () => ({ profileKey: 'saved' })),
      runCommand: vi.fn(async (_user: UserIdentity, args: string[]) => {
        if (args[0] === 'store' && args[1] === 'open') return { storeId: '123', storeName: 'BAGWAT-US' };
        if (args[0] === 'page' && args[1] === 'extract') return { stores: [{ storeId: '123', storeName: 'BAGWAT-US' }] };
        return { base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' };
      })
    } as unknown as ZiniaoBroker;
    const codex = {
      startThread: vi.fn(async () => 'thread-ziniao-session'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<any>) => {
        const screenshotResponses: any[] = [];
        for (const [capability, args] of [
          ['store.open', ['--name', 'BAGWAT-US']],
          ['page.extract', ['--mode', 'running']],
          ['page.screenshot', ['--store-id', '123']],
          // A model may repeat the screenshot after the verifier asks for a
          // repair. The host must keep the user-facing file delivery idempotent.
          ['page.screenshot', ['--store-id', '123']]
        ] as const) {
          const result = await onRequest({ method: 'item/tool/call', params: {
            namespace: 'ziniao', tool: 'cli', arguments: { capability, args }
          } });
          expect(result.success).toBe(true);
          if (capability === 'page.screenshot') screenshotResponses.push(JSON.parse(result.contentItems[0].text));
        }
        expect(screenshotResponses[0]).toMatchObject({ delivered: true, delivery: { kind: 'screenshot', capabilityId: 'ziniao.cli' } });
        expect(screenshotResponses[1]).toMatchObject({ delivered: true, deduplicated: true, delivery: { kind: 'screenshot' } });
        return { text: '截图完成', threadId: 'thread-ziniao-session' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const delivered: string[] = [];
    const sender: MessageSender = {
      async send() {},
      async sendFile(_user, _surface, filePath) { delivered.push(filePath); },
      async beginApprovalCard() { throw new Error('unexpected approval'); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, {} as DwsBroker, sender, undefined, undefined, broker);
    const task = await orchestrator.accept(request('ziniao-session', '打开 BAGWAT-US 店铺，截图首页'));
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));
    expect(broker.runCommand).toHaveBeenCalledTimes(3);
    expect(delivered).toHaveLength(1);
    expect((await repo.audits).filter((item: any) => item.eventType === 'ziniao.screenshot_deduplicated')).toHaveLength(1);
    expect(await repo.getApproval(task!.id)).toBeUndefined();
  });

  it('delivers a new screenshot after the page generation changes', async () => {
    const repo = new InMemoryRepository();
    const broker = {
      status: vi.fn(async () => ({ profileKey: 'saved' })),
      runCommand: vi.fn(async (_user: UserIdentity, args: string[]) => {
        if (args[0] === 'store' && args[1] === 'open') return { storeId: '123', storeName: 'BAGWAT-US' };
        if (args[0] === 'page' && args[1] === 'extract') return { stores: [{ storeId: '123', storeName: 'BAGWAT-US' }] };
        if (args[0] === 'page' && args[1] === 'visit') return { url: 'https://sellercentral.amazon.co.uk/' };
        return { base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' };
      })
    } as unknown as ZiniaoBroker;
    const codex = {
      startThread: vi.fn(async () => 'thread-ziniao-generation'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<any>) => {
        for (const [capability, args] of [
          ['store.open', ['--name', 'BAGWAT-US']],
          ['page.extract', ['--mode', 'running']],
          ['page.screenshot', ['--store-id', '123']],
          ['page.visit', ['--url', 'https://sellercentral.amazon.co.uk/']],
          ['page.screenshot', ['--store-id', '123']]
        ] as const) {
          const response = await onRequest({ method: 'item/tool/call', params: {
            namespace: 'ziniao', tool: 'cli', arguments: { capability, args }
          } });
          expect(response.success).toBe(true);
        }
        return { text: '两张截图完成', threadId: 'thread-ziniao-generation' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const delivered: string[] = [];
    const sender: MessageSender = {
      async send() {},
      async sendFile(_user, _surface, filePath) { delivered.push(filePath); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, {} as DwsBroker, sender, undefined, undefined, broker);
    const task = await orchestrator.accept(request('ziniao-generation', '打开店铺，截图后切换英国站点再截图'));
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));
    expect(broker.runCommand).toHaveBeenCalledTimes(5);
    expect(delivered).toHaveLength(2);
    expect((await repo.getWorkflow(task!.id))?.ziniao?.screenshotDeliveries).toHaveLength(2);
  });

  it('does not suppress an independent artifact after a screenshot delivery', async () => {
    const repo = new InMemoryRepository();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const sha256 = (await import('node:crypto')).createHash('sha256').update(png).digest('hex');
    const broker = {
      status: vi.fn(async () => ({ profileKey: 'saved' })),
      runCommand: vi.fn(async (_user: UserIdentity, args: string[]) => {
        if (args[0] === 'store' && args[1] === 'open') return { storeId: '123', storeName: 'BAGWAT-US' };
        if (args[0] === 'page' && args[1] === 'extract') return { stores: [{ storeId: '123', storeName: 'BAGWAT-US' }] };
        return { base64: png.toString('base64') };
      })
    } as unknown as ZiniaoBroker;
    const codex = {
      startThread: vi.fn(async () => 'thread-ziniao-artifact'),
      usesWorker: vi.fn(() => true),
      selectTask: vi.fn(),
      inspectOutput: vi.fn(async () => ({ name: 'independent.png', size: png.length, sha256 })),
      downloadOutput: vi.fn(async () => png),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<any>) => {
        for (const request of [
          { namespace: 'ziniao', tool: 'cli', arguments: { capability: 'store.open', args: ['--name', 'BAGWAT-US'] } },
          { namespace: 'ziniao', tool: 'cli', arguments: { capability: 'page.extract', args: ['--mode', 'running'] } },
          { namespace: 'ziniao', tool: 'cli', arguments: { capability: 'page.screenshot', args: ['--store-id', '123'] } },
          { namespace: 'artifact', tool: 'submit', arguments: { path: 'independent.png' } }
        ]) {
          const response = await onRequest({ method: 'item/tool/call', params: request });
          expect(response.success).toBe(true);
        }
        return { text: '截图和独立附件都已发送', threadId: 'thread-ziniao-artifact' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const delivered: string[] = [];
    const sender: MessageSender = {
      async send() {},
      async sendFile(_user, _surface, filePath) { delivered.push(filePath); }
    };
    const dws = { status: vi.fn(async () => ({ profileKey: 'dws-saved' })) } as unknown as DwsBroker;
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, dws, sender, undefined, undefined, broker);
    const task = await orchestrator.accept(request('ziniao-artifact', '打开店铺，截图发我，再发送一个独立附件'));
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));
    expect(delivered).toHaveLength(2);
    expect((await repo.audits).some((item: any) => item.eventType === 'artifact.submitted')).toBe(true);
  });

  it('blocks page operations until the opened store is verified', async () => {
    const repo = new InMemoryRepository();
    const broker = {
      status: vi.fn(async () => ({ profileKey: 'saved' })),
      runCommand: vi.fn(async () => ({ storeId: '123', storeName: 'BAGWAT-US' }))
    } as unknown as ZiniaoBroker;
    let results: Array<{ success: boolean; text: string }> = [];
    const codex = {
      startThread: vi.fn(async () => 'thread-ziniao-precondition'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<any>) => {
        for (const [capability, args] of [
          ['store.open', ['--name', 'BAGWAT-US']],
          ['page.screenshot', ['--store-id', '123']]
        ] as const) {
          const response = await onRequest({ method: 'item/tool/call', params: {
            namespace: 'ziniao', tool: 'cli', arguments: { capability, args }
          } });
          results.push({ success: response.success, text: response.contentItems?.[0]?.text ?? '' });
        }
        return { text: '完成', threadId: 'thread-ziniao-precondition' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, {} as DwsBroker, { async send() {} }, undefined, undefined, broker);
    const task = await orchestrator.accept(request('ziniao-precondition', '打开店铺后截图'));
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('failed'));
    expect(results[0]).toMatchObject({ success: true });
    expect(results[1]).toMatchObject({ success: false, text: expect.stringContaining('尚未确认运行中的店铺') });
    expect(broker.runCommand).toHaveBeenCalledTimes(1);
  });

  it('waits for the originating user before a Ziniao write', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const broker = {
      status: vi.fn(async () => ({ profileKey: 'saved' })),
      beginAuthorization: vi.fn(),
      runCommand: vi.fn(async () => ({ updated: true }))
    } as unknown as ZiniaoBroker;
    const codex = {
      startThread: vi.fn(async () => 'thread-ziniao-write'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<any>) => {
        const response = await onRequest({ method: 'item/tool/call', params: {
          namespace: 'ziniao', tool: 'cli', arguments: { capability: 'account.update', args: ['--name', 'shop'] }
        } });
        expect(response.success).toBe(true);
        return { text: '已更新', threadId: 'thread-ziniao-write' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = { async send(_surface, markdown) { sent.push(markdown); }, async beginApprovalCard() { return 'ziniao-write-card'; } };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, {} as DwsBroker, sender, undefined, undefined, broker);
    const task = await orchestrator.accept(request('ziniao-write', '修改紫鸟店铺'));
    await waitUntil(() => sent.some((item) => item.includes('等待确认')));
    expect(broker.runCommand).not.toHaveBeenCalled();
    expect(await orchestrator.handleControl({ ...request('ziniao-wrong-user', '确认 ' + task!.id), user: { corpId: 'corp-1', userId: 'other' } })).toBe(false);
    expect(broker.runCommand).not.toHaveBeenCalled();
    expect(await orchestrator.handleControl(request('ziniao-confirm', '确认 ' + task!.id + ' ' + (await repo.getApproval(task!.id))!.challenge.challengeId))).toBe(true);
    await waitUntil(() => (broker.runCommand as ReturnType<typeof vi.fn>).mock.calls.length === 1);
    expect(broker.runCommand).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }), ['account', 'update', '--name', 'shop'], expect.anything());
  });

  it('releases the ziniao executor session and reports queue waits', async () => {
    const repo = new InMemoryRepository();
    const activities: string[] = [];
    const endSession = vi.fn(async () => undefined);
    let releaseQueue: (() => void) | undefined;
    const broker = {
      status: vi.fn(async () => ({ profileKey: 'saved' })),
      beginAuthorization: vi.fn(),
      runCommand: vi.fn((_user: UserIdentity, _args: string[], opts: { onWait?: (info: { position: number; depth: number; waitedMs: number }) => void; onAcquired?: (info: { depth: number; waitedMs: number }) => void }) => {
        opts.onWait?.({ position: 1, depth: 1, waitedMs: 0 });
        return new Promise((resolve) => { releaseQueue = () => { opts.onAcquired?.({ depth: 1, waitedMs: 60_000 }); resolve({ shops: [] }); }; });
      }),
      endSession
    } as unknown as ZiniaoBroker;
    const codex = {
      startThread: vi.fn(async () => 'thread-ziniao-queue'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<any>) => {
        const response = await onRequest({ method: 'item/tool/call', params: {
          namespace: 'ziniao', tool: 'cli', arguments: { capability: 'store.list' }
        } });
        expect(response.success).toBe(true);
        return { text: '店铺列表', threadId: 'thread-ziniao-queue' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = {
      async send() {},
      async beginTaskCard() { return 'queue-card'; },
      async updateTaskCard() {},
      async updateTaskActivity(_bizId, activity) { activities.push(activity); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, {} as DwsBroker, sender, undefined, undefined, broker);
    const task = await orchestrator.accept(request('ziniao-queue', '查店铺'));
    await waitUntil(() => activities.some((item) => item.includes('已排队')));
    expect(activities.some((item) => item.includes('第 1 位'))).toBe(true);
    releaseQueue?.();
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));
    expect(activities.some((item) => item.includes('已轮到你的任务'))).toBe(true);
    await vi.waitFor(() => expect(endSession).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' })));
    expect((await repo.findTask(task!.id))?.errorCode).toBeUndefined();
  });

  it('maps a busy executor to actionable guidance without exposing others', async () => {
    const repo = new InMemoryRepository();
    const group: string[] = [];
    const direct: string[] = [];
    const broker = {
      status: vi.fn(async () => ({ profileKey: 'saved' })),
      runCommand: vi.fn(async () => { throw new Error('ZINIAO_BUSY'); })
    } as unknown as ZiniaoBroker;
    const codex = {
      startThread: vi.fn(async () => 'thread-ziniao-busy'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<any>) => {
        const response = await onRequest({ method: 'item/tool/call', params: {
          namespace: 'ziniao', tool: 'cli', arguments: { capability: 'store.list' }
        } });
        expect(response.success).toBe(false);
        expect(response.contentItems[0].text).toContain('紫鸟执行机正忙');
        expect(response.contentItems[0].text).not.toContain('user');
        return { text: '执行机正忙，稍后再试。', threadId: 'thread-ziniao-busy' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = {
      async send(_surface, markdown) { group.push(markdown); },
      async sendDirect(_user, markdown) { direct.push(markdown); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, {} as DwsBroker, sender, undefined, undefined, broker);
    const task = await orchestrator.accept({ ...request('ziniao-busy', '查店铺'), surface: { type: 'group', id: 'group-1' } });
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('failed'));
    expect((await repo.findTask(task!.id))?.errorCode).toBe('ZINIAO_BUSY');
    expect(group.join('\n')).toContain('紫鸟执行机正忙');
    expect(direct).toEqual([]);
  });

  it('delivers Ziniao results to the group that initiated the task', async () => {
    const repo = new InMemoryRepository();
    const group: string[] = [];
    const direct: string[] = [];
    const broker = { status: vi.fn(async () => ({ profileKey: 'saved' })), runCommand: vi.fn(async () => ({ shops: ['private-shop'] })) } as unknown as ZiniaoBroker;
    const codex = {
      startThread: vi.fn(async () => 'thread-ziniao-group'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<any>) => {
        await onRequest({ method: 'item/tool/call', params: { namespace: 'ziniao', tool: 'cli', arguments: { capability: 'account.list' } } });
        return { text: '店铺：private-shop', threadId: 'thread-ziniao-group' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = {
      async send(_surface, markdown) { group.push(markdown); },
      async sendDirect(_user, markdown) { direct.push(markdown); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, {} as DwsBroker, sender, undefined, undefined, broker);
    await orchestrator.accept({ ...request('ziniao-group', '查店铺'), surface: { type: 'group', id: 'group-1' } });
    await waitUntil(() => group.some((message) => message.includes('private-shop')));
    expect(group.join('\n')).toContain('private-shop');
    expect(direct).toEqual([]);
  });

  it('marks a failed Ziniao authorization as failed and never claims the operation succeeded', async () => {
    const repo = new InMemoryRepository();
    const group: string[] = [];
    const direct: string[] = [];
    const broker = {
      status: vi.fn(async () => null),
      beginAuthorization: vi.fn(async () => { throw new Error('ZINIAO_LOCAL_CLIENT_REQUIRED'); }),
      runCommand: vi.fn()
    } as unknown as ZiniaoBroker;
    const codex = {
      startThread: vi.fn(async () => 'thread-ziniao-auth-failure'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<any>) => {
        const response = await onRequest({ method: 'item/tool/call', params: {
          namespace: 'ziniao', tool: 'cli', arguments: { capability: 'store.open', args: ['BAGWAT-US'] }
        } });
        expect(response.success).toBe(false);
        return { text: '请点击授权链接，我将立即截图。', threadId: 'thread-ziniao-auth-failure' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = {
      async send(_surface, markdown) { group.push(markdown); },
      async sendDirect(_user, markdown) { direct.push(markdown); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, {} as DwsBroker, sender, undefined, undefined, broker);
    const task = await orchestrator.accept({ ...request('ziniao-auth-failure', '打开 BAGWAT-US 并截图'), surface: { type: 'group', id: 'group-1' } });
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('failed'));
    expect((await repo.findTask(task!.id))?.errorCode).toBe('ZINIAO_LOCAL_CLIENT_REQUIRED');
    expect(group.at(-1)).toContain('紫鸟操作未完成');
    expect(group.join('\n')).not.toContain('已将紫鸟操作结果私聊发起人');
    expect(group.at(-1)).toContain('未生成授权链接');
    expect(direct).toEqual([]);
    expect(direct.join('\n')).not.toContain('请点击授权链接');
    expect(broker.runCommand).not.toHaveBeenCalled();
  });
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
    await waitUntil(() => writes.some((item) => item.kind === 'answer' && item.content === answer && item.status === 3)
      && writes.some((item) => item.kind === 'activity' && item.content === '' && item.status === 3));
    const toolWrite = writes.find((item) => item.kind === 'activity' && item.content.includes('读取 Skill'));
    const firstAnswer = writes.findIndex((item) => item.kind === 'answer');
    const activityClear = writes.findIndex((item) => item.kind === 'activity' && item.content === '');
    expect(toolWrite?.status).toBe(1);
    expect(firstAnswer).toBeGreaterThan(writes.indexOf(toolWrite!));
    expect(activityClear).toBe(firstAnswer + 1);
    expect(writes[activityClear]?.status).toBe(2);
    expect(writes.filter((item) => item.kind === 'activity' && item.content === '' && item.status === 3)).toHaveLength(1);
    expect(writes.at(-1)).toEqual({ kind: 'activity', content: '', status: 3 });
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
    const retryDelays: number[] = [];
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
    }), repo, codex, {} as DwsBroker, sender, undefined, undefined, undefined, async (ms) => { retryDelays.push(ms); });

    const task = await orchestrator.accept(request('message-failed-card', '联网查询今天新闻'));
    await waitUntil(() => writes.some((item) => item.kind === 'answer' && item.status === 3));

    const final = writes.findLast((item) => item.kind === 'answer');
    expect(final).toEqual({
      kind: 'answer',
      content: '模型上游服务已按间隔重试 3 次，但仍然失败。最终原因：上游服务暂无可用资源。错误详情：unexpected status 503 Service Unavailable: No available accounts; [请求标识已隐藏]; url=[地址已隐藏]。请稍后重新发送原任务。',
      status: 3
    });
    expect(codex.turn).toHaveBeenCalledTimes(4);
    expect(retryDelays).toEqual([1_000, 3_000, 7_000]);
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

  it('retries a transient model failure with backoff and completes when the upstream recovers', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const retryDelays: number[] = [];
    const codex = {
      startThread: vi.fn(async () => 'thread-model-retry'),
      turn: vi.fn()
        .mockRejectedValueOnce(new Error('{"error":{"message":"Upstream request failed","type":"upstream_error"}}'))
        .mockRejectedValueOnce(new Error('502 Bad Gateway'))
        .mockResolvedValueOnce({ text: '重试后成功', threadId: 'thread-model-retry' }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = { async send(_surface, markdown) { sent.push(markdown); } };
    const orchestrator = new TaskOrchestrator(
      loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }),
      repo,
      codex,
      {} as DwsBroker,
      sender,
      undefined,
      undefined,
      undefined,
      async (ms) => { retryDelays.push(ms); }
    );

    const task = await orchestrator.accept(request('message-model-retry', '总结周报'));
    await waitUntil(() => sent.includes('重试后成功'));

    expect(codex.turn).toHaveBeenCalledTimes(3);
    expect(retryDelays).toEqual([1_000, 3_000]);
    expect((await repo.findTask(task!.id))?.status).toBe('completed');
    expect(repo.audits.filter((item: any) => item.eventType === 'model.retry_scheduled')).toHaveLength(2);
  });

  it('does not replay a model turn after any tool activity', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const sleep = vi.fn(async () => undefined);
    const codex = {
      startThread: vi.fn(async () => 'thread-no-replay'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<any>) => {
        await onRequest({ method: 'item/tool/call', params: {
          namespace: 'reference', tool: 'read_guide', arguments: { name: 'dingtalk-office' }
        } });
        throw new Error('{"error":{"message":"Upstream request failed","type":"upstream_error"}}');
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = { async send(_surface, markdown) { sent.push(markdown); } };
    const orchestrator = new TaskOrchestrator(
      loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, {} as DwsBroker, sender,
      undefined, undefined, undefined, sleep
    );

    await orchestrator.accept(request('message-model-no-replay', '读取说明'));
    await waitUntil(() => sent.some((item) => item.includes('最终原因')));

    expect(codex.turn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('returns an actionable sanitized reason for otherwise unknown failures', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const codex = {
      startThread: vi.fn(async () => 'thread-visible-error'),
      turn: vi.fn(async () => {
        throw new Error('Document parser rejected malformed content; request_id=req-123; url=http://internal.example/parse; access_token=secret-value');
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = { async send(_surface, markdown) { sent.push(markdown); } };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, {} as DwsBroker, sender);

    await orchestrator.accept(request('message-visible-error', '解析文档'));
    await waitUntil(() => sent.length === 1);

    expect(sent[0]).toContain('处理失败：Document parser rejected malformed content');
    expect(sent[0]).toContain('[请求标识已隐藏]');
    expect(sent[0]).toContain('[地址已隐藏]');
    expect(sent[0]).toContain('access_token=<已隐藏>');
    expect(sent[0]).not.toContain('req-123');
    expect(sent[0]).not.toContain('internal.example');
    expect(sent[0]).not.toContain('secret-value');
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
    await waitUntil(() => (dws.runCommand as ReturnType<typeof vi.fn>).mock.calls.length === 1);
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
    await waitUntil(() => (dws.runCommand as ReturnType<typeof vi.fn>).mock.calls.length === 1);
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
      async send(_surface: ConversationSurface, markdown: string) { sent.push(markdown); },
      async beginApprovalCard() { return 'dws-write-card'; }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, broker, sender);
    const task = await orchestrator.accept(request('message-write', '创建一个测试待办'));
    expect(task).toBeDefined();
    await waitUntil(() => sent.some((item) => item.includes('等待确认')));
    expect(executed).toHaveLength(0);

    const handled = await orchestrator.handleControl(request('message-confirm', '确认 ' + task!.id + ' ' + (await repo.getApproval(task!.id))!.challenge.challengeId));
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
      async send(_surface: ConversationSurface, markdown: string) { sent.push(markdown); },
      async beginApprovalCard() { return 'dws-idempotent-card'; }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, broker, sender);
    const task = await orchestrator.accept(request('message-idempotent', '创建一个测试待办'));
    await waitUntil(() => sent.some((item) => item.includes('等待确认')));
    await orchestrator.handleControl(request('confirm-idempotent', '确认 ' + task!.id + ' ' + (await repo.getApproval(task!.id))!.challenge.challengeId));
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
      async send(_surface: ConversationSurface, markdown: string) { sent.push(markdown); },
      async beginApprovalCard() { return 'dws-unknown-card'; }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, broker, sender);
    const task = await orchestrator.accept(request('message-unknown', '创建一个测试待办'));
    await waitUntil(() => sent.some((item) => item.includes('等待确认')));
    await orchestrator.handleControl(request('confirm-unknown', '确认 ' + task!.id + ' ' + (await repo.getApproval(task!.id))!.challenge.challengeId));
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

  it('delivers message sends without a confirmation round', async () => {
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
      startThread: vi.fn(async () => 'thread-dm-free'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<unknown>) => {
        const result = await onRequest({ method: 'item/tool/call', params: {
          namespace: 'dingtalk', tool: 'dws',
          arguments: { capability: 'chat.dm', args: ['--to', '盛喜', '--content', '你的部门信息如下：…'] }
        } });
        expect(result).toMatchObject({ success: true });
        return { text: '已私聊发送。', threadId: 'thread-dm-free' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = {
      async send(_surface: ConversationSurface, markdown: string) { sent.push(markdown); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, broker, sender);
    await orchestrator.accept(request('message-dm-free', '查我的部门然后私发我'));
    await waitUntil(() => sent.some((item) => item === '已私聊发送。'));
    expect(sent.some((item) => item.includes('等待确认'))).toBe(false);
    expect(executed).toHaveLength(1);
    expect(executed[0]!.args).toContain('--yes');
  });

  it('resolves a high-risk write through the interactive approval card (agree)', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const executed: Array<{ user: UserIdentity; args: string[] }> = [];
    const approvalCards: string[] = [];
    const broker = {
      status: vi.fn(async (user: UserIdentity) => ({ ...user, profileKey: user.corpId + ':' + user.userId })),
      runCommand: vi.fn(async (user: UserIdentity, args: string[]) => {
        executed.push({ user, args });
        return { ok: true };
      })
    } as unknown as DwsBroker;
    const codex = {
      startThread: vi.fn(async () => 'thread-card-agree'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<unknown>) => {
        const result = await onRequest(writeToolRequest());
        expect(result).toMatchObject({ success: true });
        return { text: '待办已创建', threadId: 'thread-card-agree' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = {
      async send(_surface: ConversationSurface, markdown: string) { sent.push(markdown); },
      async sendDirect() { throw new Error('Group approval must not be sent privately'); },
      async beginApprovalCard(task, _action, challenge) {
        expect(task.request.surface).toEqual({ type: 'group', id: 'group-1' });
        approvalCards.push(challenge.taskId);
        return 'approval-card-1';
      },
      async updateApprovalCard(_bizId, content, status) {
        sent.push('[卡片] ' + status + ' ' + content);
      }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, broker, sender);
    const task = await orchestrator.accept({ ...request('message-card-agree', '创建一个测试待办'), surface: { type: 'group', id: 'group-1' } });
    await waitUntil(() => approvalCards.length === 1);
    expect(executed).toHaveLength(0);
    const challengeId = (await repo.getApproval(task!.id))!.challenge.challengeId;
    expect(await orchestrator.handleApprovalCardClick({ userId: 'other-user', outTrackId: 'approval-card-1', action: 'agree', challengeId })).toBe(true);
    expect(executed).toHaveLength(0);
    expect(await orchestrator.handleApprovalCardClick({ userId: 'user-1', outTrackId: 'approval-card-1', action: 'agree', challengeId })).toBe(true);
    await waitUntil(() => executed.length === 1 && sent.some((item) => item === '待办已创建'));
    expect(executed[0]!.args).toContain('--yes');
    expect(sent.some((item) => item.includes('[卡片] processing ✅ 已同意'))).toBe(true);
    expect((await repo.findTask(task!.id))?.status).toBe('completed');
  });

  it('reuses one card across two writes and rejects stale or tokenless clicks', async () => {
    const repo = new InMemoryRepository();
    const created: string[] = [];
    const updated: Array<{ id: string; status: string; challengeId?: string }> = [];
    const executed: string[][] = [];
    const broker = {
      status: vi.fn(async (user: UserIdentity) => ({ ...user, profileKey: user.corpId + ':' + user.userId })),
      runCommand: vi.fn(async (_user: UserIdentity, args: string[]) => { executed.push(args); return { ok: true }; })
    } as unknown as DwsBroker;
    const codex = {
      startThread: vi.fn(async () => 'thread-two-writes'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<unknown>) => {
        await onRequest(writeToolRequest());
        await onRequest({ ...writeToolRequest(), params: { ...writeToolRequest().params,
          arguments: { capability: 'todo.create', args: ['--title', '第二项'] } } });
        return { text: '两项操作已完成', threadId: 'thread-two-writes' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = {
      async send() { /* no-op */ },
      async beginApprovalCard(_task, _action, challenge) { created.push(challenge.challengeId!); return 'one-card'; },
      async updateApprovalCard(id, _content, status, challengeId) { updated.push({ id, status, challengeId }); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, broker, sender);
    const task = await orchestrator.accept(request('two-writes', '连续创建两项待办'));
    await vi.waitFor(async () => expect((await repo.listApprovals(task!.id)).length).toBe(1));
    const firstId = (await repo.getApproval(task!.id))!.challenge.challengeId!;
    expect(await orchestrator.handleApprovalCardClick({ userId: 'user-1', outTrackId: 'one-card', action: 'agree' })).toBe(false);
    expect(await orchestrator.handleApprovalCardClick({ userId: 'user-1', outTrackId: 'one-card', action: 'agree', challengeId: firstId })).toBe(true);
    await vi.waitFor(async () => expect((await repo.listApprovals(task!.id)).length).toBe(2));
    const secondId = (await repo.getApproval(task!.id))!.challenge.challengeId!;
    expect(secondId).not.toBe(firstId);
    expect(await orchestrator.handleApprovalCardClick({ userId: 'user-1', outTrackId: 'one-card', action: 'agree', challengeId: firstId })).toBe(false);
    expect(await orchestrator.handleControl(request('old-text-confirm', '确认 ' + task!.id + ' ' + firstId))).toBe(false);
    expect(executed).toHaveLength(1);
    expect(await orchestrator.handleApprovalCardClick({ userId: 'user-1', outTrackId: 'one-card', action: 'agree', challengeId: secondId })).toBe(true);
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));
    expect(created).toHaveLength(1);
    expect(updated).toContainEqual({ id: 'one-card', status: 'pending', challengeId: secondId });
    expect(updated.at(-1)?.status).toBe('done');
    expect(executed).toHaveLength(2);
    expect((await repo.listApprovals(task!.id)).map((item) => item.status)).toEqual(['executed', 'executed']);
  });

  it('marks an expired approval card as rejected and never executes the write', async () => {
    const repo = new InMemoryRepository();
    const updates: Array<{ content: string; status: string }> = [];
    const broker = {
      status: vi.fn(async (user: UserIdentity) => ({ ...user, profileKey: user.corpId + ':' + user.userId })),
      runCommand: vi.fn(async () => ({ ok: true }))
    } as unknown as DwsBroker;
    const codex = {
      startThread: vi.fn(async () => 'thread-card-timeout'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<unknown>) => {
        await onRequest(writeToolRequest());
        return { text: '操作未执行', threadId: 'thread-card-timeout' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = {
      async send() { /* no-op */ },
      async beginApprovalCard() { return 'approval-card-timeout'; },
      async updateApprovalCard(_bizId, content, status) { updates.push({ content, status }); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({
      DINGTALK_ROBOT_CODE: 'robot',
      DINGTALK_APPROVAL_CARD_TTL_MS: '50'
    }), repo, codex, broker, sender);
    await orchestrator.accept({ ...request('message-card-timeout', '创建一个测试待办'), surface: { type: 'group', id: 'group-1' } });
    await waitUntil(() => updates.length >= 1);
    expect(updates[0]).toMatchObject({ status: 'processing' });
    expect(updates[0]!.content).toContain('超时');
    expect(broker.runCommand).not.toHaveBeenCalled();
  });

  it('fails closed when the approval card cannot be delivered to the originating group', async () => {
    const repo = new InMemoryRepository();
    const groupMessages: string[] = [];
    const executed: string[][] = [];
    const broker = {
      status: vi.fn(async (user: UserIdentity) => ({ ...user, profileKey: user.corpId + ':' + user.userId })),
      runCommand: vi.fn(async (_user: UserIdentity, args: string[]) => { executed.push(args); return { ok: true }; })
    } as unknown as DwsBroker;
    const codex = {
      startThread: vi.fn(async () => 'thread-group-fallback'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<unknown>) => {
        await onRequest(writeToolRequest());
        return { text: '待办已创建', threadId: 'thread-group-fallback' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = {
      async send(surface, markdown) {
        expect(surface).toEqual({ type: 'group', id: 'group-1' });
        groupMessages.push(markdown);
      },
      async beginTaskCard() { return 'processing-task-card'; },
      async updateTaskCard() { /* PROCESSING updates are not the visible fallback. */ },
      async sendDirect() { throw new Error('Must not send group confirmation privately'); },
      async beginApprovalCard() { throw new Error('DingTalk native card request failed: HTTP 400 code=param.templateUnpublished requestId=req-123'); }
    };
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, broker, sender);
    const task = await orchestrator.accept({ ...request('message-group-fallback', '创建测试待办'), surface: { type: 'group', id: 'group-1' } });
    await waitUntil(() => groupMessages.some((message) => message.includes('确认卡暂时无法投递')));
    expect(repo.audits.some((item: any) => item.eventType === 'approval.card_delivery_failed' && item.payload.reason.includes('param.templateUnpublished'))).toBe(true);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('approval.card_delivery_failed'));
    expect(executed).toHaveLength(0);
    expect(groupMessages.join('\n')).not.toContain('确认请回复');
    expect((await repo.getApproval(task!.id))?.status).toBe('cancelled');
    expect(await orchestrator.handleControl({ ...request('other-user', '确认 ' + task!.id), user: { corpId: 'corp-1', userId: 'other-user' }, surface: { type: 'group', id: 'group-1' } })).toBe(false);
    expect(executed).toHaveLength(0);
    expect(await orchestrator.handleControl({ ...request('owner-confirm', '确认 ' + task!.id + ' ' + (await repo.getApproval(task!.id))!.challenge.challengeId), surface: { type: 'group', id: 'group-1' } })).toBe(true);
    expect(executed).toHaveLength(0);
    errorLog.mockRestore();
  });

  it('lets the model finish gracefully after the approval card is rejected', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const cardStatuses: string[] = [];
    let toolText: string | undefined;
    const broker = {
      status: vi.fn(async (user: UserIdentity) => ({ ...user, profileKey: user.corpId + ':' + user.userId })),
      runCommand: vi.fn()
    } as unknown as DwsBroker;
    const codex = {
      startThread: vi.fn(async () => 'thread-card-reject'),
      turn: vi.fn(async (_thread: string, _input: string, _onEvent: unknown, onRequest: (request: CodexApprovalRequest) => Promise<unknown>) => {
        const result = await onRequest(writeToolRequest()) as { success: boolean; contentItems: Array<{ text: string }> };
        toolText = result.contentItems[0]?.text;
        return { text: '好的，本次没有创建待办。如需要我可以先列出草稿给你确认。', threadId: 'thread-card-reject' };
      }),
      interrupt: vi.fn(async () => undefined)
    } as unknown as CodexClient;
    const sender: MessageSender = {
      async send(_surface: ConversationSurface, markdown: string) { sent.push(markdown); },
      async beginApprovalCard() { return 'approval-card-reject'; },
      async updateApprovalCard(_bizId, _content, status) { cardStatuses.push(status); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, broker, sender);
    const task = await orchestrator.accept(request('message-card-reject', '创建一个测试待办'));
    await waitUntil(() => sent.some((item) => item.includes('等待确认')));
    expect(await orchestrator.handleApprovalCardClick({ userId: 'user-1', outTrackId: 'approval-card-reject', action: 'reject', challengeId: (await repo.getApproval(task!.id))!.challenge.challengeId })).toBe(true);
    await waitUntil(() => sent.some((item) => item.includes('如需要我可以先列出草稿')));
    expect(toolText).toContain('DWS_CONFIRMATION_DECLINED');
    expect(cardStatuses).toEqual(['processing', 'done']);
    expect((broker.runCommand as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    const stored = await repo.findTask(task!.id);
    expect(stored?.status).toBe('completed');
  });

  it('cancels a task by quoting its task card and sending bare cancel', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const codex = { interrupt: vi.fn(async () => undefined) } as unknown as CodexClient;
    const sender: MessageSender = {
      async send(_surface, markdown) { sent.push(markdown); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, {} as DwsBroker, sender);
    const original = request('quoted-task-request', '查询一个较慢的任务');
    const surfaceId = await repo.ensureSurface(original.user, original.surface);
    const task = await repo.createTask(original, surfaceId);
    await repo.setTaskCard(task.id, 'quoted-task-card');

    const handled = await orchestrator.handleControl({
      ...request('quoted-cancel', '<@robot-open-id> 取消'),
      quotedMessageId: 'quoted-task-card'
    });

    expect(handled).toBe(true);
    expect((await repo.findTask(task.id))?.status).toBe('cancelled');
    expect(sent.join('\n')).toContain('已取消');
  });

  it('cancels a task by quoting its original request message', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const sender: MessageSender = { async send(_surface, markdown) { sent.push(markdown); } };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, {} as CodexClient, {} as DwsBroker, sender);
    const original = request('quoted-original-request', '查询一个待取消任务');
    const surfaceId = await repo.ensureSurface(original.user, original.surface);
    const task = await repo.createTask(original, surfaceId);

    expect(await orchestrator.handleControl({
      ...request('quoted-original-cancel', '取消'),
      quotedMessageId: original.messageId
    })).toBe(true);
    expect((await repo.findTask(task.id))?.status).toBe('cancelled');
    expect(sent.join('\n')).toContain('已取消');
    expect(sent.join('\n')).not.toContain(task.id);
  });

  it('resolves a missing Stream quote through the current user DWS profile', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const sender: MessageSender = { async send(_surface, markdown) { sent.push(markdown); } };
    const original = request('dws-quote-original', '查询一个待取消任务');
    const surfaceId = await repo.ensureSurface(original.user, original.surface);
    const task = await repo.createTask(original, surfaceId);
    const dws = {
      resolveQuotedMessage: vi.fn(async () => ({
        messageId: 'dws-quote-cancel',
        conversationId: original.surface.id,
        quotedMessageId: original.messageId,
        quotedConversationId: original.surface.id,
        quotedText: original.text
      })),
      precedingConversationMessageIds: vi.fn(async () => [])
    } as unknown as DwsBroker;
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, {} as CodexClient, dws, sender);

    expect(await orchestrator.handleControl(request('dws-quote-cancel', '<@robot-open-id> 取消'))).toBe(true);
    expect(dws.resolveQuotedMessage).toHaveBeenCalledWith(original.user, 'dws-quote-cancel');
    expect((await repo.findTask(task.id))?.status).toBe('cancelled');
    expect(sent.join('\n')).toContain('已取消');
  });

  it('cancels by a real card message id that differs from the card outTrackId', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const cardWrites: Array<{ kind: 'card' | 'activity'; content: string; status: number }> = [];
    const sender: MessageSender = {
      async send(_surface, markdown) { sent.push(markdown); },
      async updateTaskCard(_bizId, content, status) { cardWrites.push({ kind: 'card', content, status }); },
      async updateTaskActivity(_bizId, content, status) { cardWrites.push({ kind: 'activity', content, status }); }
    };
    const original = request('real-card-original-request', '执行一个较慢任务');
    const surfaceId = await repo.ensureSurface(original.user, original.surface);
    const task = await repo.createTask(original, surfaceId);
    await repo.setTaskCard(task.id, 'card-out-track-id');
    await repo.updateTask(task.id, 'running');
    const dws = {
      resolveQuotedMessage: vi.fn(async () => ({
        messageId: 'real-card-cancel-message',
        conversationId: original.surface.id,
        quotedMessageId: 'dingtalk-card-open-message-id',
        quotedConversationId: original.surface.id,
        quotedCreateTime: '2026-09-29 17:20:11',
        quotedText: '[交互卡片消息]'
      })),
      precedingConversationMessageIds: vi.fn(async () => [original.messageId])
    } as unknown as DwsBroker;
    const codex = { interrupt: vi.fn(async () => undefined) } as unknown as CodexClient;
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, dws, sender);

    expect(await orchestrator.handleControl(request('real-card-cancel-message', '<@robot-open-id> 取消'))).toBe(true);
    expect(dws.precedingConversationMessageIds).toHaveBeenCalledWith(
      original.user,
      original.surface.id,
      'dingtalk-card-open-message-id',
      '2026-09-29 17:20:11'
    );
    expect((await repo.findTask(task.id))?.status).toBe('cancelled');
    expect(cardWrites).toEqual([
      { kind: 'card', content: '已取消。', status: 3 },
      { kind: 'activity', content: '', status: 3 }
    ]);
    expect(sent).toHaveLength(0);

    expect(await orchestrator.handleControl(request('real-card-cancel-again', '取消'))).toBe(true);
    expect(cardWrites).toEqual([
      { kind: 'card', content: '已取消。', status: 3 },
      { kind: 'activity', content: '', status: 3 },
      { kind: 'card', content: '已取消。', status: 3 },
      { kind: 'activity', content: '', status: 3 }
    ]);
    expect(sent).toHaveLength(0);
  });

  it('waits for an in-flight progress update before finalizing a cancelled card', async () => {
    const repo = new InMemoryRepository();
    const writes: string[] = [];
    let releaseProgress!: () => void;
    const progress = new Promise<void>((resolve) => { releaseProgress = resolve; });
    const sender: MessageSender = {
      async send() { throw new Error('card delivery expected'); },
      async updateTaskCard(_bizId, content) { writes.push('card:' + content); },
      async updateTaskActivity(_bizId, content) { writes.push('activity:' + content); }
    };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo,
      { interrupt: vi.fn(async () => undefined) } as unknown as CodexClient, {} as DwsBroker, sender);
    const original = request('progress-race-original', '执行较慢任务');
    const surfaceId = await repo.ensureSurface(original.user, original.surface);
    const task = await repo.createTask(original, surfaceId);
    await repo.setTaskCard(task.id, 'progress-race-card');
    await repo.updateTask(task.id, 'running');
    (orchestrator as any).cardWriteDrains.set(task.id, async () => {
      await progress;
      writes.push('old-progress');
    });

    const cancellation = orchestrator.handleControl({
      ...request('progress-race-cancel', '取消'),
      quotedMessageId: 'progress-race-card'
    });
    await waitUntil(() => writes.length === 0 && (orchestrator as any).cancelledTasks.has(task.id));
    releaseProgress();
    expect(await cancellation).toBe(true);
    expect(writes).toEqual(['old-progress', 'card:已取消。', 'activity:']);
    expect((await repo.findTask(task.id))?.status).toBe('cancelled');
  });

  it('does not create a task when a bare cancel has no resolvable quote', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const sender: MessageSender = { async send(_surface, markdown) { sent.push(markdown); } };
    const dws = {
      resolveQuotedMessage: vi.fn(async () => undefined),
      precedingConversationMessageIds: vi.fn(async () => [])
    } as unknown as DwsBroker;
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, {} as CodexClient, dws, sender);

    expect(await orchestrator.handleControl(request('unquoted-bare-cancel', '取消'))).toBe(true);
    expect(sent.join('\n')).toContain('请引用对应的任务受理消息');
    expect(await repo.findTaskByMessageReference(
      { corpId: 'corp-1', userId: 'user-1' },
      { type: 'direct', id: 'user-1' },
      'unquoted-bare-cancel'
    )).toBeUndefined();
  });

  it('ignores an unmentioned group cancel that does not quote a task', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const sender: MessageSender = { async send(_surface, content) { sent.push(content); } };
    const dws = { resolveQuotedMessage: vi.fn(async () => undefined) } as unknown as DwsBroker;
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo,
      {} as CodexClient, dws, sender);
    expect(await orchestrator.handleControl({
      ...request('unmentioned-group-cancel', '取消'),
      surface: { type: 'group', id: 'group-1' },
      botMentioned: false
    })).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it('falls back to the task number contained in quoted task-card text', async () => {
    const repo = new InMemoryRepository();
    const sender: MessageSender = { async send() {} };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, {} as CodexClient, {} as DwsBroker, sender);
    const original = request('quoted-text-request', '查询一个待取消任务');
    const surfaceId = await repo.ensureSurface(original.user, original.surface);
    const task = await repo.createTask(original, surfaceId);

    expect(await orchestrator.handleControl({
      ...request('quoted-text-cancel', '取消'),
      quotedMessageId: 'dingtalk-message-id-not-equal-to-card-track-id',
      quotedText: `### 已受理\n\n- 任务编号：${task.id}\n- 当前状态：排队中`
    })).toBe(true);
    expect((await repo.findTask(task.id))?.status).toBe('cancelled');
  });

  it('does not cancel a quoted task from another user or surface', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const sender: MessageSender = { async send(_surface, markdown) { sent.push(markdown); } };
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, {} as CodexClient, {} as DwsBroker, sender);
    const original = request('quoted-private-request', '查询私聊任务');
    const surfaceId = await repo.ensureSurface(original.user, original.surface);
    const task = await repo.createTask(original, surfaceId);

    expect(await orchestrator.handleControl({
      ...request('quoted-cross-surface-cancel', '取消'),
      surface: { type: 'group', id: 'group-1' },
      quotedMessageId: task.request.messageId
    })).toBe(true);
    expect((await repo.findTask(task.id))?.status).toBe('queued');
    expect(sent.join('\n')).toContain('未找到可取消的任务');
    expect(sent.join('\n')).not.toContain('任务编号');
  });
});
