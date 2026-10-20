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

// #3282: LZ catalogue quality rules -- the single rule engine behind the
// health-check LZ catalogue probe and the audit gate
// tests/audit-gates/lz-catalogue-quality.gate.mjs.
//
// The SWAO team owns swao/lz-catalogues/ (one JSON per provider,
// _lz-catalogue-template.json, _coming-soon.json, *-service-meta.json). These
// rules keep each file consistent with the template, with its own meta block
// and with the refresh overlay pins (catalogue/sovereignty-pins.ts), and flag
// data that is old or unsourced. #3298 (Design 110 E-24): there is no
// index.json; the catalogue list is built from each file's meta block, so the
// former index consistency rules are gone.
//
// This file must stay free of relative runtime imports and of non-erasable
// TypeScript syntax (no enums, namespaces or parameter properties): the audit
// gate imports it with Node's TypeScript type stripping on a source-only
// checkout, where no dist/ exists. Schema validation and the pins are
// therefore injected by the caller.

import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs';
import { join } from 'node:path';

/** Default age threshold for `meta.last_updated` (proposal in #3282; owner may tune). */
export const LZ_CATALOGUE_MAX_AGE_DAYS = 90;

/** Fixed confidence vocabulary (`LzCatalogueMetaSchema.confidence`). */
export const LZ_CATALOGUE_CONFIDENCE_VOCABULARY: readonly string[] = ['high', 'medium', 'low'];

/** The four D-LZ-07 sovereignty fact fields every region must carry. */
export const LZ_SOVEREIGNTY_FACT_FIELDS: readonly string[] = [
  'residency_country',
  'operator_jurisdiction',
  'extraterritorial_exposure',
  'certifications',
];

/** Placeholder residency written by the refresh for regions without an overlay pin. */
export const LZ_UNKNOWN_RESIDENCY = 'UNKNOWN';

/**
 * #3287 (Design 110 D-20): explicit residency of an operator-site region, where
 * the customer chooses the site (azure-local). Valid only with
 * `operator_jurisdiction: operator-site`; the region belongs to no geography.
 * Mirrors the documented value in @swao/core lz-service-catalogue.ts.
 */
export const LZ_OPERATOR_SITE_RESIDENCY = 'OPERATOR_SITE';

/** Operator jurisdiction value that marks a customer-site region. */
export const LZ_OPERATOR_SITE_JURISDICTION = 'operator-site';

/**
 * #3287 (Design 110 D-21): certification vocabulary of the template
 * (`_lz-catalogue-template.json` certifications comment). A value outside it
 * is reported by the certification-vocabulary rule.
 */
export const LZ_CERTIFICATION_VOCABULARY: readonly string[] = [
  'BSI_C5', 'ISO_27001', 'SOC_2', 'TISAX_L3', 'PCI_DSS', 'FedRAMP_High', 'MAS_TRM', 'IRAP',
];

/** Template file name next to the catalogues. */
export const LZ_CATALOGUE_TEMPLATE_FILE = '_lz-catalogue-template.json';

/**
 * #3288 (Design 110 D-23): VM price table of the service cost model, next to
 * the catalogues (mirrors VM_PRICE_TABLE_FILE in @swao/core; this file keeps
 * no imports). The prices folder has no index.json, so the catalogue
 * discovery never reads it as a per-provider catalogue copy.
 */
export const LZ_PRICE_TABLE_FILE = 'prices/vm-prices.json';

/** `info` (#3281) reports a resolution, never a defect; it does not count as a warning. */
export type LzQualitySeverity = 'error' | 'warn' | 'info';

export type LzQualityRuleId =
  | 'template-invalid'
  | 'catalogue-schema'
  | 'provider-filename'
  | 'meta-fields'
  | 'regions-count'
  | 'region-id-duplicate'
  | 'sovereignty-shape'
  | 'confidence-vocabulary'
  | 'certification-vocabulary'
  | 'source-missing'
  | 'date-format'
  | 'stale'
  | 'services-empty'
  | 'service-code-duplicate'
  | 'pin-drift'
  | 'facts-unsourced'
  | 'geography-coverage'
  | 'price-table'
  | 'target-invalid'
  | 'target-geography';

export interface LzQualityRule {
  id: LzQualityRuleId;
  severity: LzQualitySeverity;
  /** One-line description; the health-check docs (EN + DE) list the same rules. */
  summary: string;
}

