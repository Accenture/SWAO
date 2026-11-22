// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Landing zone evidence source of an Application Assessment (#3887, Design 123
// section 8.4). Owner decision 2026-11-09 (#4244): live landing-zone data is
// used ONLY by the Landing Zone Live Assessment (`swao assess --type
// landing-zone-live`). Every other assessment type, the Application Assessment
// included, uses the static LZ catalogue. Shared by the CLI (`swao assess --app
// <id>`) and the TUI, which passes the same flags.
//
// Selection, first match wins; no new .swao.yml key and no new config file:
//   1. CLI (the TUI passes its choice as CLI flags): --lz-source catalogue or
//      --lz-cat-targets; --lz-source live, --lz and --scope are refused with a
//      pointer to the LZ Live Assessment (exit 1, before any pass);
//   2. .swao.yml, existing keys only: an app named in landing_zones[].scopes[].app
//      stays on the catalogue; the link is returned (`linked`), so the host
//      shows and records the warning (LZ_LIVE_LINK_CATALOGUE_NOTICE,
//      run-context.yaml lz_source_reason) and may seed the catalogue targets
//      from the linked scope regions in .swao.yml;
//   3. default: catalogue (assessment.landing_zone.targets or --lz-cat-targets).
// The link itself stays: the LZ Live Assessment and its publications use it.

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { SwaoYmlLzRegistration } from './swao-yml.js';

/** Values of run-context.yaml `lz_source`; `live` is kept for the replay of runs before #4244. */
export const LZ_SOURCES = ['catalogue', 'live'] as const;
export type LzSource = (typeof LZ_SOURCES)[number];

export function isLzSource(v: string): v is LzSource {
  return (LZ_SOURCES as readonly string[]).includes(v);
}

/** Where the selection came from (recorded in run-context.yaml). */
export type LzSourceOrigin = 'cli' | 'swao-yml' | 'default';

/** Lead sentence of the #4244 warning; the host appends where the link comes from and the fix. */
const LZ_LIVE_ONLY = 'live landing-zone data is used only by the Landing Zone Live Assessment';

/**
 * #4244 (owner decision 2026-11-09; before: #3980, below Consultant only): the
 * warning of an app linked in landing_zones[].scopes[].app, printed by the CLI
 * and shown by the TUI LZ step on every tier.
 */
export const LZ_LIVE_LINK_CATALOGUE_NOTICE = `${LZ_LIVE_ONLY}; assessed against the static LZ catalogue`;

/** #3980, #4244: the linked app had no configured and no seedable catalogue targets, so no LZ fit ran. */
export const LZ_LIVE_LINK_NO_TARGETS_NOTICE = `${LZ_LIVE_ONLY}; nothing was assessed against the static LZ catalogue`;

/** #3980, #4244: --no-lz-fit (the TUI Esc on the target LZ step) for a linked app. */
export const LZ_LIVE_LINK_NO_LZ_FIT_NOTICE = `${LZ_LIVE_ONLY}; --no-lz-fit: nothing was assessed against the static LZ catalogue`;

/** #4244: the refusal of an explicit live source in an app assessment. */
export const LZ_LIVE_APP_SOURCE_REFUSAL = `--lz-source live is retired for app assessments: ${LZ_LIVE_ONLY} (swao assess --type landing-zone-live --lz <lz-id>); an app assessment uses the static LZ catalogue (--lz-source catalogue, --lz-cat-targets)`;

/** Ids of the landing zones with a scope linked to `appId` (landing_zones[].scopes[].app). */
export function lzLinkedLandingZones(landingZones: readonly SwaoYmlLzRegistration[], appId: string): string[] {
  return landingZones.filter((l) => l.scopes.some((s) => s.app === appId)).map((l) => l.id);
}

/** A landing zone with scopes linked to the app (landing_zones[].scopes[].app). */
export interface LzAppLink {
  lz_id: string;
  provider: string;
  scope_ids: string[];
}

/**
 * The LZ source of an app run: always the static catalogue (#4244). `linked`
 * names the landing zones the app is linked to, where a live source applied
 * before #4244; the host warns and records it. #4321: also with origin `cli`
 * (explicit catalogue targets, the form the TUI passes its confirmed targets
 * in), so a linked app records the notice whichever way the targets came.
 */
export type LzSourceSelection = { source: 'catalogue'; origin: LzSourceOrigin; linked?: LzAppLink[] };

export interface ResolveLzSourceInput {
  appId: string;
  /** --lz-source value as typed. */
  cliSource?: string;
  /** --lz value. */
  cliLz?: string;
  /** --scope values. */
  cliScopes?: readonly string[];
  /** True when --lz-cat-targets or --lz-cat-provider/--lz-cat-region were given (a CLI catalogue choice). */
  cliCatalogueTargets?: boolean;
  /** landing_zones[] of the workspace .swao.yml (already validated). */
  landingZones: readonly SwaoYmlLzRegistration[];
}

export type ResolveLzSourceResult = { ok: true; value: LzSourceSelection } | { ok: false; error: string };

/** Scopes of `lz` linked to `appId` (landing_zones[].scopes[].app). */
function linkedScopes(lz: SwaoYmlLzRegistration, appId: string): string[] {
  return lz.scopes.filter((s) => s.app === appId).map((s) => s.id);
}

/** The landing zones and scopes linked to `appId`. */
export function lzAppLinks(landingZones: readonly SwaoYmlLzRegistration[], appId: string): LzAppLink[] {
  return landingZones
    .map((l) => ({ lz_id: l.id, provider: l.provider, scope_ids: linkedScopes(l, appId) }))
    .filter((l) => l.scope_ids.length > 0);
}

