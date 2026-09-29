import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import type { Config } from './config.js';
import type { Attachment } from './types.js';

export const imageDynamicTools = [{
  type: 'namespace',
  name: 'image',
  description: '使用已配置的原生图像模型生成或编辑图片，并将结果直接发送到当前钉钉会话。',
  tools: [{
    type: 'function',
    name: 'generate',
    description: [
      '生成或编辑图片。operation=generate 用文字生成；operation=edit 用当前任务中的图片附件加文字指令进行改图。',
      '改图时优先传 inputAttachmentIds；不传时宿主会使用当前任务中的全部图片附件。',
      '结果由宿主直接投递到当前钉钉会话，不要把本地路径展示给用户。',
      'provider 可选，必须是已配置的渠道别名；不传时使用默认生图渠道。'
    ].join('\n'),
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        operation: { type: 'string', enum: ['generate', 'edit'] },
        prompt: { type: 'string', minLength: 1, maxLength: 8_000 },
        inputAttachmentIds: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', minLength: 1, maxLength: 200 } },
        provider: { type: 'string', pattern: '^[a-zA-Z0-9._-]{1,64}$' },
        aspectRatio: { type: 'string', pattern: '^\\d+:\\d+$' },
        imageSize: { type: 'string', enum: ['1K', '2K', '4K'] }
      },
      required: ['operation', 'prompt']
    }
  }]
}];

type ImageOperation = 'generate' | 'edit';

interface ImageProviderDefinition {
  id: string;
  driver: string;
  baseUrl: string | undefined;
  apiKey: string | undefined;
  model: string;
  timeoutMs: number;
}

export interface GeneratedImageAsset {
  name: string;
  path: string;
  size: number;
  sha256: string;
  mimeType: string;
  provider: string;
  model: string;
  operation: ImageOperation;
}

export interface ImageToolResult {
  provider: string;
  model: string;
  operation: ImageOperation;
  images: GeneratedImageAsset[];
}

interface ImageToolInput {
  operation?: unknown;
  prompt?: unknown;
  inputAttachmentIds?: unknown;
  provider?: unknown;
  aspectRatio?: unknown;
  imageSize?: unknown;
}

interface ParsedImageToolInput {
  operation: ImageOperation;
  prompt: string;
  inputAttachmentIds?: string[];
  provider?: string;
  aspectRatio?: string;
  imageSize?: string;
}

interface ImageToolConfig extends Pick<Config, 'MODEL_API_KEY' | 'IMAGE_BASE_URL' | 'IMAGE_API_KEY' | 'IMAGE_MODEL' | 'IMAGE_PROVIDER' | 'IMAGE_PROVIDERS_JSON' | 'IMAGE_TIMEOUT_MS' | 'MEDIA_DIR' | 'MEDIA_MAX_BYTES'> {}

export class ImageTool {
  public constructor(
    private readonly config: ImageToolConfig,
    private readonly scan?: (buffer: Buffer) => Promise<void>,
    private readonly http: typeof fetch = fetch
  ) {}

