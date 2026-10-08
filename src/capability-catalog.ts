import { generatedDwsCapabilities } from './generated-dws-capabilities.js';
import { CROSSBORDEROPS_DATASETS } from './crossborderops-data-client.js';
import { ZINIAO_READ_CAPABILITIES } from './ziniao-policy.js';
import { nativeReadOnlyMcpTools } from './mcp-tool-list.js';
import { AMAZON_OPERATIONS } from './amazon-tool.js';
import type { RiskLevel } from './types.js';

export interface CapabilityDescriptor {
  id: string;
  purpose: string;
  risk: RiskLevel;
  identity: 'dingtalk_user' | 'scoped_service' | 'public_service' | 'none';
  scope: string;
  source: string;
  inputShape?: string;
  freshness: 'live' | 'reported' | 'static';
  supports: readonly string[];
  skills: readonly string[];
  populationCapabilityByDimension?: Readonly<Record<string, string>>;
}

const fixed: CapabilityDescriptor[] = [
  ...['prepare','research','generate','inspect','revise','export'].map((name): CapabilityDescriptor => ({id:`listing.${name}`,purpose:'美国站英文 Listing 生成、修订和报告交付',risk:name === 'export' ? 'write' : 'read',identity:'dingtalk_user',scope:'当前用户及原会话 Listing 版本',source:'listing',freshness:'static',supports:['有出处的 Listing 参考稿及检查结果'],skills:['amazon-listing-studio']})),
  ...['search','read','lookup_product','status'].map((name): CapabilityDescriptor => ({ id:`knowledge.${name}`,purpose:'检索并核验当前员工可读的企业知识',risk:'read',identity:'dingtalk_user',scope:'当前 corpId + userId 的知识证据',source:'knowledge',freshness:'live',supports:['SOP、FAQ、标准参数和带位置的文档证据'],skills:['dingtalk-wiki','dingtalk-doc'] })),
  { id:'knowledge.*',purpose:'当前员工知识检索',risk:'read',identity:'dingtalk_user',scope:'当前员工可读的企业知识',source:'knowledge',freshness:'live',supports:['知识事实'],skills:['dingtalk-wiki'] },
  { id: 'artifact.input', purpose: '读取发起任务提供的附件或已按当前用户权限导入的钉盘文件', risk: 'read', identity: 'dingtalk_user', scope: '当前任务工作区', source: 'artifact', freshness: 'static', supports: ['用户提供文件中的事实'], skills: ['documents', 'pdf', 'spreadsheets', 'presentations'] },
  { id: 'artifact.read', purpose: '登记从任务输入文件提取或 OCR 得到的原文证据', risk: 'read', identity: 'dingtalk_user', scope: '当前任务工作区', source: 'artifact', freshness: 'static', supports: ['文件正文、表格或页面事实'], skills: ['documents', 'pdf', 'spreadsheets', 'presentations'] },
  { id: 'artifact.submit', purpose: '登记并向原会话投递文件成果', risk: 'write', identity: 'dingtalk_user', scope: '当前任务工作区及原会话', source: 'artifact', freshness: 'static', supports: ['文件交付回执'], skills: ['documents', 'pdf', 'spreadsheets', 'presentations'] },
  { id: 'dingtalk.*', purpose: '按当前成员权限读取或操作钉钉办公资源', risk: 'high', identity: 'dingtalk_user', scope: '钉钉服务端授权', source: 'dws', freshness: 'live', supports: ['钉钉资源事实或操作回执'], skills: ['dingtalk-office'] },
  { id: 'ziniao.*', purpose: '按当前用户独立授权读取或操作紫鸟资源', risk: 'high', identity: 'dingtalk_user', scope: '当前用户紫鸟权限', source: 'ziniao', freshness: 'live', supports: ['紫鸟业务事实或操作回执'], skills: [] },
  { id: 'crossborderops.*', purpose: '按当前用户授权店铺范围读取内部 Amazon 经营数据', risk: 'read', identity: 'scoped_service', scope: '当前 corpId + userId 的店铺集合', source: 'crossborderops', freshness: 'reported', supports: ['内部经营事实'], skills: ['amazon-business-performance-analysis'] },
  { id: 'crossborderops.scope', purpose: '列出当前用户在 CrossBorderOps 实际有权访问的 Amazon 店铺及站点，按服务端权限范围分页', risk: 'read', identity: 'scoped_service', scope: '当前 corpId + userId 的店铺集合', source: 'crossborderops', freshness: 'live', supports: ['当前用户授权店铺范围'], skills: ['amazon-business-performance-analysis'] },
  { id: 'sif.*', purpose: '读取公开 Amazon ASIN、关键词与竞品信号', risk: 'read', identity: 'public_service', scope: '公开数据，不含内部店铺销量', source: 'sif', freshness: 'reported', supports: ['公开市场信号'], skills: ['amazon-business-performance-analysis'] },
  { id: 'ziniao.cli', purpose: '以当前用户独立授权调用已登记的紫鸟能力', risk: 'high', identity: 'dingtalk_user', scope: '当前用户的紫鸟账号权限；写操作按具体能力确认', source: 'ziniao', freshness: 'live', supports: ['紫鸟业务事实或操作回执'], skills: [] },
  { id: 'agent.memory', purpose: '读取或按用户明确要求管理长期偏好', risk: 'high', identity: 'dingtalk_user', scope: '当前用户记忆', source: 'memory', freshness: 'static', supports: ['用户明确保存的偏好'], skills: [] },
  ...CROSSBORDEROPS_DATASETS.map((dataset) => ({
    id: `crossborderops.${dataset}`,
    purpose: dataset === 'daily.metrics'
      ? '通用经营指标：任意 store/site/asin/sku/date 分组的销量、销售额、订单、流量、转化、广告与 Listing 状态，支持两期对比、按站点合计与逐行完整性标注'
      : dataset === 'daily.performance_changes'
      ? '按授权店铺或 ASIN 粒度比较两个等长时段的销量变化，只列完整可比对象；支持 grain=store|asin 与 direction=decline|growth|all，返回数据完整性、分页和店铺本币金额'
      : dataset === 'daily.aggregate'
        ? '在指定单一时段按店铺、站点、ASIN 任意组合维度聚合销量与销售额并分页；按所需维度一次查询，limit 最大 100，按 total/offset 翻页并核对数据完整性；可一次获取多站点 store+site 行，按销售额排序须限定单一站点；不要求基线时段'
      : `查询授权自有 Amazon 店铺的 ${dataset} 数据`,
    risk: 'read' as const,
    identity: 'scoped_service' as const, scope: '当前 corpId + userId 在服务端计算的店铺集合', source: 'crossborderops',
    freshness: 'reported' as const, supports: ['内部经营事实'], skills: ['amazon-business-performance-analysis']
    ,...(dataset === 'daily.aggregate' ? { populationCapabilityByDimension: { store: 'crossborderops.scope' } } : {})
  })),
  ...nativeReadOnlyMcpTools.sif.map((tool) => ({
    id: `sif.${tool}`, purpose: `查询公开 ASIN、关键词或竞品信号：${tool}`, risk: 'read' as const,
    identity: 'public_service' as const, scope: '公开数据；不能证明内部店铺销量', source: 'sif',
    freshness: 'reported' as const, supports: ['公开市场信号'], skills: ['amazon-business-performance-analysis']
  })),
  ...nativeReadOnlyMcpTools.lingxing.map((tool) => ({
    id: `lingxing.${tool}`, purpose: `查看领星工具目录：${tool}`, risk: 'read' as const,
    identity: 'scoped_service' as const, scope: '仅工具目录，不读取共享密钥业务数据', source: 'lingxing',
    freshness: 'live' as const, supports: ['工具发现'], skills: ['amazon-business-performance-analysis']
  })),
  { id: 'analysis.python', purpose: '在任务沙箱中运行 Python，对已取得的证据文件做精确的派生计算或运行 Skill 分析脚本；代码与输出即计算证据', risk: 'read', identity: 'none', scope: '当前任务沙箱，无网络', source: 'analysis', freshness: 'static', supports: ['派生计算结果'], skills: [] },
  { id: 'internet.search', purpose: '检索公开网页', risk: 'read', identity: 'none', scope: '公开网页', source: 'internet', freshness: 'live', supports: ['公开事实'], skills: [] },
  ...[...AMAZON_OPERATIONS].map((operation) => ({
    id: `amazon.${operation}`, purpose: `实时采集 Amazon 公开页面证据：${operation}`, risk: 'read' as const,
    identity: 'public_service' as const, scope: 'Amazon 公开商品或搜索页面；不含公司内部店铺数据', source: 'amazon',
    freshness: 'live' as const, supports: ['Amazon 页面观察事实'], skills: ['amazon-page-research']
  })),
  { id: 'image.generate', purpose: '调用已配置的原生图像模型生成或编辑图片，并投递到当前钉钉会话', risk: 'write', identity: 'none', scope: '当前任务附件与原会话', source: 'image', freshness: 'static', supports: ['生成图片', '编辑图片', '图片投递回执'], skills: [] },
  { id: 'reference.read_guide', purpose: '读取已安装 Skill 的操作说明', risk: 'read', identity: 'none', scope: '本地 Skill 文件', source: 'skill', freshness: 'static', supports: ['方法说明'], skills: [] },
  { id: 'reference.list_guides', purpose: '列出已安装 Skill 的名称与用途', risk: 'read', identity: 'none', scope: '本地 Skill 文件', source: 'skill', freshness: 'static', supports: ['方法说明'], skills: [] },
];

