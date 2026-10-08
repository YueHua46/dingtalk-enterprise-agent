import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { Socket } from 'node:net';
import { createReadStream } from 'node:fs';
import { fileTypeFromBuffer } from 'file-type';
import { OfficeParser } from 'officeparser';
import type { Config } from './config.js';
import type { Attachment } from './types.js';

interface TokenCache {
  token: string;
  expiresAt: number;
}

export class MediaPipeline {
  private token?: TokenCache;

  public constructor(private readonly config: Config) {}

  public async prepare(requestId: string, attachments: Attachment[], extractText = true): Promise<Attachment[]> {
    const results: Attachment[] = [];
    for (const attachment of attachments) {
      try {
        results.push(await this.prepareOne(requestId, attachment, extractText));
      } catch (error) {
        results.push({
          ...attachment,
          extractedText: '[附件处理失败：' + (error instanceof Error ? error.message : String(error)) + ']'
        });
      }
    }
    return results;
  }

  private async prepareOne(requestId: string, attachment: Attachment, extractText: boolean): Promise<Attachment> {
    if (attachment.localPath) return extractText ? this.extract(attachment) : attachment;
    if (!attachment.downloadCode) return attachment;
    const downloadUrl = await this.getDownloadUrl(attachment.downloadCode);
    const response = await fetch(downloadUrl, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error('附件下载失败 HTTP ' + response.status);
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > this.config.MEDIA_MAX_BYTES) throw new Error('附件超过大小限制');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > this.config.MEDIA_MAX_BYTES) throw new Error('附件超过大小限制');
    await this.scan(buffer);
    const detected = await fileTypeFromBuffer(buffer);
    const contentType = detected?.mime ?? response.headers.get('content-type') ?? attachment.contentType;
    const directory = resolve(this.config.MEDIA_DIR, safeSegment(requestId));
    await mkdir(directory, { recursive: true });
    const original = safeName(attachment.name || 'attachment');
    const extension = extname(original) || (detected?.ext ? '.' + detected.ext : '');
    const fileName = basename(original, extname(original)) + '-' + randomUUID() + extension;
    const localPath = join(directory, fileName);
    await writeFile(localPath, buffer, { mode: 0o600 });
    const saved = {
      ...attachment,
      ...(contentType ? { contentType } : {}),
      size: buffer.length,
      localPath,
      sha256: createHash('sha256').update(buffer).digest('hex')
    };
    return extractText ? this.extract(saved) : saved;
  }

  private async extract(attachment: Attachment): Promise<Attachment> {
    if (!attachment.localPath) return attachment;
    const extension = extname(attachment.localPath).toLowerCase();
    if (['.txt', '.md', '.csv', '.json', '.html', '.xml'].includes(extension)) {
      const text = await import('node:fs/promises').then((fs) => fs.readFile(attachment.localPath!, 'utf8'));
      return { ...attachment, extractedText: truncate(text) };
    }
    if (['.pdf', '.docx', '.pptx', '.xlsx', '.odt', '.ods', '.odp', '.rtf'].includes(extension)) {
      const ast = await OfficeParser.parseOffice(attachment.localPath, { extractAttachments: false, ocr: false });
      const generated = await ast.to('text');
      return { ...attachment, extractedText: truncate(String(generated.value ?? '')) };
    }
    return attachment;
  }

  private async getDownloadUrl(downloadCode: string): Promise<string> {
    if (!this.config.DINGTALK_CLIENT_ID || !this.config.DINGTALK_CLIENT_SECRET) {
      throw new Error('缺少钉钉应用凭证');
    }
    const token = await this.getAccessToken();
    const response = await fetch('https://api.dingtalk.com/v1.0/robot/messageFiles/download', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-acs-dingtalk-access-token': token
      },
      body: JSON.stringify({ downloadCode, robotCode: this.config.DINGTALK_ROBOT_CODE }),
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error('获取附件下载地址失败 HTTP ' + response.status);
    const body = await response.json() as { downloadUrl?: string };
    if (!body.downloadUrl || !body.downloadUrl.startsWith('https://')) throw new Error('钉钉未返回安全下载地址');
    return body.downloadUrl;
  }

  private async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.token;
    const response = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        appKey: this.config.DINGTALK_CLIENT_ID,
        appSecret: this.config.DINGTALK_CLIENT_SECRET
      }),
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error('获取应用 AccessToken 失败 HTTP ' + response.status);
    const body = await response.json() as { accessToken?: string; expireIn?: number };
    if (!body.accessToken) throw new Error('钉钉未返回 AccessToken');
    this.token = { token: body.accessToken, expiresAt: Date.now() + (body.expireIn ?? 7200) * 1000 };
    return body.accessToken;
  }

  public async scan(buffer: Buffer): Promise<void> {
    if (!this.config.CLAMAV_HOST) return;
    const result = await scanClamAv(this.config.CLAMAV_HOST, this.config.CLAMAV_PORT, buffer);
    if (!result.endsWith('OK')) throw new Error('附件安全扫描未通过');
  }
  public async scanFile(path:string):Promise<void>{
    if(!this.config.CLAMAV_HOST)return;
    const result=await scanClamAvFile(this.config.CLAMAV_HOST,this.config.CLAMAV_PORT,path);
    if(!result.endsWith('OK'))throw new Error('KNOWLEDGE_SECURITY_SCAN_FAILED');
  }
}

export function scanClamAvFile(host:string,port:number,path:string):Promise<string>{
  return new Promise((resolve,reject)=>{
    const socket=new Socket();let response='';
    const input=createReadStream(path,{highWaterMark:64*1024});
    const timer=setTimeout(()=>socket.destroy(new Error('KNOWLEDGE_SECURITY_SCAN_TIMEOUT')),240_000);
    const cleanup=()=>{clearTimeout(timer);input.destroy();};
    const write=(bytes:Buffer)=>new Promise<void>((done,fail)=>{
      socket.write(bytes,(error)=>error?fail(error):done());
    });
    socket.on('data',chunk=>{response+=String(chunk);});
    socket.on('error',error=>{cleanup();reject(error);});
    socket.on('end',()=>{cleanup();resolve(response.replace(/\0/g,'').trim());});
    socket.connect(port,host,()=>{void(async()=>{
      await write(Buffer.from('zINSTREAM\0'));
      for await(const chunk of input){const bytes=chunk as Buffer,header=Buffer.alloc(4);header.writeUInt32BE(bytes.length);await write(header);await write(bytes);}
      await write(Buffer.alloc(4));
    })().catch(error=>socket.destroy(error));});
  });
}

export function scanClamAv(host: string, port: number, buffer: Buffer): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const socket = new Socket();
    let response = '';
    const timer = setTimeout(() => socket.destroy(new Error('ClamAV scan timed out')), 60_000);
    socket.connect(port, host, () => {
      socket.write('zINSTREAM\0');
      const header = Buffer.alloc(4);
      header.writeUInt32BE(buffer.length);
      socket.write(header);
      socket.write(buffer);
      socket.write(Buffer.alloc(4));
    });
    socket.on('data', (chunk) => { response += String(chunk); });
    socket.on('end', () => {
      clearTimeout(timer);
      resolvePromise(response.replace(/\0/g, '').trim());
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}

function safeName(value: string): string {
  const cleaned = basename(value).replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_');
  return cleaned.slice(0, 160) || 'attachment';
}

function truncate(value: string): string {
  return value.length <= 200_000 ? value : value.slice(0, 200_000) + '\n[内容已截断]';
}
