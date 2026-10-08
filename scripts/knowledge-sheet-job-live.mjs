// Finite same-employee real source verification; no model or index writes.
import {Pool} from 'pg';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {KnowledgeSource} from '../dist/knowledge-source.js';
import {KnowledgeStore} from '../dist/knowledge-store.js';
import {KnowledgeModel} from '../dist/knowledge-model.js';
import {fingerprint} from '../dist/knowledge-parse.js';
import {resourceFromNode,knowledgeErrorCode} from '../dist/knowledge-sync.js';
import {sheetExportDiagnostic} from '../dist/knowledge-sheet-job.js';
const user={corpId:'ding5cc0e9161525554835c2f4657eb6378f',userId:'1769391205643357'};
const pm2=JSON.parse(execFileSync('cmd.exe',['/c','pm2','jlist'],{encoding:'utf8'}));
if(pm2.some(p=>p.name==='rag-full-ingestion'&&p.pm2_env.status==='online'))throw new Error('KNOWLEDGE_ALREADY_RUNNING');
const config=loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',KNOWLEDGE_ENABLED:'false',DWS_CONFIG_DIR:join(homedir(),'.dws'),
 FILE_WORKER_URL:'http://127.0.0.1:18081',CLAMAV_HOST:'127.0.0.1',CLAMAV_PORT:'13310',KNOWLEDGE_DIR:join(process.cwd(),'data/knowledge-acceptance')});
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'}),store=new KnowledgeStore(pool,config.EMBEDDING_MODEL),dws=new DwsBroker(config);
const source=new KnowledgeSource(config,dws,new KnowledgeModel(config),store),lock=await pool.connect(),key=fingerprint([user.corpId,user.userId]);
const node='P7QG4Yx2Jp3jA9lbH1PMgeo6V9dEq3XD',report={node,startedAt:new Date().toISOString(),kind:'real_same_employee_source_only',modelCalls:0,indexWrites:0};let locked=false;
try{
 locked=(await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key])).rows[0].locked;if(!locked)throw new Error('KNOWLEDGE_ALREADY_RUNNING');
 if(!await dws.status(user,{fresh:true}))throw new Error('DWS_OAUTH_REQUIRED');
 const saved=await store.resource(user,node);if(!saved||saved.extension!=='axls'||['denied','deleted','directory_absent'].includes(saved.status))throw new Error('KNOWLEDGE_SOURCE_EXCLUDED');
 const meta=await source.metadata(user,node),fresh=resourceFromNode(meta,saved.workspaceId,saved.path,saved.parentId);
 const start=Date.now();
 try{
  const read=await source.read(user,fresh,false,new Set(),true);
  Object.assign(report,{status:'source_manifest_passed',textChunks:read.content.chunks.length,unverifiedImages:read.content.quality.filter(q=>q==='image_not_verified').length,quality:read.content.quality,elapsedMs:Date.now()-start});
 }catch(error){Object.assign(report,{status:'failed',code:knowledgeErrorCode(error),...sheetExportDiagnostic(error),elapsedMs:Date.now()-start});}
 const journal=await pool.query('SELECT state,job_id,stage,diagnostic FROM knowledge_sheet_exports WHERE corp_id=$1 AND user_id=$2 AND node_id=$3',[user.corpId,user.userId,node]);
 report.journal=journal.rows[0];
}catch(error){Object.assign(report,{status:'blocked',code:knowledgeErrorCode(error),...sheetExportDiagnostic(error)});}
finally{
 report.finishedAt=new Date().toISOString();
 await writeFile('output/knowledge-diagnostics/sheet-job-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(locked)await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);lock.release();await pool.end();
}
