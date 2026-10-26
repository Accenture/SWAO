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

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { PassContext, PassResult } from '@swao/core';
import type { Signal } from '@swao/core';
import { logApp, listSourceFiles } from '@swao/core';
import type { PackageEcosystem } from '@swao/core';
import { loadPassCatalog, compileRegexMatcher, scanCatalogueRules, type ScanRule } from './pass-catalog-loader.js';
import { collectJvmProject, isConcreteVersion } from './jvm-build-files.js';
import {
  lookupOsv, osvBaseUrl, resolveOsvDbPath,
  OSV_BATCH_SIZE, OSV_DETAIL_CAP, OSV_QUERY_CAP,
  type OsvQuery,
} from './osv-client.js';

// Build config files that may contain runtime version constraints.
const BUILD_CONFIG_BASENAMES = new Set([
  'build.gradle', 'build.gradle.kts', 'pom.xml', 'settings.gradle',
  'setup.py', 'setup.cfg', 'Pipfile', 'pyproject.toml',
  '.nvmrc', '.tool-versions', '.java-version', 'Dockerfile',
  'Makefile', 'CMakeLists.txt',
]);

// Returns a matching file path if any config_key regex matches a build config file in dir.
// #3428: top-level listing through the central source scope (dot-files such
// as .nvmrc / .tool-versions are build config here, so they are included).
// #3410: config_keys go through the shared catalogue matcher: line-based,
// case-folded, ReDoS-guarded, with identifier boundaries, so
// `java.version=11` no longer matches `java.version=110`.
function detectRuntimeInBuildFiles(dir: string, configKeys: string[]): string | null {
  if (!existsSync(dir) || !configKeys.length) return null;
  const files = listSourceFiles(dir, { purpose: 'config', maxDepth: 0, includeHidden: true })
    .filter((f) => BUILD_CONFIG_BASENAMES.has(f.name) || f.name.endsWith('.csproj') || f.name.endsWith('.fsproj'));
  if (files.length === 0) return null;
  const rules: ScanRule<string>[] = [];
  for (const ck of configKeys) {
    const c = compileRegexMatcher(ck, { match: 'identifier' });
    if (c.ok) rules.push({ key: 'runtime', matcher: c.matcher, via: 'config_key' });
  }
  const first = scanCatalogueRules(files, rules, { maxHitsPerKey: 1 }).hits.get('runtime')?.[0];
  return first ? first.file : null;
}

/** Find package.json files up to maxDepth levels deep (#3428: central source scope skips). */
function findPackageJsonFiles(dir: string, maxDepth = 4): string[] {
  // Root first
  const root = join(dir, 'package.json');
  if (existsSync(root)) return [root];
  // Otherwise walk
  return listSourceFiles(dir, { purpose: 'manifest', maxDepth })
    .filter((f) => f.name === 'package.json' && f.depth > 0)
    .slice(0, 5) // cap at 5 to avoid scanning huge monorepos
    .map((f) => f.abs);
}

// ---------------------------------------------------------------------------
// External SBOM helpers (#1778)
// ---------------------------------------------------------------------------

/** File patterns recognised as external SBOM inputs from wsp/inputs/compliance/. */
const SBOM_CSV_RE = /^SBOM-.*\.xlsx\..*\.csv$|^.*\.sbom\.csv$/;
// #3420: bom.json is the CycloneDX Maven / Gradle plugin default name; since
// #3428 a build-output target/bom.json is not read from the source tree, so
// the operator supplies it here.
const SBOM_CDX_RE = /^.*\.cdx\.json$|^(?:.*[.-])?s?bom\.json$/i;

/**
 * #3420: package URLs from a CycloneDX (components[].purl, nested components
 * included) or SPDX JSON document (packages[].externalRefs purl). They carry
 * the ecosystem, so a supplied SBOM feeds the Maven / npm OSV lookup;
 * components without a purl stay out of it.
 */
export function readSbomPurls(filePath: string): string[] {
  let doc: unknown;
  try { doc = JSON.parse(readFileSync(filePath, 'utf-8')); } catch { return []; }
  const out: string[] = [];
  const visit = (list: unknown, depth: number): void => {
    if (!Array.isArray(list) || depth > 8) return;
    for (const c of list) {
      if (typeof c !== 'object' || c === null) continue;
      const r = c as Record<string, unknown>;
      if (typeof r['purl'] === 'string') out.push(r['purl']);
      for (const ref of Array.isArray(r['externalRefs']) ? r['externalRefs'] : []) {
        const e = ref as Record<string, unknown>;
        if (e['referenceType'] === 'purl' && typeof e['referenceLocator'] === 'string') out.push(e['referenceLocator']);
      }
      visit(r['components'], depth + 1);
    }
  };
  const root = doc as Record<string, unknown> | null;
  visit(root?.['components'], 0);
  visit(root?.['packages'], 0);
  return out;
}

