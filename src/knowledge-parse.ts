import { createHash } from 'node:crypto';

export interface KnowledgePosition { block?: string; sheet?: string; range?: string; page?: number; image?: string; region?: number[]; mergedRanges?: string[] }
export interface KnowledgeChunk { text: string; position: KnowledgePosition; method: string }
export interface KnowledgeFact { model: string; attribute: string; value: string; position: KnowledgePosition; scope: string }
export interface KnowledgeContent { chunks: KnowledgeChunk[]; facts: KnowledgeFact[]; quality: string[]; assets?: Array<{dataUrl:string;position:KnowledgePosition}> }
export const knowledgeParserVersion = 'knowledge-v6';
export const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function sanitizeKnowledge(text: string): string {
  return text.replace(/\b(?:sk-|ghp_|xox[baprs]-)[A-Za-z0-9_-]{8,}/g, '[凭据已过滤]')
    .replace(/(rtmps?:\/\/[^/\s]+\/[^/\s]+\/)[^\s`"<>]+/gi, '$1[推流凭据已过滤]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, '[凭据已过滤]')
    .replace(/((?:access[ _-]?token|refresh[ _-]?token|app[ _-]?secret|client[ _-]?secret|api[ _-]?key|password|passwd|密码|口令|密钥|验证码)\s*[:：=]\s*)[^\s,，;；<]+/gi, '$1[凭据已过滤]');
}
export function credentialVault(path: string): boolean {
  return /(?:^|\/)(?:账号和密码|API\s*KEY|API管理|[^/]*密码更新|密钥管理)(?:\/|$)/i.test(path);
}
export function knowledgeTokens(text: string): string[] {
  const lower = text.normalize('NFKC').toLowerCase();
  const tokens = lower.match(/[a-z0-9]+(?:[-_.\/][a-z0-9]+)*|[\p{Script=Han}]+/gu) ?? [];
  return [...new Set(tokens.flatMap((token) => /[\p{Script=Han}]/u.test(token)
    ? [token, ...Array.from(token).flatMap((_, i, chars) => i + 1 < chars.length ? [chars[i]! + chars[i + 1]!] : [])] : [token]))].slice(0, 4000);
}
export function chunkText(text: string, position: KnowledgePosition, method: string): KnowledgeChunk[] {
  const safe = sanitizeKnowledge(text).trim();
  const result: KnowledgeChunk[] = [];
  // Bounded overlap preserves steps at segment boundaries; retrieval expands
  // SOP evidence using the complete current source rather than these windows.
  for (let start = 0; start < safe.length; start += 1600) result.push({ text: safe.slice(start, start + 2000), position, method });
  return result;
}
export function parseJsonml(raw: unknown): KnowledgeContent {
  const tree = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(tree)) throw new Error('KNOWLEDGE_JSONML_INVALID');
  const chunks: KnowledgeChunk[] = [], quality: string[] = [];
  const children = (node: unknown[]): unknown[] => node.slice(node[1] && typeof node[1] === 'object' && !Array.isArray(node[1]) ? 2 : 1);
  const plain = (node: unknown): string => typeof node === 'string' ? node : Array.isArray(node) ? children(node).map(plain).join(' ') : '';
  const walk = (node: unknown, path: string) => {
    if (!Array.isArray(node)) return;
    const attrs = node[1] && typeof node[1] === 'object' && !Array.isArray(node[1]) ? node[1] as Record<string, unknown> : {};
    const id = String(attrs.uuid ?? attrs.id ?? path);
    if (/image|img/i.test(String(node[0])) || (node[0]==='card'&&attrs.cardType==='hetu')) quality.push(`image_pending:${id}`);
    if (/^(p|paragraph|h[1-6]|heading|table|li|list-item|blockquote|pre)$/i.test(String(node[0]))) {
      chunks.push(...chunkText(plain(node), { block: id }, 'jsonml')); return;
    }
    children(node).forEach((child, index) => {
      if (typeof child === 'string') chunks.push(...chunkText(child, { block: id }, 'jsonml'));
      else walk(child, `${path}.${index}`);
    });
  };
  const imageWalk=(node:unknown,path:string):void=>{
    if(!Array.isArray(node)) return;
    const attrs=node[1] && typeof node[1]==='object' && !Array.isArray(node[1]) ? node[1] as Record<string,unknown> : {};
    if (/image|img/i.test(String(node[0])) || (node[0]==='card'&&attrs.cardType==='hetu')) quality.push(`image_pending:${String(attrs.uuid ?? attrs.id ?? path)}`);
    children(node).forEach((child,index)=>imageWalk(child,`${path}.${index}`));
  };
  imageWalk(tree,'root');
  walk(tree, 'root');
  if (!chunks.length) quality.push('no_text_requires_image_check');
  return { chunks, facts: [], quality };
}

// RFC4180 parser, including multiline quoted cells. Row-marker stripping is
// only for DWS CSV; exported workbook rows already carry actual coordinates.
export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [], row: string[] = []; let cell = '', quoted = false;
  const value = csv.replace(/^\[row=\d+\]\s?/gm, '');
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '"') { if (quoted && value[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (c === '\n' && !quoted) { row.push(cell.replace(/\r$/, '')); rows.push([...row]); row.length = 0; cell = ''; }
    else cell += c;
  }
  if (quoted) throw new Error('KNOWLEDGE_CSV_UNCLOSED');
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push([...row]); }
  return rows;
}
export function parseSheet(rows: Array<{ row: number; cells: string[] }>, sheet: string, standard: boolean): KnowledgeContent {
  const chunks: KnowledgeChunk[] = [], facts: KnowledgeFact[] = [], quality: string[] = [];
  const secretColumns = new Set<number>();
  for (const row of rows.slice(0, 10)) row.cells.forEach((value, col) => {
    if (/^(?:密码|口令|密钥|API\s*KEY|AppSecret|access.?token|refresh.?token|password)$/i.test(value.trim())) secretColumns.add(col);
  });
  const safeRows = rows.map((row) => ({ ...row, cells: row.cells.map((v, i) => secretColumns.has(i) ? '[凭据字段已过滤]' : sanitizeKnowledge(v)) }));
  for (let start = 0; start < safeRows.length; start += 20) {
    const block = safeRows.slice(start, start + 24);
    if (!block.length) continue;
    const text = block.map((r) => `[row=${r.row}] ${r.cells.map((v, i) => `${columnName(i + 1)}:${v}`).join(' | ')}`).join('\n');
    chunks.push(...chunkText(`${sheet}\n${text}`, { sheet, range: `A${block[0]!.row}:${columnName(Math.max(...block.map((r) => r.cells.length)))}${block.at(-1)!.row}` }, 'workbook'));
  }
  if (safeRows.some((row) => row.cells.some((v) => /#NAME\?|#REF!|#VALUE!/.test(v)))) quality.push('formula_error');
  if (standard) {
    // The audited standard workbook repeats attribute/value pairs horizontally.
    // Only explicit 型号 cells start a product group; no model inference.
    for (let index = 0; index < safeRows.length; index++) {
      const row = safeRows[index]!;
      row.cells.forEach((value, col) => {
        if (!/^(型号|SKU)$/i.test(value.trim())) return;
        const models = (row.cells[col + 1]?.match(/[A-Za-z][A-Za-z0-9]*(?:[-_.][A-Za-z0-9]+)*/g) ?? []).filter(m=>/\d.*\d/.test(m));
        for (const model of models) for (const attr of safeRows.slice(index + 1)) {
          const label = attr.cells[col]?.trim(), val = attr.cells[col + 1]?.trim();
          if (label === '型号') break;
          if (label && val && !secretColumns.has(col + 1)) facts.push({ model: model.toLowerCase(), attribute: label, value: val,
            position: { sheet, range: `${columnName(col + 1)}${attr.row}:${columnName(col + 2)}${attr.row}` }, scope: sheet });
        }
      });
    }
  }
  // Each parameter window repeats the explicit model. Otherwise lower rows
  // (power supply, dimensions, SD card) lose their model when split from the
  // header and retrieval confuses products in horizontally repeated tables.
  const models=[...new Set(facts.map(f=>f.model))];
  for (const model of models) {
    const entries=facts.filter(f=>f.model===model);
    for(let index=0;index<entries.length;index+=8) {
      const group=entries.slice(index,index+8);
      const text=group.map(f=>`${model} / ${sheet} / ${f.attribute}: ${f.value} (${f.position.range})`).join('\n');
      const start=group[0]!.position.range!.split(':')[0]!,end=group.at(-1)!.position.range!.split(':').at(-1)!;
      chunks.push(...chunkText(text, {sheet,range:start+':'+end},'standard_parameters'));
    }
  }
  return { chunks, facts, quality };
}
export function columnName(value: number): string {
  let result = ''; for (let n = value; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result || 'A';
}
