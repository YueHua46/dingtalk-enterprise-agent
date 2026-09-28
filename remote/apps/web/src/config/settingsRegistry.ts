import type { ReactNode } from 'react';
import { ApiOutlined, BellOutlined, CloudServerOutlined, DatabaseOutlined, NodeIndexOutlined, SafetyOutlined, UserOutlined } from '@ant-design/icons';
import { createElement } from 'react';

/** 设置中心一级分类；新增设置只需在此注册并添加路由 */
export type SettingsSectionMeta = {
  id: string;
  /** 相对 /settings 的路径段，如 llm → /settings/llm */
  path: string;
  label: string;
  description: string;
  icon: ReactNode;
  group: string;
  available: boolean;
  comingSoonLabel?: string;
};

export const SETTINGS_GROUPS = ['AI 与自动化', '系统'] as const;

/** 侧栏 AI 模型二级项（设置首页展开时用；进入 llm 页后由页面注入带 badge 的项） */
export const LLM_SIDEBAR_SUBNAV = [
  { key: 'overview', label: '概览' },
  { key: 'modules', label: '业务模块' },
  { key: 'providers', label: '供应商档案' },
] as const;

/** 侧栏通知与告警二级项 */
export const NOTIFICATION_SIDEBAR_SUBNAV = [
  { key: 'overview', label: '概览' },
  { key: 'config', label: '钉钉配置' },
  { key: 'test', label: '发送测试' },
] as const;

export type NotificationNavKey = (typeof NOTIFICATION_SIDEBAR_SUBNAV)[number]['key'];

export const SETTINGS_SECTIONS: SettingsSectionMeta[] = [
  {
    id: 'llm',
    path: 'llm',
    label: 'AI 模型',
    description: '供应商档案、业务模块绑定、代理与连通性测试',
    icon: createElement(CloudServerOutlined),
    group: 'AI 与自动化',
    available: true,
  },
  {
    id: 'notifications',
    path: 'notifications',
    label: '通知与告警',
    description: '钉钉互动卡片、差评分析手动推送与连通性测试',
    icon: createElement(BellOutlined),
    group: 'AI 与自动化',
    available: true,
  },
  {
    id: 'rag',
    path: 'rag',
    label: 'RAG 运行配置',
    description: 'Embedding、Reranker 与外部模型中转站配置',
    icon: createElement(NodeIndexOutlined),
    group: 'AI 与自动化',
    available: true,
  },
  {
    id: 'mcp',
    path: 'mcp',
    label: 'MCP 服务',
    description: '配置可供 LangGraph Agent 自动或手动调用的 MCP 服务与工具',
    icon: createElement(ApiOutlined),
    group: 'AI 与自动化',
    available: true,
  },
  {
    id: 'user',
    path: 'user/profile',
    label: '用户',
    description: '修改展示名、头像与登录密码',
    icon: createElement(UserOutlined),
    group: '系统',
    available: true,
  },
  {
    id: 'integrations',
    path: 'integrations',
    label: '外部集成',
    description: 'SerpApi、领星、SIF、竞品数据源等 API 连接',
    icon: createElement(ApiOutlined),
    group: '系统',
    available: true,
  },
  {
    id: 'agent-access',
    path: 'agent-access',
    label: 'Agent 数据授权',
    description: '配置钉钉用户到后台账号或店铺的数据范围映射',
    icon: createElement(SafetyOutlined),
    group: '系统',
    available: true,
  },
  {
    id: 'database',
    path: 'database',
    label: '数据与存储',
    description: 'PostgreSQL、备份与迁移',
    icon: createElement(DatabaseOutlined),
    group: '系统',
    available: false,
    comingSoonLabel: '即将推出',
  },
];

export function getSettingsSectionByPath(pathname: string): SettingsSectionMeta | undefined {
  const rest = pathname.replace(/^\/settings\/?/, '');
  const seg = rest.split('/')[0];
  if (!seg) return undefined;
  if (seg === 'user') return SETTINGS_SECTIONS.find((s) => s.id === 'user');
  return SETTINGS_SECTIONS.find((s) => s.path === seg);
}

export function isSettingsHub(pathname: string): boolean {
  const p = pathname.replace(/\/$/, '');
  return p === '/settings';
}
