import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { ListingResearchService, loadResearchPolicy } from '../dist/listing-research.js';
import { prepareListingInput } from '../dist/listing-input.js';
import { buildProductFactBook } from '../dist/listing-facts.js';
import { buildListingContentPlan, loadPlanningPolicy } from '../dist/listing-planning.js';

// Read-only public Amazon smoke. Never deploys, calls DWS, sends messages or reads credentials.
const run = promisify(execFile);
const container = process.env.LISTING_SMOKE_CONTAINER ?? 'dingtalk-enterprise-agent-gateway-1';
if (!/^[a-zA-Z0-9_.-]+$/.test(container)) throw new Error('INVALID_CONTAINER_NAME');
const policy = await loadResearchPolicy(new URL('../config/listing-research.json', import.meta.url));
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 240000);
const amazon = {
  async execute(operation, input) {
    const command = { search_products: 'search', get_product_detail: 'detail', get_reviews: 'reviews' }[operation];
    if (!command) throw new Error('UNSUPPORTED_SMOKE_OPERATION');
    const args = ['exec', '-w', '/opt/amazon-skill', container, '/opt/amazon-venv/bin/python', '-m', 'amazon_skill.cli', command, '--marketplace', 'US'];
    if (operation === 'search_products') args.push(...input.keywords.flatMap((keyword) => ['--keyword', keyword]), '--max-pages', '1', '--max-results', '15', '--organic-only');
    else args.push('--asin', input.asin);
    if (operation === 'get_reviews') args.push('--max-pages', '1');
    process.stdout.write(JSON.stringify({ stage: operation, asin: input.asin ?? null }) + '\n');
    const response = await run('docker', args, { timeout: 60000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, signal: controller.signal });
    return JSON.parse(response.stdout);
  },
};
const content = '产品类型：室内摄像头。仅用于调研能力验证，不生成商品声明。';
const prepared = prepareListingInput({ mode: 'create', productType: 'indoor security camera', keywords: ['indoor security camera'],
  materials: [{ id: 'smoke', kind: 'conversation', reference: 'local-smoke', content }] }, {
  request: { requestId: 'listing-readonly-smoke', messageId: 'local-smoke', text: content, user: { corpId: 'local-test', userId: 'local-test' },
    surface: { type: 'direct', id: 'local-test' }, attachments: [] }, documentSnapshots: {}, listingSnapshots: {},
});
try {
  const result = await new ListingResearchService(amazon, { ...policy, maxCompetitors: 3, maxDetailCandidates: 5 }).research(prepared, { signal: controller.signal });
  const planning = buildListingContentPlan(buildProductFactBook(prepared), result,
    await loadPlanningPolicy(new URL('../config/listing-planning.json', import.meta.url)));
  const report = {
    testedAt: new Date().toISOString(), kind: 'public_readonly_integration_not_dingtalk_e2e',
    status: result.status, planning: { version: planning.version, status: planning.status,
      keywords: planning.keywords, insights: planning.insights, notices: planning.notices,
      sellingPointCount: planning.sellingPoints.length }, queries: result.keywordSignals, competitors: result.competitors.map((item) => ({
      asin: item.product.asin, title: item.product.title, reasons: item.reasons, eligibility: item.comparisonEligibility,
      reviewSampleCount: item.reviewSample?.count ?? null, reviewPopulation: item.reviewSample?.population ?? null,
    })), gaps: result.gaps, rejectedCandidates: result.rejectedCandidates,
    evidence: result.evidence.map(({ id, tool, observedAt, sha256 }) => ({ id, tool, observedAt, sha256 })),
    checks: { searchEvidence: result.evidence.some((item) => item.tool === 'amazon.search_products'),
      productDetailEvidence: result.competitors.length > 0,
      reviewResponseEvidence: result.evidence.some((item) => item.tool === 'amazon.get_reviews'),
      validReviewSamples: result.competitors.some((item) => (item.reviewSample?.count ?? 0) > 0) },
    limitations: ['未测试钉钉消息流程', '未测试 SIF 真实指标结构', '仅使用公开信号，不确认销量或爆款'],
  };
  const directory = new URL('../output/listing/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('research-smoke.json', directory), JSON.stringify(report, null, 2), 'utf8');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!report.checks.searchEvidence || !report.checks.productDetailEvidence) process.exitCode = 1;
} finally { clearTimeout(timer); }
