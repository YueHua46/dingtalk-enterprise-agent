// Import actual failed job evidence without inventing its missing source hash.
import {Pool} from 'pg';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {readFile,writeFile} from 'node:fs/promises';
import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {KnowledgeExport} from '../dist/knowledge-export.js';
import {fingerprint} from '../dist/knowledge-parse.js';
const prior=JSON.parse(await readFile('output/knowledge-full-ingestion/progress-interrupted-v5-model-outage-20261007.json','utf8'));
const user=prior.user;
if(user.corpId!=='ding5cc0e9161525554835c2f4657eb6378f'||user.userId!=='1769391205643357')throw new Error('KNOWLEDGE_TASK_IDENTITY_INVALID');
const config=loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws'),KNOWLEDGE_DIR:join(process.cwd(),'data/knowledge-acceptance')});
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'}),lock=await pool.connect(),key=fingerprint([user.corpId,user.userId]);
const dws=new DwsBroker(config),journal=new KnowledgeExport(pool,config.KNOWLEDGE_DIR,config.KNOWLEDGE_MAX_SOURCE_BYTES,async()=>{throw new Error('UNEXPECTED_SCAN');}),results=[];
let submitted=0,resumed=0;
try{
 if(!(await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key])).rows[0].locked)throw new Error('KNOWLEDGE_ALREADY_RUNNING');
 if(!await dws.status(user,{fresh:true}))throw new Error('DWS_OAUTH_REQUIRED');
 for(const [node,r] of Object.entries(prior.resources)){
  if(r.extension!=='adoc'||r.images?.code!=='KNOWLEDGE_DWS_EXPORT_OBJECT_MISSING'||!/^pdf_[0-9]{1,30}$/.test(r.images?.dwsJobId??''))continue;
  const args=[user.corpId,user.userId,node,r.images.dwsJobId];
  await pool.query(`INSERT INTO knowledge_exports(corp_id,user_id,node_id,format,state,job_id) VALUES($1,$2,$3,'pdf','legacy_unbound',$4) ON CONFLICT DO NOTHING`,args);
  const saved=await pool.query(`SELECT job_id,source_hash,state FROM knowledge_exports WHERE corp_id=$1 AND user_id=$2 AND node_id=$3 AND source_hash IS NULL`,args.slice(0,3));
  if(saved.rows[0]?.job_id!==args[3]||saved.rows[0]?.state!=='legacy_unbound')throw new Error('KNOWLEDGE_EXPORT_HISTORY_CONFLICT');
  const entry={node,jobId:args[3],sourceHash:null,journalStatus:'saved',sourceRead:'not_verified',guardStatus:'not_verified'};results.push(entry);
  try{
   const source=await dws.runCommand(user,['doc','+fetch','--node',node,'--scope','full','--detail','full'],{background:true});
   if(source.complete!==true||!source.content?.jsonml)throw new Error('KNOWLEDGE_DOCUMENT_INCOMPLETE');
   entry.sourceRead='passed';
   try{
    await journal.download(user,node,fingerprint(source.content.jsonml),join(config.KNOWLEDGE_DIR,'unused.pdf'),async()=>{submitted++;throw new Error('UNEXPECTED_SUBMISSION');},async()=>{resumed++;throw new Error('UNEXPECTED_RESUME');},async()=>{});
    throw new Error('LEGACY_GUARD_DID_NOT_BLOCK');
   }catch(error){if(error.message!=='KNOWLEDGE_EXPORT_SOURCE_UNBOUND')throw error;entry.guardStatus='passed_unbound_rejected';}
  }catch(error){process.exitCode=1;entry.code=/^KNOWLEDGE_[A-Z_0-9]+$/.test(error.message)?error.message:'source_read_failed';entry.category=error.dwsCategory;entry.dwsCode=error.dwsCode;}
 }
 if(results.length!==3||submitted||resumed)throw new Error('KNOWLEDGE_EXPORT_GUARD_INCOMPLETE');
 const report={kind:'actual_DWS_source_read_and_durable_guard_not_export_recovery',results,exportsSubmitted:submitted,exportGets:resumed,modelCalls:0,indexWrites:0};
 await writeFile('output/knowledge-diagnostics/export-legacy-guard-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]).catch(()=>undefined);lock.release();await pool.end();}
