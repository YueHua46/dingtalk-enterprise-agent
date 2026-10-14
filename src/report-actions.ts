import { z } from 'zod';
import type { ReportRender } from './report-render.js';

const text = z.string().min(1);
const factReference = /\{\{fact:[A-Za-z][A-Za-z0-9_-]{0,63}\}\}/;

export const reportActionSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  priority: text,
  object: text.regex(factReference, 'Action object must reference a bound fact'),
  problem: text,
  evidence: text.regex(factReference, 'Action evidence must reference a bound fact'),
  proposal: text,
  conditions: text,
  observation: text,
  acceptance: text,
  stop_loss: text,
  rollback: text,
  confirmation: text
});

/** Called after fact interpolation: each repeated plan derives from one action. */
export function materializeReportActions(report: ReportRender['report']): ReportRender['report'] {
  // The renderer constructs these table schemas dynamically, so its inferred
  // TypeScript shape does not retain their names even though Zod accepts them.
  const next = structuredClone(report) as ReportRender['report'] & Partial<Record<
    'budget_bid' | 'execution_plan' | 'review_plan' | 'risks', Array<Record<string, string>>>>;
  const actions = next.action_plan;
  delete next.action_plan;
  if (!actions?.length) return next;
  for (const table of ['budget_bid', 'execution_plan', 'review_plan', 'risks'] as const) {
    if (next[table]?.length) throw new Error('REPORT_ACTIONS_DUPLICATED');
  }
  const ids = new Set<string>();
  for (const action of actions) {
    if (ids.has(action.id)) throw new Error('REPORT_ACTION_ID_DUPLICATE');
    ids.add(action.id);
  }
  const rules = actions.map(action => `止损条件：${action.stop_loss}\n回退动作：${action.rollback}`);
  next.budget_bid = actions.map((action, index) => ({
    object: action.object, current: action.conditions, recommendation: action.proposal,
    observation: action.observation, rollback: rules[index]!
  }));
  next.execution_plan = actions.map((action, index) => ({
    priority: action.priority, object: action.object,
    action: `${action.proposal}\n成立条件：${action.conditions}\n观察计划：${action.observation}\n${rules[index]!}`,
    acceptance: action.acceptance, confirmation: action.confirmation
  }));
  next.review_plan = actions.map((action, index) => ({
    when: action.observation,
    check: `${action.object}\n建议：${action.proposal}\n成立条件：${action.conditions}`,
    acceptance: action.acceptance, rollback: rules[index]!
  }));
  next.risks = actions.map((action, index) => ({
    risk: `${action.object}\n${action.problem}`, impact: action.evidence,
    mitigation: `${action.proposal}\n成立条件：${action.conditions}\n观察计划：${action.observation}\n验收条件：${action.acceptance}\n确认要求：${action.confirmation}`,
    rollback: rules[index]!
  }));
  return next;
}
