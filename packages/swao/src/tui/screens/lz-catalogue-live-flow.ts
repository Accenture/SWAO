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

// #3589: the "Source: Live landing zone catalogue" branch of Tools > Update LZ
// Catalogue (Design 120 sections 10.2, 14.2). Pure helpers, so the screen and
// its tests share them; the screen runs the CLI of #3582:
//   select LZ + run -> swao lz catalogue update --provider <p> --source live
//                      --lz <lz-id> [--run <ts>] --dry-run   (the diff)
//                   -> the same without --dry-run              (write)
//   or new file     -> swao lz catalogue update --new <slug> --source live
//                      --lz <lz-id> [--run <ts>] [--dry-run]

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { SwaoYmlLandingZonesSchema } from '@swao/core';

/** File every live run writes (module-landing-zone LZ_LIVE_CATALOGUE_FILE, Design 120 section 10.1). */
export const LIVE_CATALOGUE_FILE = 'lz-live-catalogue.json';
/** The 077 section 3 slug rule (module-landing-zone LZ_NEW_CATALOGUE_SLUG_RE). */
export const NEW_CATALOGUE_SLUG_RE = /^[a-z][a-z0-9-]{1,40}$/;

export const CATALOGUE_SOURCES = [
  { key: '1', id: 'internet', label: 'Source: Internet sources', detail: 'public CSP sources (existing)' },
  { key: '2', id: 'live', label: 'Source: Live landing zone catalogue', detail: 'update the provider catalogue from a live run' },
  { key: '3', id: 'live-new', label: 'Source: Live landing zone catalogue, build a new catalogue file', detail: 'for a CSP or private cloud without one' },
] as const;
export type CatalogueSource = (typeof CATALOGUE_SOURCES)[number]['id'];

export interface LiveCatalogueLz {
  id: string;
  provider: string;
  display?: string;
}

/** Landing zones registered in the workspace .swao.yml (empty when none or invalid). */
export function listLiveCatalogueLandingZones(workspace: string | null): LiveCatalogueLz[] {
  if (!workspace) return [];
  try {
    const doc = (loadYaml(readFileSync(join(workspace, '.swao.yml'), 'utf-8')) ?? {}) as Record<string, unknown>;
    const r = SwaoYmlLandingZonesSchema.safeParse(doc['landing_zones'] ?? []);
    return r.success ? r.data.map((l) => ({ id: l.id, provider: l.provider, ...(l.display ? { display: l.display } : {}) })) : [];
  } catch {
    return [];
  }
}

/** Runs of a landing zone that hold a live LZ catalogue, newest first. */
export function listLiveCatalogueRuns(workspace: string, lzId: string): string[] {
  const runs = join(workspace, 'landing-zones', lzId, 'wsp', 'runs');
  if (!existsSync(runs)) return [];
  try {
    return readdirSync(runs).filter((r) => existsSync(join(runs, r, LIVE_CATALOGUE_FILE))).sort().reverse();
  } catch {
    return [];
  }
}

export interface LiveUpdateChoice {
  lzId: string;
  provider: string;
  /** Run folder name; undefined = the latest run (latest-lz-live.txt). */
  run?: string;
  /** Build a new catalogue file instead of updating the provider's. */
  newSlug?: string;
  dryRun: boolean;
}

export function buildLiveCatalogueUpdateArgs(c: LiveUpdateChoice): string[] {
  const args = ['lz', 'catalogue', 'update'];
  if (c.newSlug !== undefined) args.push('--new', c.newSlug);
  else args.push('--provider', c.provider);
  args.push('--source', 'live', '--lz', c.lzId);
  if (c.run) args.push('--run', c.run);
  if (c.dryRun) args.push('--dry-run');
  return args;
}

/** A dry run that can be written: exit 0 and the CLI named a write target (not a manual skip). */
export function dryRunWritable(exitCode: number, lines: readonly string[]): boolean {
  return exitCode === 0 && lines.some((l) => /\[dry-run\] would write:/.test(l));
}

export function validateNewSlug(slug: string): string | null {
  return NEW_CATALOGUE_SLUG_RE.test(slug) ? null : 'catalogue slug must match ^[a-z][a-z0-9-]{1,40}$ (077 section 3), for example private-cloud-dc1';
}
