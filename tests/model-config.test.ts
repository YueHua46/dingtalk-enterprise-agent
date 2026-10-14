import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('text model provider configuration', () => {
  it('routes review to a separately configured model without changing the analysis model', () => {
    const config = loadConfig({NODE_ENV: 'test', DINGTALK_ROBOT_CODE: 'robot', FILE_WORKER_MODE: 'off',
      MODEL_PROVIDER: 'gemini', GEMINI_MODEL_BASE_URL: 'https://gemini.example/v1', GEMINI_MODEL_API_KEY: 'analysis-key', GEMINI_MODEL_NAME: 'analysis',
      MODEL_REVIEW_PROVIDER: 'tokenshop', TOKENSHOP_MODEL_BASE_URL: 'https://review.example/v1', TOKENSHOP_MODEL_API_KEY: 'review-key', TOKENSHOP_MODEL_NAME: 'review'});
    expect(config.MODEL_NAME).toBe('analysis');
    expect(config.MODEL_REVIEW_NAME).toBe('review');
    expect(config.MODEL_REVIEW_API_KEY).toBe('review-key');
    expect(config.MODEL_API_KEY).toBe('analysis-key');
    expect(() => loadConfig({NODE_ENV: 'test', DINGTALK_ROBOT_CODE: 'robot', FILE_WORKER_MODE: 'off', MODEL_REVIEW_PROVIDER: 'gemini'}))
      .toThrow('MODEL_REVIEW_PROVIDER');
  });
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
