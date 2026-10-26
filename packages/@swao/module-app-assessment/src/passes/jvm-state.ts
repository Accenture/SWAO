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

// #3422: deterministic session and in-process state patterns for JVM / Spring
// services (Pass 02). Code patterns compile through the shared catalogue
// matcher (compileTokenMatcher / compileRegexMatcher, #3410: identifier
// boundaries, ReDoS guard, data-content masking via scanLines); configuration
// patterns test the dotted key path of each line (configKeysPerLine). Files
// come from the central source scope (#3428), so the test-code setting
// (#3403) applies: under `exclude` test files are never listed, otherwise
// their hits are counted separately and never decide the session model.

import { readFileSync } from 'fs';
import type { SourceFile } from '@swao/core';
import {
  compileTokenMatcher,
  compileRegexMatcher,
  anyOf,
  isScannableFile,
  pathClassOf,
  scanLines,
  type LineMatcher,
  type PathClass,
  type ClassCounts,
} from './catalogue-matcher.js';
import { configKeysPerLine, isJvmBuildFile, isJvmCodeFile, isPropertiesFile, isSpringConfigFile } from './jvm-source-patterns.js';
import type { JvmDependency } from './jvm-build-files.js';

/** What a JVM state finding is about. */
export type JvmStateKind =
  /** HttpSession, @SessionAttributes, session-scoped beans: container (in-memory) sessions. */
  | 'http_session'
  /** Spring Session: sessions in an external store (Redis, JDBC, MongoDB, Hazelcast). */
  | 'spring_session'
  /** `server.servlet.session.*` settings (timeout, cookie, persistent). */
  | 'servlet_session_config'
  /** Stateless security configuration (SessionCreationPolicy.STATELESS, JWT resource server). */
  | 'stateless_auth'
  /** In-process caches (ConcurrentMapCacheManager, Caffeine, Guava, Ehcache, spring.cache.type simple). */
  | 'in_memory_cache'
  /** Static mutable collections (`static final Map<..> X = new ConcurrentHashMap<>()`). */
  | 'static_mutable_state'
  /** Redis connection (Spring Data Redis): an external stateful component. */
  | 'redis'
  /** Session affinity (sticky sessions) in ingress, Service, proxy or app-server configuration. */
  | 'sticky_session'
  /** #3485: JDBC / R2DBC database access (datasource URL or driver class, JdbcTemplate, driver or starter dependency). */
  | 'jdbc'
  /** #3485: JPA / Hibernate (@Entity, JPA repositories, EntityManager, persistence.xml, spring.jpa.*, JPA starter). */
  | 'jpa'
  /** #3485: Kotlin `object` / `companion object` members and top-level properties that hold mutable state. */
  | 'kotlin_object_state';

export const JVM_STATE_KINDS: readonly JvmStateKind[] = [
  'http_session', 'spring_session', 'servlet_session_config', 'stateless_auth',
  'in_memory_cache', 'static_mutable_state', 'redis', 'sticky_session',
  'jdbc', 'jpa', 'kotlin_object_state',
];

/** #3485: database kinds; their engines are taken from production hits only. */
const DATABASE_KINDS: ReadonlySet<JvmStateKind> = new Set<JvmStateKind>(['jdbc', 'jpa']);

/** #3485: engines that run inside the JVM process or on local disk. */
export const EMBEDDED_DATABASE_ENGINES: ReadonlySet<string> = new Set(['h2', 'hsqldb', 'derby', 'sqlite']);

export interface JvmStateLocation { file: string; line: number; path_class: PathClass; match: string }

export interface JvmStateFinding {
  kind: JvmStateKind;
  total: number;
  byClass: ClassCounts;
  /** Production first, capped at MAX_STATE_LOCATIONS. */
  locations: JvmStateLocation[];
  /**
   * Spring Session store when named (`redis`, `jdbc`, `mongodb`, `hazelcast`);
   * for `jdbc` / `jpa` the database engines named by production hits
   * (`postgresql`, `mysql`, `mariadb`, `oracle`, `sqlserver`, `db2`, `h2`, ...).
   */
  stores?: string[];
}

