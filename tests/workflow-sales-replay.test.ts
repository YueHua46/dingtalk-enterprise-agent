import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from './test-config.js';
import { InMemoryRepository } from '../src/persistence.js';
import { TaskOrchestrator, MAX_REVIEW_ROUNDS } from '../src/task-orchestrator.js';
import type { ReviewResult } from '../src/evidence-reviewer.js';
import type { AgentRequest } from '../src/types.js';

const config = loadConfig({
  NODE_ENV: 'production', TASK_WORKFLOW_MODE: 'enforce', DINGTALK_ROBOT_CODE: 'robot', DINGTALK_CLIENT_ID: 'id',
  DINGTALK_CLIENT_SECRET: 'secret', DWS_BOT_PROFILE: 'bot', MODEL_BASE_URL: 'https://model.example/v1',
  MODEL_API_KEY: 'model-key', CLAMAV_HOST: 'clamav', INTERNAL_API_TOKEN: 'x'.repeat(32)
});

const request: AgentRequest = {
  requestId: 'sales-replay', messageId: 'sales-replay', user: { corpId: 'corp', userId: 'user-1' },
  surface: { type: 'group', id: 'group-1' }, text: '使用你亚马逊的运营经验分析我们部分ASIN销量不好的原因。',
  attachments: [], receivedAt: Date.now()
};

const call = (namespace: string, tool: string, args: unknown) => ({ method: 'item/tool/call', params: { namespace, tool, arguments: args } });
const pass: ReviewResult = { status: 'pass', issues: [], reason: 'supported' };
const revise = (problem: string): ReviewResult => ({ status: 'revise', reason: problem,
  issues: [{ severity: 'blocking', category: 'fact', location: '', problem, fix: '按证据修正' }] });

function setup(codex: Record<string, unknown>) {
  const repo = new InMemoryRepository();
  const sent: string[] = [];
  const orchestrator = new TaskOrchestrator(config, repo, { interrupt: vi.fn(async () => undefined), ...codex } as any, {} as any, {
    async send(_surface, markdown) { sent.push(markdown); }
  });
  vi.spyOn((orchestrator as any).crossBorderOpsTool, 'execute').mockImplementation(async (_user: unknown, input: { dataset: string }) => ({
    dataset: input.dataset, scope: { lingxing_sids: [44] },
    data: { current_period: { start_date: '2026-09-21', end_date: '2026-09-27' }, rows: [{ lingxing_sid: 44, asin: 'B000000001', current_units: 3, baseline_units: 9 }] },
    evidence: { source: 'crossborderops', queried_at: '2026-09-28T00:00:00Z', authorized_lingxing_sids: [44] }
  }));
  return { repo, sent, orchestrator };
}

