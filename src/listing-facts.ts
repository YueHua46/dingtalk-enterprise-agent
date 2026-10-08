import { createHash } from 'node:crypto';
import type { ListingInput, PreparedListingInput } from './listing-input.js';

/** Product attributes, not Amazon policy or evidence that the product supports a feature. */
export const CAMERA_ATTRIBUTES = {
  page_statement: ['page statement', '页面声明'],
  brand: ['brand', '品牌'], model: ['model', '型号'], product_type: ['product type', '产品类型'],
  resolution: ['resolution', '分辨率'], connectivity: ['connectivity', '连接方式'],
  power: ['power supply', '供电方式'], night_vision: ['night vision', '夜视'],
  storage: ['storage', '存储方式'], subscription: ['subscription', '订阅费用'],
  compatibility: ['compatibility', '兼容性'], installation: ['installation', '安装条件'],
  protection: ['protection rating', '防护等级'], package: ['package contents', '包装内容'],
  weight: ['weight', '重量'], battery_life: ['battery life', '续航'],
  charging_time: ['charging time', '充电时间'], length: ['length', '长度'],
  width: ['width', '宽度'], height: ['height', '高度'], frequency: ['frequency', '频率'],
  operating_temperature: ['operating temperature', '工作温度'],
} as const;

export type CameraAttribute = keyof typeof CAMERA_ATTRIBUTES;
const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const aliases = new Map<string, CameraAttribute>();
for (const [attribute, names] of Object.entries(CAMERA_ATTRIBUTES)) {
  aliases.set(attribute, attribute as CameraAttribute);
  for (const name of names) aliases.set(normalize(name), attribute as CameraAttribute);
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export interface FactQuantity {
  dimension: 'mass' | 'length' | 'duration' | 'frequency' | 'count';
  unit: 'g' | 'mm' | 's' | 'Hz' | 'count';
  values: string[];
  relation: 'exact' | 'range' | 'up_to' | 'at_least' | 'approximate';
  /** Original trailing conditions, retained verbatim, never inferred or translated. */
  condition: string;
}

export interface ProductFact {
  id: string;
  attribute: string;
  rawValue: string;
  quantity?: FactQuantity;
  provenance: {
    sourceId: string;
    sourceKind: ListingInput['materials'][number]['kind'];
    reference: string;
    sourceSha256: string;
    excerpt: string;
    start: number;
    end: number;
  };
  trust: 'user_provided' | 'page_unverified';
  status: 'usable' | 'needs_verification' | 'conflicting';
}

export interface FactIssue {
  code: 'unmapped_statement' | 'attribute_mismatch' | 'conflict' | 'no_facts' | 'unparsed_numeric';
  message: string;
  factIds: string[];
  sourceIds: string[];
  attribute?: string;
}

export interface ProductFactBook {
  version: string;
  owner: PreparedListingInput['owner'];
  surface: PreparedListingInput['surface'];
  requestId: string;
  facts: ProductFact[];
  issues: FactIssue[];
  unresolvedInputIssues: PreparedListingInput['issues'];
  unknownAttributes: CameraAttribute[];
  status: 'needs_clarification' | 'needs_sources' | 'ready' | 'ready_limited';
}

const unitTable: Record<string, { dimension: FactQuantity['dimension']; unit: FactQuantity['unit']; numerator: bigint; denominator: bigint }> = {};
function units(names: string[], dimension: FactQuantity['dimension'], unit: FactQuantity['unit'], numerator: bigint, denominator = 1n): void {
  for (const name of names) unitTable[name] = { dimension, unit, numerator, denominator };
}
units(['g', '克'], 'mass', 'g', 1n);
units(['kg', '千克', '公斤'], 'mass', 'g', 1000n);
units(['mm', '毫米'], 'length', 'mm', 1n);
units(['cm', '厘米'], 'length', 'mm', 10n);
units(['m', '米'], 'length', 'mm', 1000n);
units(['s', 'sec', 'seconds', '秒'], 'duration', 's', 1n);
units(['min', 'minutes', '分钟'], 'duration', 's', 60n);
units(['h', 'hr', 'hours', '小时'], 'duration', 's', 3600n);
units(['hz'], 'frequency', 'Hz', 1n);
units(['khz'], 'frequency', 'Hz', 1000n);
units(['mhz'], 'frequency', 'Hz', 1000000n);
units(['ghz'], 'frequency', 'Hz', 1000000000n);
units(['个', '件', 'pcs', 'pieces'], 'count', 'count', 1n);

/** Decimal arithmetic avoids floating-point equality and preserves input precision. */
function scaleDecimal(value: string, numerator: bigint, denominator: bigint): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const digits = BigInt(whole + fraction) * numerator;
  const divisor = 10n ** BigInt(fraction.length) * denominator;
  const integer = digits / divisor;
  let remainder = digits % divisor;
  let decimal = '';
  while (remainder !== 0n) {
    remainder *= 10n;
    decimal += String(remainder / divisor);
    remainder %= divisor;
  }
  return String(integer) + (decimal ? '.' + decimal : '');
}

