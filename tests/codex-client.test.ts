import { describe, expect, it } from 'vitest';
import { buildCodexArgs, codexEnvironment, finalTurnText } from '../src/codex-client.js';

describe('CodexClient startup configuration', () => {
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
});