describe('enforced task completion', () => {
  it('does not restart the exhausted reviewer budget for an unchanged file', async () => {
    const codex = {
      inspectOutput: vi.fn(async () => ({name: 'report.pdf', size: 100, sha256: 'same', reviewText: '正文'})),
      startThread: vi.fn(async () => 'thread-1'),
      turn: vi.fn(async (_id: string, _prompt: string, _events: unknown, onTool: (value: unknown) => Promise<any>) => {
        for (let i = 0; i < 2; i++) {
          const result = await onTool(call('artifact', 'submit', {path: 'report.pdf'}));
          expect(result.success).toBe(false);
          expect(result.contentItems[0].text).toContain('ARTIFACT_REVIEW_UNAVAILABLE');
        }
        return {text: '独立审核不可用，文件尚未发送。', threadId: 'thread-1'};
      })
    };
    const {repo, orchestrator} = setup(codex);
    const publish = vi.spyOn(orchestrator as any, 'submitGeneratedArtifact');
    const review = vi.spyOn((orchestrator as any).evidenceReviewer, 'review')
      .mockResolvedValueOnce({status: 'unavailable', issues: [], reason: 'review_http_502'}).mockResolvedValue(pass);
    const task = await orchestrator.accept(request);
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));
    expect(review.mock.calls.filter(([input]) => input.completion.answer === '正文')).toHaveLength(1);
    expect(publish).not.toHaveBeenCalled();
    expect((await repo.getWorkflow(task!.id))?.artifactReviews?.same.status).toBe('unavailable');
    await orchestrator.stop();
  });
  it('reviews the actual report body and never publishes a rejected file', async () => {
    const body = '每单亏损120美元，已证实';
    const codex = {
      inspectOutput: vi.fn(async () => ({name: 'report.pdf', path: '/output/report.pdf', size: 100, sha256: 'original', reviewText: body})),
      startThread: vi.fn(async () => 'thread-1'),
      turn: vi.fn(async (_id: string, _prompt: string, _events: unknown, onTool: (value: unknown) => Promise<any>) => {
        const result = await onTool(call('artifact', 'submit', {path: 'report.pdf'}));
        expect(result.success).toBe(false);
        expect(result.contentItems[0].text).toContain('ARTIFACT_REVIEW_REVISE');
        return {text: '缺成本依据，报告尚未发送。', threadId: 'thread-1'};
      })
    };
    const {repo, orchestrator} = setup(codex);
    const publish = vi.spyOn(orchestrator as any, 'submitGeneratedArtifact');
    const review = vi.spyOn((orchestrator as any).evidenceReviewer, 'review').mockResolvedValueOnce(revise('缺少成本证据')).mockResolvedValue(pass);
    const task = await orchestrator.accept(request);
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));
    expect(review.mock.calls[0]![0].completion.answer).toBe(body);
    expect(publish).not.toHaveBeenCalled();
    expect(await repo.listTaskArtifacts(task!.id)).toEqual([]);
    await orchestrator.stop();
  });

  it('rejects a file that changed after content verification', async () => {
    const codex = {
      inspectOutput: vi.fn().mockResolvedValueOnce({name: 'report.pdf', size: 100, sha256: 'a', reviewText: '已核实正文'})
        .mockResolvedValue({name: 'report.pdf', size: 100, sha256: 'b', reviewText: '已改写正文'}),
      startThread: vi.fn(async () => 'thread-1'),
      turn: vi.fn(async (_id: string, _prompt: string, _events: unknown, onTool: (value: unknown) => Promise<any>) => {
        const result = await onTool(call('artifact', 'submit', {path: 'report.pdf'}));
        expect(result.success).toBe(false);
        expect(result.contentItems[0].text).toContain('OUTPUT_CHANGED_AFTER_REVIEW');
        return {text: '文件变化，尚未发送。', threadId: 'thread-1'};
      })
    };
    const {repo, orchestrator} = setup(codex);
    const publish = vi.spyOn(orchestrator as any, 'submitGeneratedArtifact');
    vi.spyOn((orchestrator as any).evidenceReviewer, 'review').mockResolvedValue(pass);
    const task = await orchestrator.accept(request);
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));
    expect(publish).not.toHaveBeenCalled();
    await orchestrator.stop();
  });
  it('lets the agent own its plan, rejects an unsupported blocked claim, and delivers after one review', async () => {
    let reviews = 0;
    const codex = {
      startThread: vi.fn(async () => 'thread-1'),
      turn: vi.fn(async (_id: string, _prompt: string, _events: unknown, onTool: (value: unknown) => Promise<any>) => {
        const planned = await onTool(call('agent', 'workflow', { operation: 'plan', contract: {
          goal: '诊断销量下滑 ASIN 的原因', requiredFacts: [{ id: 'sales_change', description: '两期内部销量', acceptableSources: ['crossborderops.*'] }]
        } }));
        expect(planned.success).toBe(true);
        const premature = await onTool(call('agent', 'workflow', { operation: 'complete', completion: {
          status: 'blocked', answer: '领星受限，无法分析', factEvidence: {}, missingFacts: ['sales_change'] } }));
        expect(premature.success).toBe(false);
        expect(premature.contentItems[0].text).toContain('WORKFLOW_SOURCE_NOT_ATTEMPTED');
        const sales = await onTool(call('crossborderops', 'query', { dataset: 'daily.performance_changes', params: {} }));
        expect(sales.success).toBe(true);
        const final = await onTool(call('agent', 'workflow', { operation: 'complete', completion: {
          status: 'answered', answer: 'B000000001 销量由 9 降至 3；可能原因是流量下降（推断，待核查）。建议先核查广告预算。' } }));
        expect(final.success).toBe(true);
        return { text: '未核验的自由回答', threadId: 'thread-1' };
      })
    };
    const { repo, sent, orchestrator } = setup(codex);
    vi.spyOn((orchestrator as any).evidenceReviewer, 'review').mockImplementation(async () => { reviews += 1; return pass; });
    const task = await orchestrator.accept(request);
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));
    expect(sent.some((message) => message.includes('由 9 降至 3'))).toBe(true);
    expect(sent.some((message) => message.includes('未核验的自由回答'))).toBe(false);
    expect(reviews).toBe(1);
    expect(codex.startThread).toHaveBeenCalledTimes(1);
    await orchestrator.stop();
  });

  it('returns all verifier issues to the agent in one round and accepts the corrected answer', async () => {
    const feedback: string[] = [];
    const codex = {
      startThread: vi.fn(async () => 'thread-1'),
      turn: vi.fn(async (_id: string, _prompt: string, _events: unknown, onTool: (value: unknown) => Promise<any>) => {
        await onTool(call('crossborderops', 'query', { dataset: 'daily.product', params: {} }));
        const first = await onTool(call('agent', 'workflow', { operation: 'complete', completion: { status: 'answered', answer: '点击 63 次' } }));
        expect(first.success).toBe(false);
        feedback.push(first.contentItems[0].text);
        const second = await onTool(call('agent', 'workflow', { operation: 'complete', completion: { status: 'answered', answer: '点击 53 次' } }));
        expect(second.success).toBe(true);
        return { text: 'done', threadId: 'thread-1' };
      })
    };
    const { repo, sent, orchestrator } = setup(codex);
    vi.spyOn((orchestrator as any).evidenceReviewer, 'review')
      .mockResolvedValueOnce({ status: 'revise', reason: 'x', issues: [
        { severity: 'blocking', category: 'fact', location: '点击 63 次', problem: '证据为 53 次', fix: '改为 53 次' },
        { severity: 'blocking', category: 'inference', location: '导致', problem: '推断写成事实', fix: '标注为推断' }
      ] })
      .mockResolvedValueOnce(pass);
    const task = await orchestrator.accept(request);
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));
    expect(feedback[0]).toContain('改为 53 次');
    expect(feedback[0]).toContain('标注为推断');
    expect(feedback[0]).toContain(`第 1/${MAX_REVIEW_ROUNDS} 轮`);
    expect(sent).toContain('点击 53 次');
    await orchestrator.stop();
  });

  it('validates a plain final message without asking the agent to call complete', async () => {
    const codex = {
      startThread: vi.fn(async () => 'thread-1'),
      turn: vi.fn(async (_id: string, _prompt: string, _events: unknown, onTool: (value: unknown) => Promise<any>) => {
        await onTool(call('crossborderops', 'query', { dataset: 'daily.product', params: {} }));
        return { text: '直接输出的最终答复', threadId: 'thread-1' };
      })
    };
    const { repo, sent, orchestrator } = setup(codex);
    const review = vi.spyOn((orchestrator as any).evidenceReviewer, 'review').mockResolvedValue(pass);
    const task = await orchestrator.accept(request);
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));
    expect(sent).toContain('直接输出的最终答复');
    expect(codex.turn).toHaveBeenCalledTimes(1);
    expect(review).toHaveBeenCalledTimes(1);
    await orchestrator.stop();
  });

  it('starts one repair turn with the issues when a plain final message fails verification', async () => {
    const prompts: string[] = [];
    const codex = {
      startThread: vi.fn(async () => 'thread-1'),
      turn: vi.fn(async (_id: string, prompt: string) => {
        prompts.push(prompt);
        return { text: prompts.length === 1 ? '初稿' : '修正稿', threadId: 'thread-1' };
      })
    };
    const { repo, sent, orchestrator } = setup(codex);
    vi.spyOn((orchestrator as any).evidenceReviewer, 'review').mockResolvedValueOnce(revise('数值与证据不符')).mockResolvedValueOnce(pass);
    const task = await orchestrator.accept(request);
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('数值与证据不符');
    expect(sent).toContain('修正稿');
    await orchestrator.stop();
  });

  it('preserves a draft but explicitly marks unavailable verification as partial', async () => {
    const codex = {
      startThread: vi.fn(async () => 'thread-1'),
      turn: vi.fn(async () => ({ text: '答复', threadId: 'thread-1' }))
    };
    const { repo, sent, orchestrator } = setup(codex);
    vi.spyOn((orchestrator as any).evidenceReviewer, 'review').mockResolvedValue({ status: 'unavailable', issues: [], reason: 'timeout' });
    const task = await orchestrator.accept(request);
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));
    expect(sent.some(text => text.includes('答复') && text.includes('独立核验未完成'))).toBe(true);
    expect((await repo.getWorkflow(task!.id))?.completion?.status).toBe('partial');
    expect(codex.turn).toHaveBeenCalledTimes(1);
    await orchestrator.stop();
  });

  it('terminates with unresolved findings instead of delivering a rejected draft', async () => {
    let turns = 0;
    const codex = {
      startThread: vi.fn(async () => 'thread-1'),
      turn: vi.fn(async () => ({ text: `第 ${++turns} 稿`, threadId: 'thread-1' }))
    };
    const { repo, sent, orchestrator } = setup(codex);
    const review = vi.spyOn((orchestrator as any).evidenceReviewer, 'review').mockResolvedValue(revise('仍有问题'));
    const task = await orchestrator.accept(request);
    await vi.waitFor(async () => expect((await repo.findTask(task!.id))?.status).toBe('completed'));
    expect(review).toHaveBeenCalledTimes(MAX_REVIEW_ROUNDS);
    expect(sent).not.toContain(`第 ${MAX_REVIEW_ROUNDS} 稿`);
    expect(sent.some(text => text.includes('仍有问题'))).toBe(true);
    expect((await repo.getWorkflow(task!.id))?.completion?.status).toBe('partial');
    await orchestrator.stop();
  });
});
