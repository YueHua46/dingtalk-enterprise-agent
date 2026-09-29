import type { ToolAction, UserIdentity } from './types.js';
import { CROSSBORDEROPS_DATASETS, CrossBorderOpsDataClient, type CrossBorderOpsDataset } from './crossborderops-data-client.js';

export interface CrossBorderOpsQueryInput {
  dataset: CrossBorderOpsDataset;
  params: Record<string, unknown>;
}

export const crossBorderOpsDynamicTools = [{
  type: 'namespace',
  name: 'crossborderops',
  description: '查询 CrossBorderOps 后台已采集的公司自有 Amazon 店铺经营数据。宿主会按当前钉钉用户的有效店铺授权范围裁剪结果，并返回数据新鲜度证据。公开 ASIN/关键词/竞品数据应使用 SIF，不通过本工具查询。',
  tools: [{
    type: 'function',
    name: 'scope',
    description: '读取当前钉钉用户在 CrossBorderOps 中实际有权访问的 Amazon 店铺清单。服务端按当前 corpId + userId 重新计算权限；可按 offset/limit 分页。查询授权店铺范围时直接使用此能力，无需扫描销量报表或借用其他系统授权。',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 }
    } },
  }, {
    type: 'function',
    name: 'query',
    description: [
      '查询公司自有店铺的日报、广告、评论、排名数据。店铺范围由服务端按当前用户计算，不得传入 corp_id、user_id；可选 params.store_sids 缩小到已授权店铺。',
      '首选 daily.metrics：一次调用完成任意分组的汇总、排名、漏斗与广告诊断和两期对比。params：start_date/end_date（或 days，默认最近 7 个完整日，最长 92 天）；dimensions ⊆ [store, site, asin, sku, date]（date=逐日趋势）；measures 可选 units, revenue, orders, sessions, page_views, ad_spend, ad_sales, ad_clicks, ad_orders, non_ad_clicks, cvr, order_cvr, aov, acos, tacos, cpc, ad_cvr, ad_sales_share, price, rating, review_count, main_category_rank, sub_category_rank, inventory, buy_box_pct；过滤 site, asins（最多 200 个）, skus；compare = previous_period | previous_year | {start_date, end_date}，返回 baseline 与 change（abs、pct）；order_by 可用任一 measure 或 <measure>_change；limit ≤ 200。返回 totals_by_site（按站点、本币的全部分组合计，适合回答“某站点总销量/销售额/客单价”）以及每行 coverage（缺失或不完整的业务行会标出，而不是丢弃分组）。比率为小数（0.0909=9.09%）；金额为站点本币，跨币种分组的金额为 null，按金额排序须包含 site/store 维度或指定 site。',
      'daily.performance_changes 用于发现两期销量变化最大的店铺或 ASIN（grain=asin|store，direction=decline|growth|all，days）；随后用 daily.metrics 带 asins 与 compare 一次取它们的漏斗与广告指标。daily.product 只在需要某个 ASIN 的逐日原始字段时使用。daily.availability 查询数据最新入库日期。其余数据集（ads.*、reviews.*、rank.*）用于广告搜索词、差评与排名明细。'
    ].join('\n'),
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dataset: { type: 'string', enum: [...CROSSBORDEROPS_DATASETS] },
        params: { type: 'object', additionalProperties: true },
      },
      required: ['dataset'],
    },
  }],
}];

export class CrossBorderOpsTool {
  public constructor(private readonly client: CrossBorderOpsDataClient) {}

  public parse(input: unknown): CrossBorderOpsQueryInput {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('CROSSBORDEROPS_ARGUMENTS_INVALID');
    const value = input as Record<string, unknown>;
    const dataset = String(value.dataset ?? '') as CrossBorderOpsDataset;
    if (!CROSSBORDEROPS_DATASETS.includes(dataset)) throw new Error('CROSSBORDEROPS_DATASET_INVALID');
    const rawParams = value.params ?? {};
    if (!rawParams || typeof rawParams !== 'object' || Array.isArray(rawParams)) throw new Error('CROSSBORDEROPS_PARAMS_INVALID');
    return { dataset, params: rawParams as Record<string, unknown> };
  }

  public action(input: CrossBorderOpsQueryInput): ToolAction {
    return { name: `查询 Amazon 数据：${input.dataset}`, risk: 'read', target: input.dataset, parameters: input };
  }

  public async execute(user: UserIdentity, input: CrossBorderOpsQueryInput): Promise<unknown> {
    const result = await this.client.query(user, input.dataset, input.params);
    if (input.dataset !== 'daily.aggregate' || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) return result;
    return { ...result, data: { ...result.data,
      population_provenance: {
        authorization_filter: 'current_dingtalk_user',
        result_population: 'observed_business_constituents',
        coverage_count_basis: 'observed_candidates_only',
        absent_authorized_entities: 'unknown_not_zero',
        full_authorized_population_verified: false,
      } } };
  }
}
