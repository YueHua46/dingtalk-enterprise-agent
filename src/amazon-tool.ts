import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import type { Attachment } from './types.js';

const execFileAsync = promisify(execFile);
const marketplace = { type: 'string', enum: ['US', 'CA', 'JP', 'UK', 'FR', 'BE', 'IT', 'DE', 'ES', 'IN', 'MX', 'AU'] };
const asin = { type: 'string', description: '10 位 ASIN，或受支持 Amazon 站点的 /dp/ASIN 商品链接' };
const keyword = { type: 'string', minLength: 1 };
const positive = { type: 'integer', minimum: 1 };
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({
  type: 'function', name, description, inputSchema: { type: 'object', additionalProperties: false, properties, required }
});

export const amazonDynamicTools = [{
  type: 'namespace', name: 'amazon', description: 'Amazon 公开页面实时取证。页面验证、抓取失败或站点不支持时返回失败，不得推测商品属性。内部经营数据另用 CrossBorderOps。',
  tools: [
    tool('search_products', '按关键词查询 Amazon 搜索页；返回商品候选、图片链接、自然位与广告标记。', { keywords: { type: 'array', items: keyword, minItems: 1, maxItems: 5 }, marketplace, maxPages: positive, maxResults: positive, organicOnly: { type: 'boolean' } }, ['keywords', 'marketplace']),
    tool('image_search', '用当前任务已上传的图片在 Amazon StyleSnap 搜相似商品。只支持 US/DE/IT/ES/JP；传附件 ID，不传本地路径或任意 URL。', { inputAttachmentIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 }, marketplace, maxResults: positive }, ['inputAttachmentIds', 'marketplace']),
    tool('get_product_detail', '按 ASIN 或 Amazon /dp/ 链接读取商品详情，包含可验证的主图 images、标题、品牌、卖点。生成真实商品场景图前优先调用。', { asin, marketplace }, ['asin', 'marketplace']),
    tool('get_related_products', '读取商品详情页的关联商品模块。', { asin, marketplace }, ['asin', 'marketplace']),
    tool('get_promotions', '读取商品详情页的 Deal、Coupon 和促销文案。', { asin, marketplace }, ['asin', 'marketplace']),
    tool('get_reviews', '采样近期商品评论；采样不可推断全量评论分布。', { asin, marketplace, maxPages: positive, minRating: { type: 'number', minimum: 1, maximum: 5 }, maxRating: { type: 'number', minimum: 1, maximum: 5 } }, ['asin', 'marketplace']),
    tool('get_keyword_rank', '查询一个 ASIN 对一个关键词的自然位或 SP 广告位；配送邮编验证失败时返回不可用。', { asin, keyword, marketplace, rankType: { type: 'string', enum: ['organic', 'sp'] }, maxPages: positive }, ['asin', 'keyword', 'marketplace'])
  ]
}];

export const AMAZON_OPERATIONS = new Set((amazonDynamicTools[0]?.tools ?? []).map((item) => item.name));
const HOSTS: Record<string, string> = {
  US: 'amazon.com', CA: 'amazon.ca', JP: 'amazon.co.jp', UK: 'amazon.co.uk', FR: 'amazon.fr',
  BE: 'amazon.com.be', IT: 'amazon.it', DE: 'amazon.de', ES: 'amazon.es', IN: 'amazon.in',
  MX: 'amazon.com.mx', AU: 'amazon.com.au'
};
const STYLE_SNAP = new Set(['US', 'DE', 'IT', 'ES', 'JP']);

export interface AmazonToolSettings { python?: string; cwd?: string; timeoutMs?: number }

export class AmazonTool {
  public constructor(private readonly settings: AmazonToolSettings = {}) {}