/** Every rule the engine applies. Errors fail the audit gate; warnings are reported. */
export const LZ_CATALOGUE_QUALITY_RULES: readonly LzQualityRule[] = [
  { id: 'template-invalid', severity: 'error', summary: '_lz-catalogue-template.json exists and, without its _comment keys, passes the catalogue schema' },
  { id: 'catalogue-schema', severity: 'error', summary: 'the catalogue directory is readable, and every catalogue file is valid JSON and passes the catalogue schema (file and reason named, never skipped)' },
  { id: 'provider-filename', severity: 'error', summary: 'meta.provider matches the file name (<provider>.json)' },
  { id: 'meta-fields', severity: 'error', summary: 'the meta block carries exactly the meta field set of _lz-catalogue-template.json' },
  { id: 'regions-count', severity: 'error', summary: 'meta.regions_count equals the number of regions' },
  { id: 'region-id-duplicate', severity: 'error', summary: 'region ids are unique within a provider catalogue' },
  { id: 'sovereignty-shape', severity: 'error', summary: 'every region carries all four sovereignty facts (residency_country, operator_jurisdiction, extraterritorial_exposure, certifications); an operator-site region states residency_country OPERATOR_SITE, which is valid only with operator_jurisdiction operator-site' },
  { id: 'confidence-vocabulary', severity: 'error', summary: 'meta.confidence is one of high, medium, low' },
  { id: 'certification-vocabulary', severity: 'warn', summary: `every region certification is in the template vocabulary (${LZ_CERTIFICATION_VOCABULARY.join(', ')})` },
  { id: 'source-missing', severity: 'error', summary: 'every catalogue names a source (meta.source.mode)' },
  { id: 'date-format', severity: 'error', summary: 'meta.last_updated is a valid YYYY-MM-DD date' },
  { id: 'stale', severity: 'warn', summary: `last_updated (or generated_at of *-service-meta.json) is older than the age threshold (default ${LZ_CATALOGUE_MAX_AGE_DAYS} days)` },
  { id: 'services-empty', severity: 'warn', summary: 'a region lists no services' },
  { id: 'service-code-duplicate', severity: 'warn', summary: 'a service code appears more than once in one region' },
  { id: 'pin-drift', severity: 'warn', summary: 'sovereignty facts differ from the refresh overlay pin for that region (#1382 pattern)' },
  { id: 'facts-unsourced', severity: 'warn', summary: 'sovereignty facts carry no source: UNKNOWN residency placeholder, or no overlay pin and no meta.source.source_note' },
  { id: 'geography-coverage', severity: 'error', summary: 'every region with a residency country is tagged by the shared geography model (#3281): a residency country outside the model is an error, as is a catalogue with no tagged region unless all its regions are operator-site regions (residency_country OPERATOR_SITE)' },
  { id: 'price-table', severity: 'error', summary: `the VM price table ${LZ_PRICE_TABLE_FILE} (#3288), when present, is valid JSON and passes the price table schema: every price names provider, size, OS (linux or windows), region, currency and a positive hourly price, and every provider region has a source with API, URL and retrieval date; its generated_at is subject to the age rule` },
  { id: 'target-invalid', severity: 'warn', summary: 'a configured LZ target in .swao.yml (assessment.landing_zone.provider/region or targets) names an unknown provider or region; the valid-region hint is given' },
  { id: 'target-geography', severity: 'info', summary: 'a configured LZ target names a known geography (for example azure:Europe) instead of a region id; it resolves to the documented default region, which is named (#3281)' },
];

export interface LzCatalogueQualityFinding {
  rule: LzQualityRuleId;
  severity: LzQualitySeverity;
  /** File the finding is about (base name inside the checked directory, or a .swao.yml path). */
  file: string;
  provider?: string;
  region?: string;
  message: string;
}

/** Pinned sovereignty facts for one region (structurally LzSovereigntyPin). */
export interface LzQualityPin {
  residency_country: string;
  operator_jurisdiction: string;
  extraterritorial_exposure: string[];
  certifications: string[];
}

/** Schema validator: returns issue messages; an empty array means valid. */
export type LzCatalogueValidator = (raw: unknown) => string[];

export interface LzCatalogueQualityOptions {
  /** Catalogue schema validator (callers inject `safeParseLzCatalogue` from @swao/core). */
  validate: LzCatalogueValidator;
  /** Refresh overlay pins per provider id (`LZ_SOVEREIGNTY_PINS`). */
  pins?: Record<string, Record<string, LzQualityPin>>;
  /** Clock for the age rule (tests inject a fixed date). */
  now?: Date;
  /** Age threshold in days (default LZ_CATALOGUE_MAX_AGE_DAYS). */
  maxAgeDays?: number;
  /**
   * Workspace overlay folder (`swao lz catalogue update` writes only the
   * refreshed provider files; the rest resolve from the bundle per provider,
   * #1437). Overlay mode reads the template from `templateFile` when the
   * folder has none and does not require a template of its own.
   */
  overlay?: boolean;
  /** Template to use when the checked folder has no _lz-catalogue-template.json (overlay mode). */
  templateFile?: string;
  /**
   * #3288: VM price table validator (callers inject `safeParseVmPriceTable`
   * from @swao/core). Without it the price-table rule checks JSON and dates only.
   */
  validatePriceTable?: LzCatalogueValidator;
  /**
   * #3281: shared geography model, geography id -> residency countries
   * (`LZ_GEOGRAPHY_COUNTRIES` from ./geographies.ts, injected so this file
   * keeps no local imports). Without it the geography-coverage rule is skipped.
   */
  geographies?: Readonly<Record<string, readonly string[]>>;
}

