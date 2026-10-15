import type {EvidenceFileEntry} from './evidence-manifest.js';
import type {ResolvedFact} from './evidence-facts.js';

type Use = {blockId:string;evidenceId:string;rowsPath:string;fields:string[];selector?:Record<string,unknown>};
type Item = {label:string;value:string};
type Reference = {id:string;title:string;provider:string;sections:Array<{title:string;items:Item[]}>;notes:string[];inputs:string[]};
const obj=(v:unknown):Record<string,any>=>v && typeof v==='object' && !Array.isArray(v)?v as Record<string,any>:{};
const values=(v:unknown):any[]=>Array.isArray(v)?v:[];
const scalar=(v:unknown):string=>Array.isArray(v)?v.map(scalar).join('、'):v===null?'未知':typeof v==='object'?'':String(v);
const fields:Record<string,string>={spend:'广告花费',sales:'广告归因销售额',orders:'广告订单',clicks:'点击次数',impressions:'曝光次数',acos:'ACOS',roas:'ROAS',cpc:'平均点击成本',cpa:'平均获单成本',ctr:'点击率',cvr:'转化率',sid:'店铺',lingxing_sid:'店铺',store:'店铺',campaign:'广告活动',campaign_id:'活动编号',campaign_name:'活动名称',ad_group:'广告组',ad_group_id:'广告组编号',ad_group_name:'广告组名称',keyword:'配置投放词',keyword_text:'配置投放词',customer_search_term:'客户实际搜索词',asin:'广告商品 ASIN',date:'日期',report_date:'日期',report:'报表类型',site:'站点',marketplace:'站点',market:'站点',name:'对象名称',campaign_ids:'活动编号',ad_group_ids:'广告组编号',store_sids:'领星店铺编号',target:'配置投放目标',target_id:'投放目标编号',search_term:'客户搜索词（如报表提供）'};
const reports:Record<string,string>={sp_search_terms:'商品推广（SP）搜索词报表',sb_search_terms:'品牌推广（SB）搜索词报表',sp_products:'商品推广（SP）广告商品报表'};
const sites:Record<string,string>={US:'美国',JP:'日本',DE:'德国',GB:'英国',UK:'英国',CA:'加拿大',IT:'意大利',FR:'法国',ES:'西班牙',AU:'澳大利亚',MX:'墨西哥'};
// Resolve the actual recorded provider. This registry translates known source
// identities; it does not select a source, workflow or marketplace branch.
const providers:Record<string,string>={crossborderops:'CrossBorderOps · 运营后台',lingxing:'领星 ERP',lingxing_mcp:'领星 ERP',sif:'SIF',amazon:'Amazon',internet:'公开网页',knowledge:'企业知识资料',dws:'钉钉',dingtalk:'钉钉',artifact:'任务文件',ziniao:'紫鸟'};
const businessName=(key:string,advertising:boolean)=>advertising?fields[key]:({sales:'销售额',orders:'订单数',sid:'店铺',date:'日期',report_date:'日期',name:'对象名称',site:'站点',marketplace:'站点',market:'站点',asin:'商品 ASIN',sku:'商品 SKU'} as Record<string,string>)[key];
const readable=(v:unknown):string|undefined=>typeof v==='string'&&v.length<=160&&!/[\\/]|[?&](?:token|signature)=|token|secret|authorization|[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v)?v:undefined;
function providerName(source:EvidenceFileEntry,ev:Record<string,any>):string {
  if(source.kind==='calculation')return '本次分析计算';
  const rootSource=obj(source.context).source;
  const recorded=(typeof ev.source==='string'?ev.source:obj(ev.source).provider??obj(ev.source).name)
    ??(typeof rootSource==='string'?rootSource:obj(rootSource).provider);
  const identity=recorded??source.capabilityId.split('.')[0]!;
  return (typeof identity==='string'?providers[identity.toLowerCase()]:undefined)??readable(recorded)??'来源名称待核实';
}
/** Public citations are derived from the saved lineage, not model-authored sources.
 * IDs/hashes stay in the private verification manifest; S1 etc. are document-local. */