  public async execute(operation: string, raw: unknown, attachments: Attachment[] = []): Promise<unknown> {
    if (!AMAZON_OPERATIONS.has(operation)) throw new Error('AMAZON_OPERATION_UNREGISTERED');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('AMAZON_ARGUMENTS_INVALID');
    const input = raw as Record<string, unknown>;
    const market = String(input.marketplace ?? '').toUpperCase();
    if (!HOSTS[market]) throw new Error('AMAZON_MARKETPLACE_UNSUPPORTED');
    const args: string[] = [];
    if (operation === 'search_products') {
      const keywords = input.keywords;
      if (!Array.isArray(keywords) || !keywords.length || keywords.length > 5 || keywords.some((k) => typeof k !== 'string' || !k.trim() || k.length > 200)) throw new Error('AMAZON_KEYWORDS_INVALID');
      args.push('search', ...keywords.flatMap((k: string) => ['--keyword', k]), '--marketplace', market);
      optionalInt(args, input.maxPages, '--max-pages', 1, 10);
      optionalInt(args, input.maxResults, '--max-results', 1, 100);
      if (input.organicOnly === true) args.push('--organic-only');
    } else if (operation === 'image_search') {
      if (!STYLE_SNAP.has(market)) throw new Error('AMAZON_STYLESNAP_MARKETPLACE_UNSUPPORTED');
      const ids = input.inputAttachmentIds;
      if (!Array.isArray(ids) || !ids.length || ids.length > 3 || ids.some((id) => typeof id !== 'string')) throw new Error('AMAZON_IMAGE_ATTACHMENTS_INVALID');
      const selected = ids.map((id: string) => attachments.find((item) => item.id === id));
      if (selected.some((item) => !item?.localPath || !(item.contentType?.startsWith('image/') || item.sourceType === 'image'))) throw new Error('AMAZON_IMAGE_ATTACHMENT_UNAVAILABLE');
      args.push('image-search', ...selected.flatMap((item) => ['--image', item!.localPath!]), '--marketplace', market);
      optionalInt(args, input.maxResults, '--max-results', 1, 100);
    } else {
      const productAsin = parseAsin(input.asin, market);
      if (operation === 'get_product_detail') args.push('detail');
      else if (operation === 'get_related_products') args.push('related');
      else if (operation === 'get_promotions') args.push('promotions');
      else if (operation === 'get_reviews') args.push('reviews');
      else args.push('rank');
      args.push('--asin', productAsin, '--marketplace', market);
      if (operation === 'get_reviews') {
        optionalInt(args, input.maxPages, '--max-pages', 1, 10);
        optionalRating(args, input.minRating, '--min-rating');
        optionalRating(args, input.maxRating, '--max-rating');
        if (typeof input.minRating === 'number' && typeof input.maxRating === 'number' && input.minRating > input.maxRating) throw new Error('AMAZON_RATING_RANGE_INVALID');
      }
      if (operation === 'get_keyword_rank') {
        if (typeof input.keyword !== 'string' || !input.keyword.trim() || input.keyword.length > 200) throw new Error('AMAZON_KEYWORD_INVALID');
        if (input.rankType !== undefined && input.rankType !== 'organic' && input.rankType !== 'sp') throw new Error('AMAZON_RANK_TYPE_INVALID');
        args.push('--keyword', input.keyword, '--type', String(input.rankType ?? 'organic'));
        optionalInt(args, input.maxPages, '--max-pages', 1, 20);
      }
    }
    const python = this.settings.python ?? process.env.AMAZON_SKILL_PYTHON ?? '/opt/amazon-venv/bin/python';
    const cwd = resolve(this.settings.cwd ?? process.env.AMAZON_SKILL_DIR ?? '/opt/amazon-skill');
    try {
      const result = await execFileAsync(python, ['-m', 'amazon_skill.cli', ...args], {
        cwd, timeout: this.settings.timeoutMs ?? 120_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' }
      });
      return JSON.parse(result.stdout);
    } catch (error) {
      const detail = error as Error & { stdout?: string };
      try {
        const parsed = JSON.parse(detail.stdout ?? '') as { error_type?: string; error?: string };
        throw new Error(`AMAZON_${String(parsed.error_type ?? 'TOOL_FAILED').toUpperCase()}: ${String(parsed.error ?? 'tool failed').slice(0, 300)}`);
      } catch (parsedError) {
        if (parsedError instanceof Error && parsedError.message.startsWith('AMAZON_')) throw parsedError;
        throw new Error(`AMAZON_TOOL_FAILED: ${detail.message.slice(0, 300)}`);
      }
    }
  }

