// Read existing jobs only. Never submit or download an export here.
import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {readFile,writeFile} from 'node:fs/promises';
const progress=JSON.parse(await readFile('output/knowledge-full-ingestion/progress.json','utf8'));
const user=progress.user;
if(user.corpId!=='ding5cc0e9161525554835c2f4657eb6378f'||user.userId!=='1769391205643357')throw new Error('DIAGNOSTIC_IDENTITY_MISMATCH');
const dws=new DwsBroker(loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws')}));
const report=[];
function shape(value,depth=0){
 if(value===null)return 'null';if(Array.isArray(value))return 'array';
 if(typeof value!=='object'||depth>=4)return typeof value;
 return Object.fromEntries(Object.entries(value).filter(([key])=>/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)).map(([key,v])=>[key,shape(v,depth+1)]));
}
if(!await dws.status(user,{fresh:true}))throw new Error('DWS_OAUTH_REQUIRED');
for(const [node,resource] of Object.entries(progress.resources)){
 const jobId=resource.images?.dwsJobId;
 if(resource.images?.code!=='KNOWLEDGE_DWS_EXPORT_OBJECT_MISSING'||!/^pdf_[0-9]{1,30}$/.test(jobId??''))continue;
 const entry={node,jobId,checkedAt:new Date().toISOString(),exportsSubmitted:0,downloads:0,modelCalls:0};report.push(entry);
 try{
  const result=await dws.runCommand(user,['doc','+export-get','--job-id',jobId],{background:true});
  entry.status='metadata_returned';entry.shape=shape(result);entry.jobIdPaths=[];entry.states=[];
  const walk=(v,path='',depth=0)=>{if(depth>5||!v||typeof v!=='object'||Array.isArray(v))return;for(const [key,x] of Object.entries(v)){if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))continue;const next=path?path+'.'+key:key;if(x===jobId)entry.jobIdPaths.push(next);if(/status|state/i.test(key)&&typeof x==='string'&&/^(INIT|PROCESSING|SUCCESS|FAILED|success|failed|completed)$/.test(x))entry.states.push({path:next,state:x});walk(x,next,depth+1);}};walk(result);
 }catch(error){entry.status='failed';entry.category=error.dwsCategory;entry.code=error.dwsCode;entry.reason=error.dwsReason;}
}
await writeFile('output/knowledge-diagnostics/export-jobs-live.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
