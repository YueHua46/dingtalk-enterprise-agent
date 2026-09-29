import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { NativeWebTool } from './native-web-tool.js';

type SearchCommand = { q?: unknown; domains?: unknown; recency?: unknown };
type PageCommand = { ref_id?: unknown; pattern?: unknown; id?: unknown };
type Session = { refs: Map<string, string>; links: Map<string, string>; updatedAt: number; nextRef: number };

/** Implements Codex's alpha/search wire contract using Gemini's native Google Search grounding. */
export class StandaloneWebSearch {
  private readonly sessions = new Map<string, Session>();

  public constructor(private readonly groundedSearch: NativeWebTool, private readonly http: typeof fetch = fetch) {}

  public async execute(raw: unknown): Promise<{ encrypted_output: null; output: string; results: Array<Record<string, unknown>> }> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('WEB_SEARCH_INVALID_REQUEST');
    const request = raw as Record<string, unknown>;
    if (typeof request.id !== 'string' || !request.id || request.id.length > 200) throw new Error('WEB_SEARCH_INVALID_SESSION');
    const commands = request.commands;
    if (!commands || typeof commands !== 'object' || Array.isArray(commands)) throw new Error('WEB_SEARCH_COMMANDS_REQUIRED');
    const input = commands as Record<string, unknown>;
    const session = this.session(request.id);
    const output: string[] = [];
    const results: Array<Record<string, unknown>> = [];

    const queries = this.array<SearchCommand>(input.search_query, 4);
    for (const item of queries) {
      if (typeof item.q !== 'string' || !item.q.trim() || item.q.length > 500) throw new Error('WEB_SEARCH_INVALID_QUERY');
      const domains = Array.isArray(item.domains) ? item.domains.filter((value): value is string => typeof value === 'string').slice(0, 5) : [];
      const recency = typeof item.recency === 'number' && item.recency > 0 ? ` Recent ${Math.min(item.recency, 365)} days.` : '';
      const query = `${item.q.trim()}${domains.length ? ` Restrict sources to: ${domains.join(', ')}.` : ''}${recency}`;
      const answer = await this.groundedSearch.search({ query });
      output.push(`Search query: ${item.q.trim()}\n${answer}`);
      for (const source of sourceLinks(answer)) {
        const refId = `turn0search${session.nextRef++}`;
        session.refs.set(refId, source.url);
        results.push({ type: 'text_result', ref_id: refId, url: source.url, title: source.title });
        output.push(`${refId}: ${source.title} — ${source.url}`);
      }
    }

    for (const item of this.array<PageCommand>(input.open, 4)) {
      const refId = this.ref(item.ref_id);
      const url = this.resolve(session, refId);
      const page = await this.readPublicPage(url);
      const viewRef = `turn1view${session.nextRef++}`;
      session.refs.set(viewRef, page.url);
      output.push(`Open ${refId} -> ${viewRef} (${page.url})\nTitle: ${page.title}\n${page.text}`);
      page.links.forEach((link, index) => {
        session.links.set(`${viewRef}:${index}`, link.url);
        output.push(`[${index}] ${link.title}: ${link.url}`);
      });
    }

    for (const item of this.array<PageCommand>(input.find, 4)) {
      const refId = this.ref(item.ref_id);
      if (typeof item.pattern !== 'string' || !item.pattern || item.pattern.length > 200) throw new Error('WEB_SEARCH_INVALID_PATTERN');
      const page = await this.readPublicPage(this.resolve(session, refId));
      const at = page.text.toLowerCase().indexOf(item.pattern.toLowerCase());
      output.push(`Find ${JSON.stringify(item.pattern)} in ${page.url}: ${at < 0 ? 'not found' : page.text.slice(Math.max(0, at - 300), at + item.pattern.length + 500)}`);
    }

    for (const item of this.array<PageCommand>(input.click, 4)) {
      const refId = this.ref(item.ref_id);
      if (!Number.isInteger(item.id) || Number(item.id) < 0) throw new Error('WEB_SEARCH_INVALID_LINK_ID');
      const url = session.links.get(`${refId}:${item.id}`);
      if (!url) throw new Error('WEB_SEARCH_LINK_NOT_FOUND');
      const page = await this.readPublicPage(url);
      const viewRef = `turn1view${session.nextRef++}`;
      session.refs.set(viewRef, page.url);
      output.push(`Click [${item.id}] from ${refId} -> ${viewRef} (${page.url})\nTitle: ${page.title}\n${page.text}`);
      page.links.forEach((link, index) => {
        session.links.set(`${viewRef}:${index}`, link.url);
        output.push(`[${index}] ${link.title}: ${link.url}`);
      });
    }

