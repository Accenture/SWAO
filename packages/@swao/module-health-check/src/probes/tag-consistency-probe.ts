// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Doctor module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #0363 (sprint-039) -- doctor probe that flags `tags:` shape drift
// within a community framework. The #0348 taxonomy uses an axis prefix
// (text before the first `.`) for each tag; every control of a given
// framework should carry the SAME set of axis prefixes (one tag per
// axis per control). A typo on a single control -- e.g. `applies_to.pii`
// instead of `applies-to.pii` -- shows up as a new axis prefix that
// appears in only one control. Threshold-based detection: a prefix that
// appears in <50% of a framework's controls is suspicious.
//
// Probe-only; the `swao doctor tags` subcommand calls it and decides
// the exit code (`--strict` -> non-zero on any warning).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { communityFrameworksDir } from '@swao/community-frameworks';

export type TagConsistencyStatus = 'ok' | 'warn';

export interface TagConsistencyFlag {
  framework_id: string;
  axis_prefix: string;
  controls_with_prefix: number;
  framework_total_controls: number;
  coverage_ratio: number;
  sample_control_ids: string[];
  suggested_canonical: string | null;
}

export interface TagConsistencyFrameworkResult {
  framework_id: string;
  controls_total: number;
  axis_prefix_coverage: Record<string, number>;
  flags: TagConsistencyFlag[];
}

export interface TagConsistencyProbeResult {
  status: TagConsistencyStatus;
  threshold: number;
  frameworks: TagConsistencyFrameworkResult[];
  message: string;
}

interface RawControl {
  id?: unknown;
  tags?: unknown;
}

interface RawCatalogue {
  regime_meta?: { id?: unknown; multi_domain_axes?: boolean };
  controls?: RawControl[];
}

// The bundled community frameworks root is owned + resolved by the
// @swao/community-frameworks leaf package (#0572).
function resolveBundledCommunityRoot(): string | null {
  try {
    if (existsSync(communityFrameworksDir) && statSync(communityFrameworksDir).isDirectory()) {
      return communityFrameworksDir;
    }
  } catch { /* not shipped */ }
  return null;
}

function axisPrefixOf(tag: string): string {
  const dot = tag.indexOf('.');
  return dot < 0 ? tag : tag.slice(0, dot);
}

function readControlsYaml(filePath: string): RawCatalogue | null {
  try {
    return load(readFileSync(filePath, 'utf-8')) as RawCatalogue;
  } catch {
    return null;
  }
}

function listFrameworkDirs(root: string): Array<{ id: string; controlsFile: string }> {
  const out: Array<{ id: string; controlsFile: string }> = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.startsWith('.') || entry.startsWith('_')) continue;
    const dir = join(root, entry);
    let st;
    try {
      st = statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const controlsFile = join(dir, 'controls.yaml');
    if (!existsSync(controlsFile)) continue;
    out.push({ id: entry, controlsFile });
  }
  return out;
}

