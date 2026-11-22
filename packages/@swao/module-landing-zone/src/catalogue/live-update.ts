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

// #3582: Update LZ Catalogue from a live run (Design 120 section 10.2).
//
//   swao lz catalogue update --provider <p> --source live --lz <lz-id> [--run <ts>] [--dry-run]
//   swao lz catalogue update --new <slug>   --source live --lz <lz-id> [--run <ts>] [--dry-run]
//
// Order of checks, so a refused run writes nothing (Design 121 section 10,
// item 4): run folder resolved; simulated run refused (exit 1); write target
// refused when it is a bundled catalogue folder (bundled product catalogues
// stay maintainer-PR only); base catalogue resolved; `manual` base skipped
// (Q-30); merge; schema parse and quality rules on a temporary copy; then,
// and only without --dry-run, seed the empty workspace tier and write.
//
// Merge rules (section 10.2):
//   - regions, services, capability tags (`fulfills`) and IaC blocks the live
//     catalogue has and the base lacks are added; nothing the base has is
//     removed or changed (catalogue lifecycle status is not tenant state);
//   - no retired-service merge: a base service absent from the live data is
//     only listed in the diff (a gap in live data is usually permission or
//     scope, not retirement);
//   - confidence stays or is lowered, never raised (`operator-declared`
//     stays as it is);
//   - a service matches on `code`, or on `canonical_code` against the base
//     `code` / `canonical_code` (the live catalogue keeps the native driver
//     code as `canonical_code` when it maps to a catalogue code, #3581).

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { parseLzCatalogue, safeParseLzCatalogue } from '@swao/core';
import type { LzRegion, LzService, LzServiceCatalogue } from '@swao/core';
import { assertLzLiveRunNotSimulated } from '../live/simulation.js';
import { LZ_LIVE_CATALOGUE_FILE } from '../live/live-catalogue.js';
import { checkLzCatalogueQuality, discoverLzCatalogues, isLzCataloguesDir, resolveBundledLzCataloguesDir } from './loader.js';
import { formatLzQualityFindings, isLzProviderCatalogueFile } from './quality.js';

export class LzLiveCatalogueUpdateError extends Error {
  constructor(message: string, readonly exitCode = 1) {
    super(`[lz catalogue update] ${message}`);
    this.name = 'LzLiveCatalogueUpdateError';
  }
}

/** Slug rule for `--new` (077 section 3). */
export const LZ_NEW_CATALOGUE_SLUG_RE = /^[a-z][a-z0-9-]{1,40}$/;

const LZ_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RUN_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;

/** `source.mode: manual` files are hand-maintained and never written by any update (077 D-077-04, Q-30). */
export function isManualCatalogueFile(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as { meta?: { source?: { mode?: unknown } } };
    return raw.meta?.source?.mode === 'manual';
  } catch {
    return false;
  }
}

/**
 * The live run folder of a landing zone holding `lz-live-catalogue.json`:
 * `--run <ts>`, else `latest-lz-live.txt`, else the newest such folder.
 */
export function resolveLzLiveCatalogueRun(workspaceRoot: string, lzId: string, runTs?: string): string {
  if (!LZ_ID_RE.test(lzId)) throw new LzLiveCatalogueUpdateError(`--lz: landing zone id '${lzId}' must be kebab-case`);
  const wsp = join(workspaceRoot, 'landing-zones', lzId, 'wsp');
  const runs = join(wsp, 'runs');
  const holds = (name: string): boolean => existsSync(join(runs, name, LZ_LIVE_CATALOGUE_FILE));
  const pick = (name: string, what: string): string => {
    if (!RUN_SEGMENT_RE.test(name)) throw new LzLiveCatalogueUpdateError(`${what} '${name}' is not a run folder name`);
    if (!holds(name)) throw new LzLiveCatalogueUpdateError(`run '${name}' of landing zone ${lzId} holds no ${LZ_LIVE_CATALOGUE_FILE}`);
    return join(runs, name);
  };
  if (runTs) return pick(runTs.replace(/:/g, '-').replace(/\.\d{1,9}Z?$|Z$/, ''), '--run');
  const ptr = join(wsp, 'latest-lz-live.txt');
  if (existsSync(ptr)) {
    const name = readFileSync(ptr, 'utf-8').trim();
    if (name) return pick(name, 'latest-lz-live.txt entry');
  }
  const all = existsSync(runs) ? readdirSync(runs).filter((r) => RUN_SEGMENT_RE.test(r) && holds(r)).sort().reverse() : [];
  if (all.length === 0) throw new LzLiveCatalogueUpdateError(`no live run of landing zone ${lzId} with ${LZ_LIVE_CATALOGUE_FILE}; run swao assess --type landing-zone-live --lz ${lzId} first`);
  return join(runs, all[0] as string);
}

