import { describe, expect, it, vi } from 'vitest';
import { ZiniaoBroker } from '../src/ziniao-broker.js';
import { ZiniaoTool } from '../src/ziniao-tool.js';
import { classifyZiniaoImpact } from '../src/ziniao-impact.js';

const user = { corpId: 'corp-a', userId: 'seller-1' };

describe('Ziniao user isolation and command policy', () => {
  it('uses a distinct opaque home for each DingTalk identity', () => {
    const broker = new ZiniaoBroker({ ZINIAO_BIN: 'ziniao-cli', ZINIAO_USERS_DIR: '/var/lib/ziniao/users' });
    const first = broker.userHome(user);
    expect(first).toBe(broker.userHome(user));
    expect(first).not.toBe(broker.userHome({ corpId: 'corp-a', userId: 'seller-2' }));
    expect(first).not.toBe(broker.userHome({ corpId: 'corp-b', userId: 'seller-1' }));
    expect(first).not.toContain('seller-1');
  });

  it('executes only explicit reads without confirmation and rejects profile overrides', async () => {
    const broker = { runCommand: vi.fn(async () => ({ ok: true })) } as unknown as ZiniaoBroker;
    const tool = new ZiniaoTool(broker);
    const read = tool.parse({ capability: 'account.list', args: ['--name', 'shop'] });
    expect(tool.action(read).risk).toBe('read');
    await tool.execute(user, read, false, { taskId: 'task-1' });
    expect(broker.runCommand).toHaveBeenCalledWith(user, ['account', 'list', '--name', 'shop'], { taskId: 'task-1' });
    const write = tool.parse({ capability: 'account.update', args: ['--name', 'shop'] });
    expect(tool.action(write).risk).toBe('write');
    await expect(tool.execute(user, write, false)).rejects.toThrow('ZINIAO_CONFIRMATION_REQUIRED');
    expect(() => tool.parse({ capability: 'account.list', args: ['--profile', 'other-user'] })).toThrow('ZINIAO_CREDENTIAL_ARGUMENT_FORBIDDEN');
    expect(() => tool.parse({ capability: 'config.use', args: ['other-user'] })).toThrow('ZINIAO_CAPABILITY_NOT_ALLOWED');
    expect(tool.action(tool.parse({ capability: 'api.call', args: ['GET', '/app/builtin/company'] })).risk).toBe('write');
  });

  it('serves the queue snapshot in-process without confirmation or CLI calls', async () => {
    const snapshot = { busy: false, heldByMe: false, position: null, depth: 0, holder: null };
    const broker = { queueStatus: vi.fn(() => snapshot), runCommand: vi.fn() } as unknown as ZiniaoBroker;
    const tool = new ZiniaoTool(broker);
    const input = tool.parse({ capability: 'utility.queue-status' });
    expect(tool.action(input).risk).toBe('read');
    const result = await tool.execute(user, input, false);
    expect(result).toBe(snapshot);
    expect(broker.queueStatus).toHaveBeenCalledWith(user);
    expect(broker.runCommand).not.toHaveBeenCalled();
  });
});