export interface LzCatalogueQualityReport {
  dir: string;
  /** Provider catalogue files checked. */
  catalogues_checked: number;
  /** Number of rules in LZ_CATALOGUE_QUALITY_RULES applied to the directory. */
  rules_checked: number;
  max_age_days: number;
  errors: number;
  warnings: number;
  findings: LzCatalogueQualityFinding[];
}

/**
 * Authoring and metadata files that live next to catalogues but are not
 * provider catalogues (#2327). `index.json` is excluded too: a top-level
 * index.json left in an older workspace (#3298 retired it) is never read.
 */
export function isLzProviderCatalogueFile(name: string): boolean {
  return name.endsWith('.json') && name !== 'index.json' && !name.startsWith('_')
    && !name.endsWith('-template.json') && !name.endsWith('-service-meta.json');
}

/** One catalogue file found by the shared discovery. */
export interface LzCatalogueFileRef {
  provider: string;
  /** Path relative to the scanned directory, forward slashes (`aws.json` or `aws/index.json`). */
  file: string;
  /** Absolute path. */
  path: string;
}

/**
 * #3298 (Design 110 E-24): THE catalogue discovery, shared by the loader (the
 * bundled and every workspace layer, re-exported from loader.ts), the
 * health-check probe and this rule engine (so the audit gate uses it too).
 * Scans one directory for provider catalogue files: `<provider>.json`
 * (skipping `_`-prefixed files, templates, `*-service-meta.json` and a legacy
 * `index.json`) and, unless `flat` is set, `<provider>/index.json`
 * per-provider copies. A subfolder without an index.json (for example
 * `prices/`) is not a catalogue. Sorted by provider; when both layouts exist
 * for one id the per-provider folder is reported, as `resolveProviderCatalogue`
 * reads it first.
 */
export function scanLzCatalogueFiles(dir: string, opts: { flat?: boolean } = {}): LzCatalogueFileRef[] {
  const byProvider = new Map<string, LzCatalogueFileRef>();
  let entries: Dirent[] = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  if (!opts.flat) {
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const p = join(dir, entry.name, 'index.json');
      if (existsSync(p)) byProvider.set(entry.name, { provider: entry.name, file: `${entry.name}/index.json`, path: p });
    }
  }
  for (const entry of entries) {
    if (!entry.isFile() || !isLzProviderCatalogueFile(entry.name)) continue;
    const provider = entry.name.replace(/\.json$/, '');
    if (!byProvider.has(provider)) byProvider.set(provider, { provider, file: entry.name, path: join(dir, entry.name) });
  }
  return [...byProvider.values()].sort((a, b) => a.provider.localeCompare(b.provider));
}

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Parse YYYY-MM-DD as a UTC date; null when the format or the date is invalid. */
export function parseLzDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : d;
}

function ageDays(date: Date, now: Date): number {
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}

function stripComments(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripComments);
  if (!isObject(v)) return v;
  const out: Json = {};
  for (const [k, val] of Object.entries(v)) if (!k.startsWith('_')) out[k] = stripComments(val);
  return out;
}

function sameSet(a: unknown, b: readonly string[]): boolean {
  if (!Array.isArray(a)) return false;
  const sa = [...new Set(a.map(String))].sort();
  const sb = [...new Set(b)].sort();
  return sa.length === sb.length && sa.every((x, i) => x === sb[i]);
}

function readJson(path: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf-8')) as unknown };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Apply every catalogue rule to one LZ catalogue directory (the bundled
 * swao/lz-catalogues/ or a workspace catalogue folder).
 */
