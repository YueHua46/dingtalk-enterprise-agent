// Read-only structural diagnostics. No source text, credentials or URLs in reports.
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,stat,rm,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {loadConfig} from '../dist/config.js';
import {DwsBroker} from '../dist/dws-broker.js';
import {MediaPipeline} from '../dist/media.js';
import {fingerprint} from '../dist/knowledge-parse.js';
const config=loadConfig({...process.env,NODE_ENV:'test',FILE_WORKER_MODE:'off',DWS_CONFIG_DIR:join(homedir(),'.dws'),CLAMAV_HOST:'127.0.0.1'});
const user={corpId:'ding5cc0e9161525554835c2f4657eb6378f',userId:'1769391205643357'};
const dws=new DwsBroker(config),pool=new Pool({connectionString:'postgres://postgres:rag-local-test@127.0.0.1:15432/rag_acceptance'});
const sizeOnly=process.argv.includes('--size-only');
const sourceOnly=process.argv.includes('--source-failure');
const ocrOnly=process.argv.includes('--ocr')||process.argv.includes('--ocr-benchmark')||process.argv.includes('--ocr-profile')||process.argv.includes('--ocr-tiles');
const {rows}=await pool.query(sourceOnly?`SELECT node_id,title,extension,error_code FROM knowledge_resources WHERE corp_id=$1 AND user_id=$2 AND error_code='source_read_failed' ORDER BY title LIMIT 1`:ocrOnly?`SELECT node_id,title,extension,error_code FROM knowledge_resources WHERE corp_id=$1 AND user_id=$2 AND error_code='KNOWLEDGE_OCR_TIMEOUT'`:sizeOnly?`SELECT node_id,title,extension,error_code FROM knowledge_resources WHERE corp_id=$1 AND user_id=$2 AND error_code='KNOWLEDGE_BINARY_SIZE_INVALID'`:`SELECT DISTINCT ON(error_code) node_id,title,extension,error_code FROM knowledge_resources
 WHERE corp_id=$1 AND user_id=$2 AND error_code IN ('KNOWLEDGE_BINARY_PARSE_FAILED','KNOWLEDGE_WORKBOOK_CELL_LIMIT','KNOWLEDGE_IMAGE_LIMIT','KNOWLEDGE_BINARY_SIZE_INVALID','source_read_failed') ORDER BY error_code,title`,[user.corpId,user.userId]);
