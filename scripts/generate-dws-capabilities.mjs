import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);
const services = ['aisearch', 'doc', 'wiki', 'drive', 'calendar', 'todo', 'contact', 'chat', 'oa', 'mail', 'minutes', 'aitable', 'sheet', 'report'];
const capabilities = {};

for (const service of services) {
  const result = await runDws(['shortcut', 'list', '--service', service, '--format', 'json']);
  const body = JSON.parse(result.stdout);
  for (const item of body.shortcuts ?? []) {
    if (item.availability && item.availability !== 'available') continue;
    const operation = String(item.command).replace(/^\+/, '');
    capabilities[service + '.' + operation] = {
      service,
      command: [String(item.command)],
      risk: normalizeRisk(item.risk),
      description: String(item.description ?? item.intent ?? service + ' ' + item.command)
    };
  }
}

const extras = {
  'contact.user.get-self': ['contact', ['user', 'get-self'], 'read'],
  'contact.user.get': ['contact', ['user', 'get'], 'read'],
  'contact.user.search-mobile': ['contact', ['user', 'search-mobile'], 'read'],
  'contact.dept.search': ['contact', ['dept', 'search'], 'read'],
  'contact.dept.list-children': ['contact', ['dept', 'list-children'], 'read'],
  'contact.dept.list-members': ['contact', ['dept', 'list-members'], 'read'],
  'contact.dept.get-info': ['contact', ['dept', 'get-info'], 'read'],
  'contact.label.list': ['contact', ['label', 'list'], 'read'],
  'contact.label.get': ['contact', ['label', 'get'], 'read'],
  'contact.label.list-members': ['contact', ['label', 'list-members'], 'read'],
  'aisearch.person': ['aisearch', ['person'], 'read'],
  'calendar.event.list': ['calendar', ['event', 'list'], 'read'],
  'calendar.event.get': ['calendar', ['event', 'get'], 'read'],
  'calendar.event.create': ['calendar', ['event', 'create'], 'write'],
  'calendar.event.update': ['calendar', ['event', 'update'], 'write'],
  'calendar.event.delete': ['calendar', ['event', 'delete'], 'high'],
  'calendar.busy.search': ['calendar', ['busy', 'search'], 'read'],
  'calendar.attendee.list': ['calendar', ['attendee', 'list'], 'read'],
  'calendar.attendee.add': ['calendar', ['attendee', 'add'], 'write'],
  'calendar.attendee.delete': ['calendar', ['attendee', 'delete'], 'write'],
  'calendar.room.search': ['calendar', ['room', 'search'], 'read'],
  'calendar.room.add': ['calendar', ['room', 'add'], 'write'],
  'calendar.room.delete': ['calendar', ['room', 'delete'], 'write'],
  'todo.task.create': ['todo', ['task', 'create'], 'write'],
  'todo.task.get': ['todo', ['task', 'get'], 'read'],
  'todo.task.list': ['todo', ['task', 'list'], 'read'],
  'todo.task.update': ['todo', ['task', 'update'], 'write'],
  'todo.task.done': ['todo', ['task', 'done'], 'write'],
  'todo.task.delete': ['todo', ['task', 'delete'], 'high'],
  'mail.mailbox.list': ['mail', ['mailbox', 'list'], 'read'],
  'mail.user.search': ['mail', ['user', 'search'], 'read'],
  'mail.message.list': ['mail', ['message', 'list'], 'read'],
  'mail.message.search': ['mail', ['message', 'search'], 'read'],
  'mail.message.get': ['mail', ['message', 'get'], 'read'],
  'mail.message.send': ['mail', ['message', 'send'], 'write'],
  'mail.message.verify': ['mail', ['message', 'verify'], 'read'],
  'mail.message.reply': ['mail', ['message', 'reply'], 'write'],
  'mail.message.reply-all': ['mail', ['message', 'reply-all'], 'write'],
  'mail.message.forward': ['mail', ['message', 'forward'], 'write'],
  'mail.attachment.list': ['mail', ['attachment', 'list'], 'read'],
  'mail.attachment.download': ['mail', ['attachment', 'download'], 'read'],
  'oa.approval.list-pending': ['oa', ['approval', 'list-pending'], 'read'],
  'oa.approval.list-cc': ['oa', ['approval', 'list-cc'], 'read'],
  'oa.approval.list-submitted': ['oa', ['approval', 'list-submitted'], 'read'],
  'oa.approval.list-initiated': ['oa', ['approval', 'list-initiated'], 'read'],
  'oa.approval.list-executed': ['oa', ['approval', 'list-executed'], 'read'],
  'oa.approval.list-by-admin': ['oa', ['approval', 'list-by-admin'], 'read'],
  'oa.approval.detail': ['oa', ['approval', 'detail'], 'read'],
  'oa.approval.tasks': ['oa', ['approval', 'tasks'], 'read'],
  'oa.approval.records': ['oa', ['approval', 'records'], 'read'],
  'oa.approval.list-forms': ['oa', ['approval', 'list-forms'], 'read'],
  'oa.approval.form-schema': ['oa', ['approval', 'form-schema'], 'read'],
  'oa.approval.approve': ['oa', ['approval', 'approve'], 'high'],
  'oa.approval.reject': ['oa', ['approval', 'reject'], 'high'],
  'oa.approval.redirect-task': ['oa', ['approval', 'redirect-task'], 'high'],
  'oa.approval.revoke': ['oa', ['approval', 'revoke'], 'high'],
  'oa.approval.oa-comments': ['oa', ['approval', 'oa-comments'], 'write'],
  'oa.approval.oa-cc-noticer': ['oa', ['approval', 'oa-cc-noticer'], 'write'],
  'report.template.list': ['report', ['template', 'list'], 'read'],
  'report.template.get': ['report', ['template', 'get'], 'read'],
  'report.entry.get': ['report', ['entry', 'get'], 'read'],
  'report.entry.stats': ['report', ['entry', 'stats'], 'read'],
  'report.entry.submit': ['report', ['entry', 'submit'], 'write'],
  'sheet.create': ['sheet', ['create'], 'write'],
  'sheet.create-with-data': ['sheet', ['create-with-data'], 'write'],
  'sheet.csv-get': ['sheet', ['csv-get'], 'read'],
  'sheet.csv-put': ['sheet', ['csv-put'], 'write'],
  'sheet.range.update': ['sheet', ['range', 'update'], 'write'],
  'sheet.append': ['sheet', ['append'], 'write'],
  'sheet.info': ['sheet', ['info'], 'read'],
  'sheet.export': ['sheet', ['export'], 'read'],
  'sheet.export-csv': ['sheet', ['export-csv'], 'read'],
  'sheet.import.create': ['sheet', ['import', 'create'], 'write'],
  'aitable.record.create': ['aitable', ['record', 'create'], 'write'],
  'aitable.field.list': ['aitable', ['field', 'list'], 'read'],
  'aitable.view.create': ['aitable', ['view', 'create'], 'write'],
  'aitable.dashboard.create': ['aitable', ['dashboard', 'create'], 'write']
};

