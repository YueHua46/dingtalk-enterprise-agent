import { randomUUID } from 'node:crypto';
import { DWClient, EventAck, TOPIC_CARD, TOPIC_ROBOT, type DWClientDownStream } from 'dingtalk-stream';
import type { Config } from './config.js';
import { requestId } from './security.js';
import type { AgentRequest, ConversationSurface } from './types.js';
import { isReferencedTaskCancellation } from './policy.js';

export interface IncomingHandler {
  (request: AgentRequest): Promise<void>;
}

export type CardApprovalAction = 'agree' | 'reject';

export interface CardCallbackEvent {
  userId: string;
  outTrackId: string;
  action: CardApprovalAction;
  challengeId?: string;
}

export interface ClarificationCardCallbackEvent {
  corpId?: string;
  userId: string;
  outTrackId: string;
  action: 'submit' | 'cancel';
  choiceIndex?: number;
  input?: string;
  choiceText?: string;
}

export interface CardActionHandler {
  (event: CardCallbackEvent): Promise<void>;
}

export interface ClarificationCardActionHandler {
  (event: ClarificationCardCallbackEvent): Promise<void>;
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
  private cardActionHandler?: CardActionHandler;
  private clarificationCardActionHandler?: ClarificationCardActionHandler;

  public constructor(
    private readonly config: Config,
    private readonly onMessage: IncomingHandler,
    private readonly clientFactory: DingTalkStreamClientFactory = (options) => new DWClient(options)
  ) {}

  public setCardActionHandler(handler: CardActionHandler): void {
    this.cardActionHandler = handler;
  }

