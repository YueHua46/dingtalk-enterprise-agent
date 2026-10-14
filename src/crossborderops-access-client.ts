import type { Config } from './config.js';
import type { UserIdentity } from './types.js';
import {requestReadWithRetry} from './read-request-retry.js';

export interface EffectiveStoreScope {
  corp_id: string;
  dingtalk_user_id: string;
  store_ids: number[];
  lingxing_sids: number[];
  stores: Array<Record<string, unknown>>;
  has_access: boolean;
}

type AccessConfig = Pick<Config, 'CROSSBORDEROPS_API_URL' | 'CROSSBORDEROPS_INTERNAL_TOKEN' | 'INTERNAL_API_TOKEN'>;

/** Fail-closed server-to-server lookup for the current DingTalk identity. */
export class CrossBorderOpsAccessClient {
  private readonly cache = new Map<string, { expiresAt: number; scope: EffectiveStoreScope }>();

  public constructor(private readonly config: AccessConfig, private readonly http: typeof fetch = fetch) {}

  private token(): string | undefined {
    return this.config.CROSSBORDEROPS_INTERNAL_TOKEN ?? this.config.INTERNAL_API_TOKEN;
  }

  public configured(): boolean {
    return Boolean(this.config.CROSSBORDEROPS_API_URL && this.token());
  }

  public async scopeFor(user: UserIdentity): Promise<EffectiveStoreScope> {
    if (!this.configured()) throw new Error('CROSSBORDEROPS_ACCESS_NOT_CONFIGURED');
    const key = `${user.corpId}:${user.userId}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.scope;
    const base = this.config.CROSSBORDEROPS_API_URL!.replace(/\/+$/, '');
    const url = `${base}/agent-access/effective-scope/${encodeURIComponent(user.corpId)}/${encodeURIComponent(user.userId)}`;
    const response = await requestReadWithRetry(url, {
      method: 'GET',
      headers: { accept: 'application/json', 'X-CrossBorderOps-Internal-Token': this.token()! },
    }, this.http);
    const body = await response.json() as { success?: boolean; data?: EffectiveStoreScope; message?: string };
    if (!response.ok || !body.success || !body.data) throw new Error(`CROSSBORDEROPS_ACCESS_HTTP_${response.status}`);
    if (body.data.corp_id !== user.corpId || body.data.dingtalk_user_id !== user.userId) throw new Error('CROSSBORDEROPS_ACCESS_IDENTITY_MISMATCH');
    const scope: EffectiveStoreScope = {
      corp_id: user.corpId,
      dingtalk_user_id: user.userId,
      store_ids: normalizeNumbers(body.data.store_ids),
      lingxing_sids: normalizeNumbers(body.data.lingxing_sids),
      stores: Array.isArray(body.data.stores) ? body.data.stores : [],
      has_access: Boolean(body.data.has_access && body.data.lingxing_sids?.length)
    };
    this.cache.set(key, { expiresAt: Date.now() + 60_000, scope });
    return scope;
  }

  public async requireAccess(user: UserIdentity): Promise<EffectiveStoreScope> {
    const scope = await this.scopeFor(user);
    if (!scope.has_access || scope.lingxing_sids.length === 0) throw new Error('AMAZON_DATA_ACCESS_DENIED');
    return scope;
  }
}

function normalizeNumbers(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => Number(value)).filter((value) => Number.isSafeInteger(value) && value > 0))];
}
