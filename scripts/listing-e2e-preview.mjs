import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const [docx,output='output/listing/e2e/preview']=process.argv.slice(2);
if(!docx)throw new Error('Downloaded DOCX required');
const root='/tmp/listing-real-e2e-'+randomUUID();
const docker=(...args)=>execFileSync('docker',['compose','exec','-T','file-worker',...args],{encoding:'utf8',maxBuffer:32_000_000});
const bytes=(await readFile(docx)).toString('base64');
await mkdir(output,{recursive:true});
try {
 execFileSync('docker',['compose','exec','-T','file-worker','node'],{input:`const fs=require('fs');fs.mkdirSync('${root}',{recursive:true});fs.writeFileSync('${root}/report.docx',Buffer.from('${bytes}','base64'));`,encoding:'utf8'});
 docker('env','HOME='+root,'XDG_CACHE_HOME='+root+'/cache','libreoffice','-env:UserInstallation=file://'+root+'/lo','--headless','--convert-to','pdf','--outdir',root,root+'/report.docx');
 const info=docker('pdfinfo',root+'/report.pdf'),pages=Number(/Pages:\s+(\d+)/.exec(info)?.[1]);
 if(!pages)throw new Error('No PDF pages');
 docker('pdftoppm','-f','1','-l','2','-scale-to','1200','-png',root+'/report.pdf',root+'/page');
 docker('pdftoppm','-f',String(pages),'-l',String(pages),'-scale-to','1200','-png',root+'/report.pdf',root+'/page');
 const names=JSON.parse(docker('node','-e',`process.stdout.write(JSON.stringify(require('fs').readdirSync('${root}').filter(n=>/\.png$|report\.pdf$/.test(n))))`));
 for(const name of names){const b=docker('node','-e',`process.stdout.write(require('fs').readFileSync('${root}/${name}').toString('base64'))`);await writeFile(output+'/'+name,Buffer.from(b,'base64'));}
 console.log(JSON.stringify({downloadedDocxRendered:true,pages,output,files:names}));
} finally {
 if(!/^\/tmp\/listing-real-e2e-[a-f0-9-]+$/.test(root))throw new Error('Unsafe cleanup path');
 docker('node','-e',`require('fs').rmSync('${root}',{recursive:true,force:true})`);
}
