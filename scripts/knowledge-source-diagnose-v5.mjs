import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {documentImageReferences} from '../dist/knowledge-source.js';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';import {homedir} from 'node:os';
const user={corpId:'ding5cc0e9161525554835c2f4657eb6378f',userId:'1769391205643357'};
const dws=new DwsBroker(loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws')}));
const results=[];
for(const [node,kind] of [['QG53mjyd80ynBzl9HjN9dMrXW6zbX04v','inspect'],['2Amq4vjg89exoYN2tvDwADGw83kdP0wQ','inspect'],['QG53mjyd80ynBzl9HQZrN3bBW6zbX04v','fetch']]){
 const entry={node,kind,checkedAt:new Date().toISOString()};results.push(entry);
 try{
 const r=await dws.runCommand(user,['doc','+'+kind,'--node',node,...(kind==='fetch'?['--scope','full','--detail','full']:[])],{background:true});
 if(kind==='inspect'){const d=r.document??r.data?.document;entry.resultKeys=Object.keys(r);entry.documentKeys=Object.keys(d??{});entry.extension=d?.extension;entry.hasLinkSource=!!d?.linkSourceInfo;}
 else {entry.complete=r.complete;entry.images=documentImageReferences(r.content.jsonml).map(x=>({block:x.block,whiteboard:x.whiteboard,hasResourceId:!!x.resourceId}));}
 }catch(e){entry.failure={code:e.dwsCode,category:e.dwsCategory,reason:e.dwsReason,retryable:e.dwsRetryable};}
}
await writeFile('output/knowledge-diagnostics/v5-source-failures.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
