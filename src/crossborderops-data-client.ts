import type { Config } from './config.js';
import type { UserIdentity } from './types.js';
import type { EffectiveStoreScope } from './crossborderops-access-client.js';

export const CROSSBORDEROPS_DATASETS = [
  'daily.availability',
  'daily.performance_changes',
  'daily.aggregate',
  'daily.summary',
  'daily.trend',
  'daily.top_products',
  'daily.products',
  'daily.product',
  'daily.analyze',
  'ads.sp_search_terms',
  'ads.sb_search_terms',
  'ads.placements',
  'ads.summary',
  'reviews.negative',
  'reviews.statistics',
  'rank.results',
  'rank.trends',
  'rank.summary',
  'rank.analysis',
] as const;

export type CrossBorderOpsDataset = typeof CROSSBORDEROPS_DATASETS[number];

export interface CrossBorderOpsQueryResult {
  dataset: CrossBorderOpsDataset;
  data: unknown;
  scope: EffectiveStoreScope;
  evidence: {
    queried_at: string;
    source: 'crossborderops';
    authorized_lingxing_sids: number[];
    data_as_of?: string | null;
    freshness?: Record<string, unknown>;
  };
}

type DataConfig = Pick<Config, 'CROSSBORDEROPS_API_URL' | 'CROSSBORDEROPS_INTERNAL_TOKEN' | 'INTERNAL_API_TOKEN'>;

/** CrossBorderOps data gateway. The gateway is the single Amazon read path for the Agent. */
export class CrossBorderOpsDataClient {
  public constructor(private readonly config: DataConfig, private readonly http: typeof fetch = fetch) {}

  public configured(): boolean {
    return Boolean(this.config.CROSSBORDEROPS_API_URL && this.token());
  }

  public async query(user: UserIdentity, dataset: CrossBorderOpsDataset, params: Record<string, unknown> = {}): Promise<CrossBorderOpsQueryResult> {
    if (!this.configured()) throw new Error('CROSSBORDEROPS_DATA_NOT_CONFIGURED');
    const base = this.config.CROSSBORDEROPS_API_URL!.replace(/\/+$/, '');
    const response = await this.http(`${base}/agent-access/query`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'X-CrossBorderOps-Internal-Token': this.token()!,
      },
      body: JSON.stringify({ corp_id: user.corpId, dingtalk_user_id: user.userId, dataset, params }),
      signal: AbortSignal.timeout(dataset === 'daily.analyze' ? 240_000 : 60_000),
    });
    const body = await response.json() as { success?: boolean; data?: CrossBorderOpsQueryResult; message?: string };
    if (!response.ok || !body.success || !body.data) {
      const message = typeof body.message === 'string' ? body.message : 'CROSSBORDEROPS_DATA_QUERY_FAILED';
      throw new Error(`CROSSBORDEROPS_DATA_HTTP_${response.status}: ${message}`);
    }
    if (JSON.stringify(body.data).length > 200_000) throw new Error('CROSSBORDEROPS_RESULT_TOO_LARGE: 请缩小时间窗、店铺或使用服务端聚合查询');
    return body.data;
  }

  private token(): string | undefined {
    return this.config.CROSSBORDEROPS_INTERNAL_TOKEN ?? this.config.INTERNAL_API_TOKEN;
  }
}