export function checkLzCatalogueDir(dir: string, opts: LzCatalogueQualityOptions): LzCatalogueQualityReport {
  const now = opts.now ?? new Date();
  const maxAgeDays = opts.maxAgeDays ?? LZ_CATALOGUE_MAX_AGE_DAYS;
  const pins = opts.pins ?? {};
  const findings: LzCatalogueQualityFinding[] = [];
  const add = (f: Omit<LzCatalogueQualityFinding, 'severity'> & { severity?: LzQualitySeverity }): void => {
    const severity = f.severity ?? LZ_CATALOGUE_QUALITY_RULES.find((r) => r.id === f.rule)?.severity ?? 'error';
    findings.push({ ...f, severity });
  };
  const checkDate = (file: string, field: string, value: unknown, provider?: string): Date | null => {
    const d = parseLzDate(value);
    if (!d) add({ rule: 'date-format', file, provider, message: `${field} "${String(value)}" is not a valid YYYY-MM-DD date` });
    return d;
  };

  let dirEntries: string[] = [];
  try { dirEntries = readdirSync(dir).sort(); } catch (e) {
    add({ rule: 'catalogue-schema', file: dir, message: `catalogue directory unreadable: ${e instanceof Error ? e.message : String(e)}` });
  }

  // --- Template: the reference meta field set ------------------------------
  let templateMetaKeys: string[] | null = null;
  const ownTemplate = join(dir, LZ_CATALOGUE_TEMPLATE_FILE);
  const templatePath = !existsSync(ownTemplate) && opts.overlay && opts.templateFile ? opts.templateFile : ownTemplate;
  if (!existsSync(templatePath)) {
    if (!opts.overlay) add({ rule: 'template-invalid', file: LZ_CATALOGUE_TEMPLATE_FILE, message: 'template file not found; the meta field set cannot be checked' });
  } else {
    const t = readJson(templatePath);
    if (!t.ok) {
      add({ rule: 'template-invalid', file: LZ_CATALOGUE_TEMPLATE_FILE, message: `not valid JSON: ${t.reason}` });
    } else {
      const stripped = stripComments(t.value);
      const meta = isObject(stripped) ? stripped['meta'] : undefined;
      if (isObject(meta)) templateMetaKeys = Object.keys(meta).sort();
      const issues = opts.validate(stripped);
      if (issues.length > 0) {
        add({ rule: 'template-invalid', file: LZ_CATALOGUE_TEMPLATE_FILE, message: `template fails the catalogue schema: ${issues.join('; ')}` });
      }
    }
  }

  // --- Every provider catalogue file ---------------------------------------
  // #3298: the shared discovery (flat files; per-provider copies are checked by the resolver).
  const catalogueFiles = scanLzCatalogueFiles(dir, { flat: true }).map((r) => r.file);
  for (const file of catalogueFiles) {
    checkCatalogueFile(dir, file, { add, checkDate, templateMetaKeys, pins, now, maxAgeDays, validate: opts.validate });
    if (opts.geographies) checkGeographyCoverage(dir, file, opts.geographies, add);
  }

  // --- Metadata side files (*-service-meta.json): readable and not stale ---
  for (const file of dirEntries.filter((n) => n.endsWith('-service-meta.json'))) {
    const r = readJson(join(dir, file));
    if (!r.ok) { add({ rule: 'catalogue-schema', file, message: `not valid JSON: ${r.reason}` }); continue; }
    const generated = isObject(r.value) ? r.value['generated_at'] : undefined;
    const d = checkDate(file, 'generated_at', generated);
    if (d && ageDays(d, now) > maxAgeDays) {
      add({ rule: 'stale', file, message: `generated_at ${String(generated)} is ${ageDays(d, now)} days old (threshold ${maxAgeDays} days)` });
    }
  }

  // --- #3288: VM price table of the service cost model -----------------------
  const priceFile = LZ_PRICE_TABLE_FILE;
  if (existsSync(join(dir, priceFile))) {
    const r = readJson(join(dir, priceFile));
    if (!r.ok) {
      add({ rule: 'price-table', file: priceFile, message: `not valid JSON: ${r.reason}` });
    } else {
      for (const issue of opts.validatePriceTable?.(r.value) ?? []) add({ rule: 'price-table', file: priceFile, message: issue });
      const meta = isObject(r.value) && isObject(r.value['meta']) ? r.value['meta'] : {};
      const d = checkDate(priceFile, 'meta.generated_at', meta['generated_at']);
      if (d && ageDays(d, now) > maxAgeDays) {
        add({ rule: 'stale', file: priceFile, message: `meta.generated_at ${String(meta['generated_at'])} is ${ageDays(d, now)} days old (threshold ${maxAgeDays} days); run swao lz catalogue update` });
      }
    }
  }

  return {
    dir,
    catalogues_checked: catalogueFiles.length,
    rules_checked: LZ_CATALOGUE_QUALITY_RULES.filter((r) =>
      r.id !== 'target-invalid' && r.id !== 'target-geography' && (r.id !== 'geography-coverage' || !!opts.geographies)).length,
    max_age_days: maxAgeDays,
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warn').length,
    findings,
  };
}

