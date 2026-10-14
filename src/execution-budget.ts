export type ExecutionLane = 'discovery' | 'preparation' | 'collection' | 'computation' | 'delivery' | 'control';
export interface ExecutionBudgetState {
  used: Partial<Record<ExecutionLane, number>>;
  exhausted: ExecutionLane[];
}

// Independent reserves: exhausting exploration cannot consume file delivery.
export const EXECUTION_LIMITS: Record<ExecutionLane, number> = {
  discovery: 8, preparation: 24, collection: 40, computation: 24, delivery: 12, control: 24
};

export function executionLane(namespace: string, tool: string): ExecutionLane {
  if ((namespace === 'agent' && tool === 'capabilities') || (namespace === 'lingxing' && tool === 'catalog')
    || (namespace === 'reference' && tool === 'list_guides') || (namespace === 'dingtalk' && tool === 'schema')) return 'discovery';
  if (namespace === 'reference') return 'preparation';
  if (namespace === 'analysis') return 'computation';
  if (namespace === 'artifact' && ['render_report', 'submit'].includes(tool)) return 'delivery';
  if (namespace === 'agent' && tool === 'workflow') return 'control';
  return 'collection';
}

export function takeExecutionBudget(state: ExecutionBudgetState, lane: ExecutionLane, completing = false) {
  // Finalization must remain callable even when all other reserves are spent.
  if (completing) return { allowed: true, remaining: 1, converging: state.exhausted.length > 0 };
  const used = state.used[lane] ?? 0;
  if (used >= EXECUTION_LIMITS[lane]) {
    if (!state.exhausted.includes(lane)) state.exhausted.push(lane);
    return { allowed: false, remaining: 0, converging: true };
  }
  state.used[lane] = used + 1;
  return { allowed: true, remaining: EXECUTION_LIMITS[lane] - used - 1,
    converging: state.exhausted.length > 0 || used + 1 >= EXECUTION_LIMITS[lane] - 3 };
}

export function budgetFeedback(lane: ExecutionLane, allowed: boolean): string {
  return `${allowed ? 'EXECUTION_CONVERGE' : 'EXECUTION_LANE_EXHAUSTED'}: ${lane} 阶段${allowed ? '接近额度' : '额度已耗尽'}。复用已保存的证据与计算，停止无新增信息的探索；其他阶段有独立额度，仍可计算、修正、render_report、submit 和 complete。证据不足时准确说明缺口，不得宣称完整完成。`;
}
