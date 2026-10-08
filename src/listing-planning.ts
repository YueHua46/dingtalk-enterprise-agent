import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { ProductFact, ProductFactBook } from './listing-facts.js';
import type { ListingResearchResult, ResearchEvidence } from './listing-research.js';

const text = z.string().trim().min(1);
export const planningPolicySchema = z.strictObject({
  version: text, maxTitleKeywords: z.number().int().positive(), maxBulletKeywords: z.number().int().positive(),
  negativeMarkers: z.array(text).min(1),
  keywords: z.array(z.strictObject({ phrase: text, priority: z.number().int().nonnegative(),
    guards: z.array(z.strictObject({ attribute: text, terms: z.array(text).min(1) })).min(1) })),
  topics: z.array(z.strictObject({ id: text, label: text, terms: z.array(text).min(1), attributes: z.array(text).min(1) })),
}).superRefine((value, ctx) => {
  if (new Set(value.keywords.map((item) => normalize(item.phrase))).size !== value.keywords.length) ctx.addIssue({ code: 'custom', message: '重复关键词定义' });
  if (new Set(value.topics.map((item) => item.id)).size !== value.topics.length) ctx.addIssue({ code: 'custom', message: '重复评论主题' });
});
export type PlanningPolicy = z.infer<typeof planningPolicySchema>;
export async function loadPlanningPolicy(path: string | URL): Promise<PlanningPolicy> {
  return planningPolicySchema.parse(JSON.parse(await readFile(path, 'utf8')));
}
const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function contains(value: string, term: string): boolean {
  const content = normalize(value), needle = normalize(term);
  let offset = content.indexOf(needle);
  while (offset >= 0) {
    const before = content[offset - 1] ?? '', after = content[offset + needle.length] ?? '';
    if ((!/^[a-z0-9]/.test(needle) || !/[a-z0-9]/.test(before)) && (!/[a-z0-9]$/.test(needle) || !/[a-z0-9]/.test(after))) return true;
    offset = content.indexOf(needle, offset + 1);
  }
  return false;
}

export interface MarketCitation { evidenceId: string; asin?: string; field: string; excerpt: string }
export interface PlannedKeyword {
  keyword: string;
  origins: Array<'user' | 'search_query' | 'competitor'>;
  citations: MarketCitation[];
  factIds: string[];
  status: 'eligible' | 'page_only' | 'needs_verification';
  placement: 'title' | 'bullets' | 'description_or_search_terms' | 'hold';
  reason: string;
  searchVolume: null;
}
export interface ReviewInsight {
  topicId: string;
  label: string;
  mentionCount: number;
  sampleSize: number;
  population: 'sample_only';
  interpretation: 'topic_mentions_not_sentiment_or_causality';
  citations: MarketCitation[];
  factIds: string[];
  recommendation: string;
}
export interface SellingPointPlan {
  id: string;
  attribute: string;
  facts: Array<{ id: string; originalValue: string; excerpt: string; sourceId: string; trust: ProductFact['trust'] }>;
  status: 'grounded' | 'page_only';
  emphasis: 'buyer_question' | 'product_information';
  relatedTopicIds: string[];
  instruction: string;
}
export interface ListingContentPlan {
  version: string;
  factVersion: string;
  policyVersion: string;
  requestId: string;
  owner: ProductFactBook['owner'];
  surface: ProductFactBook['surface'];
  status: 'ready' | 'ready_limited' | 'needs_clarification' | 'needs_sources';
  keywords: PlannedKeyword[];
  insights: ReviewInsight[];
  sellingPoints: SellingPointPlan[];
  excludedFactIds: string[];
  notices: Array<{ code: 'no_review_samples' | 'research_partial' | 'uncertain_competitors' | 'keyword_unverified' | 'facts_unverified'; message: string }>;
}

