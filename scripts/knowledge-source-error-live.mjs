// Re-read only the previously failed adoc sources with improved diagnostics.
import {Pool} from 'pg';
import {readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {fingerprint} from '../dist/knowledge-parse.js';
import {sheetExportDiagnostic} from '../dist/knowledge-sheet-job.js';
const prior=JSON.parse(await readFile('output/knowledge-full-ingestion/progress.json','utf8')),user=prior.user;
const config=loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws')});
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'}),client=await pool.connect(),key=fingerprint([user.corpId,user.userId]),results=[];let locked=false;
try{
 locked=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key])).rows[0].locked;if(!locked)throw new Error('KNOWLEDGE_ALREADY_RUNNING');
 const dws=new DwsBroker(config);if(!await dws.status(user,{fresh:true}))throw new Error('DWS_OAUTH_REQUIRED');
 const nodes=Object.entries(prior.resources).filter(([,r])=>r.extension==='adoc'&&r.text?.status==='failed'&&r.text?.dwsReason==='business_error').slice(0,3);
 for(const [node]of nodes){const start=Date.now(),entry={node};
  try{const r=await dws.runCommand(user,['doc','+fetch','--node',node,'--scope','full','--detail','full']);entry.status=r.complete===true&&r.content?.jsonml?'full_source_read_passed':'incomplete';}
  catch(error){Object.assign(entry,{status:'failed',...sheetExportDiagnostic(error)});}
  entry.elapsedMs=Date.now()-start;results.push(entry);
 }
}finally{
 const report={at:new Date().toISOString(),kind:'real_full_source_reads_only',results,modelCalls:0,indexWrites:0,exportsSubmitted:0};
 await writeFile('output/knowledge-diagnostics/source-error-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);client.release();await pool.end();
}
