// New metadata evidence: revisions and floating images. No export, image URL
// fetch, repeated value reads, model calls or index writes.
import {Pool} from 'pg';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {readFile,writeFile} from 'node:fs/promises';
import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {fingerprint} from '../dist/knowledge-parse.js';
const user={corpId:'ding5cc0e9161525554835c2f4657eb6378f',userId:'1769391205643357'};
const prior=JSON.parse(await readFile('output/knowledge-diagnostics/sheet-structure-live.json','utf8'));
const dws=new DwsBroker(loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws')}));
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'}),lock=await pool.connect(),key=fingerprint([user.corpId,user.userId]),results=[];
try{
 if(!(await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key])).rows[0].locked)throw new Error('KNOWLEDGE_ALREADY_RUNNING');
 if(!await dws.status(user,{fresh:true}))throw new Error('DWS_OAUTH_REQUIRED');
 for(const workbook of prior.results){
  if(!['QG53mjyd80ynBzl9HjN9dMrXW6zbX04v','qnYMoO1rWxbOqpjAibXBRkZwJ47Z3je9'].includes(workbook.node)||Date.now()-Date.parse(workbook.checkedAt)>60*60*1000)throw new Error('KNOWLEDGE_DIAGNOSTIC_SOURCE_INVALID');
  const entry={node:workbook.node,checkedAt:new Date().toISOString(),sheets:[]};results.push(entry);
  try{
   const r=await dws.runCommand(user,['sheet','revision-get','--node',workbook.node],{background:true});
   if(!Number.isSafeInteger(r.revision)||r.revision<0)throw new Error('KNOWLEDGE_REVISION_UNVERIFIED');
   entry.revision=r.revision;entry.revisionStatus='passed';
  }catch(error){entry.revisionStatus='failed';entry.revisionCategory=error.dwsCategory;entry.revisionCode=error.dwsCode;}
  for(const sheet of workbook.sheets){
   const row={sheetId:sheet.sheetId};entry.sheets.push(row);
   try{
    const r=await dws.runCommand(user,['sheet','list-float-images','--node',workbook.node,'--sheet-id',sheet.sheetId],{background:true});
    if(!Array.isArray(r.floatImages)||r.totalCount!==r.floatImages.length)throw new Error('KNOWLEDGE_FLOAT_IMAGE_LIST_UNVERIFIED');
    row.status='metadata_passed';row.count=r.totalCount;
    row.fields=[...new Set(r.floatImages.flatMap(image=>Object.keys(image).filter(k=>/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(k))))];
    row.hasResourcePath=r.floatImages.some(image=>typeof image.src==='string'&&image.src.length>0);
    row.hasResourceId=r.floatImages.some(image=>typeof image.resourceId==='string'&&image.resourceId.length>0);
   }catch(error){row.status='failed';row.category=error.dwsCategory;row.code=error.dwsCode;row.reason=error.dwsReason;}
  }
  await writeFile('output/knowledge-diagnostics/sheet-media-live.json',JSON.stringify({results,exportsSubmitted:0,imageDownloads:0,valueReads:0,modelCalls:0,indexWrites:0},null,2));
  console.log(JSON.stringify(entry));
 }
}finally{await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]).catch(()=>undefined);lock.release();await pool.end();}
