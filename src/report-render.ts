import { z } from 'zod';
import { factBindingSchema } from './evidence-facts.js';
import { reportActionSchema } from './report-actions.js';

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
    action_plan: z.array(reportActionSchema).max(20).optional(),
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
  description: '生成广告 PDF。已有数值证据时必须用 fact_bindings={id,evidenceId,rows_path,where,field,decimals?,suffix?} 和 {{fact:id}} 引用正文事实，金额、比率、数量、对象ID以及含数字的名称不能手抄；附表用 evidence_tables。where准确指定唯一对象行；派生指标先analysis.table一次计算；百分号仅附加不缩放。行动建议只传report.action_plan，每条{id,priority,object,problem,evidence,proposal,conditions,observation,acceptance,stop_loss,rollback,confirmation}，object/evidence引用事实；不要重复传budget_bid/execution_plan/review_plan/risks或在其他节重写行动规则，宿主从这一份记录生成全部执行和复盘表。建议阈值只写proposal/conditions/observation/acceptance/stop_loss/rollback等建议字段；sections用于短诊断，观测数字都用引用。范围、覆盖、因果仍须核验。返回draft_id后需修正只用revise_report局部修改。最后submit审核并发送；摘要仅简短交付说明。',
  inputSchema: z.toJSONSchema(reportRenderSchema)
};
