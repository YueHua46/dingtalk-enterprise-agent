import { tableAnalysisTool } from './analysis-table.js';
export const ANALYSIS_CODE_MAX_CHARS = 20_000;
export const ANALYSIS_STDOUT_MAX_CHARS = 64_000;

export const analysisDynamicTools = [{
  type: 'namespace',
  name: 'analysis',
  description: '在当前任务的隔离沙箱中做可复核的精确计算。',
  tools: [tableAnalysisTool, {
    type: 'function',
    name: 'python',
    description: [
      '运行一段 Python 3 代码并返回 stdout。用于对业务查询结果做求和、均值、比率、环比、排序、筛选、分组等派生计算，或运行已安装 Skill 的分析脚本。',
      '每次业务查询成功后，宿主会把完整结果保存为 JSON 文件，路径见该查询返回的提示（如 evidence/03_crossborderops.daily.metrics.json，相对当前工作目录）；evidence/index.json 列出全部文件及对应的查询参数，不确定文件名时先读取它。用 json.load 读取这些文件计算，不要把数据手抄进代码。',
      '可用库：pandas、numpy、openpyxl、matplotlib（Agg）。无网络；工作目录为当前任务根目录；超时 120 秒。',
      '代码与输出会作为计算证据交给交付前核验，答复中的派生数值应与输出一致。用 print 输出你需要引用的结果。'
    ].join('\n'),
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        code: { type: 'string', minLength: 1, maxLength: ANALYSIS_CODE_MAX_CHARS },
        purpose: { type: 'string', maxLength: 200 }
      },
      required: ['code']
    }
  }]
}];

export interface AnalysisInput {
  code: string;
  purpose?: string;
}

export function parseAnalysisInput(input: unknown): AnalysisInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('ANALYSIS_ARGUMENTS_INVALID');
  const value = input as Record<string, unknown>;
  if (typeof value.code !== 'string' || !value.code.trim() || value.code.length > ANALYSIS_CODE_MAX_CHARS) throw new Error('ANALYSIS_CODE_INVALID');
  if (value.purpose !== undefined && (typeof value.purpose !== 'string' || value.purpose.length > 200)) throw new Error('ANALYSIS_PURPOSE_INVALID');
  return { code: value.code, ...(typeof value.purpose === 'string' && value.purpose.trim() ? { purpose: value.purpose.trim() } : {}) };
}
