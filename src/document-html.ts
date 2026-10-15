import type { CompiledDocument } from './document-render.js';

export const escapeHtml = (value: unknown): string => String(value ?? '未提供').replace(/[&<>"']/g,
  ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
const p = (value:string) => `<p>${escapeHtml(value)}</p>`;
const colors = ['#16877f','#304d7c','#b87824','#8a5579'];
type Reference=NonNullable<CompiledDocument['document']['references']>[number];
const sourceLink=(id:string)=>`<a href="#source-${escapeHtml(id)}">[${escapeHtml(id)}]</a>`;
function referenceHtml(ref:Reference,previous:Reference[]):string {
  // Reuse only an exactly matching store scope, never dates or object filters.
  // The original reference and private lineage remain complete.
  const isStoreScope=(item:{label:string})=>['查询范围','有记录的店铺','查询店铺'].includes(item.label);
  const scope=(r:Reference)=>r.sections?.flatMap(s=>s.items.filter(isStoreScope))??[];
  const storeItems=scope(ref);
  const sharedScope=storeItems.length?previous.find(r=>r.provider===ref.provider&&JSON.stringify(scope(r))===JSON.stringify(storeItems)):undefined;
  const sharedNotes=new Map<string,{id:string;index:number}>();
  const notes=(ref.notes??[]).filter(note=>{
    const prior=previous.find(r=>r.notes?.includes(note));
    if(prior)sharedNotes.set(note,{id:prior.id,index:prior.notes!.indexOf(note)+1});
    return !prior;
  });
  return `<article class="source-card" id="source-${escapeHtml(ref.id)}"><div class="source-heading"><span class="source-number">${escapeHtml(ref.id)}</span><div><strong>${escapeHtml(ref.title)}</strong>${ref.provider?`<div class="source-provider">${escapeHtml(ref.provider)}</div>`:''}</div></div>${ref.inputs?.length?`<div class="source-inputs">计算依据 ${ref.inputs.map(sourceLink).join(' ')}</div>`:''}${ref.sections?.map(section=>`<div class="source-group"><h3>${escapeHtml(section.title)}</h3><dl>${section.items.filter(item=>!sharedScope||!isStoreScope(item)).map(item=>`<div class="source-row"><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join('')}${sharedScope&&section.items.some(isStoreScope)?`<div class="source-row"><dt>店铺范围</dt><dd>与 ${sourceLink(sharedScope.id)} 相同（含授权范围与实际有记录店铺）</dd></div>`:''}</dl></div>`).join('')??''}${notes.length?`<ul class="source-notes">${notes.map(note=>`<li id="source-${escapeHtml(ref.id)}-note-${ref.notes!.indexOf(note)+1}"><b>说明 ${ref.notes!.indexOf(note)+1}：</b>${escapeHtml(note)}</li>`).join('')}</ul>`:''}${sharedNotes.size?`<p class="source-inputs">共用口径与限制：${[...sharedNotes.values()].map(n=>`<a href="#source-${escapeHtml(n.id)}-note-${n.index}">[${escapeHtml(n.id)}·说明${n.index}]</a>`).join(' ')}。</p>`:''}${ref.details?.map(p).join('')??''}</article>`;
}


// Round only the display. The compiled document and review manifest retain
// the source precision. Never coerce strings: long identifiers stay exact.
function tableCell(value:unknown):string {
  if (typeof value !== 'number') return escapeHtml(value);
  const options:Intl.NumberFormatOptions = {useGrouping:false};
  if (value !== 0 && Math.abs(value) < 0.01) options.maximumSignificantDigits=3;
  else options.maximumFractionDigits=2;
  return escapeHtml(new Intl.NumberFormat('en-US',options).format(value));
}

function tableHtml(block:Extract<CompiledDocument['document']['blocks'][number],{type:'table'}>):string {
  // Size columns from bounded content, so IDs and names do not receive the
  // same narrow width as short counts. Full values remain available in print.
  const identifier=(i:number)=>/(?:^|_)id$|^(?:asin|sku)$/i.test(block.columns[i]!.field);
  const weights=block.columns.map((column,i)=>Math.min(identifier(i)?40:26,Math.max(7,
    column.label.length*1.5,...block.rows.slice(0,30).map(row=>
      (typeof row[i]==='number'?tableCell(row[i]).length:String(row[i] ?? '未提供').length)*(identifier(i)?1.7:1)))));
  const total=weights.reduce((a,b)=>a+b,0);
  return `<table><colgroup>${weights.map(weight=>`<col style="width:${(weight/total*100).toFixed(2)}%">`).join('')}</colgroup><thead><tr>${block.columns.map(c=>`<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead><tbody>${block.rows.map(row=>`<tr>${row.map((c,i)=>`<td${identifier(i)?' class="identifier"':typeof c==='number'?' class="numeric"':''}>${tableCell(c)}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${block.columns.length}">没有匹配记录</td></tr>`}</tbody></table>`;
}
type Chart = Extract<CompiledDocument['document']['blocks'][number],{type:'chart'}>;

function chartSvg(block:Chart):string {
  const legend = `<div class="legend">${block.series.map((s,i)=>`<span><i style="background:${colors[i]}"></i>${escapeHtml(s.label)}</span>`).join('')} ${escapeHtml(block.unit ?? '')}</div>`;
  const values = block.series.flatMap(s=>s.values.filter((v):v is number=>v !== null));
  const min = Math.min(0,...values), max = Math.max(0,...values);
  const span = max-min || 1;
  const format = (n:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:2,notation:Math.abs(n)>=1e6?'compact':'standard'}).format(n);
  const longLabels = block.categories.some(c => String(c ?? '未提供').length > (block.kind === 'bar' ? 18 : 12));
  const categoryLabel = (c:unknown,i:number) => longLabels ? String(i+1) : String(c ?? '未提供');
  // Long object names remain available in full rather than being silently
  // truncated inside SVG. Numbered keys keep the chart legible in print.
  const categoryKey = longLabels ? `<table class="chart-key"><thead><tr><th style="width:12%">序号</th><th>对象</th></tr></thead><tbody>${block.categories.map((c,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(c)}</td></tr>`).join('')}</tbody></table>` : '';
  if (block.kind === 'bar') {
    // Split long charts into independently paginatable vectors, preserving order.
    const rowHeight=24*block.series.length+12, perChart=Math.min(10,Math.floor(580/rowHeight));
    return legend + Array.from({length:Math.ceil(block.categories.length/perChart)},(_,chunk)=> {
      const start = chunk*perChart, categories=block.categories.slice(start,start+perChart);
      const height=categories.length*rowHeight+35;
      const x=(v:number)=>180+(v-min)/span*390;
      return `<svg class="chart" viewBox="0 0 700 ${height}" role="img" aria-label="${escapeHtml(block.title ?? 'Chart')}">
        <line x1="${x(0)}" y1="0" x2="${x(0)}" y2="${height-25}" stroke="#cad5dd"/>
        ${categories.map((category,j)=>`<text x="0" y="${j*rowHeight+20}" font-size="11">${escapeHtml(categoryLabel(category,start+j))}</text>`+
          block.series.map((s,k)=>{
            const v=s.values[start+j]!,y=j*rowHeight+k*24+4;
            return v === null ? `<text x="185" y="${y+14}" font-size="11" fill="#75808c">未提供</text>` :
              `<rect x="${Math.min(x(0),x(v))}" y="${y}" width="${Math.max(Math.abs(x(v)-x(0)),v===0?1:0)}" height="17" rx="3" fill="${colors[k]}"/><text x="${x(v)+ (v<0?-5:5)}" y="${y+13}" text-anchor="${v<0?'end':'start'}" font-size="11">${escapeHtml(format(v))}</text>`;
          }).join('')).join('')}
        <text x="180" y="${height-4}" font-size="10">${escapeHtml(format(min))}</text><text x="570" y="${height-4}" text-anchor="end" font-size="10">${escapeHtml(format(max))}</text></svg>`;
    }).join('') + categoryKey;
  }
  const x=(i:number)=>55+i*600/Math.max(1,block.categories.length-1),y=(n:number)=>245-(n-min)/span*215;
  // Even spacing includes the final category without adding an adjacent tick
  // that overlaps it (e.g. fourteen daily categories at indices 12 and 13).
  const tickCount=Math.min(6,block.categories.length);
  const ticks=new Set(Array.from({length:tickCount},(_,i)=>Math.round(i*(block.categories.length-1)/Math.max(1,tickCount-1))));
  return legend+`<svg class="chart" viewBox="0 0 720 305" role="img" aria-label="${escapeHtml(block.title ?? 'Chart')}">
    ${Array.from({length:5},(_,i)=>{const n=min+span*i/4;return `<line x1="55" y1="${y(n)}" x2="655" y2="${y(n)}" stroke="#e4ebef"/><text x="48" y="${y(n)+4}" text-anchor="end" font-size="10">${escapeHtml(format(n))}</text>`;}).join('')}
    ${block.series.map((s,k)=> {
      let path='';let open=false;
      s.values.forEach((v,i)=>{if(v===null){open=false;return;}path+=`${open?'L':'M'}${x(i)},${y(v)} `;open=true;});
      return `<path d="${path}" fill="none" stroke="${colors[k]}" stroke-width="2.5"/>`+s.values.map((v,i)=>v===null?'':`<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${colors[k]}"/>`).join('');
    }).join('')}
    ${block.categories.map((c,i)=>ticks.has(i)?`<text x="${x(i)}" y="268" text-anchor="middle" font-size="10">${escapeHtml(categoryLabel(c,i))}</text>`:'').join('')}
    </svg>` + categoryKey;
}

export function renderDocumentHtml(payload:CompiledDocument):string {
  const doc=payload.document;
  const blocks=doc.blocks.map(block=> {
    let body='';
    switch(block.type) {
      case 'summary': body=`<div class="summary">${p(block.text)}</div>`;break;
      case 'text':body=block.paragraphs.map(p).join('');break;
      case 'metrics':body=`<div class="metrics">${block.items.map(item=>`<div class="metric"><div class="label">${escapeHtml(item.label)}</div><div class="value">${escapeHtml(item.value)}</div>${item.note?`<div class="note">${escapeHtml(item.note)}</div>`:''}</div>`).join('')}</div>`;break;
      case 'callout':body=`<div class="callout ${block.tone}">${p(block.text)}</div>`;break;
      case 'actions':body=block.items.map(item=>`<article class="action">${item.priority?`<span class="badge">${escapeHtml(item.priority)}</span>`:''}${item.object?`<strong>${escapeHtml(item.object)}</strong>`:''}${p(item.proposal)}${[['依据',item.evidence],['前提',item.conditions],['复查',item.review],['确认',item.confirmation]].filter(([,v])=>v).map(([label,v])=>`<p class="note"><b>${label}</b> ${escapeHtml(v)}</p>`).join('')}</article>`).join('');break;
      case 'table':body=tableHtml(block);break;
      case 'chart':body=chartSvg(block);break;
    }
    const caption=('caption' in block ? block.caption:undefined),coverage=('coverage' in block ? block.coverage:undefined);
    return `<section id="${block.id}" data-block="${block.type}">${block.title?`<h2>${escapeHtml(block.title)}</h2>`:''}${body}${caption?`<p class="note">${escapeHtml(caption)}</p>`:''}${coverage?`<p class="coverage">${escapeHtml(coverage)}</p>`:''}${block.sourceRefs?.length?`<p class="source-ref">数据来源：${block.sourceRefs.map(ref=>`<a href="#source-${escapeHtml(ref)}">[${escapeHtml(ref)}]</a>`).join(' ')}，核验条件见后文。</p>`:''}</section>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(doc.title)}</title><style>
    @page{size:A4;margin:16mm 16mm 18mm}*{box-sizing:border-box}html{color:#29394b;background:white;font-family:"Noto Sans CJK SC","Microsoft YaHei","Yu Gothic",Arial,sans-serif;font-size:10pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{margin:0;line-height:1.6}h1{font-size:24pt;line-height:1.35;color:#142c49;margin:0 0 9pt;overflow-wrap:anywhere}header{border-top:5px solid #16877f;padding-top:16pt;margin-bottom:22pt}header .subtitle{font-size:11pt;color:#526477}.meta{display:flex;flex-wrap:wrap;gap:6pt 18pt;font-size:9pt;color:#607184;margin-top:10pt}h2{font-size:14pt;line-height:1.4;color:#142c49;margin:0 0 10pt;break-after:avoid}section{margin-bottom:20pt;overflow-wrap:anywhere}p{margin:0 0 8pt;white-space:pre-wrap;orphans:3;widows:3}.summary{background:#edf7f5;border-left:4px solid #16877f;padding:14pt 16pt;font-size:11pt}.summary p:last-child,.callout p:last-child{margin:0}.metrics{display:flex;flex-wrap:wrap;gap:9pt}.metric{flex:1 1 30%;min-width:120pt;border:1px solid #e1e8ee;border-radius:6pt;padding:12pt;break-inside:avoid}.label{font-size:9pt;color:#53687c}.value{font-size:21pt;line-height:1.4;font-weight:bold;color:#142c49;overflow-wrap:anywhere}.note,.coverage{font-size:8.5pt;color:#607184;margin-top:6pt}.coverage{border-top:1px solid #e4ebef;padding-top:5pt}.callout{border-left:3px solid #4d7d9b;background:#f0f5fa;padding:12pt}.warning{border-color:#b87824;background:#fff7e9}.critical{border-color:#bd4d51;background:#fff0f0}.success{border-color:#16877f;background:#edf7f5}.action{border-bottom:1px solid #e1e8ee;padding:10pt 0;break-inside:avoid}.badge{display:inline-block;color:#16877f;background:#edf7f5;border-radius:3pt;padding:1pt 6pt;margin-right:7pt;font-size:9pt}.action p{margin:5pt 0}.action .note b{color:#394f64}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8.5pt}thead{display:table-header-group}tr{break-inside:avoid}th{background:#173450;color:#fff;text-align:left;font-weight:600}th,td{padding:7pt 8pt;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}td{border-bottom:1px solid #e1e8ee}tbody tr:nth-child(even){background:#f5f8fa}.chart{display:block;width:100%;height:auto;break-inside:avoid;margin:9pt 0}.chart text{fill:#42586d}.legend{display:flex;gap:14pt;flex-wrap:wrap;font-size:9pt;break-after:avoid}.legend i{display:inline-block;width:8pt;height:8pt;border-radius:2pt;margin-right:4pt}.sources{border-top:1px solid #dbe4eb;padding-top:12pt;color:#607184;font-size:8.5pt}.sources p{margin-bottom:5pt}@media screen{body{max-width:178mm;margin:32px auto;padding:0 8px}}
    td.numeric{text-align:right;font-variant-numeric:tabular-nums}td.identifier{white-space:nowrap;font-size:7.5pt;font-variant-numeric:tabular-nums;overflow-wrap:normal}.sources h2{font-size:10pt;margin-bottom:6pt}.source-ref{font-size:8pt;color:#607184;margin-top:5pt}.source-ref a{color:#16877f;text-decoration:none}.source-card{break-inside:auto;border:1px solid #dbe5eb;border-radius:6pt;margin:10pt 0 16pt;padding:11pt 13pt;color:#354d60;overflow-wrap:anywhere}.source-heading{break-inside:avoid;display:flex;align-items:flex-start;gap:9pt;break-after:avoid}.source-heading strong{font-size:10pt;color:#173450}.source-number{background:#16877f;color:white;border-radius:4pt;padding:2pt 6pt;font-weight:bold}.source-provider{font-size:9pt;color:#16877f;margin-top:2pt}.source-group{margin-top:7pt;break-inside:avoid}.source-group h3{font-size:9pt;margin:0;padding-bottom:3pt;border-bottom:1px solid #e6edf2;color:#173450;break-after:avoid}.source-group dl{margin:3pt 0 0}.source-row{display:grid;grid-template-columns:88pt minmax(0,1fr);gap:9pt;padding:2pt 0;break-inside:avoid}.source-row dt{color:#6a7d8d}.source-row dd{margin:0;white-space:pre-wrap}.source-inputs{margin-top:6pt}.source-inputs a{color:#16877f;text-decoration:none}.source-notes{background:#f4f7fa;padding:7pt 9pt 7pt 21pt;margin:8pt 0 0}.source-notes li{margin:2pt 0;break-inside:avoid}

    ${payload.detail==='brief'?'html{font-size:9.5pt}body{line-height:1.5}header{padding-top:12pt;margin-bottom:16pt}h1{font-size:21pt}h2{font-size:12pt;margin-bottom:7pt}section{margin-bottom:14pt}.summary{font-size:10pt;padding:10pt 12pt}.metric{padding:9pt}.value{font-size:19pt}th,td{padding:6pt}.sources{padding-top:8pt}':''}
    </style></head><body><header><h1>${escapeHtml(doc.title)}</h1>${doc.subtitle?`<p class="subtitle">${escapeHtml(doc.subtitle)}</p>`:''}${doc.metadata?.length?`<div class="meta">${doc.metadata.map(m=>`<span>${escapeHtml(m.label)} · ${escapeHtml(m.value)}</span>`).join('')}</div>`:''}</header>${blocks}${doc.sources?.length||doc.references?.length?`<footer class="sources"><h2>来源与核验</h2>${!doc.references?.length?doc.sources?.map(p).join('')??'':''}${doc.references?.map((ref,i)=>referenceHtml(ref,doc.references!.slice(0,i))).join('')??''}</footer>`:''}</body></html>`;
}
