import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ListingRevisionContext, ListingRevisionScope, ListingRevisionVersion } from './listing-revision.js';
import type { ListingResearchResult } from './listing-research.js';
import { researchProductResponseSchema } from './listing-research.js';
import { validateListingDraft } from './listing-validation.js';

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])) : v;
const scopeKey = (s: ListingRevisionScope) => JSON.stringify([s.requestId, s.owner, s.surface]);
const line = z.string().max(32767).refine(s => !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s), 'Control character in export');
const row = z.array(line).max(10);
export const listingExportSchema = z.strictObject({
  formatVersion: z.literal('listing-export-v1'), versionId: z.string().regex(/^[a-f0-9]{64}$/),
  title: line, subtitle: line, summary: line, scope: z.strictObject({ requestId: line,
    owner: z.strictObject({ corpId: line, userId: line }), surface: z.strictObject({ type: z.enum(['direct', 'group']), id: line }) }),
  sections: z.array(z.strictObject({ title: line, headers: row, rows: z.array(row).max(500) })).max(12),
}).refine(p => Buffer.byteLength(JSON.stringify(p), 'utf8') <= 2_000_000, 'Export budget exceeded');
export type ListingExport = z.infer<typeof listingExportSchema>;

/** Keep UTF-8 characters intact across HTTP chunks and enforce the actual byte budget. */
export async function readListingExportBody(chunks: AsyncIterable<Uint8Array>, maxBytes = 2_000_000) {
  const buffers: Uint8Array[] = []; let size = 0;
  for await (const chunk of chunks) {
    size += chunk.byteLength; if (size > maxBytes) throw new Error('LISTING_EXPORT_INPUT_LIMIT');
    buffers.push(chunk);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(buffers));
}

function verifyVersion(v: ListingRevisionVersion, scope: ListingRevisionScope) {
  const { id, ...body } = v;
  if (scopeKey(v.scope) !== scopeKey(scope)) throw new Error('LISTING_EXPORT_SCOPE_MISMATCH');
  if (hash(body) !== id) throw new Error('LISTING_EXPORT_HISTORY_INVALID');
}
const label = (path: string) => path.startsWith('bullets.') ? `五点 ${Number(path.slice(8)) + 1}`
  : ({ title: '标题', description: '描述', searchTerms: '后台搜索词', task: '整体' } as Record<string, string>)[path] ?? path;
const attributeLabel = (key: string) => ({ brand: '品牌', model: '型号', product_type: '产品类型', resolution: '分辨率', connectivity: '连接方式', power: '供电',
  night_vision: '夜视', storage: '存储', subscription: '订阅', compatibility: '兼容性', installation: '安装条件', protection: '防护等级', package: '包装内容', weight: '重量' } as Record<string, string>)[key] ?? key;
const fieldMap = (v: ListingRevisionVersion) => new Map([
  ['title', v.draft.title.text], ...v.draft.bullets.map((b, i) => [`bullets.${i}`, b.text] as [string, string]),
  ['description', v.draft.description.text], ['searchTerms', v.draft.searchTerms.text],
]);