export interface JvmStateScan {
  /** A JVM build file or JVM source file is in scope. */
  jvm: boolean;
  /** Spring Boot detected (build file dependency or @SpringBootApplication). */
  springBoot: boolean;
  /** Evidence for the stack (build file or application class), root-relative. */
  stackEvidence: string | null;
  jvmCodeFiles: number;
  configFiles: number;
  /** #3485: JVM, Gradle and configuration files skipped because they belong to an Android (mobile) app. */
  androidFilesExcluded: number;
  findings: Map<JvmStateKind, JvmStateFinding>;
}

/** #3485: options of scanJvmState. */
export interface ScanJvmStateOptions {
  /**
   * Scope-resolved build dependencies (collectJvmProject). Only these decide
   * the database dependencies of the build file: a line regex cannot see a
   * `<scope>test</scope>` on the next line or a `testImplementation`.
   */
  dependencies?: readonly JvmDependency[];
}

export const MAX_STATE_LOCATIONS = 20;

// ---------------------------------------------------------------------------
// Code rules (JVM source files)
// ---------------------------------------------------------------------------

interface CodeRule { kind: JvmStateKind; matcher: LineMatcher; store?: (text: string) => string | undefined }

function token(tokens: string[], caseSensitive = true): LineMatcher {
  const m = compileTokenMatcher(tokens, { match: 'identifier', caseSensitive });
  if (!m) throw new Error('#3422: empty token list');
  return m;
}

function regex(src: string): LineMatcher {
  const c = compileRegexMatcher(src, { caseSensitive: true });
  if (!c.ok) throw new Error(`#3422: state pattern rejected (${c.reason}): ${src}`);
  return c.matcher;
}

const SPRING_SESSION_STORE: Readonly<Record<string, string>> = {
  EnableRedisHttpSession: 'redis', EnableRedisIndexedHttpSession: 'redis', EnableRedisWebSession: 'redis',
  EnableJdbcHttpSession: 'jdbc', EnableMongoHttpSession: 'mongodb', EnableMongoWebSession: 'mongodb',
  EnableHazelcastHttpSession: 'hazelcast',
};

