import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { PreparedListingInput } from './listing-input.js';
import type { ProductFactBook } from './listing-facts.js';
import type { ListingContentPlan } from './listing-planning.js';
import type { ResolvedListingRules } from './listing-rules.js';
import { ListingGenerationService, listingDraftSchema, type ListingDraft, type ListingGenerationResult } from './listing-generation.js';
import { validateListingDraft, validateListingGeneration, validationPolicySchema, type ListingValidationResult } from './listing-validation.js';
import type { ListingRevisionStore } from './listing-revision-store.js';

export interface ListingRevisionScope { requestId: string; owner: ProductFactBook['owner']; surface: ProductFactBook['surface'] }
export interface ListingRevisionContext {
  prepared: PreparedListingInput; book: ProductFactBook; plan: ListingContentPlan; rules: ResolvedListingRules;
  validationPolicy: z.infer<typeof validationPolicySchema>;
}
const text = z.string().min(1);
const target = z.string().regex(/^(?:title|bullets|description|searchTerms|bullets\.(?:0|[1-9]\d*))$/);
const common = { operationId: text, baseVersionId: z.string().regex(/^[a-f0-9]{64}$/) };
export const listingRevisionRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...common, kind: z.literal('model'), instruction: text, fields: z.array(target).min(1) }),
  z.strictObject({ ...common, kind: z.literal('manual'), reason: text,
    edits: z.array(z.strictObject({ field: target, value: z.unknown() })).min(1),
    verificationItems: listingDraftSchema.shape.verificationItems.optional() }),
]);
export type ListingRevisionRequest = z.infer<typeof listingRevisionRequestSchema>;
export const revisionPolicySchema = z.strictObject({
  version: text, maxInstructionCharacters: z.number().int().positive(), maxOperationIdCharacters: z.number().int().positive(),
  maxPatchBytes: z.number().int().positive(), maxStoredVersionBytes: z.number().int().positive(),
});
export async function loadRevisionPolicy(path: string | URL) { return revisionPolicySchema.parse(JSON.parse(await readFile(path, 'utf8'))); }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scopeKey = (s: ListingRevisionScope) => JSON.stringify([s.requestId, s.owner.corpId, s.owner.userId, s.surface.type, s.surface.id]);
type Receipt = Extract<ListingGenerationResult, { status: 'draft_unvalidated' }>;
export interface ListingFieldDifference {
  field: string; before: string | null; after: string | null; citationsChanged: boolean;
  edit: { prefixCodePoints: number; removed: string; added: string; suffixCodePoints: number };
}
export interface ListingVersionDifference {
  fields: ListingFieldDifference[]; notesChanged: boolean;
  context: { factsChanged: boolean; planChanged: boolean; rulesChanged: boolean; validationPolicyChanged: boolean };
  checks: { beforeStatus: ListingValidationResult['status'] | null; afterStatus: ListingValidationResult['status'];
    addedIssues: ListingValidationResult['issues']; resolvedIssues: ListingValidationResult['issues'] };
}
export interface ListingRevisionVersion {
  id: string; parentId: string | null; ordinal: number; operationId: string; createdAt: string;
  kind: 'initial' | 'manual' | 'model'; instruction: string | null; scope: ListingRevisionScope;
  context: ListingRevisionContext; draft: ListingDraft; validation: ListingValidationResult;
  generationReceipt: Receipt | null; difference: ListingVersionDifference;
}
export type ListingRevisionResult =
  | { status: 'version_saved'; version: ListingRevisionVersion }
  | { status: 'revision_pending' }
  | { status: 'revision_failed'; code: 'invalid_request' | 'scope_mismatch' | 'stale_version' | 'idempotency_conflict'
      | 'history_invalid' | 'invalid_draft' | 'generation_failed' | 'cancelled' | 'budget_exceeded'; generationCode?: string };
const failed = (code: Extract<ListingRevisionResult, { status: 'revision_failed' }>['code']): ListingRevisionResult => ({ status: 'revision_failed', code });

