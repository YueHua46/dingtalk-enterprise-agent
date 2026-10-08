import { z } from 'zod';
import type { Pool } from 'pg';
import type { AgentRequest } from './types.js';
import { listingInputSchema, prepareListingInput, type ListingInputContext, type PreparedListingInput } from './listing-input.js';
import { buildProductFactBook } from './listing-facts.js';
import { buildListingContentPlan, loadPlanningPolicy } from './listing-planning.js';
import { ListingResearchService, loadResearchPolicy, type ListingResearchResult } from './listing-research.js';
import { ListingGenerationService, loadGenerationPolicy } from './listing-generation.js';
import { loadListingRules, resolveListingRules } from './listing-rules.js';
import { loadValidationPolicy } from './listing-validation.js';
import { ListingRevisionService, loadRevisionPolicy, type ListingRevisionContext, type ListingRevisionScope } from './listing-revision.js';
import type { ListingRevisionStore } from './listing-revision-store.js';
import { buildListingExport, type ListingExport } from './listing-export.js';
import type { StructuredModel } from './structured-model.js';
import type { AmazonTool } from './amazon-tool.js';
import type { McpReadTool } from './mcp-read-tool.js';

const id = z.string().min(1).max(128);
const schemas = {
  prepare: z.strictObject({ input: listingInputSchema }),
  research: z.strictObject({ sessionId: id }),
  generate: z.strictObject({ sessionId: id }),
  inspect: z.strictObject({ sessionId: id }),
  revise: z.strictObject({ sessionId: id, baseVersionId: z.string().regex(/^[a-f0-9]{64}$/), instruction: z.string().min(1).max(12000),
    fields: z.array(z.enum(['title', 'bullets', 'bullets.0', 'bullets.1', 'bullets.2', 'bullets.3', 'bullets.4', 'description', 'searchTerms'])).min(1) }),
  export: z.strictObject({ sessionId: id }),
};
export const listingDynamicTools = [{ type: 'namespace', name: 'listing', description: '美国站英文 Listing 专用流程。本品事实与市场证据分离，代码校验后交付原会话，不上传后台。',
  tools: Object.entries(schemas).map(([name, schema]) => ({ type: 'function', name,
    description: ({prepare:'整理当前对话、附件或已授权产品文档。当前消息有标签产品参数时，只提供 mode/objective/keywords 等任务选项，materials 和 statements 留空；宿主自动绑定并提取完整原文，无需模型重复抄写或翻译。可选字段无值时省略，不填空字符串。缺失和冲突先补问。',research:'读取本品及自动/指定竞品、评论，返回有出处的市场参考。',
      generate:'用无工具权限的统一模型生成并代码校验，保存初始版本。需先 research。',inspect:'读取当前版本、检查及修改差异。',
      revise:'按运营要求修订指定字段，保留旧版本并重新校验；不得补充未经资料支持的功能。',export:'重新加载规则检查，生成 Word 对比报告与 Excel 并投递原会话。待核实/硬错误字段不进入可复制列。'} as Record<string,string>)[name],
    inputSchema: z.toJSONSchema(schema) })) }];

interface Session { prepared: PreparedListingInput; research?: ListingResearchResult; context?: ListingRevisionContext }
const publicVersion = (v: import('./listing-revision.js').ListingRevisionVersion) => ({id:v.id,parentId:v.parentId,ordinal:v.ordinal,
  draft:v.draft,validation:v.validation,difference:v.difference,model:v.generationReceipt?.metadata.model ?? null,
  promptVersion:v.generationReceipt?.metadata.promptVersion ?? null,ruleVersion:v.context.rules.version});
