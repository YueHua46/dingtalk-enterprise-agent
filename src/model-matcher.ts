export type ModelMatchCandidate = { model: string; score: number };

export function normalizeModelToken(value: string): string {
  return value.trim().toUpperCase().replace(/[\s_–—−-]+/g, '');
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
}

export function scoreModel(input: string, candidate: string): number {
  const a = normalizeModelToken(input);
  const b = normalizeModelToken(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const similarity = 1 - distance(a, b) / Math.max(a.length, b.length);
  return Math.max(0, Math.min(0.99, similarity));
}

export function rankModelCandidates(input: string, candidates: string[], limit = 3): ModelMatchCandidate[] {
  return [...new Set(candidates.map((value) => value.trim()).filter(Boolean))]
    .map((model) => ({ model, score: scoreModel(input, model) }))
    .sort((left, right) => right.score - left.score || left.model.localeCompare(right.model))
    .slice(0, limit);
}

export function classifyModelMatch(input: string, candidates: ModelMatchCandidate[]): {
  primary?: string;
  autoSelected: boolean;
  ambiguity: 'none' | 'low' | 'conflicting';
} {
  const first = candidates[0];
  const second = candidates[1];
  if (!first) return { autoSelected: false, ambiguity: 'low' };
  if (first.score >= 0.92 && (!second || first.score - second.score >= 0.08)) {
    return { primary: first.model, autoSelected: true, ambiguity: 'none' };
  }
  if (first.score >= 0.8) return { primary: first.model, autoSelected: false, ambiguity: 'conflicting' };
  return { primary: first.model, autoSelected: false, ambiguity: 'low' };
}
