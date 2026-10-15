import {describe,it,expect} from 'vitest';
import {documentProvenance} from '../src/document-provenance.js';
import type {EvidenceFileEntry} from '../src/evidence-manifest.js';
import {describeEvidence} from '../src/evidence-manifest.js';

const raw:EvidenceFileEntry={evidenceId:'private-observation-uuid',file:'01.json',capabilityId:'crossborderops.ads.metrics',arguments:'{}',kind:'observation',
  query:{dataset:'ads.metrics',params:{site:'US',start_date:'2026-10-01',end_date:'2026-10-07',dimensions:['store','campaign']}},
  context:{dataset:'ads.metrics',stores:[{name:'Test-US',lingxing_sid:42}],observed_report_families:['sp_search_terms','sb_search_terms'],
    evidence:{queried_at:'2026-10-15T13:05:34Z',secret:'sensitive'},coverage:{has_more:false,upstream_acquisition_completeness:'not_verified'}}};
const calculation:EvidenceFileEntry={evidenceId:'private-calculation-uuid',file:'02.json',capabilityId:'analysis.table',arguments:'{}',kind:'calculation',
  query:{evidenceId:raw.evidenceId,group_by:['sid'],sums:['spend','sales'],ratios:[{name:'acos',numerator:'spend',denominator:'sales',scale:100}],filters:[{field:'orders',op:'eq',value:0}],limit:5}};

describe('public document source verification',()=>{
  it('traces calculations to concrete queries without exposing private IDs or credentials',()=>{
    const result=documentProvenance([raw,calculation],[{blockId:'overview',evidenceId:calculation.evidenceId,rowsPath:'data.rows',fields:['spend','acos'],selector:{sid:42}}]);
    expect(result.blockRefs.overview).toEqual(['S2']);
    const text=JSON.stringify(result);
    for(const expected of ['S1','Test-US','店铺编号 42','美国','2026-10-01','品牌推广（SB）','上游是否采齐','广告花费 ÷ 广告归因销售额 × 100','广告订单 等于 0'])expect(text).toContain(expected);
    for(const omitted of ['private-observation-uuid','private-calculation-uuid','sensitive','01.json','02.json','sp_search_terms','site=US','not_verified','data.rows','orders eq 0'])expect(text).not.toContain(omitted);
  });
  it('deduplicates shared sources and follows multi-source Python calculations',()=>{
    const python:EvidenceFileEntry={...calculation,evidenceId:'python',query:{code:"read('01.json'); read('02.json')",purpose:'两组比较'}};
    const result=documentProvenance([raw,calculation,python],[{blockId:'a',evidenceId:python.evidenceId,rowsPath:'data.rows',fields:['change']},{blockId:'b',evidenceId:raw.evidenceId,rowsPath:'data.rows',fields:['spend']}]);
    expect(result.references).toHaveLength(3);
    expect(result.references[2]!.inputs).toEqual(['S1','S2']);
    expect(result.blockRefs.b).toEqual(['S1']);
  });
  it('identifies actual providers without forcing observations into a preset system',()=>{
    const use={blockId:'x',evidenceId:raw.evidenceId,rowsPath:'data.rows',fields:['spend']};
    for(const [name,expected] of [['lingxing','领星 ERP'],['lingxing_mcp','领星 ERP'],['Partner BI','Partner BI'],['sif','SIF']]) {
      const result=documentProvenance([{...raw,context:{...raw.context,evidence:{source:name}}}],[use]);
      expect(result.references[0]!.provider).toBe(expected);
      expect(result.references[0]!.provider).not.toContain('运营后台');
    }
    expect(documentProvenance([{...raw,capabilityId:'newconnector.query',context:{}}],[use]).references[0]!.provider).toBe('来源名称待核实');
  });
  it('retains actual top-level provider and material metadata without recategorizing them',()=>{
    const described=describeEvidence(JSON.stringify({source:{provider:'Partner BI',title:'运营上传的周度推广明细'},data:{rows:[{spend:10}]}}));
    const evidence={...raw,capabilityId:'partner.query',...described};
    const use={blockId:'x',evidenceId:raw.evidenceId,rowsPath:'data.rows',fields:['spend']};
    const result=documentProvenance([evidence],[use]);
    expect(result.references[0]!.provider).toBe('Partner BI');
    expect(JSON.stringify(result)).toContain('运营上传的周度推广明细');
    const lingxing={...evidence,...describeEvidence(JSON.stringify({source:'lingxing_mcp',data:{rows:[]}}))};
    expect(documentProvenance([lingxing],[use]).references[0]!.provider).toBe('领星 ERP');
    const overridden={...evidence,context:{...evidence.context,evidence:{source:'sif'}}};
    expect(documentProvenance([overridden],[use]).references[0]!.provider).toBe('SIF');
  });
  it('distinguishes authorized stores from stores actually observed',()=>{
    const result=documentProvenance([{...raw,context:{...raw.context,stores:[{name:'Visible',lingxing_sid:42},{name:'No rows',lingxing_sid:43}],observed_store_sids:[42]}}],[{blockId:'x',evidenceId:raw.evidenceId,rowsPath:'data.rows',fields:['spend']}]);
    const text=JSON.stringify(result);
    expect(text).toContain('2 家店铺');expect(text).toContain('Visible');expect(text).not.toContain('No rows');expect(text).toContain('不能据此判断为零花费');
  });
  it('fails closed for missing or cyclic lineage',()=>{
    const use={blockId:'x',evidenceId:calculation.evidenceId,rowsPath:'data.rows',fields:['spend']};
    expect(()=>documentProvenance([calculation],[use])).toThrow('LINEAGE_UNAVAILABLE');
    expect(()=>documentProvenance([{...raw,query:{evidenceId:calculation.evidenceId}},calculation],[use])).toThrow('LINEAGE_CYCLE');
  });
  it('does not impose advertising meanings or ratio scales on generic or calculated fields',()=>{
    const generic={...raw,capabilityId:'crossborderops.sales',query:{dataset:'sales'},context:{dataset:'sales'}};
    const use={blockId:'x',evidenceId:raw.evidenceId,rowsPath:'data.rows',fields:['sales','acos']};
    expect(JSON.stringify(documentProvenance([generic],[use]))).not.toContain('广告归因销售额');
    const ratio={...calculation,query:{...calculation.query,ratios:[{name:'acos',numerator:'spend',denominator:'sales',scale:1}]}};
    const result=JSON.stringify(documentProvenance([raw,ratio],[{...use,evidenceId:ratio.evidenceId}]));
    expect(result).toContain('广告花费 ÷ 广告归因销售额');
    expect(result).not.toContain('× 100');
    expect(result).not.toContain('ACOS=Σspend/Σsales×100%');
  });
});
