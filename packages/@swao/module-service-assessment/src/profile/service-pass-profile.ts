// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Service pass profile (Design 103 §5, §2.3, ADR-0064, #3093).
 *
 * The §5 table as data. The host keeps its canonical pass order and lens
 * filter and only drops what this profile skips; conditional passes run when
 * their inputs exist, with `sourcePath` pointed at those inputs instead of a
 * source tree. No existing pass file is changed: Pass 03 DATA and Pass 08
 * CRYPTO read whatever directory they are given.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { listInputFiles, type PassRunner } from '@swao/core';
import { GENERATED_BINARY_FILES } from '../binary/analyse.js';
import { hasDeclaredDataFields, runServiceCryptoPass, runServiceDataPass } from './service-passes.js';

export type ServicePassMode = 'always' | 'conditional' | 'skipped' | 'external';

export interface ServicePassDef {
  num: string;
  key: string;
  name: string;
  mode: ServicePassMode;
  /** Why the pass is skipped, or the condition under which a conditional pass runs. */
  reason: string;
}

/** Design 103 §5 table. Keys match the host pass keys (`--passes`). */
export const SERVICE_PASS_PROFILE: readonly ServicePassDef[] = [
  { num: '00', key: 'ingest', name: 'INGEST', mode: 'always', reason: 'routes ingestion/ files as in application mode' },
  { num: '01', key: 'inv', name: 'INV', mode: 'skipped', reason: 'no source tree to inventory in a service assessment' },
  { num: '02', key: 'state', name: 'STATE', mode: 'skipped', reason: 'no stateful code analysis without source code' },
  { num: '03', key: 'data', name: 'DATA', mode: 'conditional', reason: 'runs when data-flow inputs exist (ERD, DFD, screen masks) or .swao.yml declares data fields (§5.1)' },
  { num: '04', key: 'ctx', name: 'CTX', mode: 'always', reason: 'reads all wsp/inputs/ categories; primary signal source in service mode' },
  { num: '05', key: 'sbom', name: 'SBOM', mode: 'conditional', reason: 'runs when a CycloneDX or SPDX SBOM is supplied with the binaries' },
  { num: '06', key: 'tf', name: 'TF', mode: 'skipped', reason: 'no Terraform or twelve-factor source in a service assessment' },
  { num: '07', key: 'egr', name: 'EGR', mode: 'skipped', reason: 'no egress graph without source code' },
  { num: '08', key: 'crypto', name: 'CRYPTO', mode: 'conditional', reason: 'runs when config files or binary content are supplied' },
  { num: '09', key: 'synth', name: 'SYNTH', mode: 'always', reason: 'synthesises the signals that were emitted' },
  { num: '10', key: 'dynamic', name: 'DYNAMIC', mode: 'conditional', reason: 'runs only when the analyst configured a crawl for a saas or hybrid vendor portal (G-08)' },
  { num: '11', key: 'comp', name: 'COMP', mode: 'always', reason: 'framework compliance' },
  { num: '12', key: 'blocks', name: 'BLOCKS', mode: 'always', reason: 'blocked-finding aggregation' },
  { num: '13', key: 'scope', name: 'SCOPE', mode: 'always', reason: 'coverage report' },
  // #3419: the default secret scan (Gitleaks) needs files to scan; without
  // supplied config or binary inputs it would scan the empty base source path
  // and report a false "no secrets detected".
  { num: '14', key: 'secrets', name: 'SECRETS', mode: 'conditional', reason: 'runs when config or binary inputs are supplied' },
  { num: '14', key: 'malware', name: 'MALWARE', mode: 'conditional', reason: 'runs when binary files are supplied and the pass is requested' },
  // #3405: Pass 26 code health measures source code only.
  { num: '26', key: 'quality', name: 'QUALITY', mode: 'skipped', reason: 'no source code to measure for code health in a service assessment' },
  { num: '24', key: 'research', name: 'RESEARCH', mode: 'external', reason: 'runs as swao service research (Pass 24); stubs are read by CTX' },
  { num: '25', key: 'binary', name: 'BINARY', mode: 'external', reason: 'static binary analysis; runs before the pass loop and before research (binary-analysis.json)' },
];

export interface SkippedPass { num: string; key: string; name: string; reason: string }

