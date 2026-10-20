// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * endoflife.date client (Design 103 §6.2.2 B-1, #3088).
 *
 * The product slug comes from the INFRA-CAT entry of the app's `os_class`
 * (`eol_product_ids`); the release cycle is matched against the cycles the API
 * actually returns, so no cycle slug is guessed. Only the product slug leaves
 * the client network.
 */

import { HttpError, requestJson, type HttpContext, type RunCache } from './http.js';
import type { EolBlock } from './schema.js';

export const EOL_BASE_URL = 'https://endoflife.date/api';

export interface EolCycle {
  cycle: string;
  eol?: string | boolean;
  support?: string | boolean;
  extendedSupport?: string | boolean;
  releaseDate?: string;
}

export function emptyEolBlock(): EolBlock {
  return {
    source: 'endoflife.date', fetched_at: null, confidence: null, product: null, cycle: null, date: null,
    is_eol: null, support_until: null, extended_support_until: null, months_until_eol: null, evidence_url: null,
  };
}

/** Pick the endoflife.date product for an OS string from the catalogue's candidate ids. */
export function productForOs(os: string, productIds: readonly string[]): string | null {
  if (productIds.length === 0) return null;
  const lower = os.toLowerCase();
  const aliases: Record<string, string[]> = {
    rhel: ['red hat'], sles: ['suse'], 'oracle-linux': ['oracle linux'], 'rocky-linux': ['rocky'],
    almalinux: ['alma'], centos: ['centos'], 'windows-server': ['windows server'],
  };
  for (const id of productIds) {
    const words = aliases[id] ?? [id.replace(/-/g, ' ')];
    if (words.some((w) => lower.includes(w))) return id;
  }
  return productIds[0] ?? null;
}

const asDate = (v: string | boolean | undefined): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/**
 * Match the OS string to a release cycle: Windows names (2012 R2 -> 2012-r2),
 * then the most specific numeric version present in the string (12 SP5 -> 12.5,
 * then 12). Among several matching cycles the latest-ending one wins.
 */
export function matchCycle(os: string, cycles: readonly EolCycle[]): EolCycle | null {
  const lower = os.toLowerCase();
  const names = cycles.map((c) => c.cycle.toLowerCase());
  const pick = (cands: string[]): EolCycle | null => {
    const hits = cycles.filter((c) => cands.includes(c.cycle.toLowerCase()));
    if (hits.length === 0) return null;
    return [...hits].sort((a, b) => (asDate(b.eol) ?? '').localeCompare(asDate(a.eol) ?? ''))[0] ?? null;
  };

  const win = /\b(2000|2003|2008|2012|2016|2019|2022|2025)\b(\s*r2)?/.exec(lower);
  if (win) {
    const base = `${win[1]}${win[2] ? '-r2' : ''}`;
    const hit = pick(names.filter((n) => n === base || n.startsWith(`${base}-`)).filter((n) => win[2] || !n.includes('-r2')));
    if (hit) return hit;
  }

  const sp = /\b(\d{1,2})\s*sp\s*(\d)\b/.exec(lower);
  if (sp) {
    const hit = pick([`${sp[1]}.${sp[2]}`, `${sp[1]}-sp${sp[2]}`]);
    if (hit) return hit;
  }
  for (const m of lower.matchAll(/\b(\d{1,2}(?:\.\d{1,2})?)\b/g)) {
    const v = m[1] as string;
    const hit = pick(names.filter((n) => n === v)) ?? pick(names.filter((n) => n.startsWith(`${v}.`)));
    if (hit) return hit;
  }
  return null;
}

function monthsBetween(from: Date, toIso: string): number {
  const to = new Date(`${toIso}T00:00:00Z`);
  return Math.round(((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * 30.44)) * 10) / 10;
}

export async function queryEol(
  ctx: HttpContext,
  input: { os: string | null; productIds: readonly string[] },
  opts: { baseUrl?: string; now: Date; cache: RunCache },
): Promise<EolBlock> {
  const block = emptyEolBlock();
  const fetchedAt = opts.now.toISOString();
  const product = input.os ? productForOs(input.os, input.productIds) : null;
  if (!input.os) return { ...block, fetched_at: fetchedAt, confidence: 'low', note: 'no_os_value' };
  if (!product) return { ...block, fetched_at: fetchedAt, confidence: 'low', note: 'no_slug_for_category' };

  const url = `${opts.baseUrl ?? EOL_BASE_URL}/${encodeURIComponent(product)}.json`;
  let cycles: EolCycle[];
  try {
    cycles = await opts.cache.get(`eol:${url}`, () => requestJson<EolCycle[]>(ctx, url));
    if (!Array.isArray(cycles)) throw new HttpError(null, 'unexpected response shape');
  } catch (e) {
    return { ...block, product, fetched_at: fetchedAt, confidence: 'low', error: e instanceof HttpError ? e.message : 'request failed' };
  }
  const cycle = matchCycle(input.os, cycles);
  const evidence = `https://endoflife.date/${product}`;
  if (!cycle) return { ...block, product, fetched_at: fetchedAt, confidence: 'low', note: 'no_cycle_match', evidence_url: evidence };

  const eolDate = asDate(cycle.eol);
  const isEol = typeof cycle.eol === 'boolean' ? cycle.eol : eolDate ? eolDate < opts.now.toISOString().slice(0, 10) : null;
  return {
    ...block,
    fetched_at: fetchedAt,
    confidence: 'high',
    product,
    cycle: cycle.cycle,
    date: eolDate,
    is_eol: isEol,
    support_until: asDate(cycle.support),
    extended_support_until: asDate(cycle.extendedSupport),
    months_until_eol: eolDate ? monthsBetween(opts.now, eolDate) : null,
    evidence_url: evidence,
  };
}