// ---------------------------------------------------------------------------
// Merge and diff (pure)
// ---------------------------------------------------------------------------

export interface LiveCatalogueDiff {
  regions_added: string[];
  services_added: Array<{ region: string; code: string }>;
  tags_added: Array<{ region: string; code: string; tags: string[] }>;
  iac_added: Array<{ region: string; code: string; level: string }>;
  /** Base services not in the live data: reported only, never retired. */
  services_absent: Array<{ region: string; code: string }>;
  confidence: { from: string; to: string };
}

const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

/** Lower or keep, never raise; `operator-declared` is kept as declared. */
export function mergedConfidence(base: string, live: string): string {
  const b = CONFIDENCE_RANK[base];
  const l = CONFIDENCE_RANK[live];
  if (b === undefined || l === undefined) return base;
  return l < b ? live : base;
}

function sameService(base: LzService, live: LzService): boolean {
  if (base.code === live.code) return true;
  if (live.canonical_code !== undefined && (live.canonical_code === base.code || live.canonical_code === base.canonical_code)) return true;
  return base.canonical_code !== undefined && base.canonical_code === live.code;
}

export interface MergeLiveCatalogueOptions {
  base: LzServiceCatalogue;
  live: LzServiceCatalogue;
  today: string;
  /** Provenance appended to meta.source.source_note. */
  provenance: string;
}

export function mergeLiveIntoCatalogue(opts: MergeLiveCatalogueOptions): { catalogue: LzServiceCatalogue; diff: LiveCatalogueDiff } {
  const out = JSON.parse(JSON.stringify(opts.base)) as LzServiceCatalogue;
  const diff: LiveCatalogueDiff = { regions_added: [], services_added: [], tags_added: [], iac_added: [], services_absent: [], confidence: { from: out.meta.confidence, to: out.meta.confidence } };
  let usesSchema02 = false;
  for (const liveRegion of opts.live.regions) {
    const region = out.regions.find((r) => r.id === liveRegion.id);
    if (!region) {
      const added: LzRegion = JSON.parse(JSON.stringify(liveRegion)) as LzRegion;
      out.regions.push(added);
      diff.regions_added.push(added.id);
      for (const s of added.services) {
        diff.services_added.push({ region: added.id, code: s.code });
        if (s.iac || s.canonical_code) usesSchema02 = true;
      }
      continue;
    }
    for (const liveSvc of liveRegion.services) {
      const svc = region.services.find((s) => sameService(s, liveSvc));
      if (!svc) {
        region.services.push(JSON.parse(JSON.stringify(liveSvc)) as LzService);
        diff.services_added.push({ region: region.id, code: liveSvc.code });
        if (liveSvc.iac || liveSvc.canonical_code) usesSchema02 = true;
        continue;
      }
      const newTags = liveSvc.fulfills.filter((t) => !svc.fulfills.includes(t));
      if (newTags.length > 0) {
        svc.fulfills = [...svc.fulfills, ...newTags];
        diff.tags_added.push({ region: region.id, code: svc.code, tags: newTags });
      }
      if (!svc.iac && liveSvc.iac) {
        svc.iac = JSON.parse(JSON.stringify(liveSvc.iac)) as NonNullable<LzService['iac']>;
        diff.iac_added.push({ region: region.id, code: svc.code, level: liveSvc.iac.level });
        usesSchema02 = true;
      }
    }
    for (const s of region.services) {
      if (s.status === 'retired') continue;
      if (!liveRegion.services.some((l) => sameService(s, l))) diff.services_absent.push({ region: region.id, code: s.code });
    }
  }
  out.meta.confidence = mergedConfidence(out.meta.confidence, opts.live.meta.confidence) as LzServiceCatalogue['meta']['confidence'];
  diff.confidence.to = out.meta.confidence;
  out.meta.last_updated = opts.today;
  if (usesSchema02 && out.meta.schema_version === '0.1') out.meta.schema_version = '0.2';
  out.meta.regions_count = out.regions.length;
  const note = out.meta.source.source_note ? `${out.meta.source.source_note} ` : '';
  out.meta.source = { ...out.meta.source, source_note: `${note}${opts.provenance}` };
  return { catalogue: parseLzCatalogue(out), diff };
}

/** An empty base for `--new <slug>` (shape of lz-catalogues/_lz-catalogue-template.json, 077). */
export function newCatalogueBase(slug: string, live: LzServiceCatalogue, today: string): LzServiceCatalogue {
  return parseLzCatalogue({
    meta: {
      schema_version: '0.2',
      name: `${slug} service catalogue`,
      provider: slug,
      last_updated: today,
      source: { mode: 'live-api', tool: live.meta.source.tool ?? 'swao lz catalogue update --source live', operator: 'SWAO live LZ assessment' },
      confidence: live.meta.confidence,
      regions_count: 0,
    },
    regions: [],
  });
}

