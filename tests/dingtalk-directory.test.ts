import { describe, expect, it } from 'vitest';
import { DingTalkDirectory } from '../src/dingtalk-directory.js';

const config = {
  DINGTALK_CLIENT_ID: 'app',
  DINGTALK_CLIENT_SECRET: 'secret',
  DINGTALK_DIRECTORY_FACTORY_DEPT_ID: 9
};

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('DingTalk directory candidate projection', () => {
  it('excludes the factory subtree and dual-department factory members', async () => {
    const http = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (String(url).includes('/oauth2/accessToken')) return response({ accessToken: 'token', expireIn: 7200 });
      const body = JSON.parse(String(init?.body));
      if (String(url).includes('/department/listsub')) {
        const rows: Record<number, unknown[]> = {
          1: [{ dept_id: 2, name: '运营' }, { dept_id: 9, name: '工厂' }],
          2: [{ dept_id: 3, name: '欧洲组' }],
          3: [], 9: [{ dept_id: 10, name: '工厂二组' }], 10: []
        };
        return response({ errcode: 0, result: rows[body.dept_id] });
      }
      const members: Record<number, unknown[]> = {
        1: [],
        2: [{ userid: 'leader', name: '负责人' }, { userid: 'shared', name: '兼任人员' }],
        3: [{ userid: 'assistant', name: '运营助理' }, { userid: 'leader', name: '负责人' }],
        9: [{ userid: 'factory', name: '工厂员工' }, { userid: 'shared', name: '兼任人员' }],
        10: [{ userid: 'factory-child', name: '工厂子部门员工' }]
      };
      return response({ errcode: 0, result: { list: members[body.dept_id], has_more: false } });
    };
    const result = await new DingTalkDirectory(config, http as typeof fetch).candidates();
    expect(result).toEqual([
      { userId: 'leader', name: '负责人', departmentIds: [2, 3] },
      { userId: 'assistant', name: '运营助理', departmentIds: [3] }
    ]);
  });

  it('fails closed if the factory department is not visible', async () => {
    const http = async (url: string | URL | Request): Promise<Response> => String(url).includes('/oauth2/accessToken')
      ? response({ accessToken: 'token' })
      : response({ errcode: 0, result: [] });
    await expect(new DingTalkDirectory(config, http as typeof fetch).candidates())
      .rejects.toThrow('DINGTALK_FACTORY_DEPARTMENT_NOT_VISIBLE');
  });

  it('does not expose the provider error text or token when a permission is missing', async () => {
    const http = async (url: string | URL | Request): Promise<Response> => String(url).includes('/oauth2/accessToken')
      ? response({ accessToken: 'private-token' })
      : response({ errcode: 88, errmsg: 'permission URL with sensitive context' });
    await expect(new DingTalkDirectory(config, http as typeof fetch).candidates())
      .rejects.toThrow('DINGTALK_DIRECTORY_API_ERROR_88');
  });
});
