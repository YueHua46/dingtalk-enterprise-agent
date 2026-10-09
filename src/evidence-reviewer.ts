import type { Config } from './config.js';
import type { TaskContract, TaskCompletion, EvidenceRecord } from './task-workflow.js';
import {requestModelWithRetry,type ModelRetryState} from './model-request-retry.js';

export interface ReviewIssue {
  severity: 'blocking' | 'advisory';
  category: string;
  location: string;
  problem: string;
  fix: string;
}

/**
 * pass: deliverable as is. revise: at least one blocking issue.
 * unavailable: the verifier itself failed (network, timeout, unparseable
 * output). That is an infrastructure outcome, never a verdict on the answer.
 */
export interface ReviewResult {
  status: 'pass' | 'revise' | 'unavailable';
  issues: ReviewIssue[];
  reason: string;
}

export interface ReviewInput {
  request: string;
  quotedText?: string;
  clarificationAnswer?: string;
  contract?: TaskContract;
  completion: TaskCompletion;
  evidence: EvidenceRecord[];
  excerpts: Record<string, string>;
  computeAvailable: boolean;
  round: number;
  maxRounds: number;
  profile?: ReviewProfile;
}

export type ReviewProfile = 'simple_product' | 'knowledge_general' | 'analysis';

const EXCERPT_BUDGET_CHARS = 160_000;
const EXCERPT_MAX_CHARS = 12_000;
const REVIEW_TIMEOUT_MS = 90_000;
const SIMPLE_PRODUCT_REVIEW_TIMEOUT_MS = 30_000;

// One rubric, one call, every issue at once. Earlier designs chained several
// narrow judges that each saw different inputs and stopped at the first
// failure; they contradicted each other and forced one-issue-per-round loops.
const RUBRIC = [
  '你是企业 Agent 的交付前核验器。你的职责是拦截会误导用户的错误，不是改写风格或施加个人偏好。',
  '依据优先级：用户原话、引用消息与澄清回答（request / quotedText / clarificationAnswer）是唯一目标来源；contract 是 Agent 自己的工作计划，仅作参考，与原话冲突时以原话为准。',
  '一次性完成下列全部检查，列出所有问题，不要只报第一个：',
  '1. goal：答复是否回答了用户实际要求的对象、时间含义、指标、分析动作和交付物；是否用另一个可查询的问题替代了原问题；关键交付物是否缺失。',
  '2. fact：答复中每个具体数据（数值、日期、名称、排名、状态）必须能在 evidence 中找到同对象、同口径、同时段的依据。直接从证据行读取的数值逐项核对。由多行派生的数值（求和、均值、比率、环比、排名），若存在 analysis.python 证据，则核对答复与其输出一致，并检查代码读取的证据文件与筛选条件是否正确；不存在计算证据时，只在你能直接、确定地核对时才判断对错，不要凭心算推翻答复。computeAvailable=true 时，重要的派生数值既无计算证据又无法直接核对，列为 blocking 并要求用 analysis.python 计算；computeAvailable=false 时列为 advisory。',
  '3. coverage：声称“全部”“共 N 个”“完整排名”时，用 dataQuality 的 total、offset、returnedRowCount、filters、dimensions 核对分页是否连续覆盖；授权范围不等于数据覆盖，没有业务行不等于零；不同币种或计量单位没有可信换算时不能比较或排名。completion.coverageGaps 是宿主观察到的覆盖差异。若答复把部分结果说成全部、把缺失当零、或隐去会改变结论的缺口，列为 blocking；答复已如实限定范围则不是问题。',
  '4. inference：用户要求分析原因、诊断、建议或运用经验判断时，基于证据的推断和运营建议本身就是交付物，不要因为用户没逐字要求建议就要求删除。要求是：推断与已证事实可区分（例如“可能”“推测”“待验证”或分级标注），并说明依据；把推断写成已被数据证实、或断言证据无法支持的因果关系，才是 blocking。逐条检查原因陈述：只有同期变化或相关性、却用“导致”“抑制了”“核心诱因是”等确定措辞的，是 blocking；断言证据里根本没有的对象属性（如主图质量、评价内容、竞品动作、促销活动）而未标为待核查的，是 blocking。修正方法是改为分级措辞，而不是删除分析或建议。通用行业常识无需证据；平台规则、费率、阈值、价格等可能变化的具体数字没有本任务证据时是 blocking。',
  '5. relevance：只有当额外内容替换了用户目标、淹没了答案、或披露与请求无关的业务明细或个人信息时才是问题。必要的口径说明、数据截至日、数据缺口、下一步建议不是问题。',
  '知识库证据专项：先依据用户原话确定问题是限定某份文档/图片/页/版本，还是允许跨资料综合。knowledge_evidence 中的 request、sources、entries.position 是宿主记录的真实查询与出处，必须逐条核对。不同来源中存在相同列名、型号、数值或相似标题，不能证明它们是同一截图、同一目标表格或同一版本；跨来源对应关系也需要直接证据。指定资料缺图或缺标注时，把别的资料中的值确定说成指定资料的值是 blocking；应明确无法确认，可将其他来源作为未确认参考，但不能替代所问事实。指定一张图时，不要混入另一张图的选型结论。资料中的读取错误只证明当前读取未取得内容，不能断言原文档没有图片。原始资料与参数表出现不同口径时必须分别说明，不能无依据选择其一。省略、截断的证据不能当成已核验的全文。',
  '6. safety：答复不得包含凭证、令牌、内部文件路径、证据 ID 或工具参数。',
  'completion.sourceRefs 是答案实际采用的知识库资料身份，宿主只校验身份和生成真实链接，不保证引用支持结论。若提供 sourceRefs，逐条检查是否覆盖答复采用的来源、冲突双方，是否把无关资料冒充依据；遗漏支持核心结论的来源或错误归属列为 blocking。没有提供 sourceRefs 时仍核验答复已有引用和事实，不要为补引用重复查资料。',
  '当 reviewProfile=simple_product 时，只核对用户所问型号的字段、单位、来源位置和型号候选匹配；不要因为未传入整份规格书而要求额外搜索。发现字段已由结构化 facts 完整支持且无冲突时，最多报告确定的事实或出处问题。',
  '推断的成立条件也要核验：标注“推断”不表示可以给出条件不足的必然关系。资料只说明趋势时，额外解释不能升级为无条件的工程结论；若存在可控制、固定或未说明的关键变量，应限定适用条件或说明取决于该变量。不要把一般趋势说成任何设置下都成立，不要用背景常识替代用户限定来源的原文结论。',
  '严重级别：blocking = 用户会因此得到错误事实、错误对象、把猜测当事实、隐去关键缺口、或缺少核心交付物；advisory = 可改进但不影响正确性。风格、措辞、篇幅偏好一律不是 blocking。',
  '每个问题都给出可直接执行的修正方法 fix（例如改为哪个数值、删除哪一句、补充哪个口径、用 analysis.python 计算什么）。',
  '当 round 等于 maxRounds 时，这是最后一轮：只保留你完全确定的 blocking 问题。',
  '只输出 JSON：{"issues":[{"severity":"blocking|advisory","category":"goal|fact|coverage|inference|relevance|safety","location":"答复中的原句或小节","problem":"具体问题","fix":"具体修正方法"}]}。没有问题时输出 {"issues":[]}。'
].join('\n');