const CODE_RULES: readonly CodeRule[] = [
  {
    kind: 'http_session',
    matcher: anyOf([
      token(['HttpSession', '@SessionAttributes', '@SessionAttribute', '@SessionScope', 'SCOPE_SESSION']),
      regex('\\.getSession\\(\\s{0,10}(?:true|false)?\\s{0,10}\\)'),
      regex('@Scope\\([^)"]{0,40}"session"'),
    ]) as LineMatcher,
  },
  {
    kind: 'spring_session',
    matcher: token([...Object.keys(SPRING_SESSION_STORE).map((k) => `@${k}`), '@EnableSpringHttpSession']),
    store: (text) => {
      for (const [k, v] of Object.entries(SPRING_SESSION_STORE)) if (text.includes(k)) return v;
      return undefined;
    },
  },
  {
    kind: 'stateless_auth',
    matcher: anyOf([
      token(['SessionCreationPolicy.STATELESS']),
      regex('\\.oauth2ResourceServer\\('),
      token(['JwtDecoder', 'NimbusJwtDecoder', 'io.jsonwebtoken', 'com.auth0.jwt']),
    ]) as LineMatcher,
  },
  {
    kind: 'in_memory_cache',
    matcher: anyOf([
      token(['ConcurrentMapCacheManager', 'CaffeineCacheManager', 'Caffeine.newBuilder', 'CacheBuilder.newBuilder', 'org.ehcache', 'net.sf.ehcache']),
    ]) as LineMatcher,
  },
  {
    kind: 'static_mutable_state',
    // `static` + a mutable JDK collection type + `= new`, bounded gaps so the
    // pattern stays linear (immutable `Map.of` / `List.of` never match).
    matcher: regex('\\bstatic\\s[^=;(]{0,120}\\b(?:Map|HashMap|ConcurrentHashMap|ConcurrentMap|List|ArrayList|LinkedList|CopyOnWriteArrayList|Set|HashSet|Queue|Deque|ArrayDeque)\\s{0,10}<[^;=\\n]{0,200}>\\s{1,10}[A-Za-z_$][A-Za-z0-9_$]{0,80}\\s{0,10}=\\s{0,10}new\\s'),
  },
  {
    kind: 'redis',
    matcher: token(['RedisConnectionFactory', 'LettuceConnectionFactory', 'JedisConnectionFactory', 'RedisTemplate', 'StringRedisTemplate', 'RedissonClient']),
  },
  {
    // #3485: JDBC access in code. A JDBC URL literal records only its
    // `jdbc:<engine>:` prefix (never the host or credentials).
    kind: 'jdbc',
    matcher: anyOf([
      token(['JdbcTemplate', 'NamedParameterJdbcTemplate', 'JdbcClient', 'HikariDataSource', 'DataSourceBuilder', 'DriverManager.getConnection']),
      regex('\\bjdbc:(?:postgresql|mysql|mariadb|oracle|sqlserver|jtds|db2|h2|hsqldb|derby|sqlite):'),
    ]) as LineMatcher,
    store: (text) => jdbcUrlEngine(text),
  },
  {
    // #3485: JPA. Repository types only with their type arguments, so import
    // lines do not count twice; generic Spring Data repositories
    // (CrudRepository) are also used for Redis and MongoDB and do not count.
    kind: 'jpa',
    matcher: anyOf([
      token(['@Entity', '@EnableJpaRepositories', '@PersistenceContext', 'EntityManager', 'EntityManagerFactory']),
      regex('\\b(?:JpaRepository|JpaSpecificationExecutor|R2dbcRepository)\\s{0,10}<'),
    ]) as LineMatcher,
  },
];

// ---------------------------------------------------------------------------
// #3485: database engines (vocabulary of the Prisma `provider` values where
// one exists: postgresql, mysql, sqlserver, sqlite)
// ---------------------------------------------------------------------------

const ENGINE_NAMES: ReadonlyArray<{ re: RegExp; engine: string }> = [
  { re: /mariadb/, engine: 'mariadb' },
  { re: /postgres/, engine: 'postgresql' },
  { re: /mysql/, engine: 'mysql' },
  { re: /oracle/, engine: 'oracle' },
  { re: /sql_?server|mssql|jtds/, engine: 'sqlserver' },
  { re: /(?<![a-z0-9])db2/, engine: 'db2' },
  { re: /hsql/, engine: 'hsqldb' },
  { re: /(?<![a-z0-9])h2(?![0-9])/, engine: 'h2' },
  { re: /derby/, engine: 'derby' },
  { re: /sqlite/, engine: 'sqlite' },
];

/** Engine named by a driver class, Hibernate dialect, `spring.jpa.database` value or URL sub-protocol. */
export function databaseEngineOf(text: string): string | undefined {
  const t = text.toLowerCase();
  for (const e of ENGINE_NAMES) if (e.re.test(t)) return e.engine;
  return undefined;
}

// `jdbc:tc:` (Testcontainers) is test infrastructure, not an engine.
const JDBC_URL_RE = /\bjdbc:(?!tc:)([A-Za-z0-9]{2,20}):/i;
const R2DBC_URL_RE = /\br2dbc:(?:pool:)?([A-Za-z0-9]{2,20}):/i;

/** Engine of the first JDBC or R2DBC URL on the line. */
export function jdbcUrlEngine(text: string): string | undefined {
  const m = JDBC_URL_RE.exec(text) ?? R2DBC_URL_RE.exec(text);
  return m ? databaseEngineOf(m[1] ?? '') : undefined;
}