export interface ServicePassPlan {
  /** Requested pass keys that run, in the order given (the host's canonical order). */
  run: string[];
  /** Profile-skipped and condition-skipped passes, with reasons. */
  skipped: SkippedPass[];
  /** Passes outside the pass loop (research, binary). */
  external: SkippedPass[];
  /** Per-pass `sourcePath` override for conditional passes that run. */
  sourceOverrides: Record<string, string>;
  /** Empty directory used as `sourcePath` for every other pass (there is no source tree). */
  baseSourcePath: string;
  /** Service-mode runners that replace the application runner for a pass key (new code, Design 103 §2.3). */
  runners: Record<string, PassRunner>;
}

// #3428: input-folder checks through the central source scope's sibling walker.
function hasFiles(dir: string): boolean {
  if (!existsSync(dir)) return false;
  return listInputFiles(dir).some((f) => f.name.toLowerCase() !== '.gitkeep' && !GENERATED_BINARY_FILES.has(f.name));
}

/** Files Pass 00 itself skips in ingestion/ (its manifest and housekeeping files). */
const INGEST_HOUSEKEEPING = new Set(['.gitkeep', 'readme.md', 'ingestion-manifest.json']);

function hasMatching(dir: string, re: RegExp): boolean {
  if (!existsSync(dir)) return false;
  return listInputFiles(dir).some((f) => !INGEST_HOUSEKEEPING.has(f.name.toLowerCase()) && re.test(f.name.toLowerCase()));
}

/**
 * Where a hint folder's files are: `wsp/inputs/<hint>/` when the analyst put
 * them there, else `ingestion/<hint>/`. Pass 00 classifies by file name and extension, so
 * ingested files do not keep their hint folder; the raw hint folder is the
 * reliable location.
 */
export function hintInputDir(appDir: string, hint: string): string | null {
  for (const d of [join(appDir, 'wsp', 'inputs', hint), join(appDir, 'ingestion', hint)]) {
    if (hasFiles(d)) return d;
  }
  return null;
}

const SBOM_FILE = /(\.cdx\.json|\.spdx\.json|\.spdx|bom\.json|sbom\.json)$/;
/** Documents Pass 00 ingests and extracts (#3212). */
const INGESTED_DOCUMENT = /\.(pdf|docx?|xlsx?|pptx|csv|md|txt|json|ya?ml|xml|html?)$/;
/** Installer, package, or SBOM files that enable the binary-based passes without a hint folder (#3212). */
const BINARY_OR_SBOM = /(\.(exe|dll|sys|msi|msp|msix|appx|jar|war|ear|so|dylib|cab|pkg|dmg|deb|rpm)|\.cdx\.json|\.spdx\.json|\.spdx|bom\.json|sbom\.json)$/;
/**
 * Files Pass 14 MALWARE scans (#3154). Wider than what Pass 25 BINARY parses
 * (PE and MSI only): the malware scanner reads MSIX, APPX, JAR, and ELF files
 * too, so they still gate MALWARE; Pass 25 lists them as `unsupported_files`.
 */
const MALWARE_SCANNABLE_FILE = /\.(msi|exe|dll|sys|msix|appx|jar|so|bin)$/;

