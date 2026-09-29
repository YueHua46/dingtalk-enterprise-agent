import { randomUUID } from 'node:crypto';
import { capabilityById, capabilityCatalog } from './capability-catalog.js';

export interface TaskContract {
  mode?: 'conversation' | 'read' | 'write';
  goal: string;
  deliverables: string[];
  requiredFacts: Array<{ id: string; description: string; acceptableSources: string[]; enumeration?: 'all' | 'bounded' | 'point' | 'context'; grain?: string[] }>;
  assumptions: string[];
  openQuestions: string[];
  completionCriteria: string[];
}

export interface EvidenceRecord {
  id: string;
  capabilityId: string;
  source: string;
  status: 'success' | 'failed';
  observedAt: string;
  scope?: string;
  period?: string;
  freshness?: string;
  errorCode?: string;
  requestSignature?: string;
  pagination?: { groupKey: string; total: number; offset: number; returned: number; dimensions?: string[]; fixedDimensions?: string[] };
  members?: Array<{ key: string; country?: string }>;
  filterSite?: string;
}

export interface ClarificationRequest {
  question: string;
  reason: string;
  createdAt: string;
  expiresAt: string;
  answer?: string;
}

export interface TaskCompletion {
  status: 'answered' | 'partial' | 'blocked';
  answer: string;
  factEvidence: Record<string, string[]>;
  missingFacts: string[];
  /** Host-verified entity coverage gaps; never accepted from model input. */
  coverageGaps?: string[];
}

/**
 * A host side delivery receipt.  The receipt is deliberately small and
 * contains no image bytes; it is evidence that the file was sent to the
 * originating conversation and is safe to carry across a resumed task.
 */
export interface ScreenshotDeliveryReceipt {
  id: string;
  kind: 'screenshot';
  capabilityId: 'ziniao.cli';
  name: string;
  size: number;
  sha256: string;
  width: number;
  height: number;
  nonWhitePixels: number;
  visiblePixels: number;
  surfaceType: 'direct' | 'group';
  surfaceId: string;
  deliveredAt: string;
  generation: number;
  requestKey: string;
}

export interface WorkflowState {
  contract?: TaskContract;
  evidence: EvidenceRecord[];
  /** Bounded tool-result excerpts kept with the task so a resumed task can still be verified. */
  excerpts?: Record<string, string>;
  clarification?: ClarificationRequest;
  clarificationCount?: number;
  completion?: TaskCompletion;
  /** Sandbox files holding full tool results, in call order. */
  evidenceFiles?: Array<{ file: string; evidenceId: string; capabilityId: string; arguments: string }>;
  /** Verifier rounds spent on this task (bounded by the orchestrator). */
  reviewRounds?: number;
  revision: number;
  planCount?: number;
  budgetExhausted?: boolean;
  /** Persisted page generations and screenshot deliveries for idempotent resume. */
  ziniao?: {
    pageGeneration: number;
    screenshotDeliveries: ScreenshotDeliveryReceipt[];
  };
}

export const MAX_CLARIFICATIONS = 2;
const MAX_PLAN_REVISIONS = 6;
const MAX_STORED_EXCERPTS = 40;
const MAX_STORED_EXCERPT_CHARS = 12_000;

export const workflowDynamicTools = [{
  type: 'namespace', name: 'agent',
  description: '任务闭环：登记工作计划、向发起人澄清、提交最终答复。',
  tools: [{
    type: 'function', name: 'capabilities',
    description: '读取宿主能力目录；按 source 分页查看权限、用途、支持的证据及相关 Skill。source 可选 dws、ziniao、crossborderops、sif、lingxing、internet、image、skill、analysis。',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      source: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 60 }
    } }
  }, {
    type: 'function', name: 'workflow',
    description: [
      'operation=plan：可选。多步骤任务可登记工作计划 contract={goal, deliverables[], requiredFacts:[{id, description, acceptableSources:[能力ID], enumeration?: all|bounded|point|context, grain?: [维度]}], assumptions[]}；登记后宿主会在提交时核对每项事实是否有对应来源的成功证据，需要列全的事实（enumeration=all）还会核对分页完整性。计划可随进展修订。',
      'operation=clarify：仅当缺少只有发起人能决定、且会改变查询对象、跨越权限或影响真实写入目标的条件时使用，提供 question（给发起人的一个最小问题）与 reason。',
      'operation=complete：提交最终答复 completion={status: answered|partial|blocked, answer: 给用户的完整回答, factEvidence: {事实ID: [证据ID]}（可为空对象，宿主会自动关联）, missingFacts: [未满足的事实ID]}。宿主会核验答复是否被证据支持；未通过时一次性返回所有问题，逐条修正后重新提交。'
    ].join('\n'),
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        operation: { type: 'string', enum: ['plan', 'clarify', 'complete'] },
        contract: { type: 'object' },
        question: { type: 'string' }, reason: { type: 'string' },
        completion: {
          type: 'object', additionalProperties: false,
          properties: {
            status: { type: 'string', enum: ['answered', 'partial', 'blocked'] },
            answer: { type: 'string', minLength: 1, maxLength: 30000 },
            factEvidence: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
            missingFacts: { type: 'array', items: { type: 'string' } }
          },
          required: ['status', 'answer']
        }
      }, required: ['operation']
    }
  }]
}];