for (const [name, [service, command, risk]] of Object.entries(extras)) {
  capabilities[name] = { service, command, risk, description: name };
}

const output = `// Generated from dingtalk-workspace-cli. Run npm run generate:dws-capabilities after upgrading DWS.\n` +
  `export type GeneratedDwsRisk = 'read' | 'write' | 'high';\n` +
  `export interface GeneratedDwsCapability { service: string; command: readonly string[]; risk: GeneratedDwsRisk; description: string }\n` +
  `export const generatedDwsCapabilities = ${JSON.stringify(sortObject(capabilities), null, 2)} as const satisfies Record<string, GeneratedDwsCapability>;\n`;

await writeFile(new URL('../src/generated-dws-capabilities.ts', import.meta.url), output, 'utf8');
console.log('Generated ' + Object.keys(capabilities).length + ' DWS capabilities.');

function normalizeRisk(value) {
  return String(value).includes('high') ? 'high' : value === 'read' ? 'read' : 'write';
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

async function runDws(args) {
  let file = process.env.DWS_BIN || 'dws';
  let prefix = [];
  if (process.platform === 'win32' && file === 'dws') {
    const script = process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules', 'dingtalk-workspace-cli', 'bin', 'dws.js') : '';
    if (script && existsSync(script)) {
      file = process.execPath;
      prefix = [script];
    }
  }
  return execFileAsync(file, [...prefix, ...args], { maxBuffer: 8 * 1024 * 1024, windowsHide: true });
}