  public async generate(input: unknown, attachments: Attachment[], taskId: string): Promise<ImageToolResult> {
    const value = parseInput(input);
    const providers = this.providers();
    const providerId = typeof value.provider === 'string' ? value.provider : this.config.IMAGE_PROVIDER;
    const provider = providers.get(providerId);
    if (!provider) throw new Error('IMAGE_PROVIDER_NOT_FOUND');
    if (provider.driver !== 'gemini-native') throw new Error('IMAGE_PROVIDER_UNSUPPORTED:' + provider.driver);
    if (!provider.baseUrl || !provider.apiKey) throw new Error('IMAGE_PROVIDER_NOT_CONFIGURED:' + provider.id);

    const selected = selectAttachments(value, attachments);
    if (value.operation === 'edit' && selected.length === 0) throw new Error('IMAGE_EDIT_ATTACHMENT_REQUIRED');
    const parts: Array<Record<string, unknown>> = [];
    for (const attachment of selected) {
      if (!attachment.localPath) throw new Error('IMAGE_ATTACHMENT_UNAVAILABLE:' + attachment.id);
      const buffer = await readFile(attachment.localPath);
      if (buffer.length <= 0 || buffer.length > this.config.MEDIA_MAX_BYTES) throw new Error('IMAGE_ATTACHMENT_SIZE_INVALID');
      const detected = await fileTypeFromBuffer(buffer);
      const mimeType = detected?.mime ?? attachment.contentType;
      if (!mimeType?.startsWith('image/')) throw new Error('IMAGE_ATTACHMENT_NOT_IMAGE:' + attachment.name);
      parts.push({ inlineData: { mimeType, data: buffer.toString('base64') } });
    }
    parts.push({ text: value.prompt });

    const generationConfig: Record<string, unknown> = { responseModalities: ['TEXT', 'IMAGE'] };
    const imageConfig: Record<string, string> = {};
    if (value.aspectRatio) imageConfig.aspectRatio = value.aspectRatio;
    if (value.imageSize) imageConfig.imageSize = value.imageSize;
    if (Object.keys(imageConfig).length) generationConfig.imageConfig = imageConfig;

    const endpoint = buildGenerateContentEndpoint(provider.baseUrl, provider.model);
    const response = await this.http(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${provider.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
      signal: AbortSignal.timeout(provider.timeoutMs)
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`IMAGE_UPSTREAM_HTTP_${response.status}: ${providerError(raw)}`);
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { throw new Error('IMAGE_UPSTREAM_INVALID_JSON'); }
    const images = extractImages(payload);
    if (!images.length) throw new Error('IMAGE_UPSTREAM_NO_IMAGE');

    const outputDir = resolve(this.config.MEDIA_DIR, 'generated-images', safeSegment(taskId));
    await mkdir(outputDir, { recursive: true, mode: 0o700 });
    const assets: GeneratedImageAsset[] = [];
    for (const image of images.slice(0, 4)) {
      const detected = await fileTypeFromBuffer(image.buffer);
      const mimeType = detected?.mime ?? image.mimeType;
      const extension = detected?.ext ?? extensionForMime(mimeType);
      if (!mimeType?.startsWith('image/') || !extension) throw new Error('IMAGE_OUTPUT_TYPE_INVALID');
      if (image.buffer.length <= 0 || image.buffer.length > this.config.MEDIA_MAX_BYTES) throw new Error('IMAGE_OUTPUT_SIZE_INVALID');
      await this.scan?.(image.buffer);
      const sha256 = createHash('sha256').update(image.buffer).digest('hex');
      const name = `generated-${sha256.slice(0, 12)}.${extension}`;
      const path = join(outputDir, name);
      await writeFile(path, image.buffer, { flag: 'wx', mode: 0o600 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
      assets.push({ name, path, size: image.buffer.length, sha256, mimeType, provider: provider.id, model: provider.model, operation: value.operation });
    }
    return { provider: provider.id, model: provider.model, operation: value.operation, images: assets };
  }

  public configured(): boolean {
    return [...this.providers().values()].some((provider) => Boolean(provider.baseUrl && provider.apiKey));
  }

  private providers(): Map<string, ImageProviderDefinition> {
    const output = new Map<string, ImageProviderDefinition>();
    const fallback: ImageProviderDefinition = {
      id: this.config.IMAGE_PROVIDER,
      driver: 'gemini-native',
      baseUrl: this.config.IMAGE_BASE_URL,
      // Allow a single secret during migration, while supporting an
      // independent IMAGE_API_KEY when multiple providers are configured.
      apiKey: this.config.IMAGE_API_KEY ?? this.config.MODEL_API_KEY,
      model: this.config.IMAGE_MODEL,
      timeoutMs: this.config.IMAGE_TIMEOUT_MS
    };
    output.set(fallback.id, fallback);
    const raw = this.config.IMAGE_PROVIDERS_JSON.trim();
    if (!raw) return output;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error('IMAGE_PROVIDERS_JSON_INVALID'); }
    const entries = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'providers' in parsed
      ? (parsed as { providers?: unknown }).providers : parsed;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('IMAGE_PROVIDERS_JSON_INVALID');
    for (const [id, item] of Object.entries(entries)) {
      if (!/^[a-zA-Z0-9._-]{1,64}$/.test(id) || !item || typeof item !== 'object' || Array.isArray(item)) throw new Error('IMAGE_PROVIDER_DEFINITION_INVALID');
      const value = item as Record<string, unknown>;
      const driver = typeof value.driver === 'string' ? value.driver : 'gemini-native';
      const baseUrl = resolveConfigValue(value.baseUrl, value.baseUrlEnv, value.baseUrlEnv === 'IMAGE_BASE_URL' ? this.config.IMAGE_BASE_URL : undefined);
      const apiKey = resolveConfigValue(value.apiKey, value.apiKeyEnv, value.apiKeyEnv === 'IMAGE_API_KEY' ? (this.config.IMAGE_API_KEY ?? this.config.MODEL_API_KEY) : undefined);
      const model = resolveConfigValue(value.model, value.modelEnv, value.modelEnv === 'IMAGE_MODEL' ? this.config.IMAGE_MODEL : undefined) ?? this.config.IMAGE_MODEL;
      const timeoutMs = typeof value.timeoutMs === 'number' && Number.isInteger(value.timeoutMs) && value.timeoutMs > 0 ? value.timeoutMs : this.config.IMAGE_TIMEOUT_MS;
      output.set(id, { id, driver, baseUrl, apiKey, model, timeoutMs });
    }
    return output;
  }
}

function parseInput(input: unknown): ParsedImageToolInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('IMAGE_INPUT_INVALID');
  const value = input as ImageToolInput;
  if (value.operation !== 'generate' && value.operation !== 'edit') throw new Error('IMAGE_OPERATION_INVALID');
  if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 8_000) throw new Error('IMAGE_PROMPT_INVALID');
  if (value.provider !== undefined && (typeof value.provider !== 'string' || !/^[a-zA-Z0-9._-]{1,64}$/.test(value.provider))) throw new Error('IMAGE_PROVIDER_INVALID');
  if (value.aspectRatio !== undefined && (typeof value.aspectRatio !== 'string' || !/^\d+:\d+$/.test(value.aspectRatio))) throw new Error('IMAGE_ASPECT_RATIO_INVALID');
  if (value.imageSize !== undefined && !['1K', '2K', '4K'].includes(String(value.imageSize))) throw new Error('IMAGE_SIZE_INVALID');
  if (value.inputAttachmentIds !== undefined && (!Array.isArray(value.inputAttachmentIds) || value.inputAttachmentIds.length > 4 || value.inputAttachmentIds.some((item) => typeof item !== 'string' || !item.trim()))) throw new Error('IMAGE_ATTACHMENT_IDS_INVALID');
  return {
    operation: value.operation,
    prompt: value.prompt.trim(),
    ...(Array.isArray(value.inputAttachmentIds) ? { inputAttachmentIds: value.inputAttachmentIds as string[] } : {}),
    ...(typeof value.provider === 'string' ? { provider: value.provider } : {}),
    ...(typeof value.aspectRatio === 'string' ? { aspectRatio: value.aspectRatio } : {}),
    ...(typeof value.imageSize === 'string' ? { imageSize: value.imageSize } : {})
  };
}

