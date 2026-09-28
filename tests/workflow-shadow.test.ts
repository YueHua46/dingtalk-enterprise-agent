import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from './test-config.js';
import { InMemoryRepository } from '../src/persistence.js';
import { TaskOrchestrator } from '../src/task-orchestrator.js';
import type { AgentRequest } from '../src/types.js';

describe('workflow shadow rollout', () => {
  it('records a contract without changing the old answer or requiring workflow completion', async () => {
    const config = loadConfig({
      NODE_ENV: 'production', TASK_WORKFLOW_MODE: 'shadow', DINGTALK_ROBOT_CODE: 'robot',
      DINGTALK_CLIENT_ID: 'id', DINGTALK_CLIENT_SECRET: 'secret', DWS_BOT_PROFILE: 'bot',
      MODEL_BASE_URL: 'https://model.example/v1', MODEL_API_KEY: 'model-key',
      CLAMAV_HOST: 'clamav', INTERNAL_API_TOKEN: 'x'.repeat(32)
    });
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const codex = {
      startThread: vi.fn(async () => 'thread-1'),
      turn: vi.fn(async () => ({ text: '旧路径的回答', threadId: 'thread-1' })),
      interrupt: vi.fn(async () => undefined)
    };
    const orchestrator = new TaskOrchestrator(config, repo, codex as any, {} as any, { async send(_surface, markdown) { sent.push(markdown); } });
    vi.spyOn((orchestrator as any).contractPlanner, 'plan').mockResolvedValue({
      mode: 'read', goal: '查询内部数据', deliverables: ['结果'], requiredFacts: [
        { id: 'sales', description: '内部销量', acceptableSources: ['crossborderops.*'] }
      ], assumptions: [], openQuestions: [], completionCriteria: ['提供销量']
    });
    const request: AgentRequest = {
      requestId: 'shadow-1', messageId: 'shadow-1', user: { corpId: 'corp', userId: 'user' },
      surface: { type: 'direct', id: 'user' }, text: '查看销量', attachments: [], receivedAt: Date.now()
    };
    const task = await orchestrator.accept(request);
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));
    expect(sent).toContain('旧路径的回答');
    expect((await repo.getWorkflow(task!.id))?.contract?.requiredFacts).toHaveLength(1);
    await orchestrator.stop();
  });
});
