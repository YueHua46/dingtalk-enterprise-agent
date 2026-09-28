import { describe, expect, it } from 'vitest';
import { TaskWorkflow } from '../src/task-workflow.js';

const contract = {
  goal: '分析授权店铺销量变化', deliverables: ['店铺与 ASIN 清单'],
  requiredFacts: [{ id: 'sales_change', description: '最近两期的内部销量变化', acceptableSources: ['crossborderops.*'] }],
  assumptions: ['最近完整 7 日对比前 7 日'], openQuestions: [], completionCriteria: ['给出数值和来源']
};

describe('TaskWorkflow evidence contract', () => {
  it('requires real evidence from an acceptable capability', () => {
    const workflow = new TaskWorkflow();
    workflow.plan(contract);
    const publicSignal = workflow.record('sif.ops_get_asin_sales_trend', true);
    expect(() => workflow.complete({ status: 'answered', answer: '内部销量下降', factEvidence: { sales_change: [publicSignal.id] }, missingFacts: [] })).toThrow('WORKFLOW_FACT_UNSUPPORTED');
    const internal = workflow.record('crossborderops.daily.performance_changes', true, { period: '2026-09-15..2026-09-21' });
    expect(workflow.complete({ status: 'answered', answer: '内部销量下降', factEvidence: { sales_change: [internal.id] }, missingFacts: [] }).status).toBe('answered');
  });

  it('binds successful eligible evidence when the model omits citation bookkeeping', () => {
    const workflow = new TaskWorkflow();
    workflow.plan(contract);
    const unrelated = workflow.record('sif.ops_get_asin_sales_trend', true);
    const internal = workflow.record('crossborderops.daily.performance_changes', true);
    const result = workflow.complete({ status: 'answered', answer: '已取得内部销量变化', factEvidence: {}, missingFacts: [] });
    expect(result.factEvidence.sales_change).toEqual([internal.id]);
    expect(result.factEvidence.sales_change).not.toContain(unrelated.id);
  });

  it('does not let a revised plan silently drop required facts', () => {
    const workflow = new TaskWorkflow();
    workflow.plan(contract);
    expect(() => workflow.plan({ ...contract, requiredFacts: [] })).toThrow('WORKFLOW_REQUIRED_FACT_REMOVAL_FORBIDDEN');
  });

  it('will not declare a whole task blocked after exploring only another source', () => {
    const workflow = new TaskWorkflow();
    workflow.plan(contract);
    workflow.record('lingxing.help', true);
    expect(() => workflow.complete({ status: 'blocked', answer: '领星受限，无法分析内部销量', factEvidence: {}, missingFacts: ['sales_change'] })).toThrow('WORKFLOW_SOURCE_NOT_ATTEMPTED:sales_change:crossborderops.*');
    workflow.record('crossborderops.daily.performance_changes', false, { errorCode: 'ACCESS_DENIED' });
    expect(workflow.complete({ status: 'blocked', answer: '当前用户没有自有店铺授权', factEvidence: {}, missingFacts: ['sales_change'] }).status).toBe('blocked');
  });

  it('allows an explicit partial result when the host exploration budget is exhausted', () => {
    const workflow = new TaskWorkflow();
    workflow.plan(contract);
    workflow.state.budgetExhausted = true;
    const result = workflow.complete({ status: 'partial', answer: '已达到工具探索上限；缺少授权店铺的销量比较，尚不能列出下滑 ASIN。', factEvidence: {}, missingFacts: ['sales_change'] });
    expect(result.status).toBe('partial');
  });

  it('keeps clarification separate from completion and approval', () => {
    const workflow = new TaskWorkflow();
    workflow.plan({ ...contract, openQuestions: ['需要修改的文档是哪一篇？'] });
    const question = workflow.clarify('请指定需要修改的文档', '写入目标不明确');
    expect(Date.parse(question.expiresAt) - Date.parse(question.createdAt)).toBe(24 * 60 * 60 * 1000);
    expect(() => workflow.complete({ status: 'blocked', answer: '等待回复', factEvidence: {}, missingFacts: ['sales_change'] })).toThrow('WORKFLOW_CLARIFICATION_PENDING');
  });

  it('does not ask the user to resolve an internal execution or formatting problem', () => {
    const workflow = new TaskWorkflow();
    workflow.plan(contract);
    expect(() => workflow.clarify('请确认提交格式', '我还在组织输出')).toThrow('WORKFLOW_CLARIFICATION_NOT_PLANNED');
  });

  it('requires contiguous pages of one query for a complete collection', () => {
    const workflow = new TaskWorkflow();
    workflow.plan({ ...contract, requiredFacts: [{ ...contract.requiredFacts[0]!, enumeration: 'all' }] });
    const page0 = workflow.record('crossborderops.daily.aggregate', true, { pagination: { groupKey: 'same-query', total: 5, offset: 0, returned: 2 } });
    const page4 = workflow.record('crossborderops.daily.aggregate', true, { pagination: { groupKey: 'same-query', total: 5, offset: 4, returned: 1 } });
    const completion = { status: 'answered' as const, answer: '全部对象已列出。', factEvidence: { sales_change: [page0.id, page4.id] }, missingFacts: [] };
    expect(() => workflow.complete(completion)).toThrow('WORKFLOW_PAGINATION_INCOMPLETE');
    workflow.record('crossborderops.daily.aggregate', true, { pagination: { groupKey: 'different-query', total: 5, offset: 2, returned: 2 } });
    expect(() => workflow.complete(completion)).toThrow('WORKFLOW_PAGINATION_INCOMPLETE');
    workflow.record('crossborderops.daily.aggregate', true, { pagination: { groupKey: 'same-query', total: 5, offset: 2, returned: 2 } });
    expect(workflow.complete(completion).status).toBe('answered');
  });

  it('does not demand every page for a bounded ranking', () => {
    const workflow = new TaskWorkflow();
    workflow.plan({ ...contract, requiredFacts: [{ ...contract.requiredFacts[0]!, enumeration: 'bounded' }] });
    const page = workflow.record('crossborderops.daily.aggregate', true, { pagination: { groupKey: 'ranked-query', total: 100, offset: 0, returned: 5 },
      members: [{ key: 'shop-1' }] });
    workflow.record('crossborderops.scope', true, { pagination: { groupKey: 'scope', total: 1, offset: 0, returned: 1 },
      members: [{ key: 'shop-1' }] });
    expect(workflow.complete({ status: 'answered', answer: '前五名。', factEvidence: { sales_change: [page.id] }, missingFacts: [] }).status).toBe('answered');
  });

  it('does not confuse one entity with records split by extra dimensions', () => {
    const workflow = new TaskWorkflow();
    workflow.plan({ ...contract, requiredFacts: [{ ...contract.requiredFacts[0]!, enumeration: 'all', grain: ['asin'] }] });
    const detailed = workflow.record('crossborderops.daily.aggregate', true, { pagination: {
      groupKey: 'store-site-asin', total: 2, offset: 0, returned: 2, dimensions: ['store', 'site', 'asin']
    } });
    const completion = { status: 'answered' as const, answer: '全部 ASIN。', factEvidence: { sales_change: [detailed.id] }, missingFacts: [] };
    expect(() => workflow.complete(completion)).toThrow('WORKFLOW_GRAIN_MISMATCH');
    const asin = workflow.record('crossborderops.daily.aggregate', true, { pagination: {
      groupKey: 'asin', total: 1, offset: 0, returned: 1, dimensions: ['asin']
    } });
    expect(() => workflow.complete(completion)).toThrow('WORKFLOW_GRAIN_MISMATCH');
    expect(workflow.complete({ ...completion, factEvidence: { sales_change: [asin.id] } }).status).toBe('answered');
  });

  it('accepts an extra dimension when it is fixed by the query filter', () => {
    const workflow = new TaskWorkflow();
    workflow.plan({ ...contract, requiredFacts: [{ ...contract.requiredFacts[0]!, enumeration: 'all', grain: ['store'] }] });
    const page = workflow.record('crossborderops.daily.aggregate', true, { pagination: {
      groupKey: 'stores-in-one-site', total: 2, offset: 0, returned: 2, dimensions: ['store', 'site'], fixedDimensions: ['site']
    } });
    expect(() => workflow.complete({ status: 'answered', answer: '该站点的两个店铺。', factEvidence: { sales_change: [page.id] }, missingFacts: [] })).toThrow('WORKFLOW_POPULATION_SOURCE_REQUIRED');
    workflow.record('crossborderops.scope', true, { pagination: { groupKey: 'scope', total: 2, offset: 0, returned: 2, dimensions: ['store'] } });
    expect(workflow.complete({ status: 'answered', answer: '该站点的两个店铺。', factEvidence: { sales_change: [page.id] }, missingFacts: [] }).status).toBe('answered');
  });

  it('uses the documented aggregate row-field alias for store grouping', () => {
    const workflow = new TaskWorkflow();
    workflow.plan({ ...contract, requiredFacts: [{ ...contract.requiredFacts[0]!, enumeration: 'all', grain: ['store_name'] }] });
    const page = workflow.record('crossborderops.daily.aggregate', true, { pagination: {
      groupKey: 'stores', total: 1, offset: 0, returned: 1, dimensions: ['store', 'site'], fixedDimensions: ['site']
    } });
    workflow.record('crossborderops.scope', true, { pagination: { groupKey: 'scope', total: 1, offset: 0, returned: 1, dimensions: ['store'] } });
    expect(workflow.complete({ status: 'answered', answer: '该站点有一家店铺。', factEvidence: { sales_change: [page.id] }, missingFacts: [] }).status).toBe('answered');
    const byId = new TaskWorkflow();
    byId.plan({ ...contract, requiredFacts: [{ ...contract.requiredFacts[0]!, enumeration: 'all', grain: ['store_id'] }] });
    byId.record('crossborderops.daily.aggregate', true, { pagination: page.pagination });
    byId.record('crossborderops.scope', true, { pagination: { groupKey: 'scope', total: 1, offset: 0, returned: 1, dimensions: ['store'] } });
    expect(byId.complete({ status: 'answered', answer: '该站点有一家店铺。', factEvidence: {}, missingFacts: [] }).status).toBe('answered');
  });

  it('requires all authorization-scope pages before claiming every store', () => {
    const workflow = new TaskWorkflow();
    workflow.plan({ ...contract, requiredFacts: [{ ...contract.requiredFacts[0]!, enumeration: 'all', grain: ['store'] }] });
    const sales = workflow.record('crossborderops.daily.aggregate', true, { pagination: {
      groupKey: 'sales', total: 2, offset: 0, returned: 2, dimensions: ['store']
    } });
    workflow.record('crossborderops.scope', true, { pagination: { groupKey: 'scope', total: 92, offset: 0, returned: 30, dimensions: ['store'] } });
    const completion = { status: 'answered' as const, answer: '所有店铺的销售结果。', factEvidence: { sales_change: [sales.id] }, missingFacts: [] };
    expect(() => workflow.complete(completion)).toThrow('WORKFLOW_POPULATION_INCOMPLETE');
    workflow.record('crossborderops.scope', true, { pagination: { groupKey: 'scope', total: 92, offset: 30, returned: 62, dimensions: ['store'] } });
    expect(workflow.complete(completion).status).toBe('answered');
  });

  it('records a coverage observation without rewriting the agent completion status', () => {
    const workflow = new TaskWorkflow();
    workflow.plan({ ...contract, requiredFacts: [{ ...contract.requiredFacts[0]!, enumeration: 'all', grain: ['store'] }] });
    const sales = workflow.record('crossborderops.daily.aggregate', true, {
      pagination: { groupKey: 'uk-sales', total: 2, offset: 0, returned: 2, dimensions: ['store'], fixedDimensions: ['site'] },
      members: [{ key: 'shop-1', country: '英国' }, { key: 'shop-2', country: '英国' }], filterSite: 'UK'
    });
    workflow.record('crossborderops.scope', true, {
      pagination: { groupKey: 'scope', total: 4, offset: 0, returned: 4, dimensions: ['store'] },
      members: [{ key: 'shop-1', country: '英国' }, { key: 'shop-2', country: '英国' },
        { key: 'shop-3', country: '英国' }, { key: 'shop-4', country: '英国' }]
    });
    const completion = { status: 'answered' as const, answer: '英国站全部店铺均已取得销量。', factEvidence: { sales_change: [sales.id] }, missingFacts: [] };
    expect(workflow.complete(completion)).toMatchObject({ status: 'answered', coverageGaps: ['sales_change'] });
    expect(workflow.complete({ ...completion, status: 'partial', answer: '两家店铺有数据，另外两家该时段尚无可核实业务行。' }).status).toBe('partial');
  });

  it('reconciles each query population separately from unrelated exploratory results', () => {
    const workflow = new TaskWorkflow();
    workflow.plan({ ...contract, requiredFacts: [{ ...contract.requiredFacts[0]!, enumeration: 'all', grain: ['store'] }] });
    const uk = workflow.record('crossborderops.daily.aggregate', true, {
      pagination: { groupKey: 'uk-sales', total: 2, offset: 0, returned: 2, dimensions: ['store', 'site'], fixedDimensions: ['site'] },
      members: [{ key: 'uk-1', country: '英国' }, { key: 'uk-2', country: '英国' }], filterSite: 'UK'
    });
    workflow.record('crossborderops.daily.aggregate', true, {
      pagination: { groupKey: 'us-exploration', total: 1, offset: 0, returned: 1, dimensions: ['store', 'site'], fixedDimensions: ['site'] },
      members: [{ key: 'us-1', country: '美国' }], filterSite: 'US'
    });
    workflow.record('crossborderops.scope', true, {
      pagination: { groupKey: 'scope', total: 4, offset: 0, returned: 4, dimensions: ['store'] },
      members: [{ key: 'uk-1', country: '英国' }, { key: 'uk-2', country: '英国' },
        { key: 'us-1', country: '美国' }, { key: 'us-2', country: '美国' }]
    });
    expect(workflow.complete({ status: 'answered', answer: '英国两家店铺均有销量。',
      factEvidence: { sales_change: [uk.id] }, missingFacts: [] }).status).toBe('answered');
  });

  it('keeps an unrelated site from erasing the cited site coverage observation', () => {
    const workflow = new TaskWorkflow();
    workflow.plan({ ...contract, requiredFacts: [{ ...contract.requiredFacts[0]!, enumeration: 'all', grain: ['store'] }] });
    const uk = workflow.record('crossborderops.daily.aggregate', true, {
      pagination: { groupKey: 'uk-sales', total: 1, offset: 0, returned: 1, dimensions: ['store', 'site'], fixedDimensions: ['site'] },
      members: [{ key: 'uk-1', country: '英国' }], filterSite: 'UK'
    });
    workflow.record('crossborderops.daily.aggregate', true, {
      pagination: { groupKey: 'us-sales', total: 2, offset: 0, returned: 2, dimensions: ['store', 'site'], fixedDimensions: ['site'] },
      members: [{ key: 'us-1', country: '美国' }, { key: 'us-2', country: '美国' }], filterSite: 'US'
    });
    workflow.record('crossborderops.scope', true, {
      pagination: { groupKey: 'scope', total: 4, offset: 0, returned: 4, dimensions: ['store'] },
      members: [{ key: 'uk-1', country: '英国' }, { key: 'uk-2', country: '英国' },
        { key: 'us-1', country: '美国' }, { key: 'us-2', country: '美国' }]
    });
    expect(workflow.complete({ status: 'answered', answer: '英国店铺全部有数据。',
      factEvidence: { sales_change: [uk.id] }, missingFacts: [] })).toMatchObject({ status: 'answered', coverageGaps: ['sales_change'] });
  });

  it('checks authorized-store coverage for a single site total too', () => {
    const workflow = new TaskWorkflow();
    workflow.plan({ ...contract, requiredFacts: [{ ...contract.requiredFacts[0]!, enumeration: 'point', grain: [] }] });
    const sales = workflow.record('crossborderops.daily.aggregate', true, {
      pagination: { groupKey: 'uk-total', total: 2, offset: 0, returned: 2,
        dimensions: ['store', 'site', 'asin'], fixedDimensions: ['site'] },
      members: [{ key: 'uk-1', country: '英国' }, { key: 'uk-2', country: '英国' }], filterSite: 'UK'
    });
    const completion = { status: 'answered' as const, answer: '英国站共 100 件。',
      factEvidence: { sales_change: [sales.id] }, missingFacts: [] };
    expect(workflow.complete(completion)).toMatchObject({ status: 'answered' });
    workflow.record('crossborderops.scope', true, {
      pagination: { groupKey: 'scope', total: 3, offset: 0, returned: 3, dimensions: ['store'] },
      members: [{ key: 'uk-1', country: '英国' }, { key: 'uk-2', country: '英国' }, { key: 'uk-3', country: '英国' }]
    });
    expect(workflow.complete(completion)).toMatchObject({ status: 'answered', coverageGaps: ['sales_change'] });
    expect(workflow.complete({ ...completion, status: 'partial', answer: '已观测英国店铺共 100 件，另有一家未核实。' }).status).toBe('partial');
  });
});
