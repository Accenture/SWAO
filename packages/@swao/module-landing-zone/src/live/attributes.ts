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

// #3886 (Design 123 section 5.7, D-13): every property a read call returns is
// kept. The driver maps the properties with a normalised meaning (id, type,
// region, tags, created_at) and hands the rest of the API document to
// `flattenAttributes`, which turns it into the flat `attributes` map of
// `LzLiveAttributesSchema` (@swao/core lz-live-scan.ts). This is structure
// only: the privacy rules (names, people, free text, secret-shaped keys) are
// applied once, for every driver, by `filterAttributes` (privacy.ts) in the
// scan assembler (scan.ts), before the scan is stored.

import { LZ_LIVE_ATTRIBUTES_MAX } from '@swao/core';
import type { LzLiveAttributes, LzLiveAttributeValue } from '@swao/core';

/** Nesting depth below which properties are not followed. */
export const ATTRIBUTES_MAX_DEPTH = 6;
/** Elements of an array of objects that are flattened (`rules.0.x` to `rules.15.x`). */
export const ATTRIBUTES_MAX_OBJECT_ELEMENTS = 16;
/** Elements of an array of scalars that are kept. */
export const ATTRIBUTES_MAX_SCALAR_ELEMENTS = 64;
/** Key of the count of entries left out because the map reached its cap. */
export const ATTRIBUTES_TRUNCATED_KEY = '_truncated';

type Scalar = string | number | boolean | null;

function isScalar(v: unknown): v is Scalar {
  return v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
}

export interface FlattenOptions {
  /** Top-level keys already mapped into normalised fields (never repeated in the map). */
  omit?: readonly string[];
  /** Path prefix of every key (for example `properties` for an RMS `properties` object). */
  prefix?: string;
}

/**
 * Flatten an API document into an attributes map: nested objects become
 * dotted keys, arrays of scalars stay arrays, arrays of objects are indexed.
 * Bounded by depth, element counts and `LZ_LIVE_ATTRIBUTES_MAX`; entries left
 * out by the cap are counted under `_truncated`. Returns undefined when
 * nothing remains, so a resource without other properties carries no map.
 */
export function flattenAttributes(doc: unknown, opts: FlattenOptions = {}): LzLiveAttributes | undefined {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return undefined;
  const omit = new Set(opts.omit ?? []);
  const out: Record<string, LzLiveAttributeValue> = {};
  const cap = LZ_LIVE_ATTRIBUTES_MAX - 1;
  let count = 0;
  let truncated = 0;
  const put = (k: string, v: LzLiveAttributeValue): void => {
    if (count >= cap) {
      truncated++;
      return;
    }
    out[k] = v;
    count++;
  };
  const walk = (v: unknown, path: string, depth: number): void => {
    if (v === undefined || typeof v === 'function') return;
    if (isScalar(v)) {
      put(path, v);
      return;
    }
    if (depth >= ATTRIBUTES_MAX_DEPTH) return;
    if (Array.isArray(v)) {
      if (v.every(isScalar)) {
        put(path, v.slice(0, ATTRIBUTES_MAX_SCALAR_ELEMENTS));
        return;
      }
      v.slice(0, ATTRIBUTES_MAX_OBJECT_ELEMENTS).forEach((e, i) => walk(e, `${path}.${i}`, depth + 1));
      return;
    }
    if (typeof v === 'object') {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        if (k === '') continue;
        walk(child, `${path}.${k}`, depth + 1);
      }
    }
  };
  for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
    if (k === '' || omit.has(k)) continue;
    walk(v, opts.prefix ? `${opts.prefix}.${k}` : k, 1);
  }
  if (truncated > 0) out[ATTRIBUTES_TRUNCATED_KEY] = truncated;
  return Object.keys(out).length > 0 ? out : undefined;
}
