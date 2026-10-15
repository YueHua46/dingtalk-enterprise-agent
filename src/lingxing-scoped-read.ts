import { CrossBorderOpsAccessClient } from './crossborderops-access-client.js';
import type { EffectiveStoreScope } from './crossborderops-access-client.js';
import type { Config } from './config.js';
import type { UserIdentity } from './types.js';
import { LingxingMcpTool } from './lingxing-mcp-tool.js';
import { lingxingReadRegistry } from './lingxing-read-registry.js';

export const LINGXING_SCOPED_READ_TOOLS = Object.keys(lingxingReadRegistry);
export interface LingxingScopedReadInput { toolId: string; params?: Record<string, unknown> }

export function parseLingxingScopedRead(raw: unknown): LingxingScopedReadInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('LINGXING_SCOPED_READ_ARGUMENTS_INVALID');
  const value = raw as Record<string, unknown>;
  if (typeof value.toolId !== 'string' || !Object.hasOwn(lingxingReadRegistry, value.toolId)) throw new Error('LINGXING_SCOPED_READ_TOOL_NOT_REGISTERED');
  if (value.params !== undefined && (!value.params || typeof value.params !== 'object' || Array.isArray(value.params))) throw new Error('LINGXING_SCOPED_READ_PARAMS_INVALID');
  return { toolId: value.toolId, params: value.params as Record<string, unknown> | undefined ?? {} };
}

/** Only unwrap protocol/business envelopes; never deliver a shared-key raw result. */
export function unwrapLingxingResult(result: unknown): any {
  const r = result as any;
  if (!r || r.isError || !Array.isArray(r.content)) throw new Error('LINGXING_UPSTREAM_TOOL_FAILED');
  let data = JSON.parse(r.content.filter((x: any) => typeof x.text === 'string').map((x: any) => x.text).join('\n'));
  assertBusinessSuccess(data);
  for (let depth = 0; depth < 4 && data && typeof data === 'object' && !Array.isArray(data); depth++) {
    if (data.success === false || (data.code !== undefined && data.code !== 1 && data.code !== '1' && data.code !== 200 && data.code !== '200')) throw new Error(`LINGXING_UPSTREAM_BUSINESS_ERROR: ${String(data.msg ?? data.message ?? 'upstream rejected').slice(0, 200)}`);
    if ('data' in data && ('code' in data || 'success' in data)) {
      const metadata = Object.keys(data).filter(key => !['data','code','success','msg','message','traceId','require_id','update_code'].includes(key));
      if (metadata.length) return data; // Preserve recordsFiltered, totals, summaries and pagination.
      data = data.data;
    }
    else break;
  }
  return data;
}

function assertBusinessSuccess(value: any): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach(assertBusinessSuccess); return; }
  // Business errors can be nested under an envelope with pagination/request metadata.
  if ((Object.hasOwn(value, 'data') || Object.hasOwn(value, 'msg') || Object.hasOwn(value, 'message')) &&
      (value.success === false || (value.code !== undefined && ![1, '1', 200, '200'].includes(value.code)))) {
    throw new Error(`LINGXING_UPSTREAM_BUSINESS_ERROR: ${String(value.msg ?? value.message ?? 'upstream rejected').slice(0, 200)}`);
  }
  if (Object.hasOwn(value, 'data')) assertBusinessSuccess(value.data);
}

function ids(raw: unknown, name: string): string[] {
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [raw];
  if (!values.length) throw new Error(`LINGXING_EMPTY_SCOPE: ${name}`);
  return [...new Set(values.map(value => {
    if ((typeof value !== 'string' && typeof value !== 'number') || !/^[1-9]\d*$/.test(String(value).trim()) || (typeof value === 'number' && !Number.isSafeInteger(value))) throw new Error(`LINGXING_INVALID_SCOPE_ID: ${name}`);
    return String(value).trim();
  }))];
}