/**
 * Parse an Excel-exported CSV sheet (or any *.sbom.csv) into component records.
 * Column detection is case-insensitive.
 * Name aliases: packageName, name, component.
 * Version aliases: version, ver.
 * Supports comma- and semicolon-delimited files (German locale guard).
 */
export function parseSbomCsvSheet(filePath: string): Array<{ name: string; version: string }> {
  if (!existsSync(filePath)) return [];
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const lines = raw.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) return [];

  // Detect delimiter from header row.
  const headerRaw = lines[0]!;
  const delim = headerRaw.includes(';') ? ';' : ',';

  const splitRow = (row: string): string[] =>
    row.split(delim).map(c => c.trim().replace(/^"(.*)"$/, '$1'));

  const headers = splitRow(headerRaw).map(h => h.toLowerCase());

  const nameIdx = ['packagename', 'name', 'component'].reduce<number>(
    (found, alias) => (found !== -1 ? found : headers.indexOf(alias)),
    -1,
  );
  const versionIdx = ['version', 'ver'].reduce<number>(
    (found, alias) => (found !== -1 ? found : headers.indexOf(alias)),
    -1,
  );

  if (nameIdx === -1) return [];

  const result: Array<{ name: string; version: string }> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitRow(lines[i]!);
    const name = cols[nameIdx]?.trim() ?? '';
    const version = versionIdx !== -1 ? (cols[versionIdx]?.trim() ?? 'unknown') : 'unknown';
    if (name) result.push({ name, version });
  }
  return result;
}

/**
 * Parse a CycloneDX JSON SBOM file and extract component name + version pairs.
 */
export function parseCycloneDxJson(filePath: string): Array<{ name: string; version: string }> {
  if (!existsSync(filePath)) return [];
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return [];
  }

  const components = (doc as Record<string, unknown>)['components'];
  if (!Array.isArray(components)) return [];

  const result: Array<{ name: string; version: string }> = [];
  for (const comp of components) {
    if (typeof comp !== 'object' || comp === null) continue;
    const c = comp as Record<string, unknown>;
    const name = typeof c['name'] === 'string' ? c['name'].trim() : '';
    const version = typeof c['version'] === 'string' ? c['version'].trim() : 'unknown';
    if (name) result.push({ name, version });
  }
  return result;
}

/** Parse an SPDX JSON document (`packages[].name` / `versionInfo`). */
export function parseSpdxJson(filePath: string): Array<{ name: string; version: string }> {
  let doc: unknown;
  try { doc = JSON.parse(readFileSync(filePath, 'utf-8')); } catch { return []; }
  const pkgs = (doc as Record<string, unknown> | null)?.['packages'];
  if (!Array.isArray(pkgs)) return [];
  const result: Array<{ name: string; version: string }> = [];
  for (const p of pkgs) {
    if (typeof p !== 'object' || p === null) continue;
    const r = p as Record<string, unknown>;
    const name = typeof r['name'] === 'string' ? r['name'].trim() : '';
    const version = typeof r['versionInfo'] === 'string' ? r['versionInfo'].trim() : 'unknown';
    if (name) result.push({ name, version });
  }
  return result;
}

/** Parse an SPDX tag-value document (`PackageName:` / `PackageVersion:` lines). */
export function parseSpdxTagValue(filePath: string): Array<{ name: string; version: string }> {
  let raw: string;
  try { raw = readFileSync(filePath, 'utf-8'); } catch { return []; }
  const result: Array<{ name: string; version: string }> = [];
  let current: { name: string; version: string } | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const nameMatch = line.match(/^PackageName:\s*(.+)$/);
    if (nameMatch) {
      if (current) result.push(current);
      current = { name: nameMatch[1]!.trim(), version: 'unknown' };
      continue;
    }
    const versionMatch = line.match(/^PackageVersion:\s*(.+)$/);
    if (versionMatch && current) current.version = versionMatch[1]!.trim();
  }
  if (current) result.push(current);
  return result;
}

/** SBOM file names recognised in the source tree; same patterns as the service pass profile (#3158). */
const SOURCE_SBOM_RE = /(\.cdx\.json|\.spdx\.json|\.spdx|bom\.json|sbom\.json)$/i;

/**
 * Read CycloneDX and SPDX SBOMs from the assessed source path (#3158). An
 * SBOM shipped with the application (or supplied in place of source, as in a
 * service assessment where the source path is the binary input folder) is a
 * dependency inventory in its own right. Without this, a source path with an
 * SBOM but no package.json produced a false high-severity SBOM-01 "cannot
 * perform dependency scan".
 */
