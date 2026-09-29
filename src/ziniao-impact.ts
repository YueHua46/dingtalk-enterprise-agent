import { ZINIAO_READ_CAPABILITIES } from './ziniao-policy.js';

export interface ZiniaoImpactInput { capability: string; args: string[]; purpose?: string }
export type ZiniaoImpact = { kind: 'observe' | 'session' | 'business' | 'uncertain'; reason: string };

const observe = (reason: string): ZiniaoImpact => ({ kind: 'observe', reason });
const session = (reason: string): ZiniaoImpact => ({ kind: 'session', reason });
const business = (reason: string): ZiniaoImpact => ({ kind: 'business', reason });
const uncertain = (reason: string): ZiniaoImpact => ({ kind: 'uncertain', reason });

// These terms describe changes to business records, permissions or money. They
// override a caller's claimed purpose, including inside a batched automation.
const businessTerms = /(?:保存|提交|发布|删除|移除|创建|新增|修改|编辑|更新|授权|审批|购买|续费|退款|发货|下单|支付|价格|库存|商品|订单|广告|活动|权限|员工|账号设置|店铺设置|策略|扣费|save|submit|publish|delete|remove|create|update|edit|grant|approve|purchase|renew|refund|ship|checkout|pay|price|inventory|listing|product|order|campaign|permission|policy)/i;
const sessionTerms = /(?:打开|关闭|登录|登入|切换|选择|查看|浏览|导航|搜索|筛选|翻页|展开|收起|截图|语言|站点|区域|商城|店铺首页|sign.?in|log.?in|switch|select|view|browse|navigate|search|filter|expand|collapse|language|locale|marketplace|region|country|site)/i;
const sessionTarget = /(?:login|signin|sign-in|language|locale|marketplace|region|country|site|search|filter|menu|nav|dropdown|tab|pagination|next|英国|中文|语言|站点|切换|登录|搜索|筛选|菜单|导航)/i;

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function businessTarget(target: string): boolean {
  // The login form's submit button establishes a session. Other submit/save
  // targets may persist business data.
  const normalized = target.replace(/sign.?in|log.?in|login/gi, '').replace(/submit/gi, '');
  return businessTerms.test(normalized) || (businessTerms.test(target) && !/(?:sign.?in|log.?in|login)/i.test(target));
}

function authorizedSessionStep(input: ZiniaoImpactInput, requestText: string, target: string): boolean {
  const purpose = input.purpose?.trim() ?? '';
  if (!purpose || !sessionTerms.test(purpose) || businessTerms.test(purpose)) return false;
  if (!sessionTerms.test(requestText)) return false;
  if (businessTarget(target)) return false;
  return sessionTarget.test(target);
}

function urlIsNavigation(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) && !businessTerms.test(parsed.pathname);
  } catch { return false; }
}

