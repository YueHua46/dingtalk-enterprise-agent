import { describe, expect, it, vi } from 'vitest';
import { A2uiTaskCards, initialTaskCardView, taskCardMessages } from '../src/a2ui-task-card.js';
import { CardPresentation } from '../src/card-presentation.js';
import { InMemoryRepository } from '../src/persistence.js';
import type { DwsBroker } from '../src/dws-broker.js';
import { TaskOrchestrator } from '../src/task-orchestrator.js';
import type { CodexClientLike } from '../src/codex-client.js';
import { loadConfig } from './test-config.js';
import type { TaskCardView } from '../src/a2ui-task-card.js';

async function setup() {
  const repo = new InMemoryRepository();
  const task = await repo.createTask({ requestId: 'request', messageId: 'message',
    user: { corpId: 'corp', userId: 'member' }, surface: { type: 'group', id: 'original' },
    text: '查资料', attachments: [], receivedAt: Date.now() }, 'original');
  const broker = { lintA2ui: vi.fn(async (_user, messages) => messages.map(JSON.stringify)),
    createA2ui: vi.fn(async () => ({ accepted: true, bizId: 'card' })),
    updateA2ui: vi.fn(async () => {}) };
  const cards = new A2uiTaskCards(broker as unknown as DwsBroker, repo);
  task.cardBizId = await cards.create(task);
  return { repo, task, broker, cards };
}

describe('A2UI task lifecycle', () => {
  it('integrates actual tools and final answer while excluding raw commands and reasoning events', async () => {
    const repo = new InMemoryRepository();
    const writes: TaskCardView[] = [];
    const send = vi.fn(async () => {});
    const codex = { startThread: async () => 'thread', interrupt: async () => {},
      turn: async (_thread: string, _input: string, event: (e: any) => void) => {
        event({ method: 'item/reasoning/textDelta', params: { delta: 'PRIVATE_REASONING' } });
        event({ method: 'item/started', params: { item: { id: 'command', type: 'commandExecution', command: 'PRIVATE_COMMAND' } } });
        event({ method: 'item/completed', params: { item: { id: 'command', type: 'commandExecution', exitCode: 2 } } });
        return { text: '最终回答', threadId: 'thread' };
      } } as unknown as CodexClientLike;
    const orchestrator = new TaskOrchestrator(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), repo, codex, {} as DwsBroker,
      { send, beginTaskCard: async () => 'card', updateTaskProcess: async (_task, view) => { writes.push(view); } });
    await orchestrator.accept({ requestId: 'integration', messageId: 'integration', user: { corpId: 'corp', userId: 'member' },
      surface: { type: 'group', id: 'original' }, text: '测试', attachments: [], receivedAt: Date.now() });
    await vi.waitFor(() => expect(writes.at(-1)?.phase).toBe('completed'), { timeout: 5000 });
    expect(writes.at(-1)?.answer).toBe('最终回答');
    expect(writes.at(-1)?.steps).toContain('未完成：执行文件处理命令');
    expect(JSON.stringify(writes)).not.toContain('PRIVATE_');
    expect(send).not.toHaveBeenCalled();
  });
  it('creates once with the request identity and original surface, including after restart', async () => {
    const { task, broker, repo } = await setup();
    expect(await new A2uiTaskCards(broker as unknown as DwsBroker, repo).create(task)).toBe('card');
    expect(broker.createA2ui).toHaveBeenCalledTimes(1);
    expect(broker.createA2ui).toHaveBeenCalledWith(task.request.user, task.request.surface, expect.any(Array));
  });

  it('serializes writes, preserves history, and cannot overwrite a terminal card', async () => {
    const { cards, task, broker } = await setup();
    const running = { ...initialTaskCardView(), phase: 'running' as const, steps: '✓ 已查询资料' };
    await Promise.all([cards.update(task, running), cards.update(task, { ...running, phase: 'completed', steps: '', answer: '结果' }), cards.update(task, running)]);
    expect(broker.updateA2ui).toHaveBeenCalledTimes(2);
    const final = broker.updateA2ui.mock.calls[1] as unknown as [unknown, string, string[], string];
    expect(final[3]).toBe('FINISH');
    expect(final[2].join()).toContain('已查询资料');
    expect(final[2].join()).not.toContain('shimmer');
    expect(final[2].join()).not.toContain('createSurface');
  });

  it('suppresses stale progress while waiting or cancelled', async () => {
    const { cards, task, repo, broker } = await setup();
    await repo.updateTask(task.id, 'waiting_confirmation');
    await cards.update(task, { ...initialTaskCardView(), phase: 'running' });
    await repo.updateTask(task.id, 'cancelled');
    await cards.update(task, { ...initialTaskCardView(), phase: 'running' });
    expect(broker.updateA2ui).not.toHaveBeenCalled();
    await cards.update(task, { ...initialTaskCardView(), phase: 'cancelled', answer: '已取消' });
    expect(broker.updateA2ui).toHaveBeenCalledTimes(1);
  });

  it('does not repeat a write whose delivery outcome is unknown across restart', async () => {
    const { cards, task, broker, repo } = await setup();
    broker.updateA2ui.mockRejectedValueOnce(new Error('timeout'));
    const view = { ...initialTaskCardView(), phase: 'completed' as const, answer: '结果' };
    await expect(cards.update(task, view)).rejects.toThrow('timeout');
    await expect(new A2uiTaskCards(broker as unknown as DwsBroker, repo).update(task, view)).rejects.toThrow('OUTCOME_UNKNOWN');
    expect(broker.updateA2ui).toHaveBeenCalledTimes(1);
  });

  it('keeps a reasoning-style panel separate from the answer and labels stopped tools honestly', () => {
    const presentation = new CardPresentation();
    presentation.toolStarted('查询钉钉消息');
    presentation.toolCompleted('查询钉钉消息', true);
    presentation.toolStarted('读取资料');
    const view = presentation.snapshot('已取消', 'cancelled');
    expect(view.steps).toContain('✓ 已完成');
    expect(view.steps).toContain('⚠ 已停止');
    const messages = taskCardMessages('task', view, true);
    const components = (messages[2] as any).updateComponents.components;
    expect(components[1]).toMatchObject({ variant: 'reasoning', defaultExpanded: false, title: '已取消' });
    expect(JSON.stringify(messages)).not.toContain('templateId');
  });
});