function readSourceSbomFiles(sourcePath: string, maxDepth = 3): {
  packages: Array<{ name: string; version: string }>;
  files: string[];
  purls: string[];
} {
  const packages: Array<{ name: string; version: string }> = [];
  const files: string[] = [];
  const purls: string[] = [];
  if (!existsSync(sourcePath)) return { packages, files, purls };
  // #3428: central source scope (canonical skips, same depth guard).
  for (const f of listSourceFiles(sourcePath, { purpose: 'manifest', maxDepth })) {
    if (files.length >= 20) break;
    const entry = f.name;
    const full = f.abs;
    if (!SOURCE_SBOM_RE.test(entry)) continue;
    const lower = entry.toLowerCase();
    const parsed = lower.endsWith('.spdx.json')
      ? parseSpdxJson(full)
      : lower.endsWith('.spdx')
        ? parseSpdxTagValue(full)
        : parseCycloneDxJson(full);
    if (parsed.length === 0) continue;
    packages.push(...parsed);
    if (lower.endsWith('.json')) purls.push(...readSbomPurls(full));
    files.push(full.slice(sourcePath.length).replace(/\\/g, '/').replace(/^\//, ''));
  }
  return { packages, files, purls };
}

/**
 * Scan the compliance input directory for recognised SBOM files and return
 * all extracted component records together with the file paths found.
 */
function readExternalSbomInputs(complianceDir: string): {
  packages: Array<{ name: string; version: string }>;
  files: string[];
  purls: string[];
} {
  const packages: Array<{ name: string; version: string }> = [];
  const files: string[] = [];
  const purls: string[] = [];

  if (!existsSync(complianceDir)) return { packages, files, purls };

  let entries: string[] = [];
  try {
    entries = readdirSync(complianceDir);
  } catch {
    return { packages, files, purls };
  }

  for (const entry of entries) {
    const full = join(complianceDir, entry);
    if (SBOM_CSV_RE.test(entry)) {
      const parsed = parseSbomCsvSheet(full);
      if (parsed.length > 0) {
        packages.push(...parsed);
        files.push(entry);
      }
    } else if (SBOM_CDX_RE.test(entry) || /\.spdx\.json$/i.test(entry)) {
      // #3420: SPDX JSON accepted here as well; purls feed the OSV lookup.
      const parsed = /\.spdx\.json$/i.test(entry) ? parseSpdxJson(full) : parseCycloneDxJson(full);
      if (parsed.length > 0) {
        packages.push(...parsed);
        purls.push(...readSbomPurls(full));
        files.push(entry);
      }
    }
  }

  return { packages, files, purls };
}

// ---------------------------------------------------------------------------

interface StaleEntry {
  cwe: string;
  reason: string;
}

const STALE_CATALOGUE: Record<string, StaleEntry> = {
  alphavantage: { cwe: 'CWE-1104', reason: 'No npm publish since 2020; effectively unmaintained' },
  'left-pad': { cwe: 'CWE-1104', reason: 'Infamous npm removal 2016; use String.padStart' },
  'event-stream': { cwe: 'CWE-1104', reason: 'Supply chain attack 2018 (malicious maintainer)' },
  'node-uuid': { cwe: 'CWE-1104', reason: 'Deprecated; replaced by uuid' },
  'csurf': { cwe: 'CWE-1104', reason: 'Deprecated by Express team 2023' },
  'request': { cwe: 'CWE-1104', reason: 'Deprecated since 2020; no security fixes' },
};

function readJson(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function allDeps(pkg: Record<string, unknown>): Record<string, string> {
  return {
    ...((pkg.dependencies ?? {}) as Record<string, string>),
    ...((pkg.devDependencies ?? {}) as Record<string, string>),
  };
}

interface OsvVuln {
  id: string;
  summary?: string;
  severity?: Array<{ type?: string; score?: string }>;
  database_specific?: { severity?: string };
}

export type OsvSeverity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

// CVSS v3.x base-score metric weights (FIRST CVSS v3.1 specification, section 7.4).
const CVSS3_WEIGHTS: Record<string, Record<string, number>> = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  C: { H: 0.56, L: 0.22, N: 0 },
  I: { H: 0.56, L: 0.22, N: 0 },
  A: { H: 0.56, L: 0.22, N: 0 },
};

function roundUp1(x: number): number {
  const i = Math.round(x * 100000);
  return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10;
}

/** CVSS v3.x base score from a vector string, or null when the vector is incomplete. */
export function cvss3BaseScore(vector: string): number | null {
  const m: Record<string, string> = {};
  for (const part of vector.split('/')) {
    const [k, v] = part.split(':');
    if (k && v) m[k] = v;
  }
  const s = m['S'];
  const prMap = s === 'C' ? { N: 0.85, L: 0.68, H: 0.5 } : { N: 0.85, L: 0.62, H: 0.27 };
  const av = CVSS3_WEIGHTS['AV']![m['AV'] ?? ''];
  const ac = CVSS3_WEIGHTS['AC']![m['AC'] ?? ''];
  const ui = CVSS3_WEIGHTS['UI']![m['UI'] ?? ''];
  const pr = (prMap as Record<string, number>)[m['PR'] ?? ''];
  const c = CVSS3_WEIGHTS['C']![m['C'] ?? ''];
  const i = CVSS3_WEIGHTS['I']![m['I'] ?? ''];
  const a = CVSS3_WEIGHTS['A']![m['A'] ?? ''];
  if (s !== 'U' && s !== 'C') return null;
  if ([av, ac, ui, pr, c, i, a].some((w) => w === undefined)) return null;
  const iss = 1 - (1 - c!) * (1 - i!) * (1 - a!);
  const impact = s === 'U' ? 6.42 * iss : 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15);
  const exploitability = 8.22 * av! * ac! * pr! * ui!;
  if (impact <= 0) return 0;
  return s === 'U'
    ? roundUp1(Math.min(impact + exploitability, 10))
    : roundUp1(Math.min(1.08 * (impact + exploitability), 10));
}

function severityFromScore(score: number): OsvSeverity {
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  if (score > 0) return 'low';
  return 'unknown';
}

/**
 * Severity of one OSV entry (#3158). Previously every OSV entry counted as a
 * high/critical CVE. Order: the advisory database rating (GitHub advisories:
 * CRITICAL, HIGH, MODERATE, LOW), then a numeric score, then a CVSS v3 vector.
 */
export function classifyOsvSeverity(v: OsvVuln): OsvSeverity {
  const db = v.database_specific?.severity?.toUpperCase();
  if (db === 'CRITICAL') return 'critical';
  if (db === 'HIGH') return 'high';
  if (db === 'MODERATE' || db === 'MEDIUM') return 'medium';
  if (db === 'LOW') return 'low';
  for (const sev of v.severity ?? []) {
    const score = sev.score ?? '';
    if (/^\d+(\.\d+)?$/.test(score)) return severityFromScore(parseFloat(score));
    if (score.startsWith('CVSS:3')) {
      const base = cvss3BaseScore(score);
      if (base !== null) return severityFromScore(base);
    }
  }
  return 'unknown';
}

// #1494 / #3420: the OSV client (batched online lookups, offline database,
// SWAO_OSV_BASE_URL read per call) lives in osv-client.ts.

// #3423: package ecosystems whose dependencies this pass resolves and checks
// against OSV (read by the language coverage matrix). Extend when a new
// ecosystem is queried below. #3420: Maven (pom.xml, Gradle) added.
export const SBOM_OSV_ECOSYSTEMS: readonly PackageEcosystem[] = ['npm', 'Maven'];

/** Ecosystem-qualified dependency for the OSV lookup. */
interface OsvCandidate extends OsvQuery { origin: string }

/** pkg:maven/group/artifact@version and pkg:npm/(%40scope/)name@version from a supplied SBOM (#3420). */
export function osvQueryFromPurl(purl: string): OsvQuery | null {
  const m = /^pkg:(maven|npm)\/([^@?#]+)@([^?#]+)/i.exec(purl.trim());
  if (!m) return null;
  const version = decodeURIComponent(m[3]!);
  if (!isConcreteVersion(version)) return null;
  const path = decodeURIComponent(m[2]!);
  if (m[1]!.toLowerCase() === 'maven') {
    const slash = path.indexOf('/');
    if (slash <= 0) return null;
    return { ecosystem: 'Maven', name: `${path.slice(0, slash)}:${path.slice(slash + 1)}`, version };
  }
  return { ecosystem: 'npm', name: path, version };
}

const LTS_JAVA: ReadonlySet<number> = new Set([8, 11, 17, 21, 25]);

export type JavaEolStatus = 'supported' | 'eol' | 'unknown';

/**
 * #3420: EOL verdict for a Java feature release from the Pass 05 runtime EOL
 * catalogue (entry `java-<major>`). A release without a catalogue entry is
 * EOL when it is a non-LTS feature release (six months of updates) or older
 * than Java 8; anything else is unknown.
 */
export function javaEolVerdict(
  major: number,
  entries: Array<Record<string, unknown>>,
  today: string,
): { status: JavaEolStatus; eolDate: string | null; upgradePath: string | null; name: string; severity: Signal['severity'] } {
  const entry = entries.find((e) => String(e['id']) === `java-${major}`);
  if (entry) {
    const eolDate = typeof entry['eol_date'] === 'string' ? entry['eol_date'] : null;
    const status: JavaEolStatus = eolDate ? (eolDate < today ? 'eol' : 'supported') : 'unknown';
    // A supported release is positive only when the catalogue rates it so
    // (java-8: severity high, vendor support ending) - otherwise low, as the
    // #3065 catalogue loop did.
    const severity: Signal['severity'] = status === 'eol' ? 'high'
      : status === 'supported' && entry['severity'] === 'positive' ? 'positive'
      : 'low';
    return {
      status,
      severity,
      eolDate,
      upgradePath: typeof entry['upgrade_path'] === 'string' ? entry['upgrade_path'] : null,
      name: String(entry['name'] ?? `Java ${major}`),
    };
  }
  if (major < 8 || (!LTS_JAVA.has(major) && major < 25)) {
    return {
      status: 'eol',
      severity: 'high',
      eolDate: null,
      upgradePath: 'Upgrade to a supported LTS release (Java 21 or 25).',
      name: `Java ${major}${LTS_JAVA.has(major) ? '' : ' (non-LTS feature release)'}`,
    };
  }
  return { status: 'unknown', severity: 'low', eolDate: null, upgradePath: null, name: `Java ${major}` };
}

/** Cap on the per-dependency list written to the pass assessment (#3430 consumer). */
const JVM_DEPENDENCY_LIST_CAP = 500;

export async function runSbomPass(ctx: PassContext): Promise<PassResult> {
  const { sourcePath, workspacePath, appId, iter, assessedAt } = ctx;
  const signals: Signal[] = [];
  const assessment: Record<string, unknown> = {};

  // --- Scan wsp/inputs/compliance/ for external SBOM files (#1778) ---
  const complianceDir = join(workspacePath, 'wsp', 'inputs', 'compliance');
  const compliance = readExternalSbomInputs(complianceDir);
  // #3158: SBOMs in the source path count as external SBOM input as well.
  const sourceSboms = readSourceSbomFiles(sourcePath);
  const externalPackages = [...compliance.packages, ...sourceSboms.packages];
  const externalFiles = [...compliance.files, ...sourceSboms.files];
  const externalPurls = [...compliance.purls, ...sourceSboms.purls];
  const externalEvidence = [
    ...compliance.files.map((f) => `wsp/inputs/compliance/${f}`),
    ...sourceSboms.files,
  ];

  if (externalPackages.length > 0) {
    logApp(appId, 'info', 'assess.pass.sbom.external-inputs-found',
      `Pass 5 SBOM: ${externalPackages.length} component(s) loaded from ${externalFiles.length} external SBOM file(s)`,
      { context: { count: externalPackages.length, files: externalFiles } });
  }

  const pkgFiles = findPackageJsonFiles(sourcePath);
  // #3420: Maven and Gradle build files (central source scope, no own walk).
  const jvm = collectJvmProject(existsSync(sourcePath) ? sourcePath : '');
  const hasJvm = jvm.manifests.length > 0;

  // Guard: skip only when there is nothing to analyse from any source.
  if (pkgFiles.length === 0 && externalPackages.length === 0 && !hasJvm) {
    signals.push({
      id: 'SBOM-01',
      source: 'static_analysis',
      category: 'application',
      severity: 'high',
      derivation: 'No dependency manifest (package.json, pom.xml, build.gradle, build.gradle.kts) found anywhere in source tree and no external SBOM files found in wsp/inputs/compliance/. Cannot perform dependency scan.',
      evidence: [],
      confidence: 'high',
    });
    return {
      pass: { id: 5, name: 'sbom_cve', signal_prefix: 'SBOM', status: 'complete', iter, assessed_at: assessedAt },
      signals,
      assessment: { scan_type: 'skipped', reason: 'no_package_json' },
    };
  }

  // Merge dependencies from all found package.json files (monorepo support)
  const mergedDeps: Record<string, string> = {};
  const mergedRuntime: Record<string, string> = {};
  let depCount = 0;
  let nodeConstraint = 'unspecified';
  for (const pkgFile of pkgFiles) {
    const pkg = readJson(pkgFile);
    if (!pkg) continue;
    Object.assign(mergedDeps, allDeps(pkg));
    const rt = (pkg.dependencies ?? {}) as Record<string, string>;
    Object.assign(mergedRuntime, rt);
    depCount += Object.keys(rt).length;
    const eng = (pkg.engines as Record<string, string> | undefined)?.node;
    if (eng && nodeConstraint === 'unspecified') nodeConstraint = eng;
  }

  // Merge external SBOM packages into mergedDeps (stale-catalogue check only;
  // NOT into mergedRuntime to avoid cross-ecosystem OSV queries).
  for (const { name, version } of externalPackages) {
    if (!(name in mergedDeps)) {
      mergedDeps[name] = version;
    }
  }
  depCount += externalPackages.length;

  // #3420: direct, non-test JVM dependencies count towards the inventory.
  const jvmDirect = jvm.dependencies.filter((d) => d.direct);
  depCount += jvmDirect.filter((d) => d.scope !== 'test').length;

  if (externalFiles.length > 0) {
    assessment.external_sbom_files = externalFiles;
    assessment.external_sbom_component_count = externalPackages.length;
  }

  const deps = mergedDeps;
  const runtimeDeps = mergedRuntime;
  const pkgEvidence = [
    ...pkgFiles.map(f => f.replace(sourcePath, '').replace(/\\/g, '/').replace(/^\//, '')),
    ...jvm.manifests,
  ];
  const sbomEvidence = pkgEvidence.length > 0 ? pkgEvidence : externalEvidence;

  // --- SBOM-01: OSV lookup (#3420: batched, every ecosystem with a concrete version) ---
  const candidates: OsvCandidate[] = [];
  const seen = new Set<string>();
  const addCandidate = (q: OsvQuery, origin: string): void => {
    const key = `${q.ecosystem}|${q.name}|${q.version}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ ...q, origin });
  };
  let unresolvedVersions = 0;
  for (const [name, range] of Object.entries(runtimeDeps)) {
    const version = String(range).replace(/^[^0-9]*/, '');
    if (isConcreteVersion(version)) addCandidate({ ecosystem: 'npm', name, version }, 'package.json');
    else unresolvedVersions++;
  }
  for (const d of jvm.dependencies) {
    if (d.scope === 'test') continue;
    if (d.version === null) { unresolvedVersions++; continue; }
    addCandidate({ ecosystem: 'Maven', name: `${d.group}:${d.artifact}`, version: d.version }, d.manifest);
  }
  for (const purl of externalPurls) {
    const q = osvQueryFromPurl(purl);
    if (q) addCandidate(q, 'external SBOM');
  }

  const osv = await lookupOsv(candidates, { dbPath: resolveOsvDbPath(workspacePath) });
  const osvAvailable = osv.available;
  const osvResults: Array<{ name: string; version: string; vulns: OsvVuln[] }> = [];
  let vulnerablePackages = 0;
  let totalVulns = 0;
  for (let i = 0; i < osv.perQuery.length; i++) {
    const cand = candidates[i]!;
    const known = osv.perQuery[i]!.filter((v) => v.id);
    if (known.length > 0) { vulnerablePackages++; totalVulns += known.length; }
    // #3158: only high and critical entries count as high/critical CVEs.
    const criticalVulns = known.filter((v) => {
      const sev = classifyOsvSeverity(v);
      return sev === 'high' || sev === 'critical';
    });
    if (criticalVulns.length > 0) {
      osvResults.push({ name: cand.name, version: cand.version, vulns: criticalVulns });
    }
  }
  const queried = osv.queried;
  if (!osvAvailable && queried > 0) {
    const reason = osv.reason ?? `OSV API unreachable at ${osvBaseUrl()}`;
    signals.push({
      id: 'SBOM-00',
      source: 'static_analysis',
      category: 'application',
      severity: 'low',
      derivation: `Vulnerability cross-check skipped: ${reason}. Set SWAO_OSV_BASE_URL to a reachable mirror, supply an OSV database (SWAO_OSV_DB_PATH or wsp/inputs/osv/), or set SWAO_OSV_OFFLINE=true to suppress. CVE data was not verified; a manual SBOM scan is required before production.`,
      evidence: [],
      confidence: 'low',
    });
  }

  const byEcosystem: Record<OsvQuery['ecosystem'], number> = { npm: 0, Maven: 0 };
  for (const c of candidates.slice(0, queried)) byEcosystem[c.ecosystem]++;

  const highCvesFound = osvResults.length;
  assessment.scan_type = !osvAvailable ? 'static_analysis' : osv.mode === 'offline_db' ? 'osv_offline_db' : 'osv_batch';
  assessment.cve_lookup = osvAvailable ? 'completed' : 'skipped';
  assessment.full_scan_required = true;
  assessment.full_scan_gate = 'pre_migration';
  assessment.critical_cves_found = highCvesFound;
  assessment.vulnerable_packages_found = vulnerablePackages;
  assessment.known_vulnerabilities_found = totalVulns;
  assessment.dependency_count = depCount;
  assessment.osv = {
    mode: osv.mode,
    queried,
    queried_by_ecosystem: byEcosystem,
    truncated: osv.truncated,
    unresolved_versions_not_queried: unresolvedVersions,
    batch_size: OSV_BATCH_SIZE,
    query_cap: OSV_QUERY_CAP,
    detail_cap: OSV_DETAIL_CAP,
    details_fetched: osv.detailsFetched,
    details_capped: osv.detailsCapped,
    ...(osv.dbFiles.length > 0 ? { database_files: osv.dbFiles } : {}),
  };
  if (osvResults.length > 0) {
    assessment.high_critical_vulnerabilities = osvResults.slice(0, 50).map((r) => ({
      package: r.name, version: r.version, ids: r.vulns.map((v) => v.id).slice(0, 10),
    }));
  }

  // #3420: JVM build summary + per-dependency list (consumed by #3430, the
  // landing-zone footprint from build files).
  if (hasJvm) {
    assessment.jvm_build = {
      build_tools: jvm.buildTools,
      manifests: jvm.manifests,
      modules: jvm.modules,
      dependency_count: jvmDirect.length,
      transitive_locked_count: jvm.dependencies.length - jvmDirect.length,
      unresolved_version_count: jvmDirect.filter((d) => d.version === null).length,
      spring_boot: jvm.usesSpringBoot,
      spring_boot_version: jvm.springBootVersion,
    };
    const ordered = [...jvmDirect, ...jvm.dependencies.filter((d) => !d.direct)];
    assessment.jvm_dependencies = ordered.slice(0, JVM_DEPENDENCY_LIST_CAP).map((d) => ({
      group: d.group,
      artifact: d.artifact,
      version: d.version,
      scope: d.scope,
      version_source: d.versionSource,
      direct: d.direct,
      build_tool: d.buildTool,
      manifest: d.manifest,
      purl: d.purl,
    }));
    if (ordered.length > JVM_DEPENDENCY_LIST_CAP) assessment.jvm_dependencies_truncated = ordered.length - JVM_DEPENDENCY_LIST_CAP;
  }

  const sourceParts: string[] = [];
  if (pkgFiles.length > 0) sourceParts.push(`${pkgFiles.length} package.json file(s)`);
  if (hasJvm) sourceParts.push(`${jvm.manifests.length} Maven/Gradle build file(s)`);
  if (sourceParts.length === 0) sourceParts.push(`${externalFiles.length} external SBOM file(s)`);
  const lookupLabel = osv.mode === 'offline_db' ? 'Offline OSV database lookup' : 'OSV batch query';

  signals.push({
    id: 'SBOM-01',
    source: 'static_analysis',
    category: 'application',
    // #3158: with 0 dependencies queried (SBOM-only input without package URLs)
    // nothing was verified, so the result is informational rather than positive.
    severity: highCvesFound > 0 ? 'high' : vulnerablePackages > 0 ? 'medium' : queried === 0 || !osvAvailable ? 'informational' : 'positive',
    derivation: `${lookupLabel} of ${queried} dependencies (npm: ${byEcosystem.npm}, Maven: ${byEcosystem.Maven}) across ${sourceParts.join(' and ')}. CVE lookup: ${assessment.cve_lookup as string}. Packages with high/critical CVEs: ${highCvesFound}; packages with any known vulnerability: ${vulnerablePackages}.${unresolvedVersions > 0 ? ` ${unresolvedVersions} dependencies without a locally resolvable version were not queried.` : ''}${osv.truncated > 0 ? ` ${osv.truncated} dependencies beyond the cap of ${OSV_QUERY_CAP} were not queried.` : ''}${osv.detailsCapped ? ` Severity was fetched for ${osv.detailsFetched} of the advisories found (cap ${OSV_DETAIL_CAP}); the high/critical count is a lower bound.` : ''} Full automated SBOM scan required as pre-migration gate.`,
    evidence: sbomEvidence.length > 0 ? sbomEvidence : ['package.json'],
    confidence: osvAvailable ? 'medium' : 'low',
  });

  // --- SBOM-02: unmaintained package detection ---
  const staleFound: Array<{ name: string; version: string; cwe: string; reason: string }> = [];
  for (const [name, version] of Object.entries(deps)) {
    if (name in STALE_CATALOGUE) {
      staleFound.push({ name, version, ...STALE_CATALOGUE[name] });
    }
  }

  if (staleFound.length > 0) {
    for (let i = 0; i < staleFound.length; i++) {
      const entry = staleFound[i];
      signals.push({
        id: `SBOM-${String(2 + i).padStart(2, '0')}`,
        source: 'static_analysis',
        category: 'application',
        severity: 'medium',
        derivation: `${entry.name}@${entry.version} is unmaintained. ${entry.reason}. ${entry.cwe}: Use of Unmaintained Third-Party Components. Replace before production deployment.`,
        evidence: [`package.json (${entry.name}: ${entry.version})`],
        confidence: 'high',
      });
    }
    assessment.unmaintained_packages = staleFound.map((e) => ({
      name: e.name,
      version: e.version,
      cwe: e.cwe,
    }));
  }

  let nextSig = 2 + staleFound.length;
  const sigId = (): string => `SBOM-${String(nextSig++).padStart(2, '0')}`;
  const eolCatalogue = loadPassCatalog(workspacePath, 'pass-05-runtime-eol.yaml');
  const catalogueEntries = (eolCatalogue?.entries ?? []) as Array<Record<string, unknown>>;
  const today = new Date().toISOString().slice(0, 10);

  // --- Node.js runtime EOL ---
  // #3420: a Java-only service (no package.json) no longer reports
  // "Runtime: Node.js unspecified"; the Java runtime signal takes its place.
  const runtimes: string[] = [];
  if (pkgFiles.length > 0 || !hasJvm) {
    const major = parseInt(nodeConstraint.replace(/^[^0-9]*/, ''), 10);
    const eolStatus = isNaN(major)
      ? 'unknown'
      : major >= 22
        ? 'active_lts'
        : major >= 20
          ? 'maintenance_lts'
          : 'eol';
    const eolSeverity = eolStatus === 'eol' ? 'high' : eolStatus === 'maintenance_lts' ? 'low' : 'positive';

    signals.push({
      id: sigId(),
      source: 'static_analysis',
      category: 'infrastructure_platform',
      severity: eolSeverity,
      derivation: `Runtime: Node.js ${nodeConstraint}. EOL status: ${eolStatus}.${eolStatus === 'eol' ? ' Node version is past end-of-life; upgrade required before migration.' : ''}`,
      evidence: ['package.json (engines.node)'],
      confidence: nodeConstraint !== 'unspecified' ? 'high' : 'low',
    });
    runtimes.push('node');
    assessment.node_constraint = nodeConstraint;
    assessment.node_eol_status = eolStatus;
  }

  // --- #3420: Java runtime EOL (deterministic, from the build files) ---
  if (hasJvm) {
    runtimes.push('java');
    const j = jvm.java;
    if (j) {
      const verdict = javaEolVerdict(j.major, catalogueEntries, today);
      const severity = verdict.severity;
      signals.push({
        id: sigId(),
        source: 'static_analysis',
        category: 'infrastructure_platform',
        severity,
        derivation: `Runtime: ${verdict.name}, declared by ${j.key} = ${j.raw} in ${j.file}. EOL date: ${verdict.eolDate ?? 'unknown'}. EOL status: ${verdict.status}.${verdict.status === 'eol' ? ' Java release is past end-of-life; upgrade required before migration.' : ''}${verdict.upgradePath ? ` ${verdict.upgradePath}` : ''}`,
        evidence: [`${j.file} (${j.key})`],
        confidence: verdict.status === 'unknown' ? 'low' : 'high',
      });
      assessment.java_runtime = {
        major: j.major, declared: j.raw, setting: j.key, file: j.file,
        eol_date: verdict.eolDate, eol_status: verdict.status,
      };
    } else {
      signals.push({
        id: sigId(),
        source: 'static_analysis',
        category: 'infrastructure_platform',
        severity: 'low',
        derivation: `Runtime: Java (${jvm.buildTools.join(' and ')} build), release not declared in the build files (no maven.compiler.release, java.version, toolchain or sourceCompatibility). EOL status: unknown. Declare the Java release so the runtime can be checked against end-of-life dates.`,
        evidence: jvm.manifests.slice(0, 5),
        confidence: 'low',
      });
      assessment.java_runtime = { major: null, eol_status: 'unknown' };
    }
  }
  assessment.runtime = runtimes[0] ?? 'node';
  if (runtimes.length > 1) assessment.runtimes = runtimes;

  // #3065: supplement EOL detection with curated catalogue (Java, Python, .NET, OS entries).
  if (eolCatalogue) {
    const nodejsIds = new Set(['nodejs-12', 'nodejs-14', 'nodejs-16', 'nodejs-18', 'nodejs-20', 'nodejs-22']);
    for (const entry of eolCatalogue.entries) {
      if (nodejsIds.has(String(entry.id))) continue; // covered by hardcoded Node.js check
      // #3420: a Java release resolved from the build files replaces the regex match.
      if (jvm.java && entry['category'] === 'jvm_runtime') continue;
      const detection = entry.detection as { config_keys?: string[]; imports?: string[] } | undefined;
      const configKeys = detection?.config_keys ?? [];
      const matchedFile = detectRuntimeInBuildFiles(sourcePath, configKeys);
      if (!matchedFile) continue;
      const eolDate = entry.eol_date as string | undefined;
      const isEol = eolDate ? eolDate < today : false;
      const severity = entry.severity as string | undefined;
      const signalSeverity: Signal['severity'] =
        severity === 'high' && isEol ? 'high'
        : severity === 'medium' && isEol ? 'medium'
        : severity === 'positive' ? 'positive'
        : isEol ? 'medium'
        : 'low';
      signals.push({
        id: sigId(),
        source: 'static_analysis',
        category: 'infrastructure_platform',
        severity: signalSeverity,
        derivation: `Runtime detected: ${String(entry.name)}. EOL date: ${eolDate ?? 'unknown'}. Status: ${isEol ? 'end-of-life' : 'supported'}. ${String(entry.upgrade_path ?? '')}`,
        evidence: [matchedFile],
        confidence: 'medium',
      });
    }
  }

  return {
    pass: { id: 5, name: 'sbom_cve', signal_prefix: 'SBOM', status: 'complete', iter, assessed_at: assessedAt },
    signals,
    assessment,
  };
}
