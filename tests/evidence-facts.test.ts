import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {factBindingSchema,prepareFactBindings,factResolutionConfig,factResolutionCode,interpolateFacts} from '../src/evidence-facts.js';
import {describeEvidence} from '../src/evidence-manifest.js';
import {reportRenderTool} from '../src/report-render.js';

describe('host-resolved report facts',()=>{
  it('deduplicates large repeated sources without losing per-fact provenance',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'agent-fact-transport-'));
    try {
      await mkdir(join(dir,'evidence'));
      const raw=JSON.stringify({evidence:{source_evidence_id:'original'},data:{rows:[{scope:'all',amount:1.005}]}});
      await writeFile(join(dir,'evidence/facts.json'),raw);
      const base={file:'facts.json',evidenceId:'metrics',capabilityId:'analysis.table',kind:'calculation' as const,
        arguments:'{}',sha256:createHash('sha256').update(raw).digest('hex'),...describeEvidence(raw)};
      const query={description:'完整来源元数据'.repeat(200),group_by:['scope']};
      const context={marketplace:'US',nested:{filters:[null,true,'all']}};
      const sources=[{...base,query,context},{...base,evidenceId:'alternative',query,context:{...context,marketplace:'JP'}}];
      const bindings=prepareFactBindings(Array.from({length:100},(_,i)=>factBindingSchema.parse({
        id:'amount_'+i,evidenceId:i===99?'alternative':'metrics',where:{scope:'all'},field:'amount',decimals:2
      })),sources);
      const code=factResolutionCode(bindings);
      const encoded=code.match(/base64\.b64decode\('([^']+)'\)/)![1];
      const cfg=JSON.parse(Buffer.from(encoded,'base64').toString());
      expect(cfg.sources).toHaveLength(2);
      expect(cfg.bindings.map((b:any)=>({...b,source:cfg.sources[b.source]}))).toEqual(bindings);
      expect(Buffer.byteLength(JSON.stringify({code}))).toBeLessThan(64*1024);
      expect(Buffer.byteLength(JSON.stringify(bindings))).toBeGreaterThan(64*1024);
      const config=factResolutionConfig(bindings);
      await writeFile(join(dir,'evidence/fact-config.json'),config);
      const driver=factResolutionCode(bindings,{file:'fact-config.json',sha256:createHash('sha256').update(config).digest('hex')});
      expect(driver.length).toBeLessThan(20000);
      const run=(script:string)=>JSON.parse(execFileSync('python',['-'],{cwd:dir,input:script,encoding:'utf8',maxBuffer:4*1024*1024,stdio:['pipe','pipe','pipe']}));
      const facts=run(driver);
      expect(run(code)).toEqual(facts);
      expect(facts).toHaveLength(100);
      facts.forEach((fact:any,i:number)=>expect(fact).toEqual({
        id:'amount_'+i,evidenceId:bindings[i].evidenceId,sourceSha256:base.sha256,
        rowsPath:'data.rows',rowIndex:0,selector:{scope:'all'},field:'amount',value:1.005,display:'1.01',
        query,context:sources[i===99?1:0].context,rowDimensions:{scope:'all',amount:1.005},
        lineage:{source_evidence_id:'original'}
      }));
      await writeFile(join(dir,'evidence/fact-config.json'),config+' ');
      expect(()=>run(driver)).toThrow('FACT_CONFIG_HASH_MISMATCH');
    } finally {await rm(dir,{recursive:true,force:true});}
  });
  it('exports a nullable suffix without empty enum entries and preserves existing no-suffix inputs',()=>{
    const properties=(reportRenderTool.inputSchema as any).properties.fact_bindings.items.properties;
    expect(properties.suffix).toMatchObject({anyOf:[{type:'string',pattern:'^%?$'},{type:'null'}]});
    const assertEnums=(node:unknown):void=>{
      if(!node || typeof node!=='object') return;
      if(Array.isArray(node)) { node.forEach(assertEnums); return; }
      const record=node as Record<string,unknown>;
      if(Array.isArray(record.enum)) expect(record.enum).not.toContain('');
      Object.values(record).forEach(assertEnums);
    };
    assertEnums(reportRenderTool.inputSchema);
    for(const suffix of [undefined,null,'','%']) {
      const parsed=factBindingSchema.parse({id:'fact',evidenceId:'metrics',field:'ctr',
        ...(suffix===undefined?{}:{suffix})});
      expect(parsed.suffix).toBe(suffix===undefined?'':suffix);
    }
    expect(factBindingSchema.safeParse({id:'fact',evidenceId:'metrics',field:'ctr',suffix:'USD'}).success).toBe(false);
  });
  it('keeps null, percent scale, rounding and exact dimension identifiers explicit',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'agent-fact-boundaries-'));
    try {
      await mkdir(join(dir,'evidence'));
      const raw=JSON.stringify({data:{rows:[
        {id:7,enabled:true,ctr:0.0058,missing:null,amount:1.005},
        {id:'9007199254740993',enabled:false,ctr:0.58,missing:0,amount:2}]}});
      await writeFile(join(dir,'evidence/facts.json'),raw);
      const source={file:'facts.json',evidenceId:'metrics',capabilityId:'analysis.table',kind:'calculation' as const,
        arguments:'{}',sha256:createHash('sha256').update(raw).digest('hex'),...describeEvidence(raw)};
      const resolve=(bindings:any[])=>JSON.parse(execFileSync('python',['-c',factResolutionCode(prepareFactBindings(
        bindings.map(b=>factBindingSchema.parse({evidenceId:'metrics',...b})),[source]))],{cwd:dir,encoding:'utf8'}));
      const facts=resolve([
        {id:'percent',where:{id:7,enabled:true},field:'ctr',decimals:4,suffix:'%'},
        {id:'absent',where:{id:7},field:'missing',decimals:2,suffix:'%'},
        {id:'rounded',where:{id:7},field:'amount',decimals:2},
        {id:'nullable_suffix',where:{id:7},field:'amount',decimals:2,suffix:null},
        {id:'legacy_empty_suffix',where:{id:7},field:'amount',decimals:2,suffix:''},
        {id:'large_id',where:{id:'9007199254740993'},field:'id'}]);
      expect(facts.map((f:any)=>f.display)).toEqual(['0.0058%','不可计算/未提供','1.01','1.01','1.01','9007199254740993']);
      expect(facts[0].rowDimensions).toMatchObject({id:7,enabled:true,missing:null});
      expect(()=>resolve([{id:'bad_bool',where:{id:7,enabled:1},field:'ctr'}])).toThrow();
      expect(()=>resolve([{id:'bad_id',where:{id:'7'},field:'ctr'}])).toThrow();
      expect(factBindingSchema.safeParse({id:'unsafe',evidenceId:'metrics',where:{id:9007199254740992},field:'ctr'}).success).toBe(false);
      const binding=factBindingSchema.parse({id:'duplicate',evidenceId:'metrics',field:'ctr'});
      expect(()=>prepareFactBindings([binding,binding],[source])).toThrow('FACT_ID_DUPLICATE');
    } finally {await rm(dir,{recursive:true,force:true});}
  });
  it('binds the whole-population value rather than a neighboring single-product value, retaining lineage',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'agent-facts-'));
    try {
      await mkdir(join(dir,'evidence'));
      const raw=JSON.stringify({dataset:'calculation.table',evidence:{source_evidence_id:'original',operation:{group_by:['scope']}},data:{rows:[
        {scope:'all-products',clicks:14096,impressions:2448002,ctr:14096/2448002*100},
        {scope:'single-product',clicks:4673,impressions:1019555,ctr:4673/1019555*100}]}});
      await writeFile(join(dir,'evidence/facts.json'),raw);
      const source={file:'facts.json',evidenceId:'metrics',capabilityId:'analysis.table',kind:'calculation' as const,
        arguments:'{}',sha256:createHash('sha256').update(raw).digest('hex'),query:{group_by:['scope']},...describeEvidence(raw)};
      const resolve=(where:Record<string,string>)=>factResolutionCode(prepareFactBindings([
        factBindingSchema.parse({id:'overall_ctr',evidenceId:'metrics',where,field:'ctr',decimals:2,suffix:'%'})],[source]));
      const facts=JSON.parse(execFileSync('python',['-c',resolve({scope:'all-products'})],{cwd:dir,encoding:'utf8'}));
      expect(facts[0]).toMatchObject({display:'0.58%',selector:{scope:'all-products'},rowIndex:0,
        query:{group_by:['scope']},lineage:{source_evidence_id:'original'}});
      expect(interpolateFacts({summary:'整体CTR {{fact:overall_ctr}}'},facts)).toEqual({summary:'整体CTR 0.58%'});
      expect(interpolateFacts('整体CTR {{fact:overall_ctr}}',facts)).toBe('整体CTR 0.58%');
      expect(()=>execFileSync('python',['-c',resolve({})],{cwd:dir,stdio:'pipe'})).toThrow();
      expect(()=>execFileSync('python',['-c',resolve({scope:'missing'})],{cwd:dir,stdio:'pipe'})).toThrow();
      await writeFile(join(dir,'evidence/facts.json'),'{}');
      expect(()=>execFileSync('python',['-c',resolve({scope:'all-products'})],{cwd:dir,stdio:'pipe'})).toThrow();
    } finally {await rm(dir,{recursive:true,force:true});}
  });
  it('rejects invented, stale or unused references instead of silently inserting model values',()=>{
    expect(()=>interpolateFacts('数字{{fact:unknown}}',[])).toThrow('FACT_REFERENCE_UNKNOWN');
    expect(()=>interpolateFacts('数字{{fact:bad id}}',[])).toThrow('FACT_REFERENCE_INVALID');
    expect(()=>interpolateFacts('没有引用',[{id:'unused',display:'10'}] as any,true)).toThrow('FACT_REFERENCE_UNUSED');
    expect(factBindingSchema.safeParse({id:'a',evidenceId:'e',field:'ctr',value:0.46}).success).toBe(false);
    expect(()=>prepareFactBindings([factBindingSchema.parse({id:'a',evidenceId:'missing',field:'ctr'})],[])).toThrow('FACT_SOURCE_UNAVAILABLE');
  });
});
