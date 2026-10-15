import type { Config } from './config.js';
import type { ToolAction } from './types.js';

const LINGXING_MCP_URL = 'https://openmcp.lingxing.com/mcp-servers/lingxing-mcp';
const CATALOG_TTL_MS = 5 * 60 * 1000;

export interface LingxingActionInput {
  toolId: string;
  params: Record<string, unknown>;
}

interface CatalogEntry {
  toolId: string;
  displayName?: string;
  description?: string;
  toolType?: string;
}

export const lingxingActionDynamicTools = [{
  type: 'namespace',
  name: 'lingxing',
  description: '领星官方 MCP 业务能力。help/search 由官方 MCP 提供；业务执行通过宿主策略代理，以便只读调用直接执行、增改删操作先向当前钉钉用户确认。',
  tools: [{
    type: 'function',
    name: 'action',
    description: '执行领星官方 MCP 业务工具。调用前先使用领星 MCP 的 help 和 search 获取 toolId 与完整参数 Schema。宿主会查询官方目录中的 toolType：read（包括查询、统计、报表和导出）直接执行，write 或未知类型必须等待用户确认。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        toolId: { type: 'string', minLength: 1, maxLength: 160 },
        params: { type: 'object', additionalProperties: true }
      },
      required: ['toolId', 'params']
    }
  }]
}];

export class LingxingMcpTool {
  private catalog: { expiresAt: number; entries: Map<string, CatalogEntry> } | undefined;

  public constructor(private readonly config: Pick<Config, 'LINGXING_MCP_KEY'>) {}

  public parse(input: unknown): LingxingActionInput {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('LINGXING_ARGUMENTS_INVALID');
    const value = input as Record<string, unknown>;
    if (typeof value.toolId !== 'string' || !value.toolId.trim() || value.toolId.length > 160) {
      throw new Error('LINGXING_TOOL_ID_INVALID');
    }
    if (!value.params || typeof value.params !== 'object' || Array.isArray(value.params)) {
      throw new Error('LINGXING_PARAMS_INVALID');
    }
    return { toolId: value.toolId.trim(), params: value.params as Record<string, unknown> };
  }

  public async action(input: LingxingActionInput): Promise<ToolAction> {
    const entry = await this.catalogEntry(input.toolId);
    const readOnly = entry.toolType === 'read';
    return {
      name: entry.displayName || entry.description || `领星 ${input.toolId}`,
      risk: readOnly ? 'read' : 'write',
      target: input.toolId,
      parameters: input
    };
  }

  public async describe(toolId: string): Promise<any> {
    const result = await this.withSession(call => call('search', {toolId}));
    const envelope = parseToolText(result) as any;
    if (envelope?.success === false || !envelope?.data || envelope.data.toolId !== toolId) throw new Error('LINGXING_SCHEMA_INVALID');
    return envelope.data;
  }

  public async execute(input: LingxingActionInput): Promise<unknown> {
    return this.withSession(async (call) => call('action', { toolId: input.toolId, params: input.params }));
  }

  private async catalogEntry(toolId: string): Promise<CatalogEntry> {
    const now = Date.now();
    if (!this.catalog || this.catalog.expiresAt <= now) {
      const entries = await this.loadCatalog();
      this.catalog = { expiresAt: now + CATALOG_TTL_MS, entries };
    }
    const entry = this.catalog.entries.get(toolId);
    if (!entry) throw new Error('LINGXING_TOOL_NOT_REGISTERED');
    return entry;
  }

  private async loadCatalog(): Promise<Map<string, CatalogEntry>> {
    return this.withSession(async (call) => {
      const entries = new Map<string, CatalogEntry>();
      for (let offset = 0; offset < 10_000; offset += 20) {
        const result = await call('help', { offset, limit: 20 });
        const envelope = parseToolText(result);
        const data = envelope && typeof envelope === 'object' ? (envelope as { data?: unknown }).data : undefined;
        const page = data && typeof data === 'object' ? data as { total?: unknown; tools?: unknown } : {};
        const tools = Array.isArray(page.tools) ? page.tools : [];
        for (const raw of tools) {
          if (!raw || typeof raw !== 'object') continue;
          const entry = raw as CatalogEntry;
          if (typeof entry.toolId === 'string' && entry.toolId) entries.set(entry.toolId, entry);
        }
        const total = typeof page.total === 'number' ? page.total : entries.size;
        if (!tools.length || entries.size >= total) break;
      }
      if (!entries.size) throw new Error('LINGXING_CATALOG_EMPTY');
      return entries;
    });
  }

  private async withSession<T>(run: (call: (name: string, args: Record<string, unknown>) => Promise<unknown>) => Promise<T>): Promise<T> {
    if (!this.config.LINGXING_MCP_KEY) throw new Error('LINGXING_MCP_NOT_CONFIGURED');
    const baseHeaders: Record<string, string> = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'X-Mcp-Key': this.config.LINGXING_MCP_KEY
    };
    const initialized = await postMcp(LINGXING_MCP_URL, baseHeaders, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dingtalk-enterprise-agent', version: '0.1.0' } }
    });
    const headers = initialized.sessionId ? { ...baseHeaders, 'mcp-session-id': initialized.sessionId } : baseHeaders;
    await postMcp(LINGXING_MCP_URL, headers, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, false);
    let requestId = 2;
    return run(async (name, args) => {
      const response = await postMcp(LINGXING_MCP_URL, headers, {
        jsonrpc: '2.0', id: requestId++, method: 'tools/call', params: { name, arguments: args }
      });
      const payload = response.payload as { error?: { message?: unknown }; result?: unknown };
      if (payload.error) throw new Error(String(payload.error.message ?? 'LINGXING_MCP_ERROR'));
      return payload.result;
    });
  }
}

async function postMcp(url: string, headers: Record<string, string>, body: unknown, expectBody = true): Promise<{ payload: unknown; sessionId?: string }> {
  const response = await fetch(url, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`LINGXING_MCP_HTTP_${response.status}`);
  return {
    payload: expectBody && text ? parseMcpPayload(text) : {},
    ...(response.headers.get('mcp-session-id') ? { sessionId: response.headers.get('mcp-session-id')! } : {})
  };
}

function parseMcpPayload(text: string): unknown {
  if (text.trimStart().startsWith('{')) return JSON.parse(text);
  const data = text.split(/\r?\n/).filter((line) => line.startsWith('data:')).at(-1);
  if (!data) throw new Error('LINGXING_MCP_INVALID_RESPONSE');
  return JSON.parse(data.slice(5).trim());
}

function parseToolText(result: unknown): unknown {
  if (!result || typeof result !== 'object') throw new Error('LINGXING_MCP_INVALID_TOOL_RESULT');
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) throw new Error('LINGXING_MCP_INVALID_TOOL_RESULT');
  const text = content.map((item) => item && typeof item === 'object' ? (item as { text?: unknown }).text : undefined)
    .filter((item): item is string => typeof item === 'string').join('\n');
  if (!text) throw new Error('LINGXING_MCP_EMPTY_TOOL_RESULT');
  return JSON.parse(text);
}
