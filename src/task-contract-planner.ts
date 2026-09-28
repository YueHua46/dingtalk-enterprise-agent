import type { Config } from './config.js';
import { TaskWorkflow, type TaskContract } from './task-workflow.js';
import { capabilityCatalog } from './capability-catalog.js';

export type PlannerTrace = (event: 'attempt' | 'draft' | 'review' | 'invalid', payload: Record<string, unknown>) => Promise<void>;

const SOURCE_FAMILIES = [
  'dingtalk.*：当前成员有权访问的钉钉资源及操作回执',
  'artifact.read：从已按当前用户权限导入的文件中提取并核对的正文、表格、页面或 OCR 事实；dingtalk.* 只能证明消息与资源存在，不能单独证明附件正文',
  'artifact.submit：新文件由宿主校验并发回原会话的投递回执',
  'ziniao.*：当前成员独立授权的紫鸟资源及操作回执',
  'crossborderops.*：当前成员授权店铺的内部 Amazon 经营数据；销售额按各站点本币记录，未提供汇率时跨币种金额不可直接排序',
  'sif.*：公开 Amazon 市场、ASIN、关键词信号；不能证明内部店铺销量',
  'internet.search：公开网页事实',
  'reference.read_guide：Skill 方法说明；不能证明实时业务事实'
].join('\n');

export class TaskContractPlanner {
  public constructor(private readonly config: Pick<Config, 'MODEL_BASE_URL' | 'MODEL_API_KEY' | 'MODEL_NAME'>, private readonly http: typeof fetch = fetch) {}

  public async reviewRevision(request: string, contract: TaskContract): Promise<{ aligned: boolean; reason: string }> {
    if (!this.config.MODEL_BASE_URL || !this.config.MODEL_API_KEY) return { aligned: false, reason: '任务契约审查服务不可用' };
    const endpoint = this.config.MODEL_BASE_URL.replace(/\/+$/, '') + '/responses';
    const localDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return this.reviewAlignment(endpoint, request, '', localDate, contract);
  }