interface FileCheckCtx {
  add: (f: Omit<LzCatalogueQualityFinding, 'severity'> & { severity?: LzQualitySeverity }) => void;
  checkDate: (file: string, field: string, value: unknown, provider?: string) => Date | null;
  templateMetaKeys: string[] | null;
  pins: Record<string, Record<string, LzQualityPin>>;
  now: Date;
  maxAgeDays: number;
  validate: LzCatalogueValidator;
}

function checkCatalogueFile(dir: string, file: string, ctx: FileCheckCtx): void {
  const { add } = ctx;
  const stem = file.replace(/\.json$/, '');
  const r = readJson(join(dir, file));
  if (!r.ok) {
    add({ rule: 'catalogue-schema', file, provider: stem, message: `not valid JSON: ${r.reason}` });
    return;
  }
  const issues = ctx.validate(r.value);
  if (issues.length > 0) {
    add({ rule: 'catalogue-schema', file, provider: stem, message: `fails the catalogue schema: ${issues.slice(0, 5).join('; ')}${issues.length > 5 ? `; and ${issues.length - 5} more` : ''}` });
  }
  // The remaining rules read the raw JSON defensively so one schema failure
  // does not hide the others.
  const raw = r.value;
  const meta = isObject(raw) && isObject(raw['meta']) ? raw['meta'] : undefined;
  const regions = isObject(raw) && Array.isArray(raw['regions']) ? (raw['regions'] as unknown[]) : [];
  if (!meta) return; // already reported by the schema rule
  const provider = nonEmptyString(meta['provider']) ? meta['provider'] : stem;

  if (meta['provider'] !== stem) {
    add({ rule: 'provider-filename', file, provider, message: `meta.provider "${String(meta['provider'])}" does not match the file name ${file}` });
  }

  if (ctx.templateMetaKeys) {
    const keys = Object.keys(meta).filter((k) => !k.startsWith('_'));
    const missing = ctx.templateMetaKeys.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !ctx.templateMetaKeys!.includes(k));
    if (missing.length > 0 || extra.length > 0) {
      add({ rule: 'meta-fields', file, provider, message: `meta field set differs from the template:${missing.length ? ` missing ${missing.join(', ')}` : ''}${extra.length ? ` extra ${extra.join(', ')}` : ''}` });
    }
  }

  if (meta['regions_count'] !== undefined && meta['regions_count'] !== regions.length) {
    add({ rule: 'regions-count', file, provider, message: `meta.regions_count is ${String(meta['regions_count'])} but the file has ${regions.length} region(s)` });
  }

  if (!LZ_CATALOGUE_CONFIDENCE_VOCABULARY.includes(String(meta['confidence']))) {
    add({ rule: 'confidence-vocabulary', file, provider, message: `meta.confidence "${String(meta['confidence'])}" is not one of ${LZ_CATALOGUE_CONFIDENCE_VOCABULARY.join(', ')}` });
  }

  const source = isObject(meta['source']) ? meta['source'] : undefined;
  if (!source || !nonEmptyString(source['mode'])) {
    add({ rule: 'source-missing', file, provider, message: 'meta.source.mode is missing; every catalogue must name its source' });
  }
  const sourceNote = source && nonEmptyString(source['source_note']) ? source['source_note'] : undefined;

  const updated = ctx.checkDate(file, 'meta.last_updated', meta['last_updated'], provider);
  if (updated && ageDays(updated, ctx.now) > ctx.maxAgeDays) {
    add({ rule: 'stale', file, provider, message: `last_updated ${String(meta['last_updated'])} is ${ageDays(updated, ctx.now)} days old (threshold ${ctx.maxAgeDays} days); refresh or re-review the catalogue` });
  }

  // --- Regions ----------------------------------------------------------------
  const providerPins = ctx.pins[provider];
  const seen = new Set<string>();
  regions.forEach((rawRegion, i) => {
    if (!isObject(rawRegion)) return; // schema rule
    const id = nonEmptyString(rawRegion['id']) ? rawRegion['id'] : `regions[${i}]`;
    if (seen.has(id)) add({ rule: 'region-id-duplicate', file, provider, region: id, message: `region id "${id}" appears more than once` });
    seen.add(id);

    const services = Array.isArray(rawRegion['services']) ? (rawRegion['services'] as unknown[]) : [];
    if (services.length === 0) add({ rule: 'services-empty', file, provider, region: id, message: 'region lists no services' });
    const codes = new Map<string, number>();
    for (const s of services) if (isObject(s) && typeof s['code'] === 'string') codes.set(s['code'], (codes.get(s['code']) ?? 0) + 1);
    const dupCodes = [...codes.entries()].filter(([, n]) => n > 1).map(([c]) => c);
    if (dupCodes.length > 0) add({ rule: 'service-code-duplicate', file, provider, region: id, message: `service code(s) listed more than once: ${dupCodes.join(', ')}` });

    const sov = isObject(rawRegion['sovereignty']) ? rawRegion['sovereignty'] : undefined;
    if (!sov) {
      add({ rule: 'sovereignty-shape', file, provider, region: id, message: 'region has no sovereignty facts block' });
      return;
    }
    const missing = LZ_SOVEREIGNTY_FACT_FIELDS.filter((k) => sov[k] === undefined);
    if (missing.length > 0) {
      // #3287 (D-20): no exception; an operator-site region states OPERATOR_SITE.
      const hint = missing.includes('residency_country') && sov['operator_jurisdiction'] === LZ_OPERATOR_SITE_JURISDICTION
        ? ` (operator-site region: set residency_country "${LZ_OPERATOR_SITE_RESIDENCY}")` : '';
      add({ rule: 'sovereignty-shape', file, provider, region: id, message: `sovereignty facts lack ${missing.join(', ')}${hint}` });
    }
    if (sov['residency_country'] === LZ_OPERATOR_SITE_RESIDENCY && sov['operator_jurisdiction'] !== LZ_OPERATOR_SITE_JURISDICTION) {
      add({
        rule: 'sovereignty-shape', file, provider, region: id,
        message: `residency_country "${LZ_OPERATOR_SITE_RESIDENCY}" is valid only with operator_jurisdiction "${LZ_OPERATOR_SITE_JURISDICTION}" (found "${String(sov['operator_jurisdiction'])}")`,
      });
    }
    if (Array.isArray(sov['certifications'])) {
      const unknownCerts = [...new Set((sov['certifications'] as unknown[]).map(String))].filter((c) => !LZ_CERTIFICATION_VOCABULARY.includes(c));
      if (unknownCerts.length > 0) {
        add({ rule: 'certification-vocabulary', file, provider, region: id, message: `certification(s) outside the template vocabulary: ${unknownCerts.join(', ')} (vocabulary: ${LZ_CERTIFICATION_VOCABULARY.join(', ')})` });
      }
    }

    const pin = providerPins?.[id];
    if (pin) {
      const drift: string[] = [];
      if (sov['residency_country'] !== pin.residency_country) drift.push(`residency_country "${String(sov['residency_country'])}" vs pin "${pin.residency_country}"`);
      if (sov['operator_jurisdiction'] !== pin.operator_jurisdiction) drift.push(`operator_jurisdiction "${String(sov['operator_jurisdiction'])}" vs pin "${pin.operator_jurisdiction}"`);
      if (!sameSet(sov['extraterritorial_exposure'], pin.extraterritorial_exposure)) drift.push(`extraterritorial_exposure [${String(sov['extraterritorial_exposure'])}] vs pin [${pin.extraterritorial_exposure.join(',')}]`);
      if (!sameSet(sov['certifications'], pin.certifications)) drift.push(`certifications [${String(sov['certifications'])}] vs pin [${pin.certifications.join(',')}]`);
      if (drift.length > 0) add({ rule: 'pin-drift', file, provider, region: id, message: `sovereignty facts differ from the refresh overlay pin: ${drift.join('; ')}` });
    }

    if (sov['residency_country'] === LZ_UNKNOWN_RESIDENCY) {
      add({ rule: 'facts-unsourced', file, provider, region: id, message: `residency_country is the "${LZ_UNKNOWN_RESIDENCY}" placeholder (region not in the refresh overlay pins); facts are refresh defaults` });
    } else if (!pin && !sourceNote) {
      add({ rule: 'facts-unsourced', file, provider, region: id, message: providerPins ? 'region has no refresh overlay pin and the catalogue has no meta.source.source_note' : 'catalogue has no meta.source.source_note backing its sovereignty facts' });
    }
  });
}