export class EvidenceReviewer {
  public constructor(private readonly config: Pick<Config, 'MODEL_BASE_URL' | 'MODEL_API_KEY' | 'MODEL_NAME'> & Partial<Pick<Config,'MODEL_REQUEST_MAX_ATTEMPTS'|'MODEL_REQUEST_RETRY_BUDGET_MS'>>, private readonly http: typeof fetch = fetch) {}

  public async review(input: ReviewInput): Promise<ReviewResult> {
    if (!this.config.MODEL_BASE_URL || !this.config.MODEL_API_KEY) return { status: 'unavailable', issues: [], reason: 'reviewer_not_configured' };
    const profile = input.profile ?? 'knowledge_general';
    const payload = buildPayload(input);
    let lastError = 'review_failed';
    const timeout = profile === 'simple_product' ? SIMPLE_PRODUCT_REVIEW_TIMEOUT_MS : REVIEW_TIMEOUT_MS;
    const retryState={attempts:0,deadlineAt:Date.now()+Math.min(timeout,this.config.MODEL_REQUEST_RETRY_BUDGET_MS??timeout)};
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const issues = await this.ask(payload,retryState,profile);
        const blocking = issues.filter((issue) => issue.severity === 'blocking');
        return blocking.length
          ? { status: 'revise', issues, reason: blocking.map((issue) => issue.problem).join('；').slice(0, 400) }
          : { status: 'pass', issues, reason: 'supported' };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    return { status: 'unavailable', issues: [], reason: lastError.slice(0, 200) };
  }