export class TaskWorkflow {
  public constructor(public readonly state: WorkflowState = { evidence: [], revision: 0 }) {}

  /**
   * The plan belongs to the executing agent. It is validated structurally so
   * the host can check evidence against it, but it is not a second opinion on
   * the user's intent: the final verifier always judges against the request.
   */
  public plan(raw: unknown): TaskContract {
    if ((this.state.planCount ?? 0) >= MAX_PLAN_REVISIONS) throw new Error('WORKFLOW_PLAN_BUDGET_EXCEEDED: 计划已多次修订，请依据已有证据继续执行或提交答复。');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('WORKFLOW_PLAN_INVALID: contract 必须是对象');
    const value = raw as Record<string, unknown>;
    const strings = (input: unknown, limit: number, field: string): string[] => {
      if (input === undefined) return [];
      if (!Array.isArray(input) || input.length > limit || input.some((item) => typeof item !== 'string' || !item.trim())) throw new Error(`WORKFLOW_PLAN_INVALID: ${field} 必须是不超过 ${limit} 项的非空字符串数组`);
      return input.map((item: string) => item.trim().slice(0, 500));
    };
    if (typeof value.goal !== 'string' || !value.goal.trim() || value.goal.length > 1000) throw new Error('WORKFLOW_PLAN_INVALID: goal 必填');
    if (value.mode !== undefined && !['conversation', 'read', 'write'].includes(String(value.mode))) throw new Error('WORKFLOW_PLAN_INVALID: mode 只能是 conversation|read|write');
    const requiredFacts = value.requiredFacts ?? [];
    if (!Array.isArray(requiredFacts) || requiredFacts.length > 20) throw new Error('WORKFLOW_PLAN_INVALID: requiredFacts 最多 20 项');
    const facts = requiredFacts.map((rawFact) => {
      if (!rawFact || typeof rawFact !== 'object') throw new Error('WORKFLOW_PLAN_INVALID: requiredFacts 项必须是对象');
      const fact = rawFact as Record<string, unknown>;
      if (typeof fact.id !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(fact.id) || typeof fact.description !== 'string' || !fact.description.trim()) {
        throw new Error('WORKFLOW_PLAN_INVALID: 事实 id 须为小写字母开头的 snake_case，description 必填');
      }
      const sources = strings(fact.acceptableSources, 15, 'acceptableSources');
      if (!sources.length) throw new Error(`WORKFLOW_FACT_SOURCE_REQUIRED:${fact.id}`);
      const unregistered = sources.filter((source) => !capabilityById(source));
      if (unregistered.length) throw new Error(`WORKFLOW_SOURCE_UNREGISTERED: ${unregistered.join(', ')}；可用来源族：${sourceFamilies()}`);
      const enumeration = fact.enumeration;
      if (enumeration !== undefined && !['all', 'bounded', 'point', 'context'].includes(String(enumeration))) throw new Error('WORKFLOW_FACT_ENUMERATION_INVALID');
      const grain = fact.grain;
      if (grain !== undefined && (!Array.isArray(grain) || grain.length > 10 || grain.some((part) => typeof part !== 'string' || !part.trim() || part.length > 80))) throw new Error('WORKFLOW_FACT_GRAIN_INVALID');
      return { id: fact.id, description: fact.description.slice(0, 500), acceptableSources: sources,
        ...(enumeration ? { enumeration: enumeration as 'all' | 'bounded' | 'point' | 'context' } : {}),
        ...(grain ? { grain: [...new Set((grain as string[]).map((part) => part.trim().toLowerCase()))] } : {}) };
    });
    if (new Set(facts.map((fact) => fact.id)).size !== facts.length) throw new Error('WORKFLOW_FACT_DUPLICATE');
    const contract: TaskContract = {
      ...(value.mode ? { mode: value.mode as 'conversation' | 'read' | 'write' } : {}),
      goal: value.goal.trim(), deliverables: strings(value.deliverables, 20, 'deliverables'), requiredFacts: facts,
      assumptions: strings(value.assumptions, 20, 'assumptions'), openQuestions: strings(value.openQuestions, 10, 'openQuestions'),
      completionCriteria: strings(value.completionCriteria, 20, 'completionCriteria')
    };
    this.state.contract = contract;
    this.state.planCount = (this.state.planCount ?? 0) + 1;
    delete this.state.completion;
    this.state.revision += 1;
    return contract;
  }

