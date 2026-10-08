export function knowledgeWorkerError(error:unknown):string {
 const failure=error as {code?:unknown;killed?:boolean;signal?:unknown;stderr?:unknown};
 if(failure.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER')return 'KNOWLEDGE_WORKER_OUTPUT_LIMIT';
 if(failure.killed&&failure.signal)return 'KNOWLEDGE_WORKER_PARSE_TIMEOUT';
 const code=String(failure.stderr??'').trim();
 return /^KNOWLEDGE_[A-Z_0-9]{1,100}$/.test(code)?code:'KNOWLEDGE_BINARY_PARSE_FAILED';
}