export function formatLiveCatalogueDiff(provider: string, d: LiveCatalogueDiff): string[] {
  const lines = [`${provider}: ${d.regions_added.length} region(s), ${d.services_added.length} service(s), ${d.tags_added.length} capability tag change(s) and ${d.iac_added.length} IaC block(s) added; ${d.services_absent.length} service(s) absent in the live data (listed only, not retired); confidence ${d.confidence.from}${d.confidence.to !== d.confidence.from ? ` lowered to ${d.confidence.to}` : ' kept'}`];
  for (const r of d.regions_added) lines.push(`  + region ${r}`);
  for (const s of d.services_added) lines.push(`  + service ${s.code} in ${s.region}`);
  for (const t of d.tags_added) lines.push(`  + tags ${t.tags.join(', ')} on ${t.code} in ${t.region}`);
  for (const i of d.iac_added) lines.push(`  + IaC ${i.level} on ${i.code} in ${i.region}`);
  for (const a of d.services_absent) lines.push(`  ? absent in the live data: ${a.code} in ${a.region} (unchanged)`);
  return lines;
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export interface LiveCatalogueUpdateOptions {
  workspaceRoot: string;
  lzId: string;
  run?: string;
  /** Provider catalogue to update (`--provider`). */
  provider?: string;
  /** New catalogue slug (`--new`). */
  newSlug?: string;
  /** Output folder (`--catalogues-dir`), default <ws>/wsp/inputs/catalogs/lz-catalogues. */
  cataloguesDir?: string;
  dryRun?: boolean;
  today?: string;
  /** Bundled catalogue folder (tests); default resolveBundledLzCataloguesDir(). */
  bundledDir?: string | null;
  out: (line: string) => void;
}

export interface LiveCatalogueUpdateOutcome {
  provider: string;
  /** Catalogue folder written to (the price table sits in its prices/ subfolder). */
  dir: string;
  file: string;
  written: boolean;
  seeded: string[];
  diff: LiveCatalogueDiff;
}

function isInside(child: string, parent: string): boolean {
  const c = resolve(child).toLowerCase();
  const p = resolve(parent).toLowerCase();
  return c === p || c.startsWith(p + sep) || c.startsWith(p + '/');
}

/** Bundled product catalogues are maintainer-PR only (section 10.2): never a write target. */
function assertNotBundledTarget(dir: string, bundledDir: string | null): void {
  if (bundledDir && isInside(dir, bundledDir)) {
    throw new LzLiveCatalogueUpdateError(`refusing to write into the bundled catalogue folder ${bundledDir}; bundled catalogues change by maintainer PR only. Use the workspace tier (default) or another --catalogues-dir.`);
  }
}

export function runLiveCatalogueUpdate(opts: LiveCatalogueUpdateOptions): LiveCatalogueUpdateOutcome {
  const { out } = opts;
  if (!opts.provider && !opts.newSlug) throw new LzLiveCatalogueUpdateError('--source live needs --provider <p> or --new <slug>');
  if (opts.newSlug !== undefined && !LZ_NEW_CATALOGUE_SLUG_RE.test(opts.newSlug)) {
    throw new LzLiveCatalogueUpdateError(`--new: slug '${opts.newSlug}' must match ${LZ_NEW_CATALOGUE_SLUG_RE.source}`);
  }
  const runDir = resolveLzLiveCatalogueRun(opts.workspaceRoot, opts.lzId, opts.run);
  // Design 121 section 10, item 4: simulated data never reaches a catalogue file.
  assertLzLiveRunNotSimulated(runDir);

  const bundledDir = opts.bundledDir === undefined ? resolveBundledLzCataloguesDir() : opts.bundledDir;
  const dir = resolve(opts.cataloguesDir ?? join(opts.workspaceRoot, 'wsp', 'inputs', 'catalogs', 'lz-catalogues'));
  assertNotBundledTarget(dir, bundledDir);

  let live: LzServiceCatalogue;
  try {
    live = parseLzCatalogue(JSON.parse(readFileSync(join(runDir, LZ_LIVE_CATALOGUE_FILE), 'utf-8')));
  } catch (err) {
    throw new LzLiveCatalogueUpdateError(`${join(runDir, LZ_LIVE_CATALOGUE_FILE)} is not a valid LZ catalogue: ${(err as Error).message}`);
  }
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const runId = runDir.split(/[\\/]/).pop() ?? '';
  const provenance = `Updated ${today} from the live run ${runId} of landing zone ${opts.lzId} (swao lz catalogue update --source live, Design 120 section 10.2): additions only, absent services not retired, confidence never raised.`;

  const bundledProviders = bundledDir ? discoverLzCatalogues(bundledDir).map((c) => c.provider) : [];
  let provider: string;
  let base: LzServiceCatalogue;
  let target: string;
  if (opts.newSlug !== undefined) {
    provider = opts.newSlug;
    const existing = [join(dir, `${provider}.json`), join(dir, provider, 'index.json')].find((p) => existsSync(p));
    if (existing || bundledProviders.includes(provider)) {
      throw new LzLiveCatalogueUpdateError(`--new ${provider}: a catalogue for ${provider} exists already (${existing ?? 'bundled'}); use --provider ${provider} --source live to update it`);
    }
    base = newCatalogueBase(provider, live, today);
    target = join(dir, `${provider}.json`);
  } else {
    provider = opts.provider as string;
    if (live.meta.provider !== provider) {
      throw new LzLiveCatalogueUpdateError(`landing zone ${opts.lzId} is a ${live.meta.provider} landing zone; it cannot update the ${provider} catalogue`);
    }
    const workspaceFile = [join(dir, provider, 'index.json'), join(dir, `${provider}.json`)].find((p) => existsSync(p));
    target = workspaceFile ?? join(dir, `${provider}.json`);
    const baseFile = workspaceFile ?? (bundledDir ? join(bundledDir, `${provider}.json`) : undefined);
    if (!baseFile || !existsSync(baseFile)) {
      throw new LzLiveCatalogueUpdateError(`no ${provider} catalogue to update; use --new ${provider} --source live to build one`);
    }
    if (isManualCatalogueFile(baseFile)) {
      out(`${provider}: source.mode "manual" (hand-maintained, Q-30), skipped; ${baseFile} is left untouched`);
      return { provider, dir, file: baseFile, written: false, seeded: [], diff: { regions_added: [], services_added: [], tags_added: [], iac_added: [], services_absent: [], confidence: { from: '', to: '' } } };
    }
    const r = safeParseLzCatalogue(JSON.parse(readFileSync(baseFile, 'utf-8')));
    if (!r.ok) throw new LzLiveCatalogueUpdateError(`${baseFile} is not a valid LZ catalogue: ${r.issues.join('; ')}`);
    base = r.catalogue;
  }

  const { catalogue, diff } = mergeLiveIntoCatalogue({ base, live, today, provenance });
  for (const l of formatLiveCatalogueDiff(provider, diff)) out(l);

  // Quality rules on a temporary copy named <provider>.json (section 10.1 finding 3).
  const tmp = mkdtempSync(join(tmpdir(), 'swao-lz-live-update-'));
  try {
    writeFileSync(join(tmp, `${provider}.json`), JSON.stringify(catalogue, null, 2) + '\n');
    const templateFile = bundledDir ? join(bundledDir, '_lz-catalogue-template.json') : undefined;
    const report = checkLzCatalogueQuality(tmp, { overlay: true, ...(templateFile && existsSync(templateFile) ? { templateFile } : {}) });
    if (report.errors > 0) {
      for (const l of formatLzQualityFindings(report.findings.filter((f) => f.severity === 'error'))) out(`  quality: ${l}`);
      throw new LzLiveCatalogueUpdateError(`the updated ${provider} catalogue fails ${report.errors} quality rule(s); nothing written`);
    }
    if (report.warnings > 0) out(`  quality: ${report.warnings} warning(s) (for example facts-unsourced for regions without sovereignty facts; declare them)`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (opts.dryRun) {
    out(`  [dry-run] would write: ${target}`);
    if (!isLzCataloguesDir(dir) && bundledDir) out(`  [dry-run] would seed ${dir} with the bundled catalogues first`);
    return { provider, dir, file: target, written: false, seeded: [], diff };
  }

  // Seeding (section 10.2): an empty workspace tier gets the bundled catalogues
  // first, so one new file cannot hide every bundled provider.
  const seeded: string[] = [];
  if (!isLzCataloguesDir(dir) && bundledDir) {
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(bundledDir)) {
      if (!isLzProviderCatalogueFile(name) || name === `${provider}.json`) continue;
      copyFileSync(join(bundledDir, name), join(dir, name));
      seeded.push(name);
    }
    out(`  seeded ${dir} with ${seeded.length} bundled catalogue(s)`);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(target, JSON.stringify(catalogue, null, 2) + '\n', 'utf-8');
  out(`  written: ${target}`);
  return { provider, dir, file: target, written: true, seeded, diff };
}
