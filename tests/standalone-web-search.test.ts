import { describe, expect, it, vi } from 'vitest';
import { StandaloneWebSearch } from '../src/standalone-web-search.js';
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }));

describe('Codex standalone web search bridge', () => {
  it('keeps successful queries when a sibling has no verified grounding', async () => {
    const search = vi.fn(async ({ query }) => {
      if (query === 'failed') throw new Error('WEB_SEARCH_NOT_GROUNDED');
      return 'Verified news\nSources:\n[1] [News](https://example.com/news)';
    });
    const result = await new StandaloneWebSearch({ search } as any).execute({ id: 'mixed', commands: { search_query: [{ q: 'failed' }, { q: 'news' }] } });
    expect(result.results).toContainEqual({ type: 'text_result', ref_id: 'turn0search0', url: 'https://example.com/news', title: 'News' });
    expect(result.output).toContain('Verified news');
    expect(result.output).toContain('WEB_SEARCH_NOT_GROUNDED');
  });

  it('opens five pages and preserves four successes when one page fails', async () => {
    const http = vi.fn(async (url: URL) => url.pathname === '/failed'
      ? new Response('Unavailable', { status: 503 })
      : new Response('<title>News page</title><p>Verified article</p>', { headers: { 'content-type': 'text/html' } }));
    const bridge = new StandaloneWebSearch({ search: vi.fn() } as any, http as any);
    const result = await bridge.execute({ id: 'five', commands: { open: ['a', 'b', 'failed', 'c', 'd'].map((p) => ({ ref_id: `https://example.com/${p}` })) } });
    expect(http).toHaveBeenCalledTimes(5);
    expect(result.results.filter((item) => item.type === 'text_result')).toHaveLength(4);
    expect(result.output).toContain('Verified article');
    expect(result.output).toContain('WEB_SEARCH_PAGE_HTTP_503');
  });

  it('still blocks private pages in mixed batches without discarding public pages', async () => {
    const http = vi.fn(async () => new Response('Public text', { headers: { 'content-type': 'text/plain' } }));
    const result = await new StandaloneWebSearch({ search: vi.fn() } as any, http as any).execute({ id: 'private', commands: { open: [{ ref_id: 'https://127.0.0.1/' }, { ref_id: 'https://example.com/' }] } });
    expect(http).toHaveBeenCalledOnce();
    expect(result.output).toContain('WEB_SEARCH_PRIVATE_HOST');
    expect(result.results.filter((item) => item.type === 'text_result')).toHaveLength(1);
  });
  it('returns the alpha/search response shape with grounded source references', async () => {
    const search = vi.fn(async () => 'Example Domain\n\nWeb search queries: example.com\n\nSources:\n[1] [example.com](https://example.com/)');
    const bridge = new StandaloneWebSearch({ search } as any);
    const result = await bridge.execute({ id: 'task-1', commands: { search_query: [{ q: 'example.com' }] } });

    expect(search).toHaveBeenCalledWith({ query: 'example.com' });
    expect(result).toMatchObject({ encrypted_output: null, results: [{ type: 'text_result', ref_id: 'turn0search0', url: 'https://example.com/' }] });
    expect(result.output).toContain('turn0search0');
    expect(result.output).toContain('Web search queries: example.com');
  });

  it('rejects requests without supported commands', async () => {
    const bridge = new StandaloneWebSearch({ search: vi.fn() } as any);
    await expect(bridge.execute({ id: 'task-1', commands: {} })).rejects.toThrow('WEB_SEARCH_NO_SUPPORTED_COMMAND');
  });
});
