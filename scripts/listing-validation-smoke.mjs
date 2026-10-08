import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { prepareListingInput } from '../dist/listing-input.js';
import { buildProductFactBook } from '../dist/listing-facts.js';
import { buildListingContentPlan, loadPlanningPolicy } from '../dist/listing-planning.js';
import { loadListingRules, resolveListingRules } from '../dist/listing-rules.js';
import { validateListingGeneration, loadValidationPolicy } from '../dist/listing-validation.js';

// Replay module 6's fictional-product task exactly. No network, models, DWS or messages.
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
const policy = await loadValidationPolicy(new URL('../config/listing-validation.json', import.meta.url));
for (const [kind, source, destination] of [
  ['fixed_mock_replay', '../examples/listing/generation-sample.json', '../examples/listing/validation-sample.json'],
  ['real_model_recording_replay_not_live_e2e', '../output/listing/generation-smoke.json', '../output/listing/validation-smoke.json'],
]) {
  let recording;
  try { recording = JSON.parse(await readFile(new URL(source, import.meta.url), 'utf8')); }
  catch (error) { if (kind.startsWith('real_') && error.code === 'ENOENT') { console.log(JSON.stringify({ kind, skipped: 'no_recording' })); continue; } throw error; }
  const result = validateListingGeneration(recording.result, prepared, book, plan, rules, policy);
  const report = { kind, generationKind: recording.kind, generationVersion: recording.result.version ?? null,
    validation: result, limitations: ['产品资料为虚构样例', '真实稿仅回放模块 6 记录，没有再次调用模型', '没有验证钉钉端到端投递', '没有新增或核实 Amazon 平台规则'] };
  await mkdir(new URL('../output/listing/', import.meta.url), { recursive: true });
  await writeFile(new URL(destination, import.meta.url), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ kind, status: result.status, codeChecksPassed: result.codeChecksPassed, metrics: result.metrics,
    copyableFields: result.fields.filter((f) => f.copyable).length,
    contentIssues: result.issues.filter((i) => ['unsupported_expression', 'numeric_mismatch', 'condition_mismatch', 'unannotated_text'].includes(i.code)) }));
  if (result.status === 'invalid') process.exitCode = 1;
}
