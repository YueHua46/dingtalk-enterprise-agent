import type { Config } from './config.js';
import { nativeReadOnlyMcpTools } from './mcp-tool-list.js';

const endpoints = {
  sif: { url: 'https://mcp.sif.com/mcp', header: 'secret-key' },
  lingxing: { url: 'https://openmcp.lingxing.com/mcp-servers/lingxing-mcp', header: 'X-Mcp-Key' }
} as const;

export const mcpReadDynamicTools = [
  { type: 'namespace', name: 'sif', description: '查询公开 ASIN、关键词和竞品数据；不能证明自有店铺的内部销量。', tools: [{
    type: 'function', name: 'read', description: '调用已登记的 SIF 只读能力。先按业务目标选择 toolId，并提供该能力所需 params。',
    inputSchema: { type: 'object', additionalProperties: false, properties: { toolId: { type: 'string', enum: [...nativeReadOnlyMcpTools.sif] }, params: { type: 'object' } }, required: ['toolId'] }
  }] },
  { type: 'namespace', name: 'lingxing', description: '领星共享密钥只能查看工具目录；业务数据须使用按用户授权范围裁剪的通道。', tools: [{
    type: 'function', name: 'catalog', description: '调用领星 help 或 search 查看工具目录，不执行共享密钥业务 action。',
    inputSchema: { type: 'object', additionalProperties: false, properties: { toolId: { type: 'string', enum: [...nativeReadOnlyMcpTools.lingxing] }, params: { type: 'object' } }, required: ['toolId'] }
  }] }
];

export class McpReadTool {
  public constructor(private readonly config: Pick<Config, 'SIF_MCP_KEY' | 'LINGXING_MCP_KEY'>, private readonly http: typeof fetch = fetch) {}

  public parse(server: 'sif' | 'lingxing', raw: unknown): { toolId: string; params: Record<string, unknown> } {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('MCP_READ_ARGUMENTS_INVALID');
    const value = raw as Record<string, unknown>;
    if (typeof value.toolId !== 'string' || !(nativeReadOnlyMcpTools[server] as readonly string[]).includes(value.toolId)) throw new Error('MCP_READ_TOOL_NOT_REGISTERED');
    if (value.params !== undefined && (!value.params || typeof value.params !== 'object' || Array.isArray(value.params))) throw new Error('MCP_READ_PARAMS_INVALID');
    return { toolId: value.toolId, params: value.params as Record<string, unknown> | undefined ?? {} };
  }

  public async execute(server: 'sif' | 'lingxing', input: { toolId: string; params: Record<string, unknown> }): Promise<unknown> {
    const key = server === 'sif' ? this.config.SIF_MCP_KEY : this.config.LINGXING_MCP_KEY;
    if (!key) throw new Error('MCP_READ_NOT_CONFIGURED');
    const endpoint = endpoints[server];
    const headers: Record<string, string> = { accept: 'application/json, text/event-stream', 'content-type': 'application/json', [endpoint.header]: key };
    const init = await this.post(endpoint.url, headers, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dingtalk-enterprise-agent', version: '0.1.0' } } });
    if (init.sessionId) headers['mcp-session-id'] = init.sessionId;
    await this.post(endpoint.url, headers, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, false);
    const response = await this.post(endpoint.url, headers, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: input.toolId, arguments: input.params } });
    const payload = response.payload as { error?: { message?: unknown }; result?: { isError?: boolean } };
    if (payload.error) throw new Error(String(payload.error.message ?? 'MCP_READ_ERROR'));
    if (!payload.result) throw new Error('MCP_READ_EMPTY_RESULT');
    if (payload.result?.isError) throw new Error('MCP_READ_TOOL_FAILED');
    if (JSON.stringify(payload.result ?? null).length > 200_000) throw new Error('MCP_READ_RESULT_TOO_LARGE');
    return payload.result;
  }

  private async post(url: string, headers: Record<string, string>, body: unknown, expectBody = true): Promise<{ payload: unknown; sessionId?: string }> {
    const response = await this.http(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
    if (!response.ok) throw new Error(`MCP_READ_HTTP_${response.status}`);
    const raw = await response.text();
    let payload: unknown = {};
    if (expectBody) {
      if (raw.trimStart().startsWith('{')) payload = JSON.parse(raw);
      else {
        const line = raw.split(/\r?\n/).filter((item) => item.startsWith('data:')).at(-1);
        if (!line) throw new Error('MCP_READ_INVALID_RESPONSE');
        payload = JSON.parse(line.slice(5).trim());
      }
    }
    return { payload, ...(response.headers.get('mcp-session-id') ? { sessionId: response.headers.get('mcp-session-id')! } : {}) };
  }
}
