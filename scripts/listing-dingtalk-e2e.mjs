// Explicitly authorized real user -> robot conversation. No internal task injection.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const exec=promisify(execFile),cli=join(process.env.APPDATA,'npm/node_modules/dingtalk-workspace-cli/bin/dws.js');
const [profile,group,bot,promptPath]=process.argv.slice(2);
if(!profile||!group||!bot||!promptPath)throw new Error('Usage: node scripts/listing-dingtalk-e2e.mjs <explicit-profile> <verified-group> <verified-bot-id> <prompt-file>');
const output='output/listing/e2e';await mkdir(output,{recursive:true});
const health=await fetch('http://127.0.0.1:8080/readyz');
if(!health.ok)throw new Error('Gateway must be healthy before sending a real conversation');
const dws=async(args)=>JSON.parse((await exec(process.execPath,[cli,'--profile',profile,...args,'--format','json'],{maxBuffer:8_000_000,timeout:90000})).stdout);
const text=`<@${bot}> ` + await readFile(promptPath,'utf8'),startedAt=new Date().toISOString(),uuid=randomUUID();
const sent=await dws(['chat','+messages-send','--identity','user','--group',group,'--at-open-dingtalk-ids',bot,'--text',text,'--uuid',uuid,'--yes']);
// Keep delivery IDs and outcomes; never persist temporary signed resource URLs.
const sanitize=v=>Array.isArray(v)?v.map(sanitize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!/token|secret|signature|downloadurl|resourceurl/i.test(k)).map(([k,x])=>[k,sanitize(x)])):typeof v==='string'&&/OSSAccessKeyId=|Signature=/.test(v)?'[temporary resource URL omitted]':v;
await writeFile(output+'/send-'+uuid+'.json',JSON.stringify({startedAt,profile,group,uuid,result:sanitize(sent)},null,2));
console.log(JSON.stringify({realDwsSend:true,uuid,startedAt,result:sanitize(sent)}));
let messages=[];
let filesDelivered=false;
const receivedFiles=items=>items.filter(m=>m.senderId===bot).flatMap(m=>(m.resourceRefs??[]).filter(r=>r.resourceId&&r.resourceIdType==='fileId'&&/^listing-[a-f0-9]{64}\.(docx|xlsx)$/.test(r.name??'')));
for(let i=0;i<60;i++){
 await new Promise(r=>setTimeout(r,20000));
 const result=await dws(['chat','+chat-messages','--group',group,'--start',startedAt,'--page-all','--page-limit','5','--max-items','100','--no-reactions']);
 messages=result.messages??result.data?.messages??[];
 await writeFile(output+'/messages-'+uuid+'.json',JSON.stringify(sanitize(result),null,2));
 const fromRobot=messages.filter(m=>m.sender==='Agent智能助手');
 console.log(JSON.stringify({poll:i+1,messageCount:messages.length,robotMessages:fromRobot.length,last:fromRobot[0]?.text?.slice(0,350)}));
 const files=receivedFiles(messages);
 if(files.some(f=>f.name.endsWith('.docx'))&&files.some(f=>f.name.endsWith('.xlsx'))){
  console.log(JSON.stringify({filesVisibleInOriginalConversation:true,group,uuid}));break;
 }
}
const files=receivedFiles(messages);
filesDelivered=files.some(f=>f.name.endsWith('.docx'))&&files.some(f=>f.name.endsWith('.xlsx'));
console.log(JSON.stringify({robotResponseObserved:messages.some(m=>m.sender==='Agent智能助手'),filesDelivered,group,uuid,messages:messages.length}));
if(!filesDelivered)process.exitCode=1;
