import { z } from 'zod';
import { factBindingSchema } from './evidence-facts.js';
import { documentRenderSchema, type DocumentRender } from './document-render.js';
import { applyContentChanges, isJsonValue } from './json-revision.js';

const path = z.string().min(11).max(1000).startsWith('/document/');
export const documentRevisionSchema = z.strictObject({
  draft_id: z.string().min(1).max(200),
  changes: z.array(z.union([
    z.strictObject({path, op:z.literal('set').optional(), value:z.unknown().refine(v=>isJsonValue(v),'Replacement must be JSON')}),
    z.strictObject({path, op:z.literal('remove')})
  ])).min(1).max(40),
  fact_bindings: z.array(factBindingSchema).max(150).optional()
});
export function applyDocumentRevision(draft: DocumentRender, input:unknown): DocumentRender {
  const args = documentRevisionSchema.parse(input);
  const next = applyContentChanges(documentRenderSchema.parse(draft),args.changes,'document');
  const facts = new Map(next.fact_bindings?.map(f=>[f.id,f]));
  const seen = new Set<string>();
  for (const f of args.fact_bindings ?? []) {
    if (seen.has(f.id)) throw new Error('FACT_ID_DUPLICATE');
    seen.add(f.id); facts.set(f.id,f);
  }
  const references = new Set(Array.from(JSON.stringify(next.document).matchAll(/\{\{fact:([A-Za-z][A-Za-z0-9_-]{0,63})\}\}/g),m=>m[1]));
  const retained = [...facts.values()].filter(f=>references.has(f.id));
  if (retained.length || next.fact_bindings !== undefined || args.fact_bindings !== undefined) next.fact_bindings = retained;
  else delete next.fact_bindings;
  return documentRenderSchema.parse(next);
}
export const documentRevisionTool = {
  type:'function', name:'revise_document',
  description:'用最新 draft_id 局部修正文档。changes 使用 JSON pointer，例如 /document/blocks/0/text；可 set/remove 或 /- 追加，最终必须符合 render_document schema，块 id 必须唯一且保持稳定。可替换表格或图表 source（宿主重新核验证据）；不允许修改主题、文件路径、渲染器。fact_bindings 按 id 补充替换，自动移除不再引用的绑定。失败草稿可原样重试；成功草稿无变化不重复渲染。',
  inputSchema:z.toJSONSchema(documentRevisionSchema)
};