  private async ask(payload: unknown,retryState:ModelRetryState,profile:ReviewProfile): Promise<ReviewIssue[]> {
    const endpoint = this.config.MODEL_BASE_URL!.replace(/\/+$/, '') + '/responses';
    const {response} = await requestModelWithRetry(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.config.MODEL_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.config.MODEL_NAME, stream: false, input: [
        { role: 'system', content: RUBRIC },
        { role: 'user', content: JSON.stringify(payload) }
      ] }),
      signal: AbortSignal.timeout(Math.max(1,retryState.deadlineAt-Date.now()))
    },{maxAttempts:profile === 'simple_product' ? 2 : this.config.MODEL_REQUEST_MAX_ATTEMPTS??6,
      budgetMs:profile === 'simple_product' ? SIMPLE_PRODUCT_REVIEW_TIMEOUT_MS : REVIEW_TIMEOUT_MS,state:retryState,http:this.http});
    if (!response.ok) throw new Error(`review_http_${response.status}`);
    const body = await response.json() as { output?: Array<{ content?: Array<{ text?: string }> }> };
    const text = body.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? '').join('') ?? '';
    return parseIssues(text);
  }
}

export function parseIssues(text: string): ReviewIssue[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('review_invalid');
  const parsed = JSON.parse(text.slice(start, end + 1)) as { issues?: unknown };
  if (!Array.isArray(parsed.issues)) throw new Error('review_invalid');
  const clip = (value: unknown, limit: number) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
  return parsed.issues.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const problem = clip(item.problem, 400);
    if (!problem) return [];
    return [{ severity: item.severity === 'blocking' ? 'blocking' as const : 'advisory' as const,
      category: clip(item.category, 40) || 'other', location: clip(item.location, 200), problem, fix: clip(item.fix, 400) }];
  }).slice(0, 20);
}

export function formatIssues(issues: ReviewIssue[]): string {
  return issues.map((issue, index) => `${index + 1}. [${issue.severity === 'blocking' ? '必须修正' : '建议'}·${issue.category}] ${issue.location ? `「${issue.location}」` : ''}${issue.problem}${issue.fix ? `\n   修正：${issue.fix}` : ''}`).join('\n');
}

function buildPayload(input: ReviewInput): Record<string, unknown> {
  const successful = input.evidence.filter((item) => item.status === 'success');
  const cited = [...new Set(Object.values(input.completion.factEvidence).flat())];
  // Computations first (they carry the derived numbers), then citations, then
  // the most recent remaining evidence, until the character budget is spent.
  const ordered = [
    ...successful.filter((item) => item.capabilityId === 'analysis.python').map((item) => item.id).reverse(),
    ...cited,
    ...successful.map((item) => item.id).reverse()
  ];
  const excerpts: Record<string, string> = {};
  const profile = input.profile ?? 'knowledge_general';
  let budget = profile === 'simple_product' ? 40_000 : EXCERPT_BUDGET_CHARS;
  for (const id of new Set(ordered)) {
    const text = input.excerpts[id];
    if (!text || budget <= 0) continue;
    let limit=profile === 'simple_product' ? 8_000 : EXCERPT_MAX_CHARS;
    try{if(JSON.parse(text)?.kind==='knowledge_evidence')limit=profile === 'simple_product' ? 20_000 : 40000;}catch{/* Other formats retain their existing bounds. */}
    const slice = text.slice(0, Math.min(limit, budget));
    excerpts[id] = slice;
    budget -= slice.length;
  }
  const missingExcerpts = successful.filter((item) => !input.excerpts[item.id]).map((item) => item.id);
  return {
    request: input.request,
    currentTime: new Date().toISOString(),
    conversationTimezone: 'Asia/Shanghai',
    ...(input.quotedText ? { quotedText: input.quotedText } : {}),
    ...(input.clarificationAnswer ? { clarificationAnswer: input.clarificationAnswer } : {}),
    ...(input.contract ? { contract: input.contract } : {}),
    completion: input.completion,
    computeAvailable: input.computeAvailable,
    round: input.round,
    maxRounds: input.maxRounds,
    reviewProfile: profile,
    evidence: input.evidence,
    dataQuality: dataQuality(input.excerpts),
    excerpts,
    ...(missingExcerpts.length ? { excerptsUnavailable: missingExcerpts } : {})
  };
}

function dataQuality(excerpts: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(excerpts).flatMap(([id, value]) => {
    try {
      const result = JSON.parse(value) as { dataset?: unknown; data?: Record<string, unknown> };
      if (!result.data || typeof result.data !== 'object') return [];
      const { coverage, period, current_period, baseline_period, total, limit, offset, filters, dimensions, coverage_rule, population_provenance, currency_note, rows } = result.data;
      if (!coverage && !coverage_rule && total === undefined) return [];
      const currencies = Array.isArray(rows) ? [...new Set(rows.map((row) => row && typeof row === 'object' ? (row as Record<string, unknown>).currency : undefined).filter((value): value is string => typeof value === 'string'))] : [];
      return [[id, { dataset: result.dataset, coverage, period, current_period, baseline_period, total, limit, offset,
        returnedRowCount: Array.isArray(rows) ? rows.length : undefined, filters, dimensions,
        coverage_rule, population_provenance, currency_note, currencies }]];
    } catch { return []; }
  }));
}
