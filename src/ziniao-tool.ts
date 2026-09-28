import type { RiskLevel, ToolAction, UserIdentity } from './types.js';
import type { ZiniaoBroker, ZiniaoRunOptions } from './ziniao-broker.js';
import { ZINIAO_NAMESPACES, ZINIAO_READ_CAPABILITIES } from './ziniao-policy.js';

const forbiddenFlags = new Set(['--profile', '--api-key', '--token', '--config', '--format', '--yes', '-y']);

export interface ZiniaoToolInput {
  capability: string;
  args: string[];
}

export const ziniaoDynamicTools = [{
  type: 'namespace',
  name: 'ziniao',
  description: '通过当前钉钉用户独立授权的紫鸟 CLI 查询或管理店铺。宿主检查凭证、隔离账号、对执行机排队串行化，并对写操作确认。',
  tools: [{
    type: 'function',
    name: 'cli',
    description: '调用紫鸟业务命令。capability 格式如 account.list、store.list、staff.list、account.update 或 api.call；args 只放业务参数。执行机全局串行：他人占用时自动排队并回报位次。capability=utility.queue-status 只读返回排队状态（不占用执行机），发起店铺巡检等批量长任务前应先查询并告知用户等待代价。首次调用会引导当前用户私聊授权。明确只读命令直接执行，其余操作先确认。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        capability: { type: 'string', pattern: '^[a-z][a-z0-9-]*\\.[a-z][a-z0-9-]*$' },
        args: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 4000 } }
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
    for (const token of args as string[]) {
      const lower = token.toLowerCase();
      if (forbiddenFlags.has(lower) || lower.startsWith('--profile=') || lower.startsWith('--api-key=') || lower.startsWith('--token=') || lower.startsWith('--config=')) throw new Error('ZINIAO_CREDENTIAL_ARGUMENT_FORBIDDEN');
      if (/[\0\r\n]/.test(token)) throw new Error('ZINIAO_ARGUMENT_CONTROL_CHARACTER');
    }
    return { capability: value.capability, args: args as string[] };
  }

  public action(input: ZiniaoToolInput): ToolAction {
    const risk: RiskLevel = ZINIAO_READ_CAPABILITIES.has(input.capability) && !input.args.includes('--dry-run') ? 'read' : 'write';
    return { name: '紫鸟 ' + input.capability, risk, target: input.capability, parameters: input };
  }

  public async execute(user: UserIdentity, input: ZiniaoToolInput, confirmed: boolean, opts: ZiniaoRunOptions = {}): Promise<unknown> {
    if (input.capability === 'utility.queue-status') {
      // In-process snapshot: never reaches the CLI, the SSH channel, or the lock.
      return this.broker.queueStatus(user);
    }
    if (this.action(input).risk !== 'read' && !confirmed) throw new Error('ZINIAO_CONFIRMATION_REQUIRED');
    const [namespace, command] = input.capability.split('.');
    return this.broker.runCommand(user, namespace === 'api' ? ['api', ...input.args] : [namespace!, command!, ...input.args], opts);
  }
}
