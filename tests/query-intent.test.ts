import { describe, expect, it } from 'vitest';
import { buildQueryIntent, extractModelTokens, normalizeModel, routingHint } from '../src/query-intent.js';

describe('query intent routing', () => {
  it('recognizes a product question without SKU wording', () => {
    const intent = buildQueryIntent('这款摄像头晚上能看多远？');
    expect(intent.domain).toBe('product_knowledge');
    expect(intent.operation).toBe('search');
  });

  it('recognizes common typo variants and keeps the original candidate', () => {
    const intent = buildQueryIntent('P78HMM-30X 的夜视距离是几米？');
    expect(intent.domain).toBe('product_knowledge');
    expect(intent.modelCandidates[0]?.raw).toBe('P78HMM-30X');
  });

  it('keeps model text and normalizes separators', () => {
    expect(extractModelTokens('请查 P78 HM-30X 的配置')).toContain('P78');
    expect(normalizeModel('P78 HM-30X')).toBe('P78HM30X');
  });

  it('is a soft hint and explicitly preserves fallback tools', () => {
    expect(routingHint(buildQueryIntent('GJ1-P78HM-30X 支持什么配置？'))).toContain('不得因为该提示屏蔽回退工具');
  });
});
