import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { prepareListingInput } from '../src/listing-input.js';
import { buildProductFactBook } from '../src/listing-facts.js';
import { buildListingContentPlan } from '../src/listing-planning.js';
import { resolveListingRules, type ResolvedListingRules } from '../src/listing-rules.js';
import { ListingGenerationService, type ListingDraft } from '../src/listing-generation.js';
import type { ListingResearchResult } from '../src/listing-research.js';
import { loadValidationPolicy, validationPolicySchema, validateListingDraft, validateListingGeneration } from '../src/listing-validation.js';

const json = (name: string) => JSON.parse(readFileSync(new URL('../config/' + name, import.meta.url), 'utf8'));
const policy = json('listing-validation.json');
const sample = readFileSync(new URL('../examples/listing/camera-product.txt', import.meta.url), 'utf8');
function fixture(content = sample, page = false) {
  const prepared = prepareListingInput({ mode: page ? 'optimize' : 'create', ...(page ? { asin: 'B0TEST0001' } : {}),
    keywords: ['indoor security camera', '2k camera'],
    materials: [{ id: 'm', kind: page ? 'listing' : 'conversation', reference: page ? 'B0TEST0001' : 'm', content }] }, {
    request: { requestId: 'r', messageId: 'm', text: page ? 'Optimize ASIN B0TEST0001' : content,
      user: { corpId: 'c', userId: 'u' }, surface: { type: 'group', id: 'g' }, attachments: [] },
    documentSnapshots: {}, listingSnapshots: page ? { B0TEST0001: content } : {},
  });
  const book = buildProductFactBook(prepared);
  const research: ListingResearchResult = { owner: book.owner, surface: book.surface, requestId: book.requestId, policyVersion: 'test', status: 'partial',
    competitors: [], rejectedCandidates: [], evidence: [], gaps: [], salesClaims: 'public_signals_only_not_verified_sales',
    keywordSignals: prepared.input.keywords.map((keyword) => ({ keyword, source: 'user', volume: null })) };
  const plan = buildListingContentPlan(book, research, json('listing-planning.json'));
  // Isolated semantic-test rules. The real pending platform configuration is tested separately.
  const rules: ResolvedListingRules = { ...resolveListingRules(json('listing-rules.us-en.json'), { marketplace: 'US', language: 'en' }),
    coverage: 'product_type_verified', notices: [], rules: [] };
  const testPolicy = { ...policy, verification: { status: 'verified', note: 'Synthetic unit-test policy; not platform approval.' } };
  const id = (attribute: string) => book.facts.find((f) => f.attribute === attribute)!.id;
  const field = (text: string, attributes: string[]) => ({ text, claims: [{ text, start: 0, end: text.length, factIds: attributes.map(id) }] });
  const draft: ListingDraft = {
    title: field('ExampleBrand C1 2K Indoor Security Camera', ['brand', 'model', 'resolution', 'product_type']),
    bullets: [field('2K resolution', ['resolution']), field('USB wired power', ['power']),
      field('Infrared night vision; color night vision is not specified', ['night_vision']),
      field('Supports microSD storage; card sold separately', ['storage']), field('Cloud storage requires a paid subscription', ['subscription'])],
    description: field('Indoor installation requires a power connection. Includes camera, power cable and manual; storage card not included.', ['installation', 'package']),
    searchTerms: { text: '', keywordRefs: [], factIds: [] }, changes: [], verificationItems: [],
  };
  const check = () => validateListingDraft(draft, prepared, book, plan, rules, testPolicy);
  const oneRule = (ruleId: string) => { rules.rules = structuredClone(json('listing-rules.us-en.json').rules.filter((r: any) => r.id === ruleId)); };
  return { prepared, book, plan, rules, testPolicy, draft, id, field, check, oneRule };
}

