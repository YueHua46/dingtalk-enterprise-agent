import { spawn } from 'node:child_process';

const child = spawn(process.env.CODEX_BIN || 'codex', ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
let nextId = 1;
const pending = new Map();
let buffer = '';
function call(method, params) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
child.stdout.on('data', (chunk) => {
  buffer += String(chunk);
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.id && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    }
  }
});
child.stderr.on('data', (chunk) => process.stderr.write(String(chunk)));
try {
  const init = await call('initialize', {
    clientInfo: { name: 'thread-smoke', version: '0.1.0' },
    capabilities: { experimentalApi: true }
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }) + '\n');
  const thread = await call('thread/start', {
    cwd: process.cwd(),
    approvalPolicy: 'on-request',
    sandbox: 'workspace-write',
    dynamicTools: [{
      type: 'function',
      name: 'dws_call',
      description: 'Call an allowlisted DWS operation',
      inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }
    }]
  });
  console.log(JSON.stringify({ init, threadId: thread?.thread?.id || null }));
} finally {
  child.kill();
}
