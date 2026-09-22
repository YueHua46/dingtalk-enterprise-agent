import { readFile } from 'node:fs/promises';

const path = process.argv[2] || '.env';
const text = await readFile(path, 'utf8');
const env = new Map();
for (const raw of text.split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const index = line.indexOf('=');
  if (index < 1) throw new Error('Invalid .env line (key only): ' + line.slice(0, 30));
  const key = line.slice(0, index).trim();
  let value = line.slice(index + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  env.set(key, value);
}

const required = [
  'DINGTALK_CLIENT_ID', 'DINGTALK_CLIENT_SECRET', 'DINGTALK_ROBOT_CODE',
  'MODEL_BASE_URL', 'MODEL_API_KEY', 'MODEL_NAME', 'DWS_BOT_PROFILE',
  'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'INTERNAL_API_TOKEN'
];
const issues = [];
for (const key of required) {
  const value = env.get(key);
  if (!value || /^(change-me|pending|todo|replace-me|<.*>)$/i.test(value)) issues.push(key + ' is missing or placeholder');
}
if (env.get('AGENT_ENV_FILE') !== '.env') issues.push('AGENT_ENV_FILE must be .env');
if (env.get('NODE_ENV') !== 'production') issues.push('NODE_ENV must be production');
if ((env.get('INTERNAL_API_TOKEN') || '').length < 32) issues.push('INTERNAL_API_TOKEN must contain at least 32 characters');
if ((env.get('POSTGRES_PASSWORD') || '').length < 24) issues.push('POSTGRES_PASSWORD should contain at least 24 characters');
try {
  const url = new URL(env.get('MODEL_BASE_URL') || '');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) issues.push('MODEL_BASE_URL must use HTTPS outside localhost');
  if (/\/responses\/?$/.test(url.pathname)) issues.push('MODEL_BASE_URL must be the base URL, not the /responses endpoint');
} catch {
  issues.push('MODEL_BASE_URL is not a valid URL');
}

if (issues.length) {
  console.error(JSON.stringify({ ok: false, issueCount: issues.length, issues }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, configuredKeys: required.length, secretsPrinted: false }));
}
