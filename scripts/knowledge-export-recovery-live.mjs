// Limited real source verification under the employee lock; no model/index.
import {Pool} from 'pg';import {homedir} from 'node:os';import {join} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {loadConfig} from '../dist/config.js';import {DwsBroker} from '../dist/dws-broker.js';
import {KnowledgeSource} from '../dist/knowledge-source.js';import {KnowledgeStore} from '../dist/knowledge-store.js';
import {fingerprint} from '../dist/knowledge-parse.js';import {resourceFromNode,knowledgeErrorCode} from '../dist/knowledge-sync.js';
import {sheetExportDiagnostic} from '../dist/knowledge-sheet-job.js';
const user={corpId:'ding5cc0e9161525554835c2f4657eb6378f',userId:'1769391205643357'};
const config=loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',KNOWLEDGE_ENABLED:'false',DWS_CONFIG_DIR:join(homedir(),'.dws'),FILE_WORKER_URL:'http://127.0.0.1:18081',CLAMAV_HOST:'127.0.0.1',CLAMAV_PORT:'13310',KNOWLEDGE_DIR:join(process.cwd(),'data/knowledge-acceptance')});
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'}),store=new KnowledgeStore(pool,config.EMBEDDING_MODEL),dws=new DwsBroker(config);
const source=new KnowledgeSource(config,dws,{recognize:async()=>{throw Error('MODEL_DISABLED_FOR_SOURCE_PROBE');}},store),c=await pool.connect(),key=fingerprint([user.corpId,user.userId]);let locked=false;
const report={at:new Date().toISOString(),kind:'real_same_employee_source_only',results:[],modelCalls:0,indexWrites:0};
try{
 locked=(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key])).rows[0].locked;if(!locked)throw Error('KNOWLEDGE_ALREADY_RUNNING');
 if(!await dws.status(user,{fresh:true}))throw Error('DWS_OAUTH_REQUIRED');
 const p=JSON.parse(await readFile('output/knowledge-full-ingestion/progress.json','utf8'));
 const nodes=Object.entries(p.resources).filter(([,r])=>r.extension==='axls'&&r.text?.code==='KNOWLEDGE_SHEET_EXPORT_PENDING_RESOLUTION').sort((a,b)=>Number(b[1].title==='各产品参数资料')-Number(a[1].title==='各产品参数资料')).slice(0,2).map(([node])=>node);
 for(const node of nodes){const start=Date.now(),row={node};try{
  const saved=await store.resource(user,node);if(!saved||['denied','deleted','directory_absent'].includes(saved.status))throw Error('SOURCE_EXCLUDED');
  const current=resourceFromNode(await source.metadata(user,node),saved.workspaceId,saved.path,saved.parentId);
  const r=await source.read(user,current,false,new Set(),true);Object.assign(row,{status:'source_manifest_passed',chunks:r.content.chunks.length,unverifiedImages:r.content.quality.filter(q=>q==='image_not_verified').length});
 }catch(e){Object.assign(row,{status:'failed',code:knowledgeErrorCode(e),...sheetExportDiagnostic(e),localErrorCode:e.code});}
 row.elapsedMs=Date.now()-start;row.journal=(await pool.query('SELECT state,job_id,stage,attempt_id,diagnostic FROM knowledge_sheet_exports WHERE corp_id=$1 AND user_id=$2 AND node_id=$3',[user.corpId,user.userId,node])).rows[0];report.results.push(row);
 await writeFile('output/knowledge-diagnostics/export-recovery-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(row));
 }
}finally{report.finishedAt=new Date().toISOString();await writeFile('output/knowledge-diagnostics/export-recovery-live.json',JSON.stringify(report,null,2));if(locked)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);c.release();await pool.end();}
