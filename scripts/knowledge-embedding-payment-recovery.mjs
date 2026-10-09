// Explicit payment recovery: verify the unchanged model, archive only the
// resolved Unpurchased refusals, then release those guards for normal retries.
import {Pool} from 'pg';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {KnowledgeModel} from '../dist/knowledge-model.js';
import {fingerprint} from '../dist/knowledge-parse.js';
if(!process.argv.includes('--confirmed-payment'))throw Error('PAYMENT_RECOVERY_AUTHORIZATION_REQUIRED');
const includeLegacy=process.argv.includes('--confirmed-legacy-retry');
const user={corpId:'ding5cc0e9161525554835c2f4657eb6378f',userId:'1769391205643357'};
const apps=JSON.parse(execFileSync(process.execPath,[join(process.env.APPDATA,'npm/node_modules/pm2/bin/pm2'),'jlist'],{encoding:'utf8'}));
if(apps.some(a=>a.name==='rag-full-ingestion'&&a.pm2_env.status==='online'))throw Error('KNOWLEDGE_ALREADY_RUNNING');
const config=loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',KNOWLEDGE_ENABLED:'false',DWS_CONFIG_DIR:join(homedir(),'.dws')});
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'}),c=await pool.connect(),key=fingerprint([user.corpId,user.userId]);let locked=false;
const path='output/knowledge-diagnostics/embedding-payment-recovery-'+Date.now()+'.json';
const report={at:new Date().toISOString(),model:config.EMBEDDING_MODEL,authorization:'user_confirmed_payment_and_requested_recheck',status:'starting',modelCalls:0,released:0};
try{
 locked=(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key])).rows[0].locked;
 if(!locked)throw Error('KNOWLEDGE_ALREADY_RUNNING');
 if(!await new DwsBroker(config).status(user,{fresh:true}))throw Error('DWS_OAUTH_REQUIRED');
 const rows=(await c.query(`SELECT *,rejected_at::text rejected_at_exact FROM knowledge_embedding_rejections WHERE corp_id=$1 AND user_id=$2 AND embedding_model=$3 AND (provider_code='AccessDenied.Unpurchased' OR ($4::boolean AND provider_code IS NULL))`,[user.corpId,user.userId,config.EMBEDDING_MODEL,includeLegacy])).rows;
 report.authorization=includeLegacy?'user_confirmed_payment_and_explicitly_authorized_historical_refusal_retry':report.authorization;
 report.archivedRefusals=rows;
 const model=new KnowledgeModel(config,async(input,options)=>{
  report.modelCalls++;
  const response=await fetch(input,options);
  if(response.ok){const body=await response.clone().json();const n=body?.usage?.total_tokens??body?.usage?.input_tokens;if(Number.isSafeInteger(n)&&n>=0)report.probeTokens=n;}
  return response;
 });
 const vectors=await model.embed(['付款后向量服务恢复检查']);
 report.status='probe_passed';report.dimensions=vectors[0].length;
 // Durable evidence precedes releasing any refusal. Historical unclassified
 // 403s, other models/employees and newly arriving refusals stay protected.
 await writeFile(path,JSON.stringify(report,null,2));
 await c.query('BEGIN');
 for(const r of rows){const deleted=await c.query(`DELETE FROM knowledge_embedding_rejections WHERE corp_id=$1 AND user_id=$2 AND node_id=$3 AND embedding_model=$4 AND provider_code IS NOT DISTINCT FROM $6 AND rejected_at=$5`,[user.corpId,user.userId,r.node_id,r.embedding_model,r.rejected_at_exact,r.provider_code]);report.released+=deleted.rowCount;}
 await c.query('COMMIT');report.status='resolved_guards_released';
 report.remainingRefusals=(await c.query('SELECT count(*)::int n FROM knowledge_embedding_rejections WHERE corp_id=$1 AND user_id=$2',[user.corpId,user.userId])).rows[0].n;
}catch(e){await c.query('ROLLBACK');report.status='failed';report.code=e.message;report.providerCode=e.providerCode;report.providerRequestId=e.providerRequestId;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile(path,JSON.stringify(report,null,2));if(locked)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);c.release();await pool.end();}
console.log(JSON.stringify({path,status:report.status,code:report.code,providerCode:report.providerCode,modelCalls:report.modelCalls,probeTokens:report.probeTokens,released:report.released,remainingRefusals:report.remainingRefusals}));
