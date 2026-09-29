import type { RiskLevel, ToolAction, UserIdentity } from './types.js';
import type { ZiniaoBroker, ZiniaoRunOptions } from './ziniao-broker.js';
import { ZINIAO_NAMESPACES } from './ziniao-policy.js';
import { classifyZiniaoImpact } from './ziniao-impact.js';

const forbiddenFlags = new Set(['--profile', '--api-key', '--token', '--config', '--format', '--yes', '-y']);

export interface ZiniaoToolInput {
  capability: string;
  args: string[];
  purpose?: string;
}

export const ziniaoDynamicTools = [{
  type: 'namespace',
  name: 'ziniao',
  description: '通过当前钉钉用户独立授权的紫鸟 CLI 查询或管理店铺。宿主检查凭证、隔离账号、对执行机排队串行化，并按实际业务影响决定是否确认。',
  tools: [{
    type: 'function',
    name: 'cli',
    description: '调用紫鸟命令。capability 格式如 store.open、page.screenshot、page.exec、account.update 或 api.call；args 只放命令参数。任何 page/automation 操作都必须建立在本任务已成功 store.open 且宿主已确认运行中的店铺身份之后；page.extract --mode running 用于这一步的核验。读取 document.title、当前 URL、页面文本等纯读取 page.exec 属于观察，无需确认；用户要求截图时生成后立即交付，不要额外读取网页标题。page.click、page.input、automation.run 等页面交互需提供 purpose，简述这一步的真实目的，例如“登录店铺”或“切换英国站点”。宿主结合用户请求、目标元素与步骤判断业务影响；查询、打开店铺、登录、切换站点或界面语言、截图无需确认，修改商品、订单、店铺配置、权限或效果不明的操作需确认。首次调用会引导当前用户私聊授权。执行机全局串行。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        capability: { type: 'string', pattern: '^[a-z][a-z0-9-]*\\.[a-z][a-z0-9-]*$' },
        args: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 4000 } },
        purpose: { type: 'string', maxLength: 200 }
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
    return { capability: value.capability, args: args as string[], ...(value.purpose ? { purpose: value.purpose as string } : {}) };
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
