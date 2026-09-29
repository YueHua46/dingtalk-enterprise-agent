import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from './test-config.js';
import { EvidenceReviewer, formatIssues, parseIssues, type ReviewInput } from '../src/evidence-reviewer.js';
import { TaskWorkflow } from '../src/task-workflow.js';

const config = loadConfig({ DINGTALK_ROBOT_CODE: 'robot', MODEL_BASE_URL: 'https://model.example/v1', MODEL_API_KEY: 'key' });

function modelReply(issues: unknown[]): Response {
  return new Response(JSON.stringify({ output: [{ content: [{ text: JSON.stringify({ issues }) }] }] }), { status: 200 });
}

function input(overrides: Partial<ReviewInput> = {}): ReviewInput {
  const workflow = new TaskWorkflow();
  const data = workflow.record('crossborderops.daily.product', true);
  const calc = workflow.record('analysis.python', true);
  return {
    request: '使用你亚马逊的运营经验分析我们部分ASIN销量不好的原因。',
    completion: { status: 'answered', answer: '分析……', factEvidence: {}, missingFacts: [] },
    evidence: workflow.state.evidence,
    excerpts: { [data.id]: '{"dataset":"daily.product","data":{"rows":[]}}', [calc.id]: '{"code":"print(1)","outcome":{"stdout":"1"}}' },
    computeAvailable: true, round: 1, maxRounds: 3,
    ...overrides
  };
}

describe('EvidenceReviewer', () => {
  it('reports every issue from one call and blocks only on blocking issues', async () => {
    const http = vi.fn(async () => modelReply([
      { severity: 'blocking', category: 'fact', location: '广告点击 63 次', problem: '证据为 53 次', fix: '改为 53 次' },
      { severity: 'blocking', category: 'inference', location: '导致', problem: '把推断写成已证实', fix: '标注为推断' },
      { severity: 'advisory', category: 'relevance', location: '', problem: '可更简洁', fix: '' }
    ]));
    const result = await new EvidenceReviewer(config, http as unknown as typeof fetch).review(input());
    expect(http).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('revise');
    expect(result.issues).toHaveLength(3);
    expect(formatIssues(result.issues)).toContain('改为 53 次');
    expect(formatIssues(result.issues)).toContain('标注为推断');
  });

  it('passes an answer that only has advisory remarks', async () => {
    const http = vi.fn(async () => modelReply([{ severity: 'advisory', category: 'relevance', location: '', problem: '可更简洁', fix: '' }]));
    expect((await new EvidenceReviewer(config, http as unknown as typeof fetch).review(input())).status).toBe('pass');
  });

  it('treats verifier failures as unavailable after one retry, never as a rejection', async () => {
    const http = vi.fn(async () => { throw new Error('The operation was aborted due to timeout'); });
    const result = await new EvidenceReviewer(config, http as unknown as typeof fetch).review(input());
    expect(http).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('unavailable');
    expect(result.issues).toEqual([]);
  });

  it('retries an unparseable verdict once', async () => {
    const http = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: [{ content: [{ text: '无法判断' }] }] }), { status: 200 }))
      .mockResolvedValueOnce(modelReply([]));
    expect((await new EvidenceReviewer(config, http as unknown as typeof fetch).review(input())).status).toBe('pass');
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('sends the original request, computation evidence and the round to the verifier', async () => {
    const http = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { input: Array<{ role: string; content: string }> };
      const payload = JSON.parse(body.input[1]!.content) as Record<string, any>;
      expect(payload.request).toContain('运营经验');
      expect(payload.computeAvailable).toBe(true);
      expect(payload.round).toBe(3);
      expect(payload.maxRounds).toBe(3);
      expect(Object.values(payload.excerpts)[0]).toContain('print(1)');
      expect(body.input[0]!.content).toContain('建议本身就是交付物');
      return modelReply([]);
    });
    await new EvidenceReviewer(config, http as unknown as typeof fetch).review(input({ round: 3 }));
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('is unavailable rather than failing closed when no model is configured', async () => {
    const reviewer = new EvidenceReviewer(loadConfig({ DINGTALK_ROBOT_CODE: 'robot' }), vi.fn() as unknown as typeof fetch);
    expect((await reviewer.review(input())).status).toBe('unavailable');
  });

  it('parses issues defensively', () => {
    expect(parseIssues('结果：{"issues":[{"severity":"high","problem":"x"},{"severity":"blocking"}]}')).toEqual([
      { severity: 'advisory', category: 'other', location: '', problem: 'x', fix: '' }
    ]);
    expect(() => parseIssues('no json')).toThrow('review_invalid');
  });
});
