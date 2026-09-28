import { describe, expect, it, vi } from 'vitest';
import { CrossBorderOpsDataClient } from '../src/crossborderops-data-client.js';
import { CrossBorderOpsTool } from '../src/crossborderops-tool.js';

const user = { corpId: 'corp-1', userId: 'user-1' };

describe('CrossBorderOpsDataClient', () => {
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

  it('states aggregate population provenance in the model-visible result', async () => {
    const tool = new CrossBorderOpsTool({ query: vi.fn().mockResolvedValue({ dataset: 'daily.aggregate',
      data: { total: 1, coverage: { complete_count: 1 } }, scope: { lingxing_sids: [1, 2] }, evidence: {} }) } as any);
    const result = await tool.execute(user, { dataset: 'daily.aggregate', params: {} }) as { data: { population_provenance: Record<string, unknown> } };
    expect(result.data.population_provenance).toMatchObject({ result_population: 'observed_business_constituents',
      absent_authorized_entities: 'unknown_not_zero', full_authorized_population_verified: false });
  });
});
