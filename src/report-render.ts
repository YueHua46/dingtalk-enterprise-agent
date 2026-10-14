import { z } from 'zod';

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
  description: '用结构化内容生成广告 PDF，自动处理中文字体、排版和分页。数值表优先通过 evidence_tables 指定 evidenceId、rows_path、columns(field/label)，宿主直接读取保存结果填入表格，无需抄数字。sections 承载解释和建议。内容须包含证据口径与缺口。只生成文件，随后用 artifact.submit 审核并发送。',
  inputSchema: z.toJSONSchema(reportRenderSchema)
};