  public async plan(request: string, context = '', trace?: PlannerTrace): Promise<TaskContract> {
    if (!this.config.MODEL_BASE_URL || !this.config.MODEL_API_KEY) throw new Error('TASK_PLANNER_NOT_CONFIGURED');
    const endpoint = this.config.MODEL_BASE_URL.replace(/\/+$/, '') + '/responses';
    const localDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    let correction = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      await trace?.('attempt', { attempt: attempt + 1, correction });
      const response = await this.http(endpoint, {
        method: 'POST', headers: { authorization: `Bearer ${this.config.MODEL_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.config.MODEL_NAME, stream: false, input: [
          { role: 'system', content: [
            '你是企业 Agent 的独立任务规划器。仅依据用户目标和能力语义规划，不执行工具或回答用户。',
            '当前请求发生在企业钉钉 Agent 会话中。用户未指定其他系统时，个人办公资源可默认从当前钉钉身份可访问的资源查询；这只是选择查询来源，不代表已经核实任何资源、权限或结果。',
            '输出严格 JSON 对象：{"mode":"conversation|read|write","goal":"...","deliverables":["..."],"requiredFacts":[{"id":"lowercase_id","description":"...","acceptableSources":["能力ID"],"enumeration":"all|bounded|point|context","grain":["分组实体维度"]}],"assumptions":["..."],"openQuestions":["..."],"completionCriteria":["..."]}。',
            '每项事实的 enumeration 按交付范围语义选择：all=要列全同条件下所有匹配对象，bounded=只需前 N 名或明确有限样本，point=一个确定对象或汇总数值，context=辅助分析事实。它决定宿主是否必须核对同一查询条件下的全部分页；不得把完整清单降成样本以绕过分页。',
            'grain 表示一个统计对象由哪些维度唯一确定；完整清单和有限排名必须填写，维度名称采用对应能力目录公布的字段。只问某一种实体时，不要擅自加入容器、地区或时间等维度使计数对象改变；要求按多个维度分别列示时，grain 应包含这些维度。单点数值或辅助事实可用空数组。',
            '任何要求查询当前或近期业务数据、搜索、读取资源、执行操作的任务都至少列一个 requiredFact；对应来源必须能实际支持该事实。纯对话、写作或解释可为空。',
            '逐项覆盖用户要求的交付物。任务契约必须忠实于原请求：保留用户指定的对象、指标、时间含义、分析动作和范围；不要添加用户未要求的比较、归因、预测、建议或第二个问题。若用户同时要求定位对象与解释原因，分别登记对象及诊断事实。',
            'requiredFacts 只包含完成用户目标不可缺少的事实。公开市场信号通常是可选的辅助解释；除非用户目标确实要求公开市场判断，不要把它设为内部销量诊断的必需事实。',
            '用户要求读取聊天附件或钉盘文件中的具体内容时，内容事实的 acceptableSources 必须包含 artifact.read；钉钉消息查询只用于定位文件，不能证明文件中的文字、表格数值或 OCR 结果。要求交付新文件时，交付事实可使用 artifact.submit。',
            'acceptableSources 必须使用下面列出的精确能力 ID，不能自造 dingtalk.message、dingtalk.im、dingtalk.drive 等别名。定位聊天或钉盘资源统一写 dingtalk.*；文件存在写 artifact.input；文件正文和 OCR 写 artifact.read；新文件投递写 artifact.submit。其它业务来源按可用来源列表中的原样 ID 填写。',
            '对可逆只读任务采用合理默认值并在 assumptions 说明；缺少会改变查询对象、跨越权限或影响真实写入目标的条件放到 openQuestions。相对时间按当前会话日期和时区解释；自然周、滚动天数和两个时段比较是不同的分析口径。',
            '比较的对象若使用不同计量单位且没有可靠的换算依据，不能假设它们可直接比较，也不能假设换算率存在；把必要的统一口径作为 openQuestions 中一个最小问题，或在不改变用户目标的前提下明确可提供的部分结果。',
            '如果缺少适合原目标的能力，把它作为能力缺口报告；不得悄悄换成另一个能查询但回答不同问题的指标。',
            '用户身份、授权、数据覆盖和结果数值必须由执行时的工具验证；不要把尚未验证的授权或数据存在性写成既定 assumptions。',
            '不要把 Skill 说明、旧会话记忆或公开 SIF 估算当成内部店铺真实销量证据。可用来源：\n' + SOURCE_FAMILIES,
            correction ? '上次契约与原请求不一致：' + correction : '',
            attempt ? '上次输出未通过校验；这次只输出完整 JSON。' : ''
          ].filter(Boolean).join('\n') },
          { role: 'user', content: JSON.stringify({ request: request.slice(0, 10_000), context: context.slice(0, 3000), currentDate: localDate, timeZone: 'Asia/Shanghai' }) }
        ] }),
        signal: AbortSignal.timeout(45_000)
      });
      if (!response.ok) throw new Error(`TASK_PLANNER_HTTP_${response.status}`);
      const body = await response.json() as { output?: Array<{ content?: Array<{ text?: string }> }> };
      const text = body.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? '').join('') ?? '';
      try {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        const parsed = JSON.parse(text.slice(start, end + 1)) as TaskContract;
        if (!['conversation', 'read', 'write'].includes(String(parsed.mode))) throw new Error('TASK_PLANNER_MODE_INVALID');
        if (parsed.mode !== 'conversation' && !parsed.requiredFacts?.length) throw new Error('TASK_PLANNER_REQUIRED_FACT_MISSING');
        if (parsed.requiredFacts?.some((fact) => !['all', 'bounded', 'point', 'context'].includes(String(fact.enumeration)))) throw new Error('TASK_PLANNER_ENUMERATION_MISSING');
        if (parsed.requiredFacts?.some((fact) => ['all', 'bounded'].includes(String(fact.enumeration)) && (!Array.isArray(fact.grain) || fact.grain.length === 0))) throw new Error('TASK_PLANNER_GRAIN_MISSING');
        const contract = new TaskWorkflow().plan(parsed);
        await trace?.('draft', { attempt: attempt + 1, contract });
        const review = await this.reviewAlignment(endpoint, request, context, localDate, contract);
        await trace?.('review', { attempt: attempt + 1, ...review });
        if (review.aligned) return contract;
        correction = review.reason;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await trace?.('invalid', { attempt: attempt + 1, reason: reason.slice(0, 300), responseLength: text.length });
        correction = reason.startsWith('WORKFLOW_SOURCE_UNREGISTERED:')
          ? `${reason}。acceptableSources 仅可使用能力目录中的精确 ID：${capabilityCatalog().filter((item) => ['artifact', 'dws'].includes(item.source) && (item.source === 'artifact' || item.id === 'dingtalk.*')).map((item) => item.id).join(', ')}。其它来源必须使用上面列出的精确能力 ID。`
          : correction || '结构或来源不合法';
      }
    }
    throw new Error('TASK_PLANNER_INVALID_RESPONSE: ' + correction);
  }

  private async reviewAlignment(endpoint: string, request: string, context: string, localDate: string, contract: TaskContract): Promise<{ aligned: boolean; reason: string }> {
    const response = await this.http(endpoint, {
      method: 'POST', headers: { authorization: `Bearer ${this.config.MODEL_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.config.MODEL_NAME, stream: false, input: [
        { role: 'system', content: '你是独立的任务语义审查器。只比较原请求和拟定契约，不执行任务。当前请求发生在企业钉钉 Agent 会话中：用户未指定其他系统的个人办公资源，默认查询当前钉钉身份可访问的资源是合理的来源选择，不等于假定具体资源、权限或结果存在。逐项核对对象、指标、时间范围、分析动作、排序或比较方式、范围及交付物；检查每项事实的 enumeration 和 grain 是否忠实于用户要求的完整程度与统计对象。附件内容、表格数值和 OCR 事实须有 artifact.read 来源；dingtalk.* 只证明聊天消息和文件资源存在，不能证明文件正文。每个 openQuestion 必须是只有发起人能决定、缺少后会改变目标或越过权限的条件；工具失败、执行策略、输出格式和提交方式由 Agent 与宿主处理，不应让用户澄清。assumptions、deliverables 和 completionCriteria 中的执行口径必须明确且唯一，不能同时列出多个互斥日期、指标、站点或计算方法，也不能把几种尚未决定的替代答案写成同一个交付物；真正缺少的决策应进入 openQuestions。默认值不能凭空假定数据、汇率或权限存在。不得把指定自然时间改成滚动时间，不得添加用户未要求的比较、原因分析或其他交付物。如果适合原目标的工具缺失，也不能把目标换成另一个可查询的问题。任何一项偏离则 aligned=false 并指出具体字段。只输出 JSON：{"aligned":boolean,"reason":"简短具体原因"}。' },
        { role: 'user', content: JSON.stringify({ request, context, currentDate: localDate, timeZone: 'Asia/Shanghai', contract }) }
      ] }), signal: AbortSignal.timeout(45_000)
    });
    if (!response.ok) throw new Error(`TASK_PLAN_REVIEW_HTTP_${response.status}`);
    const body = await response.json() as { output?: Array<{ content?: Array<{ text?: string }> }> };
    const text = body.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? '').join('') ?? '';
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { aligned?: unknown; reason?: unknown };
    return { aligned: parsed.aligned === true, reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 300) : '任务契约偏离原请求' };
  }
}