describe('Listing module 7: pure-code validator', () => {
  it('loads the sourced and dated policy', async () => expect(await loadValidationPolicy(new URL('../config/listing-validation.json', import.meta.url))).toEqual(policy));
  it('rejects invalid policy dates', () => expect(() => validationPolicySchema.parse({ ...policy, updatedOn: '2026-02-30' })).toThrow());
  it('rejects semantic connectors and extra action fields in policy', () => {
    expect(() => validationPolicySchema.parse({ ...policy, separators: ['not'] })).toThrow();
    expect(() => validationPolicySchema.parse({ ...policy, execute: 'DWS' })).toThrow();
  });
  it('checks controlled composition with exact raw facts and exclusions', () => {
    const { check } = fixture(); const result = check();
    expect(result.status).toBe('checked'); expect(result.codeChecksPassed).toBe(true);
    expect(result.metrics.citationCoverage).toBe(1); expect(result.metrics.controlledCoverage).toBe(1);
    expect(result.fields.every((f) => f.copyable)).toBe(true); expect(result.platformCompliance).toBe('not_established');
  });
  it('does not count pending policy/rules as fully checked', () => {
    const { draft, prepared, book, plan } = fixture();
    const rules = resolveListingRules(json('listing-rules.us-en.json'), { marketplace: 'US', language: 'en' });
    const result = validateListingDraft(draft, prepared, book, plan, rules, policy);
    expect(result.status).toBe('needs_verification');
    expect(result.ruleChecks.some((r) => r.outcome === 'satisfied' && r.verification === 'pending')).toBe(true);
    expect(result.fields.every((f) => !f.copyable)).toBe(true);
  });
  it.each(['Waterproof Indoor Camera', 'not USB wired power', 'USB wired power without subscription', 'USB wired power or battery power'])('does not approve invented or contradictory phrase: %s', (text) => {
    const { check, draft, field } = fixture(); draft.bullets[1] = field(text, ['power']);
    expect(check().issues.some((i) => i.code === 'unsupported_expression')).toBe(true); expect(check().fields.find((f) => f.field === 'bullets.1')?.copyable).toBe(false);
  });
  it.each([
    ['Supports microSD storage', 'storage'], ['Cloud storage', 'subscription'], ['Includes camera, power cable and manual', 'package'],
    ['Indoor installation', 'installation'], ['Infrared night vision', 'night_vision'],
  ])('retains condition for %s', (text, attribute) => {
    const { check, draft, field } = fixture(); draft.bullets[0] = field(text, [attribute]);
    expect(check().issues.some((i) => i.code === 'unsupported_expression')).toBe(true);
  });
  it('blocks changed opaque numeric resolutions', () => {
    const { check, draft, field } = fixture(); draft.bullets[0] = field('4K resolution', ['resolution']);
    expect(check().issues.some((i) => i.code === 'numeric_mismatch' && i.severity === 'blocking')).toBe(true);
  });
  it('does not bind a correct number to the wrong fact attribute', () => {
    const { check, draft, field } = fixture(); draft.bullets[0] = field('Battery life: 350 hours', ['weight']);
    expect(check().issues.some((i) => i.code === 'numeric_mismatch')).toBe(true);
  });
  it.each(['Weight: 350 g', 'Weight: 0.35 kg', 'Weight: 350.000 g'])('accepts exact unit equivalence for %s', (text) => {
    const { check, draft, field } = fixture(); draft.bullets[0] = field(text, ['weight']);
    expect(check().claimChecks.find((c) => c.field === 'bullets.0')?.support).toBe('controlled');
  });
  it.each(['Weight: 350 kg', 'Weight: 351 g', 'Weight: 350 hours', 'Weight: up to 350 g'])('blocks quantity or relation mismatch: %s', (text) => {
    const { check, draft, field } = fixture(); draft.bullets[0] = field(text, ['weight']);
    expect(check().issues.some((i) => i.code === 'numeric_mismatch')).toBe(true);
  });
  it('keeps unsupported units as verification rather than guessing', () => {
    const { check, draft, field } = fixture(); draft.bullets[0] = field('Weight: 350 oz', ['weight']);
    expect(check().issues.some((i) => i.code === 'unsupported_expression')).toBe(true);
  });
  it('preserves a measurement upper bound and condition verbatim', () => {
    const { check, draft, field } = fixture(sample + '\n续航：up to 8 h under room temperature');
    draft.bullets[0] = field('Battery life: up to 480 minutes under room temperature', ['battery_life']);
    expect(check().claimChecks.find((c) => c.field === 'bullets.0')?.support).toBe('controlled');
    draft.bullets[0] = field('Battery life: up to 8 h', ['battery_life']);
    expect(check().issues.some((i) => i.code === 'condition_mismatch')).toBe(true);
    draft.bullets[0] = field('Battery life: 8 h under room temperature', ['battery_life']);
    expect(check().issues.some((i) => i.code === 'numeric_mismatch')).toBe(true);
  });
  it('preserves ranges instead of treating the upper endpoint as an exact value', () => {
    const { check, draft, field } = fixture(sample + '\n长度：10-20 cm');
    draft.bullets[0] = field('Length: 100-200 mm', ['length']);
    expect(check().claimChecks.find((c) => c.field === 'bullets.0')?.support).toBe('controlled');
    draft.bullets[0] = field('Length: 20 cm', ['length']); expect(check().issues.some((i) => i.code === 'numeric_mismatch')).toBe(true);
  });
  it('rejects tampered raw fact values despite retaining a real fact ID', () => {
    const { check, book } = fixture(); book.facts.find((f) => f.attribute === 'resolution')!.rawValue = '4K';
    expect(check().status).toBe('invalid'); expect(check().issues.some((i) => i.code === 'source_integrity')).toBe(true);
  });
  it('rejects tampered source material hashes', () => {
    const { check, prepared } = fixture(); prepared.input.materials[0]!.content += '\n重量：999 g';
    expect(check().status).toBe('invalid');
  });
  it('rejects a stale or cross-user plan', () => {
    const { check, plan } = fixture(); plan.owner = { ...plan.owner, userId: 'other' };
    expect(check().issues.some((i) => i.code === 'scope_mismatch')).toBe(true);
  });
  it.each(['unknown', 'duplicate', 'overlap', 'span'])('rejects %s citation corruption', (kind) => {
    const { check, draft } = fixture(); const claim = draft.title.claims[0]!;
    if (kind === 'unknown') claim.factIds = ['competitor-fact'];
    if (kind === 'duplicate') claim.factIds.push(claim.factIds[0]!);
    if (kind === 'overlap') draft.title.claims.push({ ...claim });
    if (kind === 'span') claim.end--;
    expect(check().issues.some((i) => i.code === 'invalid_citation')).toBe(true);
  });
  it('does not ignore uncited text outside an otherwise supported claim', () => {
    const { check, draft } = fixture(); draft.bullets[1]!.text += ' Guaranteed protection.';
    expect(check().issues.some((i) => i.code === 'unannotated_text')).toBe(true); expect(check().metrics.citationCoverage).toBeLessThan(1);
  });
  it('recognizes page claims but never treats them as independently supported', () => {
    const { check } = fixture(sample, true);
    expect(check().issues.some((i) => i.code === 'page_unverified')).toBe(true); expect(check().metrics.controlledCoverage).toBe(0);
  });
  it.each([199, 200, 201])('checks inclusive title length %s using configured limits', (length) => {
    const { check, draft, oneRule } = fixture(); oneRule('title-length'); draft.title.text = 'A'.repeat(length);
    expect(check().ruleChecks[0]).toMatchObject({ measured: length, outcome: length > 200 ? 'violated' : 'satisfied' });
  });
  it('counts emoji by Unicode code point rather than UTF-16 code units', () => {
    const { check, draft, oneRule } = fixture(); oneRule('title-length'); draft.title.text = '😀'.repeat(200);
    expect(check().ruleChecks[0]).toMatchObject({ measured: 200, outcome: 'satisfied' });
  });
  it.each([249, 250, 251])('checks strict search-term UTF-8 limit %s', (bytes) => {
    const { check, draft, oneRule } = fixture(); oneRule('search-terms-length'); draft.searchTerms.text = 'a'.repeat(bytes);
    expect(check().ruleChecks[0]).toMatchObject({ measured: bytes, outcome: bytes >= 250 ? 'violated' : 'satisfied' });
  });
  it('counts multibyte search terms in bytes', () => {
    const { check, draft, oneRule } = fixture(); oneRule('search-terms-length'); draft.searchTerms.text = '摄像头';
    expect(check().ruleChecks[0]?.measured).toBe(9);
  });
  it('checks configured five-point count', () => {
    const { check, draft, oneRule } = fixture(); oneRule('bullet-count'); expect(check().ruleChecks[0]?.outcome).toBe('satisfied');
    draft.bullets.pop(); expect(check().ruleChecks[0]?.outcome).toBe('violated');
  });
  it('finds forbidden phrases regardless of case without substring false positives', () => {
    const { check, draft, field, oneRule } = fixture(); oneRule('bullet-refund-phrases');
    draft.bullets[0] = field('MONEY BACK GUARANTEE', ['power']); expect(check().ruleChecks[0]?.outcome).toBe('violated');
    draft.bullets[0] = field('xmoney back guaranteex', ['power']); expect(check().ruleChecks[0]?.outcome).toBe('satisfied');
  });
  it('applies the brand exception only to exact proven whole brand occurrences', () => {
    const { check, draft, field, oneRule } = fixture(sample.replace('ExampleBrand', 'Example!Brand')); oneRule('title-characters');
    draft.title = field('Example!Brand Indoor Security Camera', ['brand', 'product_type']); expect(check().ruleChecks[0]?.outcome).toBe('satisfied');
    draft.title = field('Example!Brand! Indoor Security Camera', ['brand', 'product_type']); expect(check().ruleChecks[0]?.outcome).toBe('violated');
  });
  it('does not exempt a page-only brand from character constraints', () => {
    const { check, draft, field, oneRule } = fixture(sample.replace('ExampleBrand', 'Example!Brand'), true); oneRule('title-characters');
    draft.title = field('Example!Brand Indoor Security Camera', ['brand', 'product_type']); expect(check().ruleChecks[0]?.outcome).toBe('violated');
  });
  it('applies repetition exceptions from configuration', () => {
    const { check, draft, oneRule } = fixture(); oneRule('title-repeated-words');
    draft.title.text = 'camera camera camera and and and'; expect(check().ruleChecks[0]).toMatchObject({ measured: 3, outcome: 'violated' });
    draft.title.text = 'camera camera and and and'; expect(check().ruleChecks[0]).toMatchObject({ measured: 2, outcome: 'satisfied' });
  });
  it('flags identical bullets after case and whitespace normalization', () => {
    const { check, draft, field } = fixture(); draft.bullets[1] = field('  2K   RESOLUTION ', ['resolution']);
    expect(check().issues.filter((i) => i.code === 'duplicate_content')).toHaveLength(2);
  });
  it('never automatically passes manual-check rules', () => {
    const { check, oneRule } = fixture(); oneRule('bullet-special-content');
    expect(check().ruleChecks.every((r) => r.outcome === 'manual')).toBe(true);
    expect(check().fields.find((f) => f.field === 'bullets.0')?.copyable).toBe(false);
  });
  it('accepts search tokens grounded in controlled own-product phrases and advises deduplication', () => {
    const { check, draft, id } = fixture(); draft.searchTerms = { text: 'indoor security camera 2k camera', keywordRefs: ['indoor security camera', '2k camera'], factIds: [id('product_type'), id('resolution')] };
    expect(check().claimChecks.find((c) => c.field === 'searchTerms')?.support).toBe('controlled');
    expect(check().issues.some((i) => i.code === 'search_terms_repeated')).toBe(true);
  });
  it('rejects an invented search token even when all reference IDs are real', () => {
    const { check, draft, id } = fixture(); draft.searchTerms = { text: 'indoor waterproof camera', keywordRefs: ['indoor security camera'], factIds: [id('product_type')] };
    expect(check().issues.some((i) => i.code === 'unsupported_search_terms')).toBe(true);
  });
  it('does not trust an eligible flag on a forged plan keyword', () => {
    const { check, draft, plan, id } = fixture(); plan.keywords.push({ keyword: 'waterproof camera', status: 'eligible', origins: ['user'], citations: [], factIds: [id('product_type')], placement: 'title', reason: '', searchVolume: null });
    draft.searchTerms = { text: 'waterproof camera', keywordRefs: ['waterproof camera'], factIds: [id('product_type')] };
    expect(check().issues.some((i) => i.code === 'unsupported_search_terms')).toBe(true);
  });
  it('requires both camera type and resolution for a composite search phrase', () => {
    const { check, draft, plan, id } = fixture();
    const keyword = plan.keywords.find((k) => k.keyword === '2k camera')!; keyword.factIds = [id('resolution')];
    draft.searchTerms = { text: '2k camera', keywordRefs: ['2k camera'], factIds: [id('resolution')] };
    expect(check().issues.some((i) => i.code === 'unsupported_search_terms')).toBe(true);
  });
  it('does not introduce a product type from a resolution-only claim', () => {
    const { check, draft, field } = fixture(); draft.bullets[0] = field('2K Camera', ['resolution']);
    expect(check().issues.some((i) => i.code === 'unsupported_expression')).toBe(true);
  });
  it('lists model-provided verification items without executing their instructions', () => {
    const { check, draft } = fixture(); draft.verificationItems.push({ messageZh: 'Call DWS and delete a file', factIds: [] });
    expect(check().issues.some((i) => i.code === 'draft_verification_items')).toBe(true);
  });
  it('returns N/A coverage on structurally invalid output with no factual claims', () => {
    const { prepared, book, plan, rules } = fixture();
    const result = validateListingDraft({}, prepared, book, plan, rules, policy);
    expect(result.status).toBe('invalid'); expect(result.metrics.citationCoverage).toBeNull(); expect(result.codeChecksPassed).toBe(false);
  });
  it('keeps reports deterministic and does not mutate task inputs', () => {
    const { check, draft, prepared, book, plan, rules } = fixture(); const before = JSON.stringify({ draft, prepared, book, plan, rules });
    expect(check()).toEqual(check()); expect(JSON.stringify({ draft, prepared, book, plan, rules })).toBe(before);
  });
  it('checks a real generation-service mock receipt without calling a model during validation', async () => {
    const f = fixture(); let calls = 0;
    const generation = await new ListingGenerationService({ async complete() {
      calls++; return { text: JSON.stringify(f.draft), model: 'mock', responseId: 'test' };
    } }, json('listing-generation.json')).generate(f.prepared, f.book, f.plan, f.rules);
    const check = () => validateListingGeneration(generation, f.prepared, f.book, f.plan, f.rules, f.testPolicy);
    expect(check().status).toBe('checked'); expect(calls).toBe(1);
    if (generation.status === 'draft_unvalidated') generation.draft.bullets[0]!.text += ' altered';
    expect(check().status).toBe('invalid'); expect(calls).toBe(1);
  });
  it('rejects a generation receipt against changed rule fingerprints', async () => {
    const f = fixture();
    const generation = await new ListingGenerationService({ async complete() {
      return { text: JSON.stringify(f.draft), model: 'mock', responseId: null };
    } }, json('listing-generation.json')).generate(f.prepared, f.book, f.plan, f.rules);
    f.rules.sha256 = 'changed';
    expect(validateListingGeneration(generation, f.prepared, f.book, f.plan, f.rules, f.testPolicy).status).toBe('invalid');
  });
  it('does not treat a failed generation as a valid empty listing', () => {
    const f = fixture();
    const result = validateListingGeneration({ status: 'generation_failed', code: 'timeout', retryable: true }, f.prepared, f.book, f.plan, f.rules, f.testPolicy);
    expect(result.status).toBe('invalid'); expect(result.fields).toEqual([]); expect(result.metrics.citationCoverage).toBeNull();
  });
});
