import type {Pool} from 'pg';
import type {UserIdentity} from './types.js';
import {fingerprint} from './knowledge-parse.js';
import {randomUUID} from 'node:crypto';
import {sheetExportDiagnostic,sheetExportResult} from './knowledge-sheet-job.js';

// This is an outcome journal, not a cache or source-version proof. Successful
// fresh reads still download the current full workbook through the official
// CLI. The stock export command has no resume leaf; downloadJob queries the
// official underlying API using a persisted, actual job ID.
export class KnowledgeSheetExport {
 public constructor(private readonly pool:Pool){}
 public async downloadJob(user:UserIdentity,node:string,sourceHash:string,
  protocol:{submit:()=>Promise<unknown>;query:(job:string,timeout?:number)=>Promise<unknown>;download:(url:string,timeout?:number)=>Promise<void>},validate:()=>Promise<void>,
  wait:(ms:number)=>Promise<void> = ms=>new Promise(resolve=>setTimeout(resolve,ms)),entryNode=node):Promise<void>{
  if(!/^[a-f0-9]{64}$/.test(sourceHash))throw new Error('KNOWLEDGE_SOURCE_HASH_INVALID');
  const client=await this.pool.connect(),args=[user.corpId,user.userId,node],key=fingerprint(['knowledge-sheet-export',...args]);let locked=false,job:string|undefined,stage='submit',attempt=randomUUID();
  const event=async(name:string,diagnostic?:Record<string,unknown>)=>{await client.query(`INSERT INTO knowledge_export_events(corp_id,user_id,node_id,kind,attempt_id,event,job_id,source_hash,diagnostic)
   VALUES($1,$2,$3,'sheet',$4,$5,$6,$7,$8)`,[...args,attempt,name,job??null,sourceHash,diagnostic?JSON.stringify(diagnostic):null]);};
  try{
   locked=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key])).rows[0].locked;
   if(!locked)throw new Error('KNOWLEDGE_SHEET_EXPORT_BUSY');
   const old=(await client.query('SELECT state,job_id,source_hash,attempt_id FROM knowledge_sheet_exports WHERE corp_id=$1 AND user_id=$2 AND node_id=$3',args)).rows[0];
   if(old&& !['complete','retry_authorized'].includes(old.state)){
    if(!old.job_id||old.source_hash!==sourceHash)throw Object.assign(new Error('KNOWLEDGE_SHEET_EXPORT_PENDING_RESOLUTION'),{dwsJobId:old.job_id??undefined});
    job=old.job_id;
    attempt=old.attempt_id??attempt;
    await event('resume_known_job');
   }else{
    if(old?.state==='retry_authorized'&&old.job_id)throw new Error('KNOWLEDGE_SHEET_REISSUE_KNOWN_JOB_FORBIDDEN');
    if(old?.state==='complete')await event('prior_complete',{jobId:old.job_id??null});
    await client.query(`INSERT INTO knowledge_sheet_exports(corp_id,user_id,node_id,state,source_hash,stage,entry_node_id) VALUES($1,$2,$3,'starting',$4,'submit',$5)
     ON CONFLICT(corp_id,user_id,node_id) DO UPDATE SET state='starting',job_id=NULL,source_hash=$4,stage='submit',diagnostic=NULL,updated_at=now()`,[...args,sourceHash,entryNode]);
    await client.query('UPDATE knowledge_sheet_exports SET attempt_id=$4 WHERE corp_id=$1 AND user_id=$2 AND node_id=$3',[...args,attempt]);
    await event('submit_started');
   }
   try{
    const deadline=Date.now()+360_000;
    const remaining=()=>{const ms=deadline-Date.now();if(ms<=0)throw new Error('KNOWLEDGE_SHEET_EXPORT_BUDGET_TIMEOUT');return Math.min(ms,60_000);};
    if(!job){
     const submitted=sheetExportResult(await protocol.submit());
     if(typeof submitted.jobId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(submitted.jobId))throw new Error('KNOWLEDGE_SHEET_EXPORT_JOB_MISSING');
     job=submitted.jobId;
     // Persist before any query, wait or download. Never infer an ID.
     await client.query('UPDATE knowledge_sheet_exports SET job_id=$4,stage=\'query\',updated_at=now() WHERE corp_id=$1 AND user_id=$2 AND node_id=$3',[...args,job]);
     await event('job_received');
    }
    stage='query';let url:string|undefined;
    for(let attempt=0;attempt<30;attempt++){
     if(attempt){const delay=attempt<5?2000:attempt<10?5000:attempt<20?10000:15000;if(deadline-Date.now()<=delay)throw new Error('KNOWLEDGE_SHEET_EXPORT_BUDGET_TIMEOUT');await wait(delay);}
     const result=sheetExportResult(await protocol.query(job!,remaining()));
     const status=String(result.status??'').trim().toUpperCase();
     await event('query_result',{status:['SUCCESS','FAILED','FAIL','ERROR','PROCESSING','RUNNING','DOING','PENDING'].includes(status)?status:'UNKNOWN',poll:attempt+1});
     if(status==='SUCCESS'){if(typeof result.downloadUrl!=='string'||!result.downloadUrl)throw new Error('KNOWLEDGE_SHEET_EXPORT_URL_MISSING');url=result.downloadUrl;break;}
     if(['FAILED','FAIL','ERROR'].includes(status))throw Object.assign(new Error('KNOWLEDGE_SHEET_EXPORT_JOB_FAILED'),{dwsServerCode:typeof result.code==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(result.code)?result.code:undefined});
     if(!['PROCESSING','RUNNING','DOING','PENDING'].includes(status))throw new Error('KNOWLEDGE_SHEET_EXPORT_STATUS_INVALID');
    }
    if(!url)throw new Error('KNOWLEDGE_SHEET_EXPORT_PROCESSING_TIMEOUT');
    stage='download';await event('download_started');await protocol.download(url,remaining());stage='validate';await event('validate_started');await validate();
    await client.query("UPDATE knowledge_sheet_exports SET state='complete',stage='complete',diagnostic=NULL,updated_at=now() WHERE corp_id=$1 AND user_id=$2 AND node_id=$3",args);
    await event('complete');
   }catch(error){
    if(error instanceof Error)Object.assign(error,{exportStage:stage,dwsJobId:job});
    await client.query("UPDATE knowledge_sheet_exports SET state='failed',stage=$4,diagnostic=$5,updated_at=now() WHERE corp_id=$1 AND user_id=$2 AND node_id=$3",[...args,stage,JSON.stringify(sheetExportDiagnostic(error))]);
    await event('failed',sheetExportDiagnostic(error));
    throw error;
   }
  }finally{if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);client.release();}
 }
 public async download(user:UserIdentity,node:string,submit:()=>Promise<unknown>,validate:()=>Promise<void>):Promise<void>{
  const client=await this.pool.connect(),key=fingerprint(['knowledge-sheet-export',user.corpId,user.userId,node]);let locked=false;
  try{
   locked=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[key])).rows[0].locked;
   if(!locked)throw new Error('KNOWLEDGE_SHEET_EXPORT_BUSY');
   const args=[user.corpId,user.userId,node];
   const old=(await client.query('SELECT state,job_id FROM knowledge_sheet_exports WHERE corp_id=$1 AND user_id=$2 AND node_id=$3',args)).rows[0];
   if(old&&old.state!=='complete')throw Object.assign(new Error('KNOWLEDGE_SHEET_EXPORT_PENDING_RESOLUTION'),{dwsJobId:old.job_id??undefined});
   await client.query(`INSERT INTO knowledge_sheet_exports(corp_id,user_id,node_id,state) VALUES($1,$2,$3,'starting')
    ON CONFLICT(corp_id,user_id,node_id) DO UPDATE SET state='starting',job_id=NULL,updated_at=now()`,args);
   try{
    const result=await submit() as {jobId?:unknown};
    if(typeof result?.jobId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(result.jobId))await client.query('UPDATE knowledge_sheet_exports SET job_id=$4 WHERE corp_id=$1 AND user_id=$2 AND node_id=$3',[...args,result.jobId]);
    await validate();
    await client.query(`UPDATE knowledge_sheet_exports SET state='complete',updated_at=now() WHERE corp_id=$1 AND user_id=$2 AND node_id=$3`,args);
   }catch(error){
    const job=(error as {dwsJobId?:string})?.dwsJobId;
    await client.query(`UPDATE knowledge_sheet_exports SET state='failed',job_id=COALESCE(job_id,$4),updated_at=now() WHERE corp_id=$1 AND user_id=$2 AND node_id=$3`,
     [...args,typeof job==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(job)?job:null]);
    throw error;
   }
  }finally{if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);client.release();}
 }
}
