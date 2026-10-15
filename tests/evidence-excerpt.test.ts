import {describe, expect, it} from 'vitest';
import {structuredEvidenceExcerpt} from '../src/evidence-excerpt.js';

describe('structured review evidence', () => {
  it('retains Lingxing source, completeness limits and nested pagination while sampling whole records', () => {
    const result = JSON.parse(structuredEvidenceExcerpt(JSON.stringify({source: 'lingxing_mcp', toolId: 'erp_listing',
      coverage: {mode: 'upstream_response', basis: 'Full acquisition has not been verified'},
      scope: {lingxing_sids: [240], stores: [{sid: 240, name: 'DE'}]},
      data: {code: 200, data: {list: Array.from({length: 100}, (_, id) => ({id, title: 'x'.repeat(200)})), total: 1240, page: 1},
        recordsFiltered: 1240}}), 2000));
    expect(result.source).toBe('lingxing_mcp');
    expect(result.toolId).toBe('erp_listing');
    expect(result.coverage.mode).toBe('upstream_response');
    expect(result.data.data.total).toBe(1240);
    expect(result.data.recordsFiltered).toBe(1240);
    expect(result.scope.stores[0].sid).toBe(240);
    expect(result.data.data.list.length).toBeGreaterThan(0);
    expect(result.data.data.list.length).toBeLessThan(100);
    expect(result.excerptCoverage['data.list']).toEqual({returned: 100, retained: result.data.data.list.length});
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(2000);
  });
  it('keeps scope, period and trailing coverage when detail exceeds the budget', () => {
    const result = JSON.parse(structuredEvidenceExcerpt(JSON.stringify({dataset: 'ads.metrics',
      scope: {lingxing_sids: [1], stores: [{lingxing_sid: 1, name: 'shop', country: '德国'}]},
      data: {rows: Array.from({length: 200}, (_,id) => ({id, value: 'x'.repeat(200)})),
        coverage: {total: 11020, returned: 200, has_more: true}, period: {start_date: '2026-10-06'},
        totals_by_store_report: [{sid: 1, spend: 1022.68}]}}), 2000));
    expect(result.data.coverage.total).toBe(11020);
    expect(result.data.period.start_date).toBe('2026-10-06');
    expect(result.data.totals_by_store_report[0].spend).toBe(1022.68);
    expect(result.excerptCoverage.rows.retained).toBeLessThan(200);
    expect(result.excerptCoverage.rows.returned).toBe(200);
    expect(result.scope.stores[0].country).toBe('德国');
  });
});
