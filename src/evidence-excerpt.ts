/** Compact evidence at record boundaries, preserving the data contract.
 * The complete result remains in the task evidence file. No clipped JSON is
 * presented as a complete dataset, and omitted arrays are described explicitly.
 */
export function structuredEvidenceExcerpt(text: string, budget = 12_000): string {
  let source: Record<string, unknown>;
  try { source = JSON.parse(text); } catch { return text.length <= budget ? text : JSON.stringify({excerpt: text.slice(0, budget-150), truncated: true, originalChars: text.length}); }
  if (!source || typeof source !== 'object' || !('data' in source)) return text.length <= budget ? text : JSON.stringify({excerpt: text.slice(0, budget-150), truncated: true, originalChars: text.length});
  const scope = source.scope as Record<string, unknown> | undefined;
  const compactScope = scope ? {has_access: scope.has_access, lingxing_sids: scope.lingxing_sids,
    stores: Array.isArray(scope.stores) ? scope.stores.map((s: Record<string, unknown>) => ({sid: s.lingxing_sid, name: s.name, country: s.country})) : undefined} : undefined;
  const result: Record<string, unknown> = {dataset: source.dataset, scope: compactScope, evidence: source.evidence};
  const omissions: Record<string, {returned: number; retained: number}> = {};
  const arrays: Array<{key: string; values: unknown[]; target: Record<string, unknown>}> = [];
  if (Array.isArray(source.data)) {
    arrays.push({key: 'data', values: source.data, target: result});
  } else if (source.data && typeof source.data === 'object') {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source.data)) {
      if (Array.isArray(value)) arrays.push({key, values: value, target: data});
      else data[key] = value;
    }
    result.data = data;
  } else result.data = source.data;
  // Totals and coverage are semantic context; prioritize them ahead of detail.
  arrays.sort((a,b) => Number(b.key.startsWith('totals'))-Number(a.key.startsWith('totals')));
  result.excerptCoverage = omissions;
  for (const array of arrays) {
    const retained: unknown[] = [];
    array.target[array.key] = retained;
    omissions[array.key] = {returned: array.values.length, retained: 0};
    for (const row of array.values) {
      retained.push(row);
      if (JSON.stringify(result).length > budget-100) { retained.pop(); break; }
      omissions[array.key]!.retained++;
    }
  }
  if (JSON.stringify(result).length > budget) {
    // Oversized metadata itself must be declared unavailable, not severed.
    return JSON.stringify({dataset: source.dataset, excerptUnavailable: 'metadata_exceeds_budget', originalChars: text.length});
  }
  return JSON.stringify(result);
}