function validate(value: unknown, schema: any, path: string): void {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`LINGXING_PARAM_TYPE: ${path}`);
    const record = value as Record<string, unknown>;
    for (const required of schema.required ?? []) if (record[required] === undefined) throw new Error(`LINGXING_REQUIRED_PARAM: ${path}.${required}`);
    for (const [key, child] of Object.entries(record)) {
      if (schema.properties && !Object.hasOwn(schema.properties, key)) throw new Error(`LINGXING_UNSUPPORTED_PARAM: ${path}.${key}`);
      if (schema.properties?.[key]) validate(child, schema.properties[key], `${path}.${key}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new Error(`LINGXING_PARAM_TYPE: ${path}`);
    if (schema.minItems && value.length < schema.minItems) throw new Error(`LINGXING_PARAM_RANGE: ${path}`);
    if (schema.items) value.forEach((item, index) => validate(item, schema.items, `${path}[${index}]`));
  } else if (schema.type === 'integer' ? !Number.isSafeInteger(value) : schema.type === 'number' ? typeof value !== 'number' || !Number.isFinite(value) : schema.type === 'string' ? typeof value !== 'string' : schema.type === 'boolean' ? typeof value !== 'boolean' : false) {
    throw new Error(`LINGXING_PARAM_TYPE: ${path}`);
  }
  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) throw new Error(`LINGXING_PARAM_PATTERN: ${path}`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`LINGXING_PARAM_ENUM: ${path}`);
  if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) throw new Error(`LINGXING_PARAM_RANGE: ${path}`);
}

function encodeIds(values: string[], schema: any): unknown {
  if (schema?.type === 'array') return schema.items?.type === 'integer' ? values.map(asSafeNumber) : values;
  if (schema?.type === 'integer') return asSafeNumber(values[0]!);
  return values.join(',');
}
function asSafeNumber(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('LINGXING_SCOPE_ID_PRECISION');
  return n;
}

/** Defense against an upstream filter being ignored. Unknown scope is never widened. */
function assertResponseScope(value: unknown, sids: Set<string>, profiles: Set<string>, adReport = false): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach(item => assertResponseScope(item, sids, profiles, adReport)); return; }
  for (const [key, child] of Object.entries(value)) {
    const allowed = ['sid', 'sids', 'store_sid', 'store_sids', 'store_id', 'storeId', 'storeIds', 'storeIdList', 'sidList'].includes(key) && !(adReport && key === 'store_id') ? sids : ['profile_id', 'profile_ids', 'profileId'].includes(key) ? profiles : undefined;
    if (allowed && child !== null && child !== undefined && child !== '' && !(Array.isArray(child) && child.length === 0)) {
      if (ids(child, key).some(id => !allowed.has(id))) throw new Error('LINGXING_UPSTREAM_SCOPE_VIOLATION');
    } else assertResponseScope(child, sids, profiles, adReport);
  }
}

type ScopeClient = Pick<CrossBorderOpsAccessClient, 'scopeFor'>;
type BusinessClient = Pick<LingxingMcpTool, 'execute' | 'describe'>;

export class LingxingScopedRead {
  private readonly access: ScopeClient;
  private readonly mcp: BusinessClient;
  public constructor(config: Config, access?: ScopeClient, mcp?: BusinessClient) {
    this.access = access ?? new CrossBorderOpsAccessClient(config);
    this.mcp = mcp ?? new LingxingMcpTool(config);
  }

  public async execute(user: UserIdentity, raw: unknown): Promise<unknown> {
    const input = parseLingxingScopedRead(raw);
    // Authorization is refreshed on EVERY business call, including catalog snapshots.
    const scope = await this.access.scopeFor(user, true);
    if (scope.corp_id !== user.corpId || scope.dingtalk_user_id !== user.userId) throw new Error('LINGXING_IDENTITY_MISMATCH');
    if (!scope.has_access || !scope.lingxing_sids.length) throw new Error('AMAZON_DATA_ACCESS_DENIED');
    const policy = lingxingReadRegistry[input.toolId]!;
    const params = { ...input.params };
    let selected = ids(scope.lingxing_sids, 'authorized_sids');
    const restrict = (requested: string[]) => {
      if (requested.some(id => !selected.includes(id))) throw new Error('LINGXING_STORE_ACCESS_DENIED');
      selected = requested;
    };
    if (params.store_sids !== undefined) { restrict(ids(params.store_sids, 'store_sids')); delete params.store_sids; }
    // All official parameter names are preserved. Only the explicit host selector above is removed.
    const properties = policy.inputSchema.properties ?? {};
    for (const key of Object.keys(params)) if (!Object.hasOwn(properties, key)) throw new Error(`LINGXING_UNSUPPORTED_PARAM: ${key}`);
    if (policy.mode !== 'profiles' && policy.mode !== 'shops' && params[policy.scopeKey] !== undefined) restrict(ids(params[policy.scopeKey], policy.scopeKey));

    const live = await this.mcp.describe(input.toolId);
    if (live.toolType !== 'read') throw new Error('LINGXING_TOOL_NOT_READ_ONLY');
    if (policy.mode !== 'shops') {
      const expected = properties[policy.scopeKey];
      const actual = live.inputSchema?.properties?.[policy.scopeKey];
      if (!actual || actual.type !== expected.type || actual.items?.type !== expected.items?.type) throw new Error('LINGXING_SCOPE_SCHEMA_CHANGED');
    }
    let shopRows: any[] = [];
    let profiles: string[] = [];
    if (policy.mode === 'profiles' || input.toolId === 'ad_auth_shops') {
      const data = unwrapLingxingResult(await this.mcp.execute({ toolId: 'ad_auth_shops', params: {} }));
      if (!Array.isArray(data)) throw new Error('LINGXING_AD_SHOPS_INVALID');
      // Filter inside host before any data, counts or mappings reach the model.
      shopRows = data.filter(row => row && selected.includes(String(row.sid)));
      profiles = [...new Set(shopRows.map(row => ids(row.profile_id, 'profile_id')[0]!))];
      if (policy.mode === 'profiles') {
        const mapped = new Set(shopRows.map(row => String(row.sid)));
        if (selected.some(sid => !mapped.has(sid))) throw new Error('LINGXING_AD_PROFILE_MAPPING_MISSING: 请使用 ad_auth_shops 查看已授权范围内可用映射，再按 store_sids 缩小范围');
        for (const key of ['profile_ids', 'profile_id']) if (params[key] !== undefined) {
          const requested = ids(params[key], key);
          if (requested.some(id => !profiles.includes(id))) throw new Error('LINGXING_PROFILE_ACCESS_DENIED');
          profiles = requested;
        }
        selected = selected.filter(sid => shopRows.some(row => String(row.sid) === sid && profiles.includes(String(row.profile_id))));
        if (!selected.length || !profiles.length) throw new Error('LINGXING_EMPTY_SCOPE');
      }
    }
    let data: unknown;
    let appliedParams: Record<string, unknown>[] = [];
    if (input.toolId === 'ad_auth_shops') data = shopRows;
    else if (input.toolId === 'get_my_sids') {
      const result = unwrapLingxingResult(await this.mcp.execute({ toolId: input.toolId, params }));
      if (!Array.isArray(result?.list)) throw new Error('LINGXING_SHOPS_INVALID');
      data = result.list.filter((row: any) => selected.includes(String(row.id)));
    } else {
      const calls: Record<string, unknown>[] = [];
      if (policy.mode === 'profiles') {
        params[policy.scopeKey] = encodeIds(profiles, properties[policy.scopeKey]);
        if (properties.profile_id && params.profile_id === undefined && policy.inputSchema.required?.includes('profile_id')) {
          if (profiles.length !== 1) throw new Error('LINGXING_SINGLE_PROFILE_REQUIRED: 使用 store_sids 选择单店');
          params.profile_id = encodeIds(profiles, properties.profile_id);
        }
        calls.push(params);
      } else if (policy.mode === 'single') {
        if (selected.length !== 1) throw new Error('LINGXING_SINGLE_STORE_REQUIRED: 使用 store_sids 选择单店');
        params[policy.scopeKey] = encodeIds(selected, properties[policy.scopeKey]);
        // Keyword analysis supports either ID; never accept caller-controlled alternate profile.
        if (properties.profile_id && params.profile_id !== undefined) throw new Error('LINGXING_USE_STORE_SID: 请通过店铺 SID 调用');
        calls.push(params);
      } else {
        params[policy.scopeKey] = encodeIds(selected, properties[policy.scopeKey]);
        calls.push(params);
      }
      if (input.toolId === 'advertising_ad_analyze_keyword' && !(Array.isArray(params.asin) && params.asin.length) && !(Array.isArray(params.msku) && params.msku.length)) throw new Error('LINGXING_REQUIRED_PARAM: asin 或 msku 至少传一个');
      for (const call of calls) {
        for (const [key, schema] of Object.entries(properties) as [string, any][]) if (call[key] === undefined && schema.default !== undefined) call[key] = structuredClone(schema.default);
        validate(call, policy.inputSchema, input.toolId);
      }
      appliedParams = calls;
      data = unwrapLingxingResult(await this.mcp.execute({ toolId: input.toolId, params: calls[0]! }));
      assertResponseScope(data, new Set(selected), new Set(profiles), policy.mode === 'profiles');
    }
    const selectedScope: EffectiveStoreScope = { ...scope, lingxing_sids: selected.map(Number), stores: scope.stores.filter(row => selected.includes(String(row.lingxing_sid))), store_ids: scope.stores.filter(row => selected.includes(String(row.lingxing_sid))).map(row => Number(row.id)).filter(Number.isSafeInteger) };
    const result = { source: 'lingxing_mcp', toolId: input.toolId, data, scope: selectedScope,
      evidence: { source: 'lingxing_mcp', queried_at: new Date().toISOString(), authorized_lingxing_sids: scope.lingxing_sids, applied_store_sids: selected.map(Number), applied_profile_ids: profiles, applied_params: appliedParams },
      coverage: { mode: policy.mode === 'shops' ? 'complete_authorized_directory' : 'upstream_response', pagination: '原始分页保留在 data；未验证全量采集，禁止将当前页当作全部', upstream_acquisition_completeness: 'not_verified' } };
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 3_500_000) throw new Error('LINGXING_RESULT_TOO_LARGE: 缩小单页大小或店铺范围');
    return result;
  }
}
