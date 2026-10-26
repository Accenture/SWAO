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

// #3160: Pass 01 (INV) supplement. Matches the dependency manifests, container
// images and file names of the source tree against three reference catalogues
// in swao/controls/ and emits one aggregated signal per catalogue:
//
//   INV-07  db-compatibility-catalogue.yaml   database engine compatibility
//   INV-08  legacy-indicators-catalogue.yaml  legacy technology indicators
//   INV-09  vendor-sdk-catalogue.yaml         vendor SDK lock-in
//
// Detection is deterministic (no LLM). Per-match detail is written to the
// pass assessment block (database_compatibility, legacy_indicators,
// vendor_sdks); reference_catalogue_checks records whether each catalogue
// loaded, so a skipped check is visible in the WSP.

import { existsSync, readFileSync } from 'fs';
import { listSourceFiles, type Signal } from '@swao/core';
import { collectJvmProject, type JvmProject, type JvmScope, type JvmVersionSource } from './jvm-build-files.js';
import {
  loadDbCompatibilityCatalogue,
  loadLegacyIndicatorsCatalogue,
  loadVendorSdkCatalogue,
  type DbCompatibilityCatalogue,
  type DbCompatibilityRow,
  type LegacyIndicator,
  type LegacyIndicatorsCatalogue,
  type MatchMode,
  type VendorSdkCatalogue,
} from '../catalogue/reference-catalogues.js';

// ---------------------------------------------------------------------------
// Dependency inventory
// ---------------------------------------------------------------------------

export type Ecosystem = 'npm' | 'pip' | 'cargo' | 'maven' | 'nuget';

export interface DependencyRef {
  ecosystem: Ecosystem;
  /** Package name; for Maven and Gradle the artifactId. */
  name: string;
  /** Maven and Gradle groupId. */
  group?: string;
  version?: string;
  /** Manifest path relative to the source root. */
  file: string;
  /** #3420: Maven / Gradle scope (compile, runtime, provided, test, ...). */
  scope?: JvmScope;
  /** #3420: how a Maven / Gradle version was resolved (declared, property, managed, catalog, lockfile, unresolved). */
  versionSource?: JvmVersionSource;
}

export interface ImageRef {
  image: string;
  file: string;
}

export interface DependencyInventory {
  deps: DependencyRef[];
  images: ImageRef[];
  /** Every file seen by the walk, relative to the source root (forward slashes). */
  files: string[];
}

const MAX_FILES = 20_000;

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function parsePackageJson(content: string, file: string): DependencyRef[] {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return [];
  }
  const out: DependencyRef[] = [];
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const block = pkg[key];
    if (!block || typeof block !== 'object') continue;
    for (const [name, version] of Object.entries(block as Record<string, unknown>)) {
      out.push({ ecosystem: 'npm', name, version: typeof version === 'string' ? version : undefined, file });
    }
  }
  return out;
}

const PIP_NAME_RE = /^([A-Za-z0-9][A-Za-z0-9._-]*)/;

function parseRequirementsTxt(content: string, file: string): DependencyRef[] {
  const out: DependencyRef[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line || line.startsWith('-') || line.includes('://')) continue;
    const m = line.match(PIP_NAME_RE);
    if (m) out.push({ ecosystem: 'pip', name: m[1]!, file });
  }
  return out;
}

