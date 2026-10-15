import {describe,it,expect} from 'vitest';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tableAnalysisSchema,tableAnalysisCode} from '../src/analysis-table.js';

describe('saved evidence table computations',()=>{
  it('sorts dates and labels as text, numeric strings as numbers, and keeps nulls last',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'agent-sort-'));
    try {
      await mkdir(join(dir,'evidence'));
      const compute=async(rows:unknown[],descending=false)=>{
        await writeFile(join(dir,'evidence/source.json'),JSON.stringify({data:{rows}}));
        const code=tableAnalysisCode(tableAnalysisSchema.parse({evidenceId:'source',order_by:{field:'value',descending}}),{file:'source.json'});
        return JSON.parse(execFileSync('python',['-c',code],{cwd:dir,encoding:'utf8',stdio:'pipe'})).data.rows.map((r:any)=>r.value);
      };
      expect(await compute([{value:'2026-10-11'},{value:null},{value:'2026-10-08'},{value:'2026-10-09'}])).toEqual(['2026-10-08','2026-10-09','2026-10-11',null]);
      expect(await compute([{value:'Zeta'},{value:'Alpha'}],true)).toEqual(['Zeta','Alpha']);
      expect(await compute([{value:'10'},{value:'2'},{value:1},{value:null}])).toEqual([1,'2','10',null]);
      await expect(compute([{value:'2026-10-08'},{value:1}])).rejects.toThrow();
    } finally {await rm(dir,{recursive:true,force:true});}
  });
  it('keeps output fields distinct and allows ratios of generated counts and previous ratios',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'agent-count-'));
    try {
      await mkdir(join(dir,'evidence'));
      await writeFile(join(dir,'evidence/source.json'),JSON.stringify({data:{rows:[{site:'US',spend:10},{site:'US',spend:20}]}}));
      const compute=(spec:any)=>JSON.parse(execFileSync('python',['-c',tableAnalysisCode(tableAnalysisSchema.parse({evidenceId:'source',...spec}),{file:'source.json'})],{cwd:dir,encoding:'utf8',stdio:'pipe'}));
      expect(compute({row_count:'count',sums:['spend'],ratios:[{name:'average',numerator:'spend',denominator:'count'},{name:'half_average',numerator:'average',denominator:'count'}]}).data.rows).toMatchObject([{count:2,spend:30,average:15,half_average:7.5}]);
      for (const spec of [
        {row_count:'spend',sums:['spend']}, {row_count:'site',group_by:['site']},
        {sums:['spend'],group_by:['spend']}, {row_count:'_input_rows'},
        {sums:['_missing_counts']}, {ratios:[{name:'spend',numerator:'spend',denominator:'spend'}]},
        {sums:['spend'],ratios:[{name:'spend',numerator:'spend',denominator:'spend'}]},
        {ratios:[{name:'ratio',numerator:'spend',denominator:'spend'},{name:'ratio',numerator:'spend',denominator:'spend'}]}
      ]) expect(()=>compute(spec)).toThrow();
    } finally {await rm(dir,{recursive:true,force:true});}
  });
  it('distinguishes missing fields from null and applies complementary typed equality',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'agent-null-filter-'));
    try {
      await mkdir(join(dir,'evidence'));
      await writeFile(join(dir,'evidence/source.json'),JSON.stringify({data:{rows:[{id:'null',value:null},{id:'missing'},{id:'boolean',value:true},{id:'number',value:1},{id:'string',value:'1'}]}}));
      const select=(op:string,value:unknown)=>{
        const code=tableAnalysisCode(tableAnalysisSchema.parse({evidenceId:'source',filters:[{field:'value',op,value}]}),{file:'source.json'});
        return JSON.parse(execFileSync('python',['-c',code],{cwd:dir,encoding:'utf8'})).data.rows.map((r:any)=>r.id);
      };
      expect(select('eq',null)).toEqual(['null']);
      expect(select('ne',null)).toEqual(['boolean','number','string']);
      expect(select('eq',1)).toEqual(['number']);
      expect(select('ne',1)).toEqual(['null','boolean','string']);
      expect(select('eq',true)).toEqual(['boolean']);
      expect(select('ne',true)).toEqual(['null','number','string']);
    } finally {await rm(dir,{recursive:true,force:true});}
  });
  it('computes classification membership and totals from explicit predicates instead of model arithmetic',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'agent-filter-'));
    try {
      await mkdir(join(dir,'evidence'));
      const raw=JSON.stringify({data:{rows:[{campaign:'loss',spend:100,sales:50,orders:1,acos:200},
        {campaign:'efficient',spend:10,sales:100,orders:3,acos:10},
        {campaign:'inefficient',spend:2157.17,sales:2423.52,orders:10,acos:89.01},
        {campaign:'missing',spend:100,sales:null,orders:null,acos:null}]}});
      await writeFile(join(dir,'evidence/source.json'),raw);
      const compute=(spec:any)=>JSON.parse(execFileSync('python',['-c',tableAnalysisCode(tableAnalysisSchema.parse({evidenceId:'source',...spec}),{file:'source.json'})],{cwd:dir,encoding:'utf8'}));
      const loss=compute({filters:[{field:'spend',op:'gt',other_field:'sales'}],row_count:'campaign_count',sums:['spend','sales','orders']});
      expect(loss.data.rows).toMatchObject([{campaign_count:1,spend:100,sales:50,orders:1}]);
      expect(loss.data.coverage).toMatchObject({input_rows:4,selected_rows:1});
      expect(loss.evidence.operation.filters[0]).toEqual({field:'spend',op:'gt',other_field:'sales'});
      expect(compute({filters:[{field:'acos',op:'lte',value:35},{field:'orders',op:'gte',value:3}],row_count:'count'}).data.rows).toMatchObject([{count:1}]);
      expect(compute({filters:[{field:'orders',op:'gt',value:999}],row_count:'count'}).data.rows).toMatchObject([{count:0}]);
      expect(tableAnalysisSchema.safeParse({evidenceId:'source',filters:[{field:'spend',op:'gt',value:10,other_field:'sales'}]}).success).toBe(false);
    } finally {await rm(dir,{recursive:true,force:true});}
  });
  it('uses weighted ratios of sums, retains missingness and source coverage, and detects file modification',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'agent-table-'));
    try {
      await mkdir(join(dir,'evidence'));
      const raw=JSON.stringify({dataset:'test',data:{coverage:{has_more:true},metric_units:{spend:'JPY'},semantics:{period:'observation dates'},rows:[
        {site:'US',spend:10,clicks:2},{site:'US',spend:20,clicks:10},
        {site:'DE',spend:5,clicks:0},{site:'JP',spend:null,clicks:1}]}});
      await writeFile(join(dir,'evidence/source.json'),raw);
      const spec=tableAnalysisSchema.parse({evidenceId:'source',group_by:['site'],sums:['spend','clicks'],ratios:[{name:'cpc',numerator:'spend',denominator:'clicks'}],order_by:{field:'spend'}});
      const code=tableAnalysisCode(spec,{file:'source.json',sha256:createHash('sha256').update(raw).digest('hex')});
      const result=JSON.parse(execFileSync('python',['-c',code],{cwd:dir,encoding:'utf8'}));
      expect(result.data.rows[0]).toMatchObject({site:'US',spend:30,clicks:12,cpc:2.5});
      expect(result.data.rows[1]).toMatchObject({site:'DE',cpc:null});
      expect(result.data.rows[2]).toMatchObject({site:'JP',spend:null,cpc:null});
      expect(result.data.source_data_context.coverage.has_more).toBe(true);
      expect(result.data.source_data_context.metric_units).toEqual({spend:'JPY'});
      expect(result.data.source_data_context.semantics).toEqual({period:'observation dates'});
      await writeFile(join(dir,'evidence/source.json'),'{}');
      expect(()=>execFileSync('python',['-c',code],{cwd:dir,stdio:'pipe'})).toThrow();
    } finally {await rm(dir,{recursive:true,force:true});}
  });
});
