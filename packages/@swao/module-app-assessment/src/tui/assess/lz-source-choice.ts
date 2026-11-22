// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Application assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3887 (Design 123 section 8.4), #4244 (owner decision 2026-11-09): the LZ
// step of the Application Assessment screen offers the static LZ catalogue
// only; live landing-zone data is used only by the LZ Live Assessment. For an
// app linked in landing_zones[].scopes[].app the step shows the CLI warning and
// pre-fills the targets the CLI seeds from the linked scope regions, so CLI and
// TUI select the same targets.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { SwaoYmlLandingZonesSchema, LZ_LIVE_LINK_CATALOGUE_NOTICE, lzLinkedLandingZones, seedCatalogueTargetsForApp, type LzCatalogueSeedSource, type SwaoYmlLzRegistration } from '@swao/core';

/** landing_zones[] of the workspace .swao.yml (empty when none or unreadable). */
function readLandingZones(workspace: string | null): SwaoYmlLzRegistration[] {
  if (!workspace) return [];
  const file = join(workspace, '.swao.yml');
  if (!existsSync(file)) return [];
  try {
    const doc = (load(readFileSync(file, 'utf-8')) ?? {}) as Record<string, unknown>;
    const parsed = SwaoYmlLandingZonesSchema.safeParse(doc['landing_zones'] ?? []);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/**
 * #3980, #4244 (every tier since the owner decision 2026-11-09): CLI and TUI
 * parity of the linked-app warning. An app linked in
 * landing_zones[].scopes[].app is assessed against the static catalogue; the
 * TUI LZ step shows the same warning the CLI prints. Null when the app is not
 * linked.
 */
export function linkedAppCatalogueNotice(workspace: string | null, app: string): string | null {
  if (!app) return null;
  const linked = lzLinkedLandingZones(readLandingZones(workspace), app);
  if (linked.length === 0) return null;
  const seed = linkedAppSeedPrefill(workspace, app);
  const from = seed ? `; targets pre-filled from ${seed.from}` : '';
  return `${LZ_LIVE_LINK_CATALOGUE_NOTICE} (linked to ${linked.join(', ')}${from}; live results: Landing Zone Live Assessment). Skip this step for no LZ fit; nothing is then assessed against the catalogue.`;
}

/**
 * #4349: the one short LZ source line of the Target Landing Zone step for a
 * linked app; the full explanation (linkedAppCatalogueNotice) goes into the
 * guidance box.
 */
export function linkedAppCatalogueShortNotice(workspace: string | null, app: string): string | null {
  if (!app) return null;
  const linked = lzLinkedLandingZones(readLandingZones(workspace), app);
  if (linked.length === 0) return null;
  return `Static LZ catalogue; live data only in the LZ Live Assessment (${linked.join(', ')})`;
}

export interface LinkedAppSeedPrefill {
  /** Providers to pre-select in the provider step. */
  providers: string[];
  /** `provider:region` values to pre-select in the region step. */
  targets: string[];
  /** Human-readable source of the seed. */
  from: string;
  /** Seed source, passed as --lz-cat-targets-seeded when the pre-fill is confirmed unedited. */
  source: LzCatalogueSeedSource;
}

/**
 * #3980 seeding: CLI flags of the confirmed target LZ selection. The unedited
 * seeded pre-fill (the seed targets the catalogue offers, no more and no less)
 * adds the internal marker --lz-cat-targets-seeded <source>, so the run records
 * the seed provenance; any edit is an explicit choice (plain --lz-cat-targets).
 */
export function lzCatTargetsArgs(selected: readonly string[], seed: LinkedAppSeedPrefill | null, offered: readonly string[]): string[] {
  if (selected.length === 0) return [];
  const args = ['--lz-cat-targets', selected.join(',')];
  if (!seed) return args;
  const shown = seed.targets.filter((t) => offered.includes(t));
  const unedited = shown.length > 0 && shown.length === new Set(selected).size && shown.every((t) => selected.includes(t));
  return unedited ? [...args, '--lz-cat-targets-seeded', seed.source] : args;
}

/**
 * #3980 seeding (owner decision 2026-11-06), #4244 (every tier): the target LZ
 * step pre-fills the catalogue targets the CLI would seed for a linked app
 * (seedCatalogueTargetsForApp, @swao/core): the linked scope regions in
 * .swao.yml. Null when the app is not linked or nothing can be seeded.
 */
export function linkedAppSeedPrefill(workspace: string | null, app: string): LinkedAppSeedPrefill | null {
  if (!app || !workspace) return null;
  const seed = seedCatalogueTargetsForApp(readLandingZones(workspace), app);
  if (!seed) return null;
  return {
    providers: [seed.provider],
    targets: seed.regions.map((r) => `${seed.provider}:${r}`),
    from: 'landing_zones[].scopes[].regions',
    source: seed.source,
  };
}
