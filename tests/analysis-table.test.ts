import {describe,it,expect} from 'vitest';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tableAnalysisSchema,tableAnalysisCode} from '../src/analysis-table.js';

describe('saved evidence table computations',()=>{
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
