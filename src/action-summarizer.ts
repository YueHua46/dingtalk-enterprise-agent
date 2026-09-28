import type { Config } from './config.js';
import type { ActionHumanSummary, ToolAction } from './types.js';
import { generatedDwsCapabilities } from './generated-dws-capabilities.js';

const SECRET_KEY_PATTERN = /token|secret|password|credential|api.?key|authorization/i;
const DESCRIPTION_LIMIT = 80;
const IMPACT_LIMIT = 120;
const DETAIL_LIMIT = 120;
const MAX_DETAILS = 5;
const CACHE_LIMIT = 200;
const TIMEOUT_MS = 6_000;

const SYSTEM_PROMPT = [
  '你是企业钉钉机器人网关的确认文案生成器。收到的唯一输入是一次即将执行的工具调用的结构化参数 JSON。',
  '把它翻译给完全不懂技术的普通员工看。输出必须是严格的 JSON 对象：{"description":"...","impact":"...","details":["..."]}。',
  '规则：',
  '1. 只描述这次调用本身会做什么；禁止虚构、禁止美化、禁止弱化风险。',
  '2. description：一句话说明要做什么，不超过 40 字。',
  '3. impact：一句话说明会影响什么对象、什么范围，不超过 60 字；无法判断就写"影响范围未知"。',
  '4. details：0 到 5 条，每条不超过 50 字。只挑普通审批人关心的内容（对象名称、收件人、时间、数量、内容摘要等）。参数里的编号或 ID（例如 --node 后面的编码）无法翻译成名称时必须原样保留，禁止编造名称。',
  '5. 只输出 JSON，不要 markdown 代码块，不要任何解释。'
].join('\n');

export function sanitizeLine(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  const cleaned = value.replace(/[\0\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.length > limit ? cleaned.slice(0, limit - 1) + '…' : cleaned;
}

/** Generic flag/value parser for CLI-style args: ['--node','abc'] → [['node','abc']]. */
export function parseFlagPairs(args: readonly string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    if (token.startsWith('--') && token.length > 2) {
      const flag = token.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        pairs.push([flag, next]);
        i++;
      } else {
        pairs.push([flag, '']);
      }
    }
  }
  return pairs;
}