let catalogCache: CapabilityDescriptor[] | undefined;
let catalogIndex: Map<string, CapabilityDescriptor> | undefined;

export function capabilityCatalog(): CapabilityDescriptor[] {
  // The catalog is derived from static tables; build it once per process.
  catalogCache ??= buildCatalog();
  return catalogCache;
}

function buildCatalog(): CapabilityDescriptor[] {
  return [
    ...Object.entries(generatedDwsCapabilities).map(([name, value]) => ({
      id: `dingtalk.${name}`, purpose: value.description, risk: value.risk,
      identity: 'dingtalk_user' as const, scope: '钉钉服务端按当前用户裁决', source: 'dws',
      freshness: 'live' as const, supports: ['当前用户可访问的钉钉事实或操作回执'], skills: ['dingtalk-office']
    })),
    ...[...ZINIAO_READ_CAPABILITIES].map((name) => ({
      id: `ziniao.${name}`, purpose: `以当前用户独立授权执行紫鸟 ${name}`, risk: 'read' as const,
      identity: 'dingtalk_user' as const, scope: '当前用户的紫鸟账号权限', source: 'ziniao',
      freshness: 'live' as const, supports: ['当前用户可访问的紫鸟事实'], skills: []
    })),
    ...fixed
  ].map((item) => ({ ...item, inputShape: inputShapeFor(item.source) }));
}

