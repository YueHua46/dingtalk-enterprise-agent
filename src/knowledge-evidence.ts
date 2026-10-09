/** Preserve source identity and gaps when fitting knowledge evidence into the
 * verifier's context. Cutting raw JSON loses these fields and can confuse two
 * different documents. Complete passages are retained when they fit; omissions are explicit. */
export function knowledgeEvidenceExcerpt(text:string,request?:unknown):string|undefined {
  let result:any;
  try{result=JSON.parse(text);}catch{return undefined;}
  if(!result||typeof result!=='object'||(!result.source&&!Array.isArray(result.hits)&&!Array.isArray(result.facts)))return undefined;
  const entries:Array<{kind:string;source:unknown;position:unknown;text?:string;attribute?:string;value?:string;model?:string;scope?:unknown}>=[];
  // Preserve the requested read and ranked evidence before optional whole-
  // source context. A background snapshot must not evict the page just read.
  for(const item of result.chunks??[])entries.push({kind:'passage',source:result.source,position:item.position,text:item.text});
  for(const item of result.hits??[])entries.push({kind:'passage',source:item.source,position:item.position,text:item.text});
  for(const item of result.facts??[])entries.push({kind:'fact',source:item.source,position:item.position,attribute:item.attribute,value:item.value,model:item.model,scope:item.scope});
  for(const item of result.corroboratingEvidence?.hits??[])entries.push({kind:'corroborating_passage',source:item.source,position:item.position,text:item.text});
  for(const doc of [...(result.documents??[]),...(result.corroboratingEvidence?.documents??[])]){
    for(const item of doc.chunks??[])entries.push({kind:'complete_indexed_passage',source:doc.source,position:item.position,text:item.text});
  }
  for(const item of result.assessmentEvidence?.chunks??[])entries.push({kind:'complete_indexed_passage',source:result.assessmentEvidence.source,position:item.position,text:item.text});
  const identity=(source:any)=>[source?.ref,source?.version];
  const sources=[...new Map(entries.map(e=>[JSON.stringify(identity(e.source)),e.source])).values()];
  if(result.source&&!sources.length)sources.push(result.source);
  const base={kind:'knowledge_evidence',request,sources,complete:result.complete,quality:result.quality,
    coverageGaps:result.coverageGaps,positionNotFound:result.positionNotFound,conflicts:result.conflicts,
    corroboration:result.corroboratingEvidence?{complete:result.corroboratingEvidence.complete,coverageGaps:result.corroboratingEvidence.coverageGaps}:undefined,
    evidenceUse:'A passage proves what its own source/version/position says. Related titles, similar fields, or matching numbers do not prove that another screenshot or document has the same content.'};
  // Permission-check timestamps and metadata formatting do not create a new
  // passage. Keep the first occurrence so requested evidence keeps priority.
  const seen=new Set<string>();
  const unique=entries.filter(e=>{const key=JSON.stringify([identity(e.source),e.position,e.text,e.attribute,e.value,e.model,e.scope]);
    if(seen.has(key))return false;seen.add(key);return true;});
  const selected=unique.slice(0,160);
  // Keep complete passages whenever the actual serialized payload fits. An
  // equal per-entry allocation can cut a short one-page specification even
  // while thousands of characters remain unused in the total budget.
  let charLimit=Math.max(100,...selected.map(e=>e.text?.length??0));
  const render=()=>JSON.stringify({...base,entries:selected.map(({source,...e})=>{
    const s=source as {ref?:string;version?:string};
    return {...e,sourceRef:s?.ref,sourceVersion:s?.version,...(e.text?{text:e.text.slice(0,charLimit),textTruncated:e.text.length>charLimit}:{})};
  }),omittedEntries:unique.length-selected.length});
  let output=render();
  while(output.length>40000&&selected.length){if(charLimit>100)charLimit=Math.floor(charLimit/2);else selected.pop();output=render();}
  return output;
}

/** Bind model-selected document identities to observed passages and real
 * metadata URLs. The reviewer checks the semantic attribution separately. */
export function knowledgeCitations(excerpts:Iterable<string>,selectedRefs?:string[]):string|undefined{
  const sources=new Map<string,{title:string;url:string}>();
  for(const text of excerpts){
    try{const value=JSON.parse(text);if(value.kind!=='knowledge_evidence')continue;
      const observed=new Set((value.entries??[]).map((entry:any)=>entry.sourceRef));
      for(const s of value.sources??[]){if(observed.has(s?.ref)&&typeof s?.ref==='string'&&typeof s.title==='string'&&typeof s.url==='string'){
        const url=new URL(s.url);if(url.protocol==='https:'&&url.hostname==='alidocs.dingtalk.com')sources.set(s.ref,{title:s.title,url:s.url});
      }}
    }catch{/* Unstructured evidence is not a citation source. */}
  }
  const unknown=selectedRefs?.filter(ref=>!sources.has(ref))??[];
  if(unknown.length)throw new Error('WORKFLOW_SOURCE_NOT_OBSERVED: 未核验的 sourceRefs='+JSON.stringify(unknown)
    +'。已取得正文的资料身份='+JSON.stringify([...sources].slice(-40).map(([ref,s])=>({ref,title:s.title})))
    +'。这是出处身份填写错误；依据这些已有资料身份修正 sourceRefs，并核对结论对应关系，不要为补引用重复查询。');
  const selected=selectedRefs?.length ? [...new Set(selectedRefs)].map(ref=>sources.get(ref)!) : sources.size===1 ? [...sources.values()] : [];
  return selected.length ? selected.map(source=>`[${source.title.replace(/[\[\]\\]/g,'')}](${source.url})`).join('；') : undefined;
}
