import { z } from 'zod';
import { factBindingSchema } from './evidence-facts.js';

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const columns = {
  overall_metrics: ['metric', 'value', 'benchmark', 'status'],
  anomalies: ['priority', 'object', 'issue', 'evidence', 'action'],
  search_terms: ['term', 'classification', 'evidence', 'recommendation', 'confirmation'],
  targets: ['target', 'issue', 'evidence', 'recommendation', 'review'],
  placements: ['placement', 'traffic', 'efficiency', 'recommendation'],
  budget_bid: ['object', 'current', 'recommendation', 'observation', 'rollback'],
  negatives: ['term', 'match_type', 'evidence', 'recommendation', 'language_note'],
  execution_plan: ['priority', 'object', 'action', 'acceptance', 'confirmation'],
  review_plan: ['when', 'check', 'acceptance', 'rollback'],
  risks: ['risk', 'impact', 'mitigation', 'rollback']
};
const narrativeTables = new Set(['anomalies', 'budget_bid', 'execution_plan']);
const tables = Object.fromEntries(Object.entries(columns).map(([key, fields]) => {
  const shape = Object.fromEntries(fields.map(field => [field, cell.optional()]));
  // Only narrative records render extra fields. Grid records must reject
  // unknown keys instead of silently replacing their content with "未知".
  return [key, z.array(narrativeTables.has(key)
    ? z.object(shape).passthrough() : z.strictObject(shape)).optional()];
}));
export const reportRenderSchema = z.strictObject({
  template: z.literal('amazon-advertising'),
  fact_bindings: z.array(factBindingSchema).max(150).optional(),
  evidence_tables: z.array(z.strictObject({title: z.string().min(1), evidenceId: z.string().min(1),
    rows_path: z.string().default('data.rows'),
    columns: z.array(z.strictObject({field: z.string().min(1), label: z.string().min(1)})).min(1).max(30),
    limit: z.number().int().min(1).max(500).default(30)})).max(15).optional(),
  report: z.strictObject({
    report_title: z.string().min(1), marketplace: z.string().min(1),
    analysis_period: z.string().min(1), store_name: z.string().min(1),
    asins: z.string().optional(), advertising_stage: z.string().optional(),
    executive_summary: z.string().min(1), data_quality: z.record(z.string(), cell),
    ...tables,
    // Arbitrary analytical dimensions are supported without changing layout code.
    sections: z.array(z.strictObject({title: z.string().min(1),
      paragraphs: z.array(z.string()).optional(),
      columns: z.array(z.string()).min(1).max(30).optional(),
      rows: z.array(z.array(cell)).optional()
    })).optional(),
    sources: z.array(z.string()).optional()
  })
}).superRefine((value, ctx) => {
  value.report.sections?.forEach((section, index) => {
    if (section.rows?.some(row => row.length !== section.columns?.length)) {
      ctx.addIssue({code: 'custom', path: ['report', 'sections', index], message: 'Each row must match columns'});
    }
  });
});
export type ReportRender = z.infer<typeof reportRenderSchema>;
export const reportRenderTool = {
  type: 'function', name: 'render_report',
  description: '用结构化内容生成广告 PDF。观测与计算数字优先使用 evidence_tables，正文用 fact_bindings={id,evidenceId,rows_path,where,field,decimals?,suffix?} 并写 {{fact:id}} 引用；宿主校验哈希、唯一行、原字段后填值，保存真实查询/对象/计算血缘。where 必须准确指定对象；空 where 仅用于单行结果。百分号仅附加，不缩放；派生指标先 analysis.table 计算。同一行出现的维度才可证明对象关联，不能把同店铺的独立汇总表拼成所属关系。建议数字可自行提出但须标为建议。事实引用不能代替范围、因果和完整性审核。只生成文件，随后 submit 审核并发送；摘要可复用相同 {{fact:id}}，无需抄算。',
  inputSchema: z.toJSONSchema(reportRenderSchema)
};
