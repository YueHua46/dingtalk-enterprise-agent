import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { GuideTool } from '../src/guide-tool.js';

describe('amazon-advertising-ai-optimizer skill', () => {
  const guide = new GuideTool({ SKILLS_DIR: resolve('skills') }, resolve('nonexistent-codex-home'));
  const pythonHasReportlab = (() => {
    try {
      execFileSync('python', ['-c', 'import reportlab'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  it('is discoverable and exposes the three site rule references', async () => {
    const root = await guide.execute({ name: 'amazon-advertising-ai-optimizer' });
    expect(root.text).toContain('CrossBorderOps');
    expect(root.text).toContain('只生成建议');
    for (const reference of ['japan-rules', 'germany-rules', 'usa-profit-model', 'output-template', 'report-template']) {
      const result = await guide.execute({ name: 'amazon-advertising-ai-optimizer', reference });
      expect(result.text.length).toBeGreaterThan(100);
    }
  });

  it('calculates ratios without fabricating zero-denominator metrics', () => {
    const script = resolve('skills/amazon-advertising-ai-optimizer/scripts/calculate_metrics.py');
    const input = JSON.stringify({ rows: [
      { impressions: 1000, clicks: 20, spend: 10, orders: 2, ad_sales: 100, total_sales: 200 },
      { impressions: 0, clicks: 0, spend: 5, orders: 0, ad_sales: 0, total_sales: 0 },
    ] });
    const output = execFileSync('python', [script], { input, encoding: 'utf8' });
    const rows = JSON.parse(output).rows;
    expect(rows[0]).toMatchObject({ ctr: 0.02, cpc: 0.5, cvr: 0.1, cpa: 5, acos: 0.1, roas: 10, tacos: 0.05 });
    expect(rows[1]).toMatchObject({ ctr: null, cpc: null, cvr: null, cpa: null, acos: null, roas: 0, tacos: null });
  });

  it('keeps fixture invariants explicit', () => {
    const fixtures = JSON.parse(readFileSync(resolve('skills/amazon-advertising-ai-optimizer/tests/rules-fixtures.json'), 'utf8'));
    const invariants = JSON.parse(readFileSync(resolve('skills/amazon-advertising-ai-optimizer/tests/expected-decisions.json'), 'utf8')).invariants;
    expect(fixtures.germany.insufficient_sample.expected).toBe('no_bid_change');
    expect(fixtures.germany.bid_upper_bound.expected_max_change).toBe(0.2);
    expect(invariants).toContain('recommendations_are_not_execution_receipts');
  });

  it('uses a bounded advertising query contract instead of blind dataset retries', async () => {
    const result = await guide.execute({ name: 'amazon-advertising-ai-optimizer', reference: 'crossborderops-query-contract' });
    expect(result.text).toContain('daily.product');
    expect(result.text).toContain('必须提供 `asin`');
    expect(result.text).toContain('不重复发送同一个失败请求');
    const skill = readFileSync(resolve('skills/amazon-advertising-ai-optimizer/SKILL.md'), 'utf8');
    expect(skill).toContain('不要求每次分析全部加载');
  });

  it('requires a PDF artifact for complete downloadable reports', async () => {
    const result = await guide.execute({ name: 'amazon-advertising-ai-optimizer', reference: 'report-template' });
    expect(result.text).toContain('artifact.render_report');
    expect(result.text).toContain('artifact.submit');
    expect(result.text).toContain('不重复发送 PDF');
    const skill = readFileSync(resolve('skills/amazon-advertising-ai-optimizer/SKILL.md'), 'utf8');
    expect(skill).toContain('生成排版好的 PDF');
  });

  it.skipIf(!pythonHasReportlab)('renders the sample report as a non-empty PDF artifact', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'amazon-ad-report-'));
    const output = resolve(dir, 'report.pdf');
    try {
      execFileSync('python', [
        resolve('skills/amazon-advertising-ai-optimizer/scripts/render_ad_report.py'),
        '--input', resolve('skills/amazon-advertising-ai-optimizer/examples/sample-report.json'),
        '--output', output,
      ], { encoding: 'utf8' });
      expect(statSync(output).size).toBeGreaterThan(1000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