await mkdir('data/knowledge-acceptance',{recursive:true});await mkdir('output/knowledge-diagnostics',{recursive:true});
const report=[];
try{for(const row of rows){
 const directory=await mkdtemp(join(process.cwd(),'data/knowledge-acceptance/diagnose-')),task=randomUUID();
 const endpoint='http://127.0.0.1:18081/tasks/'+task;
 const request=async(suffix,init)=>{const r=await fetch(endpoint+suffix,{...init,headers:{'x-file-worker-secret':config.FILE_WORKER_SECRET,...init.headers},signal:AbortSignal.timeout(180000)});if(!r.ok)throw new Error('WORKER_HTTP_'+r.status);return r.json();};
 const entry={...row};report.push(entry);
 try{
  const extension=row.extension==='axls'?'xlsx':row.extension==='adoc'?'pdf':row.extension,name=row.node_id+'.'+extension;
  const args=row.extension==='axls'?['sheet','export','--node',row.node_id]:row.extension==='adoc'?['doc','+export','--node',row.node_id,'--export-format','pdf']:null;
  if(args)await dws.runCommand(user,[...args,'--output',name],{cwd:directory,timeout:240000,background:true});else await dws.downloadDriveFile(user,row.node_id,directory,name,{background:true});
  entry.bytes=(await stat(join(directory,name))).size;
  if(entry.bytes>config.MEDIA_MAX_BYTES){entry.diagnostic='source_exceeds_upload_size';continue;}
  const bytes=await readFile(join(directory,name));await new MediaPipeline(config).scan(bytes);
  await request('',{method:'POST'});
  const uploaded=await request('/inputs/'+fingerprint(bytes)+'?name='+encodeURIComponent(name),{method:'PUT',body:bytes});
  const code=`import json,zipfile,os,xml.etree.ElementTree as E,time\np=${JSON.stringify(uploaded.path)}\nr={}\nif p.endswith('.xlsx'):\n with zipfile.ZipFile(p) as z:\n  r['mediaFiles']=len([n for n in z.namelist() if n.startswith('xl/media/')])\n  r['expandedBytes']=sum(i.file_size for i in z.infolist())\n  r['worksheets']=[]\n  for n in z.namelist():\n   if n.startswith('xl/worksheets/sheet') and n.endswith('.xml'):\n    root=E.fromstring(z.read(n)); ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}; dim=root.find('m:dimension',ns)\n    r['worksheets'].append({'dimension':dim.attrib.get('ref') if dim is not None else None,'storedCells':len(root.findall('.//m:c',ns)),'valueCells':sum(1 for c in root.findall('.//m:c',ns) if c.find('m:v',ns) is not None or c.find('m:is',ns) is not None)})\nelse:\n import pymupdf\n d=pymupdf.open(p);r['pages']=len(d);r['imagePages']=sum(bool(p.get_images()) for p in d);d.close()\nprint(json.dumps(r))`;
  const result=await request('/python',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})});
  entry.structure=result.exitCode===0?JSON.parse(result.stdout):{exitCode:result.exitCode,timedOut:result.timedOut};
  if(ocrOnly){
   const inventory=await request('/python',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:`import json,zipfile,io\nfrom PIL import Image\nr=[]\nwith zipfile.ZipFile(${JSON.stringify(uploaded.path)}) as z:\n for n in z.namelist():\n  if n.startswith('xl/media/'):\n   with Image.open(io.BytesIO(z.read(n))) as im:r.append({'width':im.width,'height':im.height,'pixels':im.width*im.height})\nprint(json.dumps(r))`})});
   entry.imageSizes=inventory.exitCode===0?JSON.parse(inventory.stdout):{exitCode:inventory.exitCode};
   if(process.argv.includes('--ocr-benchmark')){
    const benchmark=await request('/python',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:`import json,zipfile,io,time,os\nos.environ['OMP_THREAD_LIMIT']='1'\nfrom PIL import Image\nimport pytesseract\nr=[]\nwith zipfile.ZipFile(${JSON.stringify(uploaded.path)}) as z:\n n=next(n for n in z.namelist() if n.startswith('xl/media/'))\n im=Image.open(io.BytesIO(z.read(n))).convert('RGB')\n for scale in (1,2):\n  start=time.monotonic();entry={'scale':scale}\n  try:\n   d=pytesseract.image_to_data(im.resize((im.width*scale,im.height*scale)),lang='eng+chi_sim',config='--psm 11',output_type=pytesseract.Output.DICT,timeout=40)\n   entry['status']='passed';entry['words']=sum(bool(t.strip()) for t in d['text'])\n  except RuntimeError:entry['status']='timeout_or_failed'\n  entry['seconds']=round(time.monotonic()-start,2);r.append(entry)\nprint(json.dumps(r))`})});
    entry.ocrBenchmark=benchmark.exitCode===0?JSON.parse(benchmark.stdout):{exitCode:benchmark.exitCode};
   }
   if(process.argv.includes('--ocr-profile')){
    const profile=await request('/python',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:`import json,zipfile,io,time,os\nos.environ['OMP_THREAD_LIMIT']='1'\nfrom PIL import Image\nfrom concurrent.futures import ThreadPoolExecutor\nimport pytesseract\nwith zipfile.ZipFile(${JSON.stringify(uploaded.path)}) as z:items=[(i,z.read(n)) for i,n in enumerate(n for n in z.namelist() if n.startswith('xl/media/'))]\ndef run(item):\n i,data=item;im=Image.open(io.BytesIO(data)).convert('RGB');r={'image':i,'width':im.width,'height':im.height};start=time.monotonic()\n try:\n  d=pytesseract.image_to_data(im.resize((im.width*2,im.height*2)),lang='eng+chi_sim',config='--psm 11',output_type=pytesseract.Output.DICT,timeout=20)\n  r['status']='passed';r['words']=sum(bool(t.strip()) for t in d['text'])\n except RuntimeError:r['status']='timeout_or_failed'\n r['seconds']=round(time.monotonic()-start,2);print(json.dumps(r),flush=True);return r\nwith ThreadPoolExecutor(max_workers=4) as ex:list(ex.map(run,items))`})});
    entry.ocrProfile={exitCode:profile.exitCode,timedOut:profile.timedOut,images:profile.stdout.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line))};
   }
   if(process.argv.includes('--ocr-tiles')){
    const tiled=await request('/python',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:`import json,zipfile,io,time,os\nos.environ['OMP_THREAD_LIMIT']='1'\nfrom PIL import Image\nimport pytesseract\nwith zipfile.ZipFile(${JSON.stringify(uploaded.path)}) as z:im=Image.open(io.BytesIO(z.read([n for n in z.namelist() if n.startswith('xl/media/')][13]))).convert('RGB')\nstart=time.monotonic()\nfor top in range(0,im.height,336):\n crop=im.crop((0,top,im.width,min(top+400,im.height)));crop=crop.resize((crop.width*2,crop.height*2));t=time.monotonic();r={'image':13,'top':top}\n try:\n  d=pytesseract.image_to_data(crop,lang='eng+chi_sim',config='--psm 11',output_type=pytesseract.Output.DICT,timeout=20);r['status']='passed';r['words']=sum(bool(s.strip()) for s in d['text'])\n except RuntimeError:r['status']='timeout_or_failed'\n r['seconds']=round(time.monotonic()-t,2);print(json.dumps(r),flush=True)\nprint(json.dumps({'totalSeconds':round(time.monotonic()-start,2)}),flush=True)`})});
    entry.ocrTiles={exitCode:tiled.exitCode,timedOut:tiled.timedOut,regions:tiled.stdout.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line))};
   }
  }
 }catch(error){entry.diagnostic=/^[A-Z_0-9]+$/.test(error.message)?error.message:'dws_read_failed';entry.dwsCode=String(error.dwsCode??'').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,100);entry.dwsCategory=String(error.dwsCategory??'').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,100);}
 finally{await request('',{method:'DELETE'}).catch(()=>{});await rm(directory,{recursive:true,force:true});const reportName=sourceOnly?'source-read-live':process.argv.includes('--ocr-tiles')?'ocr-tiles':process.argv.includes('--ocr-profile')?'ocr-profile':process.argv.includes('--ocr-benchmark')?'ocr-benchmark':ocrOnly?'ocr-structure':sizeOnly?'pdf-size':'structure';await writeFile('output/knowledge-diagnostics/'+reportName+'.json',JSON.stringify(report,null,2));}
 console.log(JSON.stringify(entry));
}}finally{await pool.end();}
