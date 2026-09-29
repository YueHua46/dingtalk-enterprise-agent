import { describe, expect, it, vi } from 'vitest';
import { StandaloneWebSearch } from '../src/standalone-web-search.js';

describe('Codex standalone web search bridge', () => {
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
