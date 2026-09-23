import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import type { ConversationSurface, TaskRecord } from './types.js';

interface AccessToken {
  value: string;
  expiresAt: number;
}

/** Native DingTalk AI streaming-card transport.
 *  Unlike the DWS shortcut, this sends full Markdown snapshots with isFull=true
 *  and idempotent guids, so stale deltas never get appended after a newer one.
 */
export class DingTalkNativeCardBroker {
  private token?: AccessToken;

  public constructor(private readonly config: Config) {}

  public enabled(): boolean {
    return Boolean(this.config.DINGTALK_CARD_TEMPLATE_ID);
  }

  public async create(surface: ConversationSurface): Promise<string> {
    const outTrackId = randomUUID();
    const cardParamMap: Record<string, string> = { [this.config.DINGTALK_CARD_VARIABLE]: this.config.DINGTALK_CARD_ACTIVITY_VARIABLE ? '' : '处理中' };
    if (this.config.DINGTALK_CARD_ACTIVITY_VARIABLE) {
      // Seed the PROCESSING prompt in the create request itself. Waiting for a
      // later update leaves a visible spinner-only gap on DingTalk clients.
      cardParamMap[this.config.DINGTALK_CARD_ACTIVITY_VARIABLE] = '正在处理';
    }
    const body: Record<string, unknown> = {
      cardTemplateId: this.config.DINGTALK_CARD_TEMPLATE_ID,
      outTrackId,
      cardData: { cardParamMap },
      openSpaceId: this.openSpaceId(surface)
    };
    if (surface.type === 'group') {
      body.imGroupOpenSpaceModel = { supportForward: true };
      body.imGroupOpenDeliverModel = { robotCode: this.config.DINGTALK_ROBOT_CODE };
    } else {
      body.imRobotOpenDeliverModel = { robotCode: this.config.DINGTALK_ROBOT_CODE };
    }
    await this.request('/v1.0/card/instances/createAndDeliver', { method: 'POST', body });
    return outTrackId;
  }

  public async update(outTrackId: string, content: string, status: 1 | 2 | 3 | 4 | 5): Promise<void> {
    const isFinalize = status === 3;
    const isError = status === 5;
    await this.request('/v1.0/card/streaming', {
      method: 'PUT',
      body: {
        outTrackId,
        guid: randomUUID(),
        key: this.config.DINGTALK_CARD_VARIABLE,
        content,
        isFull: true,
        isFinalize,
        isError
      }
    });
  }

  /** Replace the visible card field without touching the streaming buffer.
   *  Tool/progress text must not become the prefix of the later AI answer.
   */
  public async updateStatic(outTrackId: string, content: string, status: 1 | 2 | 3 | 4 | 5): Promise<void> {
    await this.request('/v1.0/card/instances', {
      method: 'PUT',
      body: {
        outTrackId,
        cardData: { cardParamMap: {
          [this.config.DINGTALK_CARD_VARIABLE]: content,
          flowStatus: String(status)
        } },
        cardUpdateOptions: { updateCardDataByKey: true }
      }
    });
  }

  /** Independent, non-streaming progress field; requires a bound template variable. */
  public async updateActivity(outTrackId: string, activity: string, status: 1 | 2 | 3 | 4 | 5): Promise<void> {
    const key = this.config.DINGTALK_CARD_ACTIVITY_VARIABLE;
    if (!key) throw new Error('Card activity variable is not configured');
    await this.request('/v1.0/card/instances', {
      method: 'PUT',
      body: {
        outTrackId,
        cardData: { cardParamMap: { [key]: activity, flowStatus: String(status) } },
        cardUpdateOptions: { updateCardDataByKey: true }
      }
    });
  }

  /** Robot single-chat push (oToMessages). Delivers OAuth guidance DMs with
   *  only the app credentials, so the per-employee authorization flow never
   *  depends on a pre-authorized DWS bot profile.
   */
  public async sendRobotDirectMessage(staffId: string, markdown: string, title: string): Promise<void> {
    await this.request('/v1.0/robot/oToMessages/batchSend', {
      method: 'POST',
      body: {
        robotCode: this.config.DINGTALK_ROBOT_CODE,
        userIds: [staffId],
        msgKey: 'sampleMarkdown',
        // sampleMarkdown renders the "text" template variable; a "content"
        // field is ignored and the raw "#text#" placeholder is delivered.
        msgParam: JSON.stringify({ title, text: markdown })
      }
    });
  }

  private openSpaceId(surface: ConversationSurface): string {
    return 'dtv1.card//' + (surface.type === 'group' ? 'IM_GROUP.' : 'IM_ROBOT.') + surface.id;
  }

  private async request(path: string, options: { method: 'POST' | 'PUT'; body: Record<string, unknown> }): Promise<any> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch('https://api.dingtalk.com' + path, {
          method: options.method,
          headers: {
            'content-type': 'application/json',
            'x-acs-dingtalk-access-token': await this.accessToken()
          },
          body: JSON.stringify(options.body),
          signal: AbortSignal.timeout(15_000)
        });
        const text = await response.text();
        let payload: any;
        try { payload = JSON.parse(text); } catch { payload = undefined; }
        const deliveryFailures = Array.isArray(payload?.result?.deliverResults)
          ? payload.result.deliverResults.filter((item: any) => item?.success === false)
          : [];
        if (!response.ok || payload?.success === false || deliveryFailures.length > 0) {
          const detail = typeof payload?.message === 'string' ? ': ' + payload.message.slice(0, 160) : '';
          const error = new Error('DingTalk native card request failed: HTTP ' + response.status + detail);
          if (response.status < 500 && response.status !== 429) throw error;
          lastError = error;
        } else {
          return payload;
        }
      } catch (error) {
        if (error instanceof Error && !isRetryableCardError(error)) throw error;
        lastError = error;
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 350 * 2 ** (attempt - 1)));
    }
    throw lastError instanceof Error ? lastError : new Error('DingTalk native card request failed');
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const response = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appKey: this.config.DINGTALK_CLIENT_ID, appSecret: this.config.DINGTALK_CLIENT_SECRET })
    });
    const payload = await response.json() as { accessToken?: string; expireIn?: number };
    if (!response.ok || !payload.accessToken) throw new Error('DingTalk app access token request failed');
    this.token = { value: payload.accessToken, expiresAt: Date.now() + Math.max(60, Number(payload.expireIn ?? 7200) - 60) * 1000 };
    return payload.accessToken;
  }
}

function isRetryableCardError(error: Error): boolean {
  return error.name === 'TypeError' || error.name === 'AbortError' || error.message.includes('fetch failed') || error.message.includes('HTTP 429') || error.message.includes('HTTP 5');
}
