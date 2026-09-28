import type { Config } from './config.js';
import type { TaskContract, TaskCompletion, EvidenceRecord } from './task-workflow.js';

export class EvidenceReviewer {
  public constructor(private readonly config: Pick<Config, 'MODEL_BASE_URL' | 'MODEL_API_KEY' | 'MODEL_NAME'>, private readonly http: typeof fetch = fetch) {}

  public async review(contract: TaskContract, completion: TaskCompletion, evidence: EvidenceRecord[], excerpts: Record<string, string>, originalRequest = ''): Promise<{ supported: boolean; reason: string }> {
    if (!this.config.MODEL_BASE_URL || !this.config.MODEL_API_KEY) return { supported: false, reason: 'reviewer_unavailable' };
    for (const ids of Object.values(completion.factEvidence)) {
      for (const id of ids) if (!excerpts[id]) return { supported: false, reason: 'evidence_excerpt_unavailable' };
    }
    const citedIds = [...new Set(Object.values(completion.factEvidence).flat())];
    if (citedIds.length > 20) return { supported: false, reason: 'evidence_review_budget_exceeded: cite at most 20 relevant records' };
    const recentOtherIds = Object.keys(excerpts).filter((id) => !citedIds.includes(id)).slice(-20);
    const excerptIds = [...citedIds, ...recentOtherIds].slice(0, 20);
    const payload = {
      originalRequest,
      goal: contract.goal,
      deliverables: contract.deliverables,
      completionCriteria: contract.completionCriteria,
      facts: contract.requiredFacts,
      completion,
      evidence,
      dataQuality: Object.fromEntries(Object.entries(excerpts).flatMap(([id, value]) => {
        try {
          const result = JSON.parse(value) as { dataset?: unknown; data?: Record<string, unknown> };
          if (!result.data || typeof result.data !== 'object') return [];
          const { coverage, period, current_period, baseline_period, total, limit, offset, filters, dimensions, coverage_rule, population_provenance, currency_note, rows } = result.data;
          if (!coverage && !coverage_rule) return [];
          const currencies = Array.isArray(rows) ? [...new Set(rows.map((row) => row && typeof row === 'object' ? (row as Record<string, unknown>).currency : undefined).filter((value): value is string => typeof value === 'string'))] : [];
          return [[id, { dataset: result.dataset, coverage, period, current_period, baseline_period, total, limit, offset,
            returnedRowCount: Array.isArray(rows) ? rows.length : undefined, filters, dimensions,
            coverage_rule, population_provenance, currency_note, currencies }]];
        } catch { return []; }
      })),
      excerpts: Object.fromEntries(excerptIds.map((id) => [id, excerpts[id]!.slice(0, 12_000)]))
    };
    const scope = await this.ask({ originalRequest, deliverables: contract.deliverables, answer: completion.answer },
      '你是独立的答复边界审查器。以用户原话为最高依据，逐段逐字段审查最终答复。对每个数字、指标、表格列、列表和小节做删除测试：删掉它后，用户要求的交付物是否仍完整且可正确解释？如果是，且用户没有要求该内容，它就是额外信息；必要的时间口径、来源、并列名次、授权或数据缺口除外。不要把“相关”“有帮助”“真实”当作用户要求。只问一个数值时，不应追加其他指标、内部标识或另一个维度的榜单；明确给定的标题、时间、对象等筛选条件也不能用相似结果替代。用户只问简单事实或定义时，回答应简洁。契约若扩大范围，以原话为准。存在额外字段、无关小节或替代目标时 supported=false，reason 点名应删除或修正的部分。只输出 JSON：{"supported":boolean,"reason":"简短原因"}。');
    if (!scope.supported) return scope;
    const factual = await this.ask(payload, '你是独立的事实与目标审查器。先核对最终答复是否实际回答 originalRequest 指定的对象、指标、时间含义、分析动作与范围；契约如偏离原请求，以原请求为准。不得用另一个可查询的问题替代，也不得附带与回答无关的个人或业务明细。再逐项核对数值、计算、单位、时间范围、数据粒度、来源、排序并列情况和覆盖范围；每个当前事实只能由同对象同粒度的本任务证据支持。对任何声称列全、共多少或代表全部授权范围的分页结果，用 dataQuality 的 filters、dimensions、total、offset、returnedRowCount 核对同口径证据是否连续覆盖全部页；缺页或换了查询口径时，即使另有源数据缺口声明，也不能把已取页面说成完整数据范围的全部结果。不同币种或其他不同计量单位的数据，在没有可信换算证据时不能产生跨单位赢家、前列或绝对领先等比较结论；分别列出不同单位的数值也不能暗示二者共同领先。dataQuality 中的 currency_note 和 currencies 是明确的可比性约束。授权范围不等于完整数据范围。业务聚合即使返回 total=1/1 且 coverage 完整，也只能证明已观测候选在其数据口径内完整，不能证明未出现业务行的授权对象为零。若答复声称全部授权对象的确定总额、完整清单或完整排名，须有本任务授权对象全集及与业务记录逐对象对齐的证据；缺少这种证据时，只能按已记录或已核实数据的范围表述，不能把模型自己的假设当证据。completion.coverageGaps 是宿主观察到的授权对象与业务记录覆盖差异，只作为证据供你判断答案的实际声称；不要据此强制修改 completion.status 或要求固定答复形式。若答案声称覆盖全部授权对象、把缺失记录当零，或隐去会改变该结论的数据缺口，应指出具体证据不足；若答案清楚限定为已观测记录并准确说明边界，可以接受其自然表述。聚合结果自己的 coverage 只计算已观测候选，不能证明不存在未入库对象。没有实时证据时可解释稳定的基本概念；精确比例以及“大多数”“绝大多数”等无来源的量化断言、价格、资格门槛或可能变化的平台规则均不可凭常识补写。历史聊天与 Skill 只能提供方法，不能证明实时事实。任一关键事实、目标匹配或完成状态不实则 supported=false。仅输出 JSON：{"supported":boolean,"reason":"简短原因"}。');
    if (!factual.supported) return factual;
    if (citedIds.some((id) => evidence.some((item) => item.id === id && item.capabilityId === 'crossborderops.daily.aggregate'))) {
      const population = await this.ask(payload, '你只审查统计总体是否被证据支持。先读 answer 的每个总体限定语，再读 originalRequest、所引证据的 filters、dimensions、coverage_rule 与授权范围证据。业务聚合的 total 和 coverage 只针对已观测业务候选；它们不能证明所有授权对象都有业务行，更不能把无业务行等同零。若答复声称所有授权店铺或目标总体的确定总额、全量排名或完整清单，必须有同一任务中授权总体及其业务覆盖的证据；没有则 supported=false，reason 指出具体越界措辞。只说已记录或已核实范围的数值，并如实限定数据边界，可以 supported=true。不要要求固定模板、固定完成状态或无关补充指标。只输出 JSON：{"supported":boolean,"reason":"简短原因"}。');
      if (!population.supported) return population;
    }
    return this.ask(payload, '你是独立的因果审查器。逐句找出最终答复中解释“为什么”、原因、影响机制、排除某因素、证实某因素的措辞，并核对本任务工具数据能否证明。汇总趋势不能证明某个商品的原因；两个指标同日变化不能证明因果；评论数量、广告消耗、转化率等相关性不能单独证明流量或销量受其影响。把变化称为正常波动、异常、无影响或排除风险，同样需要相应的基线与判定依据，不能仅因基数小就下此结论。只有相关证据时必须清楚标为可能、线索或待核查，不能写成已证实、造成、导致、排除。建议可以提出待查方向，但不得假装已验证。任何一处越界则 supported=false。仅输出 JSON：{"supported":boolean,"reason":"简短原因"}。');
  }

  private async ask(payload: unknown, instruction: string): Promise<{ supported: boolean; reason: string }> {
    const endpoint = this.config.MODEL_BASE_URL!.replace(/\/+$/, '') + '/responses';
    const response = await this.http(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.config.MODEL_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.config.MODEL_NAME, stream: false, input: [
        { role: 'system', content: instruction },
        { role: 'user', content: JSON.stringify(payload) }
      ] }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) return { supported: false, reason: `review_http_${response.status}` };
    const body = await response.json() as { output?: Array<{ content?: Array<{ text?: string }> }> };
    const text = body.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? '').join('') ?? '';
    try {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      const parsed = JSON.parse(text.slice(start, end + 1)) as { supported?: unknown; reason?: unknown };
      return { supported: parsed.supported === true, reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 200) : 'review_invalid' };
    } catch { return { supported: false, reason: 'review_invalid' }; }
  }
}
