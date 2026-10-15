// Run inside the file-worker image as root with Compose's capability/seccomp
// restrictions. Synthetic data only; no model, DingTalk or business requests.
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const root=process.env.DOCUMENT_SMOKE_OUTPUT ?? '/tmp/document-worker-smoke';
await mkdir(root,{recursive:true,mode:0o711});
for (const enabled of [true,false]) {
  const secret=randomUUID(),port=18081,logs=[];
  const server=spawn(process.execPath,['dist/file-worker-server.js'],{env:{...process.env,
    FILE_WORKER_ROOT:root,FILE_WORKER_SECRET:secret,FILE_WORKER_PORT:String(port),
    WORKER_MODEL_PROXY_URL:'http://127.0.0.1:1/unused',DOCUMENT_PDF_ENABLED:String(enabled)},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',b=>logs.push(b.toString()));server.stderr.on('data',b=>logs.push(b.toString()));
  const base=`http://127.0.0.1:${port}`;
  const post=async(path,payload,auth=secret)=>{
    const response=await fetch(base+path,{method:'POST',headers:{'x-file-worker-secret':auth,'content-type':'application/json'},body:JSON.stringify(payload)});
    return {status:response.status,body:await response.json()};
  };
  try {
    let ready=false;
    for(let i=0;i<100;i++) {
      if(server.exitCode!==null)throw new Error(logs.join(''));
      try {ready=(await fetch(base+'/healthz')).ok;}catch{}
      if(ready)break;
      await new Promise(r=>setTimeout(r,100));
    }
    assert(ready,'worker did not start');
    const id=randomUUID();
    assert.equal((await post(`/tasks/${id}`,{},'invalid')).status,401);
    const task=await post(`/tasks/${id}`,{});assert.equal(task.status,200,JSON.stringify(task));
    const payload={format:'pdf',document:{title:'广告观察 · 日本 / Deutschland',blocks:[
      {id:'answer',type:'summary',text:'Synthetic smoke: current delivery, multilingual fonts and task ownership.'}
    ]}};
    const rendered=await post(`/tasks/${id}/document-render`,payload);
    if(!enabled) {assert.match(JSON.stringify(rendered.body),/DOCUMENT_PDF_DISABLED/);continue;}
    assert.equal(rendered.status,200,JSON.stringify(rendered));
    assert.equal(rendered.body.pageCount,1);
    assert.equal(rendered.body.previews.length,1);
    const inspected=await post(`/tasks/${id}/outputs/inspect`,{path:rendered.body.path});
    assert.equal(inspected.status,200,JSON.stringify(inspected));
    assert.match(inspected.body.reviewText,/Synthetic smoke/);
    assert.match(inspected.body.sha256,/^[a-f0-9]{64}$/);
    const file=await stat(join(task.body.outputDir,rendered.body.path));
    assert(file.uid!==0,'PDF must belong to task uid');
    const png=await readFile(join(task.body.outputDir,rendered.body.previews[0]));
    assert.equal(png.subarray(1,4).toString(),'PNG');
    const invalid=await post(`/tasks/${id}/document-render`,{...payload,html:'<script>unsafe</script>'});
    assert.notEqual(invalid.status,200,'raw HTML must be rejected');
    console.log(JSON.stringify({enabled,taskUid:file.uid,pageCount:rendered.body.pageCount,sha256:inspected.body.sha256,path:join(task.body.outputDir,rendered.body.path)}));
  } finally {
    server.kill('SIGTERM');
    await new Promise(resolve=>{if(server.exitCode!==null)resolve();else server.once('exit',resolve);});
  }
}
console.log('Worker HTTP rendering, authentication, task ownership, readback and disable switch passed.');
