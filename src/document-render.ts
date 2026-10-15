import { z } from 'zod';
import { factBindingSchema } from './evidence-facts.js';

const text = z.string().min(1).max(12000)
  .refine(value => !/\\[nr]/u.test(value), 'Use actual line breaks or separate paragraphs/items, not literal escaped newlines');
const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const cell = z.union([z.string().max(12000), z.number().finite(), z.boolean(), z.null()]);
const base = {id, title: z.string().min(1).max(500).optional()};
export const documentSourceSchema = z.strictObject({
  evidenceId: z.string().min(1), rows_path: z.string().default('data.rows'),
  where: factBindingSchema.shape.where,
  offset: z.number().int().min(0).max(100000).default(0),
  limit: z.number().int().min(1).max(500).default(30)
});
const field = text.refine(value => !value.includes('{{fact:'), 'Field names cannot contain fact references');
const column = z.strictObject({field, label: text});
const series = z.strictObject({field, label: text});
const summary = z.strictObject({...base, type: z.literal('summary'), text});
// A highlight is a presentation component, not a container for a whole report.
// Keep the compiled schema permissive: resolving a bound name may expand text.
const highlight = text.max(480, 'Short highlights support at most 480 characters; use text.paragraphs, table or actions for detail')
  .refine(value => !/[\r\n\u2028\u2029]/u.test(value), 'A highlight is one short paragraph; use text.paragraphs for separate explanations, table for comparisons, or actions for recommendations');
const paragraph = z.strictObject({...base, type: z.literal('text'), paragraphs: z.array(text).min(1).max(80)});
const metrics = z.strictObject({...base, type: z.literal('metrics'), items: z.array(z.strictObject({
  label: text, value: cell, note: text.optional()
})).min(1).max(12)});
const actions = z.strictObject({...base, type: z.literal('actions'), items: z.array(z.strictObject({
  priority: text.optional(), object: text.optional(), evidence: text.optional(), proposal: text,
  conditions: text.optional(), review: text.optional(), confirmation: text.optional()
})).min(1).max(30)});
const callout = z.strictObject({...base, type: z.literal('callout'),
  tone: z.enum(['info', 'warning', 'critical', 'success']).default('info'), text});
const table = z.strictObject({...base, type: z.literal('table'),
  columns: z.array(column).min(1).max(12), rows: z.array(z.array(cell)).max(500).optional(),
  source: documentSourceSchema.optional(), caption: text.optional()
});
const chart = z.strictObject({...base, type: z.literal('chart'), kind: z.enum(['line', 'bar']),
  category_field: field, series: z.array(series).min(1).max(4),
  source: documentSourceSchema, unit: z.string().max(80).optional(), caption: text.optional()
});
export const documentBlockSchema = z.discriminatedUnion('type', [summary.extend({text:highlight}), paragraph, metrics, actions, callout.extend({text:highlight}), table, chart]);
const documentFields = {
  title: text, subtitle: text.optional(),
  metadata: z.array(z.strictObject({label: text, value: text})).max(16).optional(),
  sources: z.array(text).max(40).optional()
};
const envelope = {format: z.literal('pdf'), theme: z.literal('ops-clean').default('ops-clean'),
  detail: z.enum(['brief', 'standard', 'full']).default('brief')};

/** The model chooses composition, never paths, HTML, executable code or chart values. */
export const documentRenderSchema = z.strictObject({...envelope,
  document: z.strictObject({...documentFields, blocks: z.array(documentBlockSchema).min(1).max(80)}),
  fact_bindings: z.array(factBindingSchema).max(150).optional()
}).superRefine((payload, ctx) => {
  const ids = new Set<string>();
  payload.document.blocks.forEach((block, index) => {
    if (ids.has(block.id)) ctx.addIssue({code: 'custom', path: ['document','blocks',index,'id'], message: 'Duplicate block id'});
    ids.add(block.id);
    if (block.type === 'table') {
      if (Boolean(block.source) === Boolean(block.rows)) ctx.addIssue({code:'custom',path:['document','blocks',index],message:'Provide exactly one of source or rows'});
      if (block.rows?.some(row => row.length !== block.columns.length)) ctx.addIssue({code:'custom',path:['document','blocks',index,'rows'],message:'Each row must match columns'});
    }
    if (block.type === 'chart' && block.source.limit > 80) ctx.addIssue({code:'custom',path:['document','blocks',index,'source','limit'],message:'At most 80 chart categories; aggregate first'});
  });
});
export type DocumentRender = z.infer<typeof documentRenderSchema>;
export type DocumentBlock = DocumentRender['document']['blocks'][number];

// Private worker contract. Only the host can materialize these values after
// checking the saved evidence digest. No caller-provided HTML is accepted.
const compiledTable = z.strictObject({...base, type: z.literal('table'),
  columns: z.array(column).min(1).max(12), rows: z.array(z.array(cell)).max(500),
  caption: text.optional(), coverage: text.optional()});
