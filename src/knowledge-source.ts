import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from './config.js';
import type { DwsBroker } from './dws-broker.js';
import type { UserIdentity } from './types.js';
import type { KnowledgeResource, KnowledgeStore } from './knowledge-store.js';
import { chunkText, credentialVault, fingerprint, parseJsonml, parseSheet, sanitizeKnowledge, type KnowledgeContent, type KnowledgePosition } from './knowledge-parse.js';
import type { KnowledgeModel } from './knowledge-model.js';
import { MediaPipeline } from './media.js';
import { mapConcurrent } from './knowledge-concurrency.js';
import { KnowledgeExport } from './knowledge-export.js';
import { KnowledgeSheetExport } from './knowledge-sheet-export.js';
import { sheetExportProtocol } from './knowledge-sheet-job.js';

interface BinaryResult {
  sheets: Array<{ title: string; rows: Array<{ row: number; cells: string[] }>; mergedRanges:string[] }>;
  pages: Array<{ page: number; text: string; regions: Array<{ box: number[]; text: string }> }>;
  images: Array<{ dataUrl?: string; hash:string; redactions?:number; position: KnowledgePosition }>; quality: string[]; sourceHash:string;
}
export interface SourceRead { content: KnowledgeContent; hash: string; target?:string }
export function documentImageReferences(raw:unknown):Array<{block:string;resourceId?:string;inlineSvg?:string;whiteboard:boolean}>{
  const tree=typeof raw==='string'?JSON.parse(raw):raw;
  const images:Array<{block:string;resourceId?:string;inlineSvg?:string;whiteboard:boolean}>=[];
  function walk(node:unknown,path:string):void{
    if(!Array.isArray(node))return;
    const attrs=node[1]&&typeof node[1]==='object'&&!Array.isArray(node[1])?node[1] as Record<string,any>:{};
    const whiteboard=node[0]==='card'&&attrs.cardType==='hetu';
    if(/image|img/i.test(String(node[0]))||whiteboard){
      const resourceId=attrs.extraData?.resourceId??attrs.resourceId;
      // A data payload is document content, never a URL to fetch. Imported
      // Word drawings have SVG bytes here and no media resource identity.
      const inlineSvg=!whiteboard&&resourceId==null&&typeof attrs.src==='string'&&attrs.src.startsWith('data:image/svg+xml;base64,')?attrs.src.slice('data:image/svg+xml;base64,'.length):undefined;
      images.push({block:String(attrs.uuid??attrs.id??path),whiteboard,...(typeof resourceId==='string'?{resourceId}:{}),...(inlineSvg!==undefined?{inlineSvg}:{})});
    }
    node.slice(node[1]===attrs?2:1).forEach((child,index)=>walk(child,`${path}.${index}`));
  }
  walk(tree,'root');return images;
}
export class KnowledgeSource {
  public constructor(private readonly config: Config, private readonly dws: DwsBroker, private readonly model: KnowledgeModel,private readonly imageStore?:KnowledgeStore) {}
  public async metadata(user: UserIdentity, nodeId: string): Promise<Record<string, any>> {
    const result = await this.dws.runCommand(user, ['wiki', '+node-get', '--node', nodeId]) as Record<string, any>;
    const node = result.node ?? result;
    if (node.nodeId !== nodeId) throw new Error('KNOWLEDGE_METADATA_UNVERIFIED');
    return node;
  }
  public supported(resource: KnowledgeResource): boolean {
    return ['adoc','axls','pdf','png','jpg','jpeg','bmp','dlink'].includes(resource.extension)
      && !credentialVault(resource.path) && !/(?:^|\/)(?:信息表|销售订单|生产订单|历史订单|订单资料)(?:\/|$)/.test(resource.path);
  }
  public async read(user: UserIdentity, resource: KnowledgeResource, vision = true, visited = new Set<string>(), background = false,cacheNodeId=resource.nodeId): Promise<SourceRead> {
    if (!this.supported(resource)) throw new Error('KNOWLEDGE_SOURCE_EXCLUDED');
    if (visited.has(resource.nodeId) || visited.size > 5) throw new Error('KNOWLEDGE_SHORTCUT_CYCLE');
    visited.add(resource.nodeId);
    if (resource.extension === 'dlink') {
      const result = await this.dws.runCommand(user, ['doc', '+inspect', '--node', resource.nodeId],{background}) as any;
      const doc = result.document ?? result.data?.document;
      const target = doc?.linkSourceInfo;
      if (!target?.nodeId || !/^[a-zA-Z0-9_-]{8,128}$/.test(target.nodeId) || target.nodeId === resource.nodeId) throw new Error('KNOWLEDGE_SHORTCUT_TARGET_UNVERIFIED');
      const inspected=await this.dws.runCommand(user,['doc','+inspect','--node',target.nodeId],{background}) as any;
      const targetDoc=inspected.document ?? inspected.data?.document;
      if(!targetDoc || credentialVault(String(targetDoc.name ?? ''))) throw new Error('KNOWLEDGE_SHORTCUT_TARGET_EXCLUDED');
      const read=await this.read(user, { ...resource, nodeId:target.nodeId, extension:target.extension ?? 'adoc' }, vision, visited,background,cacheNodeId);
      return {...read,target:target.nodeId};
    }
    if (resource.extension === 'adoc') {
      const result = await this.dws.runCommand(user, ['doc','+fetch','--node',resource.nodeId,'--scope','full','--detail','full'],{background}) as any;
      if (result.complete !== true || !result.content?.jsonml) throw new Error('KNOWLEDGE_DOCUMENT_INCOMPLETE');
      const content = parseJsonml(result.content.jsonml);
      // Native images use IDs from this employee's current JSONML blocks and
      // the formal media downloader. Never follow arbitrary JSONML URLs.
      // Whiteboard cards still need verified rendered document evidence.
      if (vision && content.quality.some((q) => q.startsWith('image_pending:'))) {
        const references=documentImageReferences(result.content.jsonml);
        const binary:BinaryResult={sheets:[],pages:[],images:[],quality:[],sourceHash:fingerprint(result.content.jsonml)};
        for(const image of references.filter(r=>!r.whiteboard)){
          let media:BinaryResult,imageIdentity:string;
          if(image.inlineSvg!==undefined){
            if(!image.inlineSvg.length||image.inlineSvg.length>12*1024*1024||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.inlineSvg))throw new Error('KNOWLEDGE_INLINE_IMAGE_INVALID');
            const bytes=Buffer.from(image.inlineSvg,'base64');
            if(bytes.toString('base64')!==image.inlineSvg)throw new Error('KNOWLEDGE_INLINE_IMAGE_INVALID');
            media=await this.binary(user,resource,'svg',undefined,true,background,bytes);
            imageIdentity='inline-svg:'+createHash('sha256').update(bytes).digest('hex');
          }else{
            if(!image.resourceId||!/^[A-Za-z0-9_-]{8,128}$/.test(image.resourceId))throw new Error('KNOWLEDGE_IMAGE_RESOURCE_UNVERIFIED');
            media=await this.binary(user,resource,'png',['doc','+media-download','--node',resource.nodeId,'--resource-id',image.resourceId],true,background);
            imageIdentity=image.resourceId;
          }
          if(media.images.length!==1||media.pages.length||media.sheets.length)throw new Error('KNOWLEDGE_IMAGE_RESOURCE_UNVERIFIED');
          binary.images.push({...media.images[0]!,position:{block:image.block,image:imageIdentity}});
          binary.quality.push(...media.quality);
        }
        if(references.some(r=>r.whiteboard)){
          const rendered=await this.binary(user,resource,'pdf',['doc','+export','--node',resource.nodeId,'--export-format','pdf'],true,background,undefined,fingerprint(result.content.jsonml));
          binary.images.push(...rendered.images);binary.pages.push(...rendered.pages);binary.quality.push(...rendered.quality);
        }
        if(!binary.images.length)throw new Error('KNOWLEDGE_DOCUMENT_IMAGES_UNVERIFIED');
        await this.mergeBinary(content, binary, resource, true,user,cacheNodeId);
        content.quality=content.quality.filter(q=>!q.startsWith('image_pending:'));
        if(content.chunks.length)content.quality=content.quality.filter(q=>q!=='no_text_requires_image_check');
      }
      return { content, hash: fingerprint(result.content.jsonml) };
    }
    const kind = resource.extension === 'axls' ? 'xlsx' : resource.extension;
    const binary = await this.binary(user, resource, kind, resource.extension === 'axls' ? ['sheet','export','--node',resource.nodeId] : undefined,vision,background);
    const content: KnowledgeContent = { chunks:[],facts:[],quality:[] };
    await this.mergeBinary(content,binary,resource,vision,user,cacheNodeId);
    if (!/^[a-f0-9]{64}$/.test(binary.sourceHash)) throw new Error('KNOWLEDGE_SOURCE_HASH_INVALID');
    return { content, hash: binary.sourceHash };
  }
  private async mergeBinary(content: KnowledgeContent, binary: BinaryResult, resource: KnowledgeResource, vision: boolean,user:UserIdentity,cacheNodeId:string): Promise<void> {
    content.quality.push(...binary.quality);
    for (const sheet of binary.sheets) {
      if (credentialVault(sheet.title)) { content.quality.push('credential_sheet_excluded'); continue; }
      const parsed = parseSheet(sheet.rows, sheet.title, resource.title === '各产品参数资料');
      for (const chunk of parsed.chunks) chunk.position.mergedRanges=sheet.mergedRanges;
      content.chunks.push(...parsed.chunks);content.facts.push(...parsed.facts);content.quality.push(...parsed.quality);
    }
    for (const page of binary.pages) {
      for (const region of page.regions) content.chunks.push(...chunkText(region.text, { page:page.page, region:region.box }, 'pdf_text'));
    }
    if(!vision){content.quality.push(...binary.images.map(()=>'image_not_verified'));}
    else {
    const recognized=await mapConcurrent(binary.images,this.config.KNOWLEDGE_VISION_CONCURRENCY,async(image,index)=>{
      if (!image.dataUrl) throw new Error('KNOWLEDGE_IMAGE_MISSING');
      const recognize=async()=>sanitizeKnowledge(await this.model.recognize(image.dataUrl!));
      const modelKey=fingerprint([this.config.MODEL_BASE_URL,this.config.MODEL_NAME,'knowledge-vision-prompt-v1']);
      let text:string;
      try{text=this.imageStore?await this.imageStore.recognizedImage(user,cacheNodeId,fingerprint([image.hash,image.dataUrl]),modelKey,recognize):await recognize();}
      catch(error){
        if(error instanceof Error)Object.assign(error,{sourceStage:'image_recognition',modelImageOrdinal:index+1,
          modelImageHash:/^[a-f0-9]{64}$/.test(image.hash)?image.hash:undefined});
        throw error;
      }
      return {image,text};
    });
    for(const {image,text} of recognized){
      if(image.redactions) content.quality.push('credential_image_regions_redacted');
      (content.assets ??= []).push({dataUrl:image.dataUrl!,position:image.position});
      content.chunks.push(...chunkText(text, image.position, 'vision_inference'));
    }
    }
    if (!content.chunks.length) content.quality.push('no_text_requires_review');
  }
  private async binary(user: UserIdentity, resource: KnowledgeResource, extension: string, exportArgs?: string[], images = true, background = false,inlineBytes?:Buffer,exportSourceHash?:string): Promise<BinaryResult> {
    if (!this.config.FILE_WORKER_URL || !this.config.FILE_WORKER_SECRET) throw new Error('KNOWLEDGE_FILE_WORKER_REQUIRED');
    await mkdir(this.config.KNOWLEDGE_DIR, { recursive:true });
    const directory = await mkdtemp(join(this.config.KNOWLEDGE_DIR,'parse-'));
    const name = `${resource.nodeId}.${extension}`, path = join(directory,name), taskId = randomUUID();
    const headers = { 'x-file-worker-secret':this.config.FILE_WORKER_SECRET };
    const endpoint = this.config.FILE_WORKER_URL.replace(/\/+$/, '') + '/tasks/' + taskId;
    const request = async (suffix: string, init: RequestInit): Promise<any> => {
      const response = await fetch(endpoint + suffix,{ ...init, headers:{ ...headers,...init.headers },signal:AbortSignal.timeout(240_000) }).catch(cause=>{
        throw Object.assign(new Error(['TimeoutError','AbortError'].includes(cause?.name)?'KNOWLEDGE_WORKER_REQUEST_TIMEOUT':'KNOWLEDGE_WORKER_TRANSPORT_FAILED'),{cause});
      });
      if (!response.ok) {
        const diagnostic=await response.json().catch(()=>undefined) as {error?:unknown}|undefined;
        if(typeof diagnostic?.error==='string'&&/^KNOWLEDGE_[A-Z_0-9]{1,100}$/.test(diagnostic.error))throw new Error(diagnostic.error);
        throw new Error(`KNOWLEDGE_WORKER_HTTP_${response.status}`);
      }
      return response.json().catch(cause=>{throw Object.assign(new Error('KNOWLEDGE_WORKER_RESPONSE_INVALID'),{cause});});
    };
    let stage=inlineBytes?'inline_document_content':exportArgs?.includes('+media-download')?'dws_media_download':exportArgs?'dws_export':'dws_download';
    let scanned=false;
    try {
      let downloaded:Record<string,any>|undefined;
      if(inlineBytes){
        if(resource.extension!=='adoc'||extension!=='svg'||exportArgs||!inlineBytes.length||inlineBytes.length>8*1024*1024)throw new Error('KNOWLEDGE_INLINE_IMAGE_INVALID');
        await writeFile(path,inlineBytes,{mode:0o600,flag:'wx'});
      }else if(exportArgs?.includes('+export')){
        if(!this.imageStore||!exportSourceHash)throw new Error('KNOWLEDGE_EXPORT_STORE_REQUIRED');
        const run=(args:string[])=>this.dws.runCommand(user,[...args,'--output',name],{cwd:directory,timeout:240_000,background});
        await new KnowledgeExport(this.imageStore.pool,this.config.KNOWLEDGE_DIR,this.config.KNOWLEDGE_MAX_SOURCE_BYTES,async file=>{
          stage='security_scan';await new MediaPipeline(this.config).scanFile(file);scanned=true;
        }).download(user,resource.nodeId,exportSourceHash,path,
          ()=>run(exportArgs),jobId=>run(['doc','+export-get','--job-id',jobId]),async()=>{
            const latest=await this.dws.runCommand(user,['doc','+fetch','--node',resource.nodeId,'--scope','full','--detail','full'],{background}) as any;
            if(latest.complete!==true||!latest.content?.jsonml||fingerprint(latest.content.jsonml)!==exportSourceHash)throw new Error('KNOWLEDGE_SOURCE_CHANGED_DURING_EXPORT');
          });
      }else if(exportArgs?.[0]==='sheet'&&exportArgs[1]==='export'){
        if(!this.imageStore)throw new Error('KNOWLEDGE_EXPORT_STORE_REQUIRED');
        await new KnowledgeSheetExport(this.imageStore.pool).downloadJob(user,resource.nodeId,resource.metadataHash,
          sheetExportProtocol(this.dws,user,resource.nodeId,path,this.config.KNOWLEDGE_MAX_SOURCE_BYTES,background),async()=>{
            const file=await stat(path);
            if(!file.size)throw new Error('KNOWLEDGE_BINARY_EMPTY');
            if(file.size>this.config.KNOWLEDGE_MAX_SOURCE_BYTES)throw new Error('KNOWLEDGE_SOURCE_SIZE_LIMIT');
            stage='security_scan';await new MediaPipeline(this.config).scanFile(path);scanned=true;
          });
      }else if (exportArgs) downloaded=await this.dws.runCommand(user,[...exportArgs,'--output',name],{cwd:directory,timeout:240_000,background}) as Record<string,any>;
      else await this.dws.downloadDriveFile(user,resource.nodeId,directory,name,{background});
      const info = await stat(path);
      if(exportArgs?.includes('+media-download')&&(downloaded?.verified!==true||downloaded?.nodeId!==resource.nodeId||downloaded?.resourceId!==exportArgs[exportArgs.indexOf('--resource-id')+1]||downloaded?.sizeBytes!==info.size))throw new Error('KNOWLEDGE_MEDIA_DOWNLOAD_UNVERIFIED');
      if (!info.size) throw new Error('KNOWLEDGE_BINARY_EMPTY');
      if(info.size>this.config.KNOWLEDGE_MAX_SOURCE_BYTES)throw new Error('KNOWLEDGE_SOURCE_SIZE_LIMIT');
      stage='security_scan';if(!scanned)await new MediaPipeline(this.config).scanFile(path);
      const digest=createHash('sha256');for await(const chunk of createReadStream(path))digest.update(chunk);
      const sha256=digest.digest('hex');
      stage='worker_upload';await request('',{ method:'POST' });
      const uploaded = await request(`/knowledge-inputs/${sha256}?name=${encodeURIComponent(name)}`,{ method:'PUT',body:Readable.toWeb(createReadStream(path)),duplex:'half' } as RequestInit);
      if(uploaded.sha256!==sha256||uploaded.size!==info.size)throw new Error('KNOWLEDGE_UPLOAD_UNVERIFIED');
      stage='manifest_parse';const result=await request('/knowledge-parse',{ method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:uploaded.path.split(/[\\/]/).at(-1),images:false,manifest:true}) }) as BinaryResult;
      if(images){
        stage='image_parse';
        const expected=result.images;
        const rendered:BinaryResult['images']=[];
        for(let cursor=0;cursor<expected.length;){
          const batch=await request('/knowledge-images',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cursor,count:4})});
          if(batch.sourceHash!==result.sourceHash||batch.total!==expected.length||!Array.isArray(batch.images)||batch.images.length!==Math.min(4,expected.length-cursor)||batch.next!==cursor+batch.images.length)throw new Error('KNOWLEDGE_IMAGE_BATCH_UNVERIFIED');
          for(const [index,image] of batch.images.entries()){
            if(image.hash!==expected[cursor+index]?.hash||fingerprint(image.position)!==fingerprint(expected[cursor+index]?.position))throw new Error('KNOWLEDGE_IMAGE_BATCH_UNVERIFIED');
            rendered.push(image);
          }
          cursor=batch.next;
        }
        result.images=rendered;
      }
      return result;
    }catch(error){
      if(error instanceof Error)Object.assign(error,{sourceStage:(error as Error&{exportStage?:string}).exportStage??stage});
      throw error;
    } finally {
      await request('',{method:'DELETE'}).catch(() => undefined);
      await rm(directory,{recursive:true,force:true});
    }
  }
}
