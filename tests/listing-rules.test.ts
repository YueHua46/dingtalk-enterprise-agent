import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadListingRules, parseListingRules, resolveListingRules, type ListingRulesConfig } from '../src/listing-rules.js';

const configUrl = new URL('../config/listing-rules.us-en.json', import.meta.url);
function fixture(): ListingRulesConfig {
  return JSON.parse(readFileSync(configUrl, 'utf8')) as ListingRulesConfig;
}
const target = { marketplace: 'US', language: 'en' };
function typeFixture(verified = false): ListingRulesConfig {
  const config = fixture();
  const override = structuredClone(config.rules[0]!);
  if (override.check.kind !== 'length') throw new Error('fixture');
  override.check.limit = 150;
  if (verified) override.verification = { status: 'verified', note: '测试用已核实规则，不是实际摄像头规则', verifiedBy: 'test', verifiedOn: '2026-09-30' };
  config.productTypes.push({ id: 'TEST_CAMERA',
    source: { title: '仅用于单元测试的产品类型', reference: 'https://sellercentral.amazon.com/help/test-fixture', publishedOn: null, retrievedOn: '2026-09-30' },
    verification: verified ? { status: 'verified', note: '测试样例', verifiedBy: 'test', verifiedOn: '2026-09-30' } : { status: 'pending', note: '待核实测试类型' },
    overrides: [override] });
  return config;
}

