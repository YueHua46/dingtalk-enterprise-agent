import { describe, expect, it, vi } from 'vitest';
import { TaskContractPlanner } from '../src/task-contract-planner.js';
import { EvidenceReviewer } from '../src/evidence-reviewer.js';
import { TaskWorkflow } from '../src/task-workflow.js';

const config = { MODEL_BASE_URL: 'https://model.example/v1', MODEL_API_KEY: 'secret', MODEL_NAME: 'model' };
const response = (value: unknown) => new Response(JSON.stringify({ output: [{ content: [{ text: JSON.stringify(value) }] }] }), { status: 200 });

describe('independent task planning and evidence review', () => {
  it('requires a source-backed fact for a current-data request and retries an invalid plan once', async () => {
    const valid = {
      mode: 'read', goal: '查找授权店铺销量下滑的 ASIN', deliverables: ['比较期间及销量变化'],
      requiredFacts: [{ id: 'sales_change', description: '授权店铺两期销量变化', acceptableSources: ['crossborderops.*'], enumeration: 'all', grain: ['store', 'asin'] }],
      assumptions: ['最近完整七日与前七日'], openQuestions: [], completionCriteria: ['说明变化和证据']
    };
    const http = vi.fn().mockResolvedValueOnce(response({ ...valid, requiredFacts: [] })).mockResolvedValueOnce(response(valid))
      .mockResolvedValueOnce(response({ aligned: true, reason: '目标一致' }));
    const planner = new TaskContractPlanner(config, http);
    const plan = await planner.plan('最近哪些店铺的 ASIN 销量不好？');
    expect(plan.requiredFacts[0]?.acceptableSources).toEqual(['crossborderops.*']);
    expect(http).toHaveBeenCalledTimes(3);
    const body = JSON.parse(String(http.mock.calls[0]?.[1]?.body));
    expect(body.input[0].content).toContain('不能证明内部店铺销量');
  });

  it('repairs a contract that adds an unrequested comparison, independently of the business domain', async () => {
    const wrong = {
      mode: 'read', goal: '查询上周工单数量最低的团队', deliverables: ['最低团队', '与本周比较'],
      requiredFacts: [{ id: 'counts', description: '上周各团队工单数', acceptableSources: ['dingtalk.*'], enumeration: 'bounded', grain: ['team'] }],
      assumptions: ['比较本周'], openQuestions: [], completionCriteria: ['给出排名与环比']
    };
    const correct = { ...wrong, deliverables: ['最低团队及上周数量'], assumptions: [], completionCriteria: ['给出上周排名'] };
    const http = vi.fn().mockResolvedValueOnce(response(wrong))
      .mockResolvedValueOnce(response({ aligned: false, reason: '用户只要求上周单期排名，未要求与本周比较' }))
      .mockResolvedValueOnce(response(correct))
      .mockResolvedValueOnce(response({ aligned: true, reason: '目标一致' }));
    const planner = new TaskContractPlanner(config, http);
    expect((await planner.plan('上周工单数量最低的团队')).deliverables).toEqual(['最低团队及上周数量']);
    expect(http).toHaveBeenCalledTimes(4);
    const retry = JSON.parse(String(http.mock.calls[2]?.[1]?.body));
    expect(retry.input[0].content).toContain('用户只要求上周单期排名');
  });

  it('records each candidate and review verdict for a failed or repaired plan', async () => {
    const candidate = { mode: 'read', goal: '统计本周周报', deliverables: ['本周篇数', '历史总览'],
      requiredFacts: [{ id: 'reports', description: '周报文档', acceptableSources: ['dingtalk.*'], enumeration: 'all', grain: ['document'] }],
      assumptions: ['本周及历史'], openQuestions: [], completionCriteria: ['给出数量'] };
    const repaired = { ...candidate, deliverables: ['本周篇数'], assumptions: ['本周自然周'] };
    const http = vi.fn().mockResolvedValueOnce(response(candidate))
      .mockResolvedValueOnce(response({ aligned: false, reason: '历史总览超出请求' }))
      .mockResolvedValueOnce(response(repaired))
      .mockResolvedValueOnce(response({ aligned: true, reason: '目标一致' }));
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const plan = await new TaskContractPlanner(config, http).plan('查我这周写了多少篇周报', '', async (event, payload) => {
      events.push({ event, payload });
    });
    expect(plan.deliverables).toEqual(['本周篇数']);
    expect(events.map((item) => item.event)).toEqual(['attempt', 'draft', 'review', 'attempt', 'draft', 'review']);
    expect(events[1]?.payload.contract).toEqual(candidate);
    expect(events[2]?.payload).toMatchObject({ attempt: 1, aligned: false, reason: '历史总览超出请求' });
    expect(events[4]?.payload.contract).toEqual(repaired);
  });

  it('keeps all five rejected plans visible in the diagnostic trace', async () => {
    const candidate = { mode: 'read', goal: '统计本周周报', deliverables: ['历史总览'],
      requiredFacts: [{ id: 'reports', description: '周报文档', acceptableSources: ['dingtalk.*'], enumeration: 'all', grain: ['document'] }],
      assumptions: ['本周及历史'], openQuestions: [], completionCriteria: ['给出数量'] };
    const http = vi.fn().mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options.body));
      return response(body.input[0].content.includes('独立的任务语义审查器')
        ? { aligned: false, reason: '历史总览超出请求' } : candidate);
    });
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
    await expect(new TaskContractPlanner(config, http).plan('查我这周写了多少篇周报', '', async (event, payload) => {
      events.push({ event, payload });
    })).rejects.toThrow('TASK_PLANNER_INVALID_RESPONSE: 历史总览超出请求');
    expect(events.filter((item) => item.event === 'draft')).toHaveLength(5);
    expect(events.filter((item) => item.event === 'review')).toHaveLength(5);
    expect(events.filter((item) => item.event === 'attempt').map((item) => item.payload.attempt)).toEqual([1, 2, 3, 4, 5]);
  });

  it('can repair an incomparable-unit assumption into one clarification', async () => {
    const wrong = { mode: 'read', goal: '找金额最高的项目', deliverables: ['最高项目'],
      requiredFacts: [{ id: 'amounts', description: '各项目金额', acceptableSources: ['crossborderops.*'], enumeration: 'bounded', grain: ['project'] }],
      assumptions: ['美元和欧元直接比较或任选汇率折算'], openQuestions: [], completionCriteria: ['给出最高项目'] };
    const correct = { ...wrong, assumptions: [], openQuestions: ['各币种应按哪个日期的汇率折算为哪种统一币种？'] };
    const http = vi.fn().mockResolvedValueOnce(response(wrong))
      .mockResolvedValueOnce(response({ aligned: false, reason: '金额不可直接比较' }))
      .mockResolvedValueOnce(response(wrong))
      .mockResolvedValueOnce(response({ aligned: false, reason: '仍未确定统一币种' }))
      .mockResolvedValueOnce(response(correct))
      .mockResolvedValueOnce(response({ aligned: true, reason: '待澄清统一口径' }));
    const plan = await new TaskContractPlanner(config, http).plan('哪一个项目金额最高？');
    expect(plan.openQuestions).toHaveLength(1);
    expect(http).toHaveBeenCalledTimes(6);
  });

  it('does not accept an answer from evidence alone when it misses the original request', async () => {
    const workflow = new TaskWorkflow();
    const contract = workflow.plan({ mode: 'read', goal: '查询单期工单排名', deliverables: ['最低团队'], requiredFacts: [
      { id: 'counts', description: '工单数量', acceptableSources: ['dingtalk.*'] }
    ], assumptions: [], openQuestions: [], completionCriteria: ['给出排名'] });
    const evidence = workflow.record('dingtalk.contact.me', true);
    const completion = workflow.complete({ status: 'answered', answer: '本周较上周下降 20%。', factEvidence: { counts: [evidence.id] }, missingFacts: [] });
    const http = vi.fn().mockResolvedValueOnce(response({ supported: false, reason: '回答了变化而非指定周排名' }));
    const reviewer = new EvidenceReviewer(config, http);
    expect(await reviewer.review(contract, completion, workflow.state.evidence, { [evidence.id]: '{"data":{}}' }, '上周工单数量最低的团队'))
      .toEqual({ supported: false, reason: '回答了变化而非指定周排名' });
    const body = JSON.parse(String(http.mock.calls[0]?.[1]?.body));
    expect(body.input[1].content).toContain('上周工单数量最低的团队');
  });

  it('reviews unsupported precise claims even when a conversation has no required tool facts', async () => {
    const workflow = new TaskWorkflow();
    const contract = workflow.plan({ mode: 'conversation', goal: '解释一个概念', deliverables: ['定义'],
      requiredFacts: [], assumptions: [], openQuestions: [], completionCriteria: ['解释清楚'] });
    const completion = workflow.complete({ status: 'answered', answer: '定义及未经核验的精确比例。', factEvidence: {}, missingFacts: [] });
    const http = vi.fn().mockResolvedValueOnce(response({ supported: true, reason: '范围匹配' }))
      .mockResolvedValueOnce(response({ supported: false, reason: '精确比例无本任务来源' }));
    const reviewer = new EvidenceReviewer(config, http);
    expect(await reviewer.review(contract, completion, [], {}, '这个概念是什么？'))
      .toEqual({ supported: false, reason: '精确比例无本任务来源' });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('rejects extra personal records outside the requested time window', async () => {
    const workflow = new TaskWorkflow();
    const contract = workflow.plan({ mode: 'read', goal: '查询今天的待办', deliverables: ['今日待办'], requiredFacts: [
      { id: 'today', description: '今天的待办', acceptableSources: ['dingtalk.*'] }
    ], assumptions: [], openQuestions: [], completionCriteria: ['给出今日清单'] });
    const evidence = workflow.record('dingtalk.todo.due-today', true);
    const completion = workflow.complete({ status: 'answered', answer: '今天暂无待办。历史待办还包括去年十项。', factEvidence: { today: [evidence.id] }, missingFacts: [] });
    const http = vi.fn().mockResolvedValueOnce(response({ supported: false, reason: '附带了用户未请求的历史待办' }));
    const reviewer = new EvidenceReviewer(config, http);
    expect(await reviewer.review(contract, completion, workflow.state.evidence, { [evidence.id]: '{"data":{}}' }, '查我今天的待办'))
      .toEqual({ supported: false, reason: '附带了用户未请求的历史待办' });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('does not accept a directory result as internal sales evidence', () => {
    const workflow = new TaskWorkflow();
    workflow.plan({ mode: 'read', goal: '分析销量', deliverables: ['ASIN 清单'], requiredFacts: [
      { id: 'sales', description: '内部销量变化', acceptableSources: ['crossborderops.*'] }
    ], assumptions: [], openQuestions: [], completionCriteria: ['有销量证据'] });
    const directory = workflow.record('lingxing.help', true);
    expect(() => workflow.complete({ status: 'answered', answer: '销量下降', factEvidence: { sales: [directory.id] }, missingFacts: [] })).toThrow('WORKFLOW_FACT_UNSUPPORTED');
  });

  it('rejects final claims when a cited tool excerpt is unavailable', async () => {
    const reviewer = new EvidenceReviewer(config, vi.fn());
    const workflow = new TaskWorkflow();
    const contract = workflow.plan({ mode: 'read', goal: '分析销量', deliverables: ['原因'], requiredFacts: [
      { id: 'sales', description: '销量变化', acceptableSources: ['crossborderops.*'] }
    ], assumptions: [], openQuestions: [], completionCriteria: ['提供证据'] });
    const evidence = workflow.record('crossborderops.daily.performance_changes', true);
    const completion = workflow.complete({ status: 'answered', answer: '销量下降', factEvidence: { sales: [evidence.id] }, missingFacts: [] });
    expect(await reviewer.review(contract, completion, workflow.state.evidence, {})).toEqual({ supported: false, reason: 'evidence_excerpt_unavailable' });
  });

  it('requires separate factual and causal reviews for a sourced answer', async () => {
    const workflow = new TaskWorkflow();
    const contract = workflow.plan({ mode: 'read', goal: '解释业务指标变化', deliverables: ['分析'], requiredFacts: [
      { id: 'metrics', description: '业务指标', acceptableSources: ['crossborderops.*'] }
    ], assumptions: [], openQuestions: [], completionCriteria: ['有证据'] });
    const evidence = workflow.record('crossborderops.daily.trend', true);
    const completion = workflow.complete({ status: 'answered', answer: '指标变化由促销造成。', factEvidence: { metrics: [evidence.id] }, missingFacts: [] });
    const http = vi.fn().mockResolvedValueOnce(response({ supported: true, reason: 'scope_match' }))
      .mockResolvedValueOnce(response({ supported: true, reason: 'numbers_match' }))
      .mockResolvedValueOnce(response({ supported: false, reason: 'cause_not_proven' }));
    const reviewer = new EvidenceReviewer(config, http);
    expect(await reviewer.review(contract, completion, workflow.state.evidence, { [evidence.id]: '{"dataset":"daily.trend","data":{}}' }))
      .toEqual({ supported: false, reason: 'cause_not_proven' });
    expect(http).toHaveBeenCalledTimes(3);
    const thirdBody = JSON.parse(String(http.mock.calls[2]?.[1]?.body));
    expect(thirdBody.input[0].content).toContain('同日变化不能证明因果');
  });

  it('passes incompatible units from evidence to the factual reviewer', async () => {
    const workflow = new TaskWorkflow();
    const contract = workflow.plan({ mode: 'read', goal: '比较金额', deliverables: ['最高对象'], requiredFacts: [
      { id: 'amounts', description: '金额', acceptableSources: ['crossborderops.*'] }
    ], assumptions: [], openQuestions: [], completionCriteria: ['核对可比性'] });
    const evidence = workflow.record('crossborderops.daily.aggregate', true);
    const completion = workflow.complete({ status: 'answered', answer: 'A 的欧元数值和 B 的英镑数值共同领先。', factEvidence: { amounts: [evidence.id] }, missingFacts: [] });
    const http = vi.fn().mockResolvedValueOnce(response({ supported: true, reason: '范围匹配' }))
      .mockResolvedValueOnce(response({ supported: false, reason: 'EUR 与 GBP 不可直接比较' }));
    const reviewer = new EvidenceReviewer(config, http);
    const excerpt = JSON.stringify({ dataset: 'daily.aggregate', data: { coverage: { complete_count: 2 }, currency_note: '不得跨币种混算', rows: [{ currency: 'EUR' }, { currency: 'GBP' }] } });
    expect((await reviewer.review(contract, completion, workflow.state.evidence, { [evidence.id]: excerpt }, '金额最高的是谁？')).supported).toBe(false);
    const factualPayload = JSON.parse(String(http.mock.calls[1]?.[1]?.body));
    expect(factualPayload.input[1].content).toContain('"currencies":["EUR","GBP"]');
  });

  it('passes pagination and query dimensions to the factual reviewer', async () => {
    const workflow = new TaskWorkflow();
    const contract = workflow.plan({ mode: 'read', goal: '列出对象', deliverables: ['完整列表'], requiredFacts: [
      { id: 'rows', description: '对象列表', acceptableSources: ['crossborderops.*'] }
    ], assumptions: [], openQuestions: [], completionCriteria: ['核对分页'] });
    const evidence = workflow.record('crossborderops.daily.aggregate', true);
    const completion = workflow.complete({ status: 'answered', answer: '全部对象只有一个。', factEvidence: { rows: [evidence.id] }, missingFacts: [] });
    const http = vi.fn().mockResolvedValueOnce(response({ supported: true, reason: '范围匹配' }))
      .mockResolvedValueOnce(response({ supported: false, reason: '仅取得第一页，不能声称全部' }));
    const reviewer = new EvidenceReviewer(config, http);
    const excerpt = JSON.stringify({ dataset: 'daily.aggregate', data: {
      coverage: { complete_count: 3 }, total: 3, limit: 1, offset: 0, filters: { site: 'JP' },
      dimensions: ['asin'], rows: [{ asin: 'A' }]
    } });
    expect((await reviewer.review(contract, completion, workflow.state.evidence, { [evidence.id]: excerpt }, '全部有哪些？')).supported).toBe(false);
    const payload = JSON.parse(String(http.mock.calls[1]?.[1]?.body));
    expect(payload.input[1].content).toContain('"returnedRowCount":1');
    expect(payload.input[1].content).toContain('"offset":0');
    expect(payload.input[1].content).toContain('"total":3');
    expect(payload.input[0].content).toContain('连续覆盖全部页');
  });

  it('separately checks the population claimed by an aggregate answer', async () => {
    const workflow = new TaskWorkflow();
    const contract = workflow.plan({ mode: 'read', goal: '统计站点销量', deliverables: ['销量合计'], requiredFacts: [
      { id: 'units', description: '销量件数', acceptableSources: ['crossborderops.daily.aggregate'] }
    ], assumptions: [], openQuestions: [], completionCriteria: ['回答数值'] });
    const evidence = workflow.record('crossborderops.daily.aggregate', true);
    const completion = workflow.complete({ status: 'answered', answer: '所有授权店铺合计100件。',
      factEvidence: { units: [evidence.id] }, missingFacts: [] });
    const http = vi.fn().mockResolvedValueOnce(response({ supported: true, reason: 'scope' }))
      .mockResolvedValueOnce(response({ supported: true, reason: 'number' }))
      .mockResolvedValueOnce(response({ supported: false, reason: '缺少授权总体覆盖证据' }));
    const reviewer = new EvidenceReviewer(config, http);
    const excerpt = JSON.stringify({ dataset: 'daily.aggregate', data: { total: 1, rows: [{ units: 100 }],
      coverage_rule: 'only observed business entities are aggregated' } });
    expect(await reviewer.review(contract, completion, workflow.state.evidence, { [evidence.id]: excerpt }, '站点销量合计多少？'))
      .toEqual({ supported: false, reason: '缺少授权总体覆盖证据' });
    expect(JSON.parse(String(http.mock.calls[2]?.[1]?.body)).input[0].content).toContain('统计总体');
  });
});
