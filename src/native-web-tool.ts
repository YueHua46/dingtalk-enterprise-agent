import type { Config } from './config.js';

export const nativeWebDynamicTools = [{
  type: 'namespace',
  name: 'internet',
  description: '公开互联网信息。模型自行决定是否查询；搜索由配置的模型原生联网工具执行。',
  tools: [{
    type: 'function',
    name: 'search',
    description: '搜索并核实公开网页的实时信息，返回实际联网结果和来源。仅传公开信息，不要在 query 中加入企业内部数据或个人隐私。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 500 }
      },
      required: ['query']
    }
  }]
}];

export class NativeWebTool {
  public constructor(private readonly config: Pick<Config, 'MODEL_BASE_URL' | 'MODEL_API_KEY' | 'MODEL_NAME'>) {}

  public async search(input: unknown): Promise<string> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('WEB_SEARCH_INVALID_QUERY');
    const value = input as Record<string, unknown>;
    if (typeof value.query !== 'string' || !value.query.trim() || value.query.length > 500) throw new Error('WEB_SEARCH_INVALID_QUERY');
    if (!this.config.MODEL_BASE_URL || !this.config.MODEL_API_KEY) throw new Error('WEB_SEARCH_NOT_CONFIGURED');

    const endpoint = this.config.MODEL_BASE_URL.replace(/\/+$/, '') + '/responses';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.MODEL_API_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: this.config.MODEL_NAME,
        input: `Perform a focused web search for this public-web query. Return findings in Simplified Chinese, with at most five short bullets and source URLs. Preserve publication dates and original titles. Do not describe the search process. If no search is performed, say so. Query: ${value.query.trim()}`,
        tools: [{ type: 'web_search' }],
        ...(!/^gemini/i.test(this.config.MODEL_NAME) ? { tool_choice: 'required' } : {}),
        // Search is a short retrieval step; avoid the main model's default
        // reasoning budget delaying results. Gemini's relay omits this option.
        ...(/^gpt-/i.test(this.config.MODEL_NAME) ? { reasoning: { effort: 'low' } } : {}),
        ...(/^gpt-/i.test(this.config.MODEL_NAME) ? { include: ['web_search_call.action.sources'] } : {}),
        stream: false
      }),
      signal: AbortSignal.timeout(90_000)
    });
    if (!response.ok) throw new Error(`WEB_SEARCH_UPSTREAM_HTTP_${response.status}`);
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object') throw new Error('WEB_SEARCH_INVALID_RESPONSE');
    const output = (payload as { output?: unknown }).output;
    if (!Array.isArray(output)) throw new Error('WEB_SEARCH_INVALID_RESPONSE');
    const content = output.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const blocks = (item as { content?: unknown }).content;
      return Array.isArray(blocks) ? blocks : [];
    });
    const answer = content.map((block) => block && typeof block === 'object' ? (block as { text?: unknown }).text : undefined)
      .filter((text): text is string => typeof text === 'string').join('\n').trim();
    // OpenAI exposes search execution and citations as structured items.
    // Normalize them for the standalone bridge, which reads the Sources list.
    const searched = output.some((item) => item?.type === 'web_search_call' && item.status === 'completed');
    const sources = new Map<string, string>();
    const addSource = (source: any) => {
      if (typeof source?.url !== 'string') return;
      try {
        const url = new URL(source.url);
        if (url.protocol !== 'https:' || url.username || url.password) return;
        const title = (typeof source.title === 'string' ? source.title : url.hostname)
          .replace(/[\r\n\[\]]/g, ' ').slice(0, 200).trim() || url.hostname;
        sources.set(url.href, title);
      } catch { /* Ignore malformed source URLs. */ }
    };
    for (const item of output) {
      if (item?.type === 'web_search_call' && item.status === 'completed' && Array.isArray(item.action?.sources)) {
        item.action.sources.forEach(addSource);
      }
    }
    for (const block of content) {
      if (!Array.isArray(block?.annotations)) continue;
      for (const citation of block.annotations) {
        if (citation?.type === 'url_citation') addSource(citation);
      }
    }
    if (searched && sources.size) {
      const sourceText = [...sources].slice(0, 12).map(([url, title], index) =>
        `[${index + 1}] [${title}](${url.replace(/\(/g, '%28').replace(/\)/g, '%29')})`).join('\n');
      return `${answer.slice(0, 6_000) || '搜索已返回来源；请读取原文后总结。'}\n\nWeb search queries: ${value.query.trim()}\n\nSources:\n${sourceText}`;
    }
    // Gemini's Antigravity relay folds grounding metadata into answer text.
    // Only accept that legacy format for Gemini, never an unverified GPT answer.
    if (!/^gemini/i.test(this.config.MODEL_NAME)) throw new Error('WEB_SEARCH_NOT_GROUNDED');
    if (!answer || !/Web search queries:/i.test(answer) || !/Sources:/i.test(answer) || !/https?:\/\//i.test(answer)) {
      throw new Error('WEB_SEARCH_NOT_GROUNDED');
    }
    return answer.slice(0, 20_000);
  }
}
