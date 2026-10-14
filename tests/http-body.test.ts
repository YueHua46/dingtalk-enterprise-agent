import {describe, expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import {readUtf8Body} from '../src/http-body.js';

async function* splitBytes(value: string): AsyncIterable<Buffer> {
  const bytes = Buffer.from(value, 'utf8');
  for (let i = 0; i < bytes.length; i++) yield bytes.subarray(i, i + 1);
}

describe('UTF-8 request body transport', () => {
  it('decodes a multibyte body only after all chunks arrive', async () => {
    const source = JSON.stringify({keyword: 'ワイヤレス防犯カメラ モニター付���', note: '德国安防套装 🇩🇪'});
    const decoded = await readUtf8Body(splitBytes(source), Buffer.byteLength(source));
    expect(decoded).toBe(source);
    expect(createHash('sha256').update(decoded).digest('hex')).toBe(createHash('sha256').update(source).digest('hex'));
  });

  it('enforces the limit in bytes, including multibyte text', async () => {
    const source = '日本';
    await expect(readUtf8Body(splitBytes(source), Buffer.byteLength(source) - 1)).rejects.toThrow('REQUEST_TOO_LARGE');
  });
});
