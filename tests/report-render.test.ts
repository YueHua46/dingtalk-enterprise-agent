import {describe, expect, it} from 'vitest';
import {reportRenderSchema, reportRenderTool} from '../src/report-render.js';

const payload = {template: 'amazon-advertising', report: {
  report_title: '德国站广告分析', marketplace: 'DE', analysis_period: '2026-10-06..2026-10-12',
  store_name: '授权店铺', executive_summary: '仅建议，未执行。', data_quality: {cost: '未提供'},
  sections: [{title: '广告组', columns: ['对象', '花费', '依据'], rows: [['group-1', 10, '完整聚合']]}]
}};
describe('structured report rendering contract', () => {
  it('preserves arbitrary analytical dimensions and rejects silent field loss', () => {
    expect(reportRenderSchema.parse(payload).report.sections).toEqual(payload.report.sections);
    expect(reportRenderSchema.safeParse({...payload, report: {...payload.report, campaign_metrics: []}}).success).toBe(false);
    expect(reportRenderTool.inputSchema).toHaveProperty('properties.report');
    expect(reportRenderSchema.parse({...payload, report: {...payload.report, anomalies: [{object:'活动 A', issue:'高风险', severity:'高', impact:'浪费预算', metric:'ACoS 45%'}]}}).report.anomalies?.[0]).toMatchObject({severity:'高',impact:'浪费预算'});
  });
  it('rejects mismatched table cells and caller-controlled output paths', () => {
    expect(reportRenderSchema.safeParse({...payload, path: '../../other-task/report.pdf'}).success).toBe(false);
    expect(reportRenderSchema.safeParse({...payload, report: {...payload.report,
      sections: [{title: 'metrics', columns: ['object'], rows: [['a', 'b']]}]}}).success).toBe(false);
  });
  it('rejects grid fields that the PDF would silently omit', () => {
    for (const [table, row] of Object.entries({
      search_terms: {keyword: 'solar camera outdoor wireless', cpc: 6.88, action: '建议下调竞价'},
      placements: {placement: 'TOP OF SEARCH ON-AMAZON', spend: 8891.5, acos: 104.73},
      negatives: {keyword: 'wireless home security cameras', evidence: '零归因订单', action: '待核查'},
      review_plan: {frequency: '每日', kpi: 'ACoS', observation_window: '7天'}
    })) {
      expect(reportRenderSchema.safeParse({...payload, report: {...payload.report, [table]: [row]}}).success).toBe(false);
    }
    expect(reportRenderSchema.parse({...payload, report: {...payload.report,
      search_terms: [{term: 'solar camera outdoor wireless', evidence: 'CPC 6.88', recommendation: '建议下调竞价'}]
    }}).report.search_terms).toHaveLength(1);
  });
});