/** Section-aware TOML key scan: returns the keys of every table accepted by `isDepTable`. */
function tomlTableKeys(content: string, isDepTable: (header: string) => boolean): Array<{ key: string; header: string }> {
  const out: Array<{ key: string; header: string }> = [];
  let header = '';
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    const h = line.match(/^\[([^\]]+)\]\s*(#.*)?$/);
    if (h) {
      header = h[1]!.trim();
      continue;
    }
    if (!isDepTable(header)) continue;
    const kv = line.match(/^["']?([A-Za-z0-9][A-Za-z0-9._-]*)["']?\s*=/);
    if (kv) out.push({ key: kv[1]!, header });
  }
  return out;
}

function parsePyproject(content: string, file: string): DependencyRef[] {
  const out: DependencyRef[] = [];
  const push = (spec: string): void => {
    const m = spec.trim().match(PIP_NAME_RE);
    if (m) out.push({ ecosystem: 'pip', name: m[1]!, file });
  };
  // PEP 621 / PEP 735 arrays: [project] dependencies, every key of
  // [project.optional-dependencies] and [dependency-groups]. Other arrays
  // (classifiers, keywords, authors) are ignored.
  let header = '';
  let inArray = false;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (inArray) {
      for (const s of line.matchAll(/["']([^"']+)["']/g)) push(s[1]!);
      if (line.includes(']')) inArray = false;
      continue;
    }
    const h = line.match(/^\[([^\]]+)\]$/);
    if (h) {
      header = h[1]!.trim();
      continue;
    }
    const arr = line.match(/^["']?([A-Za-z0-9_-]+)["']?\s*=\s*\[(.*)$/);
    if (!arr) continue;
    const accepted = (header === 'project' && arr[1] === 'dependencies')
      || header === 'project.optional-dependencies'
      || header === 'dependency-groups';
    if (!accepted) continue;
    const rest = arr[2]!;
    for (const s of rest.matchAll(/["']([^"']+)["']/g)) push(s[1]!);
    if (!rest.includes(']')) inArray = true;
  }
  // Poetry: [tool.poetry.dependencies] and [tool.poetry.group.<g>.dependencies]
  for (const { key } of tomlTableKeys(content, (hd) => /^tool\.poetry\.(dev-)?dependencies$|^tool\.poetry\.group\.[^.]+\.dependencies$/.test(hd))) {
    if (key.toLowerCase() !== 'python') out.push({ ecosystem: 'pip', name: key, file });
  }
  return out;
}

function parsePipfile(content: string, file: string): DependencyRef[] {
  return tomlTableKeys(content, (h) => h === 'packages' || h === 'dev-packages').map(({ key }) => ({
    ecosystem: 'pip' as const,
    name: key,
    file,
  }));
}

function parseCargoToml(content: string, file: string): DependencyRef[] {
  const out: DependencyRef[] = [];
  const isDep = (h: string): boolean =>
    /(^|\.)(dev-|build-)?dependencies$/.test(h) || h === 'workspace.dependencies';
  for (const { key } of tomlTableKeys(content, isDep)) out.push({ ecosystem: 'cargo', name: key, file });
  // [dependencies.foo] table form
  for (const m of content.matchAll(/^\s*\[(?:[^\]]*\.)?(?:dev-|build-)?dependencies\.([A-Za-z0-9_-]+)\]/gm)) {
    out.push({ ecosystem: 'cargo', name: m[1]!, file });
  }
  return out;
}

/**
 * #3420: Maven and Gradle dependencies come from the shared JVM build-file
 * reader (jvm-build-files.ts), which resolves properties, parents, managed
 * versions, version catalogs and lockfiles and ignores <dependencyManagement>
 * and plugin dependencies. Only direct declarations are listed here.
 */
function jvmDependencyRefs(jvm: JvmProject, file: string): DependencyRef[] {
  return jvm.dependencies
    .filter((d) => d.direct && d.manifest === file)
    .map((d) => ({
      ecosystem: 'maven' as const,
      group: d.group,
      name: d.artifact,
      ...(d.version !== null ? { version: d.version } : {}),
      file,
      scope: d.scope,
      versionSource: d.versionSource,
    }));
}

function parseNuget(content: string, file: string): DependencyRef[] {
  const out: DependencyRef[] = [];
  for (const m of content.matchAll(/<PackageReference\s+[^>]*Include\s*=\s*"([^"]+)"/gi)) {
    out.push({ ecosystem: 'nuget', name: m[1]!, file });
  }
  for (const m of content.matchAll(/<package\s+[^>]*id\s*=\s*"([^"]+)"/gi)) {
    out.push({ ecosystem: 'nuget', name: m[1]!, file });
  }
  return out;
}

