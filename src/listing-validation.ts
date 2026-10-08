import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { buildProductFactBook, normalizeFactQuantity, type ProductFact, type ProductFactBook } from './listing-facts.js';
import { listingDraftSchema, type ListingDraft, type ListingGenerationResult } from './listing-generation.js';
import type { PreparedListingInput } from './listing-input.js';
import type { ListingContentPlan } from './listing-planning.js';
import type { ListingRule, ResolvedListingRules } from './listing-rules.js';

const nonempty = z.string().min(1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s);
export const validationPolicySchema = z.strictObject({
  version: nonempty, updatedOn: date,
  source: z.strictObject({ title: nonempty, reference: nonempty, retrievedOn: date }),
  verification: z.strictObject({ status: z.enum(['pending', 'verified']), note: nonempty }),
  separators: z.array(nonempty).min(1), duplicateFields: z.array(z.enum(['title', 'bullets', 'description', 'searchTerms'])),
  literalAttributes: z.array(z.enum(['brand', 'model'])), quantityLabels: z.record(z.string(), z.array(nonempty).min(1)),
  keywordExpressions: z.array(z.strictObject({ phrase: nonempty, facts: z.array(z.strictObject({ attribute: nonempty, value: nonempty })).min(1) })),
  expressions: z.array(z.strictObject({ attribute: nonempty, value: nonempty, english: z.array(nonempty).min(1) })),
}).superRefine((p, ctx) => {
  if (p.source.retrievedOn > p.updatedOn) ctx.addIssue({ code: 'custom', message: '来源日期晚于策略日期' });
  if (p.separators.some((s) => ![' ', ',', ';', '.', ':', 'and'].includes(s))) ctx.addIssue({ code: 'custom', message: '连接符不得包含否定、选择或其他语义' });
  const keys = p.expressions.map((e) => JSON.stringify([e.attribute, normalize(e.value)]));
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', message: '重复受控表达' });
});
export type ValidationPolicy = z.infer<typeof validationPolicySchema>;
export async function loadValidationPolicy(path: string | URL): Promise<ValidationPolicy> {
  return validationPolicySchema.parse(JSON.parse(await readFile(path, 'utf8')));
}
const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
type FieldName = 'title' | 'bullets' | 'description' | 'searchTerms';
type FieldKey = 'title' | `bullets.${number}` | 'description' | 'searchTerms';
export interface ValidationIssue {
  code: string; severity: 'blocking' | 'verification' | 'advisory'; field: FieldKey | 'task';
  message: string; ruleId?: string; factIds: string[];
}
export interface RuleCheck {
  ruleId: string; field: FieldKey | 'bullets'; outcome: 'satisfied' | 'violated' | 'manual';
  verification: ListingRule['verification']['status']; origin: ListingRule['origin']; measured?: number;
}
export interface ClaimCheck {
  field: FieldKey; start: number; end: number; factIds: string[]; citationValid: boolean;
  support: 'controlled' | 'needs_verification' | 'invalid';
}
export interface ListingValidationResult {
  version: string; validatorVersion: string; policyVersion: string; policySha256: string;
  factVersion: string; planVersion: string; ruleVersion: string; ruleSha256: string; draftSha256: string;
  status: 'invalid' | 'blocked' | 'needs_verification' | 'checked';
  codeChecksPassed: boolean; platformCompliance: 'not_established';
  fields: Array<{ field: FieldKey; status: 'blocked' | 'needs_verification' | 'checked_with_notices' | 'checked'; copyable: boolean }>;
  ruleChecks: RuleCheck[]; claimChecks: ClaimCheck[]; issues: ValidationIssue[];
  metrics: { factualClaimCount: number; citedClaimCount: number; citationCoverage: number | null;
    controlledClaimCount: number; controlledCoverage: number | null; unannotatedSpanCount: number };
}

