import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const text = z.string().trim().min(1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, '日期无效');
const sourceSchema = z.strictObject({
  title: text, reference: text, publishedOn: date.nullable(), retrievedOn: date,
}).superRefine((source, ctx) => {
  if (source.publishedOn && source.publishedOn > source.retrievedOn) {
    ctx.addIssue({ code: 'custom', message: '发布日期不能晚于来源查阅日期' });
  }
});
const verificationSchema = z.strictObject({
  status: z.enum(['pending', 'verified']), note: text,
  verifiedBy: text.optional(), verifiedOn: date.optional(),
}).superRefine((value, ctx) => {
  if (value.status === 'verified' && (!value.verifiedBy || !value.verifiedOn)) {
    ctx.addIssue({ code: 'custom', message: '已核实记录必须包含核实人和日期' });
  }
  if (value.status === 'pending' && (value.verifiedBy || value.verifiedOn)) {
    ctx.addIssue({ code: 'custom', message: '待核实记录不能携带已核实凭据' });
  }
});
const fields = z.enum(['title', 'bullets', 'description', 'searchTerms']);
const checkSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('length'), unit: z.enum(['unicode_code_points', 'utf8_bytes']), limit: z.number().int().positive(), comparison: z.enum(['at_most', 'less_than']), includeSpaces: z.literal(true) }),
  z.strictObject({ kind: z.literal('item_count'), count: z.number().int().positive() }),
  z.strictObject({ kind: z.literal('forbidden_characters'), characters: z.array(z.string().refine((value) => [...value].length === 1, '必须为单个 Unicode 字符')).min(1), exception: z.enum(['none', 'brand_name']) }),
  z.strictObject({ kind: z.literal('forbidden_phrases'), phrases: z.array(text).min(1), matching: z.literal('case_insensitive_phrase') }),
  z.strictObject({ kind: z.literal('word_repetition'), maxOccurrences: z.number().int().positive(), exceptions: z.array(text), tokenization: z.literal('english_words') }),
  z.strictObject({ kind: z.literal('manual_check'), guidance: text }),
]);
const ruleSchema = z.strictObject({
  id: text, origin: z.enum(['platform', 'editorial']), field: fields,
  severity: z.enum(['blocking', 'advisory']), description: text,
  effectiveOn: date.nullable(), source: sourceSchema, verification: verificationSchema,
  check: checkSchema,
}).superRefine((rule, ctx) => {
  if (rule.origin === 'platform') {
    let official = false;
    try {
      const url = new URL(rule.source.reference);
      official = url.protocol === 'https:' && !url.username && !url.password && !url.port
        && (url.hostname === 'sellercentral.amazon.com' || url.hostname === 'sell.amazon.com' || url.hostname === 'm.media-amazon.com');
    } catch { /* Invalid references fail closed. */ }
    if (!official) ctx.addIssue({ code: 'custom', path: ['source', 'reference'], message: '平台规则需要受支持的 Amazon 官方 HTTPS 来源' });
  }
  if (rule.check.kind === 'item_count' && rule.field !== 'bullets') {
    ctx.addIssue({ code: 'custom', path: ['check'], message: '条数检查仅用于 bullets' });
  }
  if (rule.verification.verifiedOn && rule.verification.verifiedOn < rule.source.retrievedOn) {
    ctx.addIssue({ code: 'custom', path: ['verification'], message: '核实日期不能早于来源查阅日期' });
  }
});

