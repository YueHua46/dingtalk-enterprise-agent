import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

const exec = promisify(execFile);
const profile = process.argv[2];
const group = process.argv[3];
const bot = process.argv[4];
if (!profile || !group || !bot) throw new Error('Usage: node scripts/advertising-dingtalk-e2e.mjs <profile> <group> <bot>');
if (!/^[A-Za-z0-9_-]{1,128}:[A-Za-z0-9_-]{1,128}$/.test(profile)) throw new Error('EXPLICIT_EMPLOYEE_PROFILE_REQUIRED');

const cli = join(process.env.APPDATA, 'npm/node_modules/dingtalk-workspace-cli/bin/dws.js');
const uuid = randomUUID();
const startedAt = new Date().toISOString();
const question = process.argv[5] ? (await readFile(process.argv[5], 'utf8')).replace(/^\uFEFF/, '').trim()
  : '分析日本站最近 7 天的整体广告表现，找出存在问题的广告活动。请提供 PDF 报告，不要修改广告。';
const outputDir = 'output/advertising-e2e';
await mkdir(outputDir, { recursive: true });
const dws = async (args) => JSON.parse((await exec(process.execPath, [cli, '--profile', profile, ...args, '--format', 'json'], { maxBuffer: 12_000_000, timeout: 90_000 })).stdout);
const sanitize = (value) => Array.isArray(value) ? value.map(sanitize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !/token|secret|signature|downloadurl|resourceurl/i.test(key)).map(([key, item]) => [key, sanitize(item)]))
  : typeof value === 'string' && /OSSAccessKeyId=|Signature=/.test(value) ? '[temporary resource URL omitted]' : value;

const text = `<@${bot}> ${question}`;
const sent = await dws(['chat', '+messages-send', '--identity', 'user', '--group', group, '--at-open-dingtalk-ids', bot, '--text', text, '--uuid', uuid, '--yes']);
await writeFile(`${outputDir}/send-${uuid}.json`, JSON.stringify({ startedAt, uuid, group, result: sanitize(sent) }, null, 2));
console.log(JSON.stringify({ sent: true, uuid, startedAt, group, question }));

let latest = [], task;
const sqlString = value => "'" + value.replaceAll("'", "''") + "'";
for (let poll = 1; poll <= 60; poll += 1) {
  await new Promise((resolve) => setTimeout(resolve, 20_000));
  const sql = `SELECT json_build_object('id',id,'status',status,'started_at',started_at,'finished_at',finished_at,'answer',result_summary) FROM tasks WHERE created_at >= ${sqlString(startedAt)}::timestamptz AND request_payload->>'text'=${sqlString(question)} AND request_payload->'user'->>'userId'=${sqlString(profile.split(':')[1])} ORDER BY created_at DESC LIMIT 1`;
  const raw = (await exec('docker', ['exec','dingtalk-enterprise-agent-postgres-1','psql','-U','agent','-d','agent','-At','-c',sql], {maxBuffer: 2_000_000})).stdout.trim();
  task = raw ? JSON.parse(raw) : undefined;
  console.log(JSON.stringify({poll, taskId:task?.id, status:task?.status, elapsedSeconds:Math.round((Date.now()-Date.parse(startedAt))/1000)}));
  if (task && ['completed','failed','cancelled'].includes(task.status)) break;
}

const messages = await dws(['chat', '+chat-messages', '--group', group, '--start', startedAt, '--page-all', '--page-limit', '5', '--max-items', '100', '--no-reactions']);
latest = messages.messages ?? messages.data?.messages ?? [];
await writeFile(`${outputDir}/messages-${uuid}.json`, JSON.stringify(sanitize(messages), null, 2));

const robot = latest.filter((message) => message.senderId === bot && message.text && message.text !== '[互动卡片]');
const answer = task?.answer ?? '';
await writeFile(`${outputDir}/result-${uuid}.json`, JSON.stringify({ uuid, startedAt, group, bot, task, answer, robotMessages: robot.length }, null, 2));
console.log(JSON.stringify({ completed: task?.status==='completed', uuid, taskId:task?.id, robotMessages:robot.length, answerChars: answer.length, answerPreview: answer.slice(0, 1500) }));
if (task?.status!=='completed') process.exitCode = 1;
