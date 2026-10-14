import { ZINIAO_READ_CAPABILITIES } from './ziniao-policy.js';

export type ZiniaoDeclaredEffect = 'observe' | 'session' | 'business' | 'unknown';
export interface ZiniaoImpactInput { capability: string; args: string[]; purpose?: string; effect?: ZiniaoDeclaredEffect; effectReason?: string }
export type ZiniaoImpact = { kind: 'observe' | 'session' | 'business' | 'uncertain'; reason: string };

const observe = (reason: string): ZiniaoImpact => ({ kind: 'observe', reason });
const session = (reason: string): ZiniaoImpact => ({ kind: 'session', reason });
const business = (reason: string): ZiniaoImpact => ({ kind: 'business', reason });
const uncertain = (reason: string): ZiniaoImpact => ({ kind: 'uncertain', reason });

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function urlIsNavigation(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol);
  } catch { return false; }
}

function readOnlyPageScript(script: string | undefined): boolean {
  if (!script?.trim()) return false;
  const code = script.replace(/\/\*[^]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').trim();
  // Classify by syntax and observable roots, not by the business words in a
  // selector, URL, or request.  A read expression may compose page values
  // into objects/arrays and serialize them (a common way for an Agent to
  // return several observations in one call).
  if (/[;=]|\+\+|--|=>|\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/i.test(code)) return false;
  const calls = [...code.matchAll(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g)].map((match) => match[1]);
  if (calls.some((call) => call !== 'JSON.stringify')) return false;
  if (!/\b(?:document|window\.location|location)\b/.test(code)) return false;
  // Only literals, member reads, and JSON.stringify are allowed. This keeps
  // unknown functions, callbacks, constructors, assignments and statements
  // on the conservative confirmation path without a keyword route.
  if (/[^\w$\s.'"`:{}()[\],?\-+*/]/.test(code)) return false;
  return true;
}

function pageScriptHasExplicitMutation(script: string | undefined): boolean {
  if (!script?.trim()) return true;
  const code = script.replace(/\/\*[^]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').trim();
  return /[;=]|\+\+|--|=>|\b(?:fetch|XMLHttpRequest|WebSocket|navigate|reload|assign|replace|click|submit|setItem|removeItem|append|insert|remove|write)\s*\(/i.test(code);
}

function pageScriptIsNavigationOnly(script: string | undefined): boolean {
  if (!script?.trim()) return false;
  // Keep `https://` intact; the generic comment stripper would mistake the
  // protocol's double slash for a comment and hide the navigation target.
  const code = script.replace(/\/\*[^]*?\*\//g, '').trim();
  // Location assignment changes the document being viewed, but does not
  // mutate seller data. Treat it like page.visit when the Agent explicitly
  // declares a session/observation purpose. Other assignments remain gated.
  return /^(?:(?:window|document)\.)?location(?:\.href)?\s*=/i.test(code);
}

function classifyStep(step: unknown, requestText: string, purpose?: string): ZiniaoImpact {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return uncertain('自动化步骤无法识别');
  const value = step as Record<string, unknown>;
  const type = String(value.type ?? '');
  if (['screenshot', 'wait', 'scroll'].includes(type)) return observe('仅观察页面或滚动');
  if (type === 'visit') return urlIsNavigation(String(value.url ?? '')) ? session('导航页面') : uncertain('导航地址可能改变业务状态');
  if (type === 'click' || type === 'input') {
    return uncertain('页面交互效果无法确定');
  }
  return uncertain('自动化步骤可能执行任意页面操作');
}

/** Classify the effect of one concrete command, rather than its CLI namespace. */
export function classifyZiniaoImpact(input: ZiniaoImpactInput, requestText = ''): ZiniaoImpact {
  const { capability, args } = input;
  if (ZINIAO_READ_CAPABILITIES.has(capability)) return observe('查询');
  // Explicit server-side business capabilities are a hard safety boundary;
  // an agent declaration can never downgrade them to a read/session action.
  if (/^(?:account|staff|department|role|device)\./.test(capability)) return business('服务端业务或权限变更');
  if (input.effect === 'business') return business('Agent 判断该步骤会影响业务数据');
  if (input.effect === 'unknown') return uncertain('Agent 无法确认该步骤的实际影响');
  if (args.includes('--dry-run')) return observe('仅预览，不执行');
  if (['store.open', 'store.close', 'store.prepare-agent'].includes(capability)) {
    const url = flag(args, '--url');
    return url && !urlIsNavigation(url) ? uncertain('打开店铺时附带的导航地址可能改变业务状态') : session('仅控制本地浏览器会话');
  }
  if (capability === 'utility.debug-compare') return observe('对比查询结果');
  if (capability === 'utility.download') return session('仅生成本地下载文件');
  if (['page.screenshot', 'page.content', 'page.query', 'page.extract', 'page.wait-element', 'page.wait-nav', 'page.scroll'].includes(capability)) return observe('仅观察浏览器页面');
  if (capability === 'page.visit') return urlIsNavigation(flag(args, '--url')) ? session('导航页面') : uncertain('导航地址可能改变业务状态');
  if (capability === 'page.exec') {
    const script = flag(args, '--script');
    // Page scripts are an open-ended language surface. Do not infer risk from
    // punctuation, field names, URL fragments, or other brittle text rules.
    // The Agent must classify the concrete intent; the host still keeps the
    // capability-level business-write gates and verifies the post-state.
    if ((input.effect === 'observe' || input.effect === 'session') && input.effectReason?.trim()) {
      return input.effect === 'session' ? session('Agent 判断为无业务副作用的会话脚本') : observe('Agent 判断为只读脚本');
    }
    return readOnlyPageScript(script) ? observe('脚本未提交影响判断，宿主仅接受可证明的只读表达式') : uncertain('缺少可信的 Agent 影响判断');
  }
  if (capability === 'page.click' || capability === 'page.input') {
    if ((input.effect === 'observe' || input.effect === 'session') && input.effectReason?.trim()) return input.effect === 'session'
      ? session('Agent 判断为会话或导航操作')
      : observe('Agent 判断为页面观察操作');
    return uncertain('页面交互效果无法确定');
  }
  if (capability === 'automation.run') {
    if ((input.effect === 'observe' || input.effect === 'session') && input.effectReason?.trim()) return input.effect === 'session'
      ? session('Agent 判断自动化仅包含会话或导航操作')
      : observe('Agent 判断自动化仅包含页面观察操作');
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
