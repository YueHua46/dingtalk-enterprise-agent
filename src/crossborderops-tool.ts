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
    description: '查询公司自有店铺的日报、广告、评论、排名或对应分析数据。daily.aggregate 对指定单一时段按 dimensions 中的 store/site/asin 任意组合聚合，measures=[units,revenue]，order_by=units|revenue，order=asc|desc，支持 start_date/end_date/site/asin/limit/offset，返回并列数量与完整性。其 coverage 只衡量已进入业务源的候选记录；total 是该查询口径的聚合行数，不能证明未出现业务行的授权店铺销量为零或已计入合计。需要判断授权对象全集时可结合 scope，并按相同查询条件核对业务覆盖。多站点数值可一次按 store+site 维度分页读取；若按 revenue 排序必须限定单一 site，因为跨站点销售额不可直接混算。daily.performance_changes 用于两个等长时段的变化。根据任务目标选择，不额外引入比较。店铺范围由服务端按当前用户计算，不得传入 corp_id、user_id 扩大权限。',
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
