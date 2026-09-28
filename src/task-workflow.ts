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

export interface WorkflowState {
  contract?: TaskContract;
  evidence: EvidenceRecord[];
  clarification?: ClarificationRequest;
  completion?: TaskCompletion;
  revision: number;
  planCount?: number;
  budgetExhausted?: boolean;
}

export const workflowDynamicTools = [{
  type: 'namespace', name: 'agent',
  description: '通用任务闭环。先登记任务目标与所需证据，再调用业务能力；仅在缺少不可安全推断的条件时追问；最后提交带证据的完成结果。',
  tools: [{
    type: 'function', name: 'capabilities',
    description: '读取宿主能力目录；按 source 分页查看权限、用途、支持的证据及相关 Skill。source 可选 dws、ziniao、crossborderops、sif、lingxing、internet、skill。',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      source: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 60 }
    } }
  }, {
    type: 'function', name: 'workflow',
    description: 'operation=plan 登记/修订任务契约；operation=clarify 请求发起人补充关键条件；operation=complete 时 completion 必须含 status(answered|partial|blocked)、answer(最终给用户的完整文字)、factEvidence(事实 ID 到成功证据 ID 数组的映射；可填空对象，由宿主关联已取得的合规证据)、missingFacts(未满足的事实 ID 数组；无缺口填 [])。status 仅供内部任务跟踪，不决定答复措辞；依据实际证据自然回答，并说明会影响结论的数据范围或缺口。宿主与独立审查器仍会核验事实、数据粒度及因果措辞。不要使用历史任务 ID，也不要使用 findings、facts 或 evidenceIds 代替这些字段。',
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
          required: ['status', 'answer', 'factEvidence', 'missingFacts']
        }
      }, required: ['operation']
    }
  }]
}];

export class TaskWorkflow {
  public constructor(public readonly state: WorkflowState = { evidence: [], revision: 0 }) {}

