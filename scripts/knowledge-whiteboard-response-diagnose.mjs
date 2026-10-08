// Diagnose the existing formal request without storing source/error bodies.
import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {readFile,writeFile} from 'node:fs/promises';
const user={corpId:'ding5cc0e9161525554835c2f4657eb6378f',userId:'1769391205643357'};
const dws=new DwsBroker(loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws')}));
const previous=JSON.parse(await readFile('output/knowledge-diagnostics/whiteboard-parts-live.json','utf8'));
const entry={node:previous[0].node,partId:previous[0].cards[0].partId,checkedAt:new Date().toISOString(),modelCalls:0};
const token=value=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,80}$/.test(value)?value:undefined;
function inspect(text){
 const summary={bytes:Buffer.byteLength(String(text??''))};
 let value;try{value=JSON.parse(String(text));}catch{summary.json=false;return summary;}
 summary.json=true;summary.type=value===null?'null':Array.isArray(value)?'array':typeof value;
 if(value&&typeof value==='object'){
  summary.keys=Object.keys(value).filter(k=>token(k)).slice(0,30);
  summary.ok=typeof value.ok==='boolean'?value.ok:undefined;
  summary.dataType=value.data===null?'null':typeof value.data;
  summary.error={category:token(value.error?.category),code:token(String(value.error?.code??'')),reason:token(value.error?.reason)};
  // Fixed classifications only: never persist the provider's prose or URLs.
  const message=String(value.error?.message??'');
  summary.messageClass=/unknown command/i.test(message)?'unknown_command':/unknown flag/i.test(message)?'unknown_flag':/part.?id/i.test(message)?'part_id_related':/JSON|unmarshal|marshal|parse/i.test(message)?'json_processing':message?'other':'absent';
 }
 return summary;
}
const original=dws.run.bind(dws);
dws.run=async(args,...rest)=>{
 if(!args.includes('whiteboard'))return original(args,...rest);
 try{const result=await original(args,...rest);entry.transport={exit:'success',stdout:inspect(result.stdout),stderr:inspect(result.stderr)};return result;}
 catch(error){entry.transport={exit:typeof error.code==='number'?error.code:token(error.code),stdout:inspect(error.stdout),stderr:inspect(error.stderr)};throw error;}
};
try{
 const result=await dws.runCommand(user,['whiteboard','+query','--node',entry.node,'--part-id',entry.partId],{background:true});
 entry.resultType=result===null?'null':typeof result;
 entry.status=result&&typeof result==='object'?'returned_object':'unverified_response';
}catch(error){entry.status='failed';entry.errorClass=error instanceof TypeError?'javascript_type_error':error instanceof SyntaxError?'javascript_syntax_error':'command_error';entry.category=token(error.dwsCategory);entry.code=token(error.dwsCode);}
await writeFile('output/knowledge-diagnostics/whiteboard-response-live.json',JSON.stringify(entry,null,2));
console.log(JSON.stringify(entry));