/** Build dependencies that mean database access: group:artifact (or artifact prefix) to kind and engine. */
const DATABASE_DEPENDENCIES: ReadonlyArray<{ group: string; artifact: string | RegExp; kind: JvmStateKind; engine?: string }> = [
  { group: 'org.springframework.boot', artifact: 'spring-boot-starter-data-jpa', kind: 'jpa' },
  { group: 'org.springframework.data', artifact: 'spring-data-jpa', kind: 'jpa' },
  { group: 'org.hibernate.orm', artifact: 'hibernate-core', kind: 'jpa' },
  { group: 'org.hibernate', artifact: 'hibernate-core', kind: 'jpa' },
  { group: 'org.springframework.boot', artifact: 'spring-boot-starter-jdbc', kind: 'jdbc' },
  { group: 'org.springframework.boot', artifact: 'spring-boot-starter-data-jdbc', kind: 'jdbc' },
  { group: 'org.springframework.boot', artifact: 'spring-boot-starter-data-r2dbc', kind: 'jdbc' },
  { group: 'org.postgresql', artifact: 'postgresql', kind: 'jdbc', engine: 'postgresql' },
  { group: 'org.postgresql', artifact: 'r2dbc-postgresql', kind: 'jdbc', engine: 'postgresql' },
  { group: 'com.mysql', artifact: 'mysql-connector-j', kind: 'jdbc', engine: 'mysql' },
  { group: 'mysql', artifact: 'mysql-connector-java', kind: 'jdbc', engine: 'mysql' },
  { group: 'org.mariadb.jdbc', artifact: 'mariadb-java-client', kind: 'jdbc', engine: 'mariadb' },
  { group: 'com.oracle.database.jdbc', artifact: /^ojdbc\d{0,2}$/, kind: 'jdbc', engine: 'oracle' },
  { group: 'com.microsoft.sqlserver', artifact: 'mssql-jdbc', kind: 'jdbc', engine: 'sqlserver' },
  { group: 'com.ibm.db2', artifact: 'jcc', kind: 'jdbc', engine: 'db2' },
  { group: 'com.h2database', artifact: 'h2', kind: 'jdbc', engine: 'h2' },
  { group: 'org.hsqldb', artifact: 'hsqldb', kind: 'jdbc', engine: 'hsqldb' },
  { group: 'org.apache.derby', artifact: 'derby', kind: 'jdbc', engine: 'derby' },
  { group: 'org.xerial', artifact: 'sqlite-jdbc', kind: 'jdbc', engine: 'sqlite' },
];