function fieldsOf(draft: ListingDraft) {
  return new Map<string, { text: string; refs: unknown }>([
    ['title', { text: draft.title.text, refs: draft.title.claims }],
    ...draft.bullets.map((b, i) => [`bullets.${i}`, { text: b.text, refs: b.claims }] as [string, { text: string; refs: unknown }]),
    ['description', { text: draft.description.text, refs: draft.description.claims }],
    ['searchTerms', { text: draft.searchTerms.text, refs: { factIds: draft.searchTerms.factIds, keywordRefs: draft.searchTerms.keywordRefs } }],
  ]);
}
function edit(before: string, after: string): ListingFieldDifference['edit'] {
  const a = [...before], b = [...after]; let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return { prefixCodePoints: start, removed: a.slice(start, a.length - end).join(''), added: b.slice(start, b.length - end).join(''), suffixCodePoints: end };
}
export function compareListingVersions(previous: ListingRevisionVersion | null, draft: ListingDraft,
  validation: ListingValidationResult, context: ListingRevisionContext): ListingVersionDifference {
  const before = previous ? fieldsOf(previous.draft) : new Map(), after = fieldsOf(draft);
  const fields: ListingFieldDifference[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(key), b = after.get(key); const citationsChanged = hash(a?.refs ?? null) !== hash(b?.refs ?? null);
    if (a?.text !== b?.text || citationsChanged) fields.push({ field: key, before: a?.text ?? null, after: b?.text ?? null, citationsChanged, edit: edit(a?.text ?? '', b?.text ?? '') });
  }
  const identity = (i: ListingValidationResult['issues'][number]) => hash(i);
  const oldIssues = previous?.validation.issues ?? [], oldKeys = new Set(oldIssues.map(identity)), newKeys = new Set(validation.issues.map(identity));
  return { fields, notesChanged: !previous || hash([previous.draft.changes, previous.draft.verificationItems]) !== hash([draft.changes, draft.verificationItems]),
    context: { factsChanged: previous?.context.book.version !== context.book.version, planChanged: previous?.context.plan.version !== context.plan.version,
      rulesChanged: previous?.context.rules.sha256 !== context.rules.sha256, validationPolicyChanged: !previous || hash(previous.context.validationPolicy) !== hash(context.validationPolicy) },
    checks: { beforeStatus: previous?.validation.status ?? null, afterStatus: validation.status,
      addedIssues: validation.issues.filter((i) => !oldKeys.has(identity(i))), resolvedIssues: oldIssues.filter((i) => !newKeys.has(identity(i))) } };
}
function readField(draft: ListingDraft, path: string): unknown {
  if (path.startsWith('bullets.')) return draft.bullets[Number(path.slice(8))];
  return draft[path as 'title' | 'bullets' | 'description' | 'searchTerms'];
}
function writeField(draft: ListingDraft, path: string, value: unknown): void {
  if (path === 'bullets') draft.bullets = listingDraftSchema.shape.bullets.parse(value);
  else if (path === 'searchTerms') draft.searchTerms = listingDraftSchema.shape.searchTerms.parse(value);
  else {
    const field = listingDraftSchema.shape.title.parse(value);
    if (path.startsWith('bullets.')) draft.bullets[Number(path.slice(8))] = field;
    else draft[path as 'title' | 'description'] = field;
  }
}
function validTargets(paths: string[], draft: ListingDraft): boolean {
  return new Set(paths).size === paths.length && !(paths.includes('bullets') && paths.some((p) => p.startsWith('bullets.')))
    && paths.every((p) => !p.startsWith('bullets.') || (Number.isSafeInteger(Number(p.slice(8))) && Number(p.slice(8)) < draft.bullets.length));
}
// Preserve refs only when source, attribute, full value, excerpt and trust all survive unchanged.
function rebindUnchangedFacts(draft: ListingDraft, old: ProductFactBook, current: ProductFactBook): ListingDraft {
  const result = structuredClone(draft);
  const signature = (f: ProductFactBook['facts'][number]) => hash([f.provenance.sourceId, f.provenance.sourceKind, f.attribute, f.rawValue, f.provenance.excerpt, f.trust]);
  const map = new Map(old.facts.map((f) => {
    const matches = current.facts.filter((g) => g.status === 'usable' && signature(f) === signature(g));
    return [f.id, matches.length === 1 ? matches[0]!.id : f.id];
  }));
  const refs = (ids: string[]) => ids.map((id) => map.get(id) ?? id);
  for (const field of [result.title, ...result.bullets, result.description]) for (const claim of field.claims) claim.factIds = refs(claim.factIds);
  result.searchTerms.factIds = refs(result.searchTerms.factIds);
  for (const note of [...result.changes, ...result.verificationItems]) note.factIds = refs(note.factIds);
  return result;
}