function decimalGreater(left: string, right: string): boolean {
  const places = Math.max(left.split('.')[1]?.length ?? 0, right.split('.')[1]?.length ?? 0);
  const scaled = (value: string) => {
    const [whole = '0', fraction = ''] = value.split('.');
    return BigInt(whole + fraction.padEnd(places, '0'));
  };
  return scaled(left) > scaled(right);
}

/** Parses only an entire supported measurement, never extracts digits from model/IP names. */
export function normalizeFactQuantity(value: string): FactQuantity | undefined {
  const normalized = value.normalize('NFKC').trim();
  const match = /^(?:(up to|at least|approximately|最长|最高|最大|至少|约)\s*)?(\d+(?:\.\d+)?)\s*(?:([-–~至])\s*(\d+(?:\.\d+)?)\s*)?([a-zA-Z]+|千克|公斤|克|毫米|厘米|米|小时|分钟|秒|个|件)\s*(.*)$/i.exec(normalized);
  if (!match) return undefined;
  const unit = unitTable[match[5]!.toLowerCase()];
  if (!unit) return undefined;
  // Arbitrary suffixes might contain an additional measurement: keep them opaque.
  const trailing = match[6]!.trim();
  if (trailing && !/^(?:[（(].*[）)]|在.+|under\s+.+)$/i.test(trailing)) return undefined;
  const qualifier = (match[1] ?? '').toLowerCase();
  if (match[4] && qualifier) return undefined;
  const relation: FactQuantity['relation'] = match[4] ? 'range'
    : ['up to', '最长', '最高', '最大'].includes(qualifier) ? 'up_to'
      : ['at least', '至少'].includes(qualifier) ? 'at_least'
        : ['approximately', '约'].includes(qualifier) ? 'approximate' : 'exact';
  const values = [match[2]!, ...(match[4] ? [match[4]] : [])].map((number) => scaleDecimal(number, unit.numerator, unit.denominator));
  if (values.length === 2 && decimalGreater(values[0]!, values[1]!)) return undefined;
  return { dimension: unit.dimension, unit: unit.unit, values, relation, condition: trailing };
}

interface LabelledValue { attribute: CameraAttribute; value: string }
function labelledValue(excerpt: string): LabelledValue | undefined {
  const match = /^\s*([^:：\n]+)[:：]\s*(.+?)\s*$/u.exec(excerpt);
  if (!match || match[2]!.includes('\n')) return undefined;
  const attribute = aliases.get(normalize(match[1]!));
  return attribute ? { attribute, value: match[2]! } : undefined;
}

/** Parses explicit label/value lines only; free prose remains for a later extraction adapter. */
function labelledExcerpts(content: string): string[] {
  const excerpts:string[]=[];
  for(const line of content.split(/\r?\n/u)) {
    const parts=line.split(/([;；])/u);
    let current=parts[0] ?? '';
    for(let i=1;i<parts.length;i+=2) {
      const next=parts[i+1] ?? '';
      // A semicolon ends a fact only when an explicit known attribute follows.
      // Otherwise it is part of the value, including exclusions and requirements.
      if(labelledValue(next)) {excerpts.push(current.trim());current=next;}
      else current+=(parts[i] ?? '')+next;
    }
    excerpts.push(current.trim());
  }
  return excerpts.filter(line=>labelledValue(line)!==undefined);
}

function comparable(fact: ProductFact): string {
  return fact.quantity ? JSON.stringify({ ...fact.quantity, condition: normalize(fact.quantity.condition) }) : normalize(fact.rawValue);
}

