// Official CLI user-defined shortcuts; same profile, gateway and permission checks.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
const dir=join(process.env.DWS_CONFIG_DIR||join(homedir(),'.dws'),'shortcuts');
await mkdir(dir,{recursive:true});
for(const [command,tool,flag,param,extra] of [
 ['knowledge-export-submit','submit_export_job','node','nodeId','    exportFormat: xlsx\n'],
 ['knowledge-export-get','query_export_job','job-id','jobId','']]){
 const text=`version: 1\nservice: sheet\ncommand: +${command}\nproduct: sheet\ndescription: Knowledge export ${tool}\nrisk: read\nsource: manual\nflags:\n  - name: ${flag}\n    type: string\n    required: true\nexecute:\n  tool: ${tool}\n  bind:\n    ${param}: "\${${flag}}"\n${extra}`;
 const file=join(dir,`sheet.${command}.yaml`);
 const old=await readFile(file,'utf8').catch(e=>{if(e.code==='ENOENT')return undefined;throw e;});
 if(old!==undefined&&old!==text)throw new Error('SHORTCUT_EXISTING_CONTENT_MISMATCH');
 if(old===undefined)await writeFile(file,text,{flag:'wx'});
 console.log('installed '+command);
}
