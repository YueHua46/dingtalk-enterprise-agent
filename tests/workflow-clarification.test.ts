import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from './test-config.js';
import { InMemoryRepository } from '../src/persistence.js';
import { TaskOrchestrator } from '../src/task-orchestrator.js';
import type { AgentRequest } from '../src/types.js';

const config = loadConfig({
  NODE_ENV: 'production', TASK_WORKFLOW_MODE: 'enforce', DINGTALK_ROBOT_CODE: 'robot', DINGTALK_CLIENT_ID: 'id',
  DINGTALK_CLIENT_SECRET: 'secret', DWS_BOT_PROFILE: 'bot', MODEL_BASE_URL: 'https://model.example/v1',
  MODEL_API_KEY: 'model-key', CLAMAV_HOST: 'clamav', INTERNAL_API_TOKEN: 'x'.repeat(32)
});

function request(id: string, text: string, userId = 'user-1'): AgentRequest {
  return { requestId: id, messageId: id, user: { corpId: 'corp', userId }, surface: { type: 'group', id: 'group-1' }, text, attachments: [], receivedAt: Date.now() };
}

describe('workflow clarification', () => {
  it('persists the question, resumes only for the initiator, and completes the original task', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    let turn = 0;
    const codex = {
      startThread: vi.fn(async () => 'thread-1'),
      turn: vi.fn(async (_id: string, _prompt: string, _events: unknown, onTool: (value: unknown) => Promise<any>) => {
        turn += 1;
        if (turn === 1) {
          const reply = await onTool({ method: 'item/tool/call', params: { namespace: 'agent', tool: 'workflow', arguments: { operation: 'clarify', question: '请提供文案受众', reason: '受众决定文案内容' } } });
          expect(reply.success).toBe(true);
          return { text: '等待补充', threadId: 'thread-1' };
        }
        const reply = await onTool({ method: 'item/tool/call', params: { namespace: 'agent', tool: 'workflow', arguments: { operation: 'complete', completion: { status: 'answered', answer: '已写好面向指定受众的文案', factEvidence: {}, missingFacts: [] } } } });
        expect(reply.success).toBe(true);
        return { text: '忽略模型未校验的文本', threadId: 'thread-1' };
      }),
      interrupt: vi.fn(async () => undefined)
    };
    const orchestrator = new TaskOrchestrator(config, repo, codex as any, {} as any, { async send(_surface, markdown) { sent.push(markdown); } });
    vi.spyOn((orchestrator as any).evidenceReviewer, 'review').mockResolvedValue({ status: 'pass', issues: [], reason: 'reviewed' });
    const task = await orchestrator.accept(request('start', '起草文案'));
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('waiting_clarification'));
    expect(sent).toContain('请提供文案受众');
    expect(await orchestrator.handleControl(request('other', '这是文档', 'other-user'))).toBe(false);
    expect(await orchestrator.handleControl(request('answer', '测试文档'))).toBe(true);
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));
    expect(sent).toContain('已写好面向指定受众的文案');
    expect(sent).not.toContain('忽略模型未校验的文本');
    await orchestrator.stop();
  });

  it('uses a clarification card when available and resumes from its callback', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const cards: Array<{ status: string; message?: string }> = [];
    let turn = 0;
    const codex = {
      startThread: vi.fn(async () => 'thread-card'),
      turn: vi.fn(async (_id: string, _prompt: string, _events: unknown, onTool: (value: unknown) => Promise<any>) => {
        turn += 1;
        if (turn === 1) {
          const reply = await onTool({ method: 'item/tool/call', params: { namespace: 'agent', tool: 'workflow', arguments: {
            operation: 'clarify', question: '广告分析重点是什么？', reason: '重点会改变报告结构',
            options: [{ value: 0, text: '整体表现' }, { value: 1, text: '优先处理浪费' }]
          } } });
          expect(reply.success).toBe(true);
          return { text: '等待选择', threadId: 'thread-card' };
        }
        const reply = await onTool({ method: 'item/tool/call', params: { namespace: 'agent', tool: 'workflow', arguments: { operation: 'complete', completion: { status: 'answered', answer: '已按选择继续', factEvidence: {}, missingFacts: [] } } } });
        expect(reply.success).toBe(true);
        return { text: '忽略', threadId: 'thread-card' };
      }),
      interrupt: vi.fn(async () => undefined)
    };
    const orchestrator = new TaskOrchestrator(config, repo, codex as any, {} as any, {
      async send(_surface, markdown) { sent.push(markdown); },
      async beginClarificationCard() { return 'clarify-card-1'; },
      async updateClarificationCard(_id, status, message) { cards.push({ status, message }); }
    });
    vi.spyOn((orchestrator as any).evidenceReviewer, 'review').mockResolvedValue({ status: 'pass', issues: [], reason: 'reviewed' });
    const task = await orchestrator.accept(request('start-card', '分析德国站广告'));
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('waiting_clarification'));
    expect((await repo.findTask(task!.id))?.clarificationCardBizId).toBe('clarify-card-1');
    expect(await orchestrator.handleClarificationCardClick({ corpId: 'other-corp', userId: 'user-1', outTrackId: 'clarify-card-1', action: 'submit', choiceIndex: 1 })).toBe(false);
    expect(await orchestrator.handleClarificationCardClick({ corpId: 'corp', userId: 'other-user', outTrackId: 'clarify-card-1', action: 'submit', choiceIndex: 1 })).toBe(false);
    expect(await orchestrator.handleClarificationCardClick({ userId: 'user-1', outTrackId: 'clarify-card-1', action: 'submit', choiceText: '伪造选项' })).toBe(true);
    expect((await repo.findTask(task!.id))?.status).toBe('waiting_clarification');
    expect(await orchestrator.handleClarificationCardClick({ userId: 'user-1', outTrackId: 'clarify-card-1', action: 'submit', choiceIndex: 1, choiceText: '伪造选项' })).toBe(true);
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));
    expect(cards.some((item) => item.status === 'done')).toBe(true);
    expect(sent).toContain('已按选择继续');
    expect((await repo.getWorkflow(task!.id))?.clarification?.answer).toBe('优先处理浪费');
    expect(await orchestrator.handleClarificationCardClick({ userId: 'user-1', outTrackId: 'clarify-card-1', action: 'submit', choiceIndex: 1 })).toBe(false);
    await orchestrator.stop();
  });

  it('atomically accepts one answer and rejects an expired or superseded question', async () => {
    const repo = new InMemoryRepository();
    const task = await repo.createTask(request('atomic', '分析广告'), 'surface');
    const now = new Date().toISOString();
    await repo.saveWorkflow(task.id, { evidence: [], revision: 1, clarification: { question: '目标？', reason: '目标影响取舍', createdAt: now, expiresAt: new Date(Date.now() + 60000).toISOString() } });
    await repo.updateTask(task.id, 'waiting_clarification');
    expect(await repo.consumeClarification(task.id, 'old-question', 'answer', false)).toBe(false);
    const result = await Promise.all([repo.consumeClarification(task.id, now, '盈利', false), repo.consumeClarification(task.id, now, '清库存', false)]);
    expect(result.filter(Boolean)).toHaveLength(1);
    expect((await repo.getWorkflow(task.id))?.clarification?.answer).toBe('盈利');
  });
});