/** Split controlled grammar only. Full consumption prevents substring-based false approvals. */
function controlledText(value: string, facts: ProductFact[], policy: ValidationPolicy, allowLiteralNames = false): boolean {
  const input = normalize(value);
  const expressions = facts.flatMap((f) => policy.expressions.filter((e) => e.attribute === f.attribute && normalize(e.value) === normalize(f.rawValue)).flatMap((e) => e.english))
    .concat(facts.filter((f) => allowLiteralNames && policy.literalAttributes.includes(f.attribute as 'brand' | 'model')).map((f) => f.rawValue));
  const known = [...new Set(expressions.map(normalize))].filter(Boolean).sort((a, b) => b.length - a.length);
  const separators = policy.separators.map((s) => s === ' ' ? s : normalize(s));
  // Index-based dynamic programming: no regex supplied by external text or recursive backtracking.
  const reachable = new Uint8Array(input.length + 1); reachable[0] = 1;
  let expressionUsed = false;
  for (let at = 0; at < input.length; at++) {
    if (!reachable[at]) continue;
    for (const expr of known) {
      if (input.startsWith(expr, at) && (!/[a-z0-9]/i.test(expr[0] ?? '') || at === 0 || !/[a-z0-9]/i.test(input[at - 1]!))
        && (!/[a-z0-9]/i.test(expr.at(-1) ?? '') || at + expr.length === input.length || !/[a-z0-9]/i.test(input[at + expr.length]!))) {
        reachable[at + expr.length] = 1; expressionUsed = true;
      }
    }
    // No leading separators apart from whitespace; 'and' also requires word boundaries.
    if (at) for (const separator of separators) if (input.startsWith(separator, at)
      && (separator !== 'and' || (input[at - 1] === ' ' && (input[at + 3] === ' ')))) reachable[at + separator.length] = 1;
  }
  return expressionUsed && reachable[input.length] === 1;
}

const sameQuantity = (a: NonNullable<ProductFact['quantity']>, b: NonNullable<ProductFact['quantity']>) =>
  a.dimension === b.dimension && a.unit === b.unit && a.relation === b.relation && JSON.stringify(a.values) === JSON.stringify(b.values);
/** Measurements require their attribute label. Equivalent units cannot move between attributes. */
function controlledQuantity(value: string, facts: ProductFact[], policy: ValidationPolicy): 'supported' | 'mismatch' | 'condition' | 'unknown' {
  const cleaned = value.trim().replace(/[.]$/, '');
  for (const [attribute, labels] of Object.entries(policy.quantityLabels)) for (const label of labels) {
    const prefix = label.toLowerCase() + ': ';
    if (!cleaned.toLowerCase().startsWith(prefix)) continue;
    const quantity = normalizeFactQuantity(cleaned.slice(prefix.length));
    if (!quantity) return 'unknown';
    const fact = facts.find((f) => f.attribute === attribute && f.quantity);
    if (!fact) return 'mismatch';
    if (!sameQuantity(quantity, fact.quantity!)) return 'mismatch';
    if (normalize(quantity.condition) !== normalize(fact.quantity!.condition)) return 'condition';
    return 'supported';
  }
  return 'unknown';
}
function phraseMatches(value: string, phrase: string): boolean {
  const input = normalize(value), needle = normalize(phrase);
  let offset = input.indexOf(needle);
  while (offset >= 0) {
    if ((!/[a-z0-9]/i.test(needle[0] ?? '') || !/[a-z0-9]/i.test(input[offset - 1] ?? ''))
      && (!/[a-z0-9]/i.test(needle.at(-1) ?? '') || !/[a-z0-9]/i.test(input[offset + needle.length] ?? ''))) return true;
    offset = input.indexOf(needle, offset + 1);
  }
  return false;
}

