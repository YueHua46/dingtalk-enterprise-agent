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
      '参数硬约束：daily.product 的 params.asin 必填且只能是单个 ASIN；如果使用 asins，只能传一个元素，宿主会规范化为 asin。广告分析时间窗沿用用户请求，不得自行扩大。',
      'daily.metrics（若当前服务端支持）可一次完成任意分组的汇总、排名、漏斗与广告诊断和两期对比，但不是所有部署都开放；调用失败时不要重复重试，应改用 daily.aggregate、daily.summary、daily.product 或 ads.*。params：start_date/end_date（或 days，默认最近 7 个完整日，最长 92 天）；dimensions ⊆ [store, site, asin, sku, date]（date=逐日趋势）；measures 可选 units, revenue, orders, sessions, page_views, ad_spend, ad_sales, ad_clicks, ad_orders, non_ad_clicks, cvr, order_cvr, aov, acos, tacos, cpc, ad_cvr, ad_sales_share, price, rating, review_count, main_category_rank, sub_category_rank, inventory, buy_box_pct；过滤 site, asins（最多 200 个）, skus；compare = previous_period | previous_year | {start_date, end_date}，返回 baseline 与 change（abs、pct）；order_by 可用任一 measure 或 <measure>_change；limit ≤ 200。返回 totals_by_site（按站点、本币的全部分组合计，适合回答“某站点总销量/销售额/客单价”）以及每行 coverage（缺失或不完整的业务行会标出，而不是丢弃分组）。比率为小数（0.0909=9.09%）；金额为站点本币，跨币种分组的金额为 null，按金额排序须包含 site/store 维度或指定 site。',
      'ads.metrics 对匹配的全部已入库广告记录先聚合再分页/排名，优先用于广告分析。params: site, store_sids, start_date/end_date 或 days（默认7天，最多92天）；sources 数组=sp_search_terms/sb_search_terms/placements/sp_products（默认前两项）；dimensions 数组=store/date/campaign/ad_group/target/search_term/placement/asin/sku；store自动保留，target/search_term仅用于搜索词报告，placement仅用于placements，asin/sku仅用于sp_products。可按campaign_ids/ad_group_ids/asins数组过滤；order_by=spend/sales/clicks/orders/impressions/ctr/cvr/cpc/cpa/acos/roas；limit≤500,offset。返回全部匹配分组的totals_by_store_report、分页分组指标及真实覆盖。CTR/CVR/ACoS单位为百分数，金额为店铺本币，分母零为null。不同report可能重叠，只有SP与SB搜索词两个不重叠渠道可相加；缺日期/店铺记录不证明零，完整聚合不证明上游采集完整。预算配置、竞价、成本、利润不在这些报表中。',
      'ads.sp_search_terms、ads.sb_search_terms、ads.placements 是分页原始明细：默认100条。元数据以实际返回为准；先用ads.metrics回答整体/分层问题，只有需要核对具体原始行时再查明细。ads.summary返回SP/SB及重叠的广告位逐日数据，不能将三项相加。',
      '字段含义：keyword_text 是配置关键词/投放表达式，customer_search_term 才是实际客户搜索词，可能为空；按空维度分组不表示已识别该对象。sp_products 的 asin 是被广告推广的商品，不是被投放的目标 ASIN。dimension_field_coverage 描述全部分组的维度字段缺失情况。',
      '对象定位：ads.metrics 搜索词/广告位来源按活动或广告组分组时附带 campaign_name/ad_group_name（期间最近非空原名）与 *_variants（期间原名集合）；名称只是标识属性，聚合仍按店铺/report/ID。报告保留原始名称和所属层级，ID辅助定位；sp_products来源无名称列，可按同店铺SP及相同ID补关联，禁止凭名称或不同店铺猜测关联。',
      'daily.performance_changes 用于发现两期销量变化最大的店铺或 ASIN（grain=asin|store，direction=decline|growth|all，days）；随后用 daily.metrics 带 asins 与 compare 一次取它们的漏斗与广告指标。daily.product 只在需要某个 ASIN 的逐日原始字段时使用。daily.availability 查询数据最新入库日期。其余数据集（ads.*、reviews.*、rank.*）用于广告搜索词、差评与排名明细。'
    ].join('\n'),
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dataset: { type: 'string', enum: [...CROSSBORDEROPS_DATASETS] },
        params: { type: 'object', additionalProperties: true, properties: {
          result_mode: {type: 'string', enum: ['complete','page'], description: 'ads.metrics 默认 complete，自动收集全部聚合分组到完整证据文件；只有明确需要单页抽查时使用 page。limit 是单页大小，不限制默认完整收集的分组总数。'},
          site: {type: 'string', description: '站点代码，如 JP、DE、US；按用户请求限定站点'},
          store_sids: {type: 'array', items: {type: 'integer'}, description: '可选：在当前用户授权范围内进一步限定店铺'},
          days: {type: 'integer', minimum: 1, maximum: 92, description: '最近完整日期窗口；显式 start_date/end_date 优先'},
          start_date: {type: 'string', description: '起始日 YYYY-MM-DD，含当天'},
          end_date: {type: 'string', description: '结束日 YYYY-MM-DD，含当天'},
          dimensions: {type: 'array', items: {type: 'string'}, description: '聚合维度，合法组合见数据集说明，例如 [store,campaign]、[store,ad_group]、[store,target]'},
          sources: {type: 'array', items: {type: 'string', enum: ['sp_search_terms','sb_search_terms','placements','sp_products']}, description: 'ads.metrics 报表来源'},
          measures: {type: 'array', items: {type: 'string'}, description: 'daily.metrics 指标'},
          campaign_ids: {type: 'array', items: {type: 'string'}},
          ad_group_ids: {type: 'array', items: {type: 'string'}},
          asin: {type: 'string', description: 'daily.product 必填单个 ASIN'},
          asins: {type: 'array', items: {type: 'string'}},
          skus: {type: 'array', items: {type: 'string'}},
          q: {type: 'string', description: '搜索词报告的文字筛选'},
          order_by: {type: 'string', description: '按数据集支持的数值指标排序'},
          compare: {anyOf: [{type: 'string', enum: ['previous_period','previous_year']}, {type: 'object', properties: {start_date: {type: 'string'}, end_date: {type: 'string'}}, required: ['start_date','end_date'], additionalProperties: false}]},
          grain: {type: 'string', enum: ['asin','store']},
          direction: {type: 'string', enum: ['decline','growth','all']},
          limit: { type: 'integer', minimum: 1, description: '分页大小，上限按数据集；广告最多500，排名最多20000。完整性以返回 coverage 为准。' },
          offset: { type: 'integer', minimum: 0, description: '分页起点；使用返回 coverage.next_offset 继续读取。' },
        } },
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
    const params = { ...(rawParams as Record<string, unknown>) };
    // The backend's single-ASIN dataset uses `asin`, while models often
    // generalize filters as `asins`. Normalize an unambiguous one-item filter
    // before it reaches the network; reject ambiguous calls locally so the
    // model can correct the request without spending a backend round trip.
    if (dataset === 'daily.product' && params.asin === undefined) {
      const aliases = params.asins ?? params.ASIN;
      if (Array.isArray(aliases) && aliases.length === 1 && typeof aliases[0] === 'string' && aliases[0].trim()) params.asin = aliases[0].trim();
      else if (typeof aliases === 'string' && aliases.trim()) params.asin = aliases.trim();
      else throw new Error('CROSSBORDEROPS_PARAMS_INVALID: daily.product requires a single params.asin');
    }
    return { dataset, params };
  }

  public action(input: CrossBorderOpsQueryInput): ToolAction {
    return { name: `查询 Amazon 数据：${input.dataset}`, risk: 'read', target: input.dataset, parameters: input };
  }

  public async execute(user: UserIdentity, input: CrossBorderOpsQueryInput): Promise<unknown> {
    const result = await this.client.query(user, input.dataset, input.params);
    if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) return result;
    const data = result.data as Record<string, unknown>;
    const coverage = data.coverage ?? inferredPageCoverage(data);
    const enriched = { ...data, ...(coverage === undefined ? {} : {coverage}),
      ...(input.dataset === 'ads.metrics' ? {field_semantics: {
        observed_days: {kind: 'observation_count', unit: 'distinct_report_dates', definition: 'Count of distinct report_date values in matching stored rows for this group. It does not contain campaign creation time, elapsed campaign age, consecutive active days or evidence of a recent increase.'},
        period: {kind: 'query_window', definition: 'Dates selected for this query; not the attribution window and not evidence that every date was acquired.'},
        spend: {kind: 'observed_amount', definition: 'Reported advertising expenditure within the selected group and dates; actual configured daily budget is not part of this field.'},
        cpc: {kind: 'derived_ratio', definition: 'spend/clicks in store currency; not configured bid.'},
        sales: {kind: 'attributed_amount', definition: 'Advertising-attributed sales in this report; neither total business revenue nor net profit.'},
        orders: {kind: 'attributed_count', definition: 'Orders attributed by this report within its available data; attribution completeness and timing remain source limitations.'},
        acos: {kind: 'derived_ratio', unit: 'percent', definition: '100*spend/sales; comparison with a profitability boundary requires actual cost/margin evidence.'}
      }} : {}),
      ...(input.dataset.startsWith('ads.') ? {annotation_provenance: {
        upstream_derived_fields: ['sop_label','sop_note','word_type','ad_performance','diagnosis_label','optimization','neg_strategy'],
        meaning: 'These fields are upstream derived annotations, not measured outcomes, actual configuration, or verified current recommendations. Their model/rule version and applicability are not established by this report. Reassess against original metrics and the task rules.',
        observations: 'Numerical measures retain the report scope, attribution and missingness; inferred labels do not supply missing product, cost, stage or configuration evidence.'
      }} : {})};
    if (input.dataset !== 'daily.aggregate') return { ...result, data: enriched };
    return { ...result, data: { ...enriched,
      population_provenance: {
        authorization_filter: 'current_dingtalk_user',
        result_population: 'observed_business_constituents',
        coverage_count_basis: 'observed_candidates_only',
        absent_authorized_entities: 'unknown_not_zero',
        full_authorized_population_verified: false,
      } } };
  }
}

/**
 * Compatibility adapter for older CrossBorderOps deployments. The gateway
 * now returns this envelope itself, but the Agent must keep the same semantic
 * contract while a remote deployment is rolling forward. This derives only
 * from explicit pagination metadata; it never guesses completeness from the
 * number of rows.
 */
function inferredPageCoverage(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const rows = data.rows;
  const total = data.total;
  const limit = data.limit;
  const offset = data.offset;
  if (!Array.isArray(rows) || !Number.isSafeInteger(total) || !Number.isSafeInteger(limit) || !Number.isSafeInteger(offset)) return undefined;
  const totalNumber = Number(total);
  const limitNumber = Number(limit);
  const offsetNumber = Number(offset);
  const returned = rows.length;
  const hasMore = offsetNumber + returned < totalNumber;
  return {
    mode: hasMore || offsetNumber > 0 ? 'page' : 'complete',
    basis: 'ordered_rows',
    total: totalNumber,
    offset: offsetNumber,
    returned,
    limit: limitNumber,
    has_more: hasMore,
    next_offset: hasMore ? offsetNumber + returned : null,
  };
}
