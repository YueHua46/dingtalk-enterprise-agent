import { describe, expect, it, vi } from 'vitest';
import { TOPIC_ROBOT } from 'dingtalk-stream';
import { DingTalkStreamAdapter, parseRobotMessage } from '../src/dingtalk-stream.js';
import { loadConfig } from '../src/config.js';

function downstream(payload: unknown): any {
  return {
    specVersion: '1.0',
    type: 'CALLBACK',
    headers: {
      appId: 'app',
      connectionId: 'connection',
      contentType: 'application/json',
      messageId: 'message',
      time: String(Date.now()),
      topic: '/v1.0/im/bot/messages/get'
    },
    data: JSON.stringify(payload)
  };
}

const base = {
  conversationId: 'cid-group',
  chatbotCorpId: 'corp',
  msgId: 'msg-1',
  senderNick: '测试用户',
  senderStaffId: 'staff-user-id',
  senderCorpId: 'corp',
  conversationType: '2',
  sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession'
};

describe('DingTalk message normalization', () => {
  it('uses senderStaffId as the DWS user identity source', () => {
    const parsed = parseRobotMessage(downstream({ ...base, msgtype: 'text', text: { content: ' 你好 ' } }));
    expect(parsed?.envelope.senderStaffId).toBe('staff-user-id');
    expect(parsed?.text).toBe('你好');
  });

  it('normalizes picture and rich-text attachments', () => {
    const picture = parseRobotMessage(downstream({
      ...base,
      msgtype: 'picture',
      content: { downloadCode: 'download-picture' }
    }));
    expect(picture?.attachments[0]).toMatchObject({ sourceType: 'image', downloadCode: 'download-picture' });

    const rich = parseRobotMessage(downstream({
      ...base,
      msgtype: 'richText',
      content: {
        richText: [
          { type: 'text', text: '请分析' },
          { type: 'picture', downloadCode: 'download-rich-picture' }
        ]
      }
    }));
    expect(rich?.text).toBe('请分析');
    expect(rich?.attachments).toHaveLength(1);
  });

  it('ignores explicit non-at group messages and keeps quoted context', () => {
    const ignored = parseRobotMessage(downstream({
      ...base,
      isInAtList: false,
      msgtype: 'text',
      text: { content: '群里的普通消息' }
    }));
    expect(ignored).toBeUndefined();

    const quoted = parseRobotMessage(downstream({
      ...base,
      isInAtList: true,
      msgtype: 'text',
      text: { content: '总结一下' },
      content: {
        originalMsgId: 'original-message-id',
        quoteContent: { text: { content: '这是被引用的正文' } }
      }
    }));
    expect(quoted).toMatchObject({
      quotedMessageId: 'original-message-id',
      quotedText: '这是被引用的正文'
    });
  });
});

describe('DingTalk Stream callback lifecycle', () => {
  it('acknowledges the robot CALLBACK before slow intake work', async () => {
    let callback: ((value: any) => Promise<void> | void) | undefined;
    let options: any;
    const acknowledgements: Array<{ messageId: string; result: unknown }> = [];
    const received: any[] = [];
    const client = {
      connected: false,
      registerCallbackListener: vi.fn((topic: string, handler: typeof callback) => {
        expect(topic).toBe(TOPIC_ROBOT);
        callback = handler;
        return client;
      }),
      socketCallBackResponse: vi.fn((messageId: string, result: unknown) => {
        acknowledgements.push({ messageId, result });
      }),
      connect: vi.fn(async () => { client.connected = true; }),
      disconnect: vi.fn()
    };
    const config = loadConfig({
      NODE_ENV: 'test',
      DINGTALK_CLIENT_ID: 'client-id',
      DINGTALK_CLIENT_SECRET: 'client-secret',
      DINGTALK_ROBOT_CODE: 'robot-code',
      MAX_CONCURRENT_USERS: '7'
    });
    const adapter = new DingTalkStreamAdapter(
      config,
      async (request) => { received.push(request); },
      (value) => { options = value; return client; }
    );

    await adapter.start();
    expect(options.maxPendingCallbackHandlers).toBe(7);
    expect(options.maxPendingEventHandlers).toBeUndefined();
    expect(callback).toBeTypeOf('function');

    await callback!(downstream({
      ...base,
      isInAtList: true,
      msgtype: 'text',
      text: { content: '你好' }
    }));

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({
      messageId: 'msg-1',
      user: { corpId: 'corp', userId: 'staff-user-id' },
      surface: { type: 'group', id: 'cid-group' },
      text: '你好'
    });
    expect(acknowledgements).toEqual([{ messageId: 'message', result: { status: 'SUCCESS' } }]);
  });

  it('keeps the Stream callback acknowledged when asynchronous intake fails', async () => {
    let callback: ((value: any) => Promise<void> | void) | undefined;
    const client = {
      connected: false,
      registerCallbackListener: vi.fn((_topic: string, handler: typeof callback) => {
        callback = handler;
        return client;
      }),
      socketCallBackResponse: vi.fn(),
      connect: vi.fn(async () => { client.connected = true; }),
      disconnect: vi.fn()
    };
    const config = loadConfig({
      NODE_ENV: 'test',
      DINGTALK_CLIENT_ID: 'client-id',
      DINGTALK_CLIENT_SECRET: 'client-secret',
      DINGTALK_ROBOT_CODE: 'robot-code'
    });
    const adapter = new DingTalkStreamAdapter(
      config,
      async () => { throw new Error('intake failed'); },
      () => client
    );

    await adapter.start();
    await callback!(downstream({
      ...base,
      isInAtList: true,
      msgtype: 'text',
      text: { content: '你好' }
    }));
    expect(client.socketCallBackResponse).toHaveBeenCalledWith('message', { status: 'SUCCESS' });
  });
});
