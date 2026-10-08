import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { prepareListingInput } from '../dist/listing-input.js';
import { buildProductFactBook } from '../dist/listing-facts.js';
import { buildListingContentPlan, loadPlanningPolicy } from '../dist/listing-planning.js';
import { loadListingRules, resolveListingRules } from '../dist/listing-rules.js';
import { loadValidationPolicy } from '../dist/listing-validation.js';
import { ListingGenerationService, loadGenerationPolicy } from '../dist/listing-generation.js';
import { ListingRevisionService, loadRevisionPolicy } from '../dist/listing-revision.js';
import { MemoryListingRevisionStore, PgListingRevisionStore } from '../dist/listing-revision-store.js';

// Fictional product only. Optional Pg run uses a unique, temporary schema, never deployed tables.
const postgres = process.argv.includes('--postgres');
const content = await readFile(new URL('../examples/listing/camera-product.txt', import.meta.url), 'utf8');
const prepared = prepareListingInput({ mode: 'create', objective: 'Draft accurately with clear storage and subscription limitations.',
  keywords: ['indoor security camera', '2k camera'], materials: [{ id: 'sample', kind: 'conversation', reference: 'sample', content }] }, {
  request: { requestId: 'fictional-generation-sample', messageId: 'sample', text: content,
    user: { corpId: 'sample', userId: 'sample' }, surface: { type: 'direct', id: 'sample' }, attachments: [] },
  documentSnapshots: {}, listingSnapshots: {},
});
const book = buildProductFactBook(prepared), scope = { owner: book.owner, surface: book.surface, requestId: book.requestId };
const research = { owner: book.owner, surface: book.surface, requestId: book.requestId, policyVersion: 'sample-no-research',
  status: 'partial', competitors: [], rejectedCandidates: [], evidence: [], gaps: [], salesClaims: 'public_signals_only_not_verified_sales',
  keywordSignals: prepared.input.keywords.map((keyword) => ({ keyword, source: 'user', volume: null })) };
const plan = buildListingContentPlan(book, research, await loadPlanningPolicy(new URL('../config/listing-planning.json', import.meta.url)));
const rules = resolveListingRules(await loadListingRules(new URL('../config/listing-rules.us-en.json', import.meta.url)), { marketplace: 'US', language: 'en' });
const context = { prepared, book, plan, rules, validationPolicy: await loadValidationPolicy(new URL('../config/listing-validation.json', import.meta.url)) };
const revisionPolicy = await loadRevisionPolicy(new URL('../config/listing-revision.json', import.meta.url));
let receipt, recordingKind;
try {
  const recording = JSON.parse(await readFile(new URL('../output/listing/generation-smoke.json', import.meta.url), 'utf8'));
  assert.equal(recording.result.status, 'draft_unvalidated'); receipt = recording.result; recordingKind = 'real_model_recording';
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const recording = JSON.parse(await readFile(new URL('../examples/listing/generation-sample.json', import.meta.url), 'utf8'));
  receipt = recording.result; recordingKind = 'fixed_mock_recording';
}
const field = (text, attributes) => ({ text, claims: [{ text, start: 0, end: text.length,
  factIds: attributes.map((attribute) => book.facts.find((f) => f.attribute === attribute).id) }] });
let calls = 0, modelDraft = structuredClone(receipt.draft), complete;
const generation = new ListingGenerationService({ async complete(request, signal) {
  calls++; assert.equal(JSON.parse(request.data).revision.fields.length, 1);
  return complete ? complete(request, signal) : { text: JSON.stringify(modelDraft), model: 'fixed-revision-mock', responseId: null };
} }, await loadGenerationPolicy(new URL('../config/listing-generation.json', import.meta.url)));

