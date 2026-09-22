import type { Config } from './config.js';

export const nativeWebDynamicTools = [{
  type: 'namespace',
  name: 'internet',
  description: '公开互联网信息。模型自行决定是否查询；搜索由 Gemini 原生 Google Search grounding 执行。',
  tools: [{
    type: 'function',
    name: 'search',
    description: '搜索并核实公开网页的实时信息，返回 Gemini 原生 Google Search grounding 结果和来源。仅传公开信息，不要在 query 中加入企业内部数据或个人隐私。',
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
        input: `Use Google Search to research this public-web query. Summarize findings with source URLs. If no search is performed, say so. Query: ${value.query.trim()}`,
        tools: [{ type: 'web_search' }],
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
    // The current Sub2API Antigravity route folds Google's grounding metadata
    // into text rather than exposing web_search_call items. Never label an
    // ungrounded model answer as a successful web search.
    if (!answer || !/Web search queries:/i.test(answer) || !/Sources:/i.test(answer) || !/https?:\/\//i.test(answer)) {
      throw new Error('WEB_SEARCH_NOT_GROUNDED');
    }
    return answer.slice(0, 20_000);
  }
}