/** No model/IO/tool access. Consumers must keep cited external text as data. */
export function buildListingContentPlan(book: ProductFactBook, research: ListingResearchResult, rawPolicy: unknown): ListingContentPlan {
  const policy = planningPolicySchema.parse(rawPolicy);
  if (book.requestId !== research.requestId || book.owner.corpId !== research.owner.corpId || book.owner.userId !== research.owner.userId
    || book.surface.type !== research.surface.type || book.surface.id !== research.surface.id) throw new Error('LISTING_PLAN_SCOPE_MISMATCH');
  const evidence = new Map<string, ResearchEvidence>();
  for (const item of research.evidence) {
    if (evidence.has(item.id) || hash(item.content) !== item.sha256) throw new Error('LISTING_PLAN_EVIDENCE_INVALID');
    evidence.set(item.id, item);
  }
  const snapshot = (id: string, tool: string): Record<string, any> => {
    const item = evidence.get(id);
    if (!item || item.tool !== tool || item.trust !== 'untrusted_external') throw new Error('LISTING_PLAN_EVIDENCE_INVALID');
    const body = JSON.parse(item.content);
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.marketplace !== 'US' || body.tool !== tool) throw new Error('LISTING_PLAN_EVIDENCE_INVALID');
    return body;
  };
  const candidates = research.competitors.filter((item) => item.comparisonEligibility === 'candidate');
  const notices: ListingContentPlan['notices'] = [];
  if (candidates.length !== research.competitors.length) notices.push({ code: 'uncertain_competitors', message: '关联性未确认的指定竞品不参与自动关键词和评论规划。' });
  if (research.status !== 'complete') notices.push({ code: 'research_partial', message: '调研有缺口；以下规划仅使用已取得证据。' });
  const usable = book.facts.filter((fact) => fact.status === 'usable');
  const keywordMap = new Map<string, { origins: Set<PlannedKeyword['origins'][number]>; citations: MarketCitation[] }>();
  const addKeyword = (phrase: string, origin: PlannedKeyword['origins'][number], citation?: MarketCitation) => {
    const key = normalize(phrase);
    const value = keywordMap.get(key) ?? { origins: new Set(), citations: [] };
    value.origins.add(origin);
    if (citation && !value.citations.some((item) => JSON.stringify(item) === JSON.stringify(citation))) value.citations.push(citation);
    keywordMap.set(key, value);
  };
  for (const signal of research.keywordSignals) {
    if (signal.source === 'search_query') {
      const body = snapshot(signal.evidenceId ?? '', 'amazon.search_products');
      const request = evidence.get(signal.evidenceId!)!.request;
      if (!Array.isArray(request.keywords) || !request.keywords.some((keyword: unknown) => typeof keyword === 'string' && normalize(keyword) === normalize(signal.keyword))) throw new Error('LISTING_PLAN_EVIDENCE_INVALID');
      if (!Array.isArray(body.items)) throw new Error('LISTING_PLAN_EVIDENCE_INVALID');
      addKeyword(signal.keyword, signal.source, { evidenceId: signal.evidenceId!, field: 'search_query', excerpt: signal.keyword });
    } else addKeyword(signal.keyword, 'user');
  }
  const reviews = new Map<string, { content: string; citations: MarketCitation[] }>();
  for (const competitor of candidates) {
    const asin = competitor.product.asin;
    const detail = snapshot(competitor.evidenceId, 'amazon.get_product_detail');
    if (detail.data?.asin !== asin || detail.data?.title !== competitor.product.title || JSON.stringify(detail.data?.bullets) !== JSON.stringify(competitor.product.bullets)) throw new Error('LISTING_PLAN_EVIDENCE_INVALID');
    for (const [field, content] of [['title', competitor.product.title], ...competitor.product.bullets.map((bullet, index) => [`bullet_${index + 1}`, bullet])] as string[][]) {
      for (const keyword of policy.keywords) if (contains(content!, keyword.phrase)) {
        addKeyword(keyword.phrase, 'competitor', { evidenceId: competitor.evidenceId, asin, field: field!, excerpt: content! });
      }
    }
    const sample = competitor.reviewSample;
    if (!sample) continue;
    const rawReviews = snapshot(sample.evidenceId, 'amazon.get_reviews');
    if (sample.population !== 'sample_only' || rawReviews.asin !== asin || !Array.isArray(rawReviews.items)) throw new Error('LISTING_PLAN_EVIDENCE_INVALID');
    for (const item of sample.items) {
      if (item.asin !== asin || !rawReviews.items.some((row: any) => row.asin === asin && row.review_id === item.review_id && row.content === item.content && row.title === item.title)) throw new Error('LISTING_PLAN_EVIDENCE_INVALID');
      if (!item.content.trim()) continue;
      const key = hash(JSON.stringify([item.review_id, normalize(item.content)]));
      const entry = reviews.get(key) ?? { content: item.content, citations: [] };
      entry.citations.push({ evidenceId: sample.evidenceId, asin, field: 'review_body', excerpt: item.content });
      reviews.set(key, entry);
    }
  }
  if (!reviews.size) notices.push({ code: 'no_review_samples', message: '没有有效评论样本，不生成评论关注点或差评原因。' });
  const insights: ReviewInsight[] = [];
  for (const topic of policy.topics) {
    const matching = [...reviews.values()].filter((review) => topic.terms.some((term) => contains(review.content, term)));
    if (!matching.length) continue;
    const factIds = usable.filter((fact) => topic.attributes.includes(fact.attribute) && fact.trust === 'user_provided').map((fact) => fact.id);
    insights.push({ topicId: topic.id, label: topic.label, mentionCount: matching.length, sampleSize: reviews.size,
      population: 'sample_only', interpretation: 'topic_mentions_not_sentiment_or_causality', citations: matching.flatMap((review) => review.citations), factIds,
      recommendation: factIds.length ? '本次样本提及此主题，可在文案中说明对应本品事实，保留费用、条件与限制；不宣称本品解决了竞品问题。' : '本次样本提及此主题，但本品事实不足；列为补资料方向，不写成产品卖点。' });
  }
  const keywords: PlannedKeyword[] = [];
  for (const [keyword, value] of keywordMap) {
    const definition = policy.keywords.find((item) => normalize(item.phrase) === keyword);
    const support: ProductFact[] = [];
    let supported = !!definition;
    for (const guard of definition?.guards ?? []) {
      const matching = usable.filter((fact) => fact.attribute === guard.attribute
        && guard.terms.some((term) => contains(fact.rawValue, term))
        && !policy.negativeMarkers.some((marker) => contains(fact.rawValue, marker)));
      if (!matching.length) supported = false;
      support.push(...matching);
    }
    const grounded = supported && definition!.guards.every((guard) => support.some((fact) => fact.attribute === guard.attribute && fact.trust === 'user_provided'));
    const status = !supported ? 'needs_verification' : grounded ? 'eligible' : 'page_only';
    keywords.push({ keyword, origins: [...value.origins], citations: value.citations,
      factIds: supported ? [...new Set(support.map((fact) => fact.id))] : [], status, placement: 'hold', searchVolume: null,
      reason: !supported ? '未由受控词表及本品事实同时支持，暂不分配到文案。'
        : grounded ? '受控词表与本品资料对应；仍需后续文案及平台规则校验。' : '仅有本品页面依据，保守改写时参考，不新增声明。' });
  }
  keywords.sort((a, b) => Number(b.origins.includes('user')) - Number(a.origins.includes('user'))
    || (policy.keywords.find((item) => normalize(item.phrase) === a.keyword)?.priority ?? Infinity) - (policy.keywords.find((item) => normalize(item.phrase) === b.keyword)?.priority ?? Infinity)
    || a.keyword.localeCompare(b.keyword));
  let titleCount = 0, bulletCount = 0;
  for (const keyword of keywords) {
    if (keyword.status !== 'eligible') continue;
    keyword.placement = titleCount < policy.maxTitleKeywords ? (titleCount++, 'title')
      : bulletCount < policy.maxBulletKeywords ? (bulletCount++, 'bullets') : 'description_or_search_terms';
  }
  if (keywords.some((keyword) => keyword.status !== 'eligible')) notices.push({ code: 'keyword_unverified', message: '部分关键词缺少依据或仅来自页面，保留核实项，不强行埋词。' });
  const sellingPoints: SellingPointPlan[] = [];
  for (const attribute of [...new Set(usable.map((fact) => fact.attribute))]) {
    const facts = usable.filter((fact) => fact.attribute === attribute);
    const relatedTopicIds = insights.filter((insight) => insight.factIds.some((id) => facts.some((fact) => fact.id === id))).map((insight) => insight.topicId);
    sellingPoints.push({ id: 'point-' + hash(JSON.stringify([book.version, attribute])).slice(0, 24), attribute,
      facts: facts.map((fact) => ({ id: fact.id, originalValue: fact.rawValue, excerpt: fact.provenance.excerpt, sourceId: fact.provenance.sourceId, trust: fact.trust })),
      status: facts.some((fact) => fact.trust === 'user_provided') ? 'grounded' : 'page_only',
      emphasis: relatedTopicIds.length ? 'buyer_question' : 'product_information', relatedTopicIds,
      instruction: '仅表达所列本品事实，保留否定、限定条件、费用及包装排除项；不要增加竞品功能、性能保证或因果承诺。' });
  }
  const excludedFactIds = book.facts.filter((fact) => fact.status !== 'usable').map((fact) => fact.id);
  if (excludedFactIds.length || usable.some((fact) => fact.trust === 'page_unverified')) notices.push({ code: 'facts_unverified', message: '冲突和待核实候选不进入卖点，页面事实另行标注。' });
  const status = book.status === 'needs_clarification' || research.status === 'needs_clarification' ? 'needs_clarification'
    : book.status === 'needs_sources' ? 'needs_sources'
      : notices.length || book.status === 'ready_limited' ? 'ready_limited' : 'ready';
  const payload = { factVersion: book.version, policyVersion: policy.version, requestId: book.requestId, owner: { ...book.owner }, surface: { ...book.surface },
    status, keywords, insights, sellingPoints, excludedFactIds, notices };
  return { ...payload, status, version: hash(JSON.stringify({ payload, policy, researchEvidence: research.evidence.map((item) => [item.id, item.sha256]), gaps: research.gaps })) };
}
