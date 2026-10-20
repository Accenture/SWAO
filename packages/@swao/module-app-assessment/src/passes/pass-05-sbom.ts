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

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { PassContext, PassResult } from '@swao/core';
import type { Signal } from '@swao/core';
import { logApp } from '@swao/core';
import { loadPassCatalog } from './pass-catalog-loader.js';

// Build config files that may contain runtime version constraints.
const BUILD_CONFIG_BASENAMES = new Set([
  'build.gradle', 'build.gradle.kts', 'pom.xml', 'settings.gradle',
  'setup.py', 'setup.cfg', 'Pipfile', 'pyproject.toml',
  '.nvmrc', '.tool-versions', '.java-version', 'Dockerfile',
  'Makefile', 'CMakeLists.txt',
]);

// Returns a matching file path if any config_key regex matches a build config file in dir.
function detectRuntimeInBuildFiles(dir: string, configKeys: string[]): string | null {
  if (!existsSync(dir) || !configKeys.length) return null;
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return null; }
  for (const entry of entries) {
    if (!BUILD_CONFIG_BASENAMES.has(entry) && !entry.endsWith('.csproj') && !entry.endsWith('.fsproj')) continue;
    const full = join(dir, entry);
    try {
      const st = statSync(full);
      if (!st.isFile()) continue;
      const content = readFileSync(full, 'utf-8');
      for (const ck of configKeys) {
        try {
          if (new RegExp(ck, 'i').test(content)) return entry;
        } catch { /* skip invalid regex */ }
      }
    } catch { /* skip unreadable */ }
  }
  return null;
}

/** Find package.json files up to maxDepth levels deep, excluding node_modules. */
function findPackageJsonFiles(dir: string, maxDepth = 4): string[] {
  const results: string[] = [];
  function walk(current: string, depth: number): void {
    if (depth > maxDepth) return;
    try {
      for (const entry of readdirSync(current)) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const full = join(current, entry);
        try {
          const st = statSync(full);
          if (st.isDirectory()) {
            walk(full, depth + 1);
          } else if (entry === 'package.json' && depth > 0) {
            results.push(full);
          }
        } catch { /* skip unreadable entries */ }
      }
    } catch { /* skip unreadable dirs */ }
  }
  // Root first
  const root = join(dir, 'package.json');
  if (existsSync(root)) return [root];
  // Otherwise walk
  walk(dir, 0);
  return results.slice(0, 5); // cap at 5 to avoid scanning huge monorepos
}

// ---------------------------------------------------------------------------
// External SBOM helpers (#1778)
// ---------------------------------------------------------------------------

/** File patterns recognised as external SBOM inputs from wsp/inputs/compliance/. */
const SBOM_CSV_RE = /^SBOM-.*\.xlsx\..*\.csv$|^.*\.sbom\.csv$/;
const SBOM_CDX_RE = /^.*\.cdx\.json$/;

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
} {
  const packages: Array<{ name: string; version: string }> = [];
  const files: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth || files.length >= 20) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      let isDir = false;
      try { isDir = statSync(full).isDirectory(); } catch { continue; }
      if (isDir) { walk(full, depth + 1); continue; }
      if (!SOURCE_SBOM_RE.test(entry)) continue;
      const lower = entry.toLowerCase();
      const parsed = lower.endsWith('.spdx.json')
        ? parseSpdxJson(full)
        : lower.endsWith('.spdx')
          ? parseSpdxTagValue(full)
          : parseCycloneDxJson(full);
      if (parsed.length === 0) continue;
      packages.push(...parsed);
      files.push(full.slice(sourcePath.length).replace(/\\/g, '/').replace(/^\//, ''));
    }
  };
  if (existsSync(sourcePath)) walk(sourcePath, 0);
  return { packages, files };
}

/**
 * Scan the compliance input directory for recognised SBOM files and return
 * all extracted component records together with the file paths found.
 */
