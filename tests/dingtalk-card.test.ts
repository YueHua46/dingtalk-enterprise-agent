import { describe, expect, it, vi, afterEach } from 'vitest';
import { DingTalkNativeCardBroker } from '../src/dingtalk-card.js';

afterEach(() => vi.restoreAllMocks());

describe('DingTalk native AI streaming card', () => {
  it('creates a template card and sends full, idempotent snapshots', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/oauth2/accessToken')) {
        return new Response(JSON.stringify({ accessToken: 'token-1', expireIn: 7200 }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, result: { deliverResults: [{ success: true }] } }), { status: 200 });
    }));
    const broker = new DingTalkNativeCardBroker({
      DINGTALK_CLIENT_ID: 'app', DINGTALK_CLIENT_SECRET: 'secret', DINGTALK_ROBOT_CODE: 'robot',
      DINGTALK_CARD_TEMPLATE_ID: 'template.schema', DINGTALK_CARD_VARIABLE: 'content'
    } as any);

    const outTrackId = await broker.create({ type: 'group', id: 'group-1' });
    await broker.update(outTrackId, '第一段\n\n第二段', 2);
    await broker.update(outTrackId, '最终', 3);

    expect(calls).toHaveLength(4);
    const create = JSON.parse(String(calls[1]!.init.body));
    expect(create.cardTemplateId).toBe('template.schema');
    expect(create.outTrackId).toBe(outTrackId);
    expect(create.cardData.cardParamMap.content).toBe('处理中');
    expect(create.imGroupOpenDeliverModel.robotCode).toBe('robot');
    expect(create.imGroupOpenSpaceModel.supportForward).toBe(true);
    const update = JSON.parse(String(calls[2]!.init.body));
    expect(update.outTrackId).toBe(outTrackId);
    expect(update.key).toBe('content');
    expect(update.content).toBe('第一段\n\n第二段');
    expect(update.isFull).toBe(true);
    expect(update.isFinalize).toBe(false);
    const finish = JSON.parse(String(calls[3]!.init.body));
    expect(finish.isFull).toBe(true);
    expect(finish.isFinalize).toBe(true);
  });

  it('updates the existing single field as static card data', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/oauth2/accessToken')) {
        return new Response(JSON.stringify({ accessToken: 'token-1', expireIn: 7200 }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }));
    const broker = new DingTalkNativeCardBroker({
      DINGTALK_CLIENT_ID: 'app', DINGTALK_CLIENT_SECRET: 'secret', DINGTALK_ROBOT_CODE: 'robot',
      DINGTALK_CARD_TEMPLATE_ID: 'template.schema', DINGTALK_CARD_VARIABLE: 'content'
    } as any);

    await broker.updateStatic('card-1', '正在使用工具', 2);
    await broker.updateStatic('card-1', '', 2);
    await broker.update('card-1', '最终答案的前半段', 2);

    expect(calls[1]!.url).toContain('/card/instances');
    const progress = JSON.parse(String(calls[1]!.init.body));
    const reset = JSON.parse(String(calls[2]!.init.body));
    expect(progress.cardData.cardParamMap).toMatchObject({ content: '正在使用工具', flowStatus: '2' });
    expect(reset.cardData.cardParamMap.content).toBe('');
    expect(reset.cardUpdateOptions.updateCardDataByKey).toBe(true);
    expect(calls[3]!.url).toContain('/card/streaming');
  });

  it('keeps activity separate from the streaming answer when the template binds it', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/oauth2/accessToken')) return new Response(JSON.stringify({ accessToken: 'token-1', expireIn: 7200 }), { status: 200 });
      return new Response(JSON.stringify({ success: true, result: { deliverResults: [{ success: true }] } }), { status: 200 });
    }));
    const broker = new DingTalkNativeCardBroker({
      DINGTALK_CLIENT_ID: 'app', DINGTALK_CLIENT_SECRET: 'secret', DINGTALK_ROBOT_CODE: 'robot',
      DINGTALK_CARD_TEMPLATE_ID: 'template.schema', DINGTALK_CARD_VARIABLE: 'content',
      DINGTALK_CARD_ACTIVITY_VARIABLE: 'activity'
    } as any);
    await broker.create({ type: 'group', id: 'group-1' });
    await broker.updateActivity('card-1', '读取 Skill：dingtalk-office', 2);
    await broker.update('card-1', '最终答案', 3);
    const create = JSON.parse(String(calls[1]!.init.body));
    const activity = JSON.parse(String(calls[2]!.init.body));
    const answer = JSON.parse(String(calls[3]!.init.body));
    expect(create.cardData.cardParamMap).toEqual({ content: '', activity: '正在处理' });
    expect(activity.cardData.cardParamMap).toEqual({ activity: '读取 Skill：dingtalk-office', flowStatus: '2' });
    expect(answer).toMatchObject({ key: 'content', content: '最终答案', isFinalize: true });
  });

  it('seeds the processing prompt in the create request for a processing-aware template', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/oauth2/accessToken')) return new Response(JSON.stringify({ accessToken: 'token-1', expireIn: 7200 }), { status: 200 });
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ success: true, result: { deliverResults: [{ success: true }] } }), { status: 200 });
    }));
    const broker = new DingTalkNativeCardBroker({
      DINGTALK_CLIENT_ID: 'app', DINGTALK_CLIENT_SECRET: 'secret', DINGTALK_ROBOT_CODE: 'robot',
      DINGTALK_CARD_TEMPLATE_ID: 'template.schema', DINGTALK_CARD_VARIABLE: 'content',
      DINGTALK_CARD_ACTIVITY_VARIABLE: 'activity', DINGTALK_CARD_ACTIVITY_IN_PROCESSING: 'true'
    } as any);
    await broker.create({ type: 'group', id: 'group-1' });
    expect(bodies[0].cardData.cardParamMap).toEqual({ content: '', activity: '正在处理' });
  });

  it('pushes robot single-chat messages with app credentials and no card template', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/oauth2/accessToken')) {
        return new Response(JSON.stringify({ accessToken: 'token-1', expireIn: 7200 }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }));
    const broker = new DingTalkNativeCardBroker({
      DINGTALK_CLIENT_ID: 'app', DINGTALK_CLIENT_SECRET: 'secret', DINGTALK_ROBOT_CODE: 'robot'
    } as any);

    await broker.sendRobotDirectMessage('user-1', '### DWS 设备授权\n\n授权地址：https://login.dingtalk.com/verify', 'DWS 授权');

    expect(broker.enabled()).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toContain('/robot/oToMessages/batchSend');
    const body = JSON.parse(String(calls[1]!.init.body));
    expect(body.robotCode).toBe('robot');
    expect(body.userIds).toEqual(['user-1']);
    expect(body.msgKey).toBe('sampleMarkdown');
    expect(JSON.parse(body.msgParam)).toEqual({
      title: 'DWS 授权',
      text: '### DWS 设备授权\n\n授权地址：https://login.dingtalk.com/verify'
    });
  });
});
