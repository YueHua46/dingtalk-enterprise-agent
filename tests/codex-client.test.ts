import { describe, expect, it, vi } from 'vitest';
import { buildCodexArgs, CodexClient, codexEnvironment, finalTurnText, normalizeDynamicToolResult } from '../src/codex-client.js';

describe('dynamic tool response boundary', () => {
  it('converts missing text into an explicit failed tool result', () => {
    expect(normalizeDynamicToolResult({ contentItems: [{ type: 'inputText' }], success: true })).toEqual({
      contentItems: [{ type: 'inputText', text: expect.stringContaining('TOOL_RESULT_INVALID') }], success: false
    });
  });
});

describe('CodexClient startup configuration', () => {
  it('preserves a failed stream when turn completion arrives before its waiter', async () => {
    const client = new CodexClient({ CODEX_WORKDIR: '/app', MODEL_NAME: 'test' } as any);
    (client as any).trackTurnEvent({method:'turn/completed',params:{threadId:'thread',turn:{id:'failed-turn',
      error:{message:'stream disconnected before completion: stream closed before response.completed'},
      items:[{type:'agentMessage',id:'partial',text:'partial answer',phase:'final_answer'}]}}});
    await expect((client as any).waitForTurn('thread','failed-turn')).rejects.toThrow('stream closed before response.completed');
  });

  it('does not expose unscoped Lingxing business actions to the model', async () => {
    const client = new CodexClient({ CODEX_WORKDIR: '/app', MODEL_NAME: 'test' } as any);
    vi.spyOn(client, 'start').mockResolvedValue();
    const request = vi.fn(async (_method: string, _params: any) => ({ thread: { id: 'thread-1' } }));
    (client as any).request = request;
    await client.startThread({ corpId: 'corp', userId: 'user' });
    const dynamicTools = request.mock.calls[0]?.[1]?.dynamicTools as Array<{ name: string }>;
    expect(dynamicTools.map((tool) => tool.name)).toContain('lingxing');
    expect((dynamicTools.find((tool) => tool.name === 'lingxing') as any).tools.map((tool: any) => tool.name)).toEqual(['catalog']);
    expect(dynamicTools.map((tool) => tool.name)).toContain('crossborderops');
  });
  it('does not mistake commentary for the final answer', () => {
    expect(finalTurnText({
      messages: new Map([['step', '我先查一下'], ['answer', '这是结果']]),
      phases: new Map([['step', 'commentary'], ['answer', 'final_answer']])
    })).toBe('这是结果');
    expect(finalTurnText({
      messages: new Map([['step', '我先查一下']]),
      phases: new Map([['step', 'commentary']])
    })).toContain('未返回可显示文本');
  });
  it('uses the default provider when no intermediary is configured', () => {
    const args = buildCodexArgs({});
    expect(args).toEqual(['app-server', '-c', 'features.shell_tool=false', '-c', 'web_search="disabled"']);
    expect(args.join(' ')).not.toContain('model_provider=');
  });

  it('keeps commerce MCP calls inside the host broker', () => {
    const args = buildCodexArgs({ LINGXING_MCP_KEY: 'lingxing-secret', SIF_MCP_KEY: 'sif-secret' }, ['lingxing', 'sif']);
    expect(args).toContain('mcp_servers.lingxing.enabled=false');
    expect(args).toContain('mcp_servers.sif.enabled=false');
    expect(args.join(' ')).not.toContain('lingxing-secret');
    expect(args.join(' ')).not.toContain('sif-secret');
  });

  it('disables every inherited MCP server discovered at startup', () => {
    const args = buildCodexArgs({}, ['n8n', 'cua_repl', 'lingxing', 'lingxing']);
    expect(args).toContain('mcp_servers.n8n.enabled=false');
    expect(args).toContain('mcp_servers.cua_repl.enabled=false');
    expect(args.filter((arg) => arg === 'mcp_servers.lingxing.enabled=false')).toHaveLength(1);
    expect(() => buildCodexArgs({}, ['server.with.dot'])).toThrow('CODEX_MCP_SERVER_NAME_INVALID');
  });

  it('uses an HTTP Responses custom provider for the configured intermediary', () => {
    const args = buildCodexArgs({ MODEL_BASE_URL: 'https://proxy.example.com/v1' });

    expect(args.slice(-12)).toEqual([
      '-c', 'model_provider="enterprise_proxy"',
      '-c', 'model_providers.enterprise_proxy.name="Enterprise Proxy"',
      '-c', 'model_providers.enterprise_proxy.base_url="https://proxy.example.com/v1"',
      '-c', 'model_providers.enterprise_proxy.env_key="OPENAI_API_KEY"',
      '-c', 'model_providers.enterprise_proxy.wire_api="responses"',
      '-c', 'model_providers.enterprise_proxy.supports_websockets=false'
    ]);
    expect(args.join(' ')).not.toContain('openai_base_url');
    expect(args.join(' ')).not.toContain('api-key-value');
  });

  it('routes all model turns through the namespace compatibility bridge when enabled', () => {
    const args = buildCodexArgs({ MODEL_BASE_URL: 'https://proxy.example.com/v1', MODEL_TOOL_COMPAT_PROXY: 'true', PORT: 8080 });
    expect(args).toContain('model_providers.enterprise_proxy.base_url="http://127.0.0.1:8080/internal/model/v1"');
  });

  it('does not expose Codex native shell tools', () => {
    const args = buildCodexArgs({}).join(' ');
    expect(args).toContain('features.shell_tool=false');
  });

  it('does not pass gateway business credentials to Codex', () => {
    const env = codexEnvironment({ MODEL_NAME: 'example-model', MODEL_API_KEY: 'model-key' }, {
      PATH: '/usr/bin', CODEX_HOME: '/var/lib/codex', DINGTALK_CLIENT_SECRET: 'business-secret',
      DATABASE_URL: 'postgres://secret', DWS_BOT_PROFILE: 'admin-profile'
    });
    expect(env).toEqual({ PATH: '/usr/bin', CODEX_HOME: '/var/lib/codex', OPENAI_API_KEY: 'model-key', CODEX_MODEL: 'example-model' });
    expect(JSON.stringify(env)).not.toContain('business-secret');
  });

  it('does not pass commerce MCP credentials to the Codex child', () => {
    const env = codexEnvironment({
      MODEL_NAME: 'example-model',
      LINGXING_MCP_KEY: 'lingxing-secret',
      SIF_MCP_KEY: 'sif-secret'
    }, { PATH: '/usr/bin', DATABASE_URL: 'postgres://secret' });
    expect(env).toMatchObject({ PATH: '/usr/bin', CODEX_MODEL: 'example-model' });
    expect(env.LINGXING_MCP_KEY).toBeUndefined();
    expect(env.SIF_MCP_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
  });
});