function databaseDependency(d: JvmDependency): { kind: JvmStateKind; engine?: string } | null {
  for (const e of DATABASE_DEPENDENCIES) {
    if (d.group !== e.group) continue;
    if (typeof e.artifact === 'string' ? d.artifact === e.artifact : e.artifact.test(d.artifact)) return { kind: e.kind, ...(e.engine ? { engine: e.engine } : {}) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// #3485: Kotlin object and top-level mutable state (indentation scoped)
// ---------------------------------------------------------------------------

/** `object Name`, `companion object`, with optional visibility / data modifiers. Anonymous `object :` expressions do not count. */
const KOTLIN_OBJECT_RE = /^\s*(?:(?:private|internal|public|protected)\s{1,10})?(?:data\s{1,10})?(?:companion\s{1,10}object\b|object\s{1,10}[A-Za-z_])/;
/** `val` / `var` declaration head: the prefix before it is checked separately (modifiers only). */
const KOTLIN_PROPERTY_RE = /\b(val|var)\s{1,10}([A-Za-z_][A-Za-z0-9_]{0,80})\s{0,10}(:[^=]{0,200})?(=.{0,300})?$/;
const KOTLIN_MODIFIERS: ReadonlySet<string> = new Set([
  'private', 'internal', 'public', 'protected', 'lateinit', 'override', 'open', '@volatile', '@jvmstatic', '@jvmfield',
]);
const KOTLIN_MUTABLE_TYPE_RE = /\b(?:Mutable(?:Map|List|Set|Collection)|ConcurrentHashMap|ConcurrentMap|HashMap|LinkedHashMap|ArrayList|LinkedList|HashSet|LinkedHashSet|CopyOnWriteArrayList|ArrayDeque)\s{0,10}</;
const KOTLIN_MUTABLE_INIT_RE = /^=\s{0,10}(?:mutableMapOf|mutableListOf|mutableSetOf|hashMapOf|hashSetOf|arrayListOf|linkedMapOf|linkedSetOf|sortedMapOf|ConcurrentHashMap|HashMap|LinkedHashMap|ArrayList|LinkedList|HashSet|LinkedHashSet|CopyOnWriteArrayList|ArrayDeque|AtomicInteger|AtomicLong|AtomicBoolean|AtomicReference)\b/;

/**
 * The `val` / `var` declaration head when the line declares mutable state:
 * any `var`, or a `val` holding a mutable collection or atomic. Null
 * otherwise. Only the head is returned, never the initialiser.
 */
export function kotlinMutableProperty(line: string): string | null {
  const m = KOTLIN_PROPERTY_RE.exec(line);
  if (!m) return null;
  const prefix = line.slice(0, m.index).trim();
  if (prefix.length > 0 && !prefix.split(/\s+/).every((w) => KOTLIN_MODIFIERS.has(w.toLowerCase()))) return null;
  const kind = m[1] as 'val' | 'var';
  const type = m[3] ?? '';
  const init = (m[4] ?? '').trim();
  const mutable = kind === 'var' || KOTLIN_MUTABLE_TYPE_RE.test(type) || KOTLIN_MUTABLE_INIT_RE.test(init);
  return mutable ? `${kind} ${m[2]}` : null;
}

function indentOf(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === ' ') n++;
    else if (ch === '\t') n += 4;
    else break;
  }
  return n;
}

// ---------------------------------------------------------------------------
// #3485: Android (mobile) folders
// ---------------------------------------------------------------------------

/** The Android Gradle plugin in a build file (`com.android.application`, `com.android.library`, the AGP classpath). */
const ANDROID_PLUGIN_RE = /com\.android\.(?:application|library|tools\.build:gradle)/;

/**
 * True for a path under an `android/` folder (React Native, Flutter,
 * Capacitor): the first `android` segment before any `src` segment, so a
 * Java package named `android` inside `src/` does not count.
 */
export function isAndroidFolderPath(rel: string): boolean {
  const segs = rel.split('/');
  for (let i = 0; i < segs.length - 1; i++) {
    const s = (segs[i] ?? '').toLowerCase();
    if (s === 'src') return false;
    if (s === 'android') return true;
  }
  return false;
}

/**
 * Source folders (`<module>/src/`, `src/` for a module at the source root) of
 * Android modules, from their production `AndroidManifest.xml`. Only the
 * module's `src/` tree is excluded, so a Spring service next to a root-level
 * Android app keeps its files; the module build file is covered by
 * ANDROID_PLUGIN_RE. A manifest in test resources does not count.
 */
function androidSourceRoots(files: readonly SourceFile[]): string[] {
  const roots = new Set<string>();
  for (const f of files) {
    if (f.name !== 'AndroidManifest.xml' || f.isTest) continue;
    const i = f.rel.lastIndexOf('src/');
    if (i === 0 || (i > 0 && f.rel[i - 1] === '/')) roots.add(f.rel.slice(0, i + 4));
    else roots.add(`${f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/') + 1) : ''}src/`);
  }
  return [...roots].sort();
}

// ---------------------------------------------------------------------------
// Configuration rules (dotted key + value)
// ---------------------------------------------------------------------------

interface ConfigRule { kind: JvmStateKind; test: (key: string, value: string) => boolean; store?: (key: string, value: string) => string | undefined }

const CONFIG_RULES: readonly ConfigRule[] = [
  {
    kind: 'spring_session',
    test: (k) => k.startsWith('spring.session.'),
    store: (k, v) => {
      if (k === 'spring.session.store-type') return v.toLowerCase() || undefined;
      const m = /^spring\.session\.(redis|jdbc|mongodb|hazelcast)\b/.exec(k);
      return m?.[1];
    },
  },
  { kind: 'servlet_session_config', test: (k) => k.startsWith('server.servlet.session.') || k.startsWith('server.reactive.session.') },
  {
    kind: 'in_memory_cache',
    test: (k, v) => k === 'spring.cache.type' && /^(?:simple|caffeine|jcache|ehcache)$/i.test(v),
  },
  {
    kind: 'redis',
    test: (k, v) => /^spring\.(?:data\.)?redis\.(?:host|url|cluster\.nodes|sentinel\.nodes)$/.test(k) || (k === 'spring.cache.type' && /^redis$/i.test(v)),
  },
  {
    // #3485: datasource URL (also Hikari `jdbc-url`, R2DBC, Flyway, Liquibase) and driver class.
    kind: 'jdbc',
    test: (k) => /^spring\.(?:datasource(?:\.[\w-]{1,40})?\.(?:url|jdbc-url|driver-class-name)|r2dbc\.url|flyway\.url|liquibase\.url)$/.test(k),
    store: (k, v) => (k.endsWith('driver-class-name') ? databaseEngineOf(v) : jdbcUrlEngine(v)),
  },
  {
    // #3485: JPA / Hibernate settings; the platform, dialect or database value names the engine.
    kind: 'jpa',
    test: (k) => k.startsWith('spring.jpa.'),
    store: (k, v) => (/^spring\.jpa\.(?:database|database-platform|properties\.hibernate\.dialect)$/.test(k) ? databaseEngineOf(v) : undefined),
  },
];

// Session affinity markers in any YAML / properties / proxy configuration.
const STICKY_MATCHER: LineMatcher = anyOf([
  compileTokenMatcher([
    'nginx.ingress.kubernetes.io/affinity', 'nginx.ingress.kubernetes.io/session-cookie-name',
    'stickiness.enabled=true', 'stickysession', 'jvmRoute', 'loadbalancer.sticky',
  ], { match: 'substring', caseSensitive: false }),
  regex('sessionAffinity:\\s{0,10}["\']?ClientIP'),
]) as LineMatcher;

// Build-file dependencies: Spring Session store modules and the Redis starter.
const BUILD_SESSION_RE = /spring-session-(data-redis|jdbc|data-mongodb|hazelcast)/;
const BUILD_REDIS_RE = /spring-boot-starter-data-redis|spring-data-redis/;

const STICKY_EXTENSIONS: ReadonlySet<string> = new Set(['.yml', '.yaml', '.properties', '.conf', '.cfg', '.xml', '.toml']);

function isStickyCandidate(f: SourceFile): boolean {
  return STICKY_EXTENSIONS.has(f.ext);
}

function configValue(line: string): string {
  const m = /[:=][ \t]{0,20}["']?([^"'#\s]{0,200})/.exec(line);
  return m?.[1] ?? '';
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

function readText(f: SourceFile): string | null {
  try { return readFileSync(f.abs, 'utf-8'); } catch { return null; }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Scan the source-scope listing for JVM session, in-process state and database patterns. */
export function scanJvmState(files: readonly SourceFile[], opts: ScanJvmStateOptions = {}): JvmStateScan {
  const all = new Map<JvmStateKind, { total: number; byClass: ClassCounts; locs: JvmStateLocation[]; stores: Set<string> }>();
  let jvmCodeFiles = 0;
  let configFiles = 0;
  let androidFilesExcluded = 0;
  let jvm = false;
  let springBoot = false;
  let stackEvidence: string | null = null;

  const record = (kind: JvmStateKind, f: SourceFile, line: number, match: string, store?: string): void => {
    let e = all.get(kind);
    if (!e) { e = { total: 0, byClass: { prod: 0, test: 0, unknown: 0 }, locs: [], stores: new Set() }; all.set(kind, e); }
    const pc = pathClassOf(f);
    e.total++;
    e.byClass[pc]++;
    e.locs.push({ file: f.rel, line, path_class: pc, match: match.slice(0, 80) });
    // #3485: a database engine seen in test code only (H2 for tests) is not the service's engine.
    if (store && !(DATABASE_KINDS.has(kind) && pc === 'test')) e.stores.add(store);
  };

  // #3485: Android (mobile) app folders are not a JVM server workload.
  const androidRoots = androidSourceRoots(files);
  const isAndroid = (rel: string): boolean => isAndroidFolderPath(rel) || androidRoots.some((r) => rel.startsWith(r));

  for (const f of files) {
    const build = isJvmBuildFile(f);
    const code = isJvmCodeFile(f);
    const springConfig = isSpringConfigFile(f) || isPropertiesFile(f);
    const sticky = isStickyCandidate(f);
    if (!build && !code && !springConfig && !sticky) continue;
    if (isAndroid(f.rel)) { androidFilesExcluded++; continue; }
    if (!isScannableFile(f)) continue;
    const text = readText(f);
    if (text === null) continue;
    if (build && ANDROID_PLUGIN_RE.test(text)) { androidFilesExcluded++; continue; }
    if (build) {
      jvm = true;
      if (/spring-boot/.test(text) && !springBoot) { springBoot = true; stackEvidence = f.rel; }
      if (stackEvidence === null) stackEvidence = f.rel;
      // Spring Session and Redis starters declared in the build file.
      const buildLines = scanLines(text);
      for (let i = 0; i < buildLines.length; i++) {
        const l = buildLines[i] as string;
        const m = BUILD_SESSION_RE.exec(l);
        if (m) record('spring_session', f, i + 1, m[0], m[1]?.replace('data-', ''));
        else {
          const redis = BUILD_REDIS_RE.exec(l);
          if (redis) record('redis', f, i + 1, redis[0]);
        }
      }
      continue;
    }
    const lines = scanLines(text);
    if (code) {
      jvm = true;
      jvmCodeFiles++;
      const kotlin = f.ext.toLowerCase() === '.kt';
      // #3485: open Kotlin objects (declaration indent, member indent once seen).
      const objects: Array<{ indent: number; member: number | null }> = [];
      for (let i = 0; i < lines.length; i++) {
        const l = (lines[i] as string).replace(/\r$/, '');
        if (l.trim().length === 0 || /^\s*(?:\/\/|\*|\/\*)/.test(l)) continue;
        if (!springBoot && /@SpringBootApplication\b/.test(l)) { springBoot = true; stackEvidence = `${f.rel}:${i + 1}`; }
        for (const r of CODE_RULES) {
          const m = r.matcher.exec(l);
          if (m) record(r.kind, f, i + 1, m.text, r.store?.(l));
        }
        if (kotlin) {
          // Indentation scoping (brace counting desyncs on string templates):
          // members sit one level under `object` / `companion object`;
          // top-level declarations sit at indent 0 outside any object.
          const indent = indentOf(l);
          while (objects.length > 0 && indent <= (objects[objects.length - 1] as { indent: number }).indent) objects.pop();
          const top = objects[objects.length - 1];
          if (top && top.member === null) top.member = indent;
          const member = top !== undefined ? indent === top.member : indent === 0;
          if (member) {
            const head = kotlinMutableProperty(l);
            if (head) record('kotlin_object_state', f, i + 1, head);
          }
          if (KOTLIN_OBJECT_RE.test(l) && l.includes('{')) objects.push({ indent, member: null });
        }
      }
      continue;
    }
    if (springConfig) configFiles++;
    const keys = springConfig ? configKeysPerLine(f, lines) : [];
    if (f.name === 'persistence.xml') {
      // #3485: a JPA deployment descriptor.
      const at = lines.findIndex((l) => l.includes('<persistence-unit'));
      record('jpa', f, at >= 0 ? at + 1 : 1, 'persistence.xml');
    }
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i] as string;
      if (l.length === 0 || /^\s*[#!]/.test(l)) continue;
      const key = keys[i];
      const recorded = new Set<JvmStateKind>();
      if (springConfig && key) {
        const value = configValue(l);
        // #3422: the location records the dotted key, never the line: a value
        // such as `redis://user:password@host` must not reach the pass YAML
        // (CLAUDE.md 5.7, same rule as recordMatch: false in the matcher).
        for (const r of CONFIG_RULES) {
          if (r.test(key, value)) { record(r.kind, f, i + 1, key, r.store?.(key, value)); recorded.add(r.kind); }
        }
      }
      // #3485: a JDBC URL or Hibernate dialect under any other key (Helm
      // values, persistence.xml, app-server datasources). The location
      // records the `jdbc:<engine>` prefix only.
      if (!recorded.has('jdbc')) {
        const engine = jdbcUrlEngine(l);
        if (engine) record('jdbc', f, i + 1, `jdbc:${engine}`, engine);
      }
      if (!recorded.has('jpa') && l.includes('hibernate.dialect')) record('jpa', f, i + 1, 'hibernate.dialect', databaseEngineOf(l.replace('hibernate.dialect', '')));
      if (sticky) {
        const m = STICKY_MATCHER.exec(l);
        if (m) record('sticky_session', f, i + 1, m.text);
      }
    }
  }

  // #3485: database dependencies of the build, scope-resolved (test scope and
  // transitive lockfile entries never count). Evidence is the declaring line.
  const byRel = new Map(files.map((f) => [f.rel, f] as const));
  const seenDeps = new Set<string>();
  for (const d of opts.dependencies ?? []) {
    if (!d.direct || d.scope === 'test' || isAndroid(d.manifest)) continue;
    const db = databaseDependency(d);
    const f = byRel.get(d.manifest);
    if (!db || !f) continue;
    const id = `${d.manifest}|${d.group}:${d.artifact}`;
    if (seenDeps.has(id)) continue;
    seenDeps.add(id);
    const text = readText(f) ?? '';
    const re = new RegExp(`(?<![\\w.-])${escapeRegex(d.artifact)}(?![\\w.-])`);
    const at = text.split('\n').findIndex((l) => re.test(l));
    record(db.kind, f, at >= 0 ? at + 1 : 1, `${d.group}:${d.artifact}`, db.engine);
  }

  const rank: Record<PathClass, number> = { prod: 0, unknown: 1, test: 2 };
  const findings = new Map<JvmStateKind, JvmStateFinding>();
  for (const kind of JVM_STATE_KINDS) {
    const e = all.get(kind);
    if (!e) continue;
    const locations = e.locs
      .map((loc, i) => ({ loc, i }))
      .sort((a, b) => rank[a.loc.path_class] - rank[b.loc.path_class] || a.i - b.i)
      .slice(0, MAX_STATE_LOCATIONS)
      .map((x) => x.loc);
    findings.set(kind, {
      kind,
      total: e.total,
      byClass: e.byClass,
      locations,
      ...(e.stores.size > 0 ? { stores: [...e.stores].sort() } : {}),
    });
  }
  return { jvm, springBoot, stackEvidence, jvmCodeFiles, configFiles, androidFilesExcluded, findings };
}

/** Production (or unclassified) hits exist for this finding. */
export function inProduction(f: JvmStateFinding | undefined): boolean {
  return f !== undefined && f.byClass.prod + f.byClass.unknown > 0;
}
