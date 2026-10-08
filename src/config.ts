import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.string().default('info'),
  DINGTALK_CLIENT_ID: z.string().min(1).optional(),
  DINGTALK_CLIENT_SECRET: z.string().min(1).optional(),
  DINGTALK_ROBOT_CODE: z.string().min(1),
  // Stable DingTalk department ID to exclude from the Agent authorization picker.
  DINGTALK_DIRECTORY_FACTORY_DEPT_ID: z.coerce.number().int().positive().optional(),
  DINGTALK_CARD_TEMPLATE_ID: z.string().min(1).optional(),
  DINGTALK_A2UI_TASK_CARDS: z.enum(['true', 'false']).default('true'),
  DINGTALK_CARD_VARIABLE: z.string().min(1).default('content'),
  DINGTALK_CARD_ACTIVITY_VARIABLE: z.string().min(1).optional(),
  DINGTALK_CARD_ACTIVITY_IN_PROCESSING: z.enum(['true', 'false']).default('false'),
  // Interactive approval card (agree/reject buttons) for high-risk writes.
  DINGTALK_APPROVAL_CARD_TEMPLATE_ID: z.string().min(1).optional(),
  DINGTALK_APPROVAL_CARD_CONTENT_VAR: z.string().min(1).default('content'),
  DINGTALK_APPROVAL_CARD_STATUS_VAR: z.string().min(1).default('status'),
  DINGTALK_APPROVAL_CARD_TTL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  MODEL_BASE_URL: z.string().url().optional(),
  MODEL_TOOL_COMPAT_PROXY: z.enum(['true', 'false']).default('false'),
  MODEL_API_KEY: z.string().min(1).optional(),
  MODEL_NAME: z.string().default('gpt-5.6-sol'),
  KNOWLEDGE_ENABLED: z.enum(['true', 'false']).default('false'),
  KNOWLEDGE_TEST_USERS: z.string().default(''),
  KNOWLEDGE_DIR: z.string().default('./data/knowledge'),
  KNOWLEDGE_SYNC_INTERVAL_MS: z.coerce.number().int().min(60_000).default(900_000),
  KNOWLEDGE_VISION_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(50),
  KNOWLEDGE_MAX_SOURCE_BYTES:z.coerce.number().int().positive().max(256*1024*1024).default(256*1024*1024),
  EMBEDDING_BASE_URL: z.preprocess((v) => v === '' ? undefined : v, z.string().url().optional()),
  EMBEDDING_API_KEY: z.preprocess((v) => v === '' ? undefined : v, z.string().min(1).optional()),
  EMBEDDING_MODEL: z.string().default('qwen3.7-text-embedding'),
  RERANK_MODEL: z.preprocess((v) => v === '' ? undefined : v, z.string().min(1).optional()),
  EMBEDDING_DIMENSIONS: z.coerce.number().refine((v) => v === 1024, 'knowledge schema requires 1024 dimensions').default(1024),
  // Native image generation/editing channel. Kept separate from the text
  // Responses relay because Gemini's native generateContent protocol is not
  // the same wire contract as the Agent model.
  IMAGE_BASE_URL: z.preprocess((value) => value === '' ? undefined : value, z.string().url().optional()),
  IMAGE_API_KEY: z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional()),
  IMAGE_MODEL: z.string().default('gemini-3.1-flash-image'),
  IMAGE_PROVIDER: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/).default('gemini'),
  IMAGE_PROVIDERS_JSON: z.string().default(''),
  IMAGE_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  TASK_WORKFLOW_MODE: z.enum(['off', 'shadow', 'enforce']).default('shadow'),
  LINGXING_MCP_KEY: z.string().min(1).optional(),
  SIF_MCP_KEY: z.string().min(1).optional(),
  // CrossBorderOps server-to-server scope lookup for Amazon data access.
  CROSSBORDEROPS_API_URL: z.string().url().optional(),
  CROSSBORDEROPS_INTERNAL_TOKEN: z.string().min(32).optional(),
  CODEX_BIN: z.string().default('codex'),
  CODEX_WORKDIR: z.string().default('./workspaces'),
  FILE_WORKER_MODE: z.enum(['off', 'test', 'all']).default('all'),
  FILE_WORKER_URL: z.string().url().optional(),
  FILE_WORKER_SECRET: z.preprocess((value) => value === '' ? undefined : value, z.string().min(32).optional()),
  FILE_WORKER_TEST_SURFACES: z.string().default(''),
  FILE_WORKER_SKILLS_DIR: z.string().default('/opt/file-skills'),
  DWS_BIN: z.string().default('dws'),
  DWS_CONFIG_DIR: z.string().default('./data/dws'),
  // Exact hosts whose native DWS connections should bypass inherited proxies.
  DWS_NO_PROXY: z.string().default('').refine(value => !value.trim() || value.split(',').every(host => /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host.trim())), 'requires comma-separated hostnames'),
  ZINIAO_BIN: z.string().default('ziniao-cli'),
  ZINIAO_USERS_DIR: z.string().default('./data/ziniao/users'),
  ZINIAO_REMOTE_HOST: z.string().optional(),
  ZINIAO_REMOTE_USER: z.string().default('jennov'),
  ZINIAO_REMOTE_KEY_PATH: z.string().default('/home/agent/.ziniao-cli/ssh/id_ed25519'),
  ZINIAO_REMOTE_KNOWN_HOSTS_PATH: z.string().default('/home/agent/.ziniao-cli/ssh/known_hosts'),
  // Executor serialization: ziniao officially does not support concurrent CLI
  // usage, so all operations queue through one global FIFO gate.
  ZINIAO_GATE_DISABLED: z.enum(['true', 'false']).default('false'),
  ZINIAO_GATE_MAX_WAIT_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  ZINIAO_GATE_MAX_WAITERS: z.coerce.number().int().positive().default(20),
  ZINIAO_SESSION_IDLE_MS: z.coerce.number().int().positive().default(3 * 60 * 1000),
  ZINIAO_SESSION_MAX_MS: z.coerce.number().int().positive().default(30 * 60 * 1000),
  // Reserved: requires written confirmation from ziniao before enabling.
  ZINIAO_INTERLEAVE_READS: z.enum(['true', 'false']).default('false'),
  DWS_BOT_PROFILE: z.string().min(1).optional(),
  DINGTALK_STREAMING_CARDS: z.enum(['true', 'false']).default('true'),
  SKILLS_DIR: z.string().default('./skills'),
  DATABASE_URL: z.string().default('postgres://agent:agent@localhost:5432/agent'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  TASK_QUEUE_NAME: z.string().min(1).default('dingtalk-agent-tasks'),
  MEDIA_DIR: z.string().default('./data/media'),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  INTERNAL_API_TOKEN: z.string().min(32).optional(),
  TASK_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  MAX_CONCURRENT_USERS: z.coerce.number().int().positive().default(30),
  MEDIA_MAX_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024)
}).superRefine((value, context) => {
  if (value.FILE_WORKER_MODE !== 'off' && (!value.FILE_WORKER_URL || !value.FILE_WORKER_SECRET || value.MODEL_TOOL_COMPAT_PROXY !== 'true')) {
    context.addIssue({ code: 'custom', path: ['FILE_WORKER_MODE'], message: 'worker requires URL, secret and model compatibility proxy' });
  }
  if (value.DINGTALK_CARD_ACTIVITY_VARIABLE === value.DINGTALK_CARD_VARIABLE) {
    context.addIssue({ code: 'custom', path: ['DINGTALK_CARD_ACTIVITY_VARIABLE'], message: 'must differ from answer variable' });
  }
  if (value.NODE_ENV !== 'production') return;
  for (const key of [
    'DINGTALK_CLIENT_ID',
    'DINGTALK_CLIENT_SECRET',
    'DWS_BOT_PROFILE',
    'MODEL_BASE_URL',
    'MODEL_API_KEY',
    'CLAMAV_HOST',
    'INTERNAL_API_TOKEN'
  ] as const) {
    if (!value[key]) context.addIssue({ code: 'custom', path: [key], message: 'required in production' });
  }
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues.map((issue) => issue.path.join('.') + ': ' + issue.message).join('; ');
    throw new Error('Invalid configuration: ' + details);
  }
  return result.data;
}
