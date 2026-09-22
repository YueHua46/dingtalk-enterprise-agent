import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.string().default('info'),
  DINGTALK_CLIENT_ID: z.string().min(1).optional(),
  DINGTALK_CLIENT_SECRET: z.string().min(1).optional(),
  DINGTALK_ROBOT_CODE: z.string().min(1),
  DINGTALK_CARD_TEMPLATE_ID: z.string().min(1).optional(),
  DINGTALK_CARD_VARIABLE: z.string().min(1).default('content'),
  DINGTALK_CARD_ACTIVITY_VARIABLE: z.string().min(1).optional(),
  DINGTALK_CARD_ACTIVITY_IN_PROCESSING: z.enum(['true', 'false']).default('false'),
  MODEL_BASE_URL: z.string().url().optional(),
  MODEL_TOOL_COMPAT_PROXY: z.enum(['true', 'false']).default('false'),
  MODEL_API_KEY: z.string().min(1).optional(),
  MODEL_NAME: z.string().default('gpt-5.6-sol'),
  CODEX_BIN: z.string().default('codex'),
  CODEX_WORKDIR: z.string().default('./workspaces'),
  DWS_BIN: z.string().default('dws'),
  DWS_CONFIG_DIR: z.string().default('./data/dws'),
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
