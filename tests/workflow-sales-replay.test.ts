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

const request: AgentRequest = {
  requestId: 'sales-replay', messageId: 'sales-replay', user: { corpId: 'corp', userId: 'user-1' },
  surface: { type: 'group', id: 'group-1' }, text: '我想知道我最近哪些亚马逊店铺的哪些 ASIN 销量不好，什么原因。',
  attachments: [], receivedAt: Date.now()
};

describe('sales task replay', () => {
  it('cannot end at a Lingxing directory restriction and completes after scoped sales evidence', async () => {
    const repo = new InMemoryRepository();
    const sent: string[] = [];
    const direct: string[] = [];
    let turns = 0;
    const call = (namespace: string, tool: string, args: unknown) => ({ method: 'item/tool/call', params: { namespace, tool, arguments: args } });
    const codex = {
      startThread: vi.fn().mockResolvedValueOnce('thread-old').mockResolvedValueOnce('thread-new'),
      turn: vi.fn(async (_id: string, _prompt: string, _events: unknown, onTool: (value: unknown) => Promise<any>) => {
        turns += 1;
        if (turns === 1) return { text: '旧会话称领星受限，无法继续。', threadId: 'thread-old' };
        const directory = await onTool(call('lingxing', 'catalog', { toolId: 'help' }));
        expect(directory.success).toBe(true);
        const premature = await onTool(call('agent', 'workflow', { operation: 'complete', completion: {
          status: 'blocked', answer: '领星受限，无法找出销量下降的 ASIN', factEvidence: {}, missingFacts: ['sales_change', 'cause_evidence']
        } }));
        expect(premature.success).toBe(false);
        expect(premature.contentItems[0].text).toContain('WORKFLOW_SOURCE_NOT_ATTEMPTED');
        const sales = await onTool(call('crossborderops', 'query', { dataset: 'daily.performance_changes', params: { days: 7 } }));
        expect(sales.success).toBe(true);
        const evidenceId = String(sales.contentItems.at(-1).text).match(/证据 ID：([^；]+)/)?.[1];
        expect(evidenceId).toBeTruthy();
        const detail = await onTool(call('crossborderops', 'query', { dataset: 'daily.product', params: { asin: 'B000000001', days: 14 } }));
        expect(detail.success).toBe(true);
        const causeId = String(detail.contentItems.at(-1).text).match(/证据 ID：([^；]+)/)?.[1];
        expect(causeId).toBeTruthy();
        const final = await onTool(call('agent', 'workflow', { operation: 'complete', completion: {
          status: 'answered', answer: '最近完整 7 日，示例店铺的 B000000001 销量由 9 降至 3；同期流量由 100 降至 50，流量下降是可核验的伴随因素，尚不能断言唯一原因。',
          factEvidence: { sales_change: [evidenceId], cause_evidence: [causeId] }, missingFacts: []
        } }));
        expect(final.success).toBe(true);
        return { text: '未核验的自由回答', threadId: 'thread-new' };
      }),
      interrupt: vi.fn(async () => undefined)
    };
    const orchestrator = new TaskOrchestrator(config, repo, codex as any, {} as any, {
      async send(_surface, markdown) { sent.push(markdown); },
      async sendDirect(_user, markdown) { direct.push(markdown); }
    });
    vi.spyOn((orchestrator as any).contractPlanner, 'plan').mockResolvedValue({
      mode: 'read', goal: '分析授权店铺与 ASIN 的销量下滑', deliverables: ['店铺 ASIN 与原因'],
      requiredFacts: [
        { id: 'sales_change', description: '两期内部销量比较', acceptableSources: ['crossborderops.*'] },
        { id: 'cause_evidence', description: '下滑对象的流量转化等诊断数据', acceptableSources: ['crossborderops.*'] }
      ],
      assumptions: ['最近完整 7 日'], openQuestions: [], completionCriteria: ['有销量证据']
    });
    vi.spyOn((orchestrator as any).mcpReadTool, 'execute').mockResolvedValue({ tools: [] });
    vi.spyOn((orchestrator as any).crossBorderOpsTool, 'execute').mockImplementation(async (_user: unknown, input: { dataset: string }) => ({
      dataset: input.dataset, scope: { lingxing_sids: [44] },
      data: input.dataset === 'daily.performance_changes'
        ? { current_period: { start_date: '2026-09-15', end_date: '2026-09-21' }, rows: [
          { lingxing_sid: 44, asin: 'B000000001', current_units: 3, baseline_units: 9 }
        ] }
        : [{ asin: 'B000000001', baseline_sessions: 100, current_sessions: 50 }],
      evidence: { source: 'crossborderops', queried_at: '2026-09-24T00:00:00Z', authorized_lingxing_sids: [44] }
    }));
    vi.spyOn((orchestrator as any).evidenceReviewer, 'review').mockResolvedValue({ supported: true, reason: 'supported' });
    const task = await orchestrator.accept(request);
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));
    expect(sent.some((message) => message.includes('由 9 降至 3'))).toBe(true);
    expect(direct).toEqual([]);
    expect(sent.some((message) => message.includes('未核验的自由回答'))).toBe(false);
    expect(codex.startThread).toHaveBeenCalledTimes(2);
    await orchestrator.stop();
  });
});
