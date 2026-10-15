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
  it('does not start a review after the task deadline',async()=>{
    const http=vi.fn();
    const result=await new EvidenceReviewer(config,http as typeof fetch).review(input({deadlineAt:Date.now()-1}));
    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('review_task_deadline_exceeded');
    expect(http).not.toHaveBeenCalled();
  });
  it('cancels a stalled review at the shared task deadline without a fresh retry budget',async()=>{
    vi.useFakeTimers();
    try {
      const http=vi.fn(async(_url:string,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
        init.signal?.addEventListener('abort',()=>reject(init.signal?.reason),{once:true});
      }));
      const pending=new EvidenceReviewer(config,http as typeof fetch).review(input({deadlineAt:Date.now()+1000}));
      await vi.advanceTimersByTimeAsync(1100);
      const result=await pending;
      expect(result.status).toBe('unavailable');
      expect(http).toHaveBeenCalledOnce();
      expect(result.diagnostics?.attempts).toBe(1);
      expect(result.diagnostics?.retries).toHaveLength(0);
    } finally {vi.useRealTimers();}
  });
  it('excludes generated report revisions from every source channel without crowding out observations or submit receipts', async () => {
    const sample = input();
    const workflow = new TaskWorkflow();
    const old = workflow.record('artifact.render_report', true);
    const revised = workflow.record('artifact.revise_report', true);
    const submit = workflow.record('artifact.submit', true);
    const source = sample.evidence[0]!;
    const sourceText = JSON.stringify({data: {total: 1, rows: [{value: 42}]}});
    const reportText = JSON.stringify({data: {total: 999, rows: [{wrong: 'x'.repeat(200000)}]}});
    const http = vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(JSON.parse(String(init.body)).input[1].content);
      expect(payload.evidence.map((item: {id: string}) => item.id)).toEqual([source.id, submit.id]);
      expect(payload.evidenceManifest.map((item: {evidenceId: string}) => item.evidenceId)).toEqual([source.id]);
      expect(Object.keys(payload.excerpts).sort()).toEqual([source.id, submit.id].sort());
      expect(payload.excerpts[source.id]).toBe(sourceText);
      expect(payload.excerpts[submit.id]).toContain('delivered');
      expect(payload.dataQuality).toEqual({[source.id]: {total: 1, returnedRowCount: 1, currencies: []}});
      expect(payload.excerptAvailability[old.id]).toBeUndefined();
      expect(payload.excerptsUnavailable ?? []).not.toContain(old.id);
      return modelReply([]);
    });
    expect((await new EvidenceReviewer(config, http as typeof fetch).review({...sample,
      evidence: [source, old, revised, submit], completion: {...sample.completion, factEvidence: {old: [old.id]}},
      evidenceFiles: [{file: 'old.json', evidenceId: old.id, capabilityId: old.capabilityId, arguments: '{}', kind: 'report'},
        {file: 'data.json', evidenceId: source.id, capabilityId: source.capabilityId, arguments: '{}', kind: 'observation'}],
      excerpts: {[old.id]: reportText, [revised.id]: reportText, [source.id]: sourceText, [submit.id]: '{"delivered":true}'}})).status).toBe('pass');
  });

  it('deduplicates repeated bound row context without losing any fact or its provenance', async () => {
    const sample = input();
    const context = {evidenceId: sample.evidence[0]!.id, sourceSha256: 'sha', rowsPath: 'data.rows', rowIndex: 399,
      selector: {asin: 'ASIN-399'}, rowDimensions: {asin: 'ASIN-399', spend: 42, sales: 100},
      query: {filters: ['source-context'.repeat(200)]}, context: {coverage: 'partial'}, lineage: {operation: 'sum'}};
    const facts = [{...context, id: 'spend', field: 'spend', value: 42, display: '42'},
      {...context, id: 'sales', field: 'sales', value: 100, display: '100'}];
    const http = vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(JSON.parse(String(init.body)).input[1].content);
      const compact = payload.verifiedFacts;
      expect(compact.artifactSha256).toBe('pdf-sha');
      expect(compact.facts).toHaveLength(2);
      expect(Object.keys(compact.rows)).toHaveLength(1);
      for (let index = 0; index < facts.length; index++) {
        const {rowRef, ...fact} = compact.facts[index];
        expect({...compact.rows[rowRef], ...fact}).toEqual(facts[index]);
      }
      expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify({artifactSha256: 'pdf-sha', facts}).length);
      return modelReply([]);
    });
    expect((await new EvidenceReviewer(config, http as typeof fetch).review({...sample,
      verifiedFacts: {artifactSha256: 'pdf-sha', facts}})).status).toBe('pass');
  });

  it('retains a bound source row beyond the former 12k prefix and its complete host fact', async () => {
    const sample = input();
    const sourceId = sample.evidence[0]!.id;
    const rows = Array.from({length: 400}, (_, index) => ({asin: `ASIN-${index}`, spend: index, description: 'source context '.repeat(4)}));
    const fact = {id: 'late_spend', evidenceId: sourceId, sourceSha256: 'sha', rowsPath: 'data.rows', rowIndex: 399,
      selector: {asin: 'ASIN-399'}, field: 'spend', value: 399, display: '399', rowDimensions: rows[399]!, lineage: {}};
    const http = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const payload = JSON.parse(body.input[1].content);
      expect(payload.verifiedFacts.facts).toEqual([fact]);
      expect(JSON.parse(payload.excerpts[sourceId]).data.rows).toEqual(rows);
      expect(payload.excerptAvailability[sourceId].status).toBe('complete');
      expect(body.input[0].content).toContain('不得因为原始摘录未保留该行要求重新查询相同数据');
      return modelReply([]);
    });
    expect((await new EvidenceReviewer(config, http as typeof fetch).review({...sample,
      verifiedFacts: {artifactSha256: 'pdf-sha', facts: [fact]},
      excerpts: {[sourceId]: JSON.stringify({data: {rows}})}})).status).toBe('pass');
  });

  it('shares complete source provenance across different rows without losing context', async () => {
    const sample=input();
    const facts=Array.from({length:8},(_,i)=>({id:`fact_${i}`,evidenceId:sample.evidence[0]!.id,
      sourceSha256:'source-sha',rowsPath:'data.rows',rowIndex:i,selector:{asin:`ASIN-${i}`},
      field:'spend',value:i,display:String(i),rowDimensions:{asin:`ASIN-${i}`,spend:i},
      query:{scope:'authorized',fullQuery:'完整查询'.repeat(1000)},context:{coverage:'partial'},lineage:{fullPopulation:'完整溯源'.repeat(1000)}}));
    const http=vi.fn(async(_url:string,init:RequestInit)=>{
      const payload=JSON.parse(JSON.parse(String(init.body)).input[1].content);
      const compact=payload.verifiedFacts;
      expect(compact.objects).toBeDefined();
      for(let i=0;i<facts.length;i++) {
        const {rowRef,...fact}=compact.facts[i];
        const row={...compact.rows[rowRef]};
        for(const key of ['query','context','rowDimensions','lineage']) {
          row[key]=compact.objects[row[key+'Ref']]; delete row[key+'Ref'];
        }
        expect({...row,...fact}).toEqual(facts[i]);
      }
      expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify({facts}).length/2);
      return modelReply([]);
    });
    expect((await new EvidenceReviewer(config,http as typeof fetch).review({...sample,
      verifiedFacts:{artifactSha256:'pdf-sha',facts}})).status).toBe('pass');
  });

  it('keeps table bindings whole and labels bounded source omissions without declaring missing data', async () => {
    const sample = input();
    const sourceId = sample.evidence[0]!.id;
    const table = {evidenceId: sourceId, sourceSha256: 'sha', rowsPath: 'data.rows', columns: ['asin', 'spend'], rows: [['late-row', 42]]};
    const source = JSON.stringify({data: {total: 5000, rows: Array.from({length: 5000}, (_, index) => ({asin: `ASIN-${index}`, note: 'x'.repeat(100)}))}});
    const http = vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(JSON.parse(String(init.body)).input[1].content);
      expect(payload.verifiedEvidenceTables).toEqual([table]);
      expect(payload.excerptAvailability[sourceId].status).toBe('truncated');
      expect(payload.excerptsUnavailable ?? []).not.toContain(sourceId);
      expect(JSON.stringify({verifiedEvidenceTables: payload.verifiedEvidenceTables}).length + Object.values(payload.excerpts).reduce((sum: number, text) => sum + String(text).length, 0)).toBeLessThanOrEqual(160000);
      expect(payload.dataQuality[sourceId].returnedRowCount).toBe(5000);
      return modelReply([]);
    });
    expect((await new EvidenceReviewer(config, http as typeof fetch).review({...sample, verifiedEvidenceTables: [table], excerpts: {[sourceId]: source}})).status).toBe('pass');
  });

  it('does not silently drop host bindings or call the model when they exceed the shared budget', async () => {
    const http = vi.fn();
    const result = await new EvidenceReviewer(config, http as typeof fetch).review(input({
      verifiedEvidenceTables: [{evidenceId: 'source', rows: ['x'.repeat(160001)]}]
    }));
    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('review_bound_evidence_exceeds_budget');
    expect(http).not.toHaveBeenCalled();
  });

  it.each([
    ['gpt-5.6-sol','gemini-3.8-flash-high',64000,64000],
    ['gemini-3.8-flash-high','gpt-5.6-sol',64000,undefined],
    ['gpt-5.6-sol','gemini-3.8-flash-high',0,undefined]
  ] as const)('applies Gemini budget using the actual review model: %s / %s / %s',async(mainModel,reviewModel,configured,expected)=>{
    const http=vi.fn(async(_url:string,init:RequestInit)=>{
      const body=JSON.parse(String(init.body));expect(body.model).toBe(reviewModel);expect(body.max_output_tokens).toBe(expected);
      return modelReply([]);
    });
    const result=await new EvidenceReviewer({...config,MODEL_NAME:mainModel,MODEL_REVIEW_NAME:reviewModel,
      GEMINI_RESPONSES_DEFAULT_MAX_OUTPUT_TOKENS:configured},http as typeof fetch).review(input());
    expect(result.status).toBe('pass');expect(result.diagnostics?.maxOutputTokens).toBe(expected);expect(http).toHaveBeenCalledOnce();
  });
  it('does not repeat an explicit MAX_TOKENS terminal in either transport or verdict retry loops',async()=>{
    const wire='data: {"type":"response.incomplete","response":{"status":"incomplete","output":[],"incomplete_details":{"reason":"max_output_tokens"}}}\n\n';
    const http=vi.fn(async()=>new Response(wire,{headers:{'content-type':'text/event-stream'}}));
    const result=await new EvidenceReviewer(config,http as typeof fetch).review(input());
    expect(result.status).toBe('unavailable');expect(result.issues).toEqual([]);
    expect(result.reason).toBe('MODEL_STREAM_response.incomplete:max_output_tokens');
    expect(result.diagnostics?.attempts).toBe(1);expect(result.diagnostics?.retries).toEqual([]);expect(http).toHaveBeenCalledOnce();
  });
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
      const pending = new EvidenceReviewer({...config,MODEL_REVIEW_MAX_ATTEMPTS:6}, http as typeof fetch).review(input());
      await vi.advanceTimersByTimeAsync(90000);
      const result = await pending;
      expect(result.status).toBe('pass');
      expect(http).toHaveBeenCalledTimes(6);
      expect(result.diagnostics?.retries).toHaveLength(5);
    } finally { vi.useRealTimers(); }
  });

  it('bounds a stalled review independently from the twenty-minute executor retry policy',async()=>{
    vi.useFakeTimers();
    try {
      const http=vi.fn(async(_url:string,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>
        init.signal?.addEventListener('abort',()=>reject(new DOMException('expired','AbortError')))));
      const pending=new EvidenceReviewer({...config,MODEL_REQUEST_MAX_ATTEMPTS:6,MODEL_REQUEST_RETRY_BUDGET_MS:1_200_000},http as typeof fetch).review(input());
      await vi.advanceTimersByTimeAsync(361000);
      const result=await pending;
      expect(result.status).toBe('unavailable');
      expect(http).toHaveBeenCalledTimes(2);
      expect(result.issues).toEqual([]);
      expect(result.diagnostics?.attempts).toBe(2);
    } finally {vi.useRealTimers();}
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
      const pending = new EvidenceReviewer({...config,MODEL_REVIEW_MAX_ATTEMPTS:6,MODEL_REVIEW_RETRY_BUDGET_MS:1_200_000}, http).review(input());
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
