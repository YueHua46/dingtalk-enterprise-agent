// Formal structure reads only, never resubmit a failed sheet export.
import {Pool} from 'pg';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {writeFile} from 'node:fs/promises';
import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {fingerprint} from '../dist/knowledge-parse.js';
const user={corpId:'ding5cc0e9161525554835c2f4657eb6378f',userId:'1769391205643357'};
const dws=new DwsBroker(loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws')}));
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'}),lock=await pool.connect(),key=fingerprint([user.corpId,user.userId]);
const results=[];
function shape(v,depth=0){
 if(v===null)return 'null';if(Array.isArray(v))return {kind:'array',count:v.length};
 if(typeof v!=='object'||depth>=5)return typeof v;
 return Object.fromEntries(Object.entries(v).filter(([k])=>/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(k)).slice(0,60).map(([k,x])=>[k,shape(x,depth+1)]));
}
try{
 if(!(await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key])).rows[0].locked)throw new Error('KNOWLEDGE_ALREADY_RUNNING');
 if(!await dws.status(user,{fresh:true}))throw new Error('DWS_OAUTH_REQUIRED');
 for(const node of ['QG53mjyd80ynBzl9HjN9dMrXW6zbX04v','qnYMoO1rWxbOqpjAibXBRkZwJ47Z3je9']){
  const entry={node,checkedAt:new Date().toISOString(),sheets:[]};results.push(entry);
  try{
   const list=await dws.runCommand(user,['sheet','+list-sheets','--node',node],{background:true});
   if(!Array.isArray(list.sheets)||list.count!==list.sheets.length)throw new Error('KNOWLEDGE_SHEET_LIST_INCOMPLETE');
   entry.listCount=list.count;
   for(const sheet of list.sheets){
    if(typeof sheet.sheetId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(sheet.sheetId))throw new Error('KNOWLEDGE_SHEET_ID_INVALID');
    const row={sheetId:sheet.sheetId};entry.sheets.push(row);
    try{
     const info=await dws.runCommand(user,['sheet','info','--node',node,'--sheet-id',sheet.sheetId],{background:true});
     row.status='structure_read_passed';row.shape=shape(info);row.dimensions=[];
     const walk=(v,path='',depth=0)=>{if(depth>6||!v||typeof v!=='object'||Array.isArray(v))return;for(const [k,x]of Object.entries(v)){if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(k))continue;const next=path?path+'.'+k:k;if(/^(rowCount|columnCount|lastRow|lastColumn)$/.test(k)&&Number.isSafeInteger(x)&&x>=0)row.dimensions.push({path:next,value:x});walk(x,next,depth+1);}};walk(info);
    }catch(error){row.status='failed';row.category=error.dwsCategory;row.code=error.dwsCode;row.reason=error.dwsReason;}
   }
  }catch(error){entry.status='failed';entry.category=error.dwsCategory;entry.code=error.dwsCode;entry.reason=error.dwsReason;}
  await writeFile('output/knowledge-diagnostics/sheet-structure-live.json',JSON.stringify({results,exportsSubmitted:0,bodyReads:0,modelCalls:0,indexWrites:0},null,2));
  console.log(JSON.stringify(entry));
 }
}finally{await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]).catch(()=>undefined);lock.release();await pool.end();}