  public record(capabilityId: string, success: boolean, details: Partial<EvidenceRecord> = {}): EvidenceRecord {
    if (details.requestSignature) {
      const existing = this.state.evidence.find((item) => item.requestSignature === details.requestSignature && item.capabilityId === capabilityId);
      if (existing) return existing;
    }
    const descriptor = capabilityById(capabilityId);
    const record: EvidenceRecord = {
      id: randomUUID(), capabilityId, source: descriptor?.source ?? capabilityId.split('.')[0] ?? 'unknown',
      status: success ? 'success' : 'failed', observedAt: new Date().toISOString(),
      ...(details.scope ? { scope: details.scope } : {}),
      ...(details.period ? { period: details.period } : {}),
      ...(details.freshness ? { freshness: details.freshness } : {}),
      ...(details.errorCode ? { errorCode: details.errorCode } : {}),
      ...(details.requestSignature ? { requestSignature: details.requestSignature } : {}),
      ...(details.pagination ? { pagination: details.pagination } : {}),
      ...(details.members ? { members: details.members } : {}),
      ...(details.filterSite ? { filterSite: details.filterSite } : {})
    };
    this.state.evidence.push(record);
    if (this.state.evidence.length > 100) {
      const dropped = this.state.evidence.shift();
      if (dropped) delete this.state.excerpts?.[dropped.id];
    }
    this.state.revision += 1;
    return record;
  }


  /** Keeps a bounded excerpt with the task so verification survives resumption. */
  public storeExcerpt(evidenceId: string, text: string): void {
    const excerpts = this.state.excerpts ?? (this.state.excerpts = {});
    excerpts[evidenceId] = text.slice(0, MAX_STORED_EXCERPT_CHARS);
    const ids = Object.keys(excerpts);
    for (const id of ids.slice(0, Math.max(0, ids.length - MAX_STORED_EXCERPTS))) delete excerpts[id];
  }

