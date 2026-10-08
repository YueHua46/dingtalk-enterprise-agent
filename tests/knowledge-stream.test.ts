import {it,expect} from 'vitest';
import {createServer} from 'node:net';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scanClamAvFile} from '../src/media.js';

it('scans every byte of a file through bounded ClamAV frames before returning success',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'knowledge-scan-')),path=join(directory,'file.pdf');
 const bytes=Buffer.alloc(200_000,23);await writeFile(path,bytes);
 let received=Buffer.alloc(0),frames:number[]=[];
 const server=createServer(socket=>{
   let pending=Buffer.alloc(0),command=false;
   socket.on('data',chunk=>{
     pending=Buffer.concat([pending,chunk]);
     if(!command){if(pending.length<10)return;expect(pending.subarray(0,10).toString()).toBe('zINSTREAM\0');pending=pending.subarray(10);command=true;}
     while(pending.length>=4){const length=pending.readUInt32BE(0);if(pending.length<length+4)return;pending=pending.subarray(4);
       if(!length){socket.end('stream: OK\0');return;}
       frames.push(length);received=Buffer.concat([received,pending.subarray(0,length)]);pending=pending.subarray(length);
     }
   });
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
   const port=(server.address() as {port:number}).port;
   expect(await scanClamAvFile('127.0.0.1',port,path)).toBe('stream: OK');
   expect(received.equals(bytes)).toBe(true);expect(Math.max(...frames)).toBeLessThanOrEqual(64*1024);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
});