  public plan(raw: unknown): TaskContract {
    if ((this.state.planCount ?? 0) >= 3) throw new Error('WORKFLOW_PLAN_BUDGET_EXCEEDED');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('WORKFLOW_PLAN_INVALID');
    const value = raw as Record<string, unknown>;
    const strings = (input: unknown, limit: number): string[] => {
      if (!Array.isArray(input) || input.length > limit || input.some((item) => typeof item !== 'string' || !item.trim())) throw new Error('WORKFLOW_PLAN_INVALID');
      return input.map((item: string) => item.trim().slice(0, 500));
    };
    if (typeof value.goal !== 'string' || !value.goal.trim() || value.goal.length > 1000) throw new Error('WORKFLOW_PLAN_INVALID');
    if (value.mode !== undefined && !['conversation', 'read', 'write'].includes(String(value.mode))) throw new Error('WORKFLOW_PLAN_INVALID');
    const requiredFacts = value.requiredFacts;
    if (!Array.isArray(requiredFacts) || requiredFacts.length > 20) throw new Error('WORKFLOW_PLAN_INVALID');
    const facts = requiredFacts.map((rawFact) => {
      if (!rawFact || typeof rawFact !== 'object') throw new Error('WORKFLOW_PLAN_INVALID');
      const fact = rawFact as Record<string, unknown>;
      if (typeof fact.id !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(fact.id) || typeof fact.description !== 'string' || !fact.description.trim()) throw new Error('WORKFLOW_PLAN_INVALID');
      const sources = strings(fact.acceptableSources, 15);
      if (!sources.length) throw new Error('WORKFLOW_FACT_SOURCE_REQUIRED');
      const unregistered = sources.filter((source) => !capabilityById(source));
      if (unregistered.length) throw new Error(`WORKFLOW_SOURCE_UNREGISTERED: ${unregistered.join(', ')}`);
      const previous = this.state.contract?.requiredFacts.find((item) => item.id === fact.id);
      const enumeration = fact.enumeration ?? previous?.enumeration;
      if (enumeration !== undefined && !['all', 'bounded', 'point', 'context'].includes(String(enumeration))) throw new Error('WORKFLOW_FACT_ENUMERATION_INVALID');
      const grain = fact.grain ?? previous?.grain;
      if (grain !== undefined && (!Array.isArray(grain) || grain.length > 10 || grain.some((part) => typeof part !== 'string' || !part.trim() || part.length > 80))) throw new Error('WORKFLOW_FACT_GRAIN_INVALID');
      return { id: fact.id, description: fact.description.slice(0, 500), acceptableSources: sources,
        ...(enumeration ? { enumeration: enumeration as 'all' | 'bounded' | 'point' | 'context' } : {}),
        ...(grain ? { grain: [...new Set(grain.map((part) => part.trim().toLowerCase()))] } : {}) };
    });
    if (new Set(facts.map((fact) => fact.id)).size !== facts.length) throw new Error('WORKFLOW_FACT_DUPLICATE');
    if (value.mode !== 'conversation' && value.mode !== undefined && !facts.length) throw new Error('WORKFLOW_REQUIRED_FACT_MISSING');
    if (this.state.contract?.requiredFacts.some((prior) => !facts.some((fact) => fact.id === prior.id))) throw new Error('WORKFLOW_REQUIRED_FACT_REMOVAL_FORBIDDEN');
    if (this.state.contract?.requiredFacts.some((prior) => {
      const next = facts.find((fact) => fact.id === prior.id);
      return next?.description !== prior.description || JSON.stringify(next?.acceptableSources) !== JSON.stringify(prior.acceptableSources)
        || next?.enumeration !== prior.enumeration || JSON.stringify(next?.grain) !== JSON.stringify(prior.grain);
    })) throw new Error('WORKFLOW_REQUIRED_FACT_CHANGED');
    if (this.state.contract?.mode && value.mode !== this.state.contract.mode) throw new Error('WORKFLOW_MODE_CHANGED');
    const contract: TaskContract = {
      ...(value.mode ? { mode: value.mode as 'conversation' | 'read' | 'write' } : {}),
      goal: value.goal.trim(), deliverables: strings(value.deliverables, 20), requiredFacts: facts,
      assumptions: strings(value.assumptions, 20), openQuestions: strings(value.openQuestions, 10),
      completionCriteria: strings(value.completionCriteria, 20)
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
      ...(details.errorCode ? { errorCode: details.errorCode } : {})
      ,...(details.requestSignature ? { requestSignature: details.requestSignature } : {})
      ,...(details.pagination ? { pagination: details.pagination } : {})
      ,...(details.members ? { members: details.members } : {})
      ,...(details.filterSite ? { filterSite: details.filterSite } : {})
    };
    this.state.evidence.push(record);
    if (this.state.evidence.length > 100) this.state.evidence.shift();
    this.state.revision += 1;
    return record;
  }