  public clarify(question: unknown, reason: unknown, ttlMs = 24 * 60 * 60 * 1000): ClarificationRequest {
    if (this.state.clarification && !this.state.clarification.answer) throw new Error('WORKFLOW_CLARIFICATION_PENDING');
    if ((this.state.clarificationCount ?? 0) >= MAX_CLARIFICATIONS) {
      throw new Error('WORKFLOW_CLARIFICATION_BUDGET_EXCEEDED: 已向发起人澄清过，请依据已有信息采用合理默认值完成任务，并在答复中说明所作假设。');
    }
    if (typeof question !== 'string' || !question.trim() || question.length > 1000 || typeof reason !== 'string' || !reason.trim() || reason.length > 1000) {
      throw new Error('WORKFLOW_CLARIFICATION_INVALID: 需要同时提供 question 与 reason');
    }
    const now = Date.now();
    const clarification = { question: question.trim(), reason: reason.trim(), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlMs).toISOString() };
    this.state.clarification = clarification;
    this.state.clarificationCount = (this.state.clarificationCount ?? 0) + 1;
    this.state.revision += 1;
    return clarification;
  }

  public complete(raw: unknown): TaskCompletion {
    if (this.state.clarification && !this.state.clarification.answer) throw new Error('WORKFLOW_CLARIFICATION_PENDING');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('WORKFLOW_COMPLETION_INVALID: completion 必须包含 status 与 answer');
    const value = raw as Record<string, unknown>;
    const factEvidenceInput = value.factEvidence ?? {};
    const missingFactsInput = value.missingFacts ?? [];
    if (!['answered', 'partial', 'blocked'].includes(String(value.status)) || typeof value.answer !== 'string' || !value.answer.trim() || value.answer.length > 30_000
      || !factEvidenceInput || typeof factEvidenceInput !== 'object' || Array.isArray(factEvidenceInput)
      || !Array.isArray(missingFactsInput) || missingFactsInput.some((item) => typeof item !== 'string')) {
      throw new Error('WORKFLOW_COMPLETION_INVALID: completion={status:"answered|partial|blocked",answer:"完整回答",factEvidence:{},missingFacts:[]}');
    }
    const factEvidence = factEvidenceInput as Record<string, unknown>;
    const missingFacts = missingFactsInput as string[];
    const status = value.status as TaskCompletion['status'];
    const citations: Record<string, string[]> = {};
    const populationGaps: string[] = [];
    const successfulIds = new Set(this.state.evidence.filter((evidence) => evidence.status === 'success').map((evidence) => evidence.id));
    // Without a registered plan there are no named facts to check; the
    // verifier still judges every claim against all task evidence.
    if (!this.state.contract) {
      for (const [factId, ids] of Object.entries(factEvidence)) {
        if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new Error('WORKFLOW_EVIDENCE_INVALID');
        citations[factId] = (ids as string[]).filter((id) => successfulIds.has(id));
      }
    }
    for (const fact of this.state.contract?.requiredFacts ?? []) {
      const ids = factEvidence[fact.id];
      if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))) throw new Error('WORKFLOW_EVIDENCE_INVALID');
      const matches = (evidence: EvidenceRecord) => evidence.status === 'success' && fact.acceptableSources.some((source) => source === evidence.capabilityId || (source.endsWith('.*') && evidence.capabilityId.startsWith(source.slice(0, -1))));
      const submitted = ids as string[] | undefined ?? [];
      // The host already knows which successful calls match each registered
      // source. A missing citation is bookkeeping, not a reason to make the
      // model repeat a business query. The verifier still checks whether
      // those calls support the actual answer and its granularity.
      const autoLimit = Math.min(8, Math.max(0, 20 - new Set(Object.values(citations).flat()).size));
      let valid = submitted.length === 0 && status === 'answered'
        ? autoLimit > 0 ? this.state.evidence.filter(matches).slice(-autoLimit).map((evidence) => evidence.id) : []
        : submitted.filter((id) => this.state.evidence.some((evidence) => evidence.id === id && matches(evidence)));
      // A scope list alone proves authorization, not a business metric. When
      // the model cites only scope despite having matching business evidence,
      // retain both sources for verification.
      if (valid.length && valid.every((id) => this.state.evidence.find((item) => item.id === id)?.capabilityId === 'crossborderops.scope')) {
        const business = this.state.evidence.filter((item) => matches(item) && item.capabilityId.startsWith('crossborderops.daily.')).slice(-4);
        valid = [...valid, ...business.map((item) => item.id)].slice(0, 8);
      }
      citations[fact.id] = valid;
      if (fact.enumeration === 'all') {
        const pageEvidence = this.state.evidence.filter((evidence) => matches(evidence) && evidence.pagination);
        const populationSources = new Set(pageEvidence.flatMap((evidence) => (fact.grain ?? []).map((dimension) =>
          capabilityById(evidence.capabilityId)?.populationCapabilityByDimension?.[canonicalDimension(dimension)]).filter((source): source is string => Boolean(source))));
        const pages = pageEvidence.filter((evidence) => !populationSources.has(evidence.capabilityId)).map((evidence) => evidence.pagination!);
        const compatiblePages = fact.grain?.length ? pages.filter((page) => !page.dimensions || sameDimensions(page.dimensions, fact.grain!, page.fixedDimensions)) : pages;
        const citedPages = pageEvidence.filter((evidence) => valid.includes(evidence.id) && !populationSources.has(evidence.capabilityId)).map((evidence) => evidence.pagination!);
        if (fact.grain?.length && citedPages.length && citedPages.every((page) => page.dimensions && !sameDimensions(page.dimensions, fact.grain!, page.fixedDimensions))) {
          throw new Error(`WORKFLOW_GRAIN_MISMATCH:${fact.id}; 引用的分页结果与计划中的统计对象不一致。`);
        }
        if (pages.length && !compatiblePages.length) throw new Error(`WORKFLOW_GRAIN_MISMATCH:${fact.id}; 查询结果的分组维度与计划中的统计对象不一致。`);
        if (status === 'answered' && compatiblePages.length && !hasCompletePageGroup(compatiblePages)) {
          throw new Error(`WORKFLOW_PAGINATION_INCOMPLETE:${fact.id}; 同一查询条件的分页未覆盖 total，请继续获取剩余页面；若达到执行上限，仅报告已验证的部分及缺口。`);
        }
        for (const source of status === 'answered' ? populationSources : []) {
          const populationPages = this.state.evidence.filter((evidence) => evidence.capabilityId === source && evidence.status === 'success' && evidence.pagination)
            .map((evidence) => evidence.pagination!);
          if (!populationPages.length) throw new Error(`WORKFLOW_POPULATION_SOURCE_REQUIRED:${fact.id}:${source}; 聚合只覆盖已观测业务实体，请先获取授权对象全集。`);
          if (!hasCompletePageGroup(populationPages)) throw new Error(`WORKFLOW_POPULATION_INCOMPLETE:${fact.id}:${source}; 授权对象清单尚未翻完全部页面。`);
        }
        if (populationSources.has('crossborderops.scope')) {
          const aggregateEvidence = pageEvidence.filter((item) => item.capabilityId === 'crossborderops.daily.aggregate');
          const citedGroupKeys = new Set(aggregateEvidence.filter((item) => valid.includes(item.id)).map((item) => item.pagination!.groupKey));
          const aggregate = citedGroupKeys.size ? aggregateEvidence.filter((item) => citedGroupKeys.has(item.pagination!.groupKey)) : aggregateEvidence;
          const scope = this.state.evidence.filter((item) => item.capabilityId === 'crossborderops.scope' && item.status === 'success');
          if (aggregate.length && scope.length && hasMissingPopulationMembers(aggregate, scope)) {
            populationGaps.push(fact.id);
          }
        }
      }
      // Aggregates describe recorded business rows. When an authorization
      // scope was also queried, provide its coverage observation to the
      // verifier; do not turn it into a universal task state rule.
      if (fact.enumeration !== 'all') {
        const aggregateEvidence = this.state.evidence.filter((item) => matches(item)
          && item.capabilityId === 'crossborderops.daily.aggregate' && item.pagination
          && !item.pagination.fixedDimensions?.includes('asin'));
        if (aggregateEvidence.length) {
          const scopeEvidence = this.state.evidence.filter((item) => item.capabilityId === 'crossborderops.scope'
            && item.status === 'success' && item.pagination);
          if (scopeEvidence.length && hasCompletePageGroup(scopeEvidence.map((item) => item.pagination!))) {
            const citedGroupKeys = new Set(aggregateEvidence.filter((item) => valid.includes(item.id)).map((item) => item.pagination!.groupKey));
            const aggregate = citedGroupKeys.size ? aggregateEvidence.filter((item) => citedGroupKeys.has(item.pagination!.groupKey)) : aggregateEvidence;
            if (hasMissingPopulationMembers(aggregate, scopeEvidence, false)) populationGaps.push(fact.id);
          }
        }
      }
      if (status === 'answered' && valid.length === 0) {
        const available = this.state.evidence.filter((evidence) => matches(evidence)).map((evidence) => evidence.id);
        throw new Error(`WORKFLOW_FACT_UNSUPPORTED:${fact.id}; 计划要求该事实来自 ${fact.acceptableSources.join('、')}，但本任务尚无对应的成功证据（可用证据ID=${available.join(',') || '无'}）。请先取证，或以 partial 提交并在 missingFacts 中列出，或修订计划。`);
      }
      if (status !== 'answered' && valid.length === 0) {
        if (!missingFacts.includes(fact.id)) throw new Error(`WORKFLOW_MISSING_FACT_UNDECLARED:${fact.id}`);
        for (const source of fact.acceptableSources) {
          const attempted = this.state.evidence.some((evidence) => source === evidence.capabilityId || (source.endsWith('.*') && evidence.capabilityId.startsWith(source.slice(0, -1))));
          const inputLookupCompleted = source === 'artifact.read' && status === 'blocked'
            && this.state.evidence.some((evidence) => evidence.status === 'success'
              && ['dingtalk.chat.chat-messages', 'dingtalk.chat.search-msg', 'dingtalk.drive.search'].includes(evidence.capabilityId));
          if (inputLookupCompleted) continue;
          if (!attempted && !this.state.budgetExhausted) throw new Error(`WORKFLOW_SOURCE_NOT_ATTEMPTED:${fact.id}:${source}; 尚未尝试该来源，不能宣称缺失。`);
        }
      }
    }
    const completion: TaskCompletion = { status,
      answer: value.answer.trim(), factEvidence: citations, missingFacts,
      ...(populationGaps.length ? { coverageGaps: [...new Set(populationGaps)] } : {}) };
    this.state.completion = completion;
    this.state.revision += 1;
    return completion;
  }
}

