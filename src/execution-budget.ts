export type ExecutionLane = 'discovery' | 'preparation' | 'collection' | 'computation' | 'rendering' | 'review' | 'delivery' | 'control';
export interface ArtifactBudgetHistory {
  calls: Array<{eventType: string; payload?: {namespace?: string; tool?: string; argumentHash?: string}}>;
  deliveryAttempts: number;
}
export interface ExecutionBudgetState {
  version?: 2;
  legacyArtifactBudget?: {used: number; exhausted: boolean; renderingCalls: number; submissionCalls: number; deliveryAttempts: number};
  migrationBlocked?: string;
  used: Partial<Record<ExecutionLane, number>>;
  exhausted: ExecutionLane[];
}

// Independent reserves: exhausting exploration cannot consume file delivery.
export const EXECUTION_LIMITS: Record<ExecutionLane, number> = {
  discovery: 8, preparation: 24, collection: 40, computation: 24, rendering: 12, review: 12, delivery: 12, control: 24
};

export function executionLane(namespace: string, tool: string): ExecutionLane {
  if ((namespace === 'agent' && tool === 'capabilities') || (namespace === 'lingxing' && tool === 'catalog')
    || (namespace === 'reference' && tool === 'list_guides') || (namespace === 'dingtalk' && tool === 'schema')) return 'discovery';
  if (namespace === 'reference') return 'preparation';
  if (namespace === 'analysis') return 'computation';
  if (namespace === 'artifact' && tool === 'render_report') return 'rendering';
  if (namespace === 'artifact' && tool === 'submit') return 'review';
  if (namespace === 'agent' && tool === 'workflow') return 'control';
  return 'collection';
}

export function takeExecutionBudget(state: ExecutionBudgetState, lane: ExecutionLane, completing = false) {
  // Finalization must remain callable even when all other reserves are spent.
  if (completing) return { allowed: true, remaining: 1, converging: state.exhausted.length > 0 };
  if (state.migrationBlocked && ['rendering','review','delivery'].includes(lane)) return {allowed:false, remaining:0, converging:true};
  const used = state.used[lane] ?? 0;
  if (used >= EXECUTION_LIMITS[lane]) {
    if (!state.exhausted.includes(lane)) state.exhausted.push(lane);
    return { allowed: false, remaining: 0, converging: true };
  }
  state.used[lane] = used + 1;
  return { allowed: true, remaining: EXECUTION_LIMITS[lane] - used - 1,
    converging: state.exhausted.length > 0 || used + 1 >= EXECUTION_LIMITS[lane] - 3 };
}

/** Split the old mixed render/submit counter only when its full audit trail reconciles.
 * Historical submissions conservatively count as reviews even if they used a cache. */
export function migrateArtifactBudget(state: ExecutionBudgetState, history?: ArtifactBudgetHistory): boolean {
  if (state.version === 2) return false;
  const used = state.used.delivery ?? 0;
  if (used === 0 && !state.exhausted.includes('delivery')) { state.version = 2; return true; }
  const block = () => { state.migrationBlocked = 'EXECUTION_BUDGET_MIGRATION_UNVERIFIED'; return false; };
  if (!history || !Number.isInteger(used) || used < 0 || !Number.isInteger(history.deliveryAttempts) || history.deliveryAttempts < 0) return block();
  const pending = new Map<string, number>();
  let renderingCalls = 0, submissionCalls = 0;
  for (const event of history.calls) {
    const p = event.payload;
    if (p?.namespace !== 'artifact' || !['render_report', 'submit'].includes(p.tool ?? '')) continue;
    if (!p.argumentHash || !['tool.call_started','tool.call_finished'].includes(event.eventType)) return block();
    const key = `${p.tool}:${p.argumentHash}`;
    const count = (pending.get(key) ?? 0) + (event.eventType === 'tool.call_started' ? 1 : -1);
    if (count < 0) return block();
    pending.set(key, count);
    if (event.eventType === 'tool.call_started') {
      if (p.tool === 'render_report') renderingCalls++; else submissionCalls++;
    }
  }
  if (renderingCalls + submissionCalls !== used || [...pending.values()].some(n => n !== 0)
    || state.used.rendering !== undefined || state.used.review !== undefined) return block();
  state.legacyArtifactBudget = {used, exhausted: state.exhausted.includes('delivery'), renderingCalls, submissionCalls,
    deliveryAttempts: history.deliveryAttempts};
  state.used.rendering = renderingCalls;
  state.used.review = submissionCalls;
  state.used.delivery = history.deliveryAttempts;
  state.exhausted = state.exhausted.filter(lane => lane !== 'delivery');
  for (const lane of ['rendering','review','delivery'] as const) {
    if ((state.used[lane] ?? 0) >= EXECUTION_LIMITS[lane] && !state.exhausted.includes(lane)) state.exhausted.push(lane);
  }
  state.version = 2;
  delete state.migrationBlocked;
  return true;
}

export function budgetFeedback(lane: ExecutionLane, allowed: boolean): string {
  const phase = lane === 'rendering' ? '文件生成' : lane === 'review' ? '文件内容审核' : lane === 'delivery' ? '文件投递' : lane;
  const next = lane === 'review' && !allowed
    ? '文件内容审核额度已耗尽，禁止继续更换文件或改写摘要重启审核；可以复用已通过且文件、摘要、证据均未变化的审核，或准确说明文件尚未交付并 complete。'
    : lane === 'delivery' && !allowed
      ? '投递额度已耗尽，不要重新发送或宣称已经交付；可说明实际状态并 complete。'
      : lane === 'rendering' && !allowed
        ? '文件生成额度已耗尽；已有文件仍可按独立审核和投递额度 submit，不能绕过内容审核。'
        : '复用已保存的证据与计算，停止无新增信息的探索；计算、文件生成、审核和投递分别有有限额度。';
  return `${allowed ? 'EXECUTION_CONVERGE' : 'EXECUTION_LANE_EXHAUSTED'}: ${phase}阶段${allowed ? '接近额度' : '额度已耗尽'}。${next} 证据不足时准确说明缺口，不得宣称完整完成。`;
}
