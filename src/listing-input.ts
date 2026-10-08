import { z } from 'zod';
import type { AgentRequest } from './types.js';

const text = z.string().trim().min(1);
const asin = z.string().trim().regex(/^[A-Z0-9]{10}$/, '需要 10 位大写 ASIN');

/** Conversation adapters organize user input; this boundary does not infer product facts. */
export const listingInputSchema = z.strictObject({
  mode: z.enum(['create', 'optimize']),
  marketplace: z.literal('US').default('US'),
  language: z.literal('en').default('en'),
  asin: asin.optional(),
  objective: text.optional(),
  productType: text.optional(),
  materials: z.array(z.strictObject({
    id: text,
    kind: z.enum(['conversation', 'attachment', 'document', 'listing']),
    reference: text,
    content: text.optional(),
  })).default([]),
  // Explicit statements only. Extraction and numeric normalization belong to module 2.
  statements: z.array(z.strictObject({
    attribute: text,
    value: text,
    sourceId: text,
    excerpt: text,
  })).default([]),
  keywords: z.array(text).default([]),
  competitors: z.strictObject({
    strategy: z.enum(['auto', 'specified', 'mixed']).default('auto'),
    asins: z.array(asin).default([]),
  }).default({ strategy: 'auto', asins: [] }),
}).superRefine((input, ctx) => {
  if (input.mode === 'optimize' && !input.asin) {
    ctx.addIssue({ code: 'custom', path: ['asin'], message: '优化任务需要本品 ASIN' });
  }
  if (input.mode === 'create' && input.asin) {
    ctx.addIssue({ code: 'custom', path: ['asin'], message: '已有 ASIN 请使用 optimize 模式' });
  }
  if (input.competitors.strategy !== 'auto' && input.competitors.asins.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['competitors', 'asins'], message: '指定或混合调研需要竞品 ASIN' });
  }
  if (input.competitors.strategy === 'auto' && input.competitors.asins.length) {
    ctx.addIssue({ code: 'custom', path: ['competitors'], message: '提供竞品时请选择 specified 或 mixed' });
  }
  if (input.asin && input.competitors.asins.includes(input.asin)) {
    ctx.addIssue({ code: 'custom', path: ['competitors', 'asins'], message: '本品不能作为自己的竞品' });
  }
});

export type ListingInput = z.infer<typeof listingInputSchema>;

/** Built by the host after importing/reading sources, never supplied by the model. */
export interface ListingInputContext {
  request: Pick<AgentRequest, 'requestId' | 'messageId' | 'user' | 'surface' | 'text' | 'attachments'>;
  documentSnapshots: Readonly<Record<string, string>>;
  listingSnapshots: Readonly<Record<string, string>>;
}

export interface ListingInputIssue {
  code: 'missing_product_information' | 'missing_listing' | 'unread_material' | 'conflicting_statements' | 'unverified_page';
  message: string;
  sourceIds: string[];
  attribute?: string;
}

export interface PreparedListingInput {
  input: ListingInput;
  owner: { corpId: string; userId: string };
  surface: AgentRequest['surface'];
  requestId: string;
  status: 'needs_clarification' | 'needs_sources' | 'ready' | 'ready_limited';
  issues: ListingInputIssue[];
  originalRequest: string;
}

