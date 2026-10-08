import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { AmazonTool } from './amazon-tool.js';
import type { McpReadTool } from './mcp-read-tool.js';
import type { PreparedListingInput } from './listing-input.js';

const asinSchema = z.string().regex(/^[A-Z0-9]{10}$/);
const text = z.string().trim().min(1);
export const researchPolicySchema = z.strictObject({
  version: text, maxCompetitors: z.number().int().min(3).max(5),
  minimumAutoCandidates: z.number().int().min(1).max(5),
  maxDetailCandidates: z.number().int().min(5).max(20), maxQueries: z.number().int().min(1).max(5),
  maxSearchResults: z.number().int().min(1).max(100), searchPages: z.number().int().min(1).max(10),
  reviewPages: z.number().int().min(1).max(5), maxReviewsPerProduct: z.number().int().min(1).max(100),
  maxEvidenceCharacters: z.number().int().min(1000).max(200000),
}).refine((value) => value.minimumAutoCandidates <= value.maxCompetitors, '最少候选不能大于最大候选');
export type ResearchPolicy = z.infer<typeof researchPolicySchema>;
export async function loadResearchPolicy(path: string | URL): Promise<ResearchPolicy> {
  return researchPolicySchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

const price = z.number().finite().nonnegative().nullable().optional();
const rating = z.number().min(0).max(5).nullable().optional();
const count = z.number().int().nonnegative().nullable().optional();
export const researchProductResponseSchema = z.object({ tool: z.literal('amazon.get_product_detail'), marketplace: z.literal('US'), data: z.object({
  asin: asinSchema, marketplace: z.literal('US'), title: text, brand: z.string().optional(),
  price, rating, review_count: count, bullets: z.array(z.string()), bsr_text: z.string().optional(),
}) });
const detailSchema = researchProductResponseSchema;
const searchSchema = z.object({ tool: z.literal('amazon.search_products'), marketplace: z.literal('US'), items: z.array(z.object({
  asin: asinSchema, title: text, price, rating, review_count: count,
  source_keyword: text, organic_rank: z.number().int().positive().nullable(), is_sponsored: z.boolean(),
})) });
const reviewsSchema = z.object({ tool: z.literal('amazon.get_reviews'), marketplace: z.literal('US'), asin: asinSchema,
  source: text, sample_limit: text, items: z.array(z.object({
    review_id: z.string(), asin: asinSchema, marketplace: z.literal('US'), title: z.string(), content: z.string(),
    rating, date_text: z.string().optional(), variant: z.string().optional(),
  })),
});
export type ResearchProduct = z.infer<typeof detailSchema>['data'];
type SearchItem = z.infer<typeof searchSchema>['items'][number];
export const LISTING_SIF_TOOLS = ['market_get_asin_keyword_signals', 'market_discover_competitors', 'market_get_keyword_demand', 'market_get_asin_profile'] as const;

/** Host-planned SIF calls only. Returned text is never used to select tools or parameters. */
const sifRequestSchema = z.strictObject({ toolId: z.enum(LISTING_SIF_TOOLS), params: z.record(z.string(), z.unknown()) });
export interface ResearchOptions {
  queries?: string[];
  signal?: AbortSignal;
  sifRequests?: Array<z.infer<typeof sifRequestSchema>>;
}
export interface ResearchEvidence {
  id: string;
  tool: string;
  observedAt: string;
  sha256: string;
  content: string;
  trust: 'untrusted_external';
  request: Record<string, unknown>;
}
export interface ResearchGap {
  code: 'search_failed' | 'detail_failed' | 'reviews_failed' | 'sif_failed' | 'insufficient_candidates' | 'queries_missing' | 'bounded_input' | 'relevance_uncertain' | 'listing_fields_missing' | 'sif_schema_unverified';
  message: string;
  asin?: string;
}
export interface ResearchCompetitor {
  product: ResearchProduct;
  origin: 'specified' | 'auto';
  comparisonEligibility: 'candidate' | 'needs_verification';
  reasons: string[];
  evidenceId: string;
  searchEvidenceId?: string;
  searchSignals?: { keyword: string; organicRank: number | null; sponsored: boolean };
  reviewSample?: {
    items: z.infer<typeof reviewsSchema>['items'];
    count: number;
    evidenceId: string;
    source: string;
    sampleLimit: string;
    population: 'sample_only';
  };
}
export interface ListingResearchResult {
  owner: PreparedListingInput['owner'];
  surface: PreparedListingInput['surface'];
  requestId: string;
  policyVersion: string;
  status: 'complete' | 'partial' | 'needs_clarification';
  originalListing?: { product: ResearchProduct; evidenceId: string; trust: 'page_unverified' };
  competitors: ResearchCompetitor[];
  rejectedCandidates: Array<{ asin: string; reason: string }>;
  keywordSignals: Array<{ keyword: string; source: 'user' | 'search_query'; evidenceId?: string; volume: null }>;
  evidence: ResearchEvidence[];
  gaps: ResearchGap[];
  salesClaims: 'public_signals_only_not_verified_sales';
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
// Conservative product-family signals, not a claim to infer Amazon product types.
function cameraSignals(value: string): string[] {
  const lower = value.toLowerCase();
  return ['indoor', 'outdoor', 'doorbell', 'dash', 'poe', 'battery', '4g'].filter((word) => new RegExp(`\\b${word}\\b`).test(lower));
}
function relevance(reference: string, candidate: string): 'candidate' | 'needs_verification' | 'different' {
  if (!/\bcameras?\b/i.test(reference) || !/\bcameras?\b/i.test(candidate)) return 'needs_verification';
  if (/\b(dummy|fake|mount|bracket|replacement cable)\b/i.test(candidate)) return 'different';
  const a = cameraSignals(reference), b = cameraSignals(candidate);
  if (!a.some((word) => ['doorbell', 'dash'].includes(word)) && b.some((word) => ['doorbell', 'dash'].includes(word))) return 'needs_verification';
  if ((a.includes('poe') && b.includes('battery')) || (a.includes('battery') && b.includes('poe'))) return 'different';
  for (const [left, right] of [['indoor', 'outdoor'], ['doorbell', 'dash']] as const) {
    if ((a.includes(left) && b.includes(right)) || (a.includes(right) && b.includes(left))) return 'different';
  }
  if (a.some((word) => ['doorbell', 'dash'].includes(word)) && !b.some((word) => a.includes(word))) return 'needs_verification';
  if (a.some((word) => ['poe', 'battery', '4g'].includes(word)) && !b.some((word) => a.includes(word))) return 'needs_verification';
  return a.length && !a.some((word) => b.includes(word)) ? 'needs_verification' : 'candidate';
}

/** IO is restricted to existing read-only adapters. No user identity or business-write override. */
export class ListingResearchService {
  private readonly policy: ResearchPolicy;
  public constructor(
    private readonly amazon: Pick<AmazonTool, 'execute'>,
    policy: unknown,
    private readonly sif?: Pick<McpReadTool, 'parse' | 'execute'>,
    private readonly now: () => Date = () => new Date(),
  ) { this.policy = researchPolicySchema.parse(policy); }

  public async research(prepared: PreparedListingInput, options: ResearchOptions = {}): Promise<ListingResearchResult> {
    if (!prepared.owner.corpId || !prepared.owner.userId || !prepared.surface.id) throw new Error('LISTING_RESEARCH_IDENTITY_REQUIRED');
    if (prepared.input.marketplace !== 'US' || prepared.input.language !== 'en') throw new Error('LISTING_RESEARCH_TARGET_UNSUPPORTED');
    const p = this.policy;
    const requests = z.array(sifRequestSchema).max(p.maxQueries).parse(options.sifRequests ?? []);
    const rawQueries = z.array(z.string().trim().min(1).max(200)).parse(options.queries ?? prepared.input.keywords);
    const evidence: ResearchEvidence[] = [], gaps: ResearchGap[] = [];
    const result: ListingResearchResult = {
      owner: { ...prepared.owner }, surface: { ...prepared.surface }, requestId: prepared.requestId,
      policyVersion: p.version, status: 'complete', competitors: [], rejectedCandidates: [], keywordSignals: [], evidence, gaps,
      salesClaims: 'public_signals_only_not_verified_sales',
    };
    const cancelled = () => { if (options.signal?.aborted) throw new Error('LISTING_RESEARCH_CANCELLED'); };
    const record = (tool: string, request: Record<string, unknown>, response: unknown): ResearchEvidence => {
      const content = JSON.stringify(response);
      if (!content || content.length > p.maxEvidenceCharacters) throw new Error('LISTING_RESEARCH_RESPONSE_INVALID');
      const sha256 = hash(content);
      const observedAt = this.now().toISOString();
      const item: ResearchEvidence = { id: 'research-' + hash(JSON.stringify([prepared.owner, prepared.requestId, tool, request, observedAt, sha256])).slice(0, 24), tool, request: structuredClone(request), observedAt, sha256, content, trust: 'untrusted_external' };
      evidence.push(item);
      return item;
    };
    const call = async <T>(operation: string, args: Record<string, unknown>, parse: (raw: unknown) => T): Promise<{ data: T; evidenceId: string }> => {
      cancelled();
      const raw = await this.amazon.execute(operation, args);
      cancelled();
      const data = parse(raw);
      return { data, evidenceId: record('amazon.' + operation, args, raw).id };
    };
    const detail = async (asin: string) => call('get_product_detail', { asin, marketplace: 'US' }, (raw) => {
      const data = detailSchema.parse(raw).data;
      if (data.asin !== asin) throw new Error('LISTING_RESEARCH_RESPONSE_INVALID');
      return data;
    });
    const gap = (code: ResearchGap['code'], message: string, asin?: string) => {
      cancelled();
      gaps.push({ code, message, ...(asin ? { asin } : {}) });
    };
    if (prepared.input.asin) {
      try {
        const own = await detail(prepared.input.asin);
        result.originalListing = { product: own.data, evidenceId: own.evidenceId, trust: 'page_unverified' };
        gaps.push({ code: 'listing_fields_missing', asin: prepared.input.asin, message: '现有商品详情工具未提供完整普通描述和后台搜索词；不把 A+ 当普通描述，也不编造原文。' });
      } catch { gap('detail_failed', '本品页面读取失败或返回不匹配，缺少可验证的修改前文案。', prepared.input.asin); }
    }
    let queries = [...new Set(rawQueries.map((item) => item.toLowerCase()))];
    // Use only explicit English product type or this task's fetched title, never external review instructions.
    if (!queries.length && prepared.input.productType && /^[a-zA-Z0-9 -]+$/.test(prepared.input.productType)) queries = [prepared.input.productType.trim().toLowerCase()];
    if (!queries.length && result.originalListing) {
      const title = result.originalListing.product.title;
      if (/\bcameras?\b/i.test(title)) queries = [[...cameraSignals(title), 'security camera'].join(' ')];
    }
    if (queries.length > p.maxQueries) gaps.push({ code: 'bounded_input', message: '搜索词超出本轮查询上限，仅处理前几个；其余保留为用户关键词。' });
    queries = queries.slice(0, p.maxQueries);
    for (const keyword of prepared.input.keywords) result.keywordSignals.push({ keyword, source: 'user', volume: null });
    const reference = result.originalListing?.product.title ?? prepared.input.productType ?? queries.join(' ');
    const candidates = new Map<string, { item: SearchItem; evidenceId: string }>();
    if (prepared.input.competitors.strategy !== 'specified') {
      if (!queries.length) gap('queries_missing', '自动寻找竞品需要核心英文关键词或可识别的产品类型，请补充；不会猜测产品用途。');
      else {
        try {
          const response = await call('search_products', { keywords: queries, marketplace: 'US', maxPages: p.searchPages, maxResults: p.maxSearchResults, organicOnly: true }, (raw) => searchSchema.parse(raw));
          for (const query of queries) result.keywordSignals.push({ keyword: query, source: 'search_query', evidenceId: response.evidenceId, volume: null });
          for (const item of response.data.items) {
            if (!queries.includes(item.source_keyword.toLowerCase()) || item.asin === prepared.input.asin || item.is_sponsored) continue;
            if (!candidates.has(item.asin)) candidates.set(item.asin, { item, evidenceId: response.evidenceId });
          }
        } catch { gap('search_failed', '搜索失败或返回结构不符合当前工具契约，不推断不存在竞品。'); }
      }
    }
    const specified = [...new Set(prepared.input.competitors.asins)].filter((asin) => asin !== prepared.input.asin);
    if (specified.length > p.maxCompetitors) gap('bounded_input', '指定竞品超过本轮上限，仅处理前几个，其他未处理。');
    const ranked = [...candidates.values()].filter(({ item }) => !specified.includes(item.asin))
      .sort((a, b) => (b.item.review_count ?? 0) - (a.item.review_count ?? 0) || (b.item.rating ?? 0) - (a.item.rating ?? 0) || (a.item.organic_rank ?? Infinity) - (b.item.organic_rank ?? Infinity) || a.item.asin.localeCompare(b.item.asin));
    const queue = [...specified.slice(0, p.maxCompetitors).map((asin) => ({ asin, origin: 'specified' as const })),
      ...ranked.map(({ item }) => ({ asin: item.asin, origin: 'auto' as const }))];
    let attempts = 0;
    for (const candidate of queue) {
      cancelled();
      if (result.competitors.length >= p.maxCompetitors || attempts >= p.maxDetailCandidates) break;
      if (candidate.origin === 'auto') {
        const title = candidates.get(candidate.asin)!.item.title;
        if (relevance(reference, title) === 'different') { result.rejectedCandidates.push({ asin: candidate.asin, reason: '标题显示用途或产品类型明显不同。' }); continue; }
      }
      attempts += 1;
      try {
        const response = await detail(candidate.asin);
        const eligibility = relevance(reference, response.data.title);
        if (candidate.origin === 'auto' && eligibility !== 'candidate') {
          result.rejectedCandidates.push({ asin: candidate.asin, reason: eligibility === 'different' ? '商品详情显示用途不同。' : '现有信号不足以确认同类，未自动选入。' });
          continue;
        }
        const search = candidates.get(candidate.asin);
        const reasons = [candidate.origin === 'specified' ? '运营指定的参考竞品。' : '产品标题用途信号相近；仍是待运营判断的候选，非已验证爆款。'];
        if (response.data.review_count != null) reasons.push(`公开页面评论数 ${response.data.review_count}，不代表销量。`);
        if (response.data.rating != null) reasons.push(`公开页面评分 ${response.data.rating}。`);
        if (response.data.price != null) reasons.push(`美国站公开页面价格 USD ${response.data.price}，仅作当前价格参考。`);
        if (response.data.bsr_text) reasons.push(`页面排名原文：${response.data.bsr_text}`);
        const competitor: ResearchCompetitor = { product: response.data, origin: candidate.origin,
          comparisonEligibility: eligibility === 'candidate' ? 'candidate' : 'needs_verification', reasons, evidenceId: response.evidenceId,
          ...(search ? { searchEvidenceId: search.evidenceId, searchSignals: { keyword: search.item.source_keyword, organicRank: search.item.organic_rank, sponsored: search.item.is_sponsored } } : {}) };
        if (eligibility !== 'candidate') gap('relevance_uncertain', '指定竞品的同类适用性未确认，保留指定来源并提示，不能直接用于移植卖点。', candidate.asin);
        result.competitors.push(competitor);
      } catch { gap('detail_failed', '竞品详情读取失败或响应不匹配，保留缺口，不编造商品属性。', candidate.asin); }
    }
    if (prepared.input.competitors.strategy !== 'specified' && result.competitors.filter((item) => item.comparisonEligibility === 'candidate').length < p.minimumAutoCandidates) {
      gap('insufficient_candidates', '同类候选不足默认目标，按实际已取得结果交付，不补造竞品。');
    }
    for (const competitor of result.competitors) {
      try {
        const response = await call('get_reviews', { asin: competitor.product.asin, marketplace: 'US', maxPages: p.reviewPages }, (raw) => {
          const data = reviewsSchema.parse(raw);
          if (data.asin !== competitor.product.asin || data.items.some((item) => item.asin !== data.asin)) throw new Error('LISTING_RESEARCH_RESPONSE_INVALID');
          return data;
        });
        const unique = new Map<string, z.infer<typeof reviewsSchema>['items'][number]>();
        for (const item of response.data.items) {
          if (!item.content.trim()) continue;
          const key = item.review_id || hash(JSON.stringify([item.content, item.rating, item.date_text, item.variant]));
          if (!unique.has(key)) unique.set(key, item);
        }
        const items = [...unique.values()].slice(0, p.maxReviewsPerProduct);
        competitor.reviewSample = { items, count: items.length, evidenceId: response.evidenceId,
          source: response.data.source, sampleLimit: response.data.sample_limit, population: 'sample_only' };
        if (!items.length) gap('reviews_failed', '本次未取得有效评论样本，不能据此断言没有评论或买家痛点。', competitor.product.asin);
      } catch { gap('reviews_failed', '评论采样失败或结构不匹配；不生成虚构的评论洞察。', competitor.product.asin); }
    }
    for (const request of requests) {
      cancelled();
      try {
        if (!this.sif) throw new Error('SIF_UNAVAILABLE');
        const parsed = this.sif.parse('sif', request);
        const raw = await this.sif.execute('sif', parsed);
        cancelled();
        record('sif.' + parsed.toolId, parsed.params, raw);
        gap('sif_schema_unverified', '已取得 SIF 原始市场证据；尚未确认此工具的指标结构，不提取销量或搜索量。第三方销量只能作为估算。');
      } catch { gap('sif_failed', 'SIF 未配置、查询失败或结果超限；保留其他来源，不使用共享服务读取内部店铺数据。'); }
    }
    cancelled();
    result.status = gaps.some((item) => item.code === 'queries_missing') ? 'needs_clarification' : gaps.length ? 'partial' : 'complete';
    return result;
  }
}
