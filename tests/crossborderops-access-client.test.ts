import { describe, expect, it, vi } from 'vitest';
import { CrossBorderOpsAccessClient } from '../src/crossborderops-access-client.js';

const user = { corpId: 'corp-1', userId: 'user-1' };

describe('CrossBorderOpsAccessClient', () => {
  it('loads and caches the effective DingTalk store scope', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { corp_id: 'corp-1', dingtalk_user_id: 'user-1', store_ids: [2], lingxing_sids: [7446], stores: [], has_access: true }
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new CrossBorderOpsAccessClient({ CROSSBORDEROPS_API_URL: 'https://ops.example/api', CROSSBORDEROPS_INTERNAL_TOKEN: 'x'.repeat(32), INTERNAL_API_TOKEN: undefined }, http);
    await expect(client.requireAccess(user)).resolves.toMatchObject({ lingxing_sids: [7446] });
    await expect(client.requireAccess(user)).resolves.toMatchObject({ lingxing_sids: [7446] });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the effective scope is empty', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { corp_id: 'corp-1', dingtalk_user_id: 'user-1', store_ids: [], lingxing_sids: [], stores: [], has_access: false }
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new CrossBorderOpsAccessClient({ CROSSBORDEROPS_API_URL: 'https://ops.example/api', CROSSBORDEROPS_INTERNAL_TOKEN: 'x'.repeat(32), INTERNAL_API_TOKEN: undefined }, http);
    await expect(client.requireAccess(user)).rejects.toThrow('AMAZON_DATA_ACCESS_DENIED');
  });

  it('rejects a scope response for a different DingTalk identity', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { corp_id: 'corp-1', dingtalk_user_id: 'other-user', store_ids: [2], lingxing_sids: [7446], stores: [], has_access: true }
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new CrossBorderOpsAccessClient({ CROSSBORDEROPS_API_URL: 'https://ops.example/api', CROSSBORDEROPS_INTERNAL_TOKEN: 'x'.repeat(32), INTERNAL_API_TOKEN: undefined }, http);
    await expect(client.scopeFor(user)).rejects.toThrow('CROSSBORDEROPS_ACCESS_IDENTITY_MISMATCH');
  });

  it('uses the existing Agent internal token as the bridge token fallback', () => {
    const client = new CrossBorderOpsAccessClient({ CROSSBORDEROPS_API_URL: 'https://ops.example/api', CROSSBORDEROPS_INTERNAL_TOKEN: undefined, INTERNAL_API_TOKEN: 'x'.repeat(32) });
    expect(client.configured()).toBe(true);
  });
});
