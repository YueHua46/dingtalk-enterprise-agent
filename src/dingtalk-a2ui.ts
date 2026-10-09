import type { Config } from './config.js';
import type { ConversationSurface } from './types.js';
import type { A2UIFlowStatus, A2UIMessage } from './a2ui.js';

export interface A2UICardBroker {
  create(surface: ConversationSurface, initial: A2UIMessage[], outTrackId?: string): Promise<string>;
  update(outTrackId: string, messages: A2UIMessage[], status: A2UIFlowStatus): Promise<void>;
  finalize(outTrackId: string, messages: A2UIMessage[], status: A2UIFlowStatus): Promise<void>;
}

interface AccessToken { value: string; expiresAt: number }

/** Direct A2UI transport. It deliberately does not use a DWS profile. */
export class DingTalkA2UICardBroker implements A2UICardBroker {
  private token?: AccessToken;
  public constructor(private readonly config: Config) {}

  private apiBase(): string { return this.config.DINGTALK_API_BASE_URL || 'https://api.dingtalk.com'; }

  public enabled(): boolean { return this.config.DINGTALK_A2UI_ENABLED === 'true' && Boolean(this.config.DINGTALK_CLIENT_ID && this.config.DINGTALK_CLIENT_SECRET); }

  public async create(surface: ConversationSurface, initial: A2UIMessage[], outTrackId = `${Date.now()}-${Math.random().toString(16).slice(2)}`): Promise<string> {
    const body: Record<string, unknown> = {
      outTrackId,
      openSpaceId: this.openSpaceId(surface),
      protocolVersion: '1.0',
      flowStatus: 'PROCESSING',
      a2uiMessages: initial.map((message) => JSON.stringify(message)),
      summary: 'Agent 正在处理请求'
    };
    if (surface.type === 'group') {
      body.imGroupOpenSpaceModel = { supportForward: true };
      body.imGroupOpenDeliverModel = { robotCode: this.config.DINGTALK_ROBOT_CODE };
    } else {
      body.imRobotOpenSpaceModel = { supportForward: true };
      body.imRobotOpenDeliverModel = { robotCode: this.config.DINGTALK_ROBOT_CODE, spaceType: 'IM_ROBOT' };
    }
    await this.request('/v1.0/card/ai/instances/createAndDeliver', 'POST', body);
    return outTrackId;
  }

  public async update(outTrackId: string, messages: A2UIMessage[], status: A2UIFlowStatus): Promise<void> {
    await this.request(this.config.DINGTALK_A2UI_UPDATE_PATH, 'PUT', {
      outTrackId, protocolVersion: '1.0', flowStatus: status,
      a2uiMessages: messages.map((message) => JSON.stringify(message))
    });
  }

  public async finalize(outTrackId: string, messages: A2UIMessage[], status: A2UIFlowStatus): Promise<void> {
    await this.update(outTrackId, messages, status);
  }

  private openSpaceId(surface: ConversationSurface): string {
    return `dtv1.card//${surface.type === 'group' ? 'IM_GROUP' : 'IM_ROBOT'}.${surface.id}`;
  }

  private async request(path: string, method: 'POST' | 'PUT', body: Record<string, unknown>): Promise<void> {
    let response: Response;
    try {
      response = await fetch(this.apiBase() + path, {
        method,
        headers: { 'content-type': 'application/json', 'x-acs-dingtalk-access-token': await this.accessToken() },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15_000)
      });
    } catch (error) {
      throw new Error(`A2UI_RESULT_UNKNOWN:${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await response.text();
    let payload: any;
    try { payload = JSON.parse(text); } catch { payload = undefined; }
    const failedDelivery = Array.isArray(payload?.result?.deliverResults) && payload.result.deliverResults.some((item: any) => item?.success === false);
    if (!response.ok || payload?.success === false || failedDelivery) {
      const detail = String(payload?.message ?? payload?.errorMsg ?? payload?.result?.deliverResults?.[0]?.errorMsg ?? '').slice(0, 240);
      throw new Error(`A2UI_REQUEST_FAILED:HTTP_${response.status}${detail ? `:${detail}` : ''}`);
    }
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const response = await fetch(this.apiBase() + '/v1.0/oauth2/accessToken', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appKey: this.config.DINGTALK_CLIENT_ID, appSecret: this.config.DINGTALK_CLIENT_SECRET }),
      signal: AbortSignal.timeout(15_000)
    });
    const payload = await response.json() as { accessToken?: string; expireIn?: number };
    if (!response.ok || !payload.accessToken) throw new Error('A2UI_ACCESS_TOKEN_FAILED');
    this.token = { value: payload.accessToken, expiresAt: Date.now() + Math.max(60, Number(payload.expireIn ?? 7200) - 60) * 1000 };
    return payload.accessToken;
  }
}
