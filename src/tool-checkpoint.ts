import { sha256 } from './security.js';
import type { WorkflowState } from './task-workflow.js';

/** Object key order is not part of a tool request; array order remains significant. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function toolCheckpointKey(request: {namespace: string; tool: string; args: unknown; inputs?: unknown}): string {
  return sha256(canonical(request));
}

/** Historical checkpoints predate canonical keys. Only saved observations with
 * the same capability and exact request semantics can identify an old result.
 * Calculations must still match their full source-dependent checkpoint key. */
export function legacyObservationCheckpoint(state: WorkflowState, capabilityId: string | undefined, args: unknown) {
  if (!capabilityId) return undefined;
  const signature = sha256(canonical(args ?? {}));
  for (const file of state.evidenceFiles ?? []) {
    if (file.kind !== 'observation' || file.capabilityId !== capabilityId) continue;
    let query: unknown;
    try { query = file.query ?? JSON.parse(file.arguments); } catch { continue; }
    if (sha256(canonical(query)) !== signature) continue;
    const checkpoint = Object.values(state.toolCheckpoints ?? {}).find(item =>
      item.evidenceId === file.evidenceId && item.capabilityId === capabilityId);
    if (checkpoint) return checkpoint;
  }
  return undefined;
}
