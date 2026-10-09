import { describe, expect, it } from 'vitest';
import { classifyModelMatch, normalizeModelToken, rankModelCandidates, scoreModel } from '../src/model-matcher.js';

describe('model candidate matcher', () => {
  it('treats separator changes as an exact match', () => {
    expect(normalizeModelToken('P78 HM-30X')).toBe('P78HM30X');
    expect(scoreModel('P78 HM-30X', 'P78HM30X')).toBe(1);
  });

  it('returns at most three ranked candidates', () => {
    const ranked = rankModelCandidates('P78HM30X', ['P78HM30X', 'P78HM35X', 'P87HM30X', 'A31HH35-3-FAS'], 3);
    expect(ranked).toHaveLength(3);
    expect(ranked[0]?.model).toBe('P78HM30X');
  });

  it('does not auto-select close or conflicting candidates', () => {
    const result = classifyModelMatch('P78HM30X', [
      { model: 'P78HM30X', score: .91 },
      { model: 'P78HM35X', score: .89 }
    ]);
    expect(result.autoSelected).toBe(false);
    expect(result.ambiguity).toBe('conflicting');
  });

  it('auto-selects a unique typo correction above the configured margin', () => {
    const ranked = rankModelCandidates('P78HM30X-ABCDEF', ['P78HM30X-ABCDEG', 'P87HM30X'], 3);
    const result = classifyModelMatch('P78HMM30X', ranked);
    expect(result.autoSelected).toBe(true);
    expect(result.primary).toBe('P78HM30X-ABCDEG');
  });
});
