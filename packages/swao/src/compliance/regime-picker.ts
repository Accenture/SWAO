// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { load, dump } from 'js-yaml';
import { loadRegimeRegistry } from './registry.js';
import { resolveCatalogsDir } from '../commands/init.js';
import type {
  RegimeIndexEntry,
  Scope,
} from '../schema/regime-catalogue.js';

export interface AvailableRegime {
  scope: Scope;
  entry: RegimeIndexEntry;
}

/**
 * Read the registry from `<workspaceDir>/catalogs/` and return a list of
 * regimes the consultant can pick. Sprint-039 #0358 Phase 3 retired the
 * standard scope; every entry is community now.
 *
 * Sort order: registry iteration order (which mirrors the canonical
 * entries from `_registry.yaml` plus any engagement-authored community
 * folders discovered by `loadCommunityIndex()`). Cross-id `replaces:`
 * aliases are deduped by their resolved entry so e.g. HIPAA + NIST_SP_800_66R2
 * surface once.
 */
export function loadAvailableRegimes(workspaceDir: string): AvailableRegime[] {
  const catalogsDir = resolveCatalogsDir(workspaceDir);
  if (!existsSync(catalogsDir)) return [];
  const registry = loadRegimeRegistry(catalogsDir);
  const out: AvailableRegime[] = [];
  const seen = new Set<string>();
  for (const resolved of registry.byId.values()) {
    if (seen.has(resolved.entry.id)) continue;
    seen.add(resolved.entry.id);
    out.push({ scope: 'community', entry: resolved.entry });
  }
  return out;
}

/**
 * Returns true if any of the regime's `applicability_hints` matches one of
 * the workload context hints. Used by the picker to highlight (but not
 * auto-select) regimes likely to apply.
 */
export function applicabilityHits(
  regime: AvailableRegime,
  contextHints: string[],
): boolean {
  const set = new Set(contextHints);
  return regime.entry.applicability_hints.some((h) => set.has(h));
}

/**
 * Read the list of currently active regimes from `.swao.yml`, returning an
 * empty array when the file is missing or has no `assessment.regimes_active`
 * field.
 * Written by writeRegimesActive() in this file (regime-picker.ts).
 * Field path: assessment.regimes_active. Round-trip test: regime-picker.test.ts (#0748/#0751).
 */
export function readRegimesActive(swaoYmlPath: string): string[] {
  if (!existsSync(swaoYmlPath)) return [];
  const raw = load(readFileSync(swaoYmlPath, 'utf-8')) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') return [];
  const assessment = raw.assessment as Record<string, unknown> | undefined;
  if (!assessment) return [];
  const ra = assessment.regimes_active;
  if (!Array.isArray(ra)) return [];
  return ra.filter((v): v is string => typeof v === 'string');
}

/**
 * Persist the picked regimes into `.swao.yml`. Writes the
 * `assessment.regimes_active` field, creating `assessment:` and
 * `providers.regime_catalogs[]` if absent. Round-trips other YAML keys
 * unchanged.
 */
export function writeRegimesActive(swaoYmlPath: string, regimes: string[]): void {
  const existing = existsSync(swaoYmlPath)
    ? (load(readFileSync(swaoYmlPath, 'utf-8')) as Record<string, unknown> | null) ?? {}
    : {};

  const root: Record<string, unknown> = { ...existing };

  // Ensure providers.regime_catalogs[] is wired so `swao assess` knows
  // where to load catalogues from. Idempotent: leaves existing entries.
  const providers = (root.providers as Record<string, unknown> | undefined) ?? {};
  const existingCatalogs = (providers.regime_catalogs as Array<{ id?: string; path?: string }>)
    ?? [];
  const want: Array<{ id: string; path: string }> = [
    { id: 'standard', path: 'catalogs/standard' },
    { id: 'community', path: 'catalogs/community' },
  ];
  const merged = [...existingCatalogs];
  for (const entry of want) {
    if (!merged.some((e) => e?.id === entry.id)) merged.push(entry);
  }
  providers.regime_catalogs = merged;
  root.providers = providers;

  const assessment = (root.assessment as Record<string, unknown> | undefined) ?? {};
  assessment.regimes_active = [...regimes];
  root.assessment = assessment;

  writeFileSync(
    swaoYmlPath,
    dump(root, { lineWidth: 120, noRefs: true }),
    'utf-8',
  );
}

/**
 * Build a render-ready row for a regime: label string and selection state
 * if one is provided. Pure function so the TUI screen and CLI fallback
 * share the same formatting rules.
 */
export function regimePickerRow(
  regime: AvailableRegime,
  contextHints: string[] = [],
): { label: string; value: string; hinted: boolean } {
  const id = regime.entry.id;
  const name = regime.entry.name;
  const count = regime.entry.controls_count;
  // Truncate long framework names to prevent line-wraps in the TUI picker
  // (terminal width ~80 chars; id ≤ 20 + "  " + name ≤ 35 + " (NN controls)" ≤ 14 = ~71)
  // Full name is shown in the GuidanceBox below the list.
  const shortName = name.length > 35 ? name.slice(0, 33) + '..' : name;
  const scopeTag = regime.scope === 'community' ? ' [community]' : '';
  return {
    label: `${id}  --  ${shortName}  (${count} controls)${scopeTag}`,
    value: id,
    hinted: applicabilityHits(regime, contextHints),
  };
}