// Best-effort suggested canonical for a low-coverage prefix: the
// highest-coverage prefix in the same framework whose levenshtein
// distance from the flagged one is small. Returns null when no plausible
// match exists (the flagged prefix may be intentional rather than typo).
function suggestCanonical(flagged: string, coverage: Record<string, number>): string | null {
  const others = Object.keys(coverage).filter((p) => p !== flagged);
  if (others.length === 0) return null;
  let best: { prefix: string; dist: number } | null = null;
  for (const candidate of others) {
    const dist = levenshtein(flagged, candidate);
    if (dist > Math.max(2, Math.floor(candidate.length / 3))) continue;
    if (best === null || dist < best.dist || (dist === best.dist && coverage[candidate] > coverage[best.prefix])) {
      best = { prefix: candidate, dist };
    }
  }
  return best?.prefix ?? null;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/**
 * Build the tag-consistency probe. Walks community frameworks from
 * (1) the workspace `wsp/inputs/catalogs/community/<id>/` directory and
 * (2) the bundled `community-frameworks/<id>/` directory shipped with
 * the binary. Workspace frameworks win on id collision (operator
 * overrides bundled).
 *
 * `thresholdRatio` defaults to 0.5: a prefix that appears in <50% of a
 * framework's controls is flagged as suspicious. Lower it to make the
 * probe more permissive; raise it to make it stricter.
 */
export function buildTagConsistencyProbe(
  workspacePath: string,
  thresholdRatio: number = 0.5,
): TagConsistencyProbeResult {
  const byId = new Map<string, { id: string; controlsFile: string }>();

  // Bundled first (lowest priority).
  const bundledRoot = resolveBundledCommunityRoot();
  if (bundledRoot !== null) {
    for (const fw of listFrameworkDirs(bundledRoot)) byId.set(fw.id, fw);
  }

  // Workspace overrides (highest priority).
  const wsCommunity = join(workspacePath, 'wsp', 'inputs', 'catalogs', 'community');
  if (existsSync(wsCommunity)) {
    for (const fw of listFrameworkDirs(wsCommunity)) byId.set(fw.id, fw);
  }

  const frameworks: TagConsistencyFrameworkResult[] = [];
  let totalFlags = 0;

  for (const { id, controlsFile } of [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const catalogue = readControlsYaml(controlsFile);
    if (catalogue === null) continue;
    const controls = catalogue.controls ?? [];
    const total = controls.length;
    if (total === 0) continue;

    // Per-control set of axis prefixes (deduped so a control with two
    // `applies-to.*` tags only counts once toward the applies-to prefix).
    const prefixHitsByControl = new Map<string, Set<string>>();
    for (const c of controls) {
      const cid = typeof c.id === 'string' ? c.id : '?';
      const tags = Array.isArray(c.tags) ? (c.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [];
      const prefixes = new Set<string>();
      for (const tag of tags) prefixes.add(axisPrefixOf(tag));
      prefixHitsByControl.set(cid, prefixes);
    }

    // Aggregate: per-prefix count of distinct controls that mention it.
    const axisPrefixCoverage: Record<string, number> = {};
    for (const prefixes of prefixHitsByControl.values()) {
      for (const p of prefixes) axisPrefixCoverage[p] = (axisPrefixCoverage[p] ?? 0) + 1;
    }

    // Flag low-coverage prefixes. Only meaningful if the framework has
    // enough controls for the ratio to be informative (skip <4 to avoid
    // false positives on stub catalogues). multi_domain_axes frameworks use
    // per-control domain prefixes by design; global coverage check does not
    // apply (each domain prefix legitimately covers only its subset of controls).
    const flags: TagConsistencyFlag[] = [];
    const isMultiDomain = catalogue.regime_meta?.multi_domain_axes === true;
    if (total >= 4 && !isMultiDomain) {
      for (const [prefix, count] of Object.entries(axisPrefixCoverage)) {
        const ratio = count / total;
        if (ratio < thresholdRatio) {
          const sampleIds: string[] = [];
          for (const [cid, prefixes] of prefixHitsByControl.entries()) {
            if (prefixes.has(prefix)) {
              sampleIds.push(cid);
              if (sampleIds.length >= 3) break;
            }
          }
          flags.push({
            framework_id: id,
            axis_prefix: prefix,
            controls_with_prefix: count,
            framework_total_controls: total,
            coverage_ratio: ratio,
            sample_control_ids: sampleIds,
            suggested_canonical: suggestCanonical(prefix, axisPrefixCoverage),
          });
        }
      }
    }

    totalFlags += flags.length;
    frameworks.push({
      framework_id: id,
      controls_total: total,
      // multi_domain_axes frameworks intentionally have many per-control domain prefixes;
      // expose empty coverage so callers know the global check is not applicable.
      axis_prefix_coverage: isMultiDomain ? {} : axisPrefixCoverage,
      flags,
    });
  }

  const status: TagConsistencyStatus = totalFlags === 0 ? 'ok' : 'warn';
  const flaggedCount = frameworks.reduce((sum, f) => sum + f.flags.length, 0);
  const message = totalFlags === 0
    ? `All ${frameworks.length} community frameworks have consistent tag shapes (threshold ${Math.round(thresholdRatio * 100)}%).`
    : `${flaggedCount} suspicious axis prefix(es) flagged across ${frameworks.length} community frameworks; see flags[].`;

  return {
    status,
    threshold: thresholdRatio,
    frameworks,
    message,
  };
}