function sourceFamilies(): string {
  // Wildcard families plus the individually registered fixed capabilities.
  const enumerated = new Set(['dws', 'ziniao', 'crossborderops', 'sif', 'lingxing']);
  return capabilityCatalog().filter((item) => item.id.endsWith('.*') || !enumerated.has(item.source)).map((item) => item.id).join(', ');
}

function hasMissingPopulationMembers(aggregate: EvidenceRecord[], scope: EvidenceRecord[], requireCompletePages = true): boolean {
  const authorized = scope.flatMap((item) => item.members ?? []);
  if (!authorized.length) return false;
  const groups = new Map<string, EvidenceRecord[]>();
  for (const item of aggregate) {
    const groupKey = item.pagination?.groupKey;
    if (groupKey) groups.set(groupKey, [...(groups.get(groupKey) ?? []), item]);
  }
  // Each query has its own filter and population. Exploratory queries with a
  // different filter must not silently expand or shrink another query's scope.
  return ![...groups.values()].some((group) => {
    if (requireCompletePages && !hasCompletePageGroup(group.map((item) => item.pagination!))) return false;
    const observedMembers = group.flatMap((item) => item.members ?? []);
    const observed = new Set(observedMembers.map((item) => item.key));
    const siteFiltered = group.some((item) => item.filterSite);
    const observedCountries = new Set(observedMembers.map((item) => item.country).filter(Boolean));
    if (siteFiltered && !observedCountries.size) return false;
    const relevant = siteFiltered ? authorized.filter((item) => item.country && observedCountries.has(item.country)) : authorized;
    return relevant.every((item) => observed.has(item.key));
  });
}

