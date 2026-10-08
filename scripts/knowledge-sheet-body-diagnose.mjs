// Read every listed worksheet through the native strict read contract. This
// proves value readability only, not images, workbook export, or index success.
import {Pool} from 'pg';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {readFile,writeFile} from 'node:fs/promises';
import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {fingerprint} from '../dist/knowledge-parse.js';
const user={corpId:'ding5cc0e9161525554835c2f4657eb6378f',userId:'1769391205643357'};
const structure=JSON.parse(await readFile('output/knowledge-diagnostics/sheet-structure-live.json','utf8'));
const dws=new DwsBroker(loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws')}));
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'}),lock=await pool.connect(),key=fingerprint([user.corpId,user.userId]),results=[];
try{
 if(!(await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key])).rows[0].locked)throw new Error('KNOWLEDGE_ALREADY_RUNNING');
 if(!await dws.status(user,{fresh:true}))throw new Error('DWS_OAUTH_REQUIRED');
 for(const workbook of structure.results){
  if(!['QG53mjyd80ynBzl9HjN9dMrXW6zbX04v','qnYMoO1rWxbOqpjAibXBRkZwJ47Z3je9'].includes(workbook.node)||Date.now()-Date.parse(workbook.checkedAt)>60*60*1000)throw new Error('KNOWLEDGE_DIAGNOSTIC_SOURCE_INVALID');
  for(const sheet of workbook.sheets){
   if(sheet.status!=='structure_read_passed')continue;
   const entry={node:workbook.node,sheetId:sheet.sheetId,checkedAt:new Date().toISOString()};results.push(entry);
   try{
    const r=await dws.runCommand(user,['sheet','+read','--node',workbook.node,'--sheet-id',sheet.sheetId],{background:true});
    entry.status='native_read_returned';entry.keys=Object.keys(r).filter(k=>/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(k));
    entry.types=Object.fromEntries(entry.keys.map(k=>[k,r[k]===null?'null':Array.isArray(r[k])?'array':typeof r[k]]));
    for(const field of ['complete','hasMore','rowCount','columnCount'])if(typeof r[field]==='boolean'||Number.isSafeInteger(r[field]))entry[field]=r[field];
    for(const field of ['resolvedRange','returnedRange'])if(typeof r[field]==='string'&&/^[A-Z]+[0-9]+(?::[A-Z]+[0-9]+)?$/.test(r[field]))entry[field]=r[field];
    if(Array.isArray(r.truncationReasons))entry.truncationCount=r.truncationReasons.length;
    if(typeof r.csv==='string'){entry.csvBytes=Buffer.byteLength(r.csv);entry.csvHasNonWhitespace=r.csv.trim().length>0;}
   }catch(error){entry.status='failed';entry.category=error.dwsCategory;entry.code=error.dwsCode;entry.reason=error.dwsReason;}
   await writeFile('output/knowledge-diagnostics/sheet-body-live.json',JSON.stringify({results,exportsSubmitted:0,modelCalls:0,indexWrites:0,imageEvidence:'not_verified'},null,2));
  }
 }
 console.log(JSON.stringify({worksheets:results.length,failed:results.filter(r=>r.status==='failed').length,results}));
}finally{await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]).catch(()=>undefined);lock.release();await pool.end();}