function selectAttachments(input: ImageToolInput, attachments: Attachment[]): Attachment[] {
  const imageAttachments = attachments.filter((item) => item.localPath && (item.sourceType === 'image' || item.contentType?.startsWith('image/')));
  const ids = Array.isArray(input.inputAttachmentIds) ? input.inputAttachmentIds as string[] : [];
  if (!ids.length) return input.operation === 'edit' ? imageAttachments : [];
  const byId = new Map(attachments.map((item) => [item.id, item]));
  const selected = ids.map((id) => byId.get(id));
  if (selected.some((item) => !item)) throw new Error('IMAGE_ATTACHMENT_ID_NOT_FOUND');
  if (selected.some((item) => !item!.localPath || (item!.sourceType !== 'image' && !item!.contentType?.startsWith('image/')))) throw new Error('IMAGE_ATTACHMENT_NOT_IMAGE');
  return selected as Attachment[];
}

function buildGenerateContentEndpoint(baseUrl: string, model: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const prefix = base.endsWith('/v1beta') ? base : base + '/v1beta';
  return `${prefix}/models/${encodeURIComponent(model)}:generateContent`;
}

function extractImages(payload: unknown): Array<{ buffer: Buffer; mimeType: string | undefined }> {
  const found: Array<{ buffer: Buffer; mimeType: string | undefined }> = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    const inline = record.inlineData ?? record.inline_data;
    if (inline && typeof inline === 'object' && !Array.isArray(inline)) {
      const item = inline as Record<string, unknown>;
      add(item.data, item.mimeType ?? item.mime_type);
    }
    const type = typeof record.type === 'string' ? record.type : '';
    if (type === 'image' || type === 'output_image' || type === 'image_generation_call') {
      for (const key of ['data', 'base64', 'b64_json', 'result', 'image']) add(record[key], record.mimeType ?? record.mime_type);
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === 'inlineData' || key === 'inline_data' || key === 'data' || key === 'text') continue;
      visit(child);
    }
  };
  const add = (raw: unknown, mime: unknown): void => {
    if (typeof raw !== 'string' || raw.length < 32) return;
    const match = raw.match(/^data:([^;]+);base64,(.*)$/s);
    const mimeType = typeof mime === 'string' && mime.startsWith('image/') ? mime : match?.[1];
    const encoded = (match?.[2] ?? raw).replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1) return;
    const buffer = Buffer.from(encoded, 'base64');
    if (buffer.length >= 16) found.push({ buffer, mimeType });
  };
  visit(payload);
  const unique = new Map<string, { buffer: Buffer; mimeType: string | undefined }>();
  for (const item of found) unique.set(createHash('sha256').update(item.buffer).digest('hex'), item);
  return [...unique.values()];
}

function providerError(raw: string): string {
  try {
    const value = JSON.parse(raw) as { error?: { message?: unknown; status?: unknown; code?: unknown } };
    const error = value?.error;
    if (error) return [error.message, error.status, error.code].filter((item) => item !== undefined).map(String).join(' ').slice(0, 400);
  } catch { /* keep bounded plain text */ }
  return raw.replace(/\s+/g, ' ').slice(0, 400) || 'unknown upstream error';
}

function resolveConfigValue(value: unknown, envName: unknown, fallback: string | undefined): string | undefined {
  if (typeof envName === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(envName) && process.env[envName]) return process.env[envName];
  if (typeof value === 'string' && value.trim()) return value.trim();
  return fallback;
}

function extensionForMime(mimeType: string | undefined): string | undefined {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  return undefined;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'task';
}
