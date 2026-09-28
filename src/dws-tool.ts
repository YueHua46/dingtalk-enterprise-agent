import type { RiskLevel, ToolAction, UserIdentity } from './types.js';
import { DwsBroker } from './dws-broker.js';
import { generatedDwsCapabilities } from './generated-dws-capabilities.js';

const capabilityNames = Object.keys(generatedDwsCapabilities);
const forbiddenFlags = new Set([
  '--profile', '--format', '--yes', '-y', '--help', '-h', '--token', '--client-id',
  '--client-secret', '--pre-url', '--mcp-url', '--mock'
]);

// Host-side confirmation policy (owner decision, 2026-09-23): message delivery
// inside the company is low-risk and must NOT require a confirmation round.
// This is an explicit, structured capability allow-list — no runtime keyword
// matching. Everything the list omits keeps the CLI's own gating behavior.
const CONFIRMATION_FREE_CAPABILITIES: ReadonlySet<string> = new Set([
  'chat.dm',
  'chat.messages-send',
  'chat.messages-send-by-bot',
  'chat.messages-send-by-webhook',
  'chat.messages-batch-send-by-bot',
  'chat.broadcast',
  'chat.send-to-group',
  'chat.messages-reply',
  'chat.messages-send-card',
  'chat.messages-update-card',
  'chat.messages-forward',
  'chat.messages-combine-forward',
  'chat.messages-forward-topic',
  'chat.messages-recall',
  'chat.messages-recall-by-bot',
  'chat.messages-batch-recall-by-bot',
  'chat.messages-edit',
  'chat.messages-add-emoji',
  'chat.messages-remove-emoji',
  'chat.messages-add-text-emotion',
  'chat.messages-remove-text-emotion',
  'chat.messages-create-text-emotion'
]);

export interface DwsToolInput {
  capability: string;
  args?: string[];
}

export const dwsDynamicTools = [{
  type: 'namespace',
  name: 'dingtalk',
  description: '以当前钉钉聊天用户身份执行钉钉办公操作。宿主强制权限隔离、审计和写操作确认。',
  tools: [{
    type: 'function',
    name: 'dws',
    description: '调用已注册的 DWS 办公能力。capability 必须来自宿主按当前 DWS 版本生成的能力表，args 仅包含该能力的业务参数令牌。帮助或参数说明请读对应 Skill，不能把 --help 传给写能力。禁止传 profile、format、yes、token 或应用密钥。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        capability: {
          type: 'string',
          enum: capabilityNames
        },
        args: {
          type: 'array',
          maxItems: 40,
          items: { type: 'string', maxLength: 4000 }
        }
      },
      required: ['capability']
    }
  }, {
    type: 'function',
    name: 'schema',
    description: '读取当前已安装 DWS 版本中某项已注册能力的精确参数 Schema；写操作参数不确定时先调用。只返回能力元数据，不读取用户资源，也不执行写入。',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      capability: { type: 'string', enum: capabilityNames }
    }, required: ['capability'] }
  }]
}];

export class DwsTool {
  public constructor(private readonly broker: DwsBroker) {}

  public parse(input: unknown): DwsToolInput {
    if (!input || typeof input !== 'object') throw new Error('DWS tool arguments must be an object');
    const value = input as Record<string, unknown>;
    if (typeof value.capability !== 'string' || !(value.capability in generatedDwsCapabilities)) throw new Error('DWS capability is not registered');
    const args = value.args ?? [];
    if (!Array.isArray(args) || args.length > 40 || args.some((item) => typeof item !== 'string')) {
      throw new Error('DWS arguments are invalid');
    }
    for (const token of args as string[]) {
      const normalized = token.toLowerCase();
      if (forbiddenFlags.has(normalized) || normalized.includes('secret') || normalized.includes('token=')) {
        throw new Error('DWS argument is forbidden: ' + token);
      }
      if (token.includes('\0') || token.includes('\r') || token.includes('\n')) {
        throw new Error('DWS argument contains control characters');
      }
    }
    return { capability: value.capability, args: args as string[] };
  }

  public classify(input: DwsToolInput): RiskLevel {
    return this.capability(input).risk;
  }

  public async schema(name: string): Promise<{ cli_path: string; parameters: Record<string, unknown> }> {
    if (!(name in generatedDwsCapabilities)) throw new Error('DWS capability is not registered');
    return this.broker.schemaForCapability(name);
  }

  public async validateArgs(input: DwsToolInput): Promise<void> {
    const capability = this.capability(input);
    if (capability.risk === 'read' || !capability.command[0]?.startsWith('+')) return;
    if (typeof this.broker.schemaForCapability !== 'function') return; // In-memory broker fakes used by integration tests.
    // For shortcut writes, reject guessed flags before showing an approval
    // card. The installed CLI's leaf schema is the source of truth.
    const schema = await this.schema(input.capability);
    const permitted = new Set(Object.keys(schema.parameters).map((key) => '--' + key));
    for (const token of input.args ?? []) {
      if (!token.startsWith('--')) continue;
      const flag = token.split('=', 1)[0]!;
      if (!permitted.has(flag)) throw new Error(`DWS_PARAMETER_NOT_IN_SCHEMA:${flag}; capability=${input.capability}; allowed=${[...permitted].join(',')}`);
    }
  }

  public action(input: DwsToolInput): ToolAction {
    const capability = this.capability(input);
    return {
      name: '钉钉 ' + input.capability,
      risk: this.classify(input),
      target: input.args?.join(' ').slice(0, 500) || capability.service,
      parameters: input
    };
  }

  public isConfirmationFree(input: DwsToolInput): boolean {
    return CONFIRMATION_FREE_CAPABILITIES.has(input.capability);
  }

  public async execute(user: UserIdentity, input: DwsToolInput, confirmed: boolean): Promise<unknown> {
    const capability = this.capability(input);
    const free = this.isConfirmationFree(input);
    // High-risk capabilities are pre-gated by the orchestrator; this throw is
    // defense in depth so an unconfirmed destructive call can never reach the CLI.
    if (capability.risk === 'high' && !confirmed && !free) throw new Error('DWS_CONFIRMATION_REQUIRED');
    const args = [capability.service, ...capability.command, ...(input.args ?? [])];
    // --yes is a global CLI flag satisfying the CLI's own ConfirmSafety gate.
    // Confirmation-free message sends still need it; reads never do.
    if (free || (confirmed && capability.risk !== 'read')) args.push('--yes');
    return this.broker.runCommand(user, args);
  }

  private capability(input: DwsToolInput): { service: string; command: readonly string[]; risk: RiskLevel; description: string } {
    const capability = generatedDwsCapabilities[input.capability as keyof typeof generatedDwsCapabilities];
    if (!capability) throw new Error('DWS capability is not registered');
    return capability;
  }
}