const publicRevision = (r: import('./listing-revision.js').ListingRevisionResult) => r.status==='version_saved'?{status:r.status,version:publicVersion(r.version)}:r;
export interface ListingSessionStore {
  get(scope: ListingRevisionScope): Promise<Session | null>;
  save(scope: ListingRevisionScope, session: Session): Promise<void>;
}
const key = (s: ListingRevisionScope) => JSON.stringify([s.owner.corpId,s.owner.userId,s.surface.type,s.surface.id,s.requestId]);
export class MemoryListingSessionStore implements ListingSessionStore {
  private data = new Map<string,Session>();
  async get(s: ListingRevisionScope) { return structuredClone(this.data.get(key(s)) ?? null); }
  async save(s: ListingRevisionScope, v: Session) { this.data.set(key(s),structuredClone(v)); }
}
export class PgListingSessionStore implements ListingSessionStore {
  constructor(private pool: Pool) {}
  async get(s: ListingRevisionScope) {
    const result = await this.pool.query('SELECT payload_text FROM listing_tool_sessions WHERE corp_id=$1 AND user_id=$2 AND surface_type=$3 AND surface_id=$4 AND session_id=$5',
      [s.owner.corpId,s.owner.userId,s.surface.type,s.surface.id,s.requestId]);
    if(!result.rows.length)return null;
    if(!result.rows[0].payload_text)throw new Error('LISTING_SESSION_SNAPSHOT_UPGRADE_REQUIRED');
    return JSON.parse(result.rows[0].payload_text) as Session;
  }
  async save(s: ListingRevisionScope,v: Session) {
    await this.pool.query(`INSERT INTO listing_tool_sessions(corp_id,user_id,surface_type,surface_id,session_id,payload,payload_text) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::text)
      ON CONFLICT(corp_id,user_id,surface_type,surface_id,session_id) DO UPDATE SET payload=excluded.payload,payload_text=excluded.payload_text,updated_at=now()`,
      [s.owner.corpId,s.owner.userId,s.surface.type,s.surface.id,s.requestId,JSON.stringify(v),JSON.stringify(v)]);
  }
}
export interface ListingToolPorts {
  sources(request: AgentRequest, prepared: PreparedListingInput['input']): Promise<ListingInputContext>;
  deliver(payload: ListingExport, signal?: AbortSignal): Promise<unknown>;
}
/** The conversation model cannot supply identity, validation flags, policies or draft receipts. */
export class ListingTool {
  constructor(private sessions: ListingSessionStore, private revisions: ListingRevisionService,
    private generation: ListingGenerationService, private researchService: ListingResearchService) {}
  static async create(sessions: ListingSessionStore, revisions: ListingRevisionStore, model: StructuredModel,
    amazon: Pick<AmazonTool,'execute'>, sif?: Pick<McpReadTool,'parse'|'execute'>) {
    const generation = new ListingGenerationService(model,await loadGenerationPolicy(new URL('../config/listing-generation.json',import.meta.url)));
    return new ListingTool(sessions,new ListingRevisionService(revisions,generation,await loadRevisionPolicy(new URL('../config/listing-revision.json',import.meta.url))),generation,
      new ListingResearchService(amazon,await loadResearchPolicy(new URL('../config/listing-research.json',import.meta.url)),sif));
  }
  async execute(request: AgentRequest, operation: string, raw: unknown, ports: ListingToolPorts, signal?: AbortSignal): Promise<any> {
    if (!(operation in schemas)) throw new Error('LISTING_OPERATION_INVALID');
    const args = schemas[operation as keyof typeof schemas].parse(raw) as any;
    const stop = () => { if (signal?.aborted) throw new Error('LISTING_CANCELLED'); }; stop();
    const scope: ListingRevisionScope = { requestId: args.sessionId ?? request.requestId, owner: {corpId:request.user.corpId,userId:request.user.userId},surface:request.surface };
    if (operation === 'prepare') {
      const prior = await this.sessions.get(scope);
      if (prior) throw new Error('LISTING_SESSION_EXISTS_USE_INSPECT');
      const input = args.input;
      if (!input.materials.length && request.text.trim()) input.materials = [{id:'conversation',kind:'conversation',reference:request.messageId,content:request.text}];
      for (const m of input.materials) if (m.kind === 'conversation') {
        m.reference = request.messageId;
        m.content = request.text;
      }
      const sourceContext = await ports.sources(request,input); stop();
      const rejectedCandidates: Array<{attribute:string;reason:string}> = [];
      const normalized = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
      input.statements = input.statements.filter((statement: any) => {
        const material = input.materials.find((m: any) => m.id === statement.sourceId);
        const grounded = material?.content?.includes(statement.excerpt) && normalized(statement.excerpt).includes(normalized(statement.value));
        if (!grounded) rejectedCandidates.push({attribute:statement.attribute,reason:'模型整理的候选不具备原文依据，已排除；有标签的产品原文仍由代码直接提取。'});
        return Boolean(grounded);
      });
      // Own ASIN pages are acquired by a fixed read adapter, never from model text.
      let research: ListingResearchResult | undefined;
      if (input.mode === 'optimize') {
        const seed = {input,owner:scope.owner,surface:scope.surface,requestId:scope.requestId,status:'needs_sources',issues:[],originalRequest:request.text} as PreparedListingInput;
        research = await this.researchService.research(seed,{...(signal ? {signal} : {})});
        if (research.originalListing) {
          const product = research.originalListing.product;
          const ownInput = {...input,materials:input.materials.filter((m: any)=>m.kind !== 'listing')};
          const ownPrepared = prepareListingInput({...ownInput,mode:'create',asin:undefined},sourceContext);
          const hasOwnFacts = buildProductFactBook(ownPrepared).facts.some(f=>f.status==='usable');
          const content = [`品牌: ${product.brand ?? ''}`,`标题: ${product.title}`,...product.bullets,
            ...(!hasOwnFacts ? ['页面声明: ' + [product.title,...product.bullets].join(' | ')] : [])].join('\n');
          sourceContext.listingSnapshots = {...sourceContext.listingSnapshots,[input.asin]:content};
          input.materials = input.materials.filter((m: any) => m.kind !== 'listing');
          input.materials.push({id:'own-page',kind:'listing',reference:input.asin,content});
        }
      }
      const prepared = prepareListingInput(input,sourceContext), book = buildProductFactBook(prepared);
      await this.sessions.save(scope,{prepared,...(research ? {research} : {})});
      return {sessionId:scope.requestId,status:book.status,issues:[...prepared.issues,...book.issues],rejectedCandidates,facts:book.facts, next:'research'};
    }
    const session = await this.sessions.get(scope); if (!session) throw new Error('LISTING_SESSION_NOT_FOUND');
    // Recheck user-scoped document/attachment sources before any model use or export.
    if (['research','generate','revise','export'].includes(operation)) {
      const currentSources = await ports.sources(request,session.prepared.input); stop();
      for (const material of session.prepared.input.materials) if (material.kind === 'document'
        && (!material.content || !currentSources.documentSnapshots[material.reference]?.includes(material.content))) throw new Error('LISTING_DOCUMENT_CHANGED_OR_UNSUPPORTED');
    }
    if (operation === 'research') {
      if (await this.revisions.read(scope)) throw new Error('LISTING_RESEARCH_FROZEN_AFTER_GENERATION');
      const research = session.research ?? await this.researchService.research(session.prepared,{...(signal ? {signal} : {})});
      stop(); const book = buildProductFactBook(session.prepared);
      const plan = buildListingContentPlan(book,research,await loadPlanningPolicy(new URL('../config/listing-planning.json',import.meta.url)));
      const context = {prepared:session.prepared,book,plan,...await this.rules(session.prepared)};
      await this.sessions.save(scope,{...session,research,context});
      // Raw external comments/titles never reach the tool-capable conversation model.
      // They remain durable evidence for the fixed report renderer; generation consumes configured topics only.
      return {sessionId:scope.requestId,status:plan.status,research:{status:research.status,gaps:research.gaps,
        competitors:research.competitors.map(c=>({asin:c.product.asin,origin:c.origin,eligibility:c.comparisonEligibility,
          reasons:c.reasons,price:c.product.price ?? null,rating:c.product.rating ?? null,reviewCount:c.product.review_count ?? null,
          sampledReviews:c.reviewSample?.count ?? 0}))},plan:{status:plan.status,
        keywords:plan.keywords.map(k=>({keyword:k.keyword,status:k.status,placement:k.placement,factIds:k.factIds})),
        insights:plan.insights.map(i=>({topicId:i.topicId,label:i.label,mentionCount:i.mentionCount,sampleSize:i.sampleSize,population:i.population})),notices:plan.notices}};
    }
    if (!session.context && operation === 'inspect') return {sessionId:scope.requestId,prepared:{status:session.prepared.status,issues:session.prepared.issues},next:'research'};
    if (!session.context) throw new Error('LISTING_RESEARCH_REQUIRED');
    const context = {...session.context,...await this.rules(session.prepared)};
    const head = await this.revisions.read(scope);
    if (operation === 'generate') {
      if (head) return {status:'version_saved',sessionId:scope.requestId,version:publicVersion(head)};
      const receipt = await this.generation.generate(context.prepared,context.book,context.plan,context.rules,{...(signal ? {signal} : {})}); stop();
      if (receipt.status === 'generation_failed') return receipt;
      return {sessionId:scope.requestId,...publicRevision(await this.revisions.initialize(scope,context,receipt,'initial'))};
    }
    if (operation === 'inspect') return head?{sessionId:scope.requestId,version:publicVersion(head)}:{sessionId:scope.requestId,prepared:{status:session.prepared.status,issues:session.prepared.issues},planStatus:context.plan.status,next:'generate'};
    if (!head) throw new Error('LISTING_GENERATION_REQUIRED');
    if (operation === 'revise') return {sessionId:scope.requestId,...publicRevision(await this.revisions.revise(scope,context,{kind:'model',operationId:request.requestId,
      baseVersionId:args.baseVersionId,instruction:args.instruction,fields:args.fields},{...(signal ? {signal} : {})}))};
    const previous = head.parentId ? await this.revisions.read(scope,head.parentId) : null;
    const payload = buildListingExport(scope,head,context,{...(previous ? {previous} : {}),...(session.research ? {research:session.research} : {})}); stop();
    const delivery = await ports.deliver(payload,signal);
    return {sessionId:scope.requestId,versionId:head.id,summary:payload.summary,delivery};
  }
  private async rules(prepared: PreparedListingInput) {
    return {rules:resolveListingRules(await loadListingRules(new URL('../config/listing-rules.us-en.json',import.meta.url)), {marketplace:'US',language:'en',...(prepared.input.productType ? {productType:prepared.input.productType} : {})}),
      validationPolicy:await loadValidationPolicy(new URL('../config/listing-validation.json',import.meta.url))};
  }
}
