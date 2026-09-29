import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { inspectPng } from '../src/png-validation.js';

describe('PNG screenshot validation', () => {
  it('rejects a fully white RGBA screenshot as blank', () => {
    const inspection = inspectPng(makePng([255, 255, 255, 255]));
    expect(inspection.visiblePixels).toBe(1);
    expect(inspection.nonWhitePixels).toBe(0);
    expect(inspection.blank).toBe(true);
  });

  it('accepts a visible non-white screenshot', () => {
    const inspection = inspectPng(makePng([0, 0, 0, 255]));
    expect(inspection.nonWhitePixels).toBe(1);
    expect(inspection.blank).toBe(false);
  });
});

function makePng(rgba: number[]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const scanline = Buffer.from([0, ...rgba]);
  return Buffer.concat([signature(), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(scanline)), chunk('IEND', Buffer.alloc(0))]);
}

function signature(): Buffer { return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); }

function chunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBytes, data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