/** Plan the passes for one service app. `requested` is the host's ordered selection. */
export function planServicePasses(appDir: string, requested: readonly string[], appConfig: Record<string, unknown> = {}): ServicePassPlan {
  const baseSourcePath = join(appDir, 'wsp', 'service-no-source');
  mkdirSync(baseSourcePath, { recursive: true });
  const def = (key: string) => SERVICE_PASS_PROFILE.find((d) => d.key === key);
  const run: string[] = [];
  const skipped: SkippedPass[] = [];
  const sourceOverrides: Record<string, string> = {};
  const skip = (d: ServicePassDef, reason = d.reason) => skipped.push({ num: d.num, key: d.key, name: d.name, reason });

  // #3212: hint folders are optional. Without them, installers anywhere under
  // ingestion/ feed CRYPTO / SBOM / MALWARE, and documents dropped into
  // ingestion/ feed DATA through Pass 00 routed (by file name) and extracted copies in
  // wsp/inputs/ (Pass 00 runs before the passes, after this plan).
  const ingestionDir = join(appDir, 'ingestion');
  const dataDir = hintInputDir(appDir, 'data-flow') ?? (hasMatching(ingestionDir, INGESTED_DOCUMENT) ? join(appDir, 'wsp', 'inputs') : null);
  const binaryDir = hintInputDir(appDir, 'binary') ?? (hasMatching(ingestionDir, BINARY_OR_SBOM) ? ingestionDir : null);
  const vendorType = String(appConfig['vendor_type'] ?? '');
  const crawl = appConfig['crawl'];

  for (const key of requested) {
    const d = def(key);
    if (!d) { run.push(key); continue; }
    switch (d.mode) {
      case 'always':
        run.push(key);
        break;
      case 'skipped':
        skip(d);
        break;
      case 'external':
        break;
      case 'conditional': {
        if (key === 'data') {
          if (dataDir || hasDeclaredDataFields(appDir)) {
            run.push(key);
            if (dataDir) sourceOverrides[key] = dataDir;
          } else skip(d, 'no data-flow inputs and no data fields declared in .swao.yml');
        } else if (key === 'crypto') {
          if (binaryDir) { run.push(key); sourceOverrides[key] = binaryDir; } else skip(d, 'no config or binary inputs (ingestion/binary/ or wsp/inputs/binary/)');
        } else if (key === 'sbom') {
          if (binaryDir && hasMatching(binaryDir, SBOM_FILE)) { run.push(key); sourceOverrides[key] = binaryDir; } else skip(d, 'no CycloneDX or SPDX SBOM supplied');
        } else if (key === 'secrets') {
          // #3419: same inputs as CRYPTO (config files or binary content).
          if (binaryDir) { run.push(key); sourceOverrides[key] = binaryDir; } else skip(d, 'no config or binary inputs to scan for secrets (ingestion/binary/ or wsp/inputs/binary/)');
        } else if (key === 'malware') {
          if (binaryDir && hasMatching(binaryDir, MALWARE_SCANNABLE_FILE)) { run.push(key); sourceOverrides[key] = binaryDir; } else skip(d, 'no binary files supplied');
        } else if (key === 'dynamic') {
          if (crawl && typeof crawl === 'object' && (vendorType === 'saas' || vendorType === 'hybrid')) run.push(key);
          else skip(d, 'no analyst-configured crawl for a saas or hybrid vendor portal (G-08)');
        } else {
          run.push(key);
        }
        break;
      }
    }
  }

  // The source-only passes are always reported, even when not requested.
  for (const d of SERVICE_PASS_PROFILE.filter((p) => p.mode === 'skipped')) {
    if (!skipped.some((s) => s.key === d.key)) skip(d);
  }
  skipped.sort((a, b) => a.num.localeCompare(b.num));
  const external = SERVICE_PASS_PROFILE.filter((d) => d.mode === 'external').map(({ num, key, name, reason }) => ({ num, key, name, reason }));
  return { run, skipped, external, sourceOverrides, baseSourcePath, runners: { data: runServiceDataPass, crypto: runServiceCryptoPass } };
}

/** `scope-coverage.json` written into the run directory of a service run (#3097). */
export interface ServiceScopeCoverage {
  assessment_type: 'service';
  run_passes: Array<{ key: string; status: string }>;
  skipped_passes: SkippedPass[];
  external_passes: SkippedPass[];
}

export function buildServiceScopeCoverage(plan: ServicePassPlan, statuses: Record<string, string>): ServiceScopeCoverage {
  return {
    assessment_type: 'service',
    run_passes: plan.run.map((key) => ({ key, status: statuses[key] ?? 'not_run' })),
    skipped_passes: plan.skipped,
    external_passes: plan.external,
  };
}

/** One-line summary for the console and the TUI assess screen. */
export function formatSkippedSummary(plan: ServicePassPlan): string {
  const sourceOnlyKeys = new Set(SERVICE_PASS_PROFILE.filter((p) => p.mode === 'skipped').map((p) => p.key));
  const sourceOnly = plan.skipped.filter((s) => sourceOnlyKeys.has(s.key)).map((s) => s.num);
  const conditional = plan.skipped.filter((s) => !sourceOnlyKeys.has(s.key)).map((s) => `${s.num} ${s.name}`);
  return `Service passes skipped: ${plan.skipped.length} (${sourceOnly.join(', ')}: no source code${conditional.length > 0 ? `; ${conditional.join(', ')}: inputs not supplied` : ''})`;
}
