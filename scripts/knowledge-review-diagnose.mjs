// Current employee, read-only schema diagnostics; no source strings or URLs.
import {Pool} from 'pg';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {writeFile} from 'node:fs/promises';
import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {parseJsonml} from '../dist/knowledge-parse.js';
const user={corpId:'ding5cc0e9161525554835c2f4657eb6378f',userId:'1769391205643357'};
const config=loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws')});
const pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'}),dws=new DwsBroker(config),report=[];
try{
 const {rows}=await pool.query("SELECT node_id,title FROM knowledge_resources WHERE corp_id=$1 AND user_id=$2 AND status='needs_review' AND extension='adoc'",[user.corpId,user.userId]);
 for(const row of rows){
  const entry={...row,checkedAt:new Date().toISOString()};report.push(entry);
  try{
   const result=await dws.runCommand(user,['doc','+fetch','--node',row.node_id,'--scope','full','--detail','full'],{background:true});
   entry.complete=result.complete;entry.contentKeys=Object.keys(result.content??{});
   const tree=typeof result.content?.jsonml==='string'?JSON.parse(result.content.jsonml):result.content?.jsonml;
   const tags={},cards=[];let textCharacters=0,attributeCount=0;
   function walk(node){if(typeof node==='string'){textCharacters+=node.length;return;}if(!Array.isArray(node))return;
    const tag=typeof node[0]==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(node[0])?node[0]:'unknown';tags[tag]=(tags[tag]??0)+1;
    const attrs=node[1]&&typeof node[1]==='object'&&!Array.isArray(node[1]);if(attrs)attributeCount+=Object.keys(node[1]).length;
    if(tag==='card'&&attrs)cards.push(Object.fromEntries(Object.entries(node[1]).map(([key,value])=>[key,['type','cardType','kind','component'].includes(key)&&typeof value==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(value)?value:Array.isArray(value)?'array':typeof value])));
    for(const child of node.slice(attrs?2:1))walk(child);
   }
   walk(tree);const parsed=parseJsonml(tree);Object.assign(entry,{tags,cards,textCharacters,attributeCount,chunks:parsed.chunks.length,quality:parsed.quality});
  }catch(error){entry.errorCode=error.dwsCode??'read_or_schema_failed';}
 }
}finally{await pool.end();await writeFile('output/knowledge-diagnostics/review-adoc-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
