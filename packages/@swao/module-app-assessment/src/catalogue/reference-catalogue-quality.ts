// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3296: quality rules for the five reference catalogues in swao/controls/
// (sovereign-service, db-compatibility, licence-risk, legacy-indicators,
// vendor-sdk). The rules live here once; the audit gate
// tests/audit-gates/reference-catalogue-quality.gate.mjs runs them on the
// shipped files and the unit test runs them on fixtures.
//
// This module has no runtime imports, so the gate can load it through Node's
// TypeScript type stripping without a build. Parsing and schema validation
// are done by the caller (reference-catalogues.ts loaders) and passed in.
//
// Error rules (fail the gate):
//   schema            the catalogue does not parse or fails its Zod schema
//   verdict-source    a verified sovereign-service verdict without a source
//   blocker-rule      blocks_migration not exactly "unavailable and verified"
//   review-date       a review date in the future
//   engagement-marker engagement-specific content (incident id, internal
//                     proxy endpoint, client pseudonym, one application's
//                     configuration or cost data)
//   consumer-header   licence-risk signal_prefix does not name the consumer
//   entry-source      a vendor-sdk or legacy-indicators entry without a
//                     public source (#3302)
// Warning rules (printed, do not fail):
//   review-age        a review date older than maxAgeDays
//   review-missing    a catalogue or entry without any review date
//   unverified        a sovereign-service verdict that is not verified

import type {
  CatalogueLoad,
  CatalogueSource,
  LegacyIndicatorsCatalogue,
  LicenceRiskCatalogue,
  SovereignServiceCatalogue,
  VendorSdkCatalogue,
} from './reference-catalogues.js';

export type RefCatalogueSeverity = 'error' | 'warning';

export interface RefCatalogueFinding {
  severity: RefCatalogueSeverity;
  rule: string;
  file: string;
  message: string;
}

export interface RefCatalogueInput {
  /** File name, e.g. sovereign-service-catalogue.yaml. */
  file: string;
  /** Raw file text (for the engagement-marker scan). */
  text: string;
  /** Result of the matching loader in reference-catalogues.ts. */
  load: CatalogueLoad<unknown>;
}

export interface RefCatalogueReport {
  findings: RefCatalogueFinding[];
  errors: number;
  warnings: number;
  catalogues_checked: number;
  max_age_days: number;
}

export const DEFAULT_REF_CATALOGUE_MAX_AGE_DAYS = 180;

