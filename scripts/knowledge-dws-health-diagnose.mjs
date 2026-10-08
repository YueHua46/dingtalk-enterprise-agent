import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
const progress=JSON.parse(await readFile('output/knowledge-full-ingestion/progress.json','utf8'));
const user=progress.user;
if(user.corpId!=='ding5cc0e9161525554835c2f4657eb6378f'||user.userId!=='1769391205643357')throw new Error('DIAGNOSTIC_IDENTITY_MISMATCH');
const node=Object.entries(progress.resources).filter(([,r])=>r.text?.dwsReason==='tls_timeout').at(-1)?.[0];
if(!node)throw new Error('DIAGNOSTIC_SOURCE_REQUIRED');
const dws=new DwsBroker(loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws')}));
const report={checkedAt:new Date().toISOString(),node,modelCalls:0,exportsSubmitted:0};
const safe=v=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(v)?v:undefined;
try{
 report.authorized=!!await dws.status(user,{fresh:true});
 if(report.authorized){
  const started=Date.now();const result=await dws.runCommand(user,['doc','+inspect','--node',node],{background:true});
  const doc=result?.document??result?.data?.document;
  report.metadata={returned:!!doc,extension:safe(doc?.extension),elapsedMs:Date.now()-started};
 }
}catch(error){report.failure={code:safe(error.dwsCode),category:safe(error.dwsCategory),reason:safe(error.dwsReason)};}
await writeFile('output/knowledge-diagnostics/dws-health-live.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