/** Pure, deterministic, no model/tool/network access. Policies are host deployment inputs. */
export function validateListingDraft(raw: unknown, prepared: PreparedListingInput, book: ProductFactBook, plan: ListingContentPlan,
  rules: ResolvedListingRules, rawPolicy: unknown): ListingValidationResult {
  const policy = validationPolicySchema.parse(rawPolicy);
  const issues: ValidationIssue[] = [], ruleChecks: RuleCheck[] = [], claimChecks: ClaimCheck[] = [];
  const add = (code: string, severity: ValidationIssue['severity'], field: ValidationIssue['field'], message: string, factIds: string[] = [], ruleId?: string) =>
    issues.push({ code, severity, field, message, factIds, ...(ruleId ? { ruleId } : {}) });
  const parsed = listingDraftSchema.safeParse(raw);
  let draftHash: string;
  try { draftHash = hash(JSON.stringify(raw) ?? 'undefined'); } catch { draftHash = hash('non_serializable'); }
  const base = { validatorVersion: 'listing-validator-v1', policyVersion: policy.version, policySha256: hash(JSON.stringify(policy)),
    factVersion: book.version, planVersion: plan.version, ruleVersion: rules.version, ruleSha256: rules.sha256, draftSha256: draftHash };
  let invalid = false, unannotatedSpanCount = 0;
  const fieldKeys: FieldKey[] = [];
  const scope = (item: ProductFactBook | PreparedListingInput | ListingContentPlan) => JSON.stringify([item.requestId, item.owner, item.surface]);
  if (scope(prepared) !== scope(book) || scope(book) !== scope(plan) || plan.factVersion !== book.version
    || prepared.input.marketplace !== rules.marketplace || prepared.input.language !== rules.language
    || (rules.productType && rules.productType !== prepared.input.productType)) {
    invalid = true; add('scope_mismatch', 'blocking', 'task', '任务、用户、会话、事实版本或规则范围不一致。');
  }
  let rebuilt: ProductFactBook | undefined;
  try { rebuilt = buildProductFactBook(prepared); } catch { /* Invalid task sources fail closed below. */ }
  if (!rebuilt || JSON.stringify(rebuilt) !== JSON.stringify(book)) {
    invalid = true; add('source_integrity', 'blocking', 'task', '事实表与当前任务原始资料不一致，不能用模型修改过的事实充当证据。');
  }
  if (!parsed.success) { invalid = true; add('invalid_structure', 'blocking', 'task', 'Listing 结构无效，不能导出最终文案。'); }
  if (!invalid && parsed.success) {
    const draft = parsed.data;
    const facts = new Map(book.facts.map((f) => [f.id, f]));
    if (book.status === 'needs_sources' || book.status === 'needs_clarification') add('input_incomplete', 'blocking', 'task', '本品资料仍缺失或冲突。');
    if (policy.verification.status === 'pending') add('expression_policy_pending', 'verification', 'task', policy.verification.note);
    if (rules.coverage !== 'product_type_verified' || rules.notices.length) add('rules_not_fully_verified', 'verification', 'task', '配置规则或具体产品类型尚未完整核实，不能宣称平台合规。');
    const entries: Array<{ field: FieldKey; group: FieldName; text: string; claims: ListingDraft['title']['claims'] }> = [
      { field: 'title', group: 'title', ...draft.title }, ...draft.bullets.map((b, i) => ({ field: `bullets.${i}` as FieldKey, group: 'bullets' as const, ...b })),
      { field: 'description', group: 'description', ...draft.description }, { field: 'searchTerms', group: 'searchTerms', text: draft.searchTerms.text, claims: [] },
    ];
    const refsValid = (ids: string[]) => ids.length > 0 && new Set(ids).size === ids.length && ids.every((id) => facts.get(id)?.status === 'usable');
    for (const entry of entries) {
      fieldKeys.push(entry.field);
      if (!entry.text.trim() && entry.group !== 'searchTerms') add('empty_field', 'blocking', entry.field, '字段不能为空。');
      // Literal occurrences of a proven user-provided brand qualify for the configured character exception.
      const brands = book.facts.filter((f) => f.attribute === 'brand' && f.status === 'usable' && f.trust === 'user_provided');
      for (const rule of rules.rules.filter((r) => r.field === entry.group && r.check.kind !== 'item_count')) {
        let violated = false; let measured: number | undefined;
        switch (rule.check.kind) {
          case 'length':
            measured = rule.check.unit === 'utf8_bytes' ? Buffer.byteLength(entry.text, 'utf8') : [...entry.text].length;
            violated = rule.check.comparison === 'less_than' ? measured >= rule.check.limit : measured > rule.check.limit; break;
          case 'forbidden_phrases': violated = rule.check.phrases.some((p) => phraseMatches(entry.text, p)); break;
          case 'forbidden_characters': {
            let value = entry.text;
            if (rule.check.exception === 'brand_name') for (const brand of brands) {
              // Replace only exact whole brand occurrences; never erase an embedded substring.
              const spans: [number, number][] = []; let at = value.indexOf(brand.rawValue);
              while (at >= 0) {
                if (!/[a-z0-9]/i.test(value[at - 1] ?? '') && !/[a-z0-9]/i.test(value[at + brand.rawValue.length] ?? '')) spans.push([at, at + brand.rawValue.length]);
                at = value.indexOf(brand.rawValue, at + 1);
              }
              for (const [start, end] of spans.reverse()) value = value.slice(0, start) + ' '.repeat(end - start) + value.slice(end);
            }
            violated = rule.check.characters.some((char) => value.includes(char)); break;
          }
          case 'word_repetition': {
            const words = entry.text.toLowerCase().match(/[a-z]+(?:'[a-z]+)*/g) ?? [];
            const counts = new Map<string, number>();
            for (const word of words) if (!rule.check.exceptions.some((e) => e.toLowerCase() === word)) counts.set(word, (counts.get(word) ?? 0) + 1);
            measured = Math.max(0, ...counts.values()); violated = measured > rule.check.maxOccurrences; break;
          }
          case 'manual_check':
            ruleChecks.push({ ruleId: rule.id, field: entry.field, outcome: 'manual', verification: rule.verification.status, origin: rule.origin });
            add('manual_rule', 'verification', entry.field, rule.check.guidance, [], rule.id); continue;
          default: throw new Error('LISTING_VALIDATOR_UNSUPPORTED_RULE');
        }
        ruleChecks.push({ ruleId: rule.id, field: entry.field, outcome: violated ? 'violated' : 'satisfied', verification: rule.verification.status, origin: rule.origin, ...(measured === undefined ? {} : { measured }) });
        if (violated) add('rule_violation', rule.severity === 'blocking' ? 'blocking' : 'advisory', entry.field, rule.description, [], rule.id);
        if (rule.verification.status === 'pending') add('rule_pending', 'verification', entry.field, rule.verification.note, [], rule.id);
      }
      if (entry.group === 'searchTerms') continue;
      let priorEnd = 0;
      for (const claim of [...entry.claims].sort((a, b) => a.start - b.start)) {
        const valid = refsValid(claim.factIds) && claim.end > claim.start && claim.start >= priorEnd && claim.end <= entry.text.length
          && entry.text.slice(claim.start, claim.end) === claim.text
          && !(/[\uDC00-\uDFFF]/.test(entry.text[claim.start] ?? '') || /[\uD800-\uDBFF]/.test(entry.text[claim.end - 1] ?? ''));
        if (!valid) {
          add('invalid_citation', 'blocking', entry.field, '引用缺失、冲突、重叠或短语范围错误。', claim.factIds);
          claimChecks.push({ field: entry.field, start: claim.start, end: claim.end, factIds: claim.factIds, citationValid: false, support: 'invalid' });
          continue;
        }
        const gap = entry.text.slice(priorEnd, claim.start);
        if (/[^\s.,;:]/u.test(gap)) { unannotatedSpanCount++; add('unannotated_text', 'blocking', entry.field, '存在未标注出处的文字，不能假定它不含事实性声明。'); }
        priorEnd = claim.end;
        const cited = claim.factIds.map((id) => facts.get(id)!);
        const quantity = controlledQuantity(claim.text, cited, policy);
        let supported = controlledText(claim.text, cited, policy, entry.group === 'title') || quantity === 'supported';
        const digits = (s: string) => s.normalize('NFKC').toLowerCase().match(/\d+(?:\.\d+)?/g) ?? [];
        const rawNumbers = new Set(cited.flatMap((f) => digits(f.rawValue)));
        const numericMismatch = quantity !== 'supported' && digits(claim.text).some((number) => !rawNumbers.has(number));
        if (quantity === 'mismatch' || quantity === 'condition' || numericMismatch) {
          supported = false; add(quantity === 'condition' ? 'condition_mismatch' : 'numeric_mismatch', 'blocking', entry.field, '数值、单位、属性、范围/上限/近似关系或限定条件与原始事实不一致。', claim.factIds);
        } else if (!supported) add('unsupported_expression', 'verification', entry.field, '表达未匹配本品对应属性的完整受控事实表达，含数字时也不能凭数字相同判定支持。', claim.factIds);
        if (cited.some((f) => f.trust === 'page_unverified')) { supported = false; add('page_unverified', 'verification', entry.field, '页面来源声明未经独立核实。', claim.factIds); }
        claimChecks.push({ field: entry.field, start: claim.start, end: claim.end, factIds: claim.factIds, citationValid: true, support: supported ? 'controlled' : 'needs_verification' });
      }
      if (/[^\s.,;:]/u.test(entry.text.slice(priorEnd))) { unannotatedSpanCount++; add('unannotated_text', 'blocking', entry.field, '存在未标注出处的文字。'); }
    }
    for (const rule of rules.rules.filter((r) => r.check.kind === 'item_count')) {
      if (rule.check.kind !== 'item_count') continue;
      const violated = draft.bullets.length !== rule.check.count;
      ruleChecks.push({ ruleId: rule.id, field: 'bullets', outcome: violated ? 'violated' : 'satisfied', verification: rule.verification.status, origin: rule.origin, measured: draft.bullets.length });
      if (violated) for (const entry of entries.filter((e) => e.group === 'bullets')) add('rule_violation', rule.severity === 'blocking' ? 'blocking' : 'advisory', entry.field, rule.description, [], rule.id);
      if (rule.verification.status === 'pending') add('rule_pending', 'verification', 'task', rule.verification.note, [], rule.id);
    }
    for (const group of policy.duplicateFields) {
      const seen = new Map<string, FieldKey>();
      for (const entry of entries.filter((e) => e.group === group && e.text.trim())) {
        const key = normalize(entry.text); const prior = seen.get(key);
        if (prior) { add('duplicate_content', 'blocking', prior, '存在重复文案。'); add('duplicate_content', 'blocking', entry.field, '存在重复文案。'); }
        seen.set(key, entry.field);
      }
    }
    const search = draft.searchTerms;
    if (search.text.trim() || search.factIds.length || search.keywordRefs.length) {
      const eligible = new Map(plan.keywords.filter((k) => k.status === 'eligible').map((k) => [k.keyword, k]));
      const refs = search.keywordRefs.map((keyword) => eligible.get(keyword));
      const allowedFacts = new Set(refs.flatMap((k) => k?.factIds ?? []));
      const valid = refsValid(search.factIds) && search.keywordRefs.length > 0 && new Set(search.keywordRefs).size === search.keywordRefs.length
        && refs.every((k) => k && k.factIds.length && k.factIds.every((id) => search.factIds.includes(id)))
        && search.factIds.every((id) => allowedFacts.has(id));
      const words = search.text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
      const expected = search.keywordRefs.join(' ').toLowerCase().match(/[a-z0-9]+/g) ?? [];
      const bag = (tokens: string[]) => JSON.stringify([...new Set(tokens)].sort());
      const supported = valid && refs.every((k) => {
        if (!k || k.factIds.some((id) => facts.get(id)?.trust !== 'user_provided')) return false;
        const ownFacts = k.factIds.map((id) => facts.get(id)!).filter(Boolean);
        return controlledText(k.keyword, ownFacts, policy) || policy.keywordExpressions.some((expression) => normalize(expression.phrase) === normalize(k.keyword)
          && expression.facts.every((guard) => ownFacts.some((f) => f.attribute === guard.attribute && normalize(f.rawValue) === normalize(guard.value))));
      })
        && words.length > 0 && /^[a-z0-9\s]+$/i.test(search.text) && bag(words) === bag(expected);
      if (!valid) add('invalid_search_reference', 'blocking', 'searchTerms', '搜索词必须由有效本品关键词和对应全部事实支持。', search.factIds);
      if (!supported) add('unsupported_search_terms', 'verification', 'searchTerms', '搜索词包含未由所引用关键词支持的词、数值或符号。', search.factIds);
      if (new Set(words).size !== words.length) add('search_terms_repeated', 'advisory', 'searchTerms', '后台搜索词有重复词，建议去重。');
      claimChecks.push({ field: 'searchTerms', start: 0, end: search.text.length, factIds: search.factIds, citationValid: valid, support: supported ? 'controlled' : 'needs_verification' });
    }
    for (const note of [...draft.changes, ...draft.verificationItems]) if (new Set(note.factIds).size !== note.factIds.length || note.factIds.some((id) => !facts.has(id))) add('invalid_note_reference', 'blocking', 'task', '修改原因或核实项引用不存在的事实。', note.factIds);
    if (draft.verificationItems.length) add('draft_verification_items', 'verification', 'task', '草稿包含需要额外补资料或判断的事项，不能宣称全部问题已解决。');
  }
  const taskBlocked = issues.some((i) => i.field === 'task' && i.severity === 'blocking');
  const fields = fieldKeys.map((field) => {
    const specific = issues.filter((i) => i.field === field);
    const blocked = taskBlocked || specific.some((i) => i.severity === 'blocking');
    const pending = specific.some((i) => i.severity === 'verification');
    const status = blocked ? 'blocked' as const : pending ? 'needs_verification' as const
      : issues.some((i) => i.field === 'task' || i.field === field) ? 'checked_with_notices' as const : 'checked' as const;
    return { field, status, copyable: !blocked && !pending };
  });
  const factualClaimCount = claimChecks.length + unannotatedSpanCount;
  const citedClaimCount = claimChecks.filter((c) => c.citationValid).length;
  const controlledClaimCount = claimChecks.filter((c) => c.support === 'controlled').length;
  const codeChecksPassed = !issues.some((i) => i.severity === 'blocking');
  const status: ListingValidationResult['status'] = invalid ? 'invalid' : !codeChecksPassed ? 'blocked' : issues.some((i) => i.severity === 'verification') ? 'needs_verification' : 'checked';
  const payload = { ...base, status, codeChecksPassed, platformCompliance: 'not_established' as const, fields, ruleChecks, claimChecks, issues,
    metrics: { factualClaimCount, citedClaimCount, citationCoverage: factualClaimCount ? citedClaimCount / factualClaimCount : null,
      controlledClaimCount, controlledCoverage: factualClaimCount ? controlledClaimCount / factualClaimCount : null, unannotatedSpanCount } };
  return { ...payload, version: hash(JSON.stringify(payload)) };
}

/** Prevent a successful generation receipt from authorizing a changed draft or stale rule set. */
export function validateListingGeneration(result: ListingGenerationResult, prepared: PreparedListingInput, book: ProductFactBook,
  plan: ListingContentPlan, rules: ResolvedListingRules, policy: unknown): ListingValidationResult {
  if (result.status !== 'draft_unvalidated') return validateListingDraft(null, prepared, book, plan, rules, policy);
  const valid = result.metadata.factVersion === book.version && result.metadata.planVersion === plan.version
    && result.metadata.ruleSha256 === rules.sha256 && result.metadata.ruleVersion === rules.version
    && result.metadata.requestId === prepared.requestId && JSON.stringify(result.metadata.owner) === JSON.stringify(prepared.owner)
    && JSON.stringify(result.metadata.surface) === JSON.stringify(prepared.surface)
    && result.version === hash(JSON.stringify({ draft: result.draft, metadata: result.metadata }));
  return validateListingDraft(valid ? result.draft : null, prepared, book, plan, rules, policy);
}
