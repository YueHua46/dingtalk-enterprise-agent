import type { Config } from './config.js';
import type { UserIdentity } from './types.js';
import type { EffectiveStoreScope } from './crossborderops-access-client.js';
import {requestReadWithRetry} from './read-request-retry.js';

export const CROSSBORDEROPS_DATASETS = [
  'daily.availability',
  'daily.metrics',
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
  'ads.metrics',
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
    const {result_mode, ...filters} = params;
    if (result_mode !== undefined && result_mode !== 'complete' && result_mode !== 'page') throw new Error('CROSSBORDEROPS_RESULT_MODE_INVALID');
    if (dataset !== 'ads.metrics' || result_mode === 'page') return this.queryPage(user, dataset, filters);
    // Collection and presentation are separate: calculations get every group,
    // while the model receives a bounded, explicitly labelled excerpt.
    const start = Number(filters.offset ?? 0);
    const request = {...filters, limit: filters.limit ?? 500};
    const first = await this.queryPage(user, dataset, request);
    const data = first.data as Record<string, any>;
    if (!data || !Array.isArray(data.rows) || !data.coverage) return first;
    const rows = [...data.rows];
    let page = data;
    const seenOffsets = new Set<number>([start]);
    while (page.coverage.has_more === true) {
      const offset = page.coverage.next_offset;
      if (!Number.isInteger(offset) || offset !== start + rows.length || seenOffsets.has(offset)) throw new Error('CROSSBORDEROPS_PAGINATION_INVALID');
      seenOffsets.add(offset);
      const next = await this.queryPage(user, dataset, {...request, offset});
      page = next.data as Record<string, any>;
      if (!Array.isArray(page?.rows) || !page.rows.length || page.total !== data.total
        || JSON.stringify(page.period) !== JSON.stringify(data.period)
        || JSON.stringify(page.dimensions) !== JSON.stringify(data.dimensions)
        || JSON.stringify(page.totals_by_store_report) !== JSON.stringify(data.totals_by_store_report)
        || JSON.stringify(next.scope.lingxing_sids) !== JSON.stringify(first.scope.lingxing_sids)) {
        throw new Error('CROSSBORDEROPS_COLLECTION_CHANGED: 分页数据范围发生变化，请重新查询');
      }
      rows.push(...page.rows);
      if (Buffer.byteLength(JSON.stringify(rows), 'utf8') > 3_000_000) throw new Error('CROSSBORDEROPS_COLLECTION_TOO_LARGE: 请按店铺或对象分组分批查询，保持原时间窗');
    }
    if (start + rows.length !== data.total) throw new Error('CROSSBORDEROPS_COLLECTION_INCOMPLETE');
    const result = {...first, data: {...data, rows, limit: rows.length, coverage: {...data.coverage,
      mode: start === 0 ? 'complete' : 'page', returned: rows.length, limit: rows.length,
      has_more: false, next_offset: null, collected_pages: seenOffsets.size}}};
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 3_500_000) throw new Error('CROSSBORDEROPS_COLLECTION_TOO_LARGE: 请按店铺或对象分组分批查询，保持原时间窗');
    return result;
  }

  private async queryPage(user: UserIdentity, dataset: CrossBorderOpsDataset, params: Record<string, unknown>): Promise<CrossBorderOpsQueryResult> {
    if (!this.configured()) throw new Error('CROSSBORDEROPS_DATA_NOT_CONFIGURED');
    const base = this.config.CROSSBORDEROPS_API_URL!.replace(/\/+$/, '');
    const response = await requestReadWithRetry(`${base}/agent-access/query`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'X-CrossBorderOps-Internal-Token': this.token()!,
      },
      body: JSON.stringify({ corp_id: user.corpId, dingtalk_user_id: user.userId, dataset, params }),
    }, this.http, dataset === 'daily.analyze' ? 240_000 : 60_000);
    const body = await response.json() as { success?: boolean; data?: CrossBorderOpsQueryResult; message?: string };
    if (!response.ok || !body.success || !body.data) {
      const message = typeof body.message === 'string' ? body.message : 'CROSSBORDEROPS_DATA_QUERY_FAILED';
      throw new Error(`CROSSBORDEROPS_DATA_HTTP_${response.status}: ${message}`);
    }
    // Complete evidence is persisted separately from its bounded model view.
    // Do not reject a normal 500-group aggregation merely to fit chat context.
    if (Buffer.byteLength(JSON.stringify(body.data), 'utf8') > 3_500_000) throw new Error('CROSSBORDEROPS_RESULT_TOO_LARGE: 请按分组结果分页，保持原时间窗及筛选范围');
    return body.data;
  }

  private token(): string | undefined {
    return this.config.CROSSBORDEROPS_INTERNAL_TOKEN ?? this.config.INTERNAL_API_TOKEN;
  }
}