const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/** Pure preparation: no network, model calls, file access, or writes. */
export function prepareListingInput(raw: unknown, context: ListingInputContext): PreparedListingInput {
  const input = listingInputSchema.parse(raw);
  const { request } = context;
  if (!request.user.corpId || !request.user.userId || !request.surface.id) throw new Error('LISTING_IDENTITY_REQUIRED');
  const sources = new Map<string, ListingInput['materials'][number]>();
  for (const material of input.materials) {
    if (sources.has(material.id)) throw new Error('LISTING_DUPLICATE_SOURCE');
    sources.set(material.id, material);
    if (material.kind === 'conversation') {
      if (material.reference !== request.messageId || !material.content || !request.text.includes(material.content)) {
        throw new Error('LISTING_CONVERSATION_SOURCE_INVALID');
      }
    } else if (material.kind === 'attachment') {
      const attachment = request.attachments.find((item) => item.id === material.reference);
      if (!attachment) throw new Error('LISTING_ATTACHMENT_NOT_IN_TASK');
      if (material.content && !attachment.extractedText?.includes(material.content)) throw new Error('LISTING_ATTACHMENT_CONTENT_UNVERIFIED');
    } else if (material.kind === 'document') {
      const snapshot = context.documentSnapshots[material.reference];
      if (snapshot === undefined) throw new Error('LISTING_DOCUMENT_NOT_IN_TASK');
      if (material.content && !snapshot.includes(material.content)) throw new Error('LISTING_DOCUMENT_CONTENT_UNVERIFIED');
    } else {
      if (input.mode !== 'optimize' || material.reference !== input.asin) throw new Error('LISTING_PAGE_NOT_CURRENT_PRODUCT');
      const snapshot = context.listingSnapshots[material.reference];
      if (material.content && !snapshot?.includes(material.content)) throw new Error('LISTING_PAGE_CONTENT_UNVERIFIED');
    }
  }
  for (const statement of input.statements) {
    const source = sources.get(statement.sourceId);
    if (!source?.content?.includes(statement.excerpt) || !normalize(statement.excerpt).includes(normalize(statement.value))) {
      throw new Error('LISTING_STATEMENT_SOURCE_INVALID');
    }
  }
  input.keywords = [...new Map(input.keywords.map((item) => [normalize(item), item])).values()];
  input.competitors.asins = [...new Set(input.competitors.asins)];
  const issues: ListingInputIssue[] = [];
  for (const material of input.materials.filter((item) => !item.content)) {
    issues.push({ code: 'unread_material', message: '资料尚未读取，不能据此生成产品声明。', sourceIds: [material.id] });
  }
  const groups = new Map<string, ListingInput['statements']>();
  for (const statement of input.statements) {
    const key = normalize(statement.attribute);
    groups.set(key, [...(groups.get(key) ?? []), statement]);
  }
  for (const [attribute, statements] of groups) {
    if (new Set(statements.map((item) => normalize(item.value))).size > 1) {
      issues.push({ code: 'conflicting_statements', attribute, message: '同一属性存在不同表述，请核实后再使用；系统不自动选择来源。', sourceIds: [...new Set(statements.map((item) => item.sourceId))] });
    }
  }
  const productSources = input.materials.filter((item) => item.kind !== 'listing' && item.content);
  const hasPage = input.materials.some((item) => item.kind === 'listing' && item.content);
  if (input.mode === 'create' && productSources.length === 0 && !issues.some((item) => item.code === 'unread_material')) {
    issues.push({ code: 'missing_product_information', message: '请在对话中提供本品信息或附件，无需固定资料位置。', sourceIds: [] });
  }
  if (input.mode === 'optimize' && !hasPage) {
    issues.push({ code: 'missing_listing', message: '需要先读取本品当前 Listing，不能编造修改前文案。', sourceIds: [] });
  }
  if (input.mode === 'optimize' && hasPage && productSources.length === 0) {
    issues.push({ code: 'unverified_page', message: '页面来源、未经独立核实；仅做保守改写，不新增参数、功能或认证。', sourceIds: input.materials.filter((item) => item.kind === 'listing').map((item) => item.id) });
  }
  const status = issues.some((item) => item.code === 'conflicting_statements' || item.code === 'missing_product_information')
    ? 'needs_clarification'
    : issues.some((item) => item.code === 'unread_material' || item.code === 'missing_listing')
      ? 'needs_sources'
      : issues.some((item) => item.code === 'unverified_page') ? 'ready_limited' : 'ready';
  return {
    input, owner: { corpId: request.user.corpId, userId: request.user.userId },
    surface: { ...request.surface }, requestId: request.requestId, originalRequest: request.text, status, issues,
  };
}
