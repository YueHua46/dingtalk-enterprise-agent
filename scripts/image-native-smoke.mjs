import { readFile } from 'node:fs/promises';
import { ImageTool } from '../dist/image-tool.js';

// Local smoke runs are convenient from the repository checkout; production
// containers already receive the same variables through Compose env_file.
try {
  const envText = await readFile('.env', 'utf8');
  for (const raw of envText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index);
    const value = line.slice(index + 1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
} catch { /* Container environments do not need a local .env file. */ }

const tool = new ImageTool({
  MODEL_API_KEY: process.env.MODEL_API_KEY,
  IMAGE_BASE_URL: process.env.IMAGE_BASE_URL,
  IMAGE_API_KEY: process.env.IMAGE_API_KEY,
  IMAGE_MODEL: process.env.IMAGE_MODEL || 'gemini-3.1-flash-image',
  IMAGE_PROVIDER: process.env.IMAGE_PROVIDER || 'gemini',
  IMAGE_PROVIDERS_JSON: process.env.IMAGE_PROVIDERS_JSON || '',
  IMAGE_TIMEOUT_MS: Number(process.env.IMAGE_TIMEOUT_MS || 180000),
  MEDIA_DIR: process.env.MEDIA_DIR || './tmp/image-native-smoke',
  MEDIA_MAX_BYTES: Number(process.env.MEDIA_MAX_BYTES || 52428800)
});

try {
  const result = await tool.generate({
    operation: 'generate',
    prompt: 'Create a simple 256x256 blue circle on a white background.',
    aspectRatio: '1:1',
    imageSize: '1K'
  }, [], 'image-native-smoke');
  console.log(JSON.stringify({
    ok: true,
    provider: result.provider,
    model: result.model,
    images: result.images.map(({ name, size, sha256, mimeType }) => ({ name, size, sha256, mimeType }))
  }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 2;
}
