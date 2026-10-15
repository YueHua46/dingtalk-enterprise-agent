// Explicitly authorized employee -> robot private conversation. No task injection.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

const [mode,directory,profile,bot,promptPath]=process.argv.slice(2);
if(!['send','read','download'].includes(mode)||!directory||!profile||!bot)
  throw Error('Usage: node scripts/advertising-dingtalk-e2e.mjs send|read|download <output-directory> <explicit-profile> <verified-bot-id> [prompt-file]');
const exec=promisify(execFile),cli=join(process.env.APPDATA,'npm/node_modules/dingtalk-workspace-cli/bin/dws.js');
const sanitize=v=>Array.isArray(v)?v.map(sanitize):v&&typeof v==='object'
  ?Object.fromEntries(Object.entries(v).filter(([k])=>!/token|secret|signature|downloadurl|resourceurl/i.test(k)).map(([k,x])=>[k,sanitize(x)]))
  :typeof v==='string'&&/OSSAccessKeyId=|Signature=|[?&](?:token|signature)=/i.test(v)?'[temporary resource URL omitted]':v;
const dws=async args=>JSON.parse((await exec(process.execPath,[cli,'--profile',profile,...args,'--format','json'],{maxBuffer:12_000_000,timeout:90000})).stdout);
await mkdir(directory,{recursive:true});
const manifestPath=join(directory,'request.json');
if(mode==='send') {
  if(!promptPath)throw Error('Prompt file required');
  if(!(await fetch('http://127.0.0.1:8080/readyz')).ok)throw Error('Gateway not healthy');
  const manifest={profile,bot,startedAt:new Date().toISOString(),uuid:randomUUID(),prompt:await readFile(promptPath,'utf8')};
  // Persist intent before the network call. Never resend automatically after an unknown result.
  await writeFile(manifestPath,JSON.stringify(manifest,null,2),{flag:'wx'});
  const sent=await dws(['chat','+messages-send','--as','user','--open-dingtalk-id',bot,'--text',manifest.prompt,'--uuid',manifest.uuid,'--yes']);
  await writeFile(join(directory,'sent.json'),JSON.stringify(sanitize(sent),null,2));
  console.log(JSON.stringify({startedAt:manifest.startedAt,uuid:manifest.uuid,result:sanitize(sent)}));
} else {
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  if(manifest.profile!==profile||manifest.bot!==bot)throw Error('IDENTITY_OR_TARGET_MISMATCH');
  const result=await dws(['chat','+chat-messages','--open-dingtalk-id',bot,'--start',manifest.startedAt,
    '--page-all','--page-limit','5','--max-items','100','--no-reactions',
    ...(mode==='download'?['--download-resources','--output-dir',directory+'/attachments']:[])]);
  await writeFile(join(directory,mode==='download'?'download.json':'messages.json'),JSON.stringify(sanitize(result),null,2));
  const messages=result.messages??result.data?.messages??[];
  console.log(JSON.stringify({complete:result.complete,hasMore:result.hasMore,stopReason:result.stopReason,
    count:messages.length,messages:messages.map(m=>sanitize({messageId:m.messageId,sender:m.sender,senderId:m.senderId,
      text:m.text,type:m.type,resourceRefs:m.resourceRefs})),
    ...(mode==='download'?{downloads:sanitize(result.downloads??result.downloadLedger??result.resourceDownloads??result)}:{})}));
}
