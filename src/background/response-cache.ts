// Tier 1 — response cache.
//
// Every cloud answer is stored keyed by (page URL + normalised question).
// Asking the same thing again, or something close enough to it, replays the
// stored answer for free instead of spending quota on an identical round-trip.

import { STORE_CACHE, idbGet, idbPut, idbGetAll, idbDelete, idbClear, idbTrim } from './db';

export interface CacheEntry {
  key: string;
  url: string;
  query: string;   // normalised
  raw: string;     // what the user actually typed
  answer: string;
  ts: number;
  expires: number;
  hits: number;
}

const MAX_ENTRIES = 400;
const CACHE_KEY_VERSION = 'v2';

/** How long an answer stays valid, by the kind of question it was. */
export function ttlFor(query: string): number {
  const MIN = 60_000;
  const q = query.toLowerCase();
  // Time-sensitive page summaries must use the shorter limit too.
  if (/price|stock|score|weather|news|today|now|latest|current/.test(q)) return 3 * MIN;
  // Page-derived answers go stale as the page changes.
  if (/summar|what.*(this|page)|tldr|key point|main point|explain this/.test(q)) return 15 * MIN;
  // Stable factual/how-to answers.
  return 24 * 60 * MIN;
}

/** Strip filler so "can you summarize this page please" == "summarize page". */
export function normalizeQuery(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\b(please|can you|could you|would you|hey|hi|echo|for me|now|just|kindly|pls|plz)\b/g, ' ')
    .replace(/\b(the|a|an|of|to|is|are|was|were|this|that|it|and|or|my|me|i)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Answers are always page-bound. A seemingly general question such as
 * "What is the refund policy?" is routinely answered from the active page;
 * sharing it across origins can replay one site's answer on another site.
 * The version prefix makes every pre-fix global key unreachable.
 */
function makeKey(url: string, _rawQuery: string, normalized: string): string {
  return `${CACHE_KEY_VERSION}:${stripUrl(url)}::${normalized}`;
}

function stripUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname + u.search + u.hash;
  } catch {
    return url || '*';
  }
}

/** Never replay an instruction as though it were merely an answer. */
export function isCacheableQuery(query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return false;
  if (/\b(click|open|type|send|submit|navigate|download|fill|delete|close|run|watch|record|remember|save|highlight|scroll|press|switch|buy|book|order|schedule)\b/.test(q)) return false;
  return /^(what|who|when|where|why|how|is|are|does|do|can|could|which|summari[sz]e|summarise|explain|tldr|tl;dr|key points?|main points?|compare)\b/.test(q);
}

function safePageScope(query: string, url: string): boolean {
  return /^https?:/i.test(url) && !/[?&#/](token|key|code|session|auth|password|secret)=/i.test(url);
}

export interface CacheHit { answer: string; exact: boolean; ageMs: number }

/** Look for a still-valid answer to this question. */
export async function cacheLookup(query: string, url: string): Promise<CacheHit | null> {
  if (!isCacheableQuery(query) || !safePageScope(query, url)) return null;
  const norm = normalizeQuery(query);
  if (!norm) return null;
  const now = Date.now();

  const exact = await idbGet<CacheEntry>(STORE_CACHE, makeKey(url, query, norm));
  if (exact && exact.expires > now) {
    exact.hits = (exact.hits || 0) + 1;
    idbPut(STORE_CACHE, exact);
    return { answer: exact.answer, exact: true, ageMs: now - exact.ts };
  }

  // Deliberately no fuzzy reuse. Similar-looking questions can concern
  // different products, policies or dates even on the same URL.
  return null;
}

/** Store an answer produced by a paid tier. */
export async function cacheStore(query: string, url: string, answer: string): Promise<void> {
  if (!isCacheableQuery(query) || !safePageScope(query, url)) return;
  const norm = normalizeQuery(query);
  if (!norm || !answer || answer.length < 8) return;
  // Errors and refusals must never be replayed as if they were answers.
  if (/^(ai |claude |gemini |auth\/init |api )?error|^(your gemini key|gemini's rate limit|that gemini api key|none of the gemini|rate limit reached|no .*api key|that took more steps|i couldn't complete)/i.test(answer.trim())) return;

  const now = Date.now();
  const entry: CacheEntry = {
    key: makeKey(url, query, norm),
    url: stripUrl(url),
    query: norm,
    raw: query,
    answer,
    ts: now,
    expires: now + ttlFor(query),
    hits: 0,
  };
  await idbPut(STORE_CACHE, entry);
  idbTrim(STORE_CACHE, 'ts', MAX_ENTRIES);
}

export async function cacheClear(): Promise<void> {
  await idbClear(STORE_CACHE);
}

export async function cacheForget(url: string, query: string): Promise<void> {
  await idbDelete(STORE_CACHE, makeKey(url, query, normalizeQuery(query)));
}

/** Drop everything expired. Cheap housekeeping, safe to call any time. */
export async function cachePrune(): Promise<number> {
  const now = Date.now();
  const all = await idbGetAll<CacheEntry>(STORE_CACHE, 2000);
  let n = 0;
  for (const e of all) {
    if (e.expires <= now) { await idbDelete(STORE_CACHE, e.key); n++; }
  }
  return n;
}

export async function cacheStats(): Promise<{ entries: number; hits: number }> {
  const all = await idbGetAll<CacheEntry>(STORE_CACHE, 2000);
  return { entries: all.length, hits: all.reduce((s, e) => s + (e.hits || 0), 0) };
}
