import {describe, expect, it} from 'vitest';
import {structuredEvidenceExcerpt} from '../src/evidence-excerpt.js';

describe('structured review evidence', () => {
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
