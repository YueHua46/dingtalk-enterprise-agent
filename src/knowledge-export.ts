import type {Pool} from 'pg';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {chmod,copyFile,mkdir,rename,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import type {UserIdentity} from './types.js';

async function digest(path:string):Promise<string>{
 const hash=createHash('sha256');for await(const part of createReadStream(path))hash.update(part);return hash.digest('hex');
}
// The current document has already been fetched as this employee before entry.
// Cached exports convey no permission; source equality is rechecked on every use.
export class KnowledgeExport {
 public constructor(private readonly pool:Pool,private readonly directory:string,private readonly maxBytes:number,private readonly validate:(path:string)=>Promise<void>){}
 public async retireArtifacts():Promise<void>{
  const eligible=`e.artifact_hash IS NOT NULL AND e.updated_at<now()-interval '30 days'
   AND NOT EXISTS(SELECT 1 FROM knowledge_versions v WHERE v.corp_id=e.corp_id AND v.user_id=e.user_id AND v.node_id=e.node_id
    AND v.source_hash=e.source_hash AND (v.retired_at IS NULL OR v.retired_at>now()-interval '30 days'))`;
  const {rows}=await this.pool.query(`SELECT e.* FROM knowledge_exports e WHERE ${eligible}`);
  for(const row of rows){
   if(!/^[a-f0-9-]{36}$/.test(row.id))throw new Error('KNOWLEDGE_EXPORT_RECORD_INVALID');
   const client=await this.pool.connect(),key=JSON.stringify(['knowledge-export',row.corp_id,row.user_id,row.node_id,row.source_hash]);
   let locked=false;
   try{
    locked=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key])).rows[0].locked;
    if(!locked)continue;
    if(!(await client.query(`SELECT 1 FROM knowledge_exports e WHERE e.id=$1 AND ${eligible}`,[row.id])).rowCount)continue;
    await rm(join(this.directory,'exports',row.id+'.pdf'),{force:true});
    await client.query('UPDATE knowledge_exports SET artifact_hash=NULL,artifact_size=NULL WHERE id=$1',[row.id]);
   }finally{if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);client.release();}
  }
  // Job records intentionally survive artifact expiry: deleting them would
  // authorize a second submission of a previously completed export.
 }
 public async download(user:UserIdentity,node:string,sourceHash:string,destination:string,
   submit:()=>Promise<unknown>,resume:(jobId:string)=>Promise<unknown>,verify:()=>Promise<void>):Promise<void>{
  if(!/^[a-f0-9]{64}$/.test(sourceHash))throw new Error('KNOWLEDGE_EXPORT_SOURCE_INVALID');
  const client=await this.pool.connect(),key=JSON.stringify(['knowledge-export',user.corpId,user.userId,node,sourceHash]);let locked=false;
  try{
   locked=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key])).rows[0].locked;
   if(!locked)throw new Error('KNOWLEDGE_EXPORT_BUSY');
   await this.downloadLocked(user,node,sourceHash,destination,submit,resume,verify);
  }finally{if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);client.release();}
 }
 private async downloadLocked(user:UserIdentity,node:string,sourceHash:string,destination:string,
   submit:()=>Promise<unknown>,resume:(jobId:string)=>Promise<unknown>,verify:()=>Promise<void>):Promise<void>{
  const scope=[user.corpId,user.userId,node];
  const legacy=await this.pool.query('SELECT job_id FROM knowledge_exports WHERE corp_id=$1 AND user_id=$2 AND node_id=$3 AND source_hash IS NULL AND format=\'pdf\'',scope);
  if(legacy.rows.length)throw Object.assign(new Error('KNOWLEDGE_EXPORT_SOURCE_UNBOUND'),{dwsJobId:legacy.rows[0].job_id});
  const args=[...scope,sourceHash];
  const claimed=await this.pool.query(`INSERT INTO knowledge_exports(corp_id,user_id,node_id,source_hash,format,state)
   VALUES($1,$2,$3,$4,'pdf','starting') ON CONFLICT DO NOTHING RETURNING *`,args);
  const record=claimed.rows[0]??(await this.pool.query(`SELECT * FROM knowledge_exports WHERE corp_id=$1 AND user_id=$2 AND node_id=$3 AND source_hash=$4 AND format='pdf'`,args)).rows[0];
  if(!record||!/^[a-f0-9-]{36}$/.test(record.id))throw new Error('KNOWLEDGE_EXPORT_RECORD_INVALID');
  const cache=join(this.directory,'exports',record.id+'.pdf');
  if(!claimed.rows.length&&record.state==='complete'){
   try{
    const info=await stat(cache);
    if(info.size!==Number(record.artifact_size)||!info.size||info.size>this.maxBytes||await digest(cache)!==record.artifact_hash)throw new Error('KNOWLEDGE_EXPORT_CACHE_INVALID');
    await verify();await copyFile(cache,destination);await this.validate(destination);
    await this.pool.query('UPDATE knowledge_exports SET updated_at=now() WHERE id=$1',[record.id]);return;
   }catch(error){
    if(!(error instanceof Error&&(error as NodeJS.ErrnoException).code==='ENOENT'))throw error;
    // Missing artifact is recovered only from the existing job, never submit.
   }
  }
  if(!claimed.rows.length&&!record.job_id)throw new Error('KNOWLEDGE_EXPORT_OUTCOME_UNKNOWN');
  const temporary=cache+'.'+randomUUID()+'.tmp';
  try{
   if(claimed.rows.length)await submit();else await resume(record.job_id);
   await verify();
   const info=await stat(destination);
   if(!info.size||info.size>this.maxBytes)throw new Error('KNOWLEDGE_EXPORT_SIZE_INVALID');
   await this.validate(destination);
   const hash=await digest(destination);await mkdir(join(this.directory,'exports'),{recursive:true});
   await copyFile(destination,temporary);await chmod(temporary,0o600);await rename(temporary,cache);
   await this.pool.query(`UPDATE knowledge_exports SET state='complete',artifact_hash=$2,artifact_size=$3,updated_at=now() WHERE id=$1`,[record.id,hash,info.size]);
  }catch(error){
   const job=(error as {dwsJobId?:string})?.dwsJobId;
   const jobId=record.job_id??(typeof job==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(job)?job:undefined);
   await this.pool.query(`UPDATE knowledge_exports SET state=$2,job_id=$3,updated_at=now() WHERE id=$1`,[record.id,jobId?'job_known':'failed',jobId??null]);
   await rm(temporary,{force:true});throw error;
  }
 }
}
