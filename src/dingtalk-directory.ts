import type { Config } from './config.js';

type DirectoryConfig = Pick<Config, 'DINGTALK_CLIENT_ID' | 'DINGTALK_CLIENT_SECRET' | 'DINGTALK_DIRECTORY_FACTORY_DEPT_ID'>;

export interface DirectoryCandidate {
  userId: string;
  name: string;
  departmentIds: number[];
}

interface Department { dept_id: number; name?: string }
interface Member { userid?: string; name?: string }

const ROOT_DEPARTMENT_ID = 1;
const PAGE_SIZE = 100;
const MAX_DEPARTMENTS = 500;
const MAX_MEMBERS = 20_000;

/** Read-only application-directory projection for the authorization picker. */
export class DingTalkDirectory {
  private token?: { value: string; expiresAt: number };

  public constructor(private readonly config: DirectoryConfig, private readonly http: typeof fetch = fetch) {}

  public async candidates(): Promise<DirectoryCandidate[]> {
    const factoryId = this.config.DINGTALK_DIRECTORY_FACTORY_DEPT_ID;
    if (!factoryId) throw new Error('DINGTALK_DIRECTORY_FACTORY_DEPT_ID_NOT_CONFIGURED');
    const token = await this.accessToken();
    const departments = await this.departmentTree(token);
    if (!departments.has(factoryId)) throw new Error('DINGTALK_FACTORY_DEPARTMENT_NOT_VISIBLE');

    const excluded = new Set<number>();
    const markExcluded = (id: number): void => {
      excluded.add(id);
      for (const [childId, parentId] of departments) if (parentId === id && !excluded.has(childId)) markExcluded(childId);
    };
    markExcluded(factoryId);

    const candidates = new Map<string, { name: string; departments: Set<number> }>();
    const excludedUsers = new Set<string>();
    for (const departmentId of departments.keys()) {
      for (const member of await this.departmentMembers(token, departmentId)) {
        const userId = String(member.userid ?? '').trim();
        if (!userId) continue;
        if (excluded.has(departmentId)) {
          excludedUsers.add(userId);
          continue;
        }
        const name = String(member.name ?? '').trim();
        if (!name) continue;
        const existing = candidates.get(userId) ?? { name, departments: new Set<number>() };
        existing.departments.add(departmentId);
        candidates.set(userId, existing);
        if (candidates.size > MAX_MEMBERS) throw new Error('DINGTALK_DIRECTORY_TOO_LARGE');
      }
    }
    return [...candidates]
      .filter(([userId]) => !excludedUsers.has(userId))
      .map(([userId, value]) => ({ userId, name: value.name, departmentIds: [...value.departments].sort((a, b) => a - b) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.userId.localeCompare(b.userId));
  }

  private async departmentTree(token: string): Promise<Map<number, number | null>> {
    const departments = new Map<number, number | null>([[ROOT_DEPARTMENT_ID, null]]);
    const queue = [ROOT_DEPARTMENT_ID];
    for (let index = 0; index < queue.length; index += 1) {
      const parentId = queue[index]!;
      const result = await this.post<Department[]>(token, 'v2/department/listsub', { dept_id: parentId, language: 'zh_CN' });
      if (!Array.isArray(result)) throw new Error('DINGTALK_DEPARTMENTS_INVALID');
      for (const row of result) {
        const id = Number(row.dept_id);
        if (!Number.isSafeInteger(id) || id <= 0 || departments.has(id)) continue;
        departments.set(id, parentId);
        queue.push(id);
        if (departments.size > MAX_DEPARTMENTS) throw new Error('DINGTALK_DIRECTORY_TOO_LARGE');
      }
    }
    return departments;
  }

  private async departmentMembers(token: string, departmentId: number): Promise<Member[]> {
    const members: Member[] = [];
    let cursor = 0;
    for (let pageNumber = 0; pageNumber < 200; pageNumber += 1) {
      const result = await this.post<{ list?: Member[]; has_more?: boolean; next_cursor?: number }>(
        token, 'v2/user/list', { dept_id: departmentId, cursor, size: PAGE_SIZE }
      );
      if (!result || !Array.isArray(result.list)) throw new Error('DINGTALK_MEMBERS_INVALID');
      members.push(...result.list);
      if (members.length > MAX_MEMBERS) throw new Error('DINGTALK_DIRECTORY_TOO_LARGE');
      if (!result.has_more) return members;
      const next = Number(result.next_cursor);
      if (!Number.isSafeInteger(next) || next <= cursor) throw new Error('DINGTALK_MEMBERS_CURSOR_INVALID');
      cursor = next;
    }
    throw new Error('DINGTALK_MEMBERS_PAGE_LIMIT');
  }

  private async post<T>(token: string, path: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.http('https://oapi.dingtalk.com/topapi/' + path + '?access_token=' + encodeURIComponent(token), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000)
    });
    const payload = await response.json() as { errcode?: number; result?: T };
    if (!response.ok || payload.errcode !== 0) throw new Error('DINGTALK_DIRECTORY_API_ERROR_' + String(payload.errcode ?? response.status));
    return payload.result as T;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    if (!this.config.DINGTALK_CLIENT_ID || !this.config.DINGTALK_CLIENT_SECRET) throw new Error('DINGTALK_APP_CREDENTIALS_MISSING');
    const response = await this.http('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appKey: this.config.DINGTALK_CLIENT_ID, appSecret: this.config.DINGTALK_CLIENT_SECRET }),
      signal: AbortSignal.timeout(15_000)
    });
    const payload = await response.json() as { accessToken?: string; expireIn?: number };
    if (!response.ok || !payload.accessToken) throw new Error('DINGTALK_APP_TOKEN_FAILED');
    this.token = { value: payload.accessToken, expiresAt: Date.now() + Math.max(60, Number(payload.expireIn ?? 7200) - 60) * 1000 };
    return payload.accessToken;
  }
}