const compiledChart = z.strictObject({...base, type: z.literal('chart'), kind: z.enum(['line','bar']),
  categories: z.array(cell).min(1).max(80),
  series: z.array(z.strictObject({label: text, values: z.array(z.number().finite().nullable()).min(1).max(80)})).min(1).max(4),
  unit: z.string().max(80).optional(), caption: text.optional(), coverage: text.optional()});
export const compiledDocumentSchema = z.strictObject({...envelope,
  document: z.strictObject({...documentFields,
    references:z.array(z.strictObject({id:text,title:text,provider:text.optional(),sections:z.array(z.strictObject({title:text,items:z.array(z.strictObject({label:text,value:text})).max(200)})).max(10).optional(),notes:z.array(text).max(40).optional(),inputs:z.array(text).max(200).optional(),details:z.array(text).max(40).optional()})).max(200).optional(),
    blocks: z.array(z.discriminatedUnion('type',
    [summary.extend({sourceRefs:z.array(text).optional()}), paragraph.extend({sourceRefs:z.array(text).optional()}),
      metrics.extend({sourceRefs:z.array(text).optional()}), actions.extend({sourceRefs:z.array(text).optional()}),
      callout.extend({sourceRefs:z.array(text).optional()}), compiledTable.extend({sourceRefs:z.array(text).optional()}),
      compiledChart.extend({sourceRefs:z.array(text).optional()})])).min(1).max(80)})
}).superRefine((payload, ctx) => {
  const ids = new Set<string>();
  payload.document.blocks.forEach((block, index) => {
    if (ids.has(block.id)) ctx.addIssue({code:'custom',path:['document','blocks',index,'id'],message:'Duplicate block id'});
    ids.add(block.id);
    if (block.type === 'table' && block.rows.some(row => row.length !== block.columns.length))
      ctx.addIssue({code:'custom',path:['document','blocks',index],message:'Table width mismatch'});
    if (block.type === 'chart' && block.series.some(s => s.values.length !== block.categories.length))
      ctx.addIssue({code:'custom',path:['document','blocks',index],message:'Chart length mismatch'});
  });
});
export type CompiledDocument = z.infer<typeof compiledDocumentSchema>;
export type DocumentOutput = {path: string; source: string; previews: string[]; pageCount: number};

const documentBlockContract = '\n内容块字段约定（只说明 API，不是章节模板）：summary{text}；text{paragraphs:string[]}；metrics{items:[{label,value,note?}]}；actions{items:[{proposal,priority?,object?,evidence?,conditions?,review?,confirmation?}]}；callout{text,tone:info|warning|critical|success}；table{columns:[{field,label}],source}；chart{kind:line|bar,category_field,series:[{field,label}],source}。每块有id、type，可选title。source={evidenceId,rows_path,where,offset,limit}，limit只在source内。普通文本原样显示，不解析 Markdown；标题放 title，对照数据用 table，行动用 actions，独立说明用 paragraphs。summary/callout 适合简短重点，不要把整份分析、竖线伪表格或多项筛选塞进一个字符串。直接按schema生成实际内容，不用测试文档探测字段形状。';

export const documentRenderTool = {
  type: 'function', name: 'render_document',
  description: '用户明确要求 PDF 时首选的通用文档能力：按用户问题自由选择、排列 summary/metrics/text/table/actions/callout/chart，不强制封面、章节或页数；ops-clean 统一视觉。brief 优先简短，不为填模板扩写。数值事实、对象 ID、含数字名称用 fact_bindings 与 {{fact:id}}；字符串名称和ID的绑定省略decimals及suffix，只有数值指标才设置decimals，suffix仅允许空字符串或%，币种写在周围文案中。用户指定日期放subtitle/metadata，正文数字与块标题中的观测数量仍需绑定；建议数字写在 actions.proposal/conditions/review，不能冒充观测。表格用 block.source 直接绑定保存的证据（where/offset/limit），不要抄数；图表必须 source + category_field + series.field，按需使用 line/bar，同一图使用相同单位，不允许手填数据、隐式聚合或把缺失值当零。宿主根据这些绑定自动生成来源编号和核验附录（实际来源系统、报表、店铺、日期、业务筛选与计算说明），无需手写UUID或重复附录；仍需说明业务含义和对比口径。先用 analysis.table 做计算与排序，日期线图用order_by={field:日期字段,descending:false}。汇总不能用limit截取单个来源分组冒充整体。返回 HTML 源文件、实际 PDF 及页面预览；检查预览后 artifact.submit 核验并发送。修改用 revise_document 的 draft_id 和 JSON pointer。' + documentBlockContract,
  inputSchema: z.toJSONSchema(documentRenderSchema)
};
