import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeWebTool } from '../src/native-web-tool.js';
import { StandaloneWebSearch } from '../src/standalone-web-search.js';

const tool = new NativeWebTool({ MODEL_BASE_URL: 'https://proxy.example/v1', MODEL_API_KEY: 'test-key', MODEL_NAME: 'gemini-test' });

afterEach(() => vi.unstubAllGlobals());

describe('Native grounded search adapter', () => {
  const openai = new NativeWebTool({ MODEL_BASE_URL: 'https://proxy.example/v1', MODEL_API_KEY: 'test-key', MODEL_NAME: 'gpt-6.1-sol' });

  it('turns structured OpenAI citations into standalone search references', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      expect(body.tool_choice).toBe('required');
      expect(body.reasoning).toEqual({ effort: 'low' });
      expect(body.input).not.toContain('Google Search');
      return new Response(JSON.stringify({ output: [
        { type: 'web_search_call', status: 'completed', action: { type: 'search' } },
        { type: 'message', content: [{ type: 'output_text', text: 'NASA published an update.', annotations: [
          { type: 'url_citation', title: 'NASA News', url: 'https://www.nasa.gov/news/' },
          { type: 'url_citation', title: 'NASA News', url: 'https://www.nasa.gov/news/' },
          { type: 'url_citation', url: 'javascript:alert(1)' }
        ] }] }
      ] }));
    }));
    const result = await new StandaloneWebSearch(openai).execute({ id: 'openai-test', commands: { search_query: [{ q: 'NASA news' }] } });
    expect(result.results).toEqual([{ type: 'text_result', ref_id: 'turn0search0', title: 'NASA News', url: 'https://www.nasa.gov/news/' }]);
    expect(result.output).toContain('NASA published an update.');
  });

  it.each([undefined, 'failed', 'in_progress'])('rejects citations without a completed search (%s)', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [
      ...(status ? [{ type: 'web_search_call', status }] : []),
      { type: 'message', content: [{ text: 'News', annotations: [{ type: 'url_citation', url: 'https://nasa.gov/news' }] }] }
    ] }))));
    await expect(openai.search({ query: 'news' })).rejects.toThrow('WEB_SEARCH_NOT_GROUNDED');
  });

  it('rejects completed searches without source citations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [
      { type: 'web_search_call', status: 'completed' },
      { type: 'message', content: [{ text: 'News without evidence.' }] }
    ] }))));
    await expect(openai.search({ query: 'news' })).rejects.toThrow('WEB_SEARCH_NOT_GROUNDED');
  });

  it('accepts provider search sources when the summary has no inline citations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [
      { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ type: 'url', url: 'https://nasa.gov/news', title: 'NASA' }] } },
      { type: 'message', content: [{ text: 'Search found the NASA news page.' }] }
    ] }))));
    expect(await openai.search({ query: 'NASA news' })).toContain('[NASA](https://nasa.gov/news)');
  });

  it('sends only the provider-native web_search tool and requires grounded sources', async () => {
    const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      expect(body.tools).toEqual([{ type: 'web_search' }]);
      expect(body.reasoning).toBeUndefined();
      expect(body.tool_choice).toBeUndefined();
      expect(body.input).toContain('NASA news today');
      return new Response(JSON.stringify({ output: [{ content: [{ text: 'NASA update\nWeb search queries: NASA news\nSources:\n[1] https://nasa.gov/news' }] }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await tool.search({ query: 'NASA news today' })).toContain('https://nasa.gov/news');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects model text that lacks proof of native grounding', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [{ content: [{ text: 'I searched and found news.' }] }] }), { status: 200 })));
    await expect(tool.search({ query: 'news' })).rejects.toThrow('WEB_SEARCH_NOT_GROUNDED');
  });

  it('rejects malformed tool input before contacting the upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(tool.search({ query: ' ' })).rejects.toThrow('WEB_SEARCH_INVALID_QUERY');
    await expect(tool.search({ query: 'x'.repeat(501) })).rejects.toThrow('WEB_SEARCH_INVALID_QUERY');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
