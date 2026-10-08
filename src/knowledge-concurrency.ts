// Preserve document order while limiting work and draining in-flight calls on failure.
export async function mapConcurrent<T,R>(items:T[],limit:number,work:(item:T,index:number)=>Promise<R>):Promise<R[]> {
  if(!Number.isInteger(limit)||limit<1)throw new Error('KNOWLEDGE_CONCURRENCY_INVALID');
  const result:R[]=[];let cursor=0,failed=false,error:unknown;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
    while(!failed){
      const index=cursor++;if(index>=items.length)return;
      try{result[index]=await work(items[index]!,index);}catch(e){if(!failed){failed=true;error=e;}}
    }
  }));
  if(failed)throw error;
  return result;
}