function canonicalDimension(value: string): string {
  // The aggregate adapter exposes `store` as its grouping ID and both
  // `store_name` and `lingxing_sid` as row fields identifying that grouping.
  // These are schema aliases, never user-text routing rules.
  return ['store_name', 'store_id', 'lingxing_sid'].includes(value) ? 'store' : value;
}

function sameDimensions(actual: string[], expected: string[], fixed: string[] = []): boolean {
  const expectedIds = expected.map(canonicalDimension);
  return expectedIds.every((value) => actual.includes(value)) && actual.every((value) => expectedIds.includes(value) || fixed.includes(value));
}

function hasCompletePageGroup(pages: Array<{ groupKey: string; total: number; offset: number; returned: number; dimensions?: string[]; fixedDimensions?: string[] }>): boolean {
  const groups = new Map<string, typeof pages>();
  for (const page of pages) groups.set(page.groupKey, [...(groups.get(page.groupKey) ?? []), page]);
  for (const group of groups.values()) {
    if (new Set(group.map((page) => page.total)).size !== 1) continue;
    const total = group[0]!.total;
    let covered = 0;
    for (const page of group.sort((a, b) => a.offset - b.offset)) {
      if (page.offset > covered) break;
      covered = Math.max(covered, page.offset + page.returned);
      if (covered >= total) return true;
    }
  }
  return false;
}

export function compactCapabilityCatalog(): string {
  return JSON.stringify(capabilityCatalog().map(({ id, purpose, risk, scope, source, inputShape, supports, skills }) => ({ id, purpose, risk, scope, source, inputShape, supports, skills })));
}

export function listCapabilities(input: unknown): { total: number; items: CapabilityDescriptorView[] } {
  const args = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const source = typeof args.source === 'string' ? args.source : undefined;
  const offset = Number.isSafeInteger(args.offset) && Number(args.offset) >= 0 ? Number(args.offset) : 0;
  const limit = Number.isSafeInteger(args.limit) && Number(args.limit) > 0 ? Math.min(Number(args.limit), 60) : 30;
  const rows = capabilityCatalog().filter((item) => !source || item.source === source);
  return { total: rows.length, items: rows.slice(offset, offset + limit).map(({ id, purpose, risk, identity, scope, inputShape, freshness, supports, skills }) => ({ id, purpose, risk, identity, scope, ...(inputShape ? { inputShape } : {}), freshness, supports, skills })) };
}

type CapabilityDescriptorView = Pick<ReturnType<typeof capabilityCatalog>[number], 'id' | 'purpose' | 'risk' | 'identity' | 'scope' | 'inputShape' | 'freshness' | 'supports' | 'skills'>;
