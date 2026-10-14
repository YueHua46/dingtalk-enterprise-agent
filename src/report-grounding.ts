import type { ReportRender } from './report-render.js';
import type { EvidenceFileEntry } from './evidence-manifest.js';

const metadata = new Set(['report_title', 'marketplace', 'analysis_period', 'store_name', 'asins', 'advertising_stage', 'sources']);
const advice = new Set(['recommendation', 'action', 'observation', 'rollback', 'when', 'check', 'acceptance', 'mitigation', 'confirmation', 'review']);
const planAdvice = new Set(['id', 'priority', 'proposal', 'conditions', 'observation', 'acceptance', 'stop_loss', 'rollback', 'confirmation']);
const legacyTables = new Set(['overall_metrics', 'anomalies', 'search_terms', 'targets', 'placements', 'budget_bid', 'negatives', 'execution_plan', 'review_plan', 'risks']);
// Unicode character classification, independent of business labels/thresholds.
function hasNumber(text: string): boolean {
  return /\p{Number}/u.test(text);
}

/** Prevent transcription errors at compilation time. This does not establish
 * population, causality, completeness, or whether advice hides an observation;
 * those remain semantic review responsibilities, including metadata. */
export function assertReportGrounding(payload: ReportRender, sources: EvidenceFileEntry[]): void {
  const numericSource = sources.some(source => ['observation', 'calculation'].includes(source.kind ?? '')
    && source.tables?.some(table => table.rows > 0 && Object.values(table.fields).some(types => types.includes('number'))));
  // A no-data report or text-only evidence has no numeric binding contract.
  if (!numericSource) return;
  if (!payload.fact_bindings?.length) throw new Error('REPORT_FACT_BINDINGS_REQUIRED');
  const records = payload.report as Record<string, unknown>;
  if (['budget_bid','execution_plan','review_plan','risks'].some(key => Array.isArray(records[key]) && (records[key] as unknown[]).length))
    throw new Error('REPORT_ACTION_PLAN_REQUIRED: 建议、复盘、风险使用单一 action_plan，宿主生成重复表格；不要手写多套规则');
  const ids = new Set(payload.fact_bindings.map(binding => binding.id));
  let used = false;
  const walk = (node: unknown, path: string, parts: string[]): void => {
    if (parts.length === 1 && metadata.has(parts[0]!)) return;
    // Advice exemptions are structural, never activated by text such as
    // "建议" or a user-controlled column name in arbitrary sections.
    if (parts.length === 3 && ((parts[0] === 'action_plan' && planAdvice.has(parts[2]!))
      || (legacyTables.has(parts[0]!) && advice.has(parts[2]!)))) return;
    if (typeof node === 'string') {
      const literal = node.replace(/\{\{fact:([A-Za-z][A-Za-z0-9_-]{0,63})\}\}/g, (_, id: string) => {
        if (!ids.has(id)) throw new Error(`FACT_REFERENCE_UNKNOWN: ${id}`);
        used = true;
        return '';
      });
      if (literal.includes('{{fact:')) throw new Error('FACT_REFERENCE_INVALID');
      if (hasNumber(literal)) throw new Error(`REPORT_LITERAL_FACT_REQUIRES_BINDING:${path}`);
    } else if (typeof node === 'number') {
      throw new Error(`REPORT_LITERAL_FACT_REQUIRES_BINDING:${path}`);
    } else if (Array.isArray(node)) {
      node.forEach((value, index) => walk(value, `${path}.${index}`, [...parts, String(index)]));
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`, [...parts, key]);
    }
  };
  walk(payload.report, 'report', []);
  if (!payload.evidence_tables?.length && !used) throw new Error('REPORT_FACT_REFERENCE_REQUIRED');
}
