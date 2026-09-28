import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionSummarizer, fallbackSummary, parseFlagPairs, parseSummaryPayload, sanitizeLine } from '../src/action-summarizer.js';
import type { ToolAction } from '../src/types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sanitizeLine', () => {
  it('strips control characters and truncates with ellipsis', () => {
    expect(sanitizeLine('a\nb\rc  d', 20)).toBe('a b c d');
    expect(sanitizeLine('x'.repeat(30), 10)).toBe('xxxxxxxxx…');
    expect(sanitizeLine(42, 10)).toBe('');
  });
});

describe('parseFlagPairs', () => {
  it('pairs flags with following values and keeps valueless flags', () => {
    expect(parseFlagPairs(['--node', 'abc', '--command', 'append', '--dry-run'])).toEqual([
      ['node', 'abc'],
      ['command', 'append'],
      ['dry-run', '']
    ]);
  });
});

describe('fallbackSummary', () => {
  it('uses the DWS capability catalog description and renders args as readable pairs', () => {
    const action: ToolAction = {
      name: '钉钉 doc.update',
      risk: 'write',
      parameters: { capability: 'doc.update', args: ['--node', 'amweZ92PV6yoBRgk', '--command', 'append', '--content', 'Hello World'] }
    };
    const summary = fallbackSummary(action);
    expect(summary.description).toContain('doc.update');
    expect(summary.description).toContain('追加、覆盖或按 block 精确更新文档内容');
    expect(summary.details).toContain('node：amweZ92PV6yoBRgk');
    expect(summary.details).toContain('content：Hello World');
  });

  it('renders plain object parameters for non-CLI tools', () => {
    const action: ToolAction = {
      name: '保存用户长期记忆',
      risk: 'write',
      parameters: { operation: 'set', key: '偏好语言', value: '中文' }
    };
    const summary = fallbackSummary(action);
    expect(summary.details).toContain('key：偏好语言');
    expect(summary.details).toContain('value：中文');
  });

  it('hides secret-looking keys and notes overflow beyond the detail cap', () => {
    const action: ToolAction = {
      name: '钉钉 doc.update',
      risk: 'write',
      parameters: {
        capability: 'doc.update',
        args: ['--api-key', 'zzz', '--node', 'a', '--b1', '1', '--b2', '2', '--b3', '3', '--b4', '4', '--b5', '5', '--b6', '6']
      }
    };
    const summary = fallbackSummary(action);
    expect(summary.details!.some((line) => line.includes('[已隐藏]'))).toBe(true);
    expect(summary.details!.some((line) => line.includes('任务审计中'))).toBe(true);
    expect(summary.details!.length).toBeLessThanOrEqual(6);
  });

  it('falls back to the plain action name when nothing is parseable', () => {
    const summary = fallbackSummary({ name: '紫鸟 account.list', risk: 'read' });
    expect(summary.description).toBe('紫鸟 account.list');
    expect(summary.impact).toBeTruthy();
  });
});

describe('parseSummaryPayload', () => {
  it('accepts plain and fenced JSON and trims detail lines', () => {
    const ok = parseSummaryPayload('{"description":"在文档《测试文档》末尾追加内容","impact":"仅该文档","details":[" 内容：Hello World "]}');
    expect(ok.description).toBe('在文档《测试文档》末尾追加内容');
    expect(ok.details).toEqual(['内容：Hello World']);

    const fenced = parseSummaryPayload('```json\n{"description":"重命名文档","details":[]}\n```');
    expect(fenced.description).toBe('重命名文档');
  });

  it('rejects malformed payloads and filters secret-looking details', () => {
    expect(() => parseSummaryPayload('不是 JSON')).toThrow();
    expect(() => parseSummaryPayload('{"impact":"缺少 description"}')).toThrow();
    const filtered = parseSummaryPayload('{"description":"x","details":["api_key：123456","node：abc"]}');
    expect(filtered.details).toEqual(['node：abc']);
  });
});

describe('ActionSummarizer', () => {
  const config = { MODEL_BASE_URL: 'https://model.example/v1', MODEL_API_KEY: 'key', MODEL_NAME: 'gpt-test' };
  const action: ToolAction = {
    name: '钉钉 doc.update',
    risk: 'write',
    parameters: { capability: 'doc.update', args: ['--node', 'n1', '--content', 'Hello'] }
  };

  it('falls back to the deterministic summary when the model endpoint is not configured', async () => {
    const summarizer = new ActionSummarizer({ MODEL_BASE_URL: undefined, MODEL_API_KEY: undefined, MODEL_NAME: 'm' });
    const summary = await summarizer.summarize('hash-1', action);
    expect(summary.description).toContain('doc.update');
  });

  it('returns the LLM business summary and caches by action hash', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      output: [{ content: [{ text: '{"description":"把 Hello 写入指定文档末尾","impact":"该文档内容会变化","details":["目标文档节点：n1"]}' }] }]
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const summarizer = new ActionSummarizer(config);
    const summary = await summarizer.summarize('hash-2', action);
    expect(summary.description).toBe('把 Hello 写入指定文档末尾');
    expect(summary.details).toEqual(['目标文档节点：n1']);
    await summarizer.summarize('hash-2', action);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the deterministic fallback when the model returns garbage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      output: [{ content: [{ text: '模型输出了没用的解释文字' }] }]
    }), { status: 200 })));
    const summarizer = new ActionSummarizer(config);
    const summary = await summarizer.summarize('hash-3', action);
    expect(summary.description).toContain('doc.update');
  });
});