/** Human-readable origin of a link, for the warning: "landing zone otc-prod, scope platform". */
export function describeLzAppLinks(links: readonly LzAppLink[]): string {
  return links.map((l) => `landing zone ${l.lz_id}, scope${l.scope_ids.length > 1 ? 's' : ''} ${l.scope_ids.join(', ')}`).join('; ');
}

/**
 * Resolve the LZ evidence source of an app run (Design 123 section 8.4, #4244).
 * Pure; the refusals are decided before any pass runs.
 */
export function resolveLzSource(input: ResolveLzSourceInput): ResolveLzSourceResult {
  const { appId, cliSource, cliLz, landingZones } = input;
  const cliScopes = [...(input.cliScopes ?? [])];
  if (cliSource !== undefined && !isLzSource(cliSource)) {
    return { ok: false, error: `--lz-source must be catalogue, not "${cliSource}" (${LZ_LIVE_ONLY}: swao assess --type landing-zone-live --lz <lz-id>)` };
  }
  if (cliSource === 'live') return { ok: false, error: LZ_LIVE_APP_SOURCE_REFUSAL };
  if (cliLz !== undefined || cliScopes.length > 0) {
    return { ok: false, error: `--lz and --scope select a live landing zone for swao assess --type landing-zone-live; ${LZ_LIVE_ONLY}, an app assessment uses the static LZ catalogue` };
  }
  const linked = lzAppLinks(landingZones, appId);
  if (cliSource === 'catalogue' || input.cliCatalogueTargets) {
    return { ok: true, value: { source: 'catalogue', origin: 'cli', ...(linked.length > 0 ? { linked } : {}) } };
  }
  if (linked.length > 0) return { ok: true, value: { source: 'catalogue', origin: 'swao-yml', linked } };
  return { ok: true, value: { source: 'catalogue', origin: 'default' } };
}

const RUN_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;

/** Run folder ids of a landing zone's live runs, newest first (Design 120 section 7.4). */
export function listLzLiveRunIds(workspaceRoot: string, lzId: string): string[] {
  const dir = join(workspaceRoot, 'landing-zones', lzId, 'wsp', 'runs');
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter((r) => RUN_ID_RE.test(r)).sort().reverse();
  } catch {
    return [];
  }
}

/** CLI flags of a catalogue target choice (the TUI passes its choice this way, CLI and TUI parity). */
export function lzSourceCliArgs(choice: { source: 'catalogue'; targets: readonly string[] }): string[] {
  return choice.targets.length > 0 ? ['--lz-source', 'catalogue', '--lz-cat-targets', choice.targets.join(',')] : ['--no-lz-fit'];
}

// ---------------------------------------------------------------------------
// #3980 seeding (owner decision 2026-11-06), narrowed by #4244 (owner decision
// 2026-11-09): the catalogue targets of a linked app when none are configured,
// from the linked scope regions in .swao.yml only. A live run is never read
// (live landing-zone data is used only by the LZ Live Assessment). Shared by the
// CLI (assess.ts) and the TUI target LZ step, so both seed the same targets.
// ---------------------------------------------------------------------------

/**
 * Where seeded catalogue targets came from (recorded in run-context.yaml).
 * `live-run-regions-in-use` is no longer produced (#4244); it stays for the
 * replay of runs before it.
 */
export const LZ_CATALOGUE_SEED_SOURCES = ['swao-yml-scope-regions', 'live-run-regions-in-use'] as const;
export type LzCatalogueSeedSource = (typeof LZ_CATALOGUE_SEED_SOURCES)[number];

export function isLzCatalogueSeedSource(v: string): v is LzCatalogueSeedSource {
  return (LZ_CATALOGUE_SEED_SOURCES as readonly string[]).includes(v);
}

export interface LzCatalogueSeed {
  provider: string;
  /** Region ids, sorted and unique. */
  regions: string[];
  source: LzCatalogueSeedSource;
  /** The live run read for `live-run-regions-in-use` (runs before #4244). */
  run_id?: string;
}

/**
 * Seed catalogue targets for an app linked to `lz` (scopes `scopeIds`): the
 * `landing_zones[].scopes[].regions` of the linked scopes in .swao.yml, the
 * operator's declaration. Null when they name no region (#4244: the regions in
 * use of a live run are no longer read).
 */
export function seedLinkedCatalogueTargets(
  lz: SwaoYmlLzRegistration,
  scopeIds: readonly string[],
): LzCatalogueSeed | null {
  const linked = lz.scopes.filter((s) => scopeIds.includes(s.id));
  const declared = [...new Set(linked.flatMap((s) => s.regions ?? []))].sort();
  return declared.length > 0 ? { provider: lz.provider, regions: declared, source: 'swao-yml-scope-regions' } : null;
}

/** The seed of an app linked to exactly one landing zone of `landingZones` (null when not linked, linked to several, or no seed). */
export function seedCatalogueTargetsForApp(
  landingZones: readonly SwaoYmlLzRegistration[],
  appId: string,
): (LzCatalogueSeed & { lz_id: string }) | null {
  const linked = lzAppLinks(landingZones, appId);
  if (linked.length !== 1) return null;
  const link = linked[0]!;
  const lz = landingZones.find((l) => l.id === link.lz_id);
  const seed = lz ? seedLinkedCatalogueTargets(lz, link.scope_ids) : null;
  return seed ? { ...seed, lz_id: link.lz_id } : null;
}
