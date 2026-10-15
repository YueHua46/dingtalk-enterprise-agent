import { chromium } from 'playwright';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compiledDocumentSchema, type CompiledDocument, type DocumentOutput } from './document-render.js';
import { renderDocumentHtml } from './document-html.js';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
export async function renderDocumentPdf(payload:CompiledDocument, directory:string, name:string,
  options:{python?:string; sandbox?:boolean; executablePath?:string} = {}):Promise<DocumentOutput> {
  const parsed=compiledDocumentSchema.parse(payload);
  if (!/^document-[a-f0-9-]{36}$/.test(name)) throw new Error('DOCUMENT_NAME_INVALID');
  const html=renderDocumentHtml(parsed),source=join(directory,`${name}.html`),path=join(directory,`${name}.pdf`);
  const created:string[]=[];
  let browser:Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const abort = new AbortController();
  const stop = () => {abort.abort(); void browser?.close().catch(()=>{});};
  process.once('SIGTERM',stop);
  process.once('SIGINT',stop);
  const timer = setTimeout(stop,80_000);
  try {
    await writeFile(source,html,{flag:'wx',mode:0o600});created.push(source);
    browser=await chromium.launch({headless:true,chromiumSandbox:options.sandbox ?? true,
      ...(options.executablePath?{executablePath:options.executablePath}:{}),timeout:20000});
    if(abort.signal.aborted)throw new Error('DOCUMENT_RENDER_CANCELLED');
    const context=await browser.newContext({javaScriptEnabled:false,serviceWorkers:'block',offline:true,
      viewport:{width:672,height:950}});
    await context.route('**/*',route=>route.abort());
    const page=await context.newPage();
    await page.emulateMedia({media:'print'});
    await page.setContent(html,{waitUntil:'load',timeout:15000});
    await page.evaluate(async()=>{await document.fonts.ready;});
    const overflow=await page.evaluate(()=>Array.from(document.querySelectorAll('section,table,svg,td,th,.metric,.source-card,.source-row,dt,dd')).some(e=>e.scrollWidth>e.clientWidth+2));
    if(overflow)throw new Error('DOCUMENT_LAYOUT_OVERFLOW: shorten labels or reduce table columns');
    const pdf=await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,tagged:true,outline:true,
      displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font-size:8px;color:#75808c;text-align:center;width:100%"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'});
    if(pdf.length>25*1024*1024)throw new Error('DOCUMENT_PDF_TOO_LARGE');
    await writeFile(path,pdf,{flag:'wx',mode:0o600});created.push(path);
    // Inspect and render the actual PDF, not a browser screenshot. Hard limits
    // reject oversized output rather than silently dropping requested content.
    const code=`import json,sys,pathlib,os
protocol=os.fdopen(os.dup(sys.stdout.fileno()),'w',encoding='utf-8')
sys.stdout.flush()
os.dup2(sys.stderr.fileno(),sys.stdout.fileno())
import pymupdf as fitz
doc=fitz.open(sys.argv[1]); n=len(doc)
if n<1 or n>40: raise ValueError('DOCUMENT_PAGE_LIMIT: max 40 pages; split the document')
previews=[]
for i,page in enumerate(doc):
 if not page.get_text().strip(): raise ValueError('DOCUMENT_EMPTY_PAGE')
 rect=page.rect
 for word in page.get_text('words'):
  if word[0]<-1 or word[1]<-1 or word[2]>rect.width+1 or word[3]>rect.height+1: raise ValueError('DOCUMENT_PDF_CLIPPED')
 target=pathlib.Path(sys.argv[1]).with_suffix('.page-'+str(i+1)+'.png')
 page.get_pixmap(matrix=fitz.Matrix(1,1),alpha=False).save(str(target)); previews.append(str(target))
print(json.dumps({'pageCount':n,'previews':previews}),file=protocol,flush=True)`;
    const result=await exec(options.python ?? '/opt/venv/bin/python',['-c',code,path],{timeout:20000,maxBuffer:128*1024,signal:abort.signal});
    const info=JSON.parse(result.stdout) as {pageCount:number;previews:string[]};
    created.push(...info.previews);
    return {path,source,...info};
  } catch(error) {
    // Preview names are deterministic even if Python fails midway before it
    // can return its result; remove only files belonging to this render.
    await Promise.allSettled([...created,...Array.from({length:40},(_,i)=>join(directory,`${name}.page-${i+1}.png`))].map(file=>rm(file,{force:true})));
    throw error;
  } finally {
    clearTimeout(timer);process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
    await browser?.close();
  }
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const [source,directory,name]=process.argv.slice(2);
  if(!source||!directory||!name)throw new Error('DOCUMENT_WORKER_ARGUMENTS_REQUIRED');
  const payload=compiledDocumentSchema.parse(JSON.parse(await readFile(source,'utf8')));
  process.stdout.write(JSON.stringify(await renderDocumentPdf(payload,directory,name,
    {...(process.env.DOCUMENT_PDF_PYTHON?{python:process.env.DOCUMENT_PDF_PYTHON}:{}),
      ...(process.env.DOCUMENT_CHROMIUM_EXECUTABLE?{executablePath:process.env.DOCUMENT_CHROMIUM_EXECUTABLE}:{})})));
}
