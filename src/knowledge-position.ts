import { z } from 'zod';
import type { KnowledgePosition } from './knowledge-parse.js';

const cellRange = /^\$?[A-Za-z]{1,4}\$?[1-9]\d*(?::\$?[A-Za-z]{1,4}\$?[1-9]\d*)?$/;
export const knowledgePositionSchema = z.object({
  page: z.number().int().min(1).max(1000).optional(),
  sheet: z.string().min(1).max(200).optional(),
  range: z.string().regex(cellRange).optional(),
  block: z.string().min(1).max(200).optional(),
  image: z.string().min(1).max(200).optional(),
  region: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  // Legacy callers copy the whole citation. Merges describe the workbook,
  // rather than constrain which passage is being requested.
  mergedRanges: z.array(z.string().regex(cellRange)).max(100).optional()
}).strict().refine(p => ['page', 'sheet', 'range', 'block', 'image', 'region'].some(k => k in p), 'POSITION_SELECTOR_REQUIRED');

type Selector = z.infer<typeof knowledgePositionSchema>;

function rectangle(range: string): number[] | undefined {
  const parts = range.replace(/\$/g, '').toUpperCase().split(':');
  const cell = (value: string) => {
    const match = value.match(/^([A-Z]+)([1-9]\d*)$/);
    if (!match) return undefined;
    let column = 0;
    for (const letter of match[1]!) column = column * 26 + letter.charCodeAt(0) - 64;
    return [column, Number(match[2])];
  };
  const first = cell(parts[0]!), last = cell(parts[1] ?? parts[0]!);
  return first && last ? [Math.min(first[0]!, last[0]!), Math.min(first[1]!, last[1]!), Math.max(first[0]!, last[0]!), Math.max(first[1]!, last[1]!)] : undefined;
}

function matches(position: KnowledgePosition, selector: Selector): boolean {
  for (const key of ['page', 'sheet', 'block', 'image'] as const) {
    if (selector[key] !== undefined && position[key] !== selector[key]) return false;
  }
  if (selector.region && JSON.stringify(selector.region) !== JSON.stringify(position.region)) return false;
  if (selector.range) {
    const requested = rectangle(selector.range), stored = position.range && rectangle(position.range);
    // Chunks are windows, not single cells. Return windows intersecting the
    // requested cells, with their original bounds kept in the citation.
    if (!requested || !stored || requested[0]! > stored[2]! || requested[2]! < stored[0]! || requested[1]! > stored[3]! || requested[3]! < stored[1]!) return false;
  }
  return true;
}

/** Interpret position semantics once; never search serialized coordinates. */
export function knowledgePositionFilter(input: string | Selector | undefined): (position: KnowledgePosition) => boolean {
  if (input === undefined) return () => true;
  if (typeof input !== 'string') return position => matches(position, input);
  const value = input.trim();
  if (value.startsWith('{')) {
    try {
      const selector = knowledgePositionSchema.parse(JSON.parse(value));
      return position => matches(position, selector);
    } catch { return () => false; }
  }
  const page = value.match(/^(?:page\s*[:=]?\s*)?([1-9]\d*)$/i) ?? value.match(/^第?\s*([1-9]\d*)\s*页$/);
  if (page) return position => position.page === Number(page[1]);
  const bang = value.lastIndexOf('!');
  if (bang > 0 && cellRange.test(value.slice(bang + 1))) {
    const sheet = value.slice(0, bang).replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
    return position => matches(position, {sheet, range: value.slice(bang + 1)});
  }
  if (cellRange.test(value)) return position => matches(position, {range: value});
  // A bare structural identifier or sheet title is accepted exactly.
  return position => position.block === value || position.image === value || position.sheet === value;
}
