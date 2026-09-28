import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>远程中文剪贴板</title>
<style>body{font:16px system-ui;max-width:540px;margin:48px auto;padding:0 20px}textarea{box-sizing:border-box;width:100%;height:110px;font:18px system-ui}button{margin-top:12px;padding:10px 18px;font:16px system-ui}</style>
<h2>发送中文到 jennov-75 剪贴板</h2><p>在下面粘贴公司名，点击发送；回到紫鸟公司名输入框按 Ctrl+V。此页不保存输入内容。</p>
<textarea id="value" autocomplete="off"></textarea><br><button id="send">发送到远程剪贴板</button><p id="status"></p>
<script>document.getElementById('send').onclick=async()=>{const value=document.getElementById('value').value;const response=await fetch('/clipboard',{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:value});document.getElementById('status').textContent=response.ok?'已发送。现在回到紫鸟输入框按 Ctrl+V。':'发送失败。';};</script></html>`;

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return response.end(page);
  }
  if (request.method !== 'POST' || request.url !== '/clipboard' ||
      request.headers.origin !== 'http://127.0.0.1:6083' ||
      !String(request.headers['content-type']).startsWith('text/plain')) {
    response.writeHead(403); return response.end();
  }
  let value = '';
  for await (const chunk of request) {
    value += String(chunk);
    if (Buffer.byteLength(value) > 512) { response.writeHead(413); return response.end(); }
  }
  const child = spawn('/usr/bin/xclip', ['-selection', 'clipboard', '-in'], {
    env: { ...process.env, DISPLAY: ':99' }, stdio: ['pipe', 'ignore', 'ignore']
  });
  child.stdin.end(value, 'utf8');
  child.once('error', () => { if (!response.headersSent) { response.writeHead(500); response.end(); } });
  child.once('close', (code) => {
    if (response.headersSent) return;
    response.writeHead(code === 0 ? 204 : 500, { 'Cache-Control': 'no-store' });
    response.end();
  });
});
server.listen(6083, '127.0.0.1');
