// Same-employee formal reads. Persist counts/diagnostic categories, no body or URLs.
import{Pool}from'pg';import{homedir}from'node:os';import{join}from'node:path';import{writeFile}from'node:fs/promises';
import{loadConfig}from'../dist/config.js';import{DwsBroker}from'../dist/dws-broker.js';import{fingerprint}from'../dist/knowledge-parse.js';import{sheetExportDiagnostic}from'../dist/knowledge-sheet-job.js';
const user={corpId:'ding5cc0e9161525554835c2f4657eb6378f',userId:'1769391205643357'},dws=new DwsBroker(loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws')}));
const p=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'}),c=await p.connect(),key=fingerprint([user.corpId,user.userId]),report={startedAt:new Date().toISOString(),kind:'formal_source_diagnosis_no_models_no_index_writes',reviews:[],jobs:[]};let locked=false;
const save=()=>writeFile('output/knowledge-diagnostics/gap-root-cause-live.json',JSON.stringify(report,null,2));
function diagnostic(e){const m=e.message??'';return {...sheetExportDiagnostic(e),messageCharacters:m.length,classes:['JSON','unexpected','invalid','decode','unmarshal','parse','not found','timeout','EOF','expired','permission','HTTP','status','download','response','required'].filter(t=>m.toLowerCase().includes(t.toLowerCase())),httpStatus:m.match(/(?:HTTP|status(?: code)?)[:\s]+([1-5][0-9]{2})/i)?.[1],jsonErrorKeys:(()=>{try{const b=JSON.parse(m.slice(m.indexOf('{')));return Object.keys(b).filter(k=>/^[a-zA-Z_]{1,40}$/.test(k));}catch{return undefined;}})()};}
try{
 locked=(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key])).rows[0].locked;if(!locked)throw Error('KNOWLEDGE_ALREADY_RUNNING');
 if(!await dws.status(user,{fresh:true}))throw Error('DWS_OAUTH_REQUIRED');
 const nodes=(await p.query("SELECT node_id,title FROM knowledge_resources WHERE corp_id=$1 AND user_id=$2 AND status='needs_review' AND extension='axls' ORDER BY title LIMIT 2",[user.corpId,user.userId])).rows;
 for(const node of nodes){const row={node:node.node_id,title:node.title,sheets:[]};report.reviews.push(row);
  try{const meta=await dws.runCommand(user,['wiki','+node-get','--node',node.node_id]);row.hasChildren=(meta.node??meta).hasChildren;
   const list=await dws.runCommand(user,['sheet','+list-sheets','--node',node.node_id]);if(!Array.isArray(list.sheets)||list.count!==list.sheets.length)throw Error('SHEET_LIST_INCOMPLETE');row.sheetCount=list.count;
   for(const s of list.sheets){const entry={sheetId:s.sheetId};row.sheets.push(entry);
    const body=await dws.runCommand(user,['sheet','+read','--node',node.node_id,'--sheet-id',s.sheetId]);entry.complete=body.complete;entry.hasMore=body.hasMore;entry.truncationCount=body.truncationReasons?.length;entry.csvBytes=typeof body.csv==='string'?Buffer.byteLength(body.csv):undefined;entry.csvNonWhitespace=typeof body.csv==='string'?!!body.csv.trim():undefined;entry.bodyKeys=Object.keys(body);
    const media=await dws.runCommand(user,['sheet','list-float-images','--node',node.node_id,'--sheet-id',s.sheetId]);entry.floatImages=media.totalCount;entry.mediaComplete=Array.isArray(media.floatImages)&&media.floatImages.length===media.totalCount;
   }
  }catch(e){row.error=diagnostic(e);}await save();console.log(JSON.stringify(row));
 }
 for(const job of ['31491099479','31800540195']){const row={job};report.jobs.push(row);try{const r=await dws.runCommand(user,['sheet','+knowledge-export-get','--job-id',job]);row.keys=Object.keys(r);row.status=typeof r.status==='string'&&/^[A-Za-z_]{1,30}$/.test(r.status)?r.status:undefined;row.hasDownloadUrl=typeof r.downloadUrl==='string';}catch(e){row.error=diagnostic(e);}await save();console.log(JSON.stringify(row));}
}finally{report.finishedAt=new Date().toISOString();await save();if(locked)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);c.release();await p.end();}
