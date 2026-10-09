import { afterEach, describe, expect, it, vi } from 'vitest';
import { documentToMessages, executionToA2UI, validateUiDocument } from '../src/a2ui.js';
import { DingTalkA2UICardBroker } from '../src/dingtalk-a2ui.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('semantic A2UI documents', () => {
  it('accepts arbitrary catalog components and creates a stable surface sequence', () => {
    const document = { root: { id: 'tabs', component: 'Tabs', children: [
      { id: 'chart', component: 'Chart', props: { type: 'line' } },
      { id: 'table', component: 'Table', props: { columns: ['name'] } }
    ] }, data: { rows: [] } };
    expect(validateUiDocument(document)).toEqual([]);
    const messages = documentToMessages(document, 'catalog', 'surface');
    expect(messages.map((message) => Object.keys(message).find((key) => key !== 'version'))).toEqual(['createSurface', 'updateDataModel', 'updateComponents']);
    expect(messages[0]).toMatchObject({ createSurface: { surfaceId: 'surface', catalogId: 'catalog' } });
  });

  it('rejects unknown components and keeps execution shell separate from result content', () => {
    expect(validateUiDocument({ root: { id: 'x', component: 'UnknownWidget' } })).toContain('root.component:unsupported:UnknownWidget');
    const messages = executionToA2UI({ title: '任务', status: 'executing', steps: [{ id: '1', label: '查询', kind: 'tool', status: 'running' }] }, 'catalog', 'surface');
    expect(messages).toHaveLength(3);
    expect(JSON.stringify(messages)).toContain('CollapsiblePanel');
  });

  it('creates and updates through the AI-card API with robotCode and stable ids', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/oauth2/accessToken')) return new Response(JSON.stringify({ accessToken: 'token', expireIn: 7200 }));
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ success: true, result: { deliverResults: [{ success: true }] } }));
    }));
    const broker = new DingTalkA2UICardBroker({ DINGTALK_A2UI_ENABLED: 'true', DINGTALK_API_BASE_URL: 'https://api.dingtalk.com', DINGTALK_CLIENT_ID: 'app', DINGTALK_CLIENT_SECRET: 'secret', DINGTALK_ROBOT_CODE: 'robot', DINGTALK_A2UI_UPDATE_PATH: '/v1.0/card/ai/instances' } as any);
    const id = await broker.create({ type: 'group', id: 'group' }, [{ version: 'v1.0', createSurface: { surfaceId: 'surface', catalogId: 'catalog' } }], 'task-1');
    await broker.update(id, [{ version: 'v1.0', updateDataModel: { surfaceId: 'surface', path: '/x', value: 1 } }], 'EXECUTING');
    expect(calls[0]).toMatchObject({ url: 'https://api.dingtalk.com/v1.0/card/ai/instances/createAndDeliver', body: { outTrackId: 'task-1', imGroupOpenDeliverModel: { robotCode: 'robot' } } });
    expect(calls[1]).toMatchObject({ url: 'https://api.dingtalk.com/v1.0/card/ai/instances', body: { outTrackId: 'task-1', flowStatus: 'EXECUTING' } });
    expect(calls[1]!.body.a2uiMessages[0]).toContain('updateDataModel');
  });
});
