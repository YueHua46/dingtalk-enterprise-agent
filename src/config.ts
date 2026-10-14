import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.string().default('info'),
  DINGTALK_CLIENT_ID: z.string().min(1).optional(),
  DINGTALK_CLIENT_SECRET: z.string().min(1).optional(),
  DINGTALK_ROBOT_CODE: z.string().min(1),
  DINGTALK_API_BASE_URL: z.string().url().default('https://api.dingtalk.com'),
  // Stable DingTalk department ID to exclude from the Agent authorization picker.
  DINGTALK_DIRECTORY_FACTORY_DEPT_ID: z.coerce.number().int().positive().optional(),
  DINGTALK_CARD_TEMPLATE_ID: z.string().min(1).optional(),
  DINGTALK_CARD_VARIABLE: z.string().min(1).default('content'),
  DINGTALK_CARD_ACTIVITY_VARIABLE: z.string().min(1).optional(),
  DINGTALK_CARD_ACTIVITY_IN_PROCESSING: z.enum(['true', 'false']).default('false'),
  // DingTalk's A2UI card API is currently unavailable for this deployment.
  // The runtime transport is intentionally not wired into main.ts.
  DINGTALK_A2UI_ENABLED: z.enum(['true', 'false']).default('false'),
  DINGTALK_A2UI_CATALOG_ID: z.string().url().default('https://dingtalk.com/card/a2ui/catalogs/public/catalog.json'),
  DINGTALK_A2UI_MAX_MESSAGE_BYTES: z.coerce.number().int().positive().default(256 * 1024),
  DINGTALK_A2UI_MAX_COMPONENTS: z.coerce.number().int().positive().default(200),
  DINGTALK_A2UI_UPDATE_PATH: z.string().min(1).default('/v1.0/card/ai/instances'),
  // Interactive approval card (agree/reject buttons) for high-risk writes.
  DINGTALK_APPROVAL_CARD_TEMPLATE_ID: z.string().min(1).optional(),
  DINGTALK_APPROVAL_CARD_CONTENT_VAR: z.string().min(1).default('content'),
  DINGTALK_APPROVAL_CARD_STATUS_VAR: z.string().min(1).default('status'),
  DINGTALK_APPROVAL_CARD_TTL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  MODEL_PROVIDER: z.enum(['tokenshop', 'gemini']).default('tokenshop'),
  TOKENSHOP_MODEL_BASE_URL: z.preprocess((value) => value === '' ? undefined : value, z.string().url().optional()),
  TOKENSHOP_MODEL_API_KEY: z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional()),
  TOKENSHOP_MODEL_NAME: z.string().min(1).optional(),
  GEMINI_MODEL_BASE_URL: z.preprocess((value) => value === '' ? undefined : value, z.string().url().optional()),
  GEMINI_MODEL_API_KEY: z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional()),
  GEMINI_MODEL_NAME: z.string().min(1).optional(),
  // Only fills an omitted limit on this gateway's configured Gemini model.
  // 0 disables it; explicit request limits always win.
  GEMINI_RESPONSES_DEFAULT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(0).max(64000).default(32768),
  MODEL_BASE_URL: z.string().url().optional(),
  MODEL_TOOL_COMPAT_PROXY: z.enum(['true', 'false']).default('false'),
  MODEL_REQUEST_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(6),
  // Six total attempts means five retries. Keep enough wall-clock budget for
  // all attempts instead of allowing one hung upstream request to consume it.
  MODEL_REQUEST_RETRY_BUDGET_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(1_200_000),
  MODEL_REQUEST_ATTEMPT_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(300_000).default(180_000),
  // Per-attempt reviewer deadline. Transient failures share the model retry
  // budget instead of consuming a separate, shorter delivery deadline.
  MODEL_REVIEW_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(300_000).default(180_000),
  MODEL_REVIEW_PROVIDER: z.enum(['primary', 'tokenshop', 'gemini']).default('primary'),
  MODEL_REVIEW_BASE_URL: z.string().url().optional(),
  MODEL_REVIEW_API_KEY: z.string().min(1).optional(),
  MODEL_REVIEW_NAME: z.string().min(1).optional(),
  MODEL_API_KEY: z.string().min(1).optional(),
  MODEL_NAME: z.string().default('gpt-5.6-sol'),
  KNOWLEDGE_ENABLED: z.enum(['true', 'false']).default('false'),
  KNOWLEDGE_TEST_USERS: z.string().default(''),
  KNOWLEDGE_DATABASE_URL: z.preprocess(v=>v===''?undefined:v,z.string().url().optional()),
  KNOWLEDGE_WORKER_URL: z.preprocess(v=>v===''?undefined:v,z.string().url().optional()),
  KNOWLEDGE_CLAMAV_HOST: z.string().optional(),
  KNOWLEDGE_CLAMAV_PORT: z.coerce.number().int().positive().optional(),
  KNOWLEDGE_AUTO_SYNC: z.enum(['true','false']).default('true'),
  KNOWLEDGE_READY_ONLY: z.enum(['true','false']).default('false'),
  KNOWLEDGE_SHARED_INDEX_USERS: z.string().default('').refine(value=>!value.trim()||value.split(',').every(id=>/^[a-zA-Z0-9_-]{1,128}$/.test(id.trim())), 'requires comma-separated employee IDs'),
  KNOWLEDGE_DIR: z.string().default('./data/knowledge'),
  KNOWLEDGE_SYNC_INTERVAL_MS: z.coerce.number().int().min(60_000).default(900_000),
  // Task-local duplicate result reuse only; indexed content has no age cutoff.
  // Permission is still checked through the current employee's DWS identity.
  KNOWLEDGE_VERIFICATION_TTL_MS: z.coerce.number().int().min(30_000).max(15 * 60_000).default(5 * 60_000),
  KNOWLEDGE_QUERY_BUDGET_MS: z.coerce.number().int().min(5_000).max(120_000).default(60_000),
  // These are long-running task guardrails, not answer-generation deadlines.
  // A task may continue with progress/evidence after the first budget window;
  // the host must never replace a real result with a generic timeout answer.
  TASK_SIMPLE_QUERY_BUDGET_MS: z.coerce.number().int().min(60_000).max(900_000).default(300_000),
  TASK_GENERAL_QUERY_BUDGET_MS: z.coerce.number().int().min(120_000).max(1_800_000).default(900_000),
  QUERY_OPTIMIZATION_MODE: z.enum(['off', 'shadow', 'enforce']).default('shadow'),
  KNOWLEDGE_MAX_SOURCES: z.coerce.number().int().min(1).max(20).default(8),
  KNOWLEDGE_MAX_RETRIEVAL_ROUNDS: z.coerce.number().int().min(1).max(3).default(2),
  KNOWLEDGE_RERANK_MAX_DOCUMENTS: z.coerce.number().int().min(1).max(60).default(40),
  KNOWLEDGE_RERANK_MAX_BYTES: z.coerce.number().int().min(8_000).max(100_000).default(40_000),
  KNOWLEDGE_VISION_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(2),
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
  const provider = env.MODEL_PROVIDER || 'tokenshop';
  const selected = provider === 'gemini'
    ? {
        MODEL_BASE_URL: env.GEMINI_MODEL_BASE_URL,
        MODEL_API_KEY: env.GEMINI_MODEL_API_KEY || env.IMAGE_API_KEY,
        MODEL_NAME: env.GEMINI_MODEL_NAME || 'gemini-3.8-flash-high'
      }
    : {
        MODEL_BASE_URL: env.TOKENSHOP_MODEL_BASE_URL || env.MODEL_BASE_URL,
        MODEL_API_KEY: env.TOKENSHOP_MODEL_API_KEY || env.MODEL_API_KEY,
        MODEL_NAME: env.TOKENSHOP_MODEL_NAME || env.MODEL_NAME || 'gpt-5.6-sol'
      };
  const reviewProvider = env.MODEL_REVIEW_PROVIDER || 'primary';
  const review = reviewProvider === 'primary' ? selected : reviewProvider === 'gemini'
    ? {MODEL_BASE_URL: env.GEMINI_MODEL_BASE_URL, MODEL_API_KEY: env.GEMINI_MODEL_API_KEY || env.IMAGE_API_KEY,
       MODEL_NAME: env.GEMINI_MODEL_NAME || 'gemini-3.8-flash-high'}
    : {MODEL_BASE_URL: env.TOKENSHOP_MODEL_BASE_URL || env.MODEL_BASE_URL, MODEL_API_KEY: env.TOKENSHOP_MODEL_API_KEY || env.MODEL_API_KEY,
       MODEL_NAME: env.TOKENSHOP_MODEL_NAME || env.MODEL_NAME || 'gpt-5.6-sol'};
  if (reviewProvider !== 'primary' && (!review.MODEL_BASE_URL || !review.MODEL_API_KEY)) throw new Error('MODEL_REVIEW_PROVIDER requires its configured endpoint and key');
  const result = schema.safeParse({ ...env, MODEL_PROVIDER: provider, ...selected,
    MODEL_REVIEW_BASE_URL: review.MODEL_BASE_URL, MODEL_REVIEW_API_KEY: review.MODEL_API_KEY, MODEL_REVIEW_NAME: review.MODEL_NAME});
  if (!result.success) {
    const details = result.error.issues.map((issue) => issue.path.join('.') + ': ' + issue.message).join('; ');
    throw new Error('Invalid configuration: ' + details);
  }
  return result.data;
}
