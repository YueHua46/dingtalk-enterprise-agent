// Text producers and image consumers share one host/model concurrency pool.
// A resource is eligible for images only after its text transaction completes.
export async function runKnowledgePipeline<T>(items:T[],text:(item:T)=>Promise<boolean>,images:(item:T)=>Promise<void>,
  options:{textConcurrency:number;imageConcurrency:number;shouldContinue?:()=>boolean}):Promise<void> {
  const pending:T[]=[],waiting:Array<(item:T|undefined)=>void>=[];
  let closed=false,index=0,failed=false,error:unknown;
  const continuing=()=>!failed&&(options.shouldContinue?.()??true);
  const put=(item:T)=>{const waiter=waiting.shift();if(waiter)waiter(item);else pending.push(item);};
  const take=():Promise<T|undefined>=>pending.length?Promise.resolve(pending.shift()):closed?Promise.resolve(undefined):new Promise(resolve=>waiting.push(resolve));
  const record=(e:unknown)=>{if(!failed){failed=true;error=e;}};
  for(const n of [options.textConcurrency,options.imageConcurrency])if(!Number.isInteger(n)||n<1)throw new Error('KNOWLEDGE_CONCURRENCY_INVALID');
  const consumers=Array.from({length:options.imageConcurrency},async()=>{
    while(true){const item=await take();if(item===undefined)return;if(!continuing())continue;
      try{await images(item);}catch(e){record(e);}
    }
  });
  await Promise.all(Array.from({length:options.textConcurrency},async()=>{
    while(continuing()){
      const item=items[index++];if(item===undefined)return;
      try{if(await text(item)&&continuing())put(item);}catch(e){record(e);}
    }
  }));
  closed=true;for(const waiter of waiting.splice(0))waiter(undefined);
  await Promise.all(consumers);
  if(failed)throw error;
}
