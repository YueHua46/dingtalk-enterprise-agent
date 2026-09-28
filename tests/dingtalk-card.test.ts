import { describe, expect, it, vi, afterEach } from 'vitest';
import { DingTalkNativeCardBroker } from '../src/dingtalk-card.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

  it('declares the robot single-chat space when creating a direct task card', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/oauth2/accessToken')) return new Response(JSON.stringify({ accessToken: 'token-1', expireIn: 7200 }), { status: 200 });
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ success: true, result: { deliverResults: [{ success: true }] } }), { status: 200 });
    }));
    const broker = new DingTalkNativeCardBroker({
      DINGTALK_CLIENT_ID: 'app', DINGTALK_CLIENT_SECRET: 'secret', DINGTALK_ROBOT_CODE: 'robot',
      DINGTALK_CARD_TEMPLATE_ID: 'template.schema', DINGTALK_CARD_VARIABLE: 'content'
    } as any);
    await broker.create({ type: 'direct', id: 'user-1' });
    expect(bodies[0]).toMatchObject({
      openSpaceId: 'dtv1.card//IM_ROBOT.user-1',
      imRobotOpenSpaceModel: { supportForward: true },
      imRobotOpenDeliverModel: { robotCode: 'robot', spaceType: 'IM_ROBOT' }
    });
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

  it('delivers an approval card to the originating group with Stream callbacks and forwarding disabled', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/oauth2/accessToken')) return new Response(JSON.stringify({ accessToken: 'token-1', expireIn: 7200 }), { status: 200 });
      return new Response(JSON.stringify({ success: true, result: { deliverResults: [{ success: true }] } }), { status: 200 });
    }));
    const broker = new DingTalkNativeCardBroker({
      DINGTALK_CLIENT_ID: 'app', DINGTALK_CLIENT_SECRET: 'secret', DINGTALK_ROBOT_CODE: 'robot',
      DINGTALK_APPROVAL_CARD_TEMPLATE_ID: 'approval.schema', DINGTALK_APPROVAL_CARD_CONTENT_VAR: 'content',
      DINGTALK_APPROVAL_CARD_STATUS_VAR: 'status'
    } as any);

    const id = await broker.createApprovalCard({ type: 'group', id: 'group-1' }, '请确认', 'challenge-1');
    const body = JSON.parse(String(calls[1]!.init.body));
    expect(body).toMatchObject({
      outTrackId: id,
      cardTemplateId: 'approval.schema',
      callbackType: 'STREAM',
      userIdType: 1,
      openSpaceId: 'dtv1.card//IM_GROUP.group-1',
      imGroupOpenSpaceModel: { supportForward: false },
      imGroupOpenDeliverModel: { robotCode: 'robot' }
    });
    expect(body.imRobotOpenDeliverModel).toBeUndefined();
    expect(body.cardData.cardParamMap).toMatchObject({ status: 'pending', flowStatus: '2', challengeId: 'challenge-1' });
  });

  it('renders approval creation time in Beijing time even when the host runs in UTC', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/oauth2/accessToken')) return new Response(JSON.stringify({ accessToken: 'token-1', expireIn: 7200 }), { status: 200 });
      return new Response(JSON.stringify({ success: true, result: { deliverResults: [{ success: true }] } }), { status: 200 });
    }));
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-23T10:32:25Z'));
      const broker = new DingTalkNativeCardBroker({
        DINGTALK_CLIENT_ID: 'app', DINGTALK_CLIENT_SECRET: 'secret', DINGTALK_ROBOT_CODE: 'robot',
        DINGTALK_APPROVAL_CARD_TEMPLATE_ID: 'approval.schema', DINGTALK_APPROVAL_CARD_CONTENT_VAR: 'content',
        DINGTALK_APPROVAL_CARD_STATUS_VAR: 'status'
      } as any);
      await broker.createApprovalCard({ type: 'direct', id: 'user-1' }, '请确认', 'challenge-1');
      const body = JSON.parse(String(calls[1]!.init.body));
      expect(body.cardData.cardParamMap.createTime).toBe('2026/9/23 18:32:25');
      expect(body).toMatchObject({
        openSpaceId: 'dtv1.card//IM_ROBOT.user-1',
        imRobotOpenSpaceModel: { supportForward: false },
        imRobotOpenDeliverModel: { robotCode: 'robot', spaceType: 'IM_ROBOT' }
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('updates the same approval card with a new challenge ID and pending state', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/oauth2/accessToken')) return new Response(JSON.stringify({ accessToken: 'token-1', expireIn: 7200 }), { status: 200 });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }));
    const broker = new DingTalkNativeCardBroker({
      DINGTALK_CLIENT_ID: 'app', DINGTALK_CLIENT_SECRET: 'secret', DINGTALK_ROBOT_CODE: 'robot',
      DINGTALK_APPROVAL_CARD_TEMPLATE_ID: 'approval.schema', DINGTALK_APPROVAL_CARD_CONTENT_VAR: 'content',
      DINGTALK_APPROVAL_CARD_STATUS_VAR: 'status'
    } as any);
    await broker.updateApprovalCard('same-card', '第二项待确认', 'pending', 'second-challenge');
    const update = JSON.parse(String(calls[1]!.init.body));
    expect(calls[1]!.url).toContain('/v1.0/card/instances');
    expect(calls[1]!.init.method).toBe('PUT');
    expect(update).toMatchObject({ outTrackId: 'same-card', cardData: { cardParamMap: {
      content: '第二项待确认', status: 'pending', flowStatus: '2', challengeId: 'second-challenge'
    } } });
    await broker.updateApprovalCard('same-card', '任务已结束', 'done');
    const finished = JSON.parse(String(calls[2]!.init.body));
    expect(finished.cardData.cardParamMap).toMatchObject({ status: 'done', flowStatus: '3', challengeId: '' });
  });

  it('exposes DingTalk status, code and request ID when approval card delivery fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/oauth2/accessToken')) return new Response(JSON.stringify({ accessToken: 'token-1', expireIn: 7200 }), { status: 200 });
      return new Response(JSON.stringify({ code: 'param.templateUnpublished', message: 'Template is not published', requestId: 'req-123' }), { status: 400 });
    }));
    const broker = new DingTalkNativeCardBroker({
      DINGTALK_CLIENT_ID: 'app', DINGTALK_CLIENT_SECRET: 'secret', DINGTALK_ROBOT_CODE: 'robot',
      DINGTALK_APPROVAL_CARD_TEMPLATE_ID: 'approval.schema', DINGTALK_APPROVAL_CARD_CONTENT_VAR: 'content',
      DINGTALK_APPROVAL_CARD_STATUS_VAR: 'status'
    } as any);
    await expect(broker.createApprovalCard({ type: 'direct', id: 'user-1' }, '请确认', 'challenge-1'))
      .rejects.toThrow('HTTP 400 code=param.templateUnpublished message=Template is not published requestId=req-123');
  });

  it('reports missing approval template configuration instead of using a fabricated default', async () => {
    const broker = new DingTalkNativeCardBroker({ DINGTALK_ROBOT_CODE: 'robot' } as any);
    await expect(broker.createApprovalCard({ type: 'group', id: 'group-1' }, '请确认', 'challenge-1'))
      .rejects.toThrow('APPROVAL_CARD_TEMPLATE_ID_NOT_CONFIGURED');
  });
});
