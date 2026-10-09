import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { DingTalkA2UICardBroker } from '../src/dingtalk-a2ui.js';

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });

function bodyOf(request: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => { let text = ''; request.on('data', (chunk) => { text += chunk; }); request.on('end', () => resolve(JSON.parse(text || '{}'))); request.on('error', reject); });
}

describe('A2UI transport HTTP end to end', () => {
  it('runs OAuth → create → delta update → final update over real HTTP', async () => {
    const received: Array<{ path: string; body: any; auth?: string }> = [];
    const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
      const body = await bodyOf(request);
      if (request.url === '/v1.0/oauth2/accessToken') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ accessToken: 'e2e-token', expireIn: 3600 })); return; }
      received.push({ path: request.url ?? '', body, auth: request.headers['x-acs-dingtalk-access-token'] });
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ success: true, result: { deliverResults: [{ success: true }] } }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');

    const broker = new DingTalkA2UICardBroker({ DINGTALK_A2UI_ENABLED: 'true', DINGTALK_API_BASE_URL: `http://127.0.0.1:${address.port}`, DINGTALK_CLIENT_ID: 'app', DINGTALK_CLIENT_SECRET: 'secret', DINGTALK_ROBOT_CODE: 'robot', DINGTALK_A2UI_UPDATE_PATH: '/v1.0/card/ai/instances' } as any);
    const initial = [{ version: 'v1.0', createSurface: { surfaceId: 'surface-e2e', catalogId: 'https://dingtalk.com/card/a2ui/catalogs/public/catalog.json' } }, { version: 'v1.0', updateDataModel: { surfaceId: 'surface-e2e', path: '/', value: {} } }];
    const outTrackId = await broker.create({ type: 'group', id: 'conversation-e2e' }, initial, 'task-e2e');
    await broker.update(outTrackId, [{ version: 'v1.0', updateDataModel: { surfaceId: 'surface-e2e', path: '/status', value: 'running' } }], 'EXECUTING');
    await broker.finalize(outTrackId, [{ version: 'v1.0', updateDataModel: { surfaceId: 'surface-e2e', path: '/status', value: 'done' } }], 'FINISH');

    expect(received).toHaveLength(3);
    expect(received[0]).toMatchObject({ path: '/v1.0/card/ai/instances/createAndDeliver', auth: 'e2e-token', body: { outTrackId: 'task-e2e', imGroupOpenDeliverModel: { robotCode: 'robot' }, flowStatus: 'PROCESSING' } });
    expect(received[1]?.body).toMatchObject({ outTrackId: 'task-e2e', flowStatus: 'EXECUTING' });
    expect(received[2]?.body).toMatchObject({ outTrackId: 'task-e2e', flowStatus: 'FINISH' });
    expect(received.every((item) => item.body.outTrackId === 'task-e2e')).toBe(true);
  });

  it('does not retry an unknown network outcome', async () => {
    let calls = 0;
    const server = createServer(async (_request, response) => { calls += 1; response.destroy(); });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    const broker = new DingTalkA2UICardBroker({ DINGTALK_A2UI_ENABLED: 'true', DINGTALK_API_BASE_URL: `http://127.0.0.1:${address.port}`, DINGTALK_CLIENT_ID: 'app', DINGTALK_CLIENT_SECRET: 'secret', DINGTALK_ROBOT_CODE: 'robot', DINGTALK_A2UI_UPDATE_PATH: '/v1.0/card/ai/instances' } as any);
    await expect(broker.create({ type: 'direct', id: 'user-e2e' }, [], 'unknown-task')).rejects.toThrow('A2UI_RESULT_UNKNOWN');
    expect(calls).toBe(1);
  });
});
