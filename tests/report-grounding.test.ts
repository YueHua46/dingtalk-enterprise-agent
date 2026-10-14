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