const schema = 'listing_revision_smoke_' + randomUUID().replaceAll('-', '');
assert.match(schema, /^listing_revision_smoke_[a-f0-9]+$/);
let admin, pool, schemaCreated = false;
try {
  if (postgres) {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL_REQUIRED');
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`); schemaCreated = true;
    pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=' + schema });
    await pool.query(await readFile(new URL('../migrations/012_listing_revisions.sql', import.meta.url), 'utf8'));
  }
  const store = postgres ? new PgListingRevisionStore(pool) : new MemoryListingRevisionStore();
  const service = new ListingRevisionService(store, generation, revisionPolicy, () => new Date('2026-09-30T12:00:00Z'));
  const save = (result) => { assert.equal(result.status, 'version_saved'); return result.version; };
  const v1 = save(await service.initialize(scope, context, receipt, 'initial'));
  const nightIndex = v1.draft.bullets.findIndex((b) => b.claims.some((c) => c.factIds.includes(book.facts.find((f) => f.attribute === 'night_vision').id)));
  assert.ok(nightIndex >= 0);
  const manual = { kind: 'manual', operationId: 'fix-night', baseVersionId: v1.id, reason: '补回资料中未声明彩色夜视的限定说明。',
    edits: [{ field: 'bullets.' + nightIndex, value: field('Infrared night vision; color night vision is not specified', ['night_vision']) }] };
  const v2 = save(await service.revise(scope, context, manual));
  assert.equal(v2.validation.metrics.controlledCoverage, 1);
  assert.deepEqual(await service.revise(scope, context, manual), { status: 'version_saved', version: v2 });
  modelDraft = structuredClone(v2.draft); modelDraft.title = field('ExampleBrand C1 2K Indoor Security Camera', ['brand', 'model', 'resolution', 'product_type']);
  const modelRequest = { kind: 'model', operationId: 'title', baseVersionId: v2.id, instruction: '只修改标题用词，保留全部产品事实。', fields: ['title'] };
  const v3 = save(await service.revise(scope, context, modelRequest));
  assert.equal(calls, 1); assert.deepEqual(v3.draft.bullets, v2.draft.bullets);
  assert.equal((await service.revise(scope, context, { ...modelRequest, operationId: 'stale' })).code, 'stale_version');
  assert.equal(calls, 1);
  const restoredStore = postgres ? new PgListingRevisionStore(pool) : store;
  const restored = new ListingRevisionService(restoredStore, generation, revisionPolicy);
  assert.deepEqual(await restored.read(scope), v3); assert.deepEqual(await restored.read(scope, v1.id), v1);
  assert.equal(await restored.read({ ...scope, owner: { ...scope.owner, userId: 'other' } }, v1.id), null);
  assert.equal(await restored.read({ ...scope, surface: { type: 'group', id: 'other' } }, v1.id), null);
  // Real adapter race: a late model result must not replace a newer manual commit.
  let resolve, started;
  const barrier = new Promise((r) => { started = r; });
  complete = () => { started(); return new Promise((r) => { resolve = r; }); };
  const slowRequest = { ...modelRequest, operationId: 'slow', baseVersionId: v3.id };
  const slow = service.revise(scope, context, slowRequest); await barrier;
  assert.equal((await service.revise(scope, context, slowRequest)).status, 'revision_pending');
  const v4 = save(await service.revise(scope, context, { kind: 'manual', operationId: 'race-winner', baseVersionId: v3.id,
    reason: '恢复简短标题作为独立新版本。', edits: [{ field: 'title', value: v1.draft.title }] }));
  resolve({ text: JSON.stringify(modelDraft), model: 'fixed-revision-mock', responseId: null });
  assert.equal((await slow).code, 'stale_version'); assert.equal((await restored.read(scope)).id, v4.id);
  const report = { kind: postgres ? 'isolated_postgres_and_mock_revision_not_dingtalk_e2e' : 'memory_replay_and_mock_revision', recordingKind,
    checks: { historyRestored: true, originalPreserved: true, idempotent: true, scopedReads: true, lateResultRejected: true,
      pendingDuplicateSkipped: true, fullRevalidation: true, modelCalls: calls },
    versions: [v1, v2, v3, v4].map((v) => ({ id: v.id, parentId: v.parentId, ordinal: v.ordinal, kind: v.kind,
      draft: v.draft, difference: v.difference, validation: { status: v.validation.status, metrics: v.validation.metrics, fields: v.validation.fields } })),
    limitations: ['产品为虚构样例', '真实模型文案仅使用已有记录，修订模型为固定 mock', '待核实规则仍未解除', '未验证钉钉端到端对话或文件交付'] };
  await mkdir(new URL('../output/listing/', import.meta.url), { recursive: true });
  const destination = postgres ? '../output/listing/revision-postgres-smoke.json' : '../examples/listing/revision-sample.json';
  await writeFile(new URL(destination, import.meta.url), JSON.stringify(report, null, 2));
  if (!postgres) await writeFile(new URL('../examples/listing/export-version-sample.json', import.meta.url), JSON.stringify({ version: v3, previous: v2 }, null, 2));
  console.log(JSON.stringify({ kind: report.kind, recordingKind, checks: report.checks, versions: report.versions.length,
    beforeControlledCoverage: v1.validation.metrics.controlledCoverage, afterControlledCoverage: v2.validation.metrics.controlledCoverage }));
} finally {
  await pool?.end();
  if (schemaCreated) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin?.end();
}