/** Engagement-specific content that must not appear in a generic runtime asset. */
export const ENGAGEMENT_MARKERS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b[a-z][a-z0-9]*-proxy:\/\//i, reason: 'internal proxy endpoint' },
  { pattern: /\bINC-\d{4}-\d{2,}\b/, reason: 'incident id' },
  { pattern: /\bINC\d{6,}\b/, reason: 'incident id' },
  { pattern: /\bHealthCo\b/, reason: 'client pseudonym' },
  { pattern: /\bmedplum\b/i, reason: 'one application named in a generic catalogue' },
  { pattern: /\b[\w-]+\.config\.json\b/, reason: "one application's configuration file name" },
  { pattern: /\bEUR\s?\d[\d,.]*(\s?-\s?\d[\d,.]*)?\s*\/\s*month\b/i, reason: "one application's costs" },
  { pattern: /\b\d[\d,.]*k?\s+(emails|requests|calls)\s*\/\s*month\b/i, reason: "one application's volumes" },
  { pattern: /\bCloudability\b/, reason: "one engagement's FinOps data source" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(v: string): Date | null {
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function checkReferenceCatalogues(
  inputs: RefCatalogueInput[],
  opts: { today?: Date; maxAgeDays?: number } = {},
): RefCatalogueReport {
  const today = opts.today ?? new Date();
  const maxAgeDays = opts.maxAgeDays ?? DEFAULT_REF_CATALOGUE_MAX_AGE_DAYS;
  const findings: RefCatalogueFinding[] = [];
  const add = (severity: RefCatalogueSeverity, rule: string, file: string, message: string): void => {
    findings.push({ severity, rule, file, message });
  };

  /** Check one review date: future is an error, older than the threshold a warning. */
  const checkDate = (file: string, where: string, value: string | undefined): void => {
    if (!value) {
      add('warning', 'review-missing', file, `${where}: no review date`);
      return;
    }
    const d = parseDate(value);
    if (!d) return; // the schema reports malformed dates
    const ageDays = Math.floor((today.getTime() - d.getTime()) / DAY_MS);
    if (ageDays < 0) add('error', 'review-date', file, `${where}: review date ${value} is in the future`);
    else if (ageDays > maxAgeDays) add('warning', 'review-age', file, `${where}: reviewed ${value}, ${ageDays} days ago (threshold ${maxAgeDays} days)`);
  };

  /** #3302: a vendor-sdk or legacy-indicators entry needs at least one public source. */
  const checkEntry = (file: string, where: string, sources: CatalogueSource[] | undefined, reviewed: string | undefined): void => {
    if (!sources || sources.length === 0) add('error', 'entry-source', file, `${where}: no public source`);
    checkDate(file, where, reviewed);
    (sources ?? []).forEach((src, i) => checkDate(file, `${where} source ${i + 1}`, src.reviewed));
  };

  for (const input of inputs) {
    const { file } = input;
    // Engagement markers are checked on the raw text, whatever the schema says.
    const lines = input.text.split(/\r?\n/);
    for (const { pattern, reason } of ENGAGEMENT_MARKERS) {
      lines.forEach((line, i) => {
        const m = line.match(pattern);
        if (m) add('error', 'engagement-marker', file, `line ${i + 1}: ${reason} ("${m[0]}")`);
      });
    }

    if (!input.load.ok) {
      add('error', 'schema', file, input.load.reason);
      continue;
    }
    const data = input.load.data as Record<string, unknown>;

    if (file.startsWith('sovereign-service')) {
      const cat = data as unknown as SovereignServiceCatalogue;
      for (const s of cat.services) {
        const where = `service ${s.id}`;
        if (s.verdict_confidence === 'verified' && s.sources.length === 0) {
          add('error', 'verdict-source', file, `${where}: verified verdict "${s.portability_verdict}" has no source`);
        }
        const shouldBlock = s.portability_verdict === 'unavailable' && s.verdict_confidence === 'verified';
        if (s.blocks_migration !== shouldBlock) {
          add('error', 'blocker-rule', file, `${where}: blocks_migration ${s.blocks_migration}, expected ${shouldBlock} (verdict ${s.portability_verdict}, ${s.verdict_confidence})`);
        }
        if (s.verdict_confidence !== 'verified') {
          add('warning', 'unverified', file, `${where}: verdict "${s.portability_verdict}" is unverified (severity capped at medium, never a blocker)`);
        }
        checkDate(file, where, s.last_reviewed);
        s.sources.forEach((src, i) => checkDate(file, `${where} source ${i + 1}`, src.reviewed));
      }
    } else if (file.startsWith('vendor-sdk')) {
      const cat = data as unknown as VendorSdkCatalogue;
      if (cat.last_reviewed) checkDate(file, 'catalogue', cat.last_reviewed);
      for (const sdk of cat.sdks) checkEntry(file, `sdk ${sdk.id}`, sdk.sources, sdk.last_reviewed ?? cat.last_reviewed);
    } else if (file.startsWith('legacy-indicators')) {
      const cat = data as unknown as LegacyIndicatorsCatalogue;
      checkDate(file, 'catalogue', cat.last_reviewed);
      const all = [...cat.tiers.tier_1_blockers, ...cat.tiers.tier_2_complicators, ...cat.tiers.tier_3_manageable];
      for (const ind of all) checkEntry(file, `indicator ${ind.id}`, ind.sources, ind.last_reviewed ?? cat.last_reviewed);
    } else {
      if (file.startsWith('licence-risk')) {
        const prefix = (data as unknown as LicenceRiskCatalogue).signal_prefix;
        if (prefix !== undefined && prefix !== 'MAL') {
          add('error', 'consumer-header', file, `signal_prefix ${prefix} does not match the consumer (Pass 14, MAL-10 / MAL-13)`);
        }
      }
      checkDate(file, 'catalogue', typeof data.last_reviewed === 'string' ? data.last_reviewed : undefined);
    }
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  return { findings, errors, warnings: findings.length - errors, catalogues_checked: inputs.length, max_age_days: maxAgeDays };
}

/** One line per finding, errors first: `[ERROR] rule file: message` / `[WARN] ...`. */
export function formatRefCatalogueFindings(findings: RefCatalogueFinding[]): string[] {
  const ordered = [...findings].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  return ordered.map((f) => `${f.severity === 'error' ? '[ERROR]' : '[WARN]'} ${f.rule} ${f.file}: ${f.message}`);
}