/**
 * #3281 geography-coverage: the shared geography model applies to every
 * catalogue in the same way. A region's residency country (fallback: the
 * region `country`) must be in the model's country table; UNKNOWN or omitted
 * residency leaves the region untagged (facts-unsourced reports UNKNOWN). A
 * catalogue with no tagged region fails unless every region is an
 * operator-site region (residency_country OPERATOR_SITE, #3287; an omitted
 * residency counts the same here and is reported by sovereignty-shape).
 */
function checkGeographyCoverage(
  dir: string,
  file: string,
  geographies: Readonly<Record<string, readonly string[]>>,
  add: (f: Omit<LzCatalogueQualityFinding, 'severity'> & { severity?: LzQualitySeverity }) => void,
): void {
  const r = readJson(join(dir, file));
  if (!r.ok || !isObject(r.value) || !Array.isArray(r.value['regions'])) return; // catalogue-schema reports it
  const meta = isObject(r.value['meta']) ? r.value['meta'] : {};
  const provider = nonEmptyString(meta['provider']) ? meta['provider'] : undefined;
  const known = new Set(Object.values(geographies).flat());
  let tagged = 0;
  let operatorSite = 0;
  const regions = r.value['regions'] as unknown[];
  for (const reg of regions) {
    if (!isObject(reg)) continue;
    const sov = isObject(reg['sovereignty']) ? reg['sovereignty'] : {};
    const raw = sov['residency_country'] ?? reg['country'];
    if (raw === undefined || raw === null || raw === '' || raw === LZ_OPERATOR_SITE_RESIDENCY) { operatorSite++; continue; }
    const c = String(raw).toUpperCase();
    if (c === 'UNKNOWN') continue;
    if (known.has(c)) { tagged++; continue; }
    add({
      rule: 'geography-coverage', file, provider, region: nonEmptyString(reg['id']) ? reg['id'] : undefined,
      message: `residency country "${c}" is not in the shared geography model; add it to a geography in module-landing-zone src/catalogue/geographies.ts`,
    });
  }
  if (regions.length > 0 && tagged === 0 && operatorSite < regions.length) {
    add({ rule: 'geography-coverage', file, provider, message: 'no region of this catalogue belongs to a geography of the shared model, so `<provider>:<geography>` targets cannot resolve' });
  }
}

