import { describe, expect, it, vi } from 'vitest';
import { CrossBorderOpsDataClient } from '../src/crossborderops-data-client.js';
import { CrossBorderOpsTool } from '../src/crossborderops-tool.js';

const user = { corpId: 'corp-1', userId: 'user-1' };

describe('CrossBorderOpsDataClient', () => {
  it('collects aggregate groups across pages without changing the employee or filters', async () => {
    const http = vi.fn<typeof fetch>(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      expect(request).toMatchObject({corp_id: user.corpId, dingtalk_user_id: user.userId,
        params: {site: 'DE', days: 7, dimensions: ['target'], limit: 2}});
      expect(request.params).not.toHaveProperty('result_mode');
      const offset = request.params.offset ?? 0;
      return new Response(JSON.stringify({success: true, data: {dataset: 'ads.metrics', scope: {lingxing_sids: [237]}, evidence: {},
        data: {rows: offset === 0 ? [{id: 1}, {id: 2}] : [{id: 3}], total: 3, offset,
          period: {start_date: '2026-10-06', end_date: '2026-10-12'}, dimensions: ['target'],
          totals_by_store_report: [{spend: 100}], coverage: {has_more: offset === 0, next_offset: offset === 0 ? 2 : null}}}}));
    });
    const client = new CrossBorderOpsDataClient({CROSSBORDEROPS_API_URL: 'https://ops.example/api', CROSSBORDEROPS_INTERNAL_TOKEN: 'key', INTERNAL_API_TOKEN: undefined}, http);
    const result = await client.query(user, 'ads.metrics', {site: 'DE', days: 7, dimensions: ['target'], limit: 2});
    expect(result.data).toMatchObject({rows: [{id: 1}, {id: 2}, {id: 3}], total: 3,
      coverage: {mode: 'complete', returned: 3, has_more: false, collected_pages: 2}});
    expect(http).toHaveBeenCalledTimes(2);
    http.mockClear();
    const page = await client.query(user, 'ads.metrics', {site: 'DE', days: 7, dimensions: ['target'], limit: 2, result_mode: 'page'});
    expect((page.data as any).rows).toHaveLength(2);
    expect(http).toHaveBeenCalledOnce();
  });
  it('sends the current DingTalk identity and dataset to the guarded gateway', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        dataset: 'daily.summary',
        data: { total_revenue: 123 },
        scope: { corp_id: 'corp-1', dingtalk_user_id: 'user-1', lingxing_sids: [7446], has_access: true },
        evidence: { source: 'crossborderops', authorized_lingxing_sids: [7446] },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new CrossBorderOpsDataClient({ CROSSBORDEROPS_API_URL: 'https://ops.example/api', CROSSBORDEROPS_INTERNAL_TOKEN: 'x'.repeat(32), INTERNAL_API_TOKEN: undefined }, http);
    await expect(client.query(user, 'daily.summary', { days: 7 })).resolves.toMatchObject({ dataset: 'daily.summary' });
    expect(http).toHaveBeenCalledWith('https://ops.example/api/agent-access/query', expect.objectContaining({ method: 'POST' }));
    const init = http.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ corp_id: 'corp-1', dingtalk_user_id: 'user-1', dataset: 'daily.summary' });
  });

  it('fails closed on a gateway error', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ success: false, message: 'denied' }), { status: 403 }));
    const client = new CrossBorderOpsDataClient({ CROSSBORDEROPS_API_URL: 'https://ops.example/api', CROSSBORDEROPS_INTERNAL_TOKEN: 'x'.repeat(32), INTERNAL_API_TOKEN: undefined }, http);
    await expect(client.query(user, 'reviews.negative', {})).rejects.toThrow('CROSSBORDEROPS_DATA_HTTP_403');
  });
});

describe('CrossBorderOpsTool', () => {
  it('only accepts registered read datasets', () => {
    const tool = new CrossBorderOpsTool({ query: vi.fn() } as any);
    expect(tool.parse({ dataset: 'daily.summary', params: {} })).toEqual({ dataset: 'daily.summary', params: {} });
    expect(() => tool.parse({ dataset: 'unknown', params: {} })).toThrow('CROSSBORDEROPS_DATASET_INVALID');
    expect(tool.action({ dataset: 'daily.summary', params: {} }).risk).toBe('read');
  });

  it('normalizes an unambiguous ASIN alias and rejects an empty product lookup locally', () => {
    const tool = new CrossBorderOpsTool({ query: vi.fn() } as any);
    expect(tool.parse({ dataset: 'daily.product', params: { asins: ['B0H2MH1MN7'] } })).toEqual({
      dataset: 'daily.product', params: { asins: ['B0H2MH1MN7'], asin: 'B0H2MH1MN7' }
    });
    expect(() => tool.parse({ dataset: 'daily.product', params: {} })).toThrow('daily.product requires a single params.asin');
  });

  it('states aggregate population provenance in the model-visible result', async () => {
    const tool = new CrossBorderOpsTool({ query: vi.fn().mockResolvedValue({ dataset: 'daily.aggregate',
      data: { total: 1, coverage: { complete_count: 1 } }, scope: { lingxing_sids: [1, 2] }, evidence: {} }) } as any);
    const result = await tool.execute(user, { dataset: 'daily.aggregate', params: {} }) as { data: { population_provenance: Record<string, unknown> } };
    expect(result.data.population_provenance).toMatchObject({ result_population: 'observed_business_constituents',
      absent_authorized_entities: 'unknown_not_zero', full_authorized_population_verified: false });
  });

  it('keeps host-provided coverage metadata visible to the model', async () => {
    const tool = new CrossBorderOpsTool({ query: vi.fn().mockResolvedValue({ dataset: 'ads.sp_search_terms',
      data: { rows: [{ id: 1 }], total: 3104, limit: 100, offset: 0,
        coverage: { mode: 'page', total: 3104, offset: 0, returned: 1, has_more: true, next_offset: 1 } },
      scope: { lingxing_sids: [1] }, evidence: {} }) } as any);
    const result = await tool.execute(user, { dataset: 'ads.sp_search_terms', params: {} }) as any;
    expect(result.data.coverage).toMatchObject({ mode: 'page', total: 3104, has_more: true, next_offset: 1 });
  });

  it('normalizes pagination from a legacy gateway response without using row-count guesses', async () => {
    const tool = new CrossBorderOpsTool({ query: vi.fn().mockResolvedValue({ dataset: 'ads.placements',
      data: { rows: [{ id: 1 }], total: 4218, limit: 100, offset: 0 }, scope: { lingxing_sids: [1] }, evidence: {} }) } as any);
    const result = await tool.execute(user, { dataset: 'ads.placements', params: {} }) as any;
    expect(result.data.coverage).toEqual({ mode: 'page', basis: 'ordered_rows', total: 4218, offset: 0,
      returned: 1, limit: 100, has_more: true, next_offset: 1 });
  });
});
