// One read-only verification after the DWS routing change. No embedding,
// model calls, index activation, export submission, or automatic retries.
import {Pool} from 'pg';
import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {KnowledgeStore} from '../dist/knowledge-store.js';
import {KnowledgeSource} from '../dist/knowledge-source.js';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {writeFile} from 'node:fs/promises';
const user={corpId:'ding5cc0e9161525554835c2f4657eb6378f',userId:'1769391205643357'};
const config=loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws'),
 DATABASE_URL:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance',FILE_WORKER_URL:'http://127.0.0.1:18081',
 CLAMAV_HOST:'127.0.0.1',CLAMAV_PORT:'13310',KNOWLEDGE_DIR:join(process.cwd(),'data/knowledge-acceptance'),KNOWLEDGE_ENABLED:'false'});
const pool=new Pool({connectionString:config.DATABASE_URL,max:1});
const dws=new DwsBroker(config),store=new KnowledgeStore(pool,config.EMBEDDING_MODEL);
const model={recognize:async()=>{throw new Error('DIAGNOSTIC_MODEL_FORBIDDEN');}};
const source=new KnowledgeSource(config,dws,model);
const report={node:'a9E05BDRVQNB91KrT7P6Rv2MJ63zgkYA',checkedAt:new Date().toISOString(),modelCalls:0,exportsSubmitted:0,indexWrites:0};
try{
 if(!await dws.status(user,{fresh:true}))throw new Error('DWS_OAUTH_REQUIRED');
 const resource=await store.resource(user,report.node);
 if(resource.extension!=='pdf')throw new Error('DIAGNOSTIC_RESOURCE_TYPE_MISMATCH');
 const started=Date.now();const read=await source.read(user,resource,false,new Set(),true);
 report.status='source_read_passed';report.elapsedMs=Date.now()-started;report.hash=read.hash;
 report.chunks=read.content.chunks.length;report.quality=[...new Set(read.content.quality)];
}catch(error){report.status='failed';report.stage=error.sourceStage;report.code=/^[A-Z_0-9]{1,100}$/.test(error.message)?error.message:'UNCLASSIFIED';report.category=error.dwsCategory;report.reason=error.dwsReason;}
finally{await pool.end();}
await writeFile('output/knowledge-diagnostics/route-source-live.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