/**
 * Render findings as one line per (severity, rule, file); region-level
 * findings of the same rule collapse into one line listing the region ids,
 * so 29 unsourced Azure regions read as one line. Shared by the health-check
 * text output and the audit gate. Errors first.
 */
export function formatLzQualityFindings(findings: readonly LzCatalogueQualityFinding[], maxRegions = 12): string[] {
  const groups = new Map<string, LzCatalogueQualityFinding[]>();
  for (const f of findings) {
    const key = `${f.severity}|${f.rule}|${f.file}`;
    const g = groups.get(key);
    if (g) g.push(f); else groups.set(key, [f]);
  }
  const out: { severity: LzQualitySeverity; line: string }[] = [];
  for (const fs of groups.values()) {
    const first = fs[0]!;
    const tag = first.severity === 'error' ? 'ERROR' : first.severity === 'warn' ? 'WARN' : 'INFO';
    const regions = fs.map((f) => f.region).filter((r): r is string => !!r);
    if (fs.length > 1 && regions.length === fs.length) {
      const shown = regions.slice(0, maxRegions).join(', ');
      const more = regions.length > maxRegions ? `, and ${regions.length - maxRegions} more` : '';
      out.push({ severity: first.severity, line: `[${tag}] ${first.rule} ${first.file}: ${fs.length} regions (${shown}${more}): ${first.message}` });
    } else {
      for (const f of fs) out.push({ severity: f.severity, line: `[${tag}] ${f.rule} ${f.file}${f.region ? ` [${f.region}]` : ''}: ${f.message}` });
    }
  }
  return [
    ...out.filter((o) => o.severity === 'error'),
    ...out.filter((o) => o.severity === 'warn'),
    ...out.filter((o) => o.severity === 'info'),
  ].map((o) => o.line);
}

// ---------------------------------------------------------------------------
// Configured targets (.swao.yml), #3282 criterion 5 / #3281.
// ---------------------------------------------------------------------------

export interface LzConfiguredTarget {
  provider: string;
  region: string;
  /** Key the target was configured under, e.g. "assessment.landing_zone.targets[1]" (the file is in `file`). */
  origin: string;
  /** .swao.yml path reported as the finding file. */
  file: string;
}

/**
 * Up to `max` valid region ids to suggest for an unknown region: ids that
 * contain the input (or the reverse) first, then ids sharing its leading
 * token, then the rest in catalogue order.
 */