/** Host-only builder. Reads saved history and current host context; never accepts model copyable flags. */
export function buildListingExport(scope: ListingRevisionScope, version: ListingRevisionVersion,
  current: ListingRevisionContext, options: { previous?: ListingRevisionVersion; research?: ListingResearchResult } = {}): ListingExport {
  verifyVersion(version, scope);
  if (![current.prepared, current.book, current.plan].every(s => scopeKey(s) === scopeKey(scope))) throw new Error('LISTING_EXPORT_SCOPE_MISMATCH');
  // A changed fact book must go through revision/rebinding before it can be exported.
  if (hash(current.book) !== hash(version.context.book) || hash(current.plan) !== hash(version.context.plan)
    || hash(current.prepared) !== hash(version.context.prepared)) throw new Error('LISTING_EXPORT_CONTEXT_CHANGED');
  const validation = validateListingDraft(version.draft, current.prepared, current.book, current.plan, current.rules, current.validationPolicy);
  if (validation.status === 'invalid') throw new Error('LISTING_EXPORT_INVALID_DRAFT');
  const previous = options.previous;
  if (previous) { verifyVersion(previous, scope); if (version.parentId !== previous.id) throw new Error('LISTING_EXPORT_PREVIOUS_MISMATCH'); }
  const research = options.research;
  if (research && scopeKey(research) !== scopeKey(scope)) throw new Error('LISTING_EXPORT_SCOPE_MISMATCH');
  const evidence = new Map(research?.evidence.map(e => {
    if (createHash('sha256').update(e.content).digest('hex') !== e.sha256) throw new Error('LISTING_EXPORT_EVIDENCE_INVALID');
    return [e.id, e];
  }) ?? []);
  if (research && evidence.size !== research.evidence.length) throw new Error('LISTING_EXPORT_EVIDENCE_INVALID');
  function productFromEvidence(id: string, product: unknown) {
    const e = evidence.get(id); if (!e || e.tool !== 'amazon.get_product_detail') throw new Error('LISTING_EXPORT_EVIDENCE_MISSING');
    const raw = JSON.parse(e.content);
    const parsed = researchProductResponseSchema.safeParse(raw);
    // Compare the same bounded projection used during collection. Raw API metadata
    // and trimmed whitespace are retained as evidence, but are not product fields.
    if (!parsed.success || hash(canonical(parsed.data.data)) !== hash(canonical(product))) throw new Error('LISTING_EXPORT_EVIDENCE_INVALID');
    return e;
  }
  const original = new Map<string, string>();
  if (research?.originalListing && current.prepared.input.mode === 'optimize') {
    const { product, evidenceId } = research.originalListing; productFromEvidence(evidenceId, product);
    if (product.asin !== current.prepared.input.asin) throw new Error('LISTING_EXPORT_ASIN_MISMATCH');
    original.set('title', product.title); product.bullets.forEach((b, i) => original.set(`bullets.${i}`, b));
  }
  const facts = new Map(current.book.facts.map(f => [f.id, f]));
  const prior = previous ? fieldMap(previous) : new Map<string, string>();
  const rows = [...fieldMap(version)].map(([path, value]) => {
    const check = validation.fields.find(f => f.field === path);
    const issues = validation.issues.filter(i => i.field === path || i.field === 'task');
    const refs = path === 'searchTerms' ? version.draft.searchTerms.factIds
      : validation.claimChecks.filter(c => c.field === path).flatMap(c => c.factIds);
    const sources = [...new Set(refs)].map(id => { const f = facts.get(id); return f ? `${attributeLabel(f.attribute)}: ${f.rawValue} [${f.provenance.reference}]${f.trust === 'page_unverified' ? '（页面来源，未经独立核实）' : ''}` : '出处无效'; }).join('\n');
    const reason = [...new Set(version.draft.changes.filter(c => c.field === path || (path.startsWith('bullets.') && c.field === 'bullets')).map(c => c.reasonZh))].join('\n') || '未提供修改原因';
    return [label(path), original.get(path) ?? (current.prepared.input.mode === 'create' ? '新品，无原页面' : '未取得原页面字段'),
      prior.get(path) ?? '无上一版', value, check?.copyable ? value : '', reason, sources,
      issues.length ? issues.map(i => i.message).join('\n') : check?.copyable ? '代码检查通过；平台合规未完全确定' : '字段未完成检查'];
  });
  const competitors = (research?.competitors ?? []).map(c => {
    const e = productFromEvidence(c.evidenceId, c.product);
    return [c.product.asin, c.product.title, c.origin === 'auto' ? '自动寻找' : '运营指定', c.reasons.join('\n'),
      `价格: ${c.product.price ?? '未取得'} USD; 评分: ${c.product.rating ?? '未取得'}; 评论数: ${c.product.review_count ?? '未取得'}`,
      `https://www.amazon.com/dp/${c.product.asin}`, e.observedAt,
      c.comparisonEligibility === 'needs_verification' ? '相关性待核实；公开信号不代表实际销量' : '公开信号不代表实际销量'];
  });
  const count = validation.fields.filter(f => f.copyable).length;
  const notices = [...validation.issues.map(i => `${label(i.field)}: ${i.message}`), ...version.draft.verificationItems.map(i => i.messageZh),
    ...(research?.gaps.map(g => g.message) ?? ['未提供本次调研记录，竞品参考未完成'])];
  const mode = current.prepared.input.mode;
  const summary = `美国站英文${mode === 'create' ? '新品生成' : 'Listing 优化'}，第 ${version.ordinal} 版。${count}/${rows.length} 个字段可复制。\n`
    + `修改方向：${version.draft.changes.map(c => c.reasonZh).slice(0, 3).join('；') || version.instruction || '按产品资料整理文案'}\n`
    + `需要核实：${[...new Set(notices)].slice(0, 5).join('；') || '无额外核实项'}\n文件为运营参考稿，不是 Amazon 上传模板；不会修改后台。`;
  return listingExportSchema.parse({ formatVersion: 'listing-export-v1', versionId: version.id, scope: structuredClone(scope),
    title: mode === 'create' ? 'Amazon 新品文案' : 'Amazon Listing 优化对比',
    subtitle: `美国站 / 英文 / ${current.prepared.input.asin ?? '新品'} / 第 ${version.ordinal} 版 / ${version.createdAt.slice(0, 10)}`,
    summary, sections: [
      { title: '文案对比', headers: ['字段', '原页面（未经独立核实）', '上一版草稿', '当前参考稿', '可复制文案', '中文修改原因（生成建议）', '产品依据', '检查结果'], rows },
      { title: mode === 'create' ? '产品事实与生成依据' : '产品事实与出处', headers: ['属性', '完整产品事实', '资料来源', '原文摘录', '事实状态'],
        rows: current.book.facts.map(f => [attributeLabel(f.attribute), f.rawValue, f.provenance.reference, f.provenance.excerpt, `${f.status === 'usable' ? '可用' : f.status === 'conflicting' ? '有冲突' : '待核实'}; ${f.trust === 'page_unverified' ? '页面来源，未经独立核实' : '运营提供'}`]) },
      { title: '竞品参考', headers: ['ASIN', '标题', '选择方式', '选择原因', '公开信号', '来源', '采集时间', '限制'], rows: competitors.length ? competitors : [['未取得竞品记录', '', '', '', '', '', '', '未编造竞品分析']] },
      { title: '核实事项', headers: ['需核实内容'], rows: [...new Set(notices)].map(n => [n]) },
      { title: '版本与规则', headers: ['项目', '版本或状态'], rows: [['文案版本', version.id], ['模型', version.generationReceipt?.metadata.model ?? '手动修订'],
        ['规则版本', current.rules.version], ['规则覆盖', current.rules.coverage === 'product_type_verified' ? '已核实具体产品类型' : '具体产品类型规则待核实'], ['校验器', validation.validatorVersion],
        ['平台合规', '未完全确定'], ['文件用途', '运营参考稿，不是 Amazon 上传模板']] },
    ] });
}

export interface ListingExportPorts {
  render(taskId: string, payload: ListingExport, signal?: AbortSignal): Promise<{ docx: string; xlsx: string }>;
  /** Host artifact.submit performs type/hash checking, scanning, scope-bound receipt and unknown-result protection. */
  submit(path: string, signal?: AbortSignal): Promise<unknown>;
}
export async function deliverListingExport(taskId: string, payload: ListingExport, ports: ListingExportPorts, signal?: AbortSignal) {
  const snapshot = listingExportSchema.parse(structuredClone(payload));
  const cancelled = () => { if (signal?.aborted) throw new Error('LISTING_EXPORT_CANCELLED'); };
  cancelled(); const files = await ports.render(taskId, snapshot, signal); cancelled();
  // Sequential: do not retry a submission with an unknown outcome. Host persists per-file receipts.
  const receipts = [];
  for (const path of [files.docx, files.xlsx]) { cancelled(); receipts.push(await ports.submit(path, signal)); }
  return { summary: snapshot.summary, versionId: snapshot.versionId, files, receipts };
}
