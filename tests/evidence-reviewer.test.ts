import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from './test-config.js';
import { EvidenceReviewer, formatIssues, parseIssues, type ReviewInput } from '../src/evidence-reviewer.js';
import { TaskWorkflow } from '../src/task-workflow.js';

vi.mock('node:timers/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:timers/promises')>();
  return {...original, setTimeout: (ms: number, value: unknown, options?: {signal?: AbortSignal}) => {
    if (!vi.isFakeTimers()) return original.setTimeout(ms, value, options);
    return new Promise((resolve, reject) => {
      options?.signal?.throwIfAborted();
      const timer = setTimeout(() => resolve(value), ms);
      options?.signal?.addEventListener('abort', () => {clearTimeout(timer); reject(new DOMException('cancelled', 'AbortError'));}, {once: true});
    });
  }};
});

const config = loadConfig({ DINGTALK_ROBOT_CODE: 'robot', MODEL_BASE_URL: 'https://model.example/v1', MODEL_API_KEY: 'key' });

function modelReply(issues: unknown[]): Response {
  return new Response(JSON.stringify({ output: [{ content: [{ text: JSON.stringify({ issues, checks: [{claim: '合成测试主张', kind: 'fact', evidenceIds: [], observed: '测试事实', missing: '', verdict: 'supported'}] }) }] }] }), { status: 200 });
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
  it('lets a valid 51-second review finish and records its usage', async () => {
    vi.useFakeTimers();
    try {
      const http = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 51_000));
        return new Response(JSON.stringify({usage: {input_tokens: 90000, output_tokens: 1000}, output: [{content: [{text: JSON.stringify({issues: [], checks: [{claim: '测试', kind: 'fact', evidenceIds: [], observed: '测试', missing: '', verdict: 'supported'}]})}]}]}));
      });
      const pending = new EvidenceReviewer(config, http as typeof fetch).review(input());
      await vi.advanceTimersByTimeAsync(51_000);
      const result = await pending;
      expect(result.status).toBe('pass');
      expect(result.diagnostics?.requests[0]).toMatchObject({durationMs: 51000, status: 200, inputTokens: 90000});
    } finally { vi.useRealTimers(); }
  });

  it('retries five transient failures before accepting the sixth response', async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const http = vi.fn(async () => ++attempts <= 5 ? new Response('upstream busy', {status: 502, headers: {'retry-after': '0'}}) : modelReply([]));
      const pending = new EvidenceReviewer(config, http as typeof fetch).review(input());
      await vi.advanceTimersByTimeAsync(90000);
      const result = await pending;
      expect(result.status).toBe('pass');
      expect(http).toHaveBeenCalledTimes(6);
      expect(result.diagnostics?.retries).toHaveLength(5);
    } finally { vi.useRealTimers(); }
  });

  it('retries an attempt timeout within the independent total budget', async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const http: typeof fetch = async (_url, init) => {
        if (++attempts > 1) return modelReply([]);
        return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('attempt expired', 'AbortError'))));
      };
      const pending = new EvidenceReviewer({...config, MODEL_REVIEW_TIMEOUT_MS: 180000}, http).review(input());
      await vi.advanceTimersByTimeAsync(185000);
      expect((await pending).status).toBe('pass');
      expect(attempts).toBe(2);
    } finally { vi.useRealTimers(); }
  });
  it('allows five full three-minute timeouts followed by a long successful sixth attempt', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const http: typeof fetch = async (_url, init) => {
        if (++calls <= 5) return new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('deadline', 'AbortError'))));
        await new Promise(resolve => setTimeout(resolve, 179_000));
        return modelReply([]);
      };
      const pending = new EvidenceReviewer(config, http).review(input());
      await vi.advanceTimersByTimeAsync(1_199_000);
      const result = await pending;
      expect(result.status).toBe('pass');
      expect(calls).toBe(6);
      expect(result.diagnostics?.retries).toHaveLength(5);
    } finally {vi.useRealTimers();}
  });
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
      expect(body.input[0]!.content).toContain('recommendation 缺少效果或利润验证条件本身不自动构成错误');
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
      expect(() => parseIssues('结果：{"issues":[{"severity":"high","problem":"x"},{"severity":"blocking"}]}')).toThrow('review_invalid_issue');
    expect(() => parseIssues('no json')).toThrow('review_invalid');
  });
  it('cannot pass an unsupported claim just because the issue list is empty', () => {
    const issues = parseIssues(JSON.stringify({checks: [{claim: '可回收全部花费', evidenceIds: [],
      kind: 'interpretation', observed: '过去没有归因订单', missing: '未来转化与增量影响未知', verdict: 'unsupported'}], issues: []}));
    expect(issues).toContainEqual(expect.objectContaining({severity: 'blocking', location: '可回收全部花费'}));
    expect(() => parseIssues('{"issues":[]}')).toThrow('review_missing_checks');
  });
  it('does not auto-block an unsupported recommendation solely for missing outcome validation', () => {
    const issues = parseIssues(JSON.stringify({checks: [{claim: '建议将竞价下调 20%', kind: 'recommendation', evidenceIds: ['evidence-1'],
      observed: '该对象 CPC 高于其他已查对象', missing: '调整后的实际表现尚未观察', verdict: 'unsupported'}], issues: []}));
    expect(issues).toEqual([]);
  });
});