export function lzRegionHint(region: string, valid: readonly string[], max = 10): string[] {
  const q = region.toLowerCase().replace(/[^a-z0-9]/g, '');
  const head = region.toLowerCase().split(/[^a-z0-9]+/)[0] ?? '';
  const score = (id: string): number => {
    const n = id.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (q && (n.includes(q) || q.includes(n))) return 0;
    if (head && id.toLowerCase().startsWith(head)) return 1;
    return 2;
  };
  return valid
    .map((id, i) => ({ id, i, s: score(id) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, max)
    .map((x) => x.id);
}

/**
 * Geography resolver injected by the caller (#3281): `resolveLzGeography`
 * from ./geographies.ts. Injected rather than imported so this file stays
 * free of local imports (the audit gate loads it by type stripping).
 */
export type LzTargetGeographyResolver = (
  provider: string,
  region: string,
) => { kind: 'region' | 'geography' | 'unknown'; region: string; geography?: string } | undefined;

/**
 * Check configured provider:region targets against the catalogue region ids.
 * `regionIdsByProvider` holds every resolvable provider (an empty array means
 * the provider is known but its catalogue failed to load). With
 * `resolveGeography`, a value that is a known geography (`azure:Europe`) is
 * not `target-invalid`: it is reported as `target-geography` (info) naming
 * the region it resolves to, the same resolution `swao assess` applies.
 */
export function checkLzConfiguredTargets(
  targets: readonly LzConfiguredTarget[],
  regionIdsByProvider: Record<string, readonly string[]>,
  resolveGeography?: LzTargetGeographyResolver,
): LzCatalogueQualityFinding[] {
  const findings: LzCatalogueQualityFinding[] = [];
  const providers = Object.keys(regionIdsByProvider).sort();
  for (const t of targets) {
    if (!nonEmptyString(t.provider) || !nonEmptyString(t.region)) {
      findings.push({ rule: 'target-invalid', severity: 'warn', file: t.file, message: `${t.origin}: target "${t.provider}:${t.region}" is not of the form <provider>:<region>` });
      continue;
    }
    const valid = regionIdsByProvider[t.provider];
    if (!valid) {
      findings.push({ rule: 'target-invalid', severity: 'warn', file: t.file, provider: t.provider, region: t.region, message: `${t.origin}: unknown LZ catalogue provider "${t.provider}". Known providers: ${providers.join(', ')}` });
      continue;
    }
    if (valid.length === 0 || valid.includes(t.region)) continue;
    const geo = resolveGeography?.(t.provider, t.region);
    if (geo?.kind === 'geography') {
      findings.push({
        rule: 'target-geography', severity: 'info', file: t.file, provider: t.provider, region: t.region,
        message: `${t.origin}: "${t.region}" is a geography, not a ${t.provider} region id; it resolves to the default region ${geo.region}` +
          ` (set ${t.provider}:${geo.region} to make the choice explicit).`,
      });
      continue;
    }
    const hint = lzRegionHint(t.region, valid);
    findings.push({
      rule: 'target-invalid', severity: 'warn', file: t.file, provider: t.provider, region: t.region,
      message: `${t.origin}: "${t.region}" is not a ${t.provider} region id. Valid regions include: ${hint.join(', ')}` +
        (valid.length > hint.length ? ` (${valid.length} in total; see \`swao lz catalogue list\`).` : '.'),
    });
  }
  return findings;
}

/**
 * Read configured LZ targets from a parsed `.swao.yml` object:
 * `assessment.landing_zone.provider` + `region` (assess.ts reads this pair)
 * and `assessment.landing_zone.targets` (#3281: `<provider>:<region>` strings;
 * `{ provider, region }` objects tolerated). Read-only; unknown shapes are
 * reported as malformed targets.
 */
export function readLzConfiguredTargets(swaoYml: unknown, file: string): LzConfiguredTarget[] {
  const out: LzConfiguredTarget[] = [];
  const assessment = isObject(swaoYml) ? swaoYml['assessment'] : undefined;
  const lz = isObject(assessment) ? assessment['landing_zone'] : undefined;
  if (!isObject(lz)) return out;
  const base = 'assessment.landing_zone';
  // A provider without a region drives Pass 23 (LZR) only, not a catalogue fit.
  if (lz['region'] !== undefined && lz['region'] !== null) {
    out.push({ provider: String(lz['provider'] ?? ''), region: String(lz['region']), origin: `${base}.provider/region`, file });
  }
  if (Array.isArray(lz['targets'])) {
    lz['targets'].forEach((t: unknown, i: number) => {
      const origin = `${base}.targets[${i}]`;
      if (typeof t === 'string') {
        const colon = t.indexOf(':');
        out.push(colon > 0
          ? { provider: t.slice(0, colon).trim(), region: t.slice(colon + 1).trim(), origin, file }
          : { provider: t.trim(), region: '', origin, file });
      } else if (isObject(t)) {
        out.push({ provider: String(t['provider'] ?? ''), region: String(t['region'] ?? ''), origin, file });
      } else {
        out.push({ provider: '', region: '', origin, file });
      }
    });
  } else if (lz['targets'] !== undefined && lz['targets'] !== null) {
    out.push({ provider: '', region: '', origin: `${base}.targets (expected a list)`, file });
  }
  return out;
}