function inputShapeFor(source: string): string {
  switch (source) {
    case 'dws': return '{capability: ID, args?: string[]}；由 DWS 适配器验证当前用户 profile 与命令参数';
    case 'ziniao': return '{capability: ID, args?: string[]}；由紫鸟适配器验证当前用户授权';
    case 'crossborderops': return '{dataset: ID, params: object}；corpId/userId 由宿主注入，店铺范围由服务端计算';
    case 'sif': return '{toolId: ID, params: object}';
    case 'lingxing': return '{toolId: help|search, params: object}；仅工具目录';
    case 'internet': return '{query: string}';
    case 'amazon': return '{asin 或 keywords, marketplace: 站点代码}；以各 amazon 子工具的参数定义为准';
    case 'skill': return '{name: Skill 名称, subSkill?: 名称, reference?: 名称}';
    case 'artifact': return '{path: output 相对路径}；宿主校验文件哈希、类型与大小';
    case 'analysis': return '{code: Python 源码, purpose?: 说明}；读取 evidence/index.json 所列的结果文件计算';
    case 'image': return '{operation: generate|edit, prompt: string, inputAttachmentIds?: string[], provider?: string}';
    default: return '{arguments: object}；具体输入由宿主适配器校验';
  }
}

export function capabilityById(id: string): CapabilityDescriptor | undefined {
  // Reverse so the first descriptor for a duplicated ID wins, as with find().
  catalogIndex ??= new Map([...capabilityCatalog()].reverse().map((item) => [item.id, item]));
  return catalogIndex.get(id);
}