export function documentProvenance(sources:EvidenceFileEntry[],uses:Use[]) {
  const byId=new Map(sources.map(s=>[s.evidenceId,s]));
  const refs=new Map<string,Reference>();
  const visiting=new Set<string>();
  const visit=(evidenceId:string):string=>{
    const existing=refs.get(evidenceId);if(existing)return existing.id;
    if(visiting.has(evidenceId))throw new Error('DOCUMENT_SOURCE_LINEAGE_CYCLE');
    const source=byId.get(evidenceId);if(!source)throw new Error('DOCUMENT_SOURCE_LINEAGE_UNAVAILABLE');
    visiting.add(evidenceId);
    const q=obj(source.query),ctx=obj(source.context),ev=obj(ctx.evidence),op=obj(ev.operation);
    const parentIds=new Set<string>();
    for(const id of [q.evidenceId,ev.source_evidence_id,obj(op.source).evidenceId])
      if(typeof id==='string'&&id!==evidenceId)parentIds.add(id);
    // Arbitrary Python may join several saved sources. Record every explicitly
    // referenced file, and describe it as a calculation rather than raw data.
    const code=typeof ev.code==='string'?ev.code:typeof q.code==='string'?q.code:'';
    if(source.kind==='calculation'&&code)for(const candidate of sources)
      if(candidate.evidenceId!==evidenceId&&code.includes(candidate.file)&&candidate.kind!=='report')parentIds.add(candidate.evidenceId);
    const parents=[...parentIds].map(visit);
    const id=`S${refs.size+1}`,sections:Reference['sections']=[],notes:string[]=[];
    const directUses=uses.filter(u=>u.evidenceId===evidenceId);
    const usedFields=[...new Set(directUses.flatMap(u=>u.fields))];
    const isAdvertising=(entry:EvidenceFileEntry,seen=new Set<string>()):boolean=>{
      if(seen.has(entry.evidenceId))return false;seen.add(entry.evidenceId);
      const context=obj(entry.context),query=obj(entry.query);
      if(entry.capabilityId==='crossborderops.ads.metrics'||context.dataset==='ads.metrics'||query.dataset==='ads.metrics')return true;
      const parent=obj(context.evidence).source_evidence_id??query.evidenceId;
      return typeof parent==='string'&&byId.has(parent)?isAdvertising(byId.get(parent)!,seen):false;
    };
    const advertising=isAdvertising(source);
    const label=(key:string)=>businessName(key,advertising);
    const section=(title:string,items:Item[])=>{if(items.length)sections.push({title,items});};
    const params={...(source.kind==='observation'?q:{}),...obj(ctx.filters),...obj(q.params)},period=obj(ctx.period);
    const reportTypes=values(ctx.observed_report_families);
    const reportNames=reportTypes.map(r=>reports[r]).filter(Boolean);
    const material=obj(ctx.source),evidenceSource=obj(ev.source);
    const materialTitle=readable(evidenceSource.report_name??evidenceSource.title??material.report_name??material.title);
    const location:Item[]=[];
    if(reportNames.length)for(const name of reportNames)location.push({label:'报表',value:name!});
    else if(source.kind!=='calculation')location.push({label:'资料',value:materialTitle??(advertising?'广告表现数据（具体报表名称待核实）':'本次取数资料（业务名称待核实）')});
    if(ev.queried_at) {
      const date=new Date(ev.queried_at);
      if(Number.isFinite(date.getTime()))location.push({label:'获取时间',value:new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date)+'（北京时间）'});
    }
    section('数据位置',location);
    const scope:Item[]=[];
    const site=params.site??params.marketplace??params.market;
    if(site)scope.push({label:'站点',value:sites[site]??scalar(site)});
    const begin=period.start_date??params.start_date,end=period.end_date??params.end_date;
    if(begin||end)scope.push({label:'统计日期',value:`${begin??'起始日未提供'} 至 ${end??'结束日未提供'}`});
    for(const [key,value] of Object.entries(params)) {
      const name=label(key);
      if(name&&!['site','marketplace','market','report','date','report_date'].includes(key)&&value!==undefined)scope.push({label:name,value:Array.isArray(value)?value.map(scalar).join('\n'):scalar(value)});
    }
    const stores=source.kind==='observation'?values(ctx.stores):[];
    const observed=Array.isArray(ctx.observed_store_sids)?new Set(ctx.observed_store_sids.map(String)):undefined;
    if(stores.length) {
      scope.push({label:'查询范围',value:`当前用户有权查询的 ${stores.length} 家店铺`});
      for(const store of stores.filter(s=>!observed||observed.has(String(s.lingxing_sid))))scope.push({label:observed?'有记录的店铺':'查询店铺',value:`${store.name??'店铺名称待核实'}${store.lingxing_sid!==undefined?`（领星店铺编号 ${store.lingxing_sid}）`:''}`});
      if(observed&&observed.size<stores.length)notes.push(params.campaign_ids||params.ad_group_ids||params.store_sids
        ? '已按指定对象筛选，只展示匹配的店铺记录；不能用这份局部结果判断其他店铺表现。'
        : '其余授权店铺在本次结果中没有报表记录，不能据此判断为零花费。');
    }
    const unexplained=Object.keys(params).some(k=>!label(k)&&!['dataset','params','start_date','end_date','sources','dimensions','order_by','result_mode','limit','offset','page','page_size','evidenceId'].includes(k));
    if(unexplained)notes.push('部分筛选条件尚无可确认的业务说明；当前来源卡片不能替代对这部分范围的核实。');
    if(values(params.dimensions).length) {
      const names=params.dimensions.map((k:string)=>label(k)).filter(Boolean);
      if(names.length)scope.push({label:'查看层级',value:names.join('、')});
    }
    section('本次筛选',scope);
    const selections:Item[]=[];
    const knownSelections=new Set<string>();
    for(const use of directUses)for(const [key,value] of Object.entries(use.selector??{})) {
      const name=label(key),translated=['site','marketplace','market'].includes(key)?sites[String(value)]??scalar(value):scalar(value);
      const identity=`${key}:${translated}`;
      if(name&&!knownSelections.has(identity)){knownSelections.add(identity);selections.push({label:name,value:translated});}
    }
    section('本处引用范围',selections);
    const coverage=obj(ctx.coverage);
    const customerTerms=obj(obj(obj(ctx.dimension_field_coverage).fields).customer_search_term);
    if(customerTerms.groups_with_value===0)notes.push('本次报表未提供客户实际搜索词；配置投放词不能当作客户搜索内容，也不能直接据此给出搜索词否定清单。');
    if(coverage.has_more===true)notes.push('当前结果仅包含部分记录，尚有后续数据；不代表完整排名或全部对象。');
    if(coverage.upstream_acquisition_completeness==='not_verified')notes.push('仅分析已入库的匹配报表；尚未核实上游是否采齐全部店铺、日期及广告类型。');
    const operation=Object.keys(op).length?op:source.kind==='calculation'?q:{};
    const calculations:Item[]=[];
    const grouped=values(operation.group_by).map((k:string)=>label(k)).filter(Boolean);
    if(grouped.length)calculations.push({label:'汇总层级',value:grouped.join('、')});
    const summed=values(operation.sums).map((k:string)=>label(k)).filter(Boolean);
    if(summed.length)calculations.push({label:'加总指标',value:summed.join('、')});
    for(const r of values(operation.ratios)) {
      const numerator=label(r.numerator),denominator=label(r.denominator),name=label(r.name);
      if(numerator&&denominator)calculations.push({label:name??'计算指标',value:`${numerator} ÷ ${denominator}${r.scale!==1?` × ${r.scale}`:''}`});
      else notes.push('部分计算项未提供可确认的业务名称，需结合正文说明复核。');
    }
    const operators:Record<string,string>={eq:'等于',ne:'不等于',gt:'大于',gte:'不小于',lt:'小于',lte:'不大于',in:'属于',not_in:'不属于',contains:'包含',is_null:'为空',not_null:'不为空'};
    for(const f of values(operation.filters))if(label(f.field)&&operators[f.op])calculations.push({label:operation.filter_mode==='any'?'筛选条件（满足其一）':'筛选条件（同时满足）',value:`${label(f.field)} ${operators[f.op]} ${f.other_field?(label(f.other_field)??'另一项指标'):scalar(f.value)}`});
    if(operation.order_by&&label(operation.order_by.field))calculations.push({label:'排序',value:`${label(operation.order_by.field)}${operation.order_by.descending?'从高到低':'从低到高'}`});
    const names=usedFields.map(label).filter(Boolean);
    if(names.length)calculations.push({label:'本处引用',value:[...new Set(names)].join('、')});
    section(source.kind==='calculation'?'如何计算':'指标说明',calculations);
    if(values(operation.ratios).length)notes.push('比率先汇总分子和分母再计算；分母为零时记为无法计算。');
    if(source.capabilityId==='analysis.python')notes.push('此项为本次分析计算，已关联输入资料；具体取值与合并方式仍需结合正文复核。');
    if(advertising&&source.kind==='observation'&&usedFields.some(f=>f==='sales'||f==='orders'))notes.push('销售额及订单为报表广告归因结果；不代表店铺总销售额或利润。');
    if(advertising&&usedFields.includes('cpc'))notes.push('平均点击成本来自实际花费与点击，不是设置的竞价。');
    refs.set(evidenceId,{id,title:source.kind==='calculation'?'计算与对比':reportNames.length===1?reportNames[0]!:advertising?'广告表现报表':'本次数据依据',provider:providerName(source,ev),sections,notes:[...new Set(notes)],inputs:parents});
    visiting.delete(evidenceId);return id;
  };
  const blockRefs:Record<string,string[]>={};
  for(const use of uses){const id=visit(use.evidenceId);const refs=blockRefs[use.blockId]??=[];if(!refs.includes(id))refs.push(id);}
  return {references:[...refs.values()],blockRefs};
}

export function factUses(blockId:string,block:unknown,facts:ResolvedFact[]):Use[] {
  const text=JSON.stringify(block),byId=new Map(facts.map(f=>[f.id,f]));
  return [...text.matchAll(/\{\{fact:([A-Za-z][A-Za-z0-9_-]{0,63})\}\}/g)].flatMap(m=>{
    const f=byId.get(m[1]!);return f?[{blockId,evidenceId:f.evidenceId,rowsPath:f.rowsPath,fields:[f.field],selector:f.selector}]:[];
  });
}
