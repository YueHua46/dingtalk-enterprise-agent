import { inflateSync } from 'node:zlib';

export interface PngInspection {
  width: number;
  height: number;
  nonWhitePixels: number;
  visiblePixels: number;
  blank: boolean;
}

/**
 * Inspect an 8-bit PNG without depending on a native image library.  The
 * screenshots produced by ZClaw are RGB/RGBA PNGs; grayscale and indexed
 * images are handled as well so a blank result cannot be delivered as success.
 */
export function inspectPng(buffer: Uint8Array): PngInspection {
  if (buffer.length < 33 || !isPng(buffer)) throw new Error('ZINIAO_SCREENSHOT_INVALID_PNG');
  const bytes = Buffer.from(buffer);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  let palette: Buffer | undefined;
  let transparency: Buffer | undefined;
  while (offset + 12 <= buffer.length) {
    const length = bytes.readUInt32BE(offset);
    const type = Buffer.from(buffer.subarray(offset + 4, offset + 8)).toString('ascii');
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > buffer.length) throw new Error('ZINIAO_SCREENSHOT_INVALID_PNG');
    const data = Buffer.from(buffer.subarray(start, end));
    if (type === 'IHDR' && data.length >= 13) {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw new Error('ZINIAO_SCREENSHOT_UNSUPPORTED_PNG');
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset = end + 4;
  }
  if (!width || !height || bitDepth !== 8 || !idat.length) throw new Error('ZINIAO_SCREENSHOT_INVALID_PNG');
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (!channels) throw new Error('ZINIAO_SCREENSHOT_UNSUPPORTED_PNG');
  const rowBytes = width * channels;
  const decoded = inflateSync(Buffer.concat(idat));
  const expected = height * (rowBytes + 1);
  if (decoded.length < expected) throw new Error('ZINIAO_SCREENSHOT_INVALID_PNG');
  let previous = Buffer.alloc(rowBytes);
  let visiblePixels = 0;
  let nonWhitePixels = 0;
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = decoded[cursor++]!;
    const row = Buffer.from(decoded.subarray(cursor, cursor + rowBytes));
    cursor += rowBytes;
    unfilter(row, previous, filter, channels);
    for (let x = 0; x < width; x += 1) {
      const i = x * channels;
      let alpha = 255;
      let r = row[i]!, g = r, b = r;
      if (colorType === 2) { g = row[i + 1]!; b = row[i + 2]!; }
      else if (colorType === 3) {
        const paletteIndex = row[i]!;
        const paletteOffset = paletteIndex * 3;
        if (!palette || paletteOffset + 2 >= palette.length) throw new Error('ZINIAO_SCREENSHOT_INVALID_PNG');
        r = palette[paletteOffset]!; g = palette[paletteOffset + 1]!; b = palette[paletteOffset + 2]!;
        alpha = transparency?.[paletteIndex] ?? 255;
      } else if (colorType === 4) alpha = row[i + 1]!;
      else if (colorType === 6) { g = row[i + 1]!; b = row[i + 2]!; alpha = row[i + 3]!; }
      if (alpha > 0) {
        visiblePixels += 1;
        if (!(r >= 250 && g >= 250 && b >= 250)) nonWhitePixels += 1;
      }
    }
    previous = row;
  }
  return { width, height, nonWhitePixels, visiblePixels,
    blank: visiblePixels === 0 || nonWhitePixels / Math.max(1, visiblePixels) < 0.001 };
}

export function isPng(buffer: Uint8Array): boolean {
  return buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
    && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a;
}

function unfilter(row: Buffer, previous: Buffer, filter: number, bytesPerPixel: number): void {
  if (filter === 0) return;
  for (let i = 0; i < row.length; i += 1) {
    const left = i >= bytesPerPixel ? row[i - bytesPerPixel]! : 0;
    const up = previous[i] ?? 0;
    const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel]! : 0;
    if (filter === 1) row[i] = (row[i]! + left) & 0xff;
    else if (filter === 2) row[i] = (row[i]! + up) & 0xff;
    else if (filter === 3) row[i] = (row[i]! + Math.floor((left + up) / 2)) & 0xff;
    else if (filter === 4) row[i] = (row[i]! + paeth(left, up, upLeft)) & 0xff;
    else throw new Error('ZINIAO_SCREENSHOT_UNSUPPORTED_PNG');
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
