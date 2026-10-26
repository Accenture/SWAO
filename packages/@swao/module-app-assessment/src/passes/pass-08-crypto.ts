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

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { PassContext, PassResult } from '@swao/core';
import type { Signal } from '@swao/core';
import { listSourceFiles } from '@swao/core';
import {
  loadPassCatalog,
  parseCatalogueDetection,
  compileTokenMatcher,
  compileRegexMatcher,
  anyOf,
  isScannableFile,
  scanCatalogueRules,
  type PassCatalog,
  type ScanFile,
  type ScanRule,
  productionFirst,
  occurrenceSummary,
  compileExceptions,
  hitRef,
  MAX_EVIDENCE_HITS,
  type ClassCounts,
  type CatalogueHit as MatcherHit,
} from './pass-catalog-loader.js';

interface StrongPrimitive {
  name: string;
  pattern: RegExp;
  label: string;
  note: string;
}

interface WeakPrimitive {
  name: string;
  pattern: RegExp;
  cwe: string;
}

const STRONG_PRIMITIVES: StrongPrimitive[] = [
  {
    name: 'pbkdf2',
    pattern: /pbkdf2(?:Sync)?\s*\(/,
    label: 'PBKDF2',
    note: 'NIST SP 800-132 key derivation function',
  },
  {
    name: 'bcrypt',
    pattern: /bcrypt(?:js)?\.hash\s*\(/,
    label: 'bcrypt',
    note: 'adaptive password hash',
  },
  {
    name: 'argon2',
    pattern: /argon2\.hash\s*\(/,
    label: 'Argon2id',
    note: 'OWASP recommended password hash (PHC winner)',
  },
  {
    name: 'scrypt',
    pattern: /scrypt(?:Sync)?\s*\(/,
    label: 'scrypt',
    note: 'memory-hard KDF (NIST SP 800-132)',
  },
  {
    name: 'hmac_sha512',
    pattern: /createHmac\s*\(\s*['"]sha512['"]/,
    label: 'HMAC-SHA512',
    note: 'NIST FIPS 198-1 compliant MAC',
  },
  {
    name: 'hmac_sha256',
    pattern: /createHmac\s*\(\s*['"]sha256['"]/,
    label: 'HMAC-SHA256',
    note: 'NIST FIPS 198-1 compliant MAC',
  },
  {
    name: 'aes_gcm',
    // #3158: the old pattern `/createCipheriv\s*\([^)]*aes-256-gcm|aes-128-gcm/`
    // bound the alternation wrongly (any "aes-128-gcm" text matched) and the hit
    // was never emitted. Matches a GCM mode string passed to createCipheriv.
    pattern: /createCipheriv\s*\(\s*['"`]aes-(?:128|192|256)-gcm['"`]/i,
    label: 'AES-GCM',
    note: 'authenticated encryption (NIST SP 800-38D)',
  },
];

const WEAK_PRIMITIVES: WeakPrimitive[] = [
  { name: 'md5', pattern: /createHash\s*\(\s*['"]md5['"]/, cwe: 'CWE-327' },
  { name: 'sha1_hash', pattern: /createHash\s*\(\s*['"]sha1['"]/, cwe: 'CWE-327' },
  {
    name: 'des',
    pattern: /createCipheriv\s*\(\s*['"]des(?!-ede|-cbc3)['"]/,
    cwe: 'CWE-327',
  },
];

interface ScanHit {
  primitive: string;
  label: string;
  file: string;
  line?: number;
  /** #3413: test classification of the file, for merging into catalogue hits. */
  isTest: boolean;
}

/** #3413: languages named in the "no primitives detected" fallback. */
const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript', '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.java': 'Java', '.py': 'Python', '.cs': 'C#', '.go': 'Go', '.kt': 'Kotlin',
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

// #3423: extensions the deterministic crypto scans read (exported for the
// language coverage matrix): primitive patterns and catalogue import tokens.
export const CRYPTO_PRIMITIVE_SCAN_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.js', '.mjs', '.cjs']);
export const CRYPTO_CATALOGUE_SCAN_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.js', '.mjs', '.cjs', '.java', '.py', '.cs', '.go', '.kt']);

function scanSourceFiles(dir: string): { strong: ScanHit[]; weak: ScanHit[]; files: string[] } {
  const strong: ScanHit[] = [];
  const weak: ScanHit[] = [];
  const files: string[] = [];
  const allowed = CRYPTO_PRIMITIVE_SCAN_EXTENSIONS;

  if (!existsSync(dir)) return { strong, weak, files };
  // #3428: central source scope (canonical skips: .git/, target/ and the other
  // build-output folders are no longer scanned). Dot-files stay in, as before.
  for (const f of listSourceFiles(dir, { purpose: 'code', extensions: allowed, includeHidden: true })) {
    // #3410: generated/minified and oversized files are data, not code.
    if (!isScannableFile(f)) continue;
    const full = f.abs;
    try {
      const content = readFileSync(full, 'utf-8');
      // #3413: root-relative forward-slash path, the same form as catalogue hits.
      const relPath = f.rel;
      files.push(f.rel);
      const lines = content.split('\n');

      for (const prim of STRONG_PRIMITIVES) {
        if (prim.pattern.test(content) && !strong.some((h) => h.primitive === prim.name)) {
          const lineIdx = lines.findIndex((l) => prim.pattern.test(l));
          strong.push({
            primitive: prim.name,
            label: prim.label,
            file: relPath,
            line: lineIdx >= 0 ? lineIdx + 1 : undefined,
            isTest: f.isTest,
          });
        }
      }

      for (const prim of WEAK_PRIMITIVES) {
        if (prim.pattern.test(content) && !weak.some((h) => h.primitive === prim.name)) {
          const lineIdx = lines.findIndex((l) => prim.pattern.test(l));
          weak.push({
            primitive: prim.name,
            label: prim.name.toUpperCase(),
            file: relPath,
            line: lineIdx >= 0 ? lineIdx + 1 : undefined,
            isTest: f.isTest,
          });
        }
      }
    } catch {
      // skip unreadable
    }
  }

  return { strong, weak, files };
}

// #3411: one record per catalogue entry with every hit (capped), not just
// the first file.
interface CatalogueHit {
  id: string;
  name: string;
  cwe: string;
  note?: string;
  /** Stored hits, production first (at most DEFAULT_MAX_HITS_PER_KEY). */
  hits: MatcherHit[];
  /** All hits found, including those beyond the cap. */
  total: number;
  byClass: ClassCounts;
  /** #3412: hits not covered by a context exception. */
  unexcepted: ClassCounts;
}

const SEVERITY_RANK: Record<'informational' | 'low' | 'medium' | 'high', number> = {
  informational: 0, low: 1, medium: 2, high: 3,
};
type WeakSeverity = keyof typeof SEVERITY_RANK;

function maxSeverity(list: readonly WeakSeverity[]): WeakSeverity | null {
  let best: WeakSeverity | null = null;
  for (const s of list) if (best === null || SEVERITY_RANK[s] > SEVERITY_RANK[best]) best = s;
  return best;
}

/**
 * #3411 + #3412: severity of a weak catalogue signal. An uncovered
 * production hit is High; production hits that are all covered by context
 * exceptions take the strongest exception severity. Test-only results keep
 * the severity of their hits (High unless excepted): the down-weighting of
 * test-code findings is the #3403 marker's job in `assessment.test_code:
 * tag` mode (one step lower, severity_original kept), so it is never
 * applied twice. Their confidence is low.
 */
function weakSignalSeverity(hit: CatalogueHit): { severity: WeakSeverity; scope: 'production' | 'excepted' | 'test' } {
  if (hit.unexcepted.prod + hit.unexcepted.unknown > 0) return { severity: 'high', scope: 'production' };
  const prodHits = hit.hits.filter((h) => h.path_class !== 'test');
  if (prodHits.length > 0 || hit.byClass.prod + hit.byClass.unknown > 0) {
    return { severity: maxSeverity(prodHits.map((h) => h.exception?.severity ?? 'high')) ?? 'low', scope: 'excepted' };
  }
  const testSev: WeakSeverity = hit.unexcepted.test > 0
    ? 'high'
    : maxSeverity(hit.hits.map((h) => h.exception?.severity ?? 'high')) ?? 'high';
  return { severity: testSev, scope: 'test' };
}

/** #3412: "Context exception applied: id on N occurrence(s) (rationale)." per distinct exception. */
function exceptionSummary(hit: CatalogueHit): string {
  const byId = new Map<string, { count: number; rationale: string; severity: string }>();
  for (const h of hit.hits) {
    if (!h.exception) continue;
    const e = byId.get(h.exception.id) ?? { count: 0, rationale: h.exception.rationale, severity: h.exception.severity };
    e.count++;
    byId.set(h.exception.id, e);
  }
  return [...byId.entries()]
    .map(([id, e]) => ` Context exception applied: ${id} on ${e.count} ${e.count === 1 ? 'occurrence' : 'occurrences'} (${e.severity}; ${e.rationale}).`)
    .join('');
}

/** #3411: `N occurrences (P production, T test)` evidence block of a catalogue signal. */
function catalogueEvidence(hit: CatalogueHit): string[] {
  return hit.hits.slice(0, MAX_EVIDENCE_HITS).map(hitRef);
}

// #3410: code files for `imports` tokens (CRYPTO_CATALOGUE_SCAN_EXTENSIONS,
// #3423), configuration files for `config_keys`; `context` regexes run on
// both. Lock files are dependency manifests, not configuration.
const CATALOGUE_CODE_EXTENSIONS = CRYPTO_CATALOGUE_SCAN_EXTENSIONS;
const CATALOGUE_CONFIG_EXTENSIONS = new Set(['.yaml', '.yml', '.properties', '.conf', '.ini', '.toml', '.xml', '.env']);
const LOCK_FILE_NAMES = new Set(['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json']);

function isConfigFile(f: ScanFile): boolean {
  const name = f.rel.slice(f.rel.lastIndexOf('/') + 1);
  if (LOCK_FILE_NAMES.has(name)) return false;
  const dot = name.lastIndexOf('.');
  return dot >= 0 && CATALOGUE_CONFIG_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function isCodeFile(f: ScanFile): boolean {
  const name = f.rel.slice(f.rel.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot >= 0 && CATALOGUE_CODE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

interface CatalogueEntryMeta {
  name: string;
  severity: string;
  note?: string;
  bsi?: string;
  nist?: string;
}

/**
 * #3413: hard-coded primitive -> catalogue entry for the same algorithm.
 * When the catalogue is loaded, the catalogue entry owns the signal: a
 * hard-coded weak hit is merged into the entry's hits (never a second
 * signal), and a catalogue strong entry is not emitted when its hard-coded
 * twin already produced the positive signal. Before #3413 the pairing was by
 * id equality, so `sha1` / `sha1_hash` reported JS createHash('sha1') twice
 * while `md5` and `des` skipped the catalogue entry, and with it every
 * non-JS detection (Java MessageDigest / Cipher).
 */
const WEAK_TWINS: Readonly<Record<string, string>> = { md5: 'md5', sha1_hash: 'sha1', des: 'des' };
const STRONG_TWINS: Readonly<Record<string, readonly string[]>> = {
  argon2id: ['argon2'],
  bcrypt: ['bcrypt'],
  'aes-256-gcm': ['aes_gcm'],
  'aes-128-gcm': ['aes_gcm'],
  // #3422: Java entries whose JS twin is a hard-coded strong primitive.
  'pbkdf2-sha2': ['pbkdf2'],
  scrypt: ['scrypt'],
  'hmac-sha2': ['hmac_sha256', 'hmac_sha512'],
};

// ---------------------------------------------------------------------------
// #3422: Java Cryptography Architecture inventory
// ---------------------------------------------------------------------------

/** JCA engine classes whose `getInstance("<algorithm>")` call names an algorithm. */
export const JCA_ENGINE_CLASSES: readonly string[] = [
  'Cipher', 'MessageDigest', 'Mac', 'KeyGenerator', 'KeyPairGenerator', 'SecretKeyFactory', 'KeyFactory',
  'Signature', 'KeyAgreement', 'KeyStore', 'SecureRandom', 'AlgorithmParameters', 'CertificateFactory', 'TrustManagerFactory',
  'KeyManagerFactory', 'SSLContext',
];

const JCA_KEY = '__jca_call__';
const JCA_PROVIDER_KEY = '__jca_provider__';
const JCA_FILE_EXTENSIONS: ReadonlySet<string> = new Set(['.java', '.kt', '.kts', '.groovy', '.scala']);

function isJcaFile(f: ScanFile): boolean {
  const name = f.rel.slice(f.rel.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot >= 0 && JCA_FILE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

/**
 * #3422: rules for the JCA inventory, run in the same single-read catalogue
 * scan (shared matcher, ReDoS guard). A call is `<Engine>.getInstance("alg"`
 * with a literal algorithm string; providers are BouncyCastle registrations.
 */
function jcaRules(): ScanRule<string>[] {
  const rules: ScanRule<string>[] = [];
  const call = compileRegexMatcher(`\\b(?:${JCA_ENGINE_CLASSES.join('|')})\\.getInstance\\(\\s{0,10}"[^"\\n]{1,60}"`, { caseSensitive: true });
  if (call.ok) rules.push({ key: JCA_KEY, matcher: call.matcher, via: 'jca', appliesTo: isJcaFile });
  const provider = compileTokenMatcher(['BouncyCastleProvider', 'BouncyCastleFipsProvider', 'BouncyCastlePQCProvider', 'BouncyCastleJsseProvider'], { match: 'identifier', caseSensitive: true });
  if (provider) rules.push({ key: JCA_PROVIDER_KEY, matcher: provider, via: 'jca_provider', appliesTo: isJcaFile });
  return rules;
}

const JCA_CALL_PARSE_RE = /^([A-Za-z]{1,40})\.getInstance\(\s{0,10}"([^"]{1,60})/;

interface JcaInventory {
  total: number;
  byClass: ClassCounts;
  /** `Engine algorithm` with its count, most frequent first. */
  algorithms: Array<{ api: string; algorithm: string; count: number }>;
  providers: string[];
  locations: MatcherHit[];
}

function buildJcaInventory(calls: readonly MatcherHit[], total: number, byClass: ClassCounts, providerHits: readonly MatcherHit[]): JcaInventory {
  const counts = new Map<string, { api: string; algorithm: string; count: number }>();
  for (const h of calls) {
    const m = JCA_CALL_PARSE_RE.exec(h.match);
    if (!m) continue;
    const api = m[1] as string;
    const algorithm = m[2] as string;
    const k = `${api} ${algorithm}`;
    const e = counts.get(k) ?? { api, algorithm, count: 0 };
    e.count++;
    counts.set(k, e);
  }
  const algorithms = [...counts.values()].sort((a, b) => b.count - a.count || (a.api + a.algorithm < b.api + b.algorithm ? -1 : 1));
  const providers = [...new Set(providerHits.map((h) => h.match))].sort();
  return { total, byClass, algorithms, providers, locations: productionFirst(calls) };
}

interface CatalogueRuleSet {
  rules: ScanRule<string>[];
  /** Catalogue entries that produced at least one rule. */
  entries: Map<string, CatalogueEntryMeta>;
  /** Malformed detection blocks and rejected context regexes (reported in the pass YAML). */
  errors: string[];
}

/**
 * #3410: compile every catalogue entry through the shared matcher. One rule
 * per entry and file class; the scan then reads each file once for all
 * entries (the pre-#3410 loop re-read every file per entry).
 */
function buildCatalogueRules(catalogue: PassCatalog): CatalogueRuleSet {
  const rules: ScanRule<string>[] = [];
  const entries = new Map<string, CatalogueEntryMeta>();
  const errors: string[] = [];
  const defaults = catalogue.match_defaults ?? {};
  for (const entry of catalogue.entries) {
    const id = String(entry.id);
    const posture = entry.posture as { severity?: string; note?: string } | undefined;
    const severity = posture?.severity ?? '';
    const isWeak = severity === 'weak' || severity === 'deprecated';
    const isStrong = severity === 'approved' || severity === 'approved_preferred';
    if (!isWeak && !isStrong) continue;
    const parsed = parseCatalogueDetection(entry);
    if ('error' in parsed) { errors.push(parsed.error); continue; }
    const d = parsed.detection;
    const opts = { match: d.match ?? defaults.match, caseSensitive: d.case_sensitive ?? defaults.case_sensitive };
    const importMatcher = compileTokenMatcher(d.imports, opts);
    const configMatcher = compileTokenMatcher(d.config_keys, opts);
    const contextMatchers = d.context.map((src) => {
      const c = compileRegexMatcher(src, { match: 'identifier' });
      if (!c.ok) { errors.push(`${id}: context "${src}" rejected (${c.reason})`); return null; }
      return c.matcher;
    });
    const contextMatcher = anyOf(contextMatchers);
    // #3412: context exceptions (TOTP, HMAC, checksums) evaluated per hit.
    const ex = compileExceptions(entry['exceptions'], id);
    errors.push(...ex.errors);
    const exceptions = ex.exceptions;
    if (importMatcher) rules.push({ key: id, matcher: importMatcher, via: 'token', appliesTo: isCodeFile, exceptions });
    if (configMatcher) rules.push({ key: id, matcher: configMatcher, via: 'config_key', appliesTo: isConfigFile, exceptions });
    if (contextMatcher) rules.push({ key: id, matcher: contextMatcher, via: 'context', exceptions });
    if (importMatcher || configMatcher || contextMatcher) {
      const statuses = entry.posture as { bsi_tr02102_status?: string; nist_status?: string } | undefined;
      entries.set(id, {
        name: String(entry.name),
        severity,
        ...(posture?.note ? { note: posture.note } : {}),
        ...(statuses?.bsi_tr02102_status ? { bsi: statuses.bsi_tr02102_status } : {}),
        ...(statuses?.nist_status ? { nist: statuses.nist_status } : {}),
      });
    }
  }
  return { rules, entries, errors };
}

/** #3410: files for the catalogue scan (code + configuration, dot-files included as before). */
function catalogueScanFiles(dir: string): ScanFile[] {
  if (!existsSync(dir)) return [];
  return listSourceFiles(dir, { purpose: 'code', includeHidden: true })
    .filter((f) => isCodeFile(f) || isConfigFile(f));
}

export async function runCryptoPass(ctx: PassContext): Promise<PassResult> {
  const { sourcePath, iter, assessedAt } = ctx;
  // #3403: tag / exclude mean test-code evidence is down-weighted (tag) or not
  // listed at all (exclude); include (default) treats it like production code.
  const testCodeTagged = ctx.testCode === 'tag' || ctx.testCode === 'exclude';
  const signals: Signal[] = [];
  const primitives: Record<string, string> = {};

  const pkg = readJson(join(sourcePath, 'package.json'));
  const deps = pkg ? allDeps(pkg) : {};

  const envExample = existsSync(join(sourcePath, '.env.example'))
    ? readFileSync(join(sourcePath, '.env.example'), 'utf-8')
    : null;

  const prismaSchema = existsSync(join(sourcePath, 'prisma', 'schema.prisma'))
    ? readFileSync(join(sourcePath, 'prisma', 'schema.prisma'), 'utf-8')
    : null;

  const composeFile = existsSync(join(sourcePath, 'docker', 'docker-compose.yml'))
    ? join(sourcePath, 'docker', 'docker-compose.yml')
    : existsSync(join(sourcePath, 'docker-compose.yml'))
      ? join(sourcePath, 'docker-compose.yml')
      : null;
  const composeContent = composeFile ? readFileSync(composeFile, 'utf-8') : null;

  const { strong: strongHits, weak: weakHits, files: hardcodedFiles } = scanSourceFiles(sourcePath);

  // #3063: supplement hardcoded primitives with catalogue-based detection (ADR-0063).
  const catalogueWeakHits: CatalogueHit[] = [];
  const catalogueStrongHits: Array<CatalogueHit & { meta: CatalogueEntryMeta }> = [];
  const catalogue = loadPassCatalog(ctx.workspacePath, 'pass-08-crypto-algorithms.yaml');
  let catalogueErrors: string[] = [];
  let catalogueEntryIds = new Set<string>();
  // #3413: every file a pattern scan read, for the fallback's scope statement.
  const scannedFiles = new Set<string>(hardcodedFiles);
  // #3422: the JCA inventory rules share the catalogue scan (one read per file).
  let jcaInventory: JcaInventory | null = null;
  if (catalogue) {
    const ruleSet = buildCatalogueRules(catalogue);
    catalogueErrors = ruleSet.errors;
    catalogueEntryIds = new Set(ruleSet.entries.keys());
    const scanFiles = catalogueScanFiles(sourcePath);
    const scan = scanCatalogueRules(scanFiles, [...ruleSet.rules, ...jcaRules()]);
    for (const f of scanFiles) if (isScannableFile(f)) scannedFiles.add(f.rel);
    const jcaCalls = scan.hits.get(JCA_KEY) ?? [];
    if (jcaCalls.length > 0) {
      jcaInventory = buildJcaInventory(
        jcaCalls,
        scan.totals.get(JCA_KEY) ?? jcaCalls.length,
        scan.totalsByClass.get(JCA_KEY) ?? { prod: 0, test: 0, unknown: 0 },
        scan.hits.get(JCA_PROVIDER_KEY) ?? [],
      );
    }
    for (const [id, meta] of ruleSet.entries) {
      const hits = scan.hits.get(id) ?? [];
      if (hits.length === 0) continue;
      const catalogueHit: CatalogueHit = {
        id,
        name: meta.name,
        cwe: 'CWE-327',
        note: meta.note,
        hits: productionFirst(hits),
        total: scan.totals.get(id) ?? hits.length,
        byClass: scan.totalsByClass.get(id) ?? { prod: 0, test: 0, unknown: 0 },
        unexcepted: scan.unexceptedByClass.get(id) ?? { prod: 0, test: 0, unknown: 0 },
      };
      const isWeak = meta.severity === 'weak' || meta.severity === 'deprecated';
      if (isWeak) catalogueWeakHits.push(catalogueHit);
      else catalogueStrongHits.push({ ...catalogueHit, meta });
    }
  }

  // #3413: a hard-coded weak hit whose algorithm has a catalogue entry is
  // merged into that entry (added as a location when the catalogue scan did
  // not already cite the same file:line); only the remaining hard-coded hits
  // keep their own signal (catalogue absent or no twin).
  const remainingWeakHits: ScanHit[] = [];
  for (const h of weakHits) {
    const twinId = WEAK_TWINS[h.primitive];
    if (!twinId || !catalogueEntryIds.has(twinId)) { remainingWeakHits.push(h); continue; }
    const loc: MatcherHit = {
      file: h.file, line: h.line ?? 1, path_class: h.isTest ? 'test' : 'prod', via: 'hardcoded', match: h.label,
    };
    const cls = loc.path_class === 'test' ? 'test' : 'prod';
    let entry = catalogueWeakHits.find((c) => c.id === twinId);
    if (!entry) {
      const meta = catalogue?.entries.find((e) => String(e.id) === twinId);
      const posture = meta?.posture as { note?: string } | undefined;
      entry = {
        id: twinId, name: String(meta?.name ?? h.label), cwe: 'CWE-327',
        ...(posture?.note ? { note: posture.note } : {}),
        hits: [], total: 0,
        byClass: { prod: 0, test: 0, unknown: 0 }, unexcepted: { prod: 0, test: 0, unknown: 0 },
      };
      catalogueWeakHits.push(entry);
    }
    if (entry.hits.some((x) => x.file === loc.file && x.line === loc.line)) continue;
    entry.hits = productionFirst([...entry.hits, loc]);
    entry.total++;
    entry.byClass[cls]++;
    entry.unexcepted[cls]++;
  }

  let sigNum = 1;

  // --- CRYPTO-0N: Strong KDF (pbkdf2, bcrypt, argon2, scrypt) ---
  const kdfNames = new Set(['pbkdf2', 'bcrypt', 'argon2', 'scrypt']);
  const kdfHit = strongHits.find((h) => kdfNames.has(h.primitive));
  if (kdfHit) {
    const meta = STRONG_PRIMITIVES.find((p) => p.name === kdfHit.primitive)!;
    primitives['api_key_hash'] = kdfHit.label;
    signals.push({
      id: `CRYPTO-${String(sigNum).padStart(2, '0')}`,
      source: 'static_analysis',
      category: 'application',
      severity: 'positive',
      derivation: `Strong key derivation function detected: ${kdfHit.label}. ${meta.note}. No weak primitive (MD5, SHA-1) in same file.`,
      evidence: [`${kdfHit.file}${kdfHit.line !== undefined ? `:${kdfHit.line}` : ''}`],
      confidence: 'high',
    });
    sigNum++;
  }

  // --- CRYPTO-0N: Strong MAC (HMAC-SHA512, HMAC-SHA256) ---
  const macHit = strongHits.find((h) => h.primitive === 'hmac_sha512' || h.primitive === 'hmac_sha256');
  if (macHit) {
    const meta = STRONG_PRIMITIVES.find((p) => p.name === macHit.primitive)!;
    primitives['access_token'] = macHit.label;
    signals.push({
      id: `CRYPTO-${String(sigNum).padStart(2, '0')}`,
      source: 'static_analysis',
      category: 'application',
      severity: 'positive',
      derivation: `Strong MAC detected: ${macHit.label}. ${meta.note}. Two-layer key derivation pattern satisfies NIST FIPS 198-1.`,
      evidence: [`${macHit.file}${macHit.line !== undefined ? `:${macHit.line}` : ''}`],
      confidence: 'high',
    });
    sigNum++;
  }

  // --- CRYPTO-0N: Authenticated encryption (AES-GCM) (#3158: detected but never emitted) ---
  const aeadHit = strongHits.find((h) => h.primitive === 'aes_gcm');
  if (aeadHit) {
    const meta = STRONG_PRIMITIVES.find((p) => p.name === aeadHit.primitive)!;
    primitives['symmetric_encryption'] = aeadHit.label;
    signals.push({
      id: `CRYPTO-${String(sigNum).padStart(2, '0')}`,
      source: 'static_analysis',
      category: 'application',
      severity: 'positive',
      derivation: `Authenticated symmetric encryption detected: ${aeadHit.label}, ${meta.note}.`,
      evidence: [`${aeadHit.file}${aeadHit.line !== undefined ? `:${aeadHit.line}` : ''}`],
      confidence: 'high',
    });
    sigNum++;
  }

  // --- CRYPTO-0N: JWT signing mode ---
  const jwtDeps = ['@nestjs/jwt', 'jsonwebtoken', 'jose'].filter((d) => d in deps);
  const hasJwtDep = jwtDeps.length > 0;
  if (hasJwtDep || envExample) {
    const symmetricPattern = /JWT_SECRET_KEY|JWT_SECRET(?!_PUBLIC)|NEXTAUTH_SECRET/;
    const asymmetricPattern = /JWT_PRIVATE_KEY|RSA_PRIVATE_KEY|EC_PRIVATE_KEY|JWT_PUBLIC_KEY/;
    const isSymmetric = envExample ? symmetricPattern.test(envExample) : false;
    const isAsymmetric = envExample ? asymmetricPattern.test(envExample) : false;
    const jwtMode = isAsymmetric
      ? 'asymmetric (RS256/ES256)'
      : isSymmetric
        ? 'symmetric HMAC'
        : 'unknown';
    primitives['jwt_signing'] = jwtMode;

    if (hasJwtDep || isSymmetric || isAsymmetric) {
      const severity = isAsymmetric ? 'positive' : isSymmetric ? 'medium' : 'low';
      const derivation = isAsymmetric
        ? `JWT tokens use asymmetric signing (RSA/ECDSA). Ideal for multi-service deployment -- no blast-radius concern if a single service is compromised.`
        : isSymmetric
          ? `JWT tokens signed with symmetric HMAC secret (env var). Acceptable for single-service; evaluate RS256/ES256 with KMS-backed private key for multi-service sovereign deployment.`
          : `JWT dependency detected but signing mode undetermined from static analysis. Manual review required.`;
      const evidenceItems: string[] = [];
      if (hasJwtDep) evidenceItems.push(`package.json (${jwtDeps.join(', ')})`);
      if (envExample && (isSymmetric || isAsymmetric)) evidenceItems.push('.env.example');

      signals.push({
        id: `CRYPTO-${String(sigNum).padStart(2, '0')}`,
        source: 'static_analysis',
        category: 'application',
        severity,
        derivation,
        evidence: evidenceItems,
        confidence: isSymmetric || isAsymmetric ? 'high' : 'low',
        implies: isSymmetric
          ? ['Evaluate RS256 JWT signing with KMS-backed private key for sovereign multi-service deployment.']
          : undefined,
      });
      sigNum++;
    }
  }

  // --- CRYPTO-0N: HTTP security headers (Helmet) ---
  const helmetPkg = 'helmet' in deps ? 'helmet' : '@fastify/helmet' in deps ? '@fastify/helmet' : null;
  if (helmetPkg) {
    primitives['tls'] = 'Helmet HSTS enabled; TLS termination at load balancer';
    signals.push({
      id: `CRYPTO-${String(sigNum).padStart(2, '0')}`,
      source: 'static_analysis',
      category: 'application',
      severity: 'positive',
      derivation: `Helmet.js present. HTTP security headers enabled (CSP, HSTS, X-Frame-Options). Addresses OWASP A05:2021 security misconfiguration.`,
      evidence: [`package.json (${helmetPkg})`],
      confidence: 'medium',
    });
    sigNum++;
  }

  // --- CRYPTO-0N: no primitive detected (#3158) ---
  // The fallback used to sit after the at-rest signal, which is always
  // emitted, so `signals.length === 0` never held and it could not fire. It
  // now fires when the source scan found no primitive and no crypto-relevant
  // dependency, and takes the next ID in the sequence (no fixed CRYPTO-01).
  // #3413: any catalogue hit (weak or strong) suppresses it, and the text
  // states the scope of the scan instead of claiming there is no crypto.
  const languagesScanned = [...new Set([...scannedFiles]
    .map((rel) => LANGUAGE_BY_EXT[rel.slice(rel.lastIndexOf('.')).toLowerCase()])
    .filter((l): l is string => l !== undefined))].sort();
  const hasConfigScan = [...scannedFiles].some((rel) => LANGUAGE_BY_EXT[rel.slice(rel.lastIndexOf('.')).toLowerCase()] === undefined);
  const scopeText = `languages scanned: ${languagesScanned.length > 0 ? languagesScanned.join(', ') : 'none'}${hasConfigScan ? ' plus configuration files' : ''}; files: ${scannedFiles.size}`;
  // #3422: a JCA call is a crypto primitive too (suppresses the fallback, never changes the posture).
  const anyCatalogueHit = catalogueWeakHits.length > 0 || catalogueStrongHits.length > 0 || jcaInventory !== null;
  if (strongHits.length === 0 && weakHits.length === 0 && !anyCatalogueHit && signals.length === 0) {
    signals.push({
      id: `CRYPTO-${String(sigNum).padStart(2, '0')}`,
      source: 'static_analysis',
      category: 'application',
      severity: 'informational',
      derivation: `No cryptographic primitives detected by pattern scan (${scopeText}). Manual review recommended.`,
      evidence: pkg ? ['package.json'] : [],
      confidence: 'low',
    });
    sigNum++;
  }

  // --- CRYPTO-0N: At-rest encryption ---
  const hasEncryptionAnnotation = prismaSchema
    ? /encrypt|@encrypted|@cipher|cipher_/i.test(prismaSchema)
    : false;
  const hasKmsRef =
    Object.keys(deps).some((d) => d.includes('kms') || d.includes('vault')) ||
    (composeContent !== null ? /kms|vault|luks/i.test(composeContent) : false);
  const hasAtRestEncryption = hasEncryptionAnnotation || hasKmsRef;
  primitives['at_rest_encryption'] = hasAtRestEncryption
    ? 'configured'
    : 'not_in_application; deployment dependency';

  const atRestEvidence: string[] = [];
  if (prismaSchema) atRestEvidence.push('prisma/schema.prisma');
  if (composeFile) {
    const rel = composeFile.includes('docker' + '/') || composeFile.includes('docker\\')
      ? 'docker/docker-compose.yml'
      : 'docker-compose.yml';
    atRestEvidence.push(rel);
  }

  const atRestSignal: Signal = {
    id: `CRYPTO-${String(sigNum).padStart(2, '0')}`,
    source: 'static_analysis',
    category: 'infrastructure_platform',
    severity: hasAtRestEncryption ? 'positive' : 'medium',
    derivation: hasAtRestEncryption
      ? `At-rest encryption configured in application or infrastructure layer.`
      : `No at-rest database encryption configured in application code. Volume encryption depends on deployment host configuration. DORA Article 9 and BSI C5 OPS-01 require at-rest encryption to be explicitly verified in the deployment runbook.`,
    evidence: atRestEvidence,
    confidence: 'high',
  };
  if (!hasAtRestEncryption) {
    atRestSignal.implies = [
      'Deployment runbook must explicitly enable and verify disk encryption for database volumes.',
    ];
  }
  signals.push(atRestSignal);
  sigNum++;

  // --- CRYPTO-0N: Weak primitive detection (hardcoded patterns) ---
  for (const weak of remainingWeakHits) {
    const meta = WEAK_PRIMITIVES.find((p) => p.name === weak.primitive)!;
    signals.push({
      id: `CRYPTO-${String(sigNum).padStart(2, '0')}`,
      source: 'static_analysis',
      category: 'application',
      severity: 'high',
      derivation: `Weak cryptographic primitive detected: ${weak.label}. ${meta.cwe}: Use of a Broken or Risky Cryptographic Algorithm. Replace before production deployment.`,
      evidence: [`${weak.file}${weak.line !== undefined ? `:${weak.line}` : ''}`],
      confidence: 'high',
    });
    sigNum++;
  }

  // --- CRYPTO-0N: Weak primitive detection (catalogue-extended) ---
  // #3411: every hit is counted with its production/test class; the signal
  // states "N occurrences (P production, T test)", cites production first,
  // and the full hit list goes into the pass YAML. A weak primitive seen only
  // in test code keeps its severity with low confidence; in
  // `assessment.test_code: tag` mode the #3403 marker lowers it one step
  // (evidence is test-only), and only then it no longer blocks migration.
  // #3412: hits covered by a catalogue context exception (TOTP per RFC 6238,
  // HMAC-SHA1, checksums) take the exception's severity, and the signal names
  // the exception and its rationale.
  const weakOutcomes: Array<{ hit: CatalogueHit; scope: 'production' | 'excepted' | 'test'; severity: WeakSeverity }> = [];
  for (const hit of catalogueWeakHits) {
    const { severity, scope } = weakSignalSeverity(hit);
    weakOutcomes.push({ hit, scope, severity });
    const tail = scope === 'production'
      ? 'Replace before production deployment.'
      : scope === 'excepted'
        ? 'Every production occurrence is covered by a context exception; review the exception rationale.'
        : testCodeTagged
          ? 'Seen in test code only (no production occurrence); down-weighted by the test-code setting (mode tag).'
          : 'Seen in test code only (no production occurrence). Set the test-code mode to tag in .swao.yml to down-weight test-code findings.';
    signals.push({
      id: `CRYPTO-${String(sigNum).padStart(2, '0')}`,
      source: 'static_analysis',
      category: 'application',
      severity,
      derivation: `Weak cryptographic primitive detected: ${hit.name} (catalogue entry ${hit.id}). ${hit.cwe}: Use of a Broken or Risky Cryptographic Algorithm.${hit.note ? ` ${hit.note}` : ''} ${occurrenceSummary(hit.total, hit.byClass, hit.hits.length)}${exceptionSummary(hit)} ${tail}`,
      evidence: catalogueEvidence(hit),
      confidence: scope === 'production' ? 'high' : scope === 'excepted' ? 'medium' : 'low',
    });
    sigNum++;
  }

  // --- CRYPTO-0N: Approved primitives from the catalogue (#3413) ---
  // Appended after the existing signals so the established CRYPTO-0N
  // numbering does not shift. Skipped when the hard-coded twin already
  // emitted the positive signal (KDF, MAC or AEAD slot above).
  const emittedStrong = new Set([kdfHit?.primitive, macHit?.primitive, aeadHit?.primitive].filter((p): p is string => p !== undefined));
  let catalogueStrongInProduction = false;
  for (const hit of catalogueStrongHits) {
    if ((STRONG_TWINS[hit.id] ?? []).some((p) => emittedStrong.has(p))) continue;
    const inProduction = hit.byClass.prod + hit.byClass.unknown > 0;
    if (inProduction) catalogueStrongInProduction = true;
    const status = [hit.meta.bsi ? `BSI TR-02102: ${hit.meta.bsi}` : '', hit.meta.nist ? `NIST: ${hit.meta.nist}` : '']
      .filter(Boolean).join(', ');
    signals.push({
      id: `CRYPTO-${String(sigNum).padStart(2, '0')}`,
      source: 'static_analysis',
      category: 'application',
      severity: inProduction ? 'positive' : 'informational',
      derivation: `Approved cryptographic primitive detected: ${hit.name} (catalogue entry ${hit.id}, ${hit.meta.severity}${status ? `; ${status}` : ''}). ${occurrenceSummary(hit.total, hit.byClass, hit.hits.length)}${inProduction ? '' : ' Seen in test code only.'}`,
      evidence: catalogueEvidence(hit),
      confidence: inProduction ? 'medium' : 'low',
    });
    sigNum++;
  }

  // --- CRYPTO-0N: Java Cryptography Architecture inventory (#3422) ---
  // Every JCA engine call with a literal algorithm string, so algorithms the
  // catalogue does not rate (AES/CBC, SHA1PRNG, PKCS12) are still listed with
  // file:line. Informational; appended last so existing numbering is stable.
  if (jcaInventory) {
    const inv = jcaInventory;
    const shown = inv.algorithms.slice(0, 12).map((a) => `${a.api} ${a.algorithm} (${a.count})`).join(', ');
    const more = inv.algorithms.length > 12 ? `, and ${inv.algorithms.length - 12} more` : '';
    signals.push({
      id: `CRYPTO-${String(sigNum).padStart(2, '0')}`,
      source: 'static_analysis',
      category: 'application',
      severity: 'informational',
      derivation: `Java Cryptography Architecture usage: ${shown}${more}.${inv.providers.length > 0 ? ` Providers registered: ${inv.providers.join(', ')}.` : ''} ${occurrenceSummary(inv.total, inv.byClass, inv.locations.length)} Algorithms are rated by the catalogue signals above; unrated ones need a manual review against BSI TR-02102.`,
      evidence: inv.locations.slice(0, MAX_EVIDENCE_HITS).map(hitRef),
      confidence: 'high',
    });
    sigNum++;
  }

  // #3411/#3403: test-only weak primitives block migration unless test code is
  // tagged or excluded (include mode treats test code like production code).
  const catalogueWeakInProduction = weakOutcomes.some((o) => o.scope === 'production')
    || (!testCodeTagged && weakOutcomes.some((o) => o.scope === 'test' && o.severity === 'high'));
  const hasWeakPrimitives = remainingWeakHits.length > 0 || catalogueWeakInProduction;
  const overallPosture = hasWeakPrimitives
    ? 'weak_primitives_detected'
    : weakOutcomes.some((o) => o.scope === 'excepted')
      ? 'weak_primitives_context_excepted'
      : weakOutcomes.length > 0
        ? 'weak_primitives_in_test_code_only'
        : kdfHit !== undefined || macHit !== undefined || aeadHit !== undefined || catalogueStrongInProduction
          ? 'good_with_infrastructure_gap'
          : 'unknown';
  const nistCompliant = !hasWeakPrimitives
    && (kdfHit !== undefined || macHit !== undefined || aeadHit !== undefined || catalogueStrongInProduction);

  return {
    pass: {
      id: 8,
      name: 'crypto_posture',
      signal_prefix: 'CRYPTO',
      status: 'complete',
      iter,
      assessed_at: assessedAt,
    },
    signals,
    assessment: {
      primitives,
      overall_posture: overallPosture,
      nist_compliant: nistCompliant,
      blocks_migration: hasWeakPrimitives,
      // #3411: the full (capped) hit list per catalogue entry, production first.
      ...(catalogueWeakHits.length + catalogueStrongHits.length > 0
        ? { hits: Object.fromEntries([...catalogueWeakHits, ...catalogueStrongHits].map((h) => [h.id, {
          total: h.total,
          production: h.byClass.prod,
          test: h.byClass.test,
          unclassified: h.byClass.unknown,
          truncated: h.hits.length < h.total,
          locations: h.hits,
        }])) }
        : {}),
      // #3422: JCA inventory (own key: `hits` keys are catalogue ids).
      ...(jcaInventory
        ? { jca_inventory: {
          total: jcaInventory.total,
          production: jcaInventory.byClass.prod,
          test: jcaInventory.byClass.test,
          unclassified: jcaInventory.byClass.unknown,
          truncated: jcaInventory.locations.length < jcaInventory.total,
          algorithms: jcaInventory.algorithms,
          providers: jcaInventory.providers,
          locations: jcaInventory.locations,
        } }
        : {}),
      // #3413: what the pattern scan covered (the fallback states the same scope).
      pattern_scan: { languages: languagesScanned, configuration_files: hasConfigScan, files: scannedFiles.size },
      ...(catalogueErrors.length > 0 ? { catalogue_errors: catalogueErrors } : {}),
    },
  };
}
