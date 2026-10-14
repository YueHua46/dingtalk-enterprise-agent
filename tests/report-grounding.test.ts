import {describe, expect, it} from 'vitest';
import {assertReportGrounding} from '../src/report-grounding.js';
import type {ReportRender} from '../src/report-render.js';
import type {EvidenceFileEntry} from '../src/evidence-manifest.js';

const source: EvidenceFileEntry = {file: 'source.json', evidenceId: 'source', capabilityId: 'analysis.table', arguments: '{}',
  kind: 'calculation', tables: [{path: 'data.rows', rows: 1, fields: {spend: ['number']}}]};
const payload = (): ReportRender => ({template: 'amazon-advertising', fact_bindings: [{id: 'spend', evidenceId: 'source', rows_path: 'data.rows', where: {}, field: 'spend', suffix: ''}],
  report: {report_title: '报告2026', marketplace: 'US', analysis_period: '2026-10-14', store_name: '店铺1',
    executive_summary: '花费 {{fact:spend}}', data_quality: {}}});

describe('report grounding compilation', () => {
  const feedback = (input: ReportRender): {errors: {code: string; path: string; snippet: string}[]; total: number; next: string} => {
    try { assertReportGrounding(input, [source]); } catch (error) {
      return JSON.parse((error as Error).message.split('\n').slice(1).join('\n'));
    }
    throw new Error('Expected grounding failure');
  };
  it('collects numeric facts and reference failures in one pass with revision pointers', () => {
    const input = payload();
    input.report.executive_summary = '花费100，{{fact:missing}}，{{fact:bad!}}';
    Object.assign(input.report, {sections: [{paragraphs: ['订单20', '销售30']}], 'a/b~c': 42});
    const result = feedback(input);
    expect(result.errors.map(error => [error.code, error.path])).toEqual([
      ['FACT_REFERENCE_UNKNOWN', '/report/executive_summary'],
      ['FACT_REFERENCE_INVALID', '/report/executive_summary'],
      ['REPORT_LITERAL_FACT_REQUIRES_BINDING', '/report/executive_summary'],
      ['REPORT_LITERAL_FACT_REQUIRES_BINDING', '/report/sections/0/paragraphs/0'],
      ['REPORT_LITERAL_FACT_REQUIRES_BINDING', '/report/sections/0/paragraphs/1'],
      ['REPORT_LITERAL_FACT_REQUIRES_BINDING', '/report/a~1b~0c'],
      ['REPORT_FACT_REFERENCE_REQUIRED', '/report'],
    ]);
    expect(result.total).toBe(7);
    expect(result.errors[0]!.snippet).toBe('{{fact:missing}}');
    expect(result.next).toContain('artifact.revise_report');
    expect(result.next).toContain('changes=[{path,value}]');
  });
  it('caps diagnostics at forty while counting all errors and retaining the original first message', () => {
    const input = payload(); input.report.executive_summary = '{{fact:spend}}';
    input.report.sections = [{paragraphs: Array.from({length: 55}, (_, index) => `金额${index}`)}];
    expect(() => assertReportGrounding(input, [source])).toThrow('REPORT_LITERAL_FACT_REQUIRES_BINDING:report.sections.0.paragraphs.0');
    const result = feedback(input);
    expect(result.errors).toHaveLength(40);
    expect(result.total).toBe(55);
    expect(result.errors[39]!.path).toBe('/report/sections/0/paragraphs/39');
  });
  it('keeps snippets short and shows offending numbers at the end of long paragraphs', () => {
    const input = payload(); input.report.executive_summary = '文字'.repeat(500) + '金额123' + '文字'.repeat(500);
    const result = feedback(input);
    expect(Array.from(result.errors[0]!.snippet).length).toBeLessThanOrEqual(160);
    expect(result.errors[0]!.snippet).toContain('金额123');
    expect(input.report.executive_summary).toHaveLength(2005);
  });
  it('collects multiple unknown and malformed references without accepting them as evidence', () => {
    const input = payload(); input.report.executive_summary = '{{fact:missing}} {{fact:other}} {{fact:!}} {{fact:unfinished';
    const result = feedback(input);
    expect(result.errors.map(error => error.code)).toEqual(['FACT_REFERENCE_UNKNOWN', 'FACT_REFERENCE_UNKNOWN',
      'FACT_REFERENCE_INVALID', 'FACT_REFERENCE_INVALID', 'REPORT_FACT_REFERENCE_REQUIRED']);
  });
  it.each(['花费 12.50 USD', 'ID 9223372036854775807', '金额１２.５', '金额١٢', '指标Ⅻ', '比例²', '值𝟡', '产品B0ABC123'])('rejects literal numeric facts: %s', text => {
    const input = payload(); input.report.executive_summary = text;
    expect(() => assertReportGrounding(input, [source])).toThrow('REPORT_LITERAL_FACT_REQUIRES_BINDING:report.executive_summary');
  });
  it('requires bindings when numeric evidence exists', () => {
    const input = payload(); delete input.fact_bindings;
    expect(() => assertReportGrounding(input, [source])).toThrow('REPORT_FACT_BINDINGS_REQUIRED');
  });
  it('does not let a dummy reference authorize other literal facts', () => {
    const input = payload(); input.report.executive_summary += '，销售额 100';
    expect(() => assertReportGrounding(input, [source])).toThrow('REPORT_LITERAL_FACT_REQUIRES_BINDING');
  });
  it('allows metadata and explicitly structured proposal numbers', () => {
    const input = payload();
    Object.assign(input.report, {action_plan: [{object: '{{fact:spend}}', proposal: '建议20%', conditions: '试验7天', stop_loss: '停止线10%'}]});
    expect(() => assertReportGrounding(input, [source])).not.toThrow();
  });
  it('requires a single action plan instead of independently written repeated rules', () => {
    const input = payload(); input.report.budget_bid = [{recommendation:'建议20%'}];
    expect(() => assertReportGrounding(input,[source])).toThrow('REPORT_ACTION_PLAN_REQUIRED');
  });
  it('still checks observed facts inside action plans', () => {
    const input = payload(); Object.assign(input.report, {action_plan: [{evidence: '花费100', proposal: '建议20%'}]});
    expect(() => assertReportGrounding(input, [source])).toThrow('REPORT_LITERAL_FACT_REQUIRES_BINDING:report.action_plan.0.evidence');
  });
  it('checks section paragraphs and all numeric cells regardless of column labels', () => {
    const input = payload(); input.report.sections = [{title: '结果', paragraphs: ['花费100']}];
    expect(() => assertReportGrounding(input, [source])).toThrow('report.sections.0.paragraphs.0');
    input.report.sections = [{title: '结果', columns: ['recommendation'], rows: [[20]]}];
    expect(() => assertReportGrounding(input, [source])).toThrow('report.sections.0.rows.0.0');
    input.report.sections[0]!.rows = [[null], [true], ['{{fact:spend}}']];
    expect(() => assertReportGrounding(input, [source])).not.toThrow();
  });
  it('allows reports without numeric evidence, including empty tables and textual sources', () => {
    const input = payload(); delete input.fact_bindings; input.report.executive_summary = '2026年暂无可分析数据';
    for (const sources of [[], [{...source, tables: [{path: 'data.rows', rows: 0, fields: {spend: ['number']}}]}],
      [{...source, tables: [{path: 'data.rows', rows: 1, fields: {content: ['string']}}]}]]) {
      expect(() => assertReportGrounding(input, sources)).not.toThrow();
    }
  });
  it('requires actual reference use or evidence tables, and rejects unknown references', () => {
    const input = payload(); input.report.executive_summary = '已完成分析';
    expect(() => assertReportGrounding(input, [source])).toThrow('REPORT_FACT_REFERENCE_REQUIRED');
    input.evidence_tables = [{title: '结果', evidenceId: 'source', rows_path: 'data.rows', columns: [{field: 'spend', label: '花费'}], limit: 30}];
    expect(() => assertReportGrounding(input, [source])).not.toThrow();
    input.report.executive_summary = '{{fact:unknown}}';
    expect(() => assertReportGrounding(input, [source])).toThrow('FACT_REFERENCE_UNKNOWN');
  });
});
