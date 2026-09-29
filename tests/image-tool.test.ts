import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImageTool } from '../src/image-tool.js';

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

afterEach(() => vi.unstubAllGlobals());

describe('Gemini native image tool', () => {
  it('calls the native generateContent route and stages returned inline image data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'image-tool-'));
    try {
      const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
        expect(url).toBe('https://image.example/antigravity/v1beta/models/gemini-3.1-flash-image:generateContent');
        const body = JSON.parse(String(options.body));
        expect(body.contents[0].parts).toEqual([{ text: 'draw a blue circle' }]);
        expect(body.generationConfig.responseModalities).toEqual(['TEXT', 'IMAGE']);
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: pngBase64 } }] } }] }), { status: 200 });
      });
      const tool = new ImageTool({
        MODEL_API_KEY: 'model-key', IMAGE_BASE_URL: 'https://image.example/antigravity', IMAGE_API_KEY: 'image-key',
        IMAGE_MODEL: 'gemini-3.1-flash-image', IMAGE_PROVIDER: 'gemini', IMAGE_PROVIDERS_JSON: '', IMAGE_TIMEOUT_MS: 1000,
        MEDIA_DIR: root, MEDIA_MAX_BYTES: 1024 * 1024
      }, undefined, fetchMock as typeof fetch);
      const result = await tool.generate({ operation: 'generate', prompt: 'draw a blue circle' }, [], 'task-1');
      expect(result.images).toHaveLength(1);
      expect(result.images[0]).toMatchObject({ provider: 'gemini', model: 'gemini-3.1-flash-image', mimeType: 'image/png' });
      expect((await readFile(result.images[0]!.path)).toString('base64')).toBe(pngBase64);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses current task image attachments for edit requests and supports registry aliases', async () => {
    const root = await mkdtemp(join(tmpdir(), 'image-tool-edit-'));
    try {
      const inputPath = join(root, 'input.png');
      await writeFile(inputPath, Buffer.from(pngBase64, 'base64'));
      const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
        const body = JSON.parse(String(options.body));
        expect(body.contents[0].parts[0].inlineData.data).toBe(pngBase64);
        expect(body.contents[0].parts.at(-1).text).toBe('make it monochrome');
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/png', data: pngBase64 } }] } }] }), { status: 200 });
      });
      const tool = new ImageTool({
        MODEL_API_KEY: 'model-key', IMAGE_BASE_URL: 'https://image.example/unused', IMAGE_API_KEY: 'image-key',
        IMAGE_MODEL: 'fallback-model', IMAGE_PROVIDER: 'fallback', IMAGE_PROVIDERS_JSON: JSON.stringify({ providers: {
          gemini: { driver: 'gemini-native', baseUrl: 'https://image.example/antigravity', apiKeyEnv: 'TEST_IMAGE_KEY', model: 'gemini-3.1-flash-image' }
        } }), IMAGE_TIMEOUT_MS: 1000, MEDIA_DIR: root, MEDIA_MAX_BYTES: 1024 * 1024
      }, undefined, fetchMock as typeof fetch);
      process.env.TEST_IMAGE_KEY = 'registry-key';
      const result = await tool.generate({ operation: 'edit', prompt: 'make it monochrome', provider: 'gemini', inputAttachmentIds: ['attachment-1'] }, [{
        id: 'attachment-1', name: 'input.png', sourceType: 'image', contentType: 'image/png', localPath: inputPath
      }], 'task-2');
      expect(result.provider).toBe('gemini');
      expect(result.images[0]?.mimeType).toBe('image/png');
      delete process.env.TEST_IMAGE_KEY;
    } finally {
      await rm(root, { recursive: true, force: true });
      delete process.env.TEST_IMAGE_KEY;
    }
  });

  it('fails closed when the upstream returns no image', async () => {
    const tool = new ImageTool({
      MODEL_API_KEY: 'model-key', IMAGE_BASE_URL: 'https://image.example/antigravity', IMAGE_API_KEY: 'image-key',
      IMAGE_MODEL: 'gemini-3.1-flash-image', IMAGE_PROVIDER: 'gemini', IMAGE_PROVIDERS_JSON: '', IMAGE_TIMEOUT_MS: 1000,
      MEDIA_DIR: await mkdtemp(join(tmpdir(), 'image-tool-empty-')), MEDIA_MAX_BYTES: 1024 * 1024
    }, undefined, vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'no image' }] } }] }), { status: 200 })) as typeof fetch);
    await expect(tool.generate({ operation: 'generate', prompt: 'x' }, [], 'task-3')).rejects.toThrow('IMAGE_UPSTREAM_NO_IMAGE');
  });
});
