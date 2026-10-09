import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('text model provider configuration', () => {
  it('keeps legacy MODEL_* settings as the Tokenshop-compatible default', () => {
    const config = loadConfig({
      NODE_ENV: 'test', DINGTALK_ROBOT_CODE: 'robot', FILE_WORKER_MODE: 'off',
      MODEL_BASE_URL: 'https://tokenshop.example/v1', MODEL_API_KEY: 'tokenshop-key', MODEL_NAME: 'gpt-test'
    });

    expect(config).toMatchObject({ MODEL_PROVIDER: 'tokenshop', MODEL_BASE_URL: 'https://tokenshop.example/v1',
      MODEL_API_KEY: 'tokenshop-key', MODEL_NAME: 'gpt-test' });
  });

  it('selects Gemini settings and reuses the Antigravity image key by default', () => {
    const config = loadConfig({
      NODE_ENV: 'test', DINGTALK_ROBOT_CODE: 'robot', FILE_WORKER_MODE: 'off', MODEL_PROVIDER: 'gemini',
      GEMINI_MODEL_BASE_URL: 'https://antigravity.example/v1', GEMINI_MODEL_NAME: 'gemini-test',
      IMAGE_API_KEY: 'antigravity-key', TOKENSHOP_MODEL_BASE_URL: 'https://tokenshop.example/v1',
      TOKENSHOP_MODEL_API_KEY: 'tokenshop-key', TOKENSHOP_MODEL_NAME: 'gpt-test'
    });

    expect(config).toMatchObject({ MODEL_BASE_URL: 'https://antigravity.example/v1',
      MODEL_API_KEY: 'antigravity-key', MODEL_NAME: 'gemini-test', TOKENSHOP_MODEL_API_KEY: 'tokenshop-key' });
  });

  it('allows a dedicated Gemini model key and rejects unknown providers', () => {
    const config = loadConfig({ NODE_ENV: 'test', DINGTALK_ROBOT_CODE: 'robot', FILE_WORKER_MODE: 'off', MODEL_PROVIDER: 'gemini',
      GEMINI_MODEL_BASE_URL: 'https://antigravity.example/v1', GEMINI_MODEL_API_KEY: 'dedicated-key', IMAGE_API_KEY: 'image-key' });
    expect(config.MODEL_API_KEY).toBe('dedicated-key');
    expect(() => loadConfig({ NODE_ENV: 'test', DINGTALK_ROBOT_CODE: 'robot', FILE_WORKER_MODE: 'off', MODEL_PROVIDER: 'other' as any }))
      .toThrow(/MODEL_PROVIDER/);
  });
});
