/** Read a request body without decoding individual transport chunks.
 * UTF-8 characters can be split at any byte boundary by HTTP/TCP. Converting
 * each chunk with String(chunk) can therefore insert U+FFFD and change the
 * evidence hash before JSON parsing sees it.
 */
export async function readUtf8Body(source: AsyncIterable<Uint8Array | string>, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of source) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > maxBytes) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total).toString('utf8');
}
