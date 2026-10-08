import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { prepareListingInput } from '../dist/listing-input.js';
import { buildProductFactBook } from '../dist/listing-facts.js';
import { buildListingContentPlan, loadPlanningPolicy } from '../dist/listing-planning.js';
import { loadListingRules, resolveListingRules } from '../dist/listing-rules.js';
import { ListingGenerationService, loadGenerationPolicy } from '../dist/listing-generation.js';
import { ResponsesStructuredModel } from '../dist/structured-model.js';

const live = process.argv.includes('--live');
const content = await readFile(new URL('../examples/listing/camera-product.txt', import.meta.url), 'utf8');
const prepared = prepareListingInput({ mode: 'create', objective: 'Draft accurately with clear storage and subscription limitations.',
  keywords: ['indoor security camera', '2k camera'], materials: [{ id: 'sample', kind: 'conversation', reference: 'sample', content }] }, {
  request: { requestId: 'fictional-generation-sample', messageId: 'sample', text: content,
    user: { corpId: 'sample', userId: 'sample' }, surface: { type: 'direct', id: 'sample' }, attachments: [] },
  documentSnapshots: {}, listingSnapshots: {},
});
const book = buildProductFactBook(prepared);
const research = { owner: book.owner, surface: book.surface, requestId: book.requestId, policyVersion: 'sample-no-research',
  status: 'partial', competitors: [], rejectedCandidates: [], evidence: [], gaps: [], salesClaims: 'public_signals_only_not_verified_sales',
  keywordSignals: prepared.input.keywords.map((keyword) => ({ keyword, source: 'user', volume: null })) };
const plan = buildListingContentPlan(book, research, await loadPlanningPolicy(new URL('../config/listing-planning.json', import.meta.url)));
const rules = resolveListingRules(await loadListingRules(new URL('../config/listing-rules.us-en.json', import.meta.url)), { marketplace: 'US', language: 'en' });
const policy = await loadGenerationPolicy(new URL('../config/listing-generation.json', import.meta.url));
function field(text, attributes) {
  return { text, claims: [{ text, start: 0, end: text.length, factIds: attributes.map((attribute) => book.facts.find((f) => f.attribute === attribute && f.status === 'usable').id) }] };
}
const mockDraft = {
  title: field('ExampleBrand C1 2K Indoor Security Camera', ['brand', 'model', 'resolution', 'product_type']),
  bullets: [field('2K resolution', ['resolution']), field('USB wired power', ['power']),
    field('Infrared night vision; color night vision is not specified', ['night_vision']),
    field('Supports microSD storage; card sold separately', ['storage']), field('Cloud storage requires a paid subscription', ['subscription'])],
  description: field('Indoor installation requires a power connection. Includes camera, power cable and manual; storage card not included.', ['installation', 'package']),
  searchTerms: { text: 'indoor security camera 2k camera', keywordRefs: ['indoor security camera', '2k camera'],
    factIds: ['product_type', 'resolution'].map((attribute) => book.facts.find((f) => f.attribute === attribute).id) },
  changes: [{ field: 'description', reasonZh: '明确供电条件和包装不包含存储卡。', factIds: ['installation', 'package'].map((attribute) => book.facts.find((f) => f.attribute === attribute).id) }],
  verificationItems: [{ messageZh: '具体摄像头产品类型规则仍待核实；本稿未执行纯代码校验。', factIds: [] }],
};
const model = live ? new ResponsesStructuredModel({ MODEL_BASE_URL: process.env.MODEL_BASE_URL,
  MODEL_API_KEY: process.env.MODEL_API_KEY, MODEL_NAME: process.env.MODEL_NAME ?? 'gpt-5.6-sol' })
  : { async complete() { return { text: JSON.stringify(mockDraft), model: 'fixed-mock-v1', responseId: null }; } };
const result = await new ListingGenerationService(model, policy).generate(prepared, book, plan, rules);
const report = { kind: live ? 'real_model_fictional_product_not_dingtalk_e2e' : 'fixed_mock_fictional_product',
  testedAt: live ? new Date().toISOString() : null, result,
  limitations: ['虚构产品，不能用于发布', '模块 7 校验尚未接入', '未验证钉钉会话和文件投递', '本次未调用竞品工具'] };
if (!live) {
  await writeFile(new URL('../examples/listing/generation-sample.json', import.meta.url), JSON.stringify(report, null, 2), 'utf8');
} else {
  await mkdir(new URL('../output/listing/', import.meta.url), { recursive: true });
  await writeFile(new URL('../output/listing/generation-smoke.json', import.meta.url), JSON.stringify(report, null, 2), 'utf8');
}
console.log(JSON.stringify({ status: result.status, code: result.code ?? null, model: result.metadata?.model ?? null,
  bullets: result.draft?.bullets.length ?? 0, validation: result.validation ?? null }));
if (result.status !== 'draft_unvalidated') process.exitCode = 1;