export const listingRulesSchema = z.strictObject({
  schemaVersion: z.literal(1), version: text, marketplace: z.literal('US'), language: z.literal('en'),
  updatedOn: date,
  rules: z.array(ruleSchema).min(1),
  productTypes: z.array(z.strictObject({
    id: text, source: sourceSchema, verification: verificationSchema,
    overrides: z.array(ruleSchema),
  })),
}).superRefine((config, ctx) => {
  const ids = new Set<string>();
  for (const rule of config.rules) {
    if (ids.has(rule.id)) ctx.addIssue({ code: 'custom', message: `重复规则 ID：${rule.id}` });
    ids.add(rule.id);
    if (rule.source.retrievedOn > config.updatedOn || (rule.verification.verifiedOn && rule.verification.verifiedOn > config.updatedOn)) {
      ctx.addIssue({ code: 'custom', message: `规则日期晚于配置更新日期：${rule.id}` });
    }
    if (rule.effectiveOn && rule.effectiveOn > config.updatedOn) {
      ctx.addIssue({ code: 'custom', message: `尚未生效规则不能进入当前配置：${rule.id}` });
    }
  }
  const types = new Set<string>();
  for (const type of config.productTypes) {
    if (types.has(type.id)) ctx.addIssue({ code: 'custom', message: `重复产品类型：${type.id}` });
    types.add(type.id);
    if (type.source.retrievedOn > config.updatedOn || (type.verification.verifiedOn && type.verification.verifiedOn > config.updatedOn)) {
      ctx.addIssue({ code: 'custom', message: `产品类型日期晚于配置更新日期：${type.id}` });
    }
    if (type.verification.status === 'verified' && !type.source.reference.startsWith('https://sellercentral.amazon.com/')) {
      ctx.addIssue({ code: 'custom', message: `已核实产品类型需要 Seller Central 来源：${type.id}` });
    }
    const overridden = new Set<string>();
    for (const rule of type.overrides) {
      const base = config.rules.find((item) => item.id === rule.id);
      if (!base || base.field !== rule.field || base.check.kind !== rule.check.kind || base.origin !== rule.origin) {
        ctx.addIssue({ code: 'custom', message: `覆盖必须指向相同字段、来源类型和检查类型的基础规则：${rule.id}` });
      }
      if (overridden.has(rule.id)) ctx.addIssue({ code: 'custom', message: `重复覆盖：${rule.id}` });
      overridden.add(rule.id);
      if (rule.source.retrievedOn > config.updatedOn || (rule.verification.verifiedOn && rule.verification.verifiedOn > config.updatedOn)) {
        ctx.addIssue({ code: 'custom', message: `覆盖规则日期晚于配置更新日期：${rule.id}` });
      }
      if (rule.effectiveOn && rule.effectiveOn > config.updatedOn) {
        ctx.addIssue({ code: 'custom', message: `尚未生效覆盖不能进入当前配置：${rule.id}` });
      }
    }
  }
});

export type ListingRulesConfig = z.infer<typeof listingRulesSchema>;
export type ListingRule = ListingRulesConfig['rules'][number];
export interface ResolvedListingRules {
  version: string;
  sha256: string;
  marketplace: 'US';
  language: 'en';
  productType?: string;
  coverage: 'general_only' | 'product_type_pending' | 'product_type_verified';
  rules: ListingRule[];
  notices: Array<{ code: 'product_type_missing' | 'product_type_unknown' | 'product_type_pending' | 'rules_pending' | 'manual_checks_required'; message: string; ruleIds: string[] }>;
}

/** Parse trusted deployment configuration only; not model or external document content. */
export function parseListingRules(value: unknown): ListingRulesConfig {
  return listingRulesSchema.parse(value);
}

/** Host selects a configuration path. No network or model call; no fallback on errors. */
export async function loadListingRules(path: string | URL): Promise<ListingRulesConfig> {
  return parseListingRules(JSON.parse(await readFile(path, 'utf8')));
}

export function resolveListingRules(raw: unknown, target: { marketplace: string; language: string; productType?: string }): ResolvedListingRules {
  const config = parseListingRules(raw);
  if (target.marketplace !== config.marketplace || target.language !== config.language) throw new Error('LISTING_RULES_TARGET_UNSUPPORTED');
  const productType = target.productType?.trim();
  const type = config.productTypes.find((item) => item.id === productType);
  const replacements = new Map(type?.overrides.map((rule) => [rule.id, rule]) ?? []);
  const rules = config.rules.map((rule) => structuredClone(replacements.get(rule.id) ?? rule));
  const notices: ResolvedListingRules['notices'] = [];
  if (!productType) notices.push({ code: 'product_type_missing', message: '未确定具体产品类型，仅加载通用规则；类目要求待核实。', ruleIds: [] });
  else if (!type) notices.push({ code: 'product_type_unknown', message: '配置中没有此产品类型的规则，不能宣称类目检查完整。', ruleIds: [] });
  else if (type.verification.status === 'pending') notices.push({ code: 'product_type_pending', message: '产品类型规则待核实。', ruleIds: type.overrides.map((rule) => rule.id) });
  const pending = rules.filter((rule) => rule.verification.status === 'pending');
  if (pending.length) notices.push({ code: 'rules_pending', message: '存在待核实规则；检查这些规则不代表已证明最新平台合规。', ruleIds: pending.map((rule) => rule.id) });
  const manual = rules.filter((rule) => rule.check.kind === 'manual_check');
  if (manual.length) notices.push({ code: 'manual_checks_required', message: '部分要求不能用当前代码自动判定，需在交付中明确列出。', ruleIds: manual.map((rule) => rule.id) });
  const coverage = !type ? 'general_only' : type.verification.status === 'verified' ? 'product_type_verified' : 'product_type_pending';
  return { version: config.version,
    sha256: createHash('sha256').update(JSON.stringify({ config, productType: productType ?? null })).digest('hex'),
    marketplace: 'US', language: 'en', ...(productType ? { productType } : {}), coverage, rules, notices };
}