  public clarify(question: unknown, reason: unknown, ttlMs = 24 * 60 * 60 * 1000): ClarificationRequest {
    if (!this.state.contract) throw new Error('WORKFLOW_PLAN_REQUIRED');
    if (this.state.contract.openQuestions.length === 0) throw new Error('WORKFLOW_CLARIFICATION_NOT_PLANNED: 当前契约没有需要用户决定的条件；请依据已有证据完成任务或修订经审查的契约。');
    if (typeof question !== 'string' || !question.trim() || question.length > 1000 || typeof reason !== 'string' || !reason.trim() || reason.length > 1000) throw new Error('WORKFLOW_CLARIFICATION_INVALID');
    const now = Date.now();
    const clarification = { question: question.trim(), reason: reason.trim(), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlMs).toISOString() };
    this.state.clarification = clarification;
    this.state.revision += 1;
    return clarification;
  }

  public complete(raw: unknown): TaskCompletion {
    if (!this.state.contract) throw new Error('WORKFLOW_PLAN_REQUIRED');
    if (this.state.clarification && !this.state.clarification.answer) throw new Error('WORKFLOW_CLARIFICATION_PENDING');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('WORKFLOW_COMPLETION_INVALID: completion 必须包含 status、answer、factEvidence、missingFacts');
    const value = raw as Record<string, unknown>;
    if (!['answered', 'partial', 'blocked'].includes(String(value.status)) || typeof value.answer !== 'string' || !value.answer.trim() || value.answer.length > 30_000
      || !value.factEvidence || typeof value.factEvidence !== 'object' || Array.isArray(value.factEvidence)
      || !Array.isArray(value.missingFacts) || value.missingFacts.some((item) => typeof item !== 'string')) {
      throw new Error('WORKFLOW_COMPLETION_INVALID: completion={status:"answered|partial|blocked",answer:"完整回答",factEvidence:{"事实ID":["成功证据ID"]},missingFacts:[]}');
    }
    const factEvidence = value.factEvidence as Record<string, unknown>;
    const missingFacts = value.missingFacts as string[];
    const citations: Record<string, string[]> = {};
    const populationGaps: string[] = [];
    for (const fact of this.state.contract.requiredFacts) {
      const ids = factEvidence[fact.id];
      if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))) throw new Error('WORKFLOW_EVIDENCE_INVALID');
      const matches = (evidence: EvidenceRecord) => evidence.status === 'success' && fact.acceptableSources.some((source) => source === evidence.capabilityId || (source.endsWith('.*') && evidence.capabilityId.startsWith(source.slice(0, -1))));
      const submitted = ids as string[] | undefined ?? [];
      // The host already knows which successful calls match each registered
      // source. A missing citation is bookkeeping, not a reason to make the
      // model repeat a business query. The independent reviewer still checks
      // whether those calls support the actual answer and its granularity.
      const autoLimit = Math.min(8, Math.max(0, 20 - new Set(Object.values(citations).flat()).size));
      let valid = submitted.length === 0 && value.status === 'answered'
        ? autoLimit > 0 ? this.state.evidence.filter(matches).slice(-autoLimit).map((evidence) => evidence.id) : []
        : submitted.filter((id) => this.state.evidence.some((evidence) => evidence.id === id && matches(evidence)));
      // A scope list alone proves authorization, not a business metric. When
      // the model cites only scope despite having matching business evidence,
      // retain both sources for independent semantic review.
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
          throw new Error(`WORKFLOW_GRAIN_MISMATCH:${fact.id}; 引用的分页结果与任务契约的统计对象不一致。`);
        }
        if (pages.length && !compatiblePages.length) throw new Error(`WORKFLOW_GRAIN_MISMATCH:${fact.id}; 查询结果的分组维度与任务契约要求的统计对象不一致。`);
        if (value.status === 'answered' && compatiblePages.length && !hasCompletePageGroup(compatiblePages)) {
          throw new Error(`WORKFLOW_PAGINATION_INCOMPLETE:${fact.id}; 同一查询条件的分页未覆盖 total，请继续获取剩余页面；若达到执行上限，仅报告已验证的部分及缺口。`);
        }
        for (const source of value.status === 'answered' ? populationSources : []) {
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
      // semantic reviewer; do not turn it into a universal task state rule.
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
      if (value.status === 'answered' && valid.length === 0) {
        const available = this.state.evidence.filter((evidence) => evidence.status === 'success' && fact.acceptableSources.some((source) => source === evidence.capabilityId || (source.endsWith('.*') && evidence.capabilityId.startsWith(source.slice(0, -1))))).map((evidence) => evidence.id);
        throw new Error(`WORKFLOW_FACT_UNSUPPORTED:${fact.id}; 本任务可用证据ID=${available.join(',') || '无'}`);
      }
      if (value.status !== 'answered' && valid.length === 0) {
        if (!missingFacts.includes(fact.id)) throw new Error(`WORKFLOW_MISSING_FACT_UNDECLARED:${fact.id}`);
        for (const source of fact.acceptableSources) {
          const attempted = this.state.evidence.some((evidence) => source === evidence.capabilityId || (source.endsWith('.*') && evidence.capabilityId.startsWith(source.slice(0, -1))));
          const inputLookupCompleted = source === 'artifact.read' && value.status === 'blocked'
            && this.state.evidence.some((evidence) => evidence.status === 'success'
              && ['dingtalk.chat.chat-messages', 'dingtalk.chat.search-msg', 'dingtalk.drive.search'].includes(evidence.capabilityId));
          if (inputLookupCompleted) continue;
          if (!attempted && !this.state.budgetExhausted) throw new Error(`WORKFLOW_SOURCE_NOT_ATTEMPTED:${fact.id}:${source}`);
        }
      }
    }
    const completion: TaskCompletion = { status: value.status as TaskCompletion['status'],
      answer: value.answer.trim(), factEvidence: citations, missingFacts,
      ...(populationGaps.length ? { coverageGaps: [...new Set(populationGaps)] } : {}) };
    this.state.completion = completion;
    this.state.revision += 1;
    return completion;
  }
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
