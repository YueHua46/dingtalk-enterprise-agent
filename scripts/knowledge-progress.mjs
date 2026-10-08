import {writeFile,rename} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

export function ingestionHasGaps(counts){
 return Object.values(counts).some(c=>c.failed>0||c.needsReview>0||c.processed<c.total);
}

// Windows readers and antivirus can briefly lock the rename target.
export async function writeProgress(path,snapshot,io={writeFile,rename,delay}){
 await io.writeFile(path+'.tmp',snapshot);
 for(let attempt=0;;attempt++){
  try{await io.rename(path+'.tmp',path);return;}
  catch(error){
   if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=7)throw error;
   await io.delay(100*(attempt+1));
  }
 }
}
