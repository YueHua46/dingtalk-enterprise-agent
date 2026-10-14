import type { RiskLevel, ToolAction, UserIdentity } from './types.js';
import type { ZiniaoBroker, ZiniaoRunOptions } from './ziniao-broker.js';
import { ZINIAO_NAMESPACES } from './ziniao-policy.js';
import { classifyZiniaoImpact, type ZiniaoDeclaredEffect } from './ziniao-impact.js';

export type ZiniaoEvidence = { status?: 'ok' | 'error' | 'unknown' | undefined; url?: string | undefined; title?: string | undefined; text?: string | undefined; state?: string | undefined };

const forbiddenFlags = new Set(['--profile', '--api-key', '--token', '--config', '--format', '--yes', '-y']);

export interface ZiniaoToolInput {
  capability: string;
  args: string[];
  purpose?: string;
  effect?: ZiniaoDeclaredEffect;
  effectReason?: string;
  goalStatus?: 'satisfied' | 'not_satisfied' | 'unknown' | undefined;
  evidence?: ZiniaoEvidence;
}

export const ziniaoDynamicTools = [{
  type: 'namespace',
  name: 'ziniao',
  description: '通过当前钉钉用户独立授权的紫鸟 CLI 查询或管理店铺。宿主检查凭证、隔离账号、对执行机排队串行化，并按实际业务影响决定是否确认。',
  tools: [{
    type: 'function',
    name: 'cli',
    description: '调用紫鸟命令。capability 格式如 store.open、page.screenshot、page.exec、account.update 或 api.call；args 只放命令参数。任何 page/automation 操作都必须建立在本任务已成功 store.open 且宿主已确认运行中的店铺身份之后；page.extract --mode running 用于这一步的核验。每一步都应提交 purpose，并可提交 effect（observe/session/business/unknown）及 effectReason、goalStatus（satisfied/not_satisfied/unknown）与 evidence（status、url、title、text 或 state），说明实际影响和本步是否达到目标。目标判断必须建立在操作后的实际页面或业务证据上；工具返回成功、请求被接受、网络空闲或产物非空都不能单独代表任务完成。导航、登录、切换站点或界面语言、刷新、查看和无业务副作用的页面交互无需确认；修改商品、订单、店铺配置、权限或效果不明的操作需确认。宿主保留高危写入硬门，Agent 判断不能绕过。首次调用会引导当前用户私聊授权。执行机全局串行。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        capability: { type: 'string', pattern: '^[a-z][a-z0-9-]*\\.[a-z][a-z0-9-]*$' },
        args: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 4000 } },
        purpose: { type: 'string', maxLength: 200 }
        ,effect: { type: 'string', enum: ['observe', 'session', 'business', 'unknown'] }
        ,effectReason: { type: 'string', maxLength: 240 }
        ,goalStatus: { type: 'string', enum: ['satisfied', 'not_satisfied', 'unknown'] }
        ,evidence: { type: 'object', additionalProperties: false, properties: {
          status: { type: 'string', enum: ['ok', 'error', 'unknown'] }, url: { type: 'string', maxLength: 2000 },
          title: { type: 'string', maxLength: 500 }, text: { type: 'string', maxLength: 2000 }, state: { type: 'string', maxLength: 500 }
        } }
      },
      required: ['capability']
    }
  }]
}];

export class ZiniaoTool {
  public constructor(private readonly broker: ZiniaoBroker) {}