function parseComposeImages(content: string, file: string): ImageRef[] {
  const out: ImageRef[] = [];
  for (const m of content.matchAll(/^\s*image:\s*["']?([^\s"'#]+)/gm)) out.push({ image: m[1]!, file });
  return out;
}

function parseDockerfileImages(content: string, file: string): ImageRef[] {
  const out: ImageRef[] = [];
  for (const m of content.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/gim)) {
    if (m[1]!.toLowerCase() !== 'scratch' && !m[1]!.startsWith('$')) out.push({ image: m[1]!, file });
  }
  return out;
}

/**
 * Walk the source tree through the central source scope (#3428; depth-limited,
 * canonical dependency / build-output skips) and parse every recognised manifest. Covered: package.json,
 * requirements*.txt, pyproject.toml, Pipfile, Cargo.toml, pom.xml,
 * build.gradle(.kts), *.csproj, packages.config, docker-compose / compose
 * files and Dockerfiles.
 */
export function collectDependencyInventory(sourcePath: string, maxDepth = 4): DependencyInventory {
  const inv: DependencyInventory = { deps: [], images: [], files: [] };
  if (!sourcePath || !existsSync(sourcePath)) return inv;

  // #3428: the central source scope replaces the private walker and its
  // SKIP_DIRS set (canonical skips, dot-entries hidden, same depth guard).
  let jvm: JvmProject | null = null;
  for (const f of listSourceFiles(sourcePath, { purpose: 'manifest', maxDepth, maxFiles: MAX_FILES })) {
    const { abs: full, rel: relPath } = f;
    inv.files.push(relPath);
    const lower = f.name.toLowerCase();
    const parse = (fn: (c: string, f: string) => DependencyRef[]): void => {
      const c = readText(full);
      if (c !== null) inv.deps.push(...fn(c, relPath));
    };
    if (lower === 'package.json') parse(parsePackageJson);
    else if (/^requirements.*\.txt$/.test(lower)) parse(parseRequirementsTxt);
    else if (lower === 'pyproject.toml') parse(parsePyproject);
    else if (lower === 'pipfile') parse(parsePipfile);
    else if (lower === 'cargo.toml') parse(parseCargoToml);
    else if (lower === 'pom.xml' || lower === 'build.gradle' || lower === 'build.gradle.kts') {
      jvm ??= collectJvmProject(sourcePath, { maxDepth });
      inv.deps.push(...jvmDependencyRefs(jvm, relPath));
    }
    else if (lower.endsWith('.csproj') || lower === 'packages.config') parse(parseNuget);
    else if (/^(docker-)?compose.*\.ya?ml$/.test(lower)) {
      const c = readText(full);
      if (c !== null) inv.images.push(...parseComposeImages(c, relPath));
    } else if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) {
      const c = readText(full);
      if (c !== null) inv.images.push(...parseDockerfileImages(c, relPath));
    }
  }
  return inv;
}

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

function normaliseName(name: string, ecosystem: Ecosystem): string {
  const lower = name.toLowerCase();
  // PEP 503: runs of -, _ and . are equivalent in Python package names.
  return ecosystem === 'pip' ? lower.replace(/[-_.]+/g, '-') : lower;
}

/**
 * Match a dependency name against a catalogue pattern. A trailing `*` is a
 * wildcard and implies prefix matching; `match` defaults to exact otherwise.
 * Comparison is case-insensitive (pip, NuGet and Maven names are
 * case-insensitive in practice; npm and crates.io names are lower case).
 */
export function matchesPattern(value: string, pattern: string, match: MatchMode | undefined, ecosystem: Ecosystem): boolean {
  const wildcard = pattern.endsWith('*');
  const mode: MatchMode = match ?? (wildcard ? 'prefix' : 'exact');
  const pat = normaliseName(wildcard ? pattern.slice(0, -1) : pattern, ecosystem);
  const val = normaliseName(value, ecosystem);
  return mode === 'prefix' ? val.startsWith(pat) : val === pat;
}

/** Strip registry host, `docker.io/library/` and tag or digest from an image reference. */
export function imageRepository(image: string): string {
  let ref = image.split('@')[0]!;
  const lastSlash = ref.lastIndexOf('/');
  const colon = ref.lastIndexOf(':');
  if (colon > lastSlash) ref = ref.slice(0, colon);
  return ref.replace(/^(docker\.io\/|index\.docker\.io\/)/, '').replace(/^library\//, '');
}

export function imageTag(image: string): string | null {
  const ref = image.split('@')[0]!;
  const lastSlash = ref.lastIndexOf('/');
  const colon = ref.lastIndexOf(':');
  return colon > lastSlash ? ref.slice(colon + 1) : null;
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function depLabel(d: DependencyRef): string {
  const name = d.group ? `${d.group}:${d.name}` : d.name;
  return `${d.file} (${d.ecosystem}: ${name}${d.version ? ` ${d.version}` : ''})`;
}

// ---------------------------------------------------------------------------
// INV-09: vendor SDK lock-in (vendor-sdk-catalogue.yaml)
// ---------------------------------------------------------------------------

const VENDOR_KEY_ECOSYSTEM: Record<string, Ecosystem> = {
  npm_packages: 'npm',
  cargo_crates: 'cargo',
  pip_packages: 'pip',
  python_packages: 'pip',
  maven_group_ids: 'maven',
  nuget_packages: 'nuget',
};

export interface VendorSdkHit {
  id: string;
  name: string;
  vendor: string;
  lock_in_level: string;
  sovereign_impact: string;
  sovereign_alternative?: string;
  evidence: string[];
}

export function matchVendorSdks(catalogue: VendorSdkCatalogue, inv: DependencyInventory): VendorSdkHit[] {
  const hits: VendorSdkHit[] = [];
  for (const sdk of catalogue.sdks) {
    const evidence = new Set<string>();
    for (const [key, ecosystem] of Object.entries(VENDOR_KEY_ECOSYSTEM)) {
      const rules = (sdk.detection as Record<string, unknown>)[key] as
        | Array<{ pattern: string; match?: MatchMode }>
        | undefined;
      for (const rule of rules ?? []) {
        for (const d of inv.deps) {
          if (d.ecosystem !== ecosystem) continue;
          // maven_group_ids patterns are matched against the groupId.
          const value = ecosystem === 'maven' ? (d.group ?? '') : d.name;
          if (matchesPattern(value, rule.pattern, rule.match, ecosystem)) evidence.add(depLabel(d));
        }
      }
    }
    for (const rule of sdk.detection.jar_patterns ?? []) {
      const re = globToRegExp(rule.pattern);
      for (const f of inv.files) if (re.test(f.split('/').pop() ?? f)) evidence.add(f);
    }
    if (evidence.size > 0) {
      hits.push({
        id: sdk.id,
        name: sdk.name,
        vendor: sdk.vendor,
        lock_in_level: sdk.lock_in_level,
        sovereign_impact: sdk.sovereign_impact,
        ...(sdk.sovereign_alternative ? { sovereign_alternative: sdk.sovereign_alternative.trim() } : {}),
        evidence: [...evidence].sort(),
      });
    }
  }
  return hits;
}

const IMPACT_SEVERITY: Record<string, Signal['severity']> = {
  blocks_migration: 'high',
  partial: 'medium',
  manageable: 'low',
  none: 'informational',
};

// ---------------------------------------------------------------------------
// INV-08: legacy indicators (legacy-indicators-catalogue.yaml)
// ---------------------------------------------------------------------------

export type LegacyTier = 'tier_1_blocker' | 'tier_2_complicator' | 'tier_3_manageable';

/**
 * File patterns the catalogue itself marks as ambiguous or that collide with
 * common non-legacy files (Pascal or SWIG sources, Java and Apex classes,
 * shared WSDL, build artefacts). They are not used for detection; the other
 * rules of the same indicator still apply.
 */
export const AMBIGUOUS_FILE_PATTERNS: ReadonlySet<string> = new Set([
  '*.p', '*.i', '*.cls', '*.df', '*.process', '*.wsdl', '*.so', '*.dll',
]);

export interface LegacyHit {
  id: string;
  name: string;
  tier: LegacyTier;
  /** high: an unambiguous rule matched; low: only rules the catalogue qualifies with a note matched. */
  confidence: 'high' | 'low';
  sovereign_alternative?: string;
  migration_effort_weeks?: number;
  evidence: string[];
}

function matchLegacyIndicator(ind: LegacyIndicator, tier: LegacyTier, inv: DependencyInventory): LegacyHit | null {
  const strong = new Set<string>();
  const weak = new Set<string>();
  for (const rule of ind.detection.dependency_manifest ?? []) {
    for (const d of inv.deps) {
      if (d.ecosystem !== rule.ecosystem) continue;
      let ok: boolean;
      if (rule.ecosystem === 'maven') {
        ok = rule.group
          ? (d.group ?? '').toLowerCase() === rule.group.toLowerCase() && matchesPattern(d.name, rule.pattern, rule.match, 'maven')
          : matchesPattern(d.group ?? '', rule.pattern, rule.match, 'maven');
      } else {
        ok = matchesPattern(d.name, rule.pattern, rule.match, rule.ecosystem);
      }
      // A note qualifies the rule ("may also be used for ..."), except on a
      // rule pinned to group and artifact, where it only explains the pin.
      if (ok) (rule.note && !rule.group ? weak : strong).add(depLabel(d));
    }
  }
  for (const rule of ind.detection.docker_image ?? []) {
    for (const img of inv.images) {
      const repo = imageRepository(img.image).toLowerCase();
      const pat = rule.pattern.toLowerCase().replace(/\*$/, '');
      const ok = (rule.match ?? 'prefix') === 'prefix' ? repo.startsWith(pat) || img.image.toLowerCase().startsWith(pat) : repo === pat;
      if (ok) strong.add(`${img.file} (image: ${img.image})`);
    }
  }
  for (const rule of ind.detection.file_pattern ?? []) {
    if (AMBIGUOUS_FILE_PATTERNS.has(rule.pattern) || rule.glob) continue;
    const re = globToRegExp(rule.pattern);
    let count = 0;
    for (const f of inv.files) {
      if (re.test(f.split('/').pop() ?? f)) {
        if (count < 5) strong.add(f);
        count++;
      }
    }
  }
  if (strong.size === 0 && weak.size === 0) return null;
  return {
    id: ind.id,
    name: ind.name,
    tier,
    confidence: strong.size > 0 ? 'high' : 'low',
    ...(ind.sovereign_alternative ? { sovereign_alternative: ind.sovereign_alternative.trim() } : {}),
    ...(ind.migration_effort_weeks !== undefined ? { migration_effort_weeks: ind.migration_effort_weeks } : {}),
    evidence: [...strong, ...weak].sort(),
  };
}

export function matchLegacyIndicators(catalogue: LegacyIndicatorsCatalogue, inv: DependencyInventory): LegacyHit[] {
  const hits: LegacyHit[] = [];
  const tiers: Array<[LegacyTier, LegacyIndicator[]]> = [
    ['tier_1_blocker', catalogue.tiers.tier_1_blockers],
    ['tier_2_complicator', catalogue.tiers.tier_2_complicators],
    ['tier_3_manageable', catalogue.tiers.tier_3_manageable],
  ];
  for (const [tier, list] of tiers) {
    for (const ind of list) {
      const hit = matchLegacyIndicator(ind, tier, inv);
      if (hit) hits.push(hit);
    }
  }
  return hits;
}

const TIER_RANK: Record<LegacyTier, number> = { tier_1_blocker: 1, tier_2_complicator: 2, tier_3_manageable: 3 };

/** Tier 1 high-confidence: high; tier 1 low-confidence or tier 2: medium; tier 3: low. */
export function legacyHitSeverity(hit: LegacyHit): Signal['severity'] {
  if (hit.tier === 'tier_1_blocker') return hit.confidence === 'high' ? 'high' : 'medium';
  return hit.tier === 'tier_2_complicator' ? 'medium' : 'low';
}

// ---------------------------------------------------------------------------
// INV-07: database compatibility (db-compatibility-catalogue.yaml)
// ---------------------------------------------------------------------------

/** Catalogue engine keys and the names under which INV, IaC state or images report them. */
const ENGINE_ALIASES: Record<string, string> = {
  postgres: 'postgres',
  postgresql: 'postgres',
  mysql: 'mysql',
  mariadb: 'mariadb',
  mongo: 'mongodb',
  mongodb: 'mongodb',
  redis: 'redis',
  oracle: 'oracle',
  sqlserver: 'sqlserver',
  mssql: 'sqlserver',
  ibm_db2: 'ibm_db2',
  db2: 'ibm_db2',
  elasticsearch: 'elasticsearch',
};

/** Client libraries that name the engine they connect to. */
const DRIVER_ENGINES: Record<Ecosystem, Record<string, string>> = {
  npm: {
    pg: 'postgres', postgres: 'postgres', mysql: 'mysql', mysql2: 'mysql', mariadb: 'mariadb', mongodb: 'mongodb',
    mongoose: 'mongodb', redis: 'redis', ioredis: 'redis', '@elastic/elasticsearch': 'elasticsearch',
    oracledb: 'oracle', mssql: 'sqlserver', tedious: 'sqlserver', ibm_db: 'ibm_db2',
  },
  pip: {
    'psycopg2': 'postgres', 'psycopg2-binary': 'postgres', psycopg: 'postgres', asyncpg: 'postgres', pymysql: 'mysql',
    mysqlclient: 'mysql', mariadb: 'mariadb', pymongo: 'mongodb', redis: 'redis', elasticsearch: 'elasticsearch',
    oracledb: 'oracle', 'cx-oracle': 'oracle', pymssql: 'sqlserver', 'ibm-db': 'ibm_db2',
  },
  cargo: { 'tokio-postgres': 'postgres', postgres: 'postgres', mysql: 'mysql', mongodb: 'mongodb', redis: 'redis', tiberius: 'sqlserver', elasticsearch: 'elasticsearch' },
  maven: {},
  nuget: { npgsql: 'postgres', 'mysql.data': 'mysql', 'mongodb.driver': 'mongodb', 'stackexchange.redis': 'redis', 'microsoft.data.sqlclient': 'sqlserver', 'system.data.sqlclient': 'sqlserver', 'oracle.manageddataaccess': 'oracle' },
};

/** Image repositories (after imageRepository()) that run a catalogue engine. */
const IMAGE_ENGINES: Array<[RegExp, string]> = [
  [/^(bitnami\/)?postgres(ql)?$/i, 'postgres'],
  [/^(bitnami\/)?mysql$/i, 'mysql'],
  [/^(bitnami\/)?mariadb$/i, 'mariadb'],
  [/^(bitnami\/)?mongo(db)?$/i, 'mongodb'],
  [/^(bitnami\/)?redis$/i, 'redis'],
  [/elasticsearch\/elasticsearch$|^elasticsearch$/i, 'elasticsearch'],
  [/^mcr\.microsoft\.com\/mssql\//i, 'sqlserver'],
  [/^container-registry\.oracle\.com\/database\/|^oracle\/database/i, 'oracle'],
  [/(^|\/)db2$/i, 'ibm_db2'],
];

const VENDOR_SDK_ENGINES: Record<string, string> = {
  'oracle-db-client': 'oracle',
  'sql-server-client': 'sqlserver',
  'ibm-db2-client': 'ibm_db2',
};

export interface EngineObservation {
  engine: string;
  version: string | null;
  evidence: string;
}

/** Leading numeric part of a version string or image tag ("14.5-alpine" -> "14.5"); null when none. */
export function leadingVersion(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/^v?(\d+(?:\.\d+)*)/);
  return m ? m[1]! : null;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Evaluate a catalogue range such as ">=12,<15", ">=8.0" or "<12". */
export function versionInRange(version: string, range: string): boolean {
  return range.split(',').every((part) => {
    const m = part.trim().match(/^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+)*)$/);
    if (!m) return false;
    const cmp = compareVersions(version, m[2]!);
    switch (m[1] ?? '=') {
      case '>=': return cmp >= 0;
      case '<=': return cmp <= 0;
      case '>': return cmp > 0;
      case '<': return cmp < 0;
      default: return cmp === 0;
    }
  });
}

export function collectEngineObservations(
  inv: DependencyInventory,
  serviceDeps: string[],
  databaseEngine: string | undefined,
  vendorHits: VendorSdkHit[],
): EngineObservation[] {
  const obs: EngineObservation[] = [];
  const alias = (s: string): string | undefined => ENGINE_ALIASES[s.toLowerCase()];
  if (databaseEngine) {
    const e = alias(databaseEngine);
    if (e) obs.push({ engine: e, version: null, evidence: `INV database_engine: ${databaseEngine}` });
  }
  for (const tag of serviceDeps) {
    const [name, ver] = tag.split('@');
    const e = alias(name ?? '');
    if (e) obs.push({ engine: e, version: leadingVersion(ver), evidence: `service_dep:${tag}` });
  }
  for (const img of inv.images) {
    const repo = imageRepository(img.image);
    const hit = IMAGE_ENGINES.find(([re]) => re.test(repo));
    if (hit) obs.push({ engine: hit[1], version: leadingVersion(imageTag(img.image)), evidence: `${img.file} (image: ${img.image})` });
  }
  for (const d of inv.deps) {
    const e = DRIVER_ENGINES[d.ecosystem][normaliseName(d.name, d.ecosystem)];
    if (e) obs.push({ engine: e, version: null, evidence: depLabel(d) });
  }
  for (const h of vendorHits) {
    const e = VENDOR_SDK_ENGINES[h.id];
    if (e) obs.push({ engine: e, version: null, evidence: `vendor SDK ${h.id}` });
  }
  return obs;
}

export interface DbCompatibilityResult {
  engine: string;
  version: string | null;
  /** Rows of the catalogue that apply: one when the version is known, all rows of the engine otherwise. */
  rows: Array<Pick<DbCompatibilityRow, 'version_range' | 'compatibility' | 'effort' | 'sovereign_availability'> & { target_managed_service: string[] }>;
  severity: NonNullable<Signal['severity']>;
  evidence: string[];
}

const AVAILABILITY_SEVERITY: Record<string, NonNullable<Signal['severity']>> = {
  available: 'informational',
  partial: 'medium',
  vm_only: 'high',
  not_available: 'critical',
};

const SEVERITY_RANK: Record<string, number> = {
  critical: 5, high: 4, medium: 3, low: 2, informational: 1, positive: 0,
};

function worstSeverity(list: Array<Signal['severity']>): NonNullable<Signal['severity']> {
  let worst: NonNullable<Signal['severity']> = 'informational';
  for (const s of list) if (s && SEVERITY_RANK[s]! > SEVERITY_RANK[worst]!) worst = s;
  return worst;
}

export function matchDbCompatibility(catalogue: DbCompatibilityCatalogue, observations: EngineObservation[]): DbCompatibilityResult[] {
  // Group by engine; versions observed for the engine are evaluated separately.
  const byEngine = new Map<string, { versions: Map<string, Set<string>>; unversioned: Set<string> }>();
  for (const o of observations) {
    const slot = byEngine.get(o.engine) ?? { versions: new Map(), unversioned: new Set<string>() };
    if (o.version) {
      const ev = slot.versions.get(o.version) ?? new Set<string>();
      ev.add(o.evidence);
      slot.versions.set(o.version, ev);
    } else {
      slot.unversioned.add(o.evidence);
    }
    byEngine.set(o.engine, slot);
  }

  const toRow = (r: DbCompatibilityRow): DbCompatibilityResult['rows'][number] => ({
    version_range: r.version_range,
    compatibility: r.compatibility,
    effort: r.effort,
    sovereign_availability: r.sovereign_availability,
    target_managed_service: r.target_managed_service ?? [],
  });

  const results: DbCompatibilityResult[] = [];
  for (const [engine, slot] of [...byEngine.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const engineRows = catalogue.engines.filter((r) => r.engine === engine);
    if (engineRows.length === 0) continue;
    for (const [version, ev] of slot.versions) {
      const row = engineRows.find((r) => versionInRange(version, r.version_range));
      if (!row) continue;
      results.push({
        engine,
        version,
        rows: [toRow(row)],
        severity: AVAILABILITY_SEVERITY[row.sovereign_availability] ?? 'medium',
        evidence: [...ev, ...slot.unversioned].sort(),
      });
    }
    if (slot.versions.size === 0) {
      // Version not determined: when every row of the engine agrees on the
      // sovereign availability, that verdict holds; otherwise the result is
      // version-dependent and reported as low.
      const availabilities = new Set(engineRows.map((r) => r.sovereign_availability));
      const severity = availabilities.size === 1
        ? AVAILABILITY_SEVERITY[engineRows[0]!.sovereign_availability] ?? 'medium'
        : 'low';
      results.push({ engine, version: null, rows: engineRows.map(toRow), severity, evidence: [...slot.unversioned].sort() });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Orchestration for Pass 01
// ---------------------------------------------------------------------------

export interface InvReferenceScanInput {
  sourcePath: string;
  /** Signals already emitted by Pass 01 (service_dep implies tags are read). */
  priorSignals: Signal[];
  /** assessment.database_engine from INV-02, when set. */
  databaseEngine?: string;
  /** #3430: inventory already collected by Pass 01 (shared with the service footprint); collected here when absent. */
  inventory?: DependencyInventory;
  /** Catalogue path overrides for tests. */
  cataloguePaths?: { vendorSdk?: string; legacyIndicators?: string; dbCompatibility?: string };
}

export interface InvReferenceScanResult {
  signals: Signal[];
  assessment: Record<string, unknown>;
}

function clip(list: string[], max: number): string[] {
  return list.length <= max ? list : [...list.slice(0, max), `... ${list.length - max} more`];
}

export function runInvReferenceScans(input: InvReferenceScanInput): InvReferenceScanResult {
  const signals: Signal[] = [];
  const assessment: Record<string, unknown> = {};
  const checks: Record<string, string> = {};
  const inv = input.inventory ?? collectDependencyInventory(input.sourcePath);

  // INV-09: vendor SDKs (computed first; INV-07 reuses database client hits)
  let vendorHits: VendorSdkHit[] = [];
  const vendorCat = loadVendorSdkCatalogue(input.cataloguePaths?.vendorSdk);
  if (!vendorCat.ok) {
    checks.vendor_sdk = `skipped: ${vendorCat.reason}`;
  } else {
    vendorHits = matchVendorSdks(vendorCat.data, inv);
    checks.vendor_sdk = vendorHits.length > 0 ? 'matched' : 'no_match';
    if (vendorHits.length > 0) {
      assessment.vendor_sdks = vendorHits;
      const severity = worstSeverity(vendorHits.map((h) => IMPACT_SEVERITY[h.sovereign_impact]));
      const blocking = vendorHits.filter((h) => h.sovereign_impact === 'blocks_migration');
      signals.push({
        id: 'INV-09',
        source: 'static_analysis',
        category: 'application',
        severity,
        derivation: `Vendor SDK lock-in (vendor-sdk-catalogue.yaml): ${vendorHits.length} proprietary SDK(s) found: ${vendorHits
          .map((h) => `${h.name} (lock-in ${h.lock_in_level}, sovereign impact ${h.sovereign_impact})`)
          .join('; ')}.${blocking.length > 0 ? ` ${blocking.length} SDK(s) have no sovereign-cloud equivalent and must be replaced before a sovereign migration.` : ''}`,
        evidence: clip(vendorHits.flatMap((h) => h.evidence.map((e) => `${h.id}: ${e}`)), 20),
        confidence: 'high',
      });
    }
  }

  // INV-08: legacy indicators
  const legacyCat = loadLegacyIndicatorsCatalogue(input.cataloguePaths?.legacyIndicators);
  if (!legacyCat.ok) {
    checks.legacy_indicators = `skipped: ${legacyCat.reason}`;
  } else {
    const hits = matchLegacyIndicators(legacyCat.data, inv);
    checks.legacy_indicators = hits.length > 0 ? 'matched' : 'no_match';
    if (hits.length > 0) {
      assessment.legacy_indicators = hits;
      const worstTier = hits.reduce<LegacyTier>((w, h) => (TIER_RANK[h.tier] < TIER_RANK[w] ? h.tier : w), 'tier_3_manageable');
      const count = (t: LegacyTier): number => hits.filter((h) => h.tier === t).length;
      const allLow = hits.every((h) => h.confidence === 'low');
      signals.push({
        id: 'INV-08',
        source: 'static_analysis',
        category: 'application',
        severity: worstSeverity(hits.map(legacyHitSeverity)),
        derivation: `Legacy technology indicators (legacy-indicators-catalogue.yaml): ${count('tier_1_blocker')} tier 1 blocker(s), ${count('tier_2_complicator')} tier 2 complicator(s), ${count('tier_3_manageable')} tier 3 manageable. Found: ${hits
          .map((h) => `${h.id} ${h.name}${h.confidence === 'low' ? ' (low confidence, inspect usage)' : ''}`)
          .join('; ')}.`,
        evidence: clip(hits.flatMap((h) => h.evidence.map((e) => `${h.id}: ${e}`)), 20),
        confidence: allLow ? 'low' : 'high',
        legacy_tier: worstTier,
      });
    }
  }

  // INV-07: database engine compatibility
  const dbCat = loadDbCompatibilityCatalogue(input.cataloguePaths?.dbCompatibility);
  if (!dbCat.ok) {
    checks.db_compatibility = `skipped: ${dbCat.reason}`;
  } else {
    const serviceDeps = input.priorSignals
      .flatMap((s) => s.implies ?? [])
      .filter((t) => t.startsWith('service_dep:'))
      .map((t) => t.slice('service_dep:'.length));
    const observations = collectEngineObservations(inv, serviceDeps, input.databaseEngine, vendorHits);
    const results = matchDbCompatibility(dbCat.data, observations);
    checks.db_compatibility = results.length > 0 ? 'matched' : 'no_match';
    if (results.length > 0) {
      assessment.database_compatibility = results;
      const unversioned = results.filter((r) => r.version === null);
      const describe = (r: DbCompatibilityResult): string => {
        if (r.version !== null) {
          const row = r.rows[0]!;
          return `${r.engine} ${r.version}: ${row.compatibility}, effort ${row.effort}, sovereign availability ${row.sovereign_availability}`;
        }
        const avail = [...new Set(r.rows.map((x) => x.sovereign_availability))].join(' or ');
        return `${r.engine} (version not determined): sovereign availability ${avail} depending on version`;
      };
      signals.push({
        id: 'INV-07',
        source: 'static_analysis',
        category: 'infrastructure_platform',
        severity: worstSeverity(results.map((r) => r.severity)),
        derivation: `Database engine compatibility (db-compatibility-catalogue.yaml): ${results.map(describe).join('; ')}.${unversioned.length > 0 ? ' Pin the engine version in a container image tag or IaC state to classify version-dependent rows.' : ''}`,
        evidence: clip([...new Set(results.flatMap((r) => r.evidence))], 20),
        confidence: unversioned.length === results.length ? 'low' : unversioned.length > 0 ? 'medium' : 'high',
      });
    }
  }

  assessment.reference_catalogue_checks = checks;
  return { signals, assessment };
}