    const unsupported = ['screenshot', 'finance', 'weather', 'sports', 'time', 'image_query']
      .filter((key) => Array.isArray(input[key]) && (input[key] as unknown[]).length > 0);
    if (unsupported.length) output.push(`Unsupported web.run commands on this Gemini search backend: ${unsupported.join(', ')}.`);
    if (!output.length) throw new Error('WEB_SEARCH_NO_SUPPORTED_COMMAND');
    const limit = input.response_length === 'short' ? 8_000 : input.response_length === 'long' ? 48_000 : 24_000;
    return { encrypted_output: null, output: output.join('\n\n').slice(0, limit), results };
  }

  private array<T>(value: unknown, max: number): T[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > max || value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('WEB_SEARCH_INVALID_COMMAND');
    return value as T[];
  }

  private ref(value: unknown): string {
    if (typeof value !== 'string' || !value || value.length > 2_000) throw new Error('WEB_SEARCH_INVALID_REF');
    return value;
  }

  private resolve(session: Session, refId: string): string {
    return session.refs.get(refId) ?? refId;
  }

  private session(id: string): Session {
    const now = Date.now();
    for (const [key, value] of this.sessions) if (now - value.updatedAt > 60 * 60_000) this.sessions.delete(key);
    const found = this.sessions.get(id);
    if (found) { found.updatedAt = now; return found; }
    if (this.sessions.size >= 100) this.sessions.delete(this.sessions.keys().next().value!);
    const created = { refs: new Map<string, string>(), links: new Map<string, string>(), updatedAt: now, nextRef: 0 };
    this.sessions.set(id, created);
    return created;
  }

  private async readPublicPage(initial: string): Promise<{ url: string; title: string; text: string; links: Array<{ title: string; url: string }> }> {
    let target = initial;
    for (let redirect = 0; redirect < 5; redirect++) {
      const url = await publicUrl(target);
      const response = await this.http(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000), headers: { accept: 'text/html,text/plain;q=0.9' } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error('WEB_SEARCH_REDIRECT_WITHOUT_LOCATION');
        target = new URL(location, url).toString();
        continue;
      }
      if (!response.ok) throw new Error(`WEB_SEARCH_PAGE_HTTP_${response.status}`);
      const contentType = response.headers.get('content-type') ?? '';
      if (!/text\/html|text\/plain/i.test(contentType)) throw new Error('WEB_SEARCH_PAGE_UNSUPPORTED_TYPE');
      const bytes = await limitedBody(response, 1_000_000);
      const html = new TextDecoder().decode(bytes);
      const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? url.hostname).trim();
      const links: Array<{ title: string; url: string }> = [];
      for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        try {
          const link = new URL(decodeEntities(match[1]!), url).toString();
          if (link.startsWith('https://')) links.push({ title: decodeEntities(stripTags(match[2]!)).slice(0, 100), url: link });
        } catch { /* Ignore malformed page links. */ }
        if (links.length >= 30) break;
      }
      const text = decodeEntities(stripTags(html)).replace(/\s+/g, ' ').trim().slice(0, 18_000);
      return { url: url.toString(), title, text, links };
    }
    throw new Error('WEB_SEARCH_TOO_MANY_REDIRECTS');
  }
}

function sourceLinks(answer: string): Array<{ title: string; url: string }> {
  const sources = answer.split(/\nSources:\s*\n/i)[1] ?? '';
  return [...sources.matchAll(/^\[\d+\] \[([^\]]+)\]\((https:\/\/[^)]+)\)/gm)]
    .slice(0, 12).map((match) => ({ title: match[1]!, url: match[2]! }));
}

async function publicUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('WEB_SEARCH_PUBLIC_HTTPS_REQUIRED');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isIP(host)) throw new Error('WEB_SEARCH_PRIVATE_HOST');
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) throw new Error('WEB_SEARCH_PRIVATE_HOST');
  return url;
}

function privateAddress(address: string): boolean {
  if (address.includes(':')) return !/^2[0-9a-f]{3}:/i.test(address) && !/^3[0-9a-f]{3}:/i.test(address);
  const parts = address.split('.').map(Number);
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0]! >= 224
    || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31)
    || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127);
}

async function limitedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('WEB_SEARCH_PAGE_TOO_LARGE');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(chunks);
}

function stripTags(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (item) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }[item] ?? item));
}