  public parse(input: unknown): ZiniaoToolInput {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('ZINIAO_ARGUMENTS_INVALID');
    const value = input as Record<string, unknown>;
    if (typeof value.capability !== 'string' || !/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(value.capability)) throw new Error('ZINIAO_CAPABILITY_INVALID');
    const [namespace, command] = value.capability.split('.');
    if (!namespace || !command || !ZINIAO_NAMESPACES.has(namespace) || (namespace === 'api' && command !== 'call')) throw new Error('ZINIAO_CAPABILITY_NOT_ALLOWED');
    const args = value.args ?? [];
    if (!Array.isArray(args) || args.length > 40 || args.some((item) => typeof item !== 'string' || item.length > 4000)) throw new Error('ZINIAO_ARGUMENTS_INVALID');
    if (value.purpose !== undefined && (typeof value.purpose !== 'string' || value.purpose.length > 200)) throw new Error('ZINIAO_ARGUMENTS_INVALID');
    for (const token of args as string[]) {
      const lower = token.toLowerCase();
      if (forbiddenFlags.has(lower) || lower.startsWith('--profile=') || lower.startsWith('--api-key=') || lower.startsWith('--token=') || lower.startsWith('--config=')) throw new Error('ZINIAO_CREDENTIAL_ARGUMENT_FORBIDDEN');
      if (/[\0\r\n]/.test(token)) throw new Error('ZINIAO_ARGUMENT_CONTROL_CHARACTER');
    }
    const effect = value.effect;
    if (effect !== undefined && !['observe', 'session', 'business', 'unknown'].includes(String(effect))) throw new Error('ZINIAO_ARGUMENTS_INVALID');
    if (value.effectReason !== undefined && (typeof value.effectReason !== 'string' || value.effectReason.length > 240)) throw new Error('ZINIAO_ARGUMENTS_INVALID');
    const goalStatus = value.goalStatus;
    if (goalStatus !== undefined && !['satisfied', 'not_satisfied', 'unknown'].includes(String(goalStatus))) throw new Error('ZINIAO_ARGUMENTS_INVALID');
    let evidence: ZiniaoToolInput['evidence'] | undefined;
    if (value.evidence !== undefined) {
      if (!value.evidence || typeof value.evidence !== 'object' || Array.isArray(value.evidence)) throw new Error('ZINIAO_ARGUMENTS_INVALID');
      const raw = value.evidence as Record<string, unknown>;
      if (raw.status !== undefined && !['ok', 'error', 'unknown'].includes(String(raw.status))) throw new Error('ZINIAO_ARGUMENTS_INVALID');
      for (const key of ['url', 'title', 'text', 'state']) if (raw[key] !== undefined && (typeof raw[key] !== 'string' || (raw[key] as string).length > (key === 'url' ? 2000 : key === 'text' ? 2000 : 500))) throw new Error('ZINIAO_ARGUMENTS_INVALID');
      evidence = { ...(raw.status ? { status: raw.status as ZiniaoEvidence['status'] } : {}), ...(raw.url ? { url: raw.url as string } : {}), ...(raw.title ? { title: raw.title as string } : {}), ...(raw.text ? { text: raw.text as string } : {}), ...(raw.state ? { state: raw.state as string } : {}) };
    }
    return { capability: value.capability, args: args as string[], ...(value.purpose ? { purpose: value.purpose as string } : {}), ...(effect ? { effect: effect as ZiniaoDeclaredEffect } : {}), ...(value.effectReason ? { effectReason: value.effectReason as string } : {}), ...(goalStatus ? { goalStatus: goalStatus as ZiniaoToolInput['goalStatus'] } : {}), ...(evidence ? { evidence } : {}) };
  }

  public action(input: ZiniaoToolInput, requestText = ''): ToolAction {
    const impact = classifyZiniaoImpact(input, requestText);
    const risk: RiskLevel = impact.kind === 'observe' || impact.kind === 'session' ? 'read' : 'write';
    return { name: '紫鸟 ' + input.capability, risk, target: input.capability, parameters: input };
  }

  public async execute(user: UserIdentity, input: ZiniaoToolInput, confirmed: boolean, opts: ZiniaoRunOptions = {}, requestText = ''): Promise<unknown> {
    if (input.capability === 'utility.queue-status') {
      // In-process snapshot: never reaches the CLI, the SSH channel, or the lock.
      return this.broker.queueStatus(user);
    }
    if (this.action(input, requestText).risk !== 'read' && !confirmed) throw new Error('ZINIAO_CONFIRMATION_REQUIRED');
    const [namespace, command] = input.capability.split('.');
    return this.broker.runCommand(user, namespace === 'api' ? ['api', ...input.args] : [namespace!, command!, ...input.args], opts);
  }
}
