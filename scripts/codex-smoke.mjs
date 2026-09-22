import { spawn } from 'node:child_process';

const child = spawn(process.env.CODEX_BIN || 'codex', ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '';
let gotResponse = false;
const timer = setTimeout(() => child.kill(), 5000);
child.stdout.on('data', (chunk) => {
  buffer += String(chunk);
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    console.log(line);
    try {
      const message = JSON.parse(line);
      if (message.id === 1) {
        gotResponse = true;
        clearTimeout(timer);
        child.kill();
      }
    } catch {
      // Ignore non-JSON diagnostics on stdout.
    }
  }
});
child.stderr.on('data', (chunk) => process.stderr.write(String(chunk)));
child.stdin.write(JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { clientInfo: { name: 'dingtalk-enterprise-agent-smoke', version: '0.1.0' } }
}) + '\n');
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }) + '\n');
child.on('exit', (code, signal) => {
  clearTimeout(timer);
  if (!gotResponse) console.error('Codex App Server produced no JSON response');
  process.exitCode = gotResponse && (code === 0 || signal === 'SIGTERM') ? 0 : 1;
});