function plainObjectEntries(parameters: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(parameters)
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .map(([key, value]) => [key, String(value)] as [string, string]);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deterministic, capability-agnostic fallback. No per-capability templates:
 * DWS capability descriptions come from the generated catalog, everything
 * else is rendered straight from raw parameters. Honest even when dull.
 */
export function fallbackSummary(action: ToolAction): ActionHumanSummary {
  const parameters = isPlainObject(action.parameters) ? action.parameters : {};
  const capability = typeof parameters.capability === 'string' ? parameters.capability : '';
  const catalogDescription = capability && capability in generatedDwsCapabilities
    ? generatedDwsCapabilities[capability as keyof typeof generatedDwsCapabilities].description
    : '';
  const description = sanitizeLine(
    catalogDescription ? `${action.name}（${catalogDescription}）` : action.name,
    DESCRIPTION_LIMIT
  );

  let rawEntries: Array<[string, string]>;
  if (Array.isArray(parameters.args) && parameters.args.every((item) => typeof item === 'string')) {
    rawEntries = parseFlagPairs(parameters.args as string[]);
  } else if (Object.keys(parameters).length) {
    rawEntries = plainObjectEntries(parameters);
  } else {
    rawEntries = [];
  }
  const details: string[] = [];
  for (const [key, value] of rawEntries) {
    if (SECRET_KEY_PATTERN.test(key)) {
      details.push(sanitizeLine(`${key}：[已隐藏]`, DETAIL_LIMIT));
      continue;
    }
    const rendered = value ? `${key}：${value}` : key;
    const line = sanitizeLine(rendered, DETAIL_LIMIT);
    if (line) details.push(line);
    if (details.length >= MAX_DETAILS) break;
  }
  const overflow = rawEntries.length - details.length;
  if (overflow > 0) details.push(`其余 ${overflow} 项参数已保存在任务审计中。`);

  return { description, impact: defaultImpact(action), ...(details.length ? { details } : {}) };
}

export function defaultImpact(action: ToolAction): string {
  return action.risk === 'high'
    ? '高风险操作，可能不可恢复或对他人可见，请仔细核对。'
    : '确认后将立即执行，并按上述内容变更目标资源。';
}

export function parseSummaryPayload(text: string): ActionHumanSummary {
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('ACTION_SUMMARY_MALFORMED');
  const parsed: unknown = JSON.parse(stripped.slice(start, end + 1));
  if (!isPlainObject(parsed)) throw new Error('ACTION_SUMMARY_MALFORMED');
  const description = sanitizeLine(parsed.description, DESCRIPTION_LIMIT);
  if (!description) throw new Error('ACTION_SUMMARY_EMPTY_DESCRIPTION');
  const impact = sanitizeLine(parsed.impact, IMPACT_LIMIT);
  const rawDetails = Array.isArray(parsed.details) ? parsed.details : [];
  const details = rawDetails
    .map((item) => sanitizeLine(item, DETAIL_LIMIT))
    .filter((item) => item.length > 0)
    .filter((item) => !SECRET_KEY_PATTERN.test(item.split('：')[0] ?? ''))
    .slice(0, MAX_DETAILS);
  return { description, ...(impact ? { impact } : {}), ...(details.length ? { details } : {}) };
}

/**
 * Approval-time business summary. Primary path: one-shot LLM call with the
 * raw action JSON only (no chat context, so message content cannot steer the
 * wording). Deterministic fallback keeps the card honest if the model is
 * unavailable, slow, or returns garbage.
 */
export class ActionSummarizer {
  private readonly cache = new Map<string, ActionHumanSummary>();

  public constructor(private readonly config: Pick<Config, 'MODEL_BASE_URL' | 'MODEL_API_KEY' | 'MODEL_NAME'>) {}

  public async summarize(actionHash: string, action: ToolAction): Promise<ActionHumanSummary> {
    const cached = this.cache.get(actionHash);
    if (cached) return cached;
    let summary: ActionHumanSummary;
    try {
      summary = await this.generate(action);
    } catch (error) {
      console.warn(JSON.stringify({
        event: 'approval.summary_fallback',
        reason: error instanceof Error ? error.message : String(error)
      }));
      summary = fallbackSummary(action);
    }
    if (this.cache.size >= CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(actionHash, summary);
    return summary;
  }

  private async generate(action: ToolAction): Promise<ActionHumanSummary> {
    if (!this.config.MODEL_BASE_URL || !this.config.MODEL_API_KEY) throw new Error('ACTION_SUMMARY_NOT_CONFIGURED');
    const endpoint = this.config.MODEL_BASE_URL.replace(/\/+$/, '') + '/responses';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.MODEL_API_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: this.config.MODEL_NAME,
        input: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify({ name: action.name, risk: action.risk, target: action.target ?? '', parameters: action.parameters ?? null }) }
        ],
        stream: false
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`ACTION_SUMMARY_HTTP_${response.status}`);
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object') throw new Error('ACTION_SUMMARY_INVALID_RESPONSE');
    const output = (payload as { output?: unknown }).output;
    if (!Array.isArray(output)) throw new Error('ACTION_SUMMARY_INVALID_RESPONSE');
    const content = output.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const blocks = (item as { content?: unknown }).content;
      return Array.isArray(blocks) ? blocks : [];
    });
    const answer = content.map((block) => block && typeof block === 'object' ? (block as { text?: unknown }).text : undefined)
      .filter((text): text is string => typeof text === 'string').join('\n').trim();
    if (!answer) throw new Error('ACTION_SUMMARY_EMPTY_RESPONSE');
    return parseSummaryPayload(answer);
  }
}
