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
    vi.spyOn((orchestrator as any).contractPlanner, 'plan').mockResolvedValue({
      mode: 'conversation', goal: '确定受众后起草文案', deliverables: ['文案'], requiredFacts: [], assumptions: [], openQuestions: ['受众'], completionCriteria: ['提供文案']
    });
    vi.spyOn((orchestrator as any).evidenceReviewer, 'review').mockResolvedValue({ supported: true, reason: 'reviewed' });
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
});
