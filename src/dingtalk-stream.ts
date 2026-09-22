import { randomUUID } from 'node:crypto';
import { DWClient, EventAck, TOPIC_ROBOT, type DWClientDownStream } from 'dingtalk-stream';
import type { Config } from './config.js';
import { requestId } from './security.js';
import type { AgentRequest, ConversationSurface } from './types.js';

export interface IncomingHandler {
  (request: AgentRequest): Promise<void>;
}

export interface DingTalkStreamClient {
  connected: boolean;
  registerCallbackListener(eventId: string, callback: (value: DWClientDownStream) => void | Promise<void>): this;
  socketCallBackResponse(messageId: string, result: unknown): void;
  connect(): Promise<void>;
  disconnect(): void;
}

export type DingTalkStreamClientFactory = (
  options: ConstructorParameters<typeof DWClient>[0]
) => DingTalkStreamClient;

export class DingTalkStreamAdapter {
  private client?: DingTalkStreamClient;
  private latestWebhook = new Map<string, string>();

  public constructor(
    private readonly config: Config,
    private readonly onMessage: IncomingHandler,
    private readonly clientFactory: DingTalkStreamClientFactory = (options) => new DWClient(options)
  ) {}

  public async start(): Promise<void> {
    if (!this.config.DINGTALK_CLIENT_ID || !this.config.DINGTALK_CLIENT_SECRET) {
      if (this.config.NODE_ENV === 'production') throw new Error('DingTalk Stream credentials are required in production');
      console.warn('DingTalk Stream disabled: missing DINGTALK_CLIENT_ID or DINGTALK_CLIENT_SECRET');
      return;
    }
    this.client = this.clientFactory({
      clientId: this.config.DINGTALK_CLIENT_ID,
      clientSecret: this.config.DINGTALK_CLIENT_SECRET,
      autoReconnect: true,
      maxPendingCallbackHandlers: this.config.MAX_CONCURRENT_USERS,
      subscriptions: [{ type: 'CALLBACK', topic: TOPIC_ROBOT }]
    });
    const client = this.client;
    client.registerCallbackListener(TOPIC_ROBOT, async (downstream: DWClientDownStream) => {
      const parsed = parseRobotMessage(downstream);
      if (!parsed) {
        client.socketCallBackResponse(downstream.headers.messageId, { status: EventAck.SUCCESS });
        return;
      }
      const message = parsed.envelope;
      const surface: ConversationSurface = message.conversationType === '2'
        ? { type: 'group', id: message.conversationId }
        : { type: 'direct', id: message.senderStaffId };
      this.latestWebhook.set(surface.type + ':' + surface.id, message.sessionWebhook);
      const request: AgentRequest = {
        requestId: requestId(),
        messageId: message.msgId,
        user: {
          corpId: message.senderCorpId || message.chatbotCorpId,
          userId: message.senderStaffId,
          ...(message.senderNick ? { displayName: message.senderNick } : {})
        },
        surface,
        text: parsed.text,
        attachments: parsed.attachments,
        ...(parsed.quotedMessageId ? { quotedMessageId: parsed.quotedMessageId } : {}),
        ...(parsed.quotedText ? { quotedText: parsed.quotedText } : {}),
        receivedAt: Date.now()
      };
      client.socketCallBackResponse(downstream.headers.messageId, { status: EventAck.SUCCESS });
      // ACK the Stream callback before doing network-bound work (card create,
      // persistence, queueing, or model execution). Holding the ACK blocks
      // DingTalk from delivering later messages and makes a fresh user message
      // appear stuck for minutes. Inbox deduplication makes async intake safe.
      void this.onMessage(request).catch((error) => {
        console.error('DingTalk message intake failed:', error instanceof Error ? error.message : String(error));
      });
    });
    await client.connect();
  }

  public async send(surface: ConversationSurface, markdown: string, title = 'Agent智能助手'): Promise<boolean> {
    const webhook = this.latestWebhook.get(surface.type + ':' + surface.id);
    if (!webhook) {
      console.warn('No DingTalk session webhook for surface ' + surface.type + ':' + surface.id);
      return false;
    }
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { title, text: markdown } })
    });
    if (!response.ok) throw new Error('DingTalk send failed: HTTP ' + response.status);
    return true;
  }

  public isReady(): boolean {
    if (!this.config.DINGTALK_CLIENT_ID || !this.config.DINGTALK_CLIENT_SECRET) return this.config.NODE_ENV !== 'production';
    return Boolean(this.client?.connected);
  }

  public stop(): void {
    this.client?.disconnect();
  }
}

