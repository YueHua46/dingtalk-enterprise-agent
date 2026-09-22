import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeWebTool } from '../src/native-web-tool.js';

const tool = new NativeWebTool({ MODEL_BASE_URL: 'https://proxy.example/v1', MODEL_API_KEY: 'test-key', MODEL_NAME: 'gemini-test' });

afterEach(() => vi.unstubAllGlobals());

describe('Gemini native-grounding search adapter', () => {
  it('sends only the provider-native web_search tool and requires grounded sources', async () => {
    const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      expect(body.tools).toEqual([{ type: 'web_search' }]);
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