function readOnlyPageScript(script: string | undefined): boolean {
  if (!script?.trim()) return false;
  const code = script.replace(/\/\*[^]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').trim();
  if (/[=;]|\b(?:fetch|XMLHttpRequest|WebSocket|navigate|reload|assign|replace|click|submit|setItem|removeItem|append|insert|remove|write)\s*\(/i.test(code)) return false;
  return /^(?:\(?\s*)?(?:document\.(?:title|URL|documentURI|referrer|readyState|visibilityState)|location\.(?:href|host|hostname|pathname|port|protocol|search|hash)|window\.location\.(?:href|host|hostname|pathname|port|protocol|search|hash)|document\.body\.(?:innerText|textContent)|document\.documentElement\.(?:innerText|textContent))\s*\)?$/i.test(code);
}

function classifyStep(step: unknown, requestText: string, purpose?: string): ZiniaoImpact {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return uncertain('自动化步骤无法识别');
  const value = step as Record<string, unknown>;
  const type = String(value.type ?? '');
  if (['screenshot', 'wait', 'scroll'].includes(type)) return observe('仅观察页面或滚动');
  if (type === 'visit') return urlIsNavigation(String(value.url ?? '')) ? session('导航页面') : uncertain('导航地址可能改变业务状态');
  if (type === 'click' || type === 'input') {
    const target = String(value.selector ?? '');
    if (businessTarget(target)) return business('页面目标涉及业务变更');
    if (authorizedSessionStep({ capability: `page.${type}`, args: [], ...(purpose ? { purpose } : {}) }, requestText, target)) return session('当前请求中的会话准备或浏览步骤');
    return uncertain('页面交互效果无法确定');
  }
  return uncertain('自动化步骤可能执行任意页面操作');
}

/** Classify the effect of one concrete command, rather than its CLI namespace. */
export function classifyZiniaoImpact(input: ZiniaoImpactInput, requestText = ''): ZiniaoImpact {
  const { capability, args } = input;
  if (args.includes('--dry-run')) return observe('仅预览，不执行');
  if (ZINIAO_READ_CAPABILITIES.has(capability)) return observe('查询');
  if (['store.open', 'store.close', 'store.prepare-agent'].includes(capability)) {
    const url = flag(args, '--url');
    return url && !urlIsNavigation(url) ? uncertain('打开店铺时附带的导航地址可能改变业务状态') : session('仅控制本地浏览器会话');
  }
  if (capability === 'utility.debug-compare') return observe('对比查询结果');
  if (capability === 'utility.download') return session('仅生成本地下载文件');
  if (['page.screenshot', 'page.content', 'page.query', 'page.extract', 'page.wait-element', 'page.wait-nav', 'page.scroll'].includes(capability)) return observe('仅观察浏览器页面');
  if (capability === 'page.visit') return urlIsNavigation(flag(args, '--url')) ? session('导航页面') : uncertain('导航地址可能改变业务状态');
  if (capability === 'page.exec') return readOnlyPageScript(flag(args, '--script')) ? observe('仅读取网页状态') : uncertain('脚本可能改变页面或业务状态');
  if (capability === 'page.click' || capability === 'page.input') {
    const target = flag(args, '--selector') ?? '';
    if (businessTarget(target)) return business('页面目标涉及业务变更');
    if (authorizedSessionStep(input, requestText, target)) return session('当前请求中的会话准备或浏览步骤');
    return uncertain('页面交互效果无法确定');
  }
  if (capability === 'automation.run') {
    let steps: unknown;
    try { steps = JSON.parse(flag(args, '--steps') ?? ''); } catch { return uncertain('自动化步骤不是有效 JSON'); }
    if (!Array.isArray(steps) || steps.length === 0) return uncertain('自动化步骤为空或无法识别');
    const impacts = steps.map((step) => classifyStep(step, requestText, input.purpose));
    if (impacts.some((impact) => impact.kind === 'business')) return business('自动化包含业务变更步骤');
    if (impacts.some((impact) => impact.kind === 'uncertain')) return uncertain('自动化包含效果不明的步骤');
    return impacts.some((impact) => impact.kind === 'session') ? session('自动化仅包含浏览器会话与观察步骤') : observe('自动化仅观察页面');
  }
  if (capability === 'zclaw.invoke') {
    const command = args[0];
    if (command === 'list_stores' || command === 'list_opened_stores') return observe('查询店铺列表');
    if (command && ['open_store', 'close_store', 'prepare_agent'].includes(command)) return session('仅控制本地浏览器会话');
    return uncertain('通用 Bridge 调用的效果未证明');
  }
  // Raw API paths are often POST even for queries. Only a path whose final
  // operation is explicitly observational is allowed without approval.
  if (capability === 'api.call') {
    const path = args.find((arg) => arg.startsWith('/superbrowser/'));
    const leaf = path?.split('?')[0]?.split('/').at(-1);
    if (leaf && /^(?:list|detail|query|page|historybind|purchased_package_info|bindable_list|one_account)$/.test(leaf)) return observe('服务端查询接口');
    return uncertain('通用 API 可能改变业务数据');
  }
  if (/^(?:account|staff|department|role|device)\./.test(capability)) return business('服务端业务或权限变更');
  return uncertain('命令效果未证明');
}