function readExternalSbomInputs(complianceDir: string): {
  packages: Array<{ name: string; version: string }>;
  files: string[];
} {
  const packages: Array<{ name: string; version: string }> = [];
  const files: string[] = [];

  if (!existsSync(complianceDir)) return { packages, files };

  let entries: string[] = [];
  try {
    entries = readdirSync(complianceDir);
  } catch {
    return { packages, files };
  }

  for (const entry of entries) {
    const full = join(complianceDir, entry);
    if (SBOM_CSV_RE.test(entry)) {
      const parsed = parseSbomCsvSheet(full);
      if (parsed.length > 0) {
        packages.push(...parsed);
        files.push(entry);
      }
    } else if (SBOM_CDX_RE.test(entry)) {
      const parsed = parseCycloneDxJson(full);
      if (parsed.length > 0) {
        packages.push(...parsed);
        files.push(entry);
      }
    }
  }

  return { packages, files };
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

// #1494: configurable base URL + offline mode for air-gapped / sovereign-cloud deployments.
const OSV_BASE_URL = process.env['SWAO_OSV_BASE_URL'] ?? 'https://api.osv.dev';

interface OsvCheckResult { reachable: boolean; vulns: OsvVuln[] }

async function checkOsv(name: string, version: string): Promise<OsvCheckResult> {
  if (process.env['SWAO_OSV_OFFLINE'] === 'true') {
    return { reachable: false, vulns: [] };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`${OSV_BASE_URL}/v1/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, package: { name, ecosystem: 'npm' } }),
      signal: controller.signal,
    });
    if (!res.ok) return { reachable: true, vulns: [] };
    const data = (await res.json()) as { vulns?: OsvVuln[] };
    return { reachable: true, vulns: data.vulns ?? [] };
  } catch {
    return { reachable: false, vulns: [] };
  } finally {
    clearTimeout(timeout);
  }
}

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

  // Guard: skip only when there is nothing to analyse from either source.
  if (pkgFiles.length === 0 && externalPackages.length === 0) {
    signals.push({
      id: 'SBOM-01',
      source: 'static_analysis',
      category: 'application',
      severity: 'high',
      derivation: 'package.json not found anywhere in source tree and no external SBOM files found in wsp/inputs/compliance/. Cannot perform dependency scan.',
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

  if (externalFiles.length > 0) {
    assessment.external_sbom_files = externalFiles;
    assessment.external_sbom_component_count = externalPackages.length;
  }

  const deps = mergedDeps;
  const runtimeDeps = mergedRuntime;
  const pkgEvidence = pkgFiles.length > 0
    ? pkgFiles.map(f => f.replace(sourcePath, '').replace(/\\/g, '/').replace(/^\//, ''))
    : externalEvidence;

  // --- SBOM-01: spot check key deps against OSV (with graceful degrade) ---
  const spotCheckNames = Object.keys(runtimeDeps).slice(0, 10);
  const osvResults: Array<{ name: string; version: string; vulns: OsvVuln[] }> = [];
  let osvAvailable = false;
  let vulnerablePackages = 0;
  let totalVulns = 0;

  for (const name of spotCheckNames) {
    const version = runtimeDeps[name]!.replace(/^[^0-9]*/, '');
    const { reachable, vulns } = await checkOsv(name, version);
    if (reachable) osvAvailable = true;
    const known = vulns.filter((v) => v.id);
    if (known.length > 0) { vulnerablePackages++; totalVulns += known.length; }
    // #3158: only high and critical entries count as high/critical CVEs.
    const criticalVulns = known.filter((v) => {
      const sev = classifyOsvSeverity(v);
      return sev === 'high' || sev === 'critical';
    });
    if (criticalVulns.length > 0) {
      osvResults.push({ name, version, vulns: criticalVulns });
    }
  }
  if (!osvAvailable && spotCheckNames.length > 0) {
    const reason = process.env['SWAO_OSV_OFFLINE'] === 'true'
      ? 'offline mode (SWAO_OSV_OFFLINE=true)'
      : `OSV API unreachable at ${OSV_BASE_URL} -- set SWAO_OSV_BASE_URL to a reachable mirror or SWAO_OSV_OFFLINE=true to suppress`;
    signals.push({
      id: 'SBOM-00',
      source: 'static_analysis',
      category: 'application',
      severity: 'low',
      derivation: `Vulnerability cross-check skipped: ${reason}. CVE data was not verified; a manual SBOM scan is required before production.`,
      evidence: [],
      confidence: 'low',
    });
  }

  const highCvesFound = osvResults.length;
  assessment.scan_type = osvAvailable ? 'osv_spot_check' : 'static_analysis';
  assessment.cve_lookup = osvAvailable ? 'completed' : 'skipped';
  assessment.full_scan_required = true;
  assessment.full_scan_gate = 'pre_migration';
  assessment.critical_cves_found = highCvesFound;
  assessment.vulnerable_packages_found = vulnerablePackages;
  assessment.known_vulnerabilities_found = totalVulns;
  assessment.dependency_count = depCount;

  const derivationSources = pkgFiles.length > 0
    ? `${pkgFiles.length} package.json file(s)`
    : `${externalFiles.length} external SBOM file(s)`;

  signals.push({
    id: 'SBOM-01',
    source: 'static_analysis',
    category: 'application',
    // #3158: with 0 runtime dependencies spot-checked (SBOM-only input) nothing
    // was verified, so the result is informational rather than positive.
    severity: highCvesFound > 0 ? 'high' : vulnerablePackages > 0 ? 'medium' : spotCheckNames.length === 0 ? 'informational' : 'positive',
    derivation: `Spot check of ${spotCheckNames.length} runtime dependencies across ${derivationSources}. CVE lookup: ${assessment.cve_lookup as string}. Packages with high/critical CVEs: ${highCvesFound}; packages with any known vulnerability: ${vulnerablePackages}. Full automated SBOM scan required as pre-migration gate.`,
    evidence: pkgEvidence.length > 0 ? pkgEvidence : ['package.json'],
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

  // --- next signal: Node.js runtime EOL ---
  const signalNum = 2 + staleFound.length;
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
    id: `SBOM-${String(signalNum).padStart(2, '0')}`,
    source: 'static_analysis',
    category: 'infrastructure_platform',
    severity: eolSeverity,
    derivation: `Runtime: Node.js ${nodeConstraint}. EOL status: ${eolStatus}.${eolStatus === 'eol' ? ' Node version is past end-of-life; upgrade required before migration.' : ''}`,
    evidence: ['package.json (engines.node)'],
    confidence: nodeConstraint !== 'unspecified' ? 'high' : 'low',
  });

  assessment.runtime = 'node';
  assessment.node_constraint = nodeConstraint;
  assessment.node_eol_status = eolStatus;

  // #3065: supplement EOL detection with curated catalogue (Java, Python, .NET, OS entries).
  const eolCatalogue = loadPassCatalog(workspacePath, 'pass-05-runtime-eol.yaml');
  if (eolCatalogue) {
    const today = new Date().toISOString().slice(0, 10);
    const nodejsIds = new Set(['nodejs-12', 'nodejs-14', 'nodejs-16', 'nodejs-18', 'nodejs-20', 'nodejs-22']);
    let catalogueSigNum = 2 + staleFound.length + 1; // after Node.js signal
    for (const entry of eolCatalogue.entries) {
      if (nodejsIds.has(String(entry.id))) continue; // covered by hardcoded Node.js check
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
        id: `SBOM-${String(catalogueSigNum).padStart(2, '0')}`,
        source: 'static_analysis',
        category: 'infrastructure_platform',
        severity: signalSeverity,
        derivation: `Runtime detected: ${String(entry.name)}. EOL date: ${eolDate ?? 'unknown'}. Status: ${isEol ? 'end-of-life' : 'supported'}. ${String(entry.upgrade_path ?? '')}`,
        evidence: [matchedFile],
        confidence: 'medium',
      });
      catalogueSigNum++;
    }
  }

  return {
    pass: { id: 5, name: 'sbom_cve', signal_prefix: 'SBOM', status: 'complete', iter, assessed_at: assessedAt },
    signals,
    assessment,
  };
}
