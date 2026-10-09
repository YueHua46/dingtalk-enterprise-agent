// Live tool diagnostic, separate from autonomous application answer E2E.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {KnowledgeModel} from '../dist/knowledge-model.js';
import {KnowledgeStore} from '../dist/knowledge-store.js';
import {KnowledgeSource} from '../dist/knowledge-source.js';
import {KnowledgeSync} from '../dist/knowledge-sync.js';
import {KnowledgeTool} from '../dist/knowledge-tool.js';
const profile=process.argv[2];assert.match(profile??'',/^[A-Za-z0-9_-]{1,128}:[A-Za-z0-9_-]{1,128}$/);
const [corpId,userId]=profile.split(':'),user={corpId,userId};
const config=loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',KNOWLEDGE_ENABLED:'false',KNOWLEDGE_TEST_USERS:profile,
 KNOWLEDGE_AUTO_SYNC:'false',DWS_CONFIG_DIR:join(homedir(),'.dws')});
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'});
const dws=new DwsBroker(config),model=new KnowledgeModel(config),store=new KnowledgeStore(pool,config.EMBEDDING_MODEL,false);
const source=new KnowledgeSource(config,dws,model,store),sync=new KnowledgeSync(config,store,dws,source,model),tool=new KnowledgeTool(config,store,sync,model);
const observations=[],invoke=dws.runCommand.bind(dws);let stage;
dws.runCommand=async(identity,args,options)=>{assert.deepEqual(identity,user);observations.push({stage,operation:args.slice(0,2).join(' ')});return invoke(identity,args,options);};
try{
 assert(await dws.status(user,{fresh:true}),'DWS_AUTH_REQUIRED');
 const context={surfaceId:randomUUID(),taskId:randomUUID(),requestText:'请比较 P42WC35-2-FASBT 和 P45HC35-3-FAS 的无线网络制式，哪台可连接5GHz路由器？'};
 const runs=[];
 for(const input of [{model:['P42WC35-2-FASBT','P45HC35-3-FAS']},{model:'P45HC35-3-FAS',parameter:'无线标准'}]){
   stage=runs.length+1;const start=Date.now();const result=await tool.execute(user,'lookup_product',input,context);
   runs.push({result,elapsedMs:Date.now()-start});
 }
 assert.equal(runs[1].result.evidenceState,'already_observed');
 assert.deepEqual(runs[0].result.facts.filter(f=>f.model==='p45hc35-3-fas'),runs[1].result.facts); assert(runs[1].result.facts.every(f=>f.model==='p45hc35-3-fas'));
 assert.deepEqual(runs[0].result.corroboratingEvidence,runs[1].result.corroboratingEvidence);
 assert(observations.some(o=>o.stage===2),'REUSE_DID_NOT_RECHECK_DWS_ACCESS');
 const report={method:'Actual employee DWS/index/model tool diagnostic; not an autonomous answer E2E or a mock',
   calls:runs.map((r,i)=>({stage:i+1,elapsedMs:r.elapsedMs,state:r.result.evidenceState,facts:r.result.facts.length,
     corroboratingDocuments:r.result.corroboratingEvidence?.documents?.map(d=>d.source.title)})),observations,
   requestedProductFieldsAndOriginalQuestionEvidenceIdentical:true,permissionRecheckedOnReuse:true};
 await writeFile(resolve('output/knowledge-accuracy-2026-10-08/product-batch-reuse-live.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}finally{await pool.end();}
