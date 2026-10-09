import {createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {DwsBroker} from './dws-broker.js';
import type {UserIdentity} from './types.js';

const safe=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(v)?v:undefined;
export function sheetExportDiagnostic(error:unknown):Record<string,unknown>{
 const e=error as Record<string,unknown>;
 return Object.fromEntries(Object.entries({stage:safe(e?.exportStage),code:safe(e?.dwsServerCode??e?.dwsCode),
  reason:safe(e?.dwsReason),requestId:safe(e?.dwsRequestId),jobId:safe(e?.dwsJobId),
  transportKind:safe(e?.dwsTransportKind),operation:safe(e?.dwsOperation),
  networkCode:safe(e?.cause instanceof Error?(e.cause as Error&{code?:string}).code:undefined)}).filter(([,v])=>v!==undefined));
}
export function sheetExportResult(value:unknown):Record<string,any>{
 let data=value as Record<string,any>;
 if(data?.result&&typeof data.result==='object')data=data.result;
 if(!data||typeof data!=='object')throw new Error('KNOWLEDGE_SHEET_EXPORT_RESPONSE_INVALID');
 if(data.success===false||data.error)throw Object.assign(new Error('KNOWLEDGE_SHEET_EXPORT_SERVER_ERROR'),{
  dwsServerCode:safe(data.error?.code??data.code),dwsRequestId:safe(data.requestId??data.traceId??data.error?.requestId)});
 return data;
}
export function sheetExportProtocol(dws:DwsBroker,user:UserIdentity,node:string,path:string,maxBytes:number,background:boolean){
 return {
  submit:async()=>sheetExportResult(await dws.runCommand(user,['sheet','+knowledge-export-submit','--node',node],{background})),
  query:async(job:string,timeout=60_000)=>sheetExportResult(await dws.runCommand(user,['sheet','+knowledge-export-get','--job-id',job],{background,timeout})),
  download:async(raw:string,timeout=60_000)=>{
   const url=new URL(raw);
   if(url.protocol!=='https:'||url.username||url.password)throw new Error('KNOWLEDGE_EXPORT_URL_INVALID');
   // The URL is exclusively the current same-employee official query result.
   const response=await fetch(url,{signal:AbortSignal.timeout(timeout),redirect:'error'});
   if(!response.ok)throw Object.assign(new Error('KNOWLEDGE_SHEET_DOWNLOAD_HTTP_'+response.status),{
    dwsServerCode:'HTTP_'+response.status,dwsRequestId:safe(response.headers.get('x-request-id'))});
   if(!response.body)throw new Error('KNOWLEDGE_BINARY_EMPTY');
   let total=0;
   async function* bounded(){for await(const chunk of Readable.fromWeb(response.body as any)){
    total+=chunk.length;if(total>maxBytes)throw new Error('KNOWLEDGE_SOURCE_SIZE_LIMIT');yield chunk;
   }if(!total)throw new Error('KNOWLEDGE_BINARY_EMPTY');}
   await pipeline(bounded(),createWriteStream(path,{flags:'wx',mode:0o600}));
  }
 };
}