describe('Listing module 3: rule configuration', () => {
  it('loads deployed JSON without network or model calls', async () => {
    const config = await loadListingRules(configUrl);
    expect(config.version).toBe('us-en-2026-09-30.1');
    expect(config.productTypes).toEqual([]);
    expect(config.rules.filter((rule) => rule.origin === 'platform').every((rule) => rule.verification.status === 'pending')).toBe(true);
  });

  it('keeps byte and character budgets and inclusive/exclusive boundaries distinct', () => {
    const rules = parseListingRules(fixture()).rules;
    expect(rules.find((rule) => rule.id === 'title-length')?.check).toMatchObject({ unit: 'unicode_code_points', limit: 200, comparison: 'at_most', includeSpaces: true });
    expect(rules.find((rule) => rule.id === 'search-terms-length')?.check).toMatchObject({ unit: 'utf8_bytes', limit: 250, comparison: 'less_than', includeSpaces: true });
  });

  it('keeps editorial budgets separate from platform rules', () => {
    const config = parseListingRules(fixture());
    expect(config.rules.find((rule) => rule.id === 'bullet-length-budget')).toMatchObject({ origin: 'editorial', severity: 'advisory', verification: { status: 'pending' } });
    expect(config.rules.find((rule) => rule.id === 'bullet-count')).toMatchObject({ origin: 'editorial', check: { count: 5 } });
  });

  it('includes brand exceptions and repetition exclusions in configuration', () => {
    const rules = fixture().rules;
    expect(rules.find((rule) => rule.id === 'title-characters')?.check).toMatchObject({ exception: 'brand_name' });
    expect(rules.find((rule) => rule.id === 'title-repeated-words')?.check).toMatchObject({ exceptions: expect.arrayContaining(['the', 'and']) });
  });

  it('warns about missing category, unverified rules and manual checks', () => {
    const resolved = resolveListingRules(fixture(), target);
    expect(resolved.coverage).toBe('general_only');
    expect(resolved.notices.map((notice) => notice.code)).toEqual(['product_type_missing', 'rules_pending', 'manual_checks_required']);
    expect(resolved.notices.find((notice) => notice.code === 'rules_pending')?.ruleIds).toContain('title-length');
    expect(resolved.notices.find((notice) => notice.code === 'manual_checks_required')?.ruleIds).toContain('bullet-special-content');
  });

  it('does not map natural camera names or unknown types to invented Amazon types', () => {
    const resolved = resolveListingRules(fixture(), { ...target, productType: '摄像头' });
    expect(resolved.coverage).toBe('general_only');
    expect(resolved.notices[0]?.code).toBe('product_type_unknown');
    expect(resolved.rules[0]?.check).toMatchObject({ limit: 200 });
  });

  it('applies only an exact product-type override and keeps original config unchanged', () => {
    const config = typeFixture();
    const original = JSON.stringify(config);
    const resolved = resolveListingRules(config, { ...target, productType: 'TEST_CAMERA' });
    expect(resolved.coverage).toBe('product_type_pending');
    expect(resolved.rules[0]?.check).toMatchObject({ limit: 150 });
    expect(resolved.rules).toHaveLength(config.rules.length);
    expect(JSON.stringify(config)).toBe(original);
    expect(resolveListingRules(config, { ...target, productType: 'test_camera' }).rules[0]?.check).toMatchObject({ limit: 200 });
    resolved.rules[0]!.description = 'mutated';
    expect(JSON.stringify(config)).toBe(original);
  });

  it('does not promote other pending rules when a type has been verified', () => {
    const resolved = resolveListingRules(typeFixture(true), { ...target, productType: 'TEST_CAMERA' });
    expect(resolved.coverage).toBe('product_type_verified');
    const pending = resolved.notices.find((notice) => notice.code === 'rules_pending')!;
    expect(pending.ruleIds).not.toContain('title-length');
    expect(pending.ruleIds).toContain('search-terms-length');
    expect(resolved.notices.some((notice) => notice.code === 'manual_checks_required')).toBe(true);
  });

  it('versions are deterministic and fingerprints change on contents or selected type', () => {
    const config = fixture();
    const original = resolveListingRules(config, target);
    expect(resolveListingRules(config, target)).toEqual(original);
    expect(original.sha256).toMatch(/^[a-f0-9]{64}$/);
    config.rules[0]!.description += ' 新注释';
    expect(resolveListingRules(config, target).sha256).not.toBe(original.sha256);
    expect(resolveListingRules(fixture(), { ...target, productType: 'OTHER' }).sha256).not.toBe(original.sha256);
  });

  it.each([{ marketplace: 'DE', language: 'en' }, { marketplace: 'US', language: 'de' }])('rejects unsupported targets: %j', (other) => {
    expect(() => resolveListingRules(fixture(), other)).toThrow('LISTING_RULES_TARGET_UNSUPPORTED');
  });

  it.each(['source', 'verification', 'effectiveOn'])('requires provenance field %s', (field) => {
    const config = fixture();
    delete (config.rules[0] as unknown as Record<string, unknown>)[field];
    expect(() => parseListingRules(config)).toThrow();
  });

  it.each(['2026-02-30', '2026-13-01', '2026/09/30'])('rejects malformed dates: %s', (value) => {
    const config = fixture(); config.updatedOn = value;
    expect(() => parseListingRules(config)).toThrow();
  });

  it('rejects retrieval and verification dates after the config date', () => {
    const config = fixture(); config.rules[0]!.source.retrievedOn = '2026-10-01';
    expect(() => parseListingRules(config)).toThrow();
  });

  it('rejects future effective rules and impossible publication chronology', () => {
    const future = fixture(); future.rules[0]!.effectiveOn = '2026-10-01';
    expect(() => parseListingRules(future)).toThrow();
    const publication = fixture(); publication.rules[0]!.source.publishedOn = '2026-10-01';
    expect(() => parseListingRules(publication)).toThrow();
    const override = typeFixture(); override.productTypes[0]!.overrides[0]!.effectiveOn = '2026-10-01';
    expect(() => parseListingRules(override)).toThrow();
  });

  it('requires evidence of verification and rejects contradictory statuses', () => {
    const config = fixture(); config.rules[0]!.verification.status = 'verified';
    expect(() => parseListingRules(config)).toThrow();
    config.rules[0]!.verification = { status: 'pending', note: 'test', verifiedBy: 'test', verifiedOn: '2026-09-30' };
    expect(() => parseListingRules(config)).toThrow();
    config.rules[0]!.verification = { status: 'verified', note: 'test', verifiedBy: 'test', verifiedOn: '2026-09-29' };
    expect(() => parseListingRules(config)).toThrow();
  });

  it.each(['https://example.com/rule', 'http://sellercentral.amazon.com/rule', 'https://sellercentral.amazon.com.evil.test/rule', 'https://user:secret@sellercentral.amazon.com/rule'])('rejects nonofficial or credential-containing platform sources: %s', (reference) => {
    const config = fixture(); config.rules[0]!.source.reference = reference;
    expect(() => parseListingRules(config)).toThrow();
  });

  it('rejects duplicate rules and duplicate product types', () => {
    const config = fixture(); config.rules.push(structuredClone(config.rules[0]!));
    expect(() => parseListingRules(config)).toThrow();
    const types = typeFixture(); types.productTypes.push(structuredClone(types.productTypes[0]!));
    expect(() => parseListingRules(types)).toThrow();
  });

  it('rejects unknown, duplicate or cross-field overrides', () => {
    for (const mutation of ['unknown', 'duplicate', 'field', 'origin']) {
      const config = typeFixture(); const type = config.productTypes[0]!;
      if (mutation === 'unknown') type.overrides[0]!.id = 'does-not-exist';
      if (mutation === 'duplicate') type.overrides.push(structuredClone(type.overrides[0]!));
      if (mutation === 'field') type.overrides[0]!.field = 'description';
      if (mutation === 'origin') type.overrides[0]!.origin = 'editorial';
      expect(() => parseListingRules(config)).toThrow();
    }
  });

  it.each([0, -1, 2.5])('rejects invalid length thresholds: %s', (limit) => {
    const config = fixture(); const check = config.rules[0]!.check;
    if (check.kind === 'length') check.limit = limit;
    expect(() => parseListingRules(config)).toThrow();
  });

  it('rejects unknown executable configuration and invalid check shapes', () => {
    expect(() => parseListingRules({ ...fixture(), tool: 'dingtalk.dws' })).toThrow();
    const config = fixture(); Object.assign(config.rules[0]!.check, { command: 'run-this' });
    expect(() => parseListingRules(config)).toThrow();
    const count = fixture(); count.rules.find((rule) => rule.id === 'bullet-count')!.field = 'title';
    expect(() => parseListingRules(count)).toThrow();
  });

  it('fails on missing files rather than silently using a hardcoded policy', async () => {
    await expect(loadListingRules(new URL('../config/listing-rules.missing.json', import.meta.url))).rejects.toThrow();
  });

  it('fails on non-JSON source files rather than silently using a fallback', async () => {
    await expect(loadListingRules(new URL('../src/listing-rules.ts', import.meta.url))).rejects.toThrow(SyntaxError);
  });
});
