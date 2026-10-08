import type { Config } from './config.js';
import type { TaskContract, TaskCompletion, EvidenceRecord } from './task-workflow.js';

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
}

const EXCERPT_BUDGET_CHARS = 160_000;
const EXCERPT_MAX_CHARS = 12_000;
const REVIEW_TIMEOUT_MS = 90_000;

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
  '6. safety：答复不得包含凭证、令牌、内部文件路径、证据 ID 或工具参数。',
  '严重级别：blocking = 用户会因此得到错误事实、错误对象、把猜测当事实、隐去关键缺口、或缺少核心交付物；advisory = 可改进但不影响正确性。风格、措辞、篇幅偏好一律不是 blocking。',
  '每个问题都给出可直接执行的修正方法 fix（例如改为哪个数值、删除哪一句、补充哪个口径、用 analysis.python 计算什么）。',
  '当 round 等于 maxRounds 时，这是最后一轮：只保留你完全确定的 blocking 问题。',
  '只输出 JSON：{"issues":[{"severity":"blocking|advisory","category":"goal|fact|coverage|inference|relevance|safety","location":"答复中的原句或小节","problem":"具体问题","fix":"具体修正方法"}]}。没有问题时输出 {"issues":[]}。'
].join('\n');

export class EvidenceReviewer {
  public constructor(private readonly config: Pick<Config, 'MODEL_BASE_URL' | 'MODEL_API_KEY' | 'MODEL_NAME'>, private readonly http: typeof fetch = fetch) {}

  public async review(input: ReviewInput): Promise<ReviewResult> {
    if (!this.config.MODEL_BASE_URL || !this.config.MODEL_API_KEY) return { status: 'unavailable', issues: [], reason: 'reviewer_not_configured' };
    const payload = buildPayload(input);
    let lastError = 'review_failed';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const issues = await this.ask(payload);
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

  private async ask(payload: unknown): Promise<ReviewIssue[]> {
    const endpoint = this.config.MODEL_BASE_URL!.replace(/\/+$/, '') + '/responses';
    const response = await this.http(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.config.MODEL_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.config.MODEL_NAME, stream: false, input: [
        { role: 'system', content: RUBRIC },
        { role: 'user', content: JSON.stringify(payload) }
      ] }),
      signal: AbortSignal.timeout(REVIEW_TIMEOUT_MS)
    });
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
  let budget = EXCERPT_BUDGET_CHARS;
  for (const id of new Set(ordered)) {
    const text = input.excerpts[id];
    if (!text || budget <= 0) continue;
    const slice = text.slice(0, Math.min(EXCERPT_MAX_CHARS, budget));
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