describe('Ziniao effect-based confirmation', () => {
  const task = '打开 BAGWAT-US 店铺，如有登录则登录，切换到英国站点和中文界面，然后截图首页';
  const impact = (capability: string, args: string[] = [], purpose?: string) =>
    classifyZiniaoImpact({ capability, args, ...(purpose ? { purpose } : {}) }, task).kind;

  it('runs session preparation and observation without a business approval', async () => {
    const broker = { runCommand: vi.fn(async () => ({ ok: true })) } as unknown as ZiniaoBroker;
    const tool = new ZiniaoTool(broker);
    for (const input of [
      { capability: 'store.open', args: ['--name', 'BAGWAT-US'] },
      { capability: 'page.visit', args: ['--store-id', '123', '--url', 'https://sellercentral.amazon.co.uk/home'] },
      { capability: 'page.click', args: ['--selector', '#signInSubmit'], purpose: '登录店铺', effect: 'session', effectReason: '只建立登录会话' },
      { capability: 'page.click', args: ['--selector', '#marketplace-selector'], purpose: '切换英国站点', effect: 'session', effectReason: '只切换当前站点' },
      { capability: 'page.click', args: ['--selector', '#language-zh'], purpose: '切换界面语言为中文', effect: 'session', effectReason: '只切换界面语言' },
      { capability: 'page.screenshot', args: ['--store-id', '123'] },
      { capability: 'store.close', args: ['--id', '123'] }
    ]) {
      const parsed = tool.parse(input);
      expect(tool.action(parsed, task).risk).toBe('read');
      await tool.execute(user, parsed, false, {}, task);
    }
    expect(broker.runCommand).toHaveBeenCalledTimes(7);
  });

  it('requires approval for business changes, ambiguous clicks and mixed automation', () => {
    expect(impact('account.update', ['--id', '123'])).toBe('business');
    expect(impact('page.click', ['--selector', '#save-product'], '切换语言为中文')).toBe('uncertain');
    expect(impact('page.click', ['--selector', '#button'])).toBe('uncertain');
    expect(impact('page.click', ['--selector', '#button'], '切换语言为中文')).toBe('uncertain');
    expect(classifyZiniaoImpact({ capability: 'page.click', args: ['--selector', '#campaigns'], effect: 'session', effectReason: '仅打开广告活动查看页' }, task).kind).toBe('session');
    expect(classifyZiniaoImpact({ capability: 'page.click', args: ['--selector', '#save'], effect: 'session', effectReason: '仅打开页面' }, '修改商品').kind).toBe('session');
    expect(classifyZiniaoImpact({ capability: 'page.click', args: ['--selector', '#save'], effect: 'business', effectReason: '会提交商品修改' }, '查看页面').kind).toBe('business');
    expect(impact('store.open', ['--name', 'BAGWAT-US', '--url', 'https://example.com/orders/delete'])).toBe('session');
    expect(impact('page.visit', ['--url', 'javascript:alert(1)'])).toBe('uncertain');
    expect(impact('page.visit', ['--url', 'https://sellercentral.amazon.com/advertising/campaigns'])).toBe('session');
    expect(impact('page.exec', ['--script', 'fetch("/orders/ship")'])).toBe('uncertain');
    expect(impact('page.exec', ['--script', 'document.title'])).toBe('observe');
    expect(impact('page.exec', ['--script', 'location.href'])).toBe('observe');
    expect(impact('page.exec', ['--script', 'document.location.href'])).toBe('observe');
    expect(impact('page.exec', ['--script', 'document.title = "changed"'])).toBe('uncertain');
    const steps = JSON.stringify([{ type: 'screenshot' }, { type: 'click', selector: '#save-product' }]);
    expect(impact('automation.run', ['--steps', steps], '切换英国站点')).toBe('uncertain');
    expect(impact('zclaw.invoke', ['list_opened_stores'])).toBe('observe');
    expect(impact('zclaw.invoke', ['list_stores'])).toBe('observe');
  });

  it('checks each automation step before skipping confirmation', () => {
    const steps = JSON.stringify([
      { type: 'visit', url: 'https://sellercentral.amazon.co.uk/home' },
      { type: 'click', selector: '#marketplace-selector' },
      { type: 'click', selector: '#language-zh' },
      { type: 'screenshot' }
    ]);
    expect(classifyZiniaoImpact({ capability: 'automation.run', args: ['--steps', steps], purpose: '切换英国站点和中文界面', effect: 'session', effectReason: '只进行站点和语言切换' }, task).kind).toBe('session');
    expect(impact('automation.run', ['--steps', steps])).toBe('uncertain');
  });

  it('classifies safe and unsafe raw API paths by the endpoint effect', () => {
    expect(impact('api.call', ['/superbrowser/rest/v1/erp/security/access_rule/list'])).toBe('observe');
    expect(impact('api.call', ['/superbrowser/rest/v1/erp/security/access_rule/edit'])).toBe('uncertain');
  });

  it('treats composed page observations as reads without relying on field names', () => {
    expect(impact('page.exec', ['--script', 'JSON.stringify({url: window.location.href, title: document.title})'])).toBe('observe');
    expect(impact('page.exec', ['--script', 'JSON.stringify([document.title, location.href])'])).toBe('observe');
    expect(impact('page.exec', ['--script', 'JSON.stringify({value: document.title, changed: true})'])).toBe('observe');
    expect(impact('page.exec', ['--script', 'JSON.stringify({value: document.title = "x"})'])).toBe('uncertain');
    expect(impact('page.exec', ['--script', 'JSON.stringify({value: doSomething(document.title)})'])).toBe('uncertain');
    expect(classifyZiniaoImpact({ capability: 'page.exec', args: ['--script', 'readCurrentState()'], effect: 'observe', effectReason: 'Agent 已确认只读取页面状态' }, task).kind).toBe('observe');
    expect(classifyZiniaoImpact({ capability: 'page.exec', args: ['--script', 'document.title = "x"'], effect: 'observe', effectReason: 'Agent 判断该脚本只读取页面状态' }, task).kind).toBe('observe');
    expect(classifyZiniaoImpact({ capability: 'page.exec', args: ['--script', 'window.location.href = "https://example.test/next"'], effect: 'session', effectReason: '仅导航到页面，不修改业务数据' }, task).kind).toBe('session');
    expect(classifyZiniaoImpact({ capability: 'page.exec', args: ['--script', 'window.location.href = "https://example.test/next"'] }, task).kind).toBe('uncertain');
  });
});
