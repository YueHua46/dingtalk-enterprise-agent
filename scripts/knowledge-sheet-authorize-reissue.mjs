// One explicit human-authorized recovery batch. No DWS exports here.
import {Pool} from 'pg';
import {readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {fingerprint} from '../dist/knowledge-parse.js';
const profile='ding5cc0e9161525554835c2f4657eb6378f:1769391205643357';
if(!process.argv.includes('--explicit-user-reissue'))throw Error('EXPLICIT_RECOVERY_REQUIRED');
const p=JSON.parse(await readFile('output/knowledge-full-ingestion/progress.json','utf8')),user=p.user;
if(`${user.corpId}:${user.userId}`!==profile)throw Error('IDENTITY_MISMATCH');
const apps=JSON.parse(execFileSync(process.execPath,[join(process.env.APPDATA,'npm/node_modules/pm2/bin/pm2'),'jlist'],{encoding:'utf8'}));
if(apps.some(a=>a.name==='rag-full-ingestion'&&a.pm2_env.status==='online'))throw Error('KNOWLEDGE_ALREADY_RUNNING');
const config=loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws')});
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'}),c=await pool.connect(),key=fingerprint([user.corpId,user.userId]);let locked=false;
try{
 locked=(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key])).rows[0].locked;if(!locked)throw Error('KNOWLEDGE_ALREADY_RUNNING');
 if(!await new DwsBroker(config).status(user,{fresh:true}))throw Error('DWS_OAUTH_REQUIRED');
 const nodes=Object.entries(p.resources).filter(([,r])=>r.text?.code==='KNOWLEDGE_SHEET_EXPORT_PENDING_RESOLUTION').map(([node])=>node);
 const batch='explicit-user-reissue-20261008-01';
 const records=(await c.query(`SELECT e.* FROM knowledge_sheet_exports e JOIN knowledge_resources r ON r.corp_id=e.corp_id AND r.user_id=e.user_id AND r.node_id=e.entry_node_id
  WHERE e.corp_id=$1 AND e.user_id=$2 AND e.entry_node_id=ANY($3) AND e.job_id IS NULL AND e.state IN ('starting','failed')
  AND r.status NOT IN ('denied','deleted','directory_absent')`,[user.corpId,user.userId,nodes])).rows;
 const report={at:new Date().toISOString(),batch,authorization:'explicit_user_message_recreate_if_history_unavailable',authorized:0,alreadyAuthorized:0,records:[],exportsSubmitted:0,models:0};
 await c.query('BEGIN');
 for(const r of records){
  const prior=(await c.query(`SELECT 1 FROM knowledge_export_events WHERE corp_id=$1 AND user_id=$2 AND node_id=$3 AND event='reissue_authorized' AND diagnostic->>'batch'=$4`,[user.corpId,user.userId,r.node_id,batch])).rowCount;
  if(prior){report.alreadyAuthorized++;continue;}
  await c.query(`INSERT INTO knowledge_export_events(corp_id,user_id,node_id,kind,attempt_id,event,job_id,source_hash,diagnostic)
   VALUES($1,$2,$3,'sheet',$4,'reissue_authorized',NULL,$5,$6)`,[user.corpId,user.userId,r.node_id,randomUUID(),r.source_hash,JSON.stringify({batch,priorState:r.state,priorStage:r.stage,priorDiagnostic:r.diagnostic,priorUpdatedAt:r.updated_at,oldOutcome:'unknown_not_cancelled_or_resolved'})]);
  await c.query("UPDATE knowledge_sheet_exports SET state='retry_authorized',updated_at=now() WHERE corp_id=$1 AND user_id=$2 AND node_id=$3",[user.corpId,user.userId,r.node_id]);
  report.authorized++;report.records.push({node:r.node_id,entry:r.entry_node_id,oldState:r.state});
 }
 await c.query('COMMIT');await writeFile('output/knowledge-diagnostics/sheet-reissue-authorization.json',JSON.stringify(report,null,2));console.log(JSON.stringify({batch,authorized:report.authorized,alreadyAuthorized:report.alreadyAuthorized,exportsSubmitted:0,models:0}));
}catch(e){await c.query('ROLLBACK');throw e;}finally{if(locked)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);c.release();await pool.end();}