  public setClarificationCardActionHandler(handler: ClarificationCardActionHandler): void {
    this.clarificationCardActionHandler = handler;
  }

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
      subscriptions: [
        { type: 'CALLBACK', topic: TOPIC_ROBOT },
        { type: 'CALLBACK', topic: TOPIC_CARD }
      ]
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
        ...(typeof message.isInAtList === 'boolean' ? { botMentioned: message.isInAtList } : {}),
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
    client.registerCallbackListener(TOPIC_CARD, async (downstream: DWClientDownStream) => {
      client.socketCallBackResponse(downstream.headers.messageId, { status: EventAck.SUCCESS });
      const event = parseCardCallback(downstream);
      if (!event) {
        const clarification = parseClarificationCardCallback(downstream);
        if (clarification && this.clarificationCardActionHandler) {
          try { await this.clarificationCardActionHandler(clarification); }
          catch (error) { console.error('Clarification card handling failed:', error instanceof Error ? error.message : String(error)); }
          return;
        }
        console.warn(JSON.stringify({ event: 'approval.card_callback_unparsed', ...cardCallbackDiagnostic(downstream) }));
        return;
      }
      console.info(JSON.stringify({ event: 'approval.card_callback_received', outTrackId: event.outTrackId, action: event.action }));
      if (!this.cardActionHandler) return;
      try {
        await this.cardActionHandler(event);
      } catch (error) {
        console.error('Card action handling failed:', error instanceof Error ? error.message : String(error));
      }
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
    const attachments: AgentRequest['attachments'] = [];
    const textParts: string[] = [];
    if (payload.msgtype === 'text') {
      textParts.push(String(payload.text?.content ?? '').trim());
    } else if (payload.msgtype === 'richText') {
      for (const item of richTextItems(payload.content?.richText)) {
        const itemText = richTextItemText(item);
        if (itemText) textParts.push(itemText);
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
      payload.content?.originalMessageId,
      nestedString(payload.content, ['quoteMessageId', 'originalMsgId', 'originalMessageId', 'openMessageId', 'messageId'])
    );
    const quoteContainers = nestedValues(payload.content, ['quoteContent', 'quotedMessage', 'originalMessage', 'replyMessage']);
    const quotedText = firstString(
      payload.content?.quoteContent?.text?.content,
      payload.content?.quoteContent?.text,
      payload.content?.quoteContent?.content,
      payload.content?.quotedText,
      ...quoteContainers.map((value) => nestedString(value, ['content', 'text', 'title']))
    );
    const normalizedText = textParts.filter(Boolean).join('\n').trim() || '[无文本内容]';
    // The Stream payload may omit quote metadata even when the message detail
    // API contains it. Let an exact bare cancellation command reach the
    // orchestrator, which resolves the quote using the sender's DWS identity
    // and refuses to cancel anything when no matching quote exists.
    if (payload.conversationType === '2' && payload.isInAtList === false
      && !isReferencedTaskCancellation(normalizedText)) return undefined;
    return {
      envelope: payload,
      text: normalizedText,
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

/** Parse the interactive-card callback (TOPIC_CARD) into an approval decision.
 *  DingTalk wraps the button payload in slightly different shapes across card
 *  versions (cardCallbackData vs top-level; value as JSON string or object),
 *  so extraction is defensive by design.
 */
export function parseCardCallback(downstream: DWClientDownStream): CardCallbackEvent | undefined {
  let payload: any;
  try {
    payload = JSON.parse(downstream.data);
  } catch {
    return undefined;
  }
  const data = parseCardObject(payload?.cardCallbackData) ?? payload;
  const content = parseCardObject(data?.content) ?? {};
  const privateData = parseCardObject(content?.cardPrivateData) ?? parseCardObject(data?.cardPrivateData) ?? {};
  const params = parseCardObject(privateData?.params) ?? {};
  const userId = firstString(data?.userId, data?.user_id, content?.userId, content?.user_id);
  const outTrackId = firstString(data?.outTrackId, data?.out_track_id, data?.instanceId, data?.instance_id, content?.outTrackId, content?.instanceId);
  if (!userId || !outTrackId) return undefined;
  let value = data?.value ?? privateData?.value ?? data?.privateData?.value;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { /* plain string action id */ }
  }
  const action = extractApprovalAction(value)
    ?? extractApprovalAction(params)
    ?? extractApprovalAction(privateData?.actionIds)
    ?? extractApprovalAction(data)
    ?? extractApprovalAction(content);
  if (!action) return undefined;
  const valueObject = parseCardObject(value);
  const challengeId = firstString(params.challengeId, valueObject?.challengeId, data?.challengeId, content?.challengeId);
  return { userId, outTrackId, action, ...(challengeId ? { challengeId } : {}) };
}

/** Parse the dynamic single-choice clarification template callback. */
export function parseClarificationCardCallback(downstream: DWClientDownStream): ClarificationCardCallbackEvent | undefined {
  let payload: any;
  try { payload = JSON.parse(downstream.data); } catch { return undefined; }
  const data = parseCardObject(payload?.cardCallbackData) ?? payload;
  const content = parseCardObject(data?.content) ?? {};
  const privateData = parseCardObject(content?.cardPrivateData) ?? parseCardObject(data?.cardPrivateData) ?? {};
  const params = parseCardObject(privateData?.params) ?? {};
  const userId = firstString(data?.userId, data?.user_id, content?.userId, content?.user_id);
  const outTrackId = firstString(data?.outTrackId, data?.out_track_id, data?.instanceId, data?.instance_id, content?.outTrackId, content?.instanceId);
  if (!userId || !outTrackId) return undefined;
  const actionIds = Array.isArray(privateData?.actionIds) ? privateData.actionIds : Array.isArray(params.actionIds) ? params.actionIds : Array.isArray(data?.actionIds) ? data.actionIds : [];
  const actionId = firstString(params.actionId, params.action, actionIds[0], data?.actionId);
  const isCancel = actionId === 'single_button_node_cancel' || /cancel|取消/i.test(String(actionId ?? ''));
  const isSubmit = actionId === 'single_button_node_oclw9159003' || /submit|continue|继续/i.test(String(actionId ?? ''));
  if (!isCancel && !isSubmit) return undefined;
  const rawIndex = params.singleCheckbox ?? params.singleCheckboxIndex ?? params.singleCheckboxItemsIndex ?? privateData?.singleCheckbox;
  const numericIndex = typeof rawIndex === 'number' ? rawIndex : typeof rawIndex === 'string' && /^\d+$/.test(rawIndex) ? Number(rawIndex) : undefined;
  const choiceIndex = Number.isSafeInteger(numericIndex) && numericIndex! >= 0 ? numericIndex : undefined;
  const input = firstString(params.input, privateData?.input, data?.input);
  let choiceText: string | undefined;
  const items = Array.isArray(params.singleCheckboxItems) ? params.singleCheckboxItems : Array.isArray(privateData?.singleCheckboxItems) ? privateData.singleCheckboxItems : [];
  if (choiceIndex !== undefined && items[choiceIndex]) {
    const candidate = items[choiceIndex]?.text;
    choiceText = typeof candidate === 'string' ? candidate : undefined;
  }
  const corpId = firstString(data?.corpId, data?.corp_id, data?.chatbotCorpId, content?.corpId, content?.corp_id);
  return { ...(corpId ? { corpId } : {}), userId, outTrackId, action: isCancel ? 'cancel' : 'submit', ...(choiceIndex !== undefined ? { choiceIndex } : {}), ...(input ? { input } : {}), ...(choiceText ? { choiceText } : {}) };
}

function parseCardObject(value: unknown): Record<string, any> | undefined {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return undefined; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : undefined;
}

function extractApprovalAction(value: unknown): CardApprovalAction | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const action = extractApprovalAction(item);
      if (action) return action;
    }
    return undefined;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['agree', 'approve', '确认执行', '同意执行'].includes(normalized)) return 'agree';
    if (['reject', 'cancel', '取消执行', '拒绝执行'].includes(normalized)) return 'reject';
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const candidates = [record.action, record.actionId, record.action_id, record.id, record.type, record.eventType, record.actionIds];
  for (const candidate of candidates) {
    const action = extractApprovalAction(candidate);
    if (action) return action;
  }
  return undefined;
}

function cardCallbackDiagnostic(downstream: DWClientDownStream): Record<string, unknown> {
  let payload: any;
  try { payload = JSON.parse(downstream.data); } catch { return { parseError: 'invalid_json' }; }
  const data = parseCardObject(payload?.cardCallbackData) ?? payload;
  const content = parseCardObject(data?.content) ?? {};
  const privateData = parseCardObject(content?.cardPrivateData) ?? parseCardObject(data?.cardPrivateData) ?? {};
  const params = parseCardObject(privateData?.params) ?? {};
  return {
    outTrackId: firstString(data?.outTrackId, data?.instanceId, content?.outTrackId),
    hasUserId: Boolean(firstString(data?.userId, data?.user_id, content?.userId)),
    dataKeys: Object.keys(data ?? {}).slice(0, 12),
    contentKeys: Object.keys(content).slice(0, 12),
    paramKeys: Object.keys(params).slice(0, 12),
    actionIds: Array.isArray(privateData?.actionIds) ? privateData.actionIds.filter((item: unknown) => typeof item === 'string').slice(0, 3) : []
  };
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function embeddedValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
}

function richTextItems(value: unknown, depth = 0): any[] {
  if (depth > 6) return [];
  const parsed = embeddedValue(value);
  if (typeof parsed === 'string' && parsed.trim()) return [{ type: 'text', text: parsed.trim() }];
  if (Array.isArray(parsed)) return parsed.flatMap((item) => richTextItems(item, depth + 1));
  if (!parsed || typeof parsed !== 'object') return [];
  const record = parsed as Record<string, any>;
  if (typeof record.text === 'string' || typeof record.content === 'string' || findDownloadCode(record)) return [record];
  const items: any[] = [];
  for (const [key, child] of Object.entries(record)) {
    if (['quoteContent', 'quotedMessage', 'originalMessage', 'replyMessage'].includes(key)) continue;
    items.push(...richTextItems(child, depth + 1));
  }
  return items;
}

function richTextItemText(item: any): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  return firstString(
    typeof item.text === 'string' ? item.text : undefined,
    item.text?.content,
    typeof item.content === 'string' ? item.content : undefined,
    item.content?.text,
    item.content?.content
  );
}

function nestedValues(value: unknown, keys: string[], depth = 0): unknown[] {
  if (depth > 6) return [];
  const parsed = embeddedValue(value);
  if (Array.isArray(parsed)) return parsed.flatMap((item) => nestedValues(item, keys, depth + 1));
  if (!parsed || typeof parsed !== 'object') return [];
  const output: unknown[] = [];
  for (const [key, child] of Object.entries(parsed as Record<string, unknown>)) {
    if (keys.includes(key)) output.push(embeddedValue(child));
    output.push(...nestedValues(child, keys, depth + 1));
  }
  return output;
}

function nestedString(value: unknown, keys: string[], depth = 0): string | undefined {
  if (depth > 6) return undefined;
  const parsed = embeddedValue(value);
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const found = nestedString(item, keys, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const record = parsed as Record<string, unknown>;
  for (const key of keys) {
    const found = firstString(record[key]);
    if (found) return found;
    const nested = nestedString(record[key], keys, depth + 1);
    if (nested) return nested;
  }
  for (const child of Object.values(record)) {
    const found = nestedString(child, keys, depth + 1);
    if (found) return found;
  }
  return undefined;
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
