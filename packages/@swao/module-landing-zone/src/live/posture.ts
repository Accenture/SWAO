// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3864: `estate.posture` at the scan boundary and in the scope merge
// (Design 123 sections 5.4, 9.1; Design 120 section 11.1).
//   - Scan boundary (`scrubPostureAttributes`): every `attributes` map of a
//     posture block passes the one attribute privacy filter of #3886
//     (`filterAttributes`, live/privacy.ts; Design 123 sections 5.7 and 12)
//     with the landing zone's pseudonym salt and the scope's login names, so
//     no unfiltered returned property reaches the WSP.
//   - Scope merge (`mergeLzLivePosture`): per-resource blocks (encryption,
//     exposure, ingress_rules, backup) are unioned by `lzLivePostureEntryKey`,
//     the first scope in merge order (platform first) keeps its entry.
//     Governance blocks (identity, logging) come from the platform scope
//     (Design 123 section 8.3); without one, from the first application scope
//     that read them, with that scope's source. A per-resource block source is
//     `ok` when any scope read it; it is `partial` when a contributing source
//     was partial or another merged scope could not read the block.

import { LzLivePostureSchema, lzLivePostureEntryKey } from '@swao/core';
import type { LzLiveAttributes, LzLiveFactSource, LzLivePosture, LzLivePostureInput, LzLiveScan } from '@swao/core';
import { filterAttributes } from './privacy.js';

type ListBlock = 'encryption' | 'exposure' | 'ingress_rules' | 'backup' | 'budgets';
const LIST_BLOCKS: readonly ListBlock[] = ['encryption', 'exposure', 'ingress_rules', 'backup', 'budgets'];

/** The entry with its `attributes` map passed through the privacy filter (removed when the filter empties it). */
function filtered<T extends { attributes?: LzLiveAttributes }>(v: T, salt: string, people: readonly string[]): T {
  const out = { ...v };
  const f = filterAttributes(v.attributes, salt, people);
  if (f.attributes) out.attributes = f.attributes;
  else delete out.attributes;
  return out;
}

/** Validate a driver's posture and pass every `attributes` map through the privacy filter (see the header). */
export function scrubPostureAttributes(raw: LzLivePostureInput, salt: string, people: readonly string[] = []): LzLivePosture {
  const parsed = LzLivePostureSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`[lz live] the driver returned an invalid posture: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const p = parsed.data;
  const f = <T extends { attributes?: LzLiveAttributes }>(v: T): T => filtered(v, salt, people);
  const out: LzLivePosture = {};
  if (p.encryption) out.encryption = { source: p.encryption.source, items: p.encryption.items.map(f) };
  if (p.exposure) out.exposure = { source: p.exposure.source, items: p.exposure.items.map(f) };
  if (p.ingress_rules) out.ingress_rules = { source: p.ingress_rules.source, items: p.ingress_rules.items.map(f) };
  if (p.backup) out.backup = { source: p.backup.source, items: p.backup.items.map(f) };
  if (p.budgets) out.budgets = { source: p.budgets.source, items: p.budgets.items.map(f) };
  if (p.identity) out.identity = f(p.identity);
  if (p.logging) out.logging = { ...p.logging, trails: p.logging.trails.map(f) };
  return out;
}

/** Combine the sources of one block over the merged scopes (`present` read it; `scopes` merged in total). */
function mergeSources(sources: readonly LzLiveFactSource[], scopes: number): LzLiveFactSource {
  const ok = sources.filter((s) => s.status === 'ok');
  const calls = [...new Set(sources.flatMap((s) => s.calls))].sort();
  if (ok.length === 0) {
    const first = sources[0]!;
    return { ...first, calls, partial: sources.some((s) => s.partial) };
  }
  return { calls, partial: ok.length < scopes || ok.some((s) => s.partial), status: 'ok' };
}

/** Posture of the merged scopes, in merge order (platform first); undefined when none carries posture. */
export function mergeLzLivePosture(scans: readonly LzLiveScan[]): LzLivePosture | undefined {
  const withPosture = scans.filter((s) => s.estate.posture !== undefined);
  if (withPosture.length === 0) return undefined;
  const out: LzLivePosture = {};
  for (const block of LIST_BLOCKS) {
    const parts = withPosture.flatMap((s) => (s.estate.posture?.[block] ? [s.estate.posture[block]] : []));
    if (parts.length === 0) continue;
    const seen = new Map<string, unknown>();
    for (const part of parts) {
      if (part.source.status !== 'ok') continue;
      for (const item of part.items) {
        const key = lzLivePostureEntryKey(block, item as never);
        if (!seen.has(key)) seen.set(key, item);
      }
    }
    (out as Record<ListBlock, unknown>)[block] = { source: mergeSources(parts.map((p) => p.source), scans.length), items: [...seen.values()] };
  }
  for (const block of ['identity', 'logging'] as const) {
    const owners = withPosture.filter((s) => s.estate.posture?.[block] !== undefined);
    if (owners.length === 0) continue;
    const winner = owners.find((s) => s.meta.scope_kind === 'platform' && s.estate.posture?.[block]?.source.status === 'ok')
      ?? owners.find((s) => s.estate.posture?.[block]?.source.status === 'ok')
      ?? owners[0]!;
    (out as Record<string, unknown>)[block] = winner.estate.posture![block]!;
  }
  return LzLivePostureSchema.parse(out);
}