  public async attachMainImage(result: unknown, taskId: string, mediaDir: string, maxBytes: number, scan?: (buffer: Buffer) => Promise<void>): Promise<Attachment | undefined> {
    const data = result && typeof result === 'object' ? (result as { data?: { images?: unknown } }).data : undefined;
    const images = data?.images;
    if (!Array.isArray(images) || !images.length || typeof images[0] !== 'string') return undefined;
    let url: URL;
    try { url = new URL(images[0]); } catch { throw new Error('AMAZON_MAIN_IMAGE_URL_INVALID'); }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !(host === 'm.media-amazon.com' || host === 'images-na.ssl-images-amazon.com' || host.endsWith('.media-amazon.com'))) {
      throw new Error('AMAZON_MAIN_IMAGE_HOST_INVALID');
    }
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`AMAZON_MAIN_IMAGE_HTTP_${response.status}`);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new Error('AMAZON_MAIN_IMAGE_TOO_LARGE');
    const chunks: Buffer[] = [];
    let size = 0;
    if (!response.body) throw new Error('AMAZON_MAIN_IMAGE_EMPTY');
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const part = Buffer.from(value);
        size += part.length;
        if (size > maxBytes) throw new Error('AMAZON_MAIN_IMAGE_TOO_LARGE');
        chunks.push(part);
      }
    } finally { reader.releaseLock(); }
    const buffer = Buffer.concat(chunks);
    const detected = await fileTypeFromBuffer(buffer);
    if (!detected || !['image/jpeg', 'image/png', 'image/webp'].includes(detected.mime)) throw new Error('AMAZON_MAIN_IMAGE_TYPE_INVALID');
    await scan?.(buffer);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const dir = join(resolve(mediaDir), 'amazon-images', safeTaskId(taskId));
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const name = `amazon-main-${sha256.slice(0, 12)}.${detected.ext}`;
    const localPath = join(dir, name);
    await writeFile(localPath, buffer, { flag: 'wx', mode: 0o600 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    return { id: `amazon-main-${sha256.slice(0, 16)}`, name, sourceType: 'image', contentType: detected.mime, size, localPath, sha256 };
  }
}

function safeTaskId(value: string): string {
  if (!/^[a-z0-9-]{1,80}$/i.test(value)) throw new Error('AMAZON_TASK_ID_INVALID');
  return value;
}

function parseAsin(raw: unknown, market: string): string {
  if (typeof raw !== 'string') throw new Error('AMAZON_ASIN_INVALID');
  const value = raw.trim();
  if (/^[A-Za-z0-9]{10}$/.test(value)) return value.toUpperCase();
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('AMAZON_ASIN_INVALID'); }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (url.protocol !== 'https:' || host !== HOSTS[market]) throw new Error('AMAZON_PRODUCT_URL_MARKETPLACE_MISMATCH');
  const match = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Za-z0-9]{10})(?:\/|$)/i);
  if (!match) throw new Error('AMAZON_PRODUCT_URL_INVALID');
  return match[1]!.toUpperCase();
}

function optionalInt(args: string[], raw: unknown, flag: string, min: number, max: number): void {
  if (raw === undefined) return;
  if (!Number.isInteger(raw) || Number(raw) < min || Number(raw) > max) throw new Error(`AMAZON_OPTION_INVALID:${flag}`);
  args.push(flag, String(raw));
}

function optionalRating(args: string[], raw: unknown, flag: string): void {
  if (raw === undefined) return;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1 || raw > 5) throw new Error(`AMAZON_OPTION_INVALID:${flag}`);
  args.push(flag, String(raw));
}