/** Internal draft storage only, with no approval state or external write. Host supplies scope and imported facts. */
export class ListingRevisionService {
  private readonly policy: z.infer<typeof revisionPolicySchema>;
  constructor(private readonly store: ListingRevisionStore, private readonly generation: ListingGenerationService,
    policy: unknown, private readonly now = () => new Date()) { this.policy = revisionPolicySchema.parse(policy); }

  async read(scope: ListingRevisionScope, id?: string): Promise<ListingRevisionVersion | null> {
    const boundScope = structuredClone(scope);
    const version = id ? await this.store.getVersion(boundScope, id) : await this.store.getHead(boundScope);
    if (version && !this.validVersion(version, boundScope)) throw new Error('LISTING_REVISION_HISTORY_INVALID');
    return version;
  }
  private validVersion(version: ListingRevisionVersion, scope: ListingRevisionScope) {
    const { id, ...body } = version;
    return scopeKey(version.scope) === scopeKey(scope) && hash(body) === id;
  }
  private async prior(scope: ListingRevisionScope, operationId: string, requestHash: string): Promise<ListingRevisionResult | null> {
    const op = await this.store.getOperation(scope, operationId);
    if (!op) return null;
    if (op.state === 'completed' && !op.result) return failed('history_invalid');
    if (op.result?.status === 'version_saved' && (!this.validVersion(op.result.version, scope) || op.result.version.operationId !== operationId)) return failed('history_invalid');
    return op.requestHash !== requestHash ? failed('idempotency_conflict') : op.state === 'pending' ? { status: 'revision_pending' } : op.result;
  }
  private version(scope: ListingRevisionScope, context: ListingRevisionContext, draft: ListingDraft, validation: ListingValidationResult,
    operationId: string, kind: ListingRevisionVersion['kind'], previous: ListingRevisionVersion | null, instruction: string | null, generationReceipt: Receipt | null) {
    const body = { parentId: previous?.id ?? null, ordinal: (previous?.ordinal ?? 0) + 1, operationId, createdAt: this.now().toISOString(), kind, instruction,
      scope: structuredClone(scope), context: structuredClone(context), draft: structuredClone(draft), validation, generationReceipt,
      difference: compareListingVersions(previous, draft, validation, context) };
    return { ...body, id: hash(body) };
  }
  private sameScope(scope: ListingRevisionScope, context: ListingRevisionContext) {
    return [context.prepared, context.book, context.plan].every((s) => scopeKey(s) === scopeKey(scope));
  }
  async initialize(scope: ListingRevisionScope, context: ListingRevisionContext, receipt: ListingGenerationResult, operationId: string): Promise<ListingRevisionResult> {
    if (!operationId.trim() || operationId.length > this.policy.maxOperationIdCharacters) return failed('invalid_request');
    const ctx = structuredClone(context), record = structuredClone(receipt), boundScope = structuredClone(scope);
    if (!this.sameScope(boundScope, ctx)) return failed('scope_mismatch');
    const requestHash = hash({ scope: boundScope, ctx, record });
    const prior = await this.prior(boundScope, operationId, requestHash); if (prior) return prior;
    const validation = validateListingGeneration(record, ctx.prepared, ctx.book, ctx.plan, ctx.rules, ctx.validationPolicy);
    if (record.status !== 'draft_unvalidated' || validation.status === 'invalid') return failed('invalid_draft');
    const version = this.version(boundScope, ctx, record.draft, validation, operationId, 'initial', null, null, record);
    if (Buffer.byteLength(JSON.stringify(version)) > this.policy.maxStoredVersionBytes) return failed('budget_exceeded');
    const started = await this.store.begin(boundScope, operationId, requestHash, null);
    if (started === 'duplicate') return (await this.prior(boundScope, operationId, requestHash))!;
    if (started === 'stale') return failed('stale_version');
    return this.store.finish(boundScope, operationId, requestHash, { status: 'version_saved', version });
  }
  async revise(scope: ListingRevisionScope, context: ListingRevisionContext, raw: unknown, options: { signal?: AbortSignal } = {}): Promise<ListingRevisionResult> {
    if (options.signal?.aborted) return failed('cancelled');
    const parsed = listingRevisionRequestSchema.safeParse(raw); if (!parsed.success) return failed('invalid_request');
    const request = parsed.data, ctx = structuredClone(context), boundScope = structuredClone(scope);
    const instruction = request.kind === 'model' ? request.instruction : request.reason;
    if (instruction.length > this.policy.maxInstructionCharacters || request.operationId.length > this.policy.maxOperationIdCharacters
      || Buffer.byteLength(JSON.stringify(request)) > this.policy.maxPatchBytes) return failed('budget_exceeded');
    if (!this.sameScope(boundScope, ctx)) return failed('scope_mismatch');
    const requestHash = hash({ scope: boundScope, context: ctx, request });
    const prior = await this.prior(boundScope, request.operationId, requestHash); if (prior) return prior;
    let previous: ListingRevisionVersion | null;
    try { previous = await this.read(boundScope, request.baseVersionId); } catch { return failed('history_invalid'); }
    if (!previous) return failed('stale_version');
    const paths = request.kind === 'model' ? request.fields : request.edits.map((e) => e.field);
    if (!validTargets(paths, previous.draft)) return failed('invalid_request');
    let candidate = rebindUnchangedFacts(previous.draft, previous.context.book, ctx.book);
    if (request.kind === 'manual') {
      try {
        for (const patch of request.edits) writeField(candidate, patch.field, patch.value);
        if (request.verificationItems) candidate.verificationItems = request.verificationItems;
        candidate.changes.push(...[...new Set(paths.map((p) => p.startsWith('bullets.') ? 'bullets' : p))].map((field) => ({
          field: field as ListingDraft['changes'][number]['field'], reasonZh: request.reason, factIds: [] })));
      } catch { return failed('invalid_request'); }
    }
    // Verify new host sources before sending them to the isolated generation stage.
    if (validateListingDraft(candidate, ctx.prepared, ctx.book, ctx.plan, ctx.rules, ctx.validationPolicy).status === 'invalid') return failed('invalid_draft');
    const started = await this.store.begin(boundScope, request.operationId, requestHash, request.baseVersionId);
    if (started === 'duplicate') return (await this.prior(boundScope, request.operationId, requestHash))!;
    if (started === 'stale') return failed('stale_version');
    const finish = (result: ListingRevisionResult) => this.store.finish(boundScope, request.operationId, requestHash, result);
    try {
      if (options.signal?.aborted) return finish(failed('cancelled'));
      let generationReceipt: Receipt | null = null;
      if (request.kind === 'model') {
        const policy = validationPolicySchema.parse(ctx.validationPolicy);
        const result = await this.generation.generate(ctx.prepared, ctx.book, ctx.plan, ctx.rules, {
          ...(options.signal ? { signal: options.signal } : {}),
          revision: { previousDraft: candidate, instruction, fields: paths,
            issues: previous.validation.issues.map(({ code, field, message }) => ({ code, field, message })),
            controlledExpressions: ctx.book.facts.filter((f) => f.status === 'usable').map((fact) => ({ factId: fact.id, attribute: fact.attribute, sourceValue: fact.rawValue,
              english: policy.expressions.filter((e) => e.attribute === fact.attribute && e.value === fact.rawValue).flatMap((e) => e.english) })) },
        });
        if (result.status !== 'draft_unvalidated') return finish({ status: 'revision_failed', code: result.code === 'cancelled' ? 'cancelled' : 'generation_failed', generationCode: result.code });
        generationReceipt = result;
        // Host keeps unaffected fields even when the model rewrites them.
        for (const path of paths) writeField(candidate, path, readField(result.draft, path));
        candidate.verificationItems = result.draft.verificationItems;
        const groups = new Set(paths.map((p) => p.startsWith('bullets.') ? 'bullets' : p));
        candidate.changes.push(...result.draft.changes.filter((c) => groups.has(c.field)));
      }
      if (options.signal?.aborted) return finish(failed('cancelled'));
      const validation = validateListingDraft(candidate, ctx.prepared, ctx.book, ctx.plan, ctx.rules, ctx.validationPolicy);
      if (validation.status === 'invalid') return finish(failed('invalid_draft'));
      const version = this.version(boundScope, ctx, candidate, validation, request.operationId, request.kind, previous, instruction, generationReceipt);
      if (Buffer.byteLength(JSON.stringify(version)) > this.policy.maxStoredVersionBytes) return finish(failed('budget_exceeded'));
      return finish({ status: 'version_saved', version });
    } catch { return finish(failed('invalid_draft')); }
  }
}
