import { describe, expect, it } from 'vitest';
import { applyReportRevision, reportRevisionSchema, reportRevisionTool } from '../src/report-revision.js';
import { reportRenderSchema } from '../src/report-render.js';
import { enterpriseTools } from '../src/codex-client.js';

const makeDraft = () => reportRenderSchema.parse({
  template: 'amazon-advertising',
  report: {
    report_title: '广告分析', marketplace: 'US', analysis_period: '2026-09-14..2026-10-13',
    store_name: '授权店铺', executive_summary: '原摘要',
    data_quality: { cost: '未提供', 'a/b~c': '原值' },
    sections: [{ title: '行动', paragraphs: ['原建议'], columns: ['对象', '花费'], rows: [['group-1', 10]] }]
  },
  fact_bindings: [{ id: 'spend', evidenceId: 'e1', where: { campaign_id: 'c1' }, field: 'spend' }],
  evidence_tables: [{ title: '明细', evidenceId: 'e1', columns: [{ field: 'spend', label: '花费' }] }]
});
const revision = (path: string, value: unknown) => ({ draft_id: 'draft-1', changes: [{ path, value }] });

describe('report local revisions', () => {
  it('updates existing nested fields without mutating the draft or its evidence sources', () => {
    const draft = makeDraft();
    const next = applyReportRevision(draft, { draft_id: 'draft-1', changes: [
      { path: '/report/executive_summary', value: '修正摘要' },
      { path: '/report/sections/0/rows/0/0', value: '{{fact:group}}' }
    ] });
    expect(next.report.executive_summary).toBe('修正摘要');
    expect(next.report.sections?.[0]?.rows?.[0]?.[0]).toBe('{{fact:group}}');
    expect(draft.report.executive_summary).toBe('原摘要');
    expect(draft.report.sections?.[0]?.rows?.[0]?.[0]).toBe('group-1');
    expect(next.template).toBe(draft.template);
    expect(next.evidence_tables).toEqual(draft.evidence_tables);
  });

  it('decodes escaped JSON pointer tokens once', () => {
    expect(applyReportRevision(makeDraft(), revision('/report/data_quality/a~1b~0c', '修正')).report.data_quality['a/b~c']).toBe('修正');
  });

  it.each([
    '/template', '/fact_bindings/0/evidenceId', '/evidence_tables/0/evidenceId', '/report',
    '/report/unknown', '/report/sections/1/title', '/report/sections/-/title',
    '/report/sections/00/title', '/report/sections/0/paragraphs/2', '/report/executive_summary/text',
    '/report/data_quality/__proto__/polluted', '/report/data_quality/constructor', '/report/data_quality/prototype',
    '/report/data_quality/a~2b', '/report/data_quality/a~'
  ])('rejects out-of-scope, missing or unsafe path %s', path => {
    expect(() => applyReportRevision(makeDraft(), revision(path, 'x'))).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('allows schema-valid container additions and removals', () => {
    const next = applyReportRevision(makeDraft(), revision('/report/sections/0/paragraphs', ['修正建议']));
    expect(next.report.sections?.[0]?.paragraphs).toEqual(['修正建议']);
    for (const value of [[], ['a', 'b']]) expect(applyReportRevision(makeDraft(), revision('/report/sections/0/paragraphs', value)).report.sections?.[0]?.paragraphs).toEqual(value);
    expect(() => applyReportRevision(makeDraft(), revision('/report/sections/0/paragraphs', 'replacement'))).toThrow();
    expect(applyReportRevision(makeDraft(), revision('/report/data_quality', {})).report.data_quality).toEqual({});
    expect(applyReportRevision(makeDraft(), revision('/report/data_quality', {extra: 'z'})).report.data_quality).toEqual({extra: 'z'});
    expect(applyReportRevision(makeDraft(), revision('/report/asins', 'ASIN')).report.asins).toBe('ASIN');
    const changed = applyReportRevision(makeDraft(), {draft_id: 'draft-1', changes: [
      {path: '/report/sections/0/paragraphs/-', value: '补充'},
      {path: '/report/sections/0/paragraphs/0', op: 'remove'},
      {path: '/report/sections/0/columns', op: 'remove'},
      {path: '/report/sections/0/rows', op: 'remove'}]});
    expect(changed.report.sections?.[0]?.paragraphs).toEqual(['补充']);
    expect(changed.report.sections?.[0]?.rows).toBeUndefined();
    expect(() => applyReportRevision(makeDraft(), {draft_id: 'draft-1', changes: [{path: '/report/report_title', op: 'remove'}]})).toThrow();
  });

  it('prunes stale historical and newly submitted unused bindings', () => {
    const draft = makeDraft(); draft.report.executive_summary = '{{fact:spend}}';
    expect(applyReportRevision(draft, revision('/report/executive_summary', '改为无此观测的描述')).fact_bindings).toEqual([]);
    expect(applyReportRevision(draft, {...revision('/report/executive_summary', '修改'),
      fact_bindings: [{id: 'new_fact', evidenceId: 'e2', field: 'spend'}]}).fact_bindings).toEqual([]);
  });

  it('merges bindings by id, preserving other bindings and rejecting duplicate updates', () => {
    const args = { ...revision('/report/executive_summary', '{{fact:spend}} {{fact:group}}'), fact_bindings: [
      { id: 'spend', evidenceId: 'e2', field: 'spend' },
      { id: 'group', evidenceId: 'e2', field: 'ad_group_id' }
    ] };
    const draft = makeDraft();
    expect(applyReportRevision(draft, args).fact_bindings).toMatchObject([
      { id: 'spend', evidenceId: 'e2' }, { id: 'group', evidenceId: 'e2' }
    ]);
    expect(draft.fact_bindings?.[0]?.evidenceId).toBe('e1');
    expect(() => applyReportRevision(draft, { ...args, fact_bindings: [args.fact_bindings[0], args.fact_bindings[0]] })).toThrow('FACT_ID_DUPLICATE');
  });

  it('revalidates the final report and applies changes atomically', () => {
    const draft = makeDraft();
    expect(() => applyReportRevision(draft, revision('/report/report_title', ''))).toThrow();
    expect(() => applyReportRevision(draft, revision('/report/sections/0/rows/0/1', {}))).toThrow();
    expect(() => applyReportRevision(draft, { draft_id: 'draft-1', changes: [
      { path: '/report/executive_summary', value: '暂时修改' }, { path: '/report/missing', value: '错误' }
    ] })).toThrow();
    expect(draft.report.executive_summary).toBe('原摘要');
  });

  it('rejects non-JSON values, meta fields, empty and oversized change sets', () => {
    const circular: Record<string, unknown> = {}; circular.self = circular;
    for (const value of [undefined, NaN, Infinity, BigInt(1), () => 'x', new Date(), circular, JSON.parse('{"__proto__":{"polluted":true}}')]) {
      expect(reportRevisionSchema.safeParse(revision('/report/executive_summary', value)).success).toBe(false);
    }
    expect(reportRevisionSchema.safeParse({ ...revision('/report/executive_summary', 'x'), template: 'other' }).success).toBe(false);
    expect(reportRevisionSchema.safeParse({ draft_id: 'draft-1', changes: [] }).success).toBe(false);
    expect(reportRevisionSchema.safeParse({ draft_id: 'draft-1', changes: Array.from({ length: 41 }, () => ({ path: '/report/executive_summary', value: 'x' })) }).success).toBe(false);
  });

  it('registers a JSON-schema tool without empty enum members', () => {
    const artifact = enterpriseTools.find(namespace => namespace.name === 'artifact');
    expect(artifact?.tools.some(tool => tool.name === 'revise_report')).toBe(false);
    expect(reportRevisionTool.inputSchema).toHaveProperty('properties.changes');
    expect(JSON.stringify(reportRevisionTool.inputSchema)).not.toContain('"enum":[""]');
  });
});
