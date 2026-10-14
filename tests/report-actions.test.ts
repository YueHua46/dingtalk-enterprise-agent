import { describe, expect, it } from 'vitest';
import { materializeReportActions, reportActionSchema } from '../src/report-actions.js';
import { reportRenderSchema, reportRenderTool } from '../src/report-render.js';

const action = {
  id: 'placement_test', priority: 'P1', object: '店铺 {{fact:store}} / 活动 {{fact:campaign}}',
  problem: '当前窗口归因效率需要复核', evidence: 'ACoS {{fact:acos}}',
  proposal: '建议搜索首页加价增加10%，不执行修改', conditions: '实施前确认预算受限和当前配置',
  observation: '每日观察，7天复查，14天结束', acceptance: '增量订单与花费满足建议目标',
  stop_loss: '建议增量花费超过80美元且无新增订单时立即触发',
  rollback: '恢复测试前广告位加价', confirmation: '实际修改须发起人确认'
};
const makeReport = () => reportRenderSchema.parse({ template: 'amazon-advertising', report: {
  report_title: '广告报告', marketplace: 'US', analysis_period: '2026-09-14..2026-10-13',
  store_name: '授权店铺', executive_summary: '仅分析建议', data_quality: { cost: '未提供' },
  action_plan: [action], sections: [{ title: '数据范围', paragraphs: ['仅已入库结果'] }]
} }).report;

describe('canonical report actions', () => {
  it('requires strict action fields, ASCII ids and bound object/evidence', () => {
    expect(reportActionSchema.parse(action)).toEqual(action);
    for (const invalid of [
      { ...action, id: '测试' }, { ...action, id: 'bad id' },
      { ...action, object: '手写活动123' }, { ...action, evidence: '手写ACoS 20%' },
      { ...action, proposal: '' }, { ...action, extra: 'unknown' }
    ]) expect(reportActionSchema.safeParse(invalid).success).toBe(false);
    const { rollback: _rollback, ...missing } = action;
    expect(reportActionSchema.safeParse(missing).success).toBe(false);
  });

  it('produces all four tables from one resolved record without changing the original', () => {
    const report = makeReport();
    // Host interpolates bound facts before materializing the action tables.
    report.action_plan![0]!.object = '店铺 6958 / 活动 Brand - Broad';
    report.action_plan![0]!.evidence = 'ACoS 3.38%';
    const original = structuredClone(report);
    const next = materializeReportActions(report);
    expect(report).toEqual(original);
    expect(next.action_plan).toBeUndefined();
    const rules = `止损条件：${action.stop_loss}\n回退动作：${action.rollback}`;
    expect(next.budget_bid?.[0]).toMatchObject({ object: report.action_plan![0]!.object,
      current: action.conditions, recommendation: action.proposal, observation: action.observation, rollback: rules });
    expect(next.execution_plan?.[0]).toMatchObject({ object: report.action_plan![0]!.object,
      priority: action.priority, acceptance: action.acceptance, confirmation: action.confirmation });
    expect(next.execution_plan?.[0]?.action).toContain(action.conditions);
    expect(next.execution_plan?.[0]?.action).toContain(action.observation);
    expect(next.execution_plan?.[0]?.action).toContain(rules);
    expect(next.review_plan?.[0]).toMatchObject({ when: action.observation, acceptance: action.acceptance, rollback: rules });
    expect(next.review_plan?.[0]?.check).toContain(report.action_plan![0]!.object);
    expect(next.risks?.[0]).toMatchObject({ impact: report.action_plan![0]!.evidence, rollback: rules });
    expect(next.risks?.[0]?.risk).toContain(report.action_plan![0]!.object);
    expect(next.risks?.[0]?.mitigation).toContain(action.observation);
    expect(next.risks?.[0]?.risk).not.toContain('80');
    expect(next.risks?.[0]?.impact).not.toContain('80');
    expect(next.sections).toEqual(report.sections);
    expect(() => reportRenderSchema.parse({ template: 'amazon-advertising', report: next })).not.toThrow();
  });

  it.each(['budget_bid', 'execution_plan', 'review_plan', 'risks'] as const)('rejects duplicated caller table %s', table => {
    const report = { ...makeReport(), [table]: [{}] };
    expect(() => materializeReportActions(report)).toThrow('REPORT_ACTIONS_DUPLICATED');
    expect(report.action_plan).toHaveLength(1);
  });

  it('accepts empty legacy tables and rejects duplicate canonical ids', () => {
    const report = { ...makeReport(), budget_bid: [], execution_plan: [], review_plan: [], risks: [] };
    expect(materializeReportActions(report).budget_bid).toHaveLength(1);
    expect(() => materializeReportActions({ ...report, action_plan: [action, { ...action, proposal: '不同建议' }] })).toThrow('REPORT_ACTION_ID_DUPLICATE');
  });

  it('preserves distinct rules and object order across multiple actions', () => {
    const second = { ...action, id: 'budget_test', object: '活动 {{fact:other_campaign}}',
      stop_loss: '建议增量花费超过150美元且新增订单不足2笔时立即触发', rollback: '恢复测试前预算' };
    const next = materializeReportActions({ ...makeReport(), action_plan: [action, second] });
    expect(next.budget_bid?.[0]?.rollback).toContain('80');
    expect(next.budget_bid?.[1]?.rollback).toContain('150');
    for (let index = 0; index < 2; index++) {
      expect(next.budget_bid?.[index]?.rollback).toBe(next.review_plan?.[index]?.rollback);
      expect(next.budget_bid?.[index]?.rollback).toBe(next.risks?.[index]?.rollback);
      expect(next.execution_plan?.[index]?.action).toContain(String(next.budget_bid?.[index]?.rollback));
    }
  });

  it('leaves legacy reports available when no canonical action is supplied', () => {
    const report = makeReport(); delete report.action_plan;
    report.review_plan = [{ when: '原周期', check: '原检查', acceptance: '原条件', rollback: '原回退' }];
    expect(materializeReportActions(report)).toEqual(report);
    expect(materializeReportActions({ ...report, action_plan: [] })).toEqual(report);
  });

  it('exposes the action schema and limits a report to twenty actions', () => {
    expect(reportRenderTool.inputSchema).toHaveProperty('properties.report.properties.action_plan');
    expect(reportRenderSchema.safeParse({ template: 'amazon-advertising', report: {
      ...makeReport(), action_plan: Array.from({ length: 21 }, (_, index) => ({ ...action, id: `action${index}` }))
    } }).success).toBe(false);
  });
});
