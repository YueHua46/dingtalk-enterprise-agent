import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve, dirname, basename } from 'node:path';
const root = '/tmp/listing-worker-smoke-' + randomUUID();
const container = 'dingtalk-enterprise-agent-file-worker-1';
const run = (...args) => execFileSync('docker', ['exec', container, ...args], { encoding: 'utf8', maxBuffer: 200000 });
async function stage(source, target) {
  const encoded = (await readFile(source)).toString('base64');
  for (let i = 0; i < encoded.length; i += 12000) run('node', '-e', `require('fs').appendFileSync('${root}/${target}',Buffer.from('${encoded.slice(i, i + 12000)}','base64'))`);
}
const visited = new Set();
async function module(path) {
  path = resolve(path); if (visited.has(path)) return; visited.add(path);
  const code = await readFile(path, 'utf8'); await stage(path, basename(path));
  for (const match of code.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g)) await module(resolve(dirname(path), match[1]));
}
run('node', '-e', `const fs=require('fs');fs.mkdirSync('${root}');fs.symlinkSync('/app/node_modules','${root}/node_modules');fs.writeFileSync('${root}/package.json','{"type":"module"}')`);
try {
  await module('dist/file-worker-server.js'); await stage('file-skills/listing_export.py', 'listing_export.py'); await stage('output/listing/export/payload.json', 'payload.json');
  const code = `import fs from 'node:fs';import {spawn} from 'node:child_process';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const root='${root}',secret='test-only-'+Date.now()+'-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const child=spawn(process.execPath,[root+'/file-worker-server.js'],{env:{PATH:process.env.PATH,FILE_WORKER_SECRET:secret,FILE_WORKER_ROOT:root+'/tasks',FILE_SKILLS_DIR:root,FILE_WORKER_PORT:'18979',WORKER_MODEL_PROXY_URL:'http://127.0.0.1:1'},stdio:'ignore'});
const url='http://127.0.0.1:18979',headers={'x-file-worker-secret':secret,'content-type':'application/json'};
try{let ready=false;for(let i=0;i<100;i++){try{const r=await fetch(url+'/healthz');if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'WORKER_NOT_READY');
assert.equal((await fetch(url+'/tasks/00000000-0000-4000-8000-000000000009',{method:'POST'})).status,401);
assert.ok((await fetch(url+'/tasks/00000000-0000-4000-8000-000000000009',{method:'POST',headers})).ok);
const endpoint=url+'/tasks/00000000-0000-4000-8000-000000000009/listing-export';
assert.equal((await fetch(endpoint,{method:'POST',headers,body:'{"versionId":"bad"}'})).status,400);
const payload=fs.readFileSync(root+'/payload.json','utf8');const first=await fetch(endpoint,{method:'POST',headers,body:payload});assert.ok(first.ok,await first.clone().text());const files=await first.json();
assert.deepEqual(await (await fetch(endpoint,{method:'POST',headers,body:payload})).json(),files);
const results=[];for(const [type,path] of Object.entries(files)){const r=await fetch(url+'/tasks/00000000-0000-4000-8000-000000000009/outputs/inspect',{method:'POST',headers,body:JSON.stringify({path})});assert.ok(r.ok,await r.clone().text());const meta=await r.json();const bytes=Buffer.from(await(await fetch(url+'/tasks/00000000-0000-4000-8000-000000000009/outputs/'+encodeURIComponent(meta.name),{headers})).arrayBuffer());assert.ok(bytes.length>1000);assert.equal(createHash('sha256').update(bytes).digest('hex'),meta.sha256);results.push({type,size:bytes.length,sha256:meta.sha256});}
console.log(JSON.stringify({isolatedWorkerHttp:true,authorizationChecked:true,schemaChecked:true,repeatExportStable:true,inspectAndDownloadVerified:true,results,noModelOrDwsCalls:true}));
}finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}`;
  const result = JSON.parse(run('node', '--input-type=module', '-e', code));
  await writeFile('output/listing/export/worker-results.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { run('node', '-e', `require('fs').rmSync('${root}',{recursive:true,force:true})`); }


