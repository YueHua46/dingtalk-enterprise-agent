import {setTimeout as delay} from 'node:timers/promises';

export type ModelRetryState = {attempts:number;deadlineAt:number};
type RetryOptions = {
  errorPrefix?: string;
  maxAttempts:number;
  budgetMs:number;
  /** Maximum time to wait for response headers on one upstream attempt. */
  attemptTimeoutMs?:number;
  state?:ModelRetryState;
  http?:typeof fetch;
  retryDelayMs?:(attempt:number)=>number;
  onRetry?:(event:{attempt:number;status?:number;reason:'http'|'transport';waitMs:number})=>void;
};

function retryAfter(value:string|null):number|undefined {
  if(value===null)return undefined;
  const ms=/^\d+(?:\.\d+)?$/.test(value.trim())?Number(value)*1000:Date.parse(value)-Date.now();
  return Number.isFinite(ms)?Math.max(0,ms):NaN;
}
function transientTransport(error:unknown):boolean {
  const e=error as {name?:string;code?:string;cause?:{code?:string}};
  if(e.name==='AbortError'||e.name==='TimeoutError')return false;
  return e.name==='TypeError'||['ECONNRESET','ECONNREFUSED','EPIPE','ETIMEDOUT','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT'].includes(e.code??e.cause?.code??'');
}

/** Retry only before a response is returned to its caller. No SSE fragment or
 * tool call is replayed. Parent cancellation still aborts the returned stream. */
export async function requestModelWithRetry(url:string,init:RequestInit,options:RetryOptions):Promise<{response:Response;attempts:number}> {
  const errorPrefix=options.errorPrefix??'MODEL_REQUEST';
  const state=options.state??{attempts:0,deadlineAt:Date.now()+options.budgetMs};
  while(state.attempts<options.maxAttempts){
    init.signal?.throwIfAborted();
    const remaining=state.deadlineAt-Date.now();
    if(remaining<=0)throw new Error(`${errorPrefix}_RETRY_BUDGET_EXCEEDED`);
    const headersTimeout=new AbortController();
    const attemptTimeout=Math.min(remaining, options.attemptTimeoutMs ?? remaining);
    let attemptTimedOut=false;
    const timer=setTimeout(()=>{attemptTimedOut=true; headersTimeout.abort();},attemptTimeout);
    const signal=init.signal?AbortSignal.any([init.signal,headersTimeout.signal]):headersTimeout.signal;
    state.attempts++;
    let response:Response|undefined,error:unknown;
    try{response=await (options.http??fetch)(url,{...init,signal});}catch(cause){error=cause;}finally{clearTimeout(timer);}
    if(response&&!([429,502,503,504].includes(response.status)))return {response,attempts:state.attempts};
    // An attempt-local timeout is retryable. A caller cancellation remains
    // terminal. Retrying here is safe because no response (and therefore no
    // tool call or side effect) has been returned to the model client.
    if(error&&(init.signal?.aborted||(!attemptTimedOut&&!transientTransport(error))))throw error;
    if(state.attempts>=options.maxAttempts){
      if(response)return {response,attempts:state.attempts};
      throw new Error(`${errorPrefix}_RETRY_EXHAUSTED`);
    }
    const specified=response?retryAfter(response.headers.get('retry-after')):undefined;
    const waitMs=specified??options.retryDelayMs?.(state.attempts)??(Math.min(20_000,1000*3**(state.attempts-1))+Math.floor(Math.random()*500));
    // Never replace a longer server-requested wait with an earlier retry.
    if(!Number.isFinite(waitMs)||waitMs>=state.deadlineAt-Date.now()){
      if(response)return {response,attempts:state.attempts};
      throw new Error(`${errorPrefix}_RETRY_BUDGET_EXCEEDED`);
    }
    options.onRetry?.({attempt:state.attempts,...(response?{status:response.status}:{}),reason:response?'http':'transport',waitMs});
    await response?.body?.cancel().catch(()=>undefined);
    await delay(waitMs,undefined,init.signal?{signal:init.signal}:undefined);
  }
  throw new Error(`${errorPrefix}_RETRY_EXHAUSTED`);
}

export const requestWithRetry = requestModelWithRetry;