interface RobotEnvelope {
  conversationId: string;
  chatbotCorpId: string;
  msgId: string;
  senderNick?: string;
  senderStaffId: string;
  senderCorpId?: string;
  conversationType: string;
  sessionWebhook: string;
  msgtype: string;
  isInAtList?: boolean;
  originalMsgId?: string;
  quoteMessageId?: string;
  text?: { content?: string };
  content?: Record<string, any>;
}

export function parseRobotMessage(downstream: DWClientDownStream): {
  envelope: RobotEnvelope;
  text: string;
  attachments: AgentRequest['attachments'];
  quotedMessageId?: string;
  quotedText?: string;
} | undefined {
  try {
    const payload = JSON.parse(downstream.data) as RobotEnvelope;
    if (!payload.msgId || !payload.senderStaffId || !payload.sessionWebhook) return undefined;
    if (payload.conversationType === '2' && payload.isInAtList === false) return undefined;
    const attachments: AgentRequest['attachments'] = [];
    const textParts: string[] = [];
    if (payload.msgtype === 'text') {
      textParts.push(String(payload.text?.content ?? '').trim());
    } else if (payload.msgtype === 'richText') {
      for (const item of asArray(payload.content?.richText)) {
        if (item?.type === 'text' && item?.text) textParts.push(String(item.text));
        const code = findDownloadCode(item);
        if (code) attachments.push(mediaAttachment(item.type === 'picture' ? 'image' : 'file', code, item.fileName ?? item.name));
      }
    } else {
      const code = findDownloadCode(payload.content ?? payload);
      if (code) {
        const sourceType = normalizeSourceType(payload.msgtype);
        attachments.push(mediaAttachment(sourceType, code, payload.content?.fileName ?? payload.content?.name));
        textParts.push('[收到' + mediaLabel(sourceType) + ']');
      } else {
        textParts.push('[收到暂不支持的消息类型：' + payload.msgtype + ']');
      }
      const recognition = payload.content?.recognition ?? payload.content?.text;
      if (recognition) textParts.push(String(recognition));
    }
    const quotedMessageId = firstString(
      payload.quoteMessageId,
      payload.originalMsgId,
      payload.content?.quoteMessageId,
      payload.content?.originalMsgId,
      payload.content?.originalMessageId
    );
    const quotedText = firstString(
      payload.content?.quoteContent?.text?.content,
      payload.content?.quoteContent?.text,
      payload.content?.quoteContent?.content,
      payload.content?.quotedText
    );
    return {
      envelope: payload,
      text: textParts.filter(Boolean).join('\n').trim() || '[无文本内容]',
      attachments,
      ...(quotedMessageId ? { quotedMessageId } : {}),
      ...(quotedText ? { quotedText } : {})
    };
  } catch {
    return undefined;
  }
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function findDownloadCode(value: any): string | undefined {
  const code = value?.downloadCode ?? value?.download_code ?? value?.fileDownloadCode;
  return typeof code === 'string' && code.length > 0 ? code : undefined;
}

function normalizeSourceType(msgtype: string): 'image' | 'audio' | 'video' | 'file' {
  if (msgtype === 'picture' || msgtype === 'image') return 'image';
  if (msgtype === 'audio' || msgtype === 'voice') return 'audio';
  if (msgtype === 'video') return 'video';
  return 'file';
}

function mediaAttachment(sourceType: 'image' | 'audio' | 'video' | 'file', downloadCode: string, name?: string): AgentRequest['attachments'][number] {
  return {
    id: randomUUID(),
    sourceType,
    downloadCode,
    name: typeof name === 'string' && name ? name : sourceType + '-attachment'
  };
}

function mediaLabel(type: 'image' | 'audio' | 'video' | 'file'): string {
  return type === 'image' ? '图片' : type === 'audio' ? '语音' : type === 'video' ? '视频' : '文件';
}