/** Consumes host-prepared current-task materials; no model, IO, or assumed product defaults. */
export function buildProductFactBook(prepared: PreparedListingInput): ProductFactBook {
  const sources = new Map(prepared.input.materials.map((source) => [source.id, source]));
  const facts: ProductFact[] = [];
  const issues: FactIssue[] = [];
  const add = (sourceId: string, attribute: string, rawValue: string, excerpt: string, mapped: boolean): ProductFact => {
    const source = sources.get(sourceId);
    const start = source?.content?.indexOf(excerpt) ?? -1;
    if (!source?.content || start < 0) throw new Error('LISTING_FACT_SOURCE_INVALID');
    const sourceSha256 = digest(source.content);
    const id = 'fact-' + digest(JSON.stringify([sourceId, sourceSha256, attribute, rawValue, excerpt])).slice(0, 24);
    const prior = facts.find((fact) => fact.id === id);
    if (prior) return prior;
    const parsedQuantity = normalizeFactQuantity(rawValue);
    const expectedDimensions: Record<string, FactQuantity['dimension']> = {
      weight: 'mass', battery_life: 'duration', charging_time: 'duration',
      length: 'length', width: 'length', height: 'length', frequency: 'frequency',
    };
    const quantity = parsedQuantity && (!expectedDimensions[attribute] || expectedDimensions[attribute] === parsedQuantity.dimension)
      ? parsedQuantity : undefined;
    const fact: ProductFact = {
      id, attribute, rawValue, ...(quantity ? { quantity } : {}),
      provenance: { sourceId, sourceKind: source.kind, reference: source.reference, sourceSha256, excerpt, start, end: start + excerpt.length },
      trust: source.kind === 'listing' ? 'page_unverified' : 'user_provided',
      status: mapped ? 'usable' : 'needs_verification',
    };
    facts.push(fact);
    if (!mapped) issues.push({ code: 'unmapped_statement', message: '原文存在，但属性对应关系未由明确标签证实，需核实。', factIds: [id], sourceIds: [sourceId], attribute });
    if (!quantity && /\d/u.test(rawValue) && ['weight', 'battery_life', 'charging_time', 'length', 'width', 'height', 'frequency', 'operating_temperature'].includes(attribute)) {
      fact.status = 'needs_verification';
      issues.push({ code: 'unparsed_numeric', message: '数值格式或单位尚不支持，保留原文并核实，不自动换算。', factIds: [id], sourceIds: [sourceId], attribute });
    }
    return fact;
  };
  for (const source of prepared.input.materials) {
    if (!source.content) continue;
    for (const excerpt of labelledExcerpts(source.content)) {
      const labelled = labelledValue(excerpt)!;
      add(source.id, labelled.attribute, labelled.value, excerpt, true);
    }
  }
  for (const statement of prepared.input.statements) {
    const attribute = aliases.get(normalize(statement.attribute)) ?? normalize(statement.attribute);
    const source = sources.get(statement.sourceId);
    if (!source?.content?.includes(statement.excerpt) || !normalize(statement.excerpt).includes(normalize(statement.value))) throw new Error('LISTING_FACT_SOURCE_INVALID');
    const labelled = labelledValue(statement.excerpt);
    if (labelled && labelled.attribute !== attribute) {
      issues.push({ code: 'attribute_mismatch', message: '声明属性与原文标签不一致，拒绝绑定。', factIds: [], sourceIds: [statement.sourceId], attribute });
      continue;
    }
    // Use the complete original value, including limitations, not a shortened candidate.
    add(statement.sourceId, attribute, labelled?.value ?? statement.value, statement.excerpt, labelled !== undefined);
  }
  const groups = new Map<string, ProductFact[]>();
  for (const fact of facts) groups.set(fact.attribute, [...(groups.get(fact.attribute) ?? []), fact]);
  for (const [attribute, group] of groups) {
    if (new Set(group.map(comparable)).size <= 1) continue;
    group.forEach((fact) => { fact.status = 'conflicting'; });
    issues.push({ code: 'conflict', message: '同属性的值、单位类型或限定条件不同；保留全部出处，需澄清。', attribute, factIds: group.map((fact) => fact.id), sourceIds: [...new Set(group.map((fact) => fact.provenance.sourceId))] });
  }
  if (!facts.length) issues.push({ code: 'no_facts', message: '尚未得到可追溯的产品事实；请补充明确参数或完成事实提取。', factIds: [], sourceIds: [] });
  // Module 1's textual conflicts are replaced only for attributes covered by this book.
  const unresolvedInputIssues = prepared.issues.filter((issue) => issue.code !== 'conflicting_statements'
    || !issue.attribute || !groups.has(aliases.get(normalize(issue.attribute)) ?? normalize(issue.attribute)));
  const status = issues.some((issue) => ['conflict', 'attribute_mismatch'].includes(issue.code))
    || unresolvedInputIssues.some((issue) => ['conflicting_statements', 'missing_product_information'].includes(issue.code)) ? 'needs_clarification'
    : unresolvedInputIssues.some((issue) => ['missing_listing', 'unread_material'].includes(issue.code)) ? 'needs_sources'
      : !facts.length ? 'needs_clarification'
        : facts.some((fact) => fact.status !== 'usable' || fact.trust === 'page_unverified') ? 'ready_limited' : 'ready';
  const version = digest(JSON.stringify({ owner: prepared.owner, requestId: prepared.requestId, sources: prepared.input.materials.map((source) => [source.id, source.kind, source.reference, digest(source.content ?? '')]), facts, issues }));
  return { version, owner: { ...prepared.owner }, surface: { ...prepared.surface }, requestId: prepared.requestId,
    facts, issues, unresolvedInputIssues, unknownAttributes: (Object.keys(CAMERA_ATTRIBUTES) as CameraAttribute[]).filter((attribute) => attribute !== 'page_statement' && !groups.has(attribute)), status };
}
