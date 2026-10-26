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

// #3420: deterministic Maven and Gradle build-file reader (Design 037,
// Pass-05 SBOM). One parser for every consumer: Pass 05 SBOM (OSV lookups,
// Java runtime EOL), Pass 01 INV reference scans (collectDependencyInventory),
// Pass 06 TF (#3421 Spring Boot detection) and the #3430 landing-zone
// footprint deriver.
//
// Nothing is executed: no Maven, no Gradle, no network. Versions are resolved
// from what the repository itself declares:
//
//   Maven   <properties> (with parent inheritance through <relativePath>),
//           ${project.version} / ${project.parent.version},
//           <dependencyManagement> of the pom and its local parents,
//           local BOM imports (scope import), and the Spring Boot family rule
//           (an org.springframework.boot artifact carries the Boot parent /
//           BOM version).
//   Gradle  string, map and Kotlin named-argument notation, ext / def / val
//           variables, gradle.properties, version catalogs
//           (gradle/libs.versions.toml: [versions], [libraries], [bundles],
//           [plugins]) and gradle.lockfile (exact, incl. transitive).
//
// A version that cannot be resolved locally (remote parent, remote BOM,
// version range, unknown property) is reported as null with
// versionSource 'unresolved'. It is never guessed: an OSV query without a
// concrete version would return every advisory ever filed for the package.
//
// Manifest discovery goes through the central source scope (#3428): no walker
// of its own, canonical skips (target/, build/, .gradle/), and test-resource
// manifests (src/test/resources/pom.xml) are ignored.

import { readFileSync } from 'fs';
import { listSourceFiles } from '@swao/core';

// ---------------------------------------------------------------------------
// Public model
// ---------------------------------------------------------------------------

export type JvmBuildTool = 'maven' | 'gradle';
export type JvmScope = 'compile' | 'runtime' | 'provided' | 'test' | 'system' | 'import';
export type JvmVersionSource =
  | 'declared'   // literal version in the dependency declaration
  | 'property'   // ${prop} / $var resolved from properties, ext, gradle.properties
  | 'managed'    // <dependencyManagement> of the pom, a local parent or a local BOM
  | 'bom_family' // Spring Boot artifact versioned by the Boot parent / BOM / plugin
  | 'catalog'    // Gradle version catalog
  | 'lockfile'   // gradle.lockfile (exact)
  | 'unresolved';

export interface JvmDependency {
  group: string;
  artifact: string;
  /** Concrete version, or null when it could not be resolved locally. */
  version: string | null;
  /** Raw declared version text (before resolution), when one was written. */
  declaredVersion?: string;
  scope: JvmScope;
  versionSource: JvmVersionSource;
  buildTool: JvmBuildTool;
  /** False for transitive entries that only appear in gradle.lockfile. */
  direct: boolean;
  /** Build file relative to the source root (forward slashes). */
  manifest: string;
  /** Package URL (pkg:maven/group/artifact@version, version omitted when unresolved). */
  purl: string;
}

export interface JavaVersionEvidence {
  /** Java feature release (8 for 1.8). */
  major: number;
  /** Raw value as written. */
  raw: string;
  /** Build or version file relative to the source root. */
  file: string;
  /** Setting that declared it (maven.compiler.release, toolchain, sourceCompatibility, ...). */
  key: string;
}

export interface JvmProject {
  buildTools: JvmBuildTool[];
  /** Every pom.xml / build.gradle(.kts) read, relative to the source root, walk order. */
  manifests: string[];
  /** Number of build files (a multi-module reactor counts each module). */
  modules: number;
  dependencies: JvmDependency[];
  /**
   * Lowest Java feature release declared across the build (the riskiest
   * runtime for an EOL verdict); null when no build file declares one.
   */
  java: JavaVersionEvidence | null;
  /** Every Java declaration found, walk order. */
  javaDeclarations: JavaVersionEvidence[];
  /** Spring Boot version from parent, BOM import or Gradle plugin; null when absent or unresolved. */
  springBootVersion: string | null;
  /** True when Spring Boot is used at all (parent, BOM, plugin or a starter dependency). */
  usesSpringBoot: boolean;
}

export interface CollectJvmProjectOptions {
  /** Same meaning as listSourceFiles maxDepth. Default 6 (service/module/sub/pom.xml). */
  maxDepth?: number;
}

const MAX_MANIFESTS = 300;
const MAX_FILE_BYTES = 2_000_000;

// ---------------------------------------------------------------------------
// Minimal XML reader (linear; elements and text only)
// ---------------------------------------------------------------------------

export interface XmlNode {
  name: string;
  children: XmlNode[];
  text: string;
}

/**
 * Tolerant, linear XML reader for build files. Comments, processing
 * instructions and DOCTYPE are skipped; CDATA becomes text; attributes are
 * ignored; namespace prefixes are dropped. Unbalanced close tags pop to the
 * nearest matching open element.
 */
export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: '#root', children: [], text: '' };
  const stack: XmlNode[] = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    const top = stack[stack.length - 1]!;
    if (lt < 0) { top.text += src.slice(i); break; }
    if (lt > i) top.text += src.slice(i, lt);
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      top.text += src.slice(lt + 9, end < 0 ? n : end);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (src.startsWith('<!', lt)) {
      const end = src.indexOf('>', lt + 2);
      i = end < 0 ? n : end + 1;
      continue;
    }
    // Tag end, quote-aware so '>' inside an attribute value does not end it.
    let j = lt + 1;
    let quote = '';
    while (j < n) {
      const c = src[j]!;
      if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '>') break;
      j++;
    }
    const inner = src.slice(lt + 1, j);
    i = j + 1;
    if (inner.startsWith('/')) {
      const name = localName(inner.slice(1).trim());
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k]!.name === name) { stack.length = k; break; }
      }
      continue;
    }
    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    let e = 0;
    while (e < body.length && !/\s/.test(body[e]!)) e++;
    const node: XmlNode = { name: localName(body.slice(0, e)), children: [], text: '' };
    top.children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}

function localName(name: string): string {
  const c = name.indexOf(':');
  return c >= 0 ? name.slice(c + 1) : name;
}

function xChild(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((c) => c.name === name);
}

function xChildren(node: XmlNode | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((c) => c.name === name) : [];
}

function xText(node: XmlNode | undefined, name: string): string | undefined {
  const t = xChild(node, name)?.text.trim();
  return t ? t : undefined;
}

function xPath(node: XmlNode | undefined, ...names: string[]): XmlNode | undefined {
  let cur = node;
  for (const n of names) cur = xChild(cur, n);
  return cur;
}

// ---------------------------------------------------------------------------
// Maven pom.xml
// ---------------------------------------------------------------------------

export interface PomDependencyDecl {
  groupId: string;
  artifactId: string;
  version?: string;
  scope?: string;
  type?: string;
}

export interface PomModel {
  groupId?: string;
  artifactId?: string;
  version?: string;
  parent?: { groupId?: string; artifactId?: string; version?: string; relativePath?: string };
  properties: Record<string, string>;
  dependencies: PomDependencyDecl[];
  managed: PomDependencyDecl[];
  modules: string[];
  /** maven-compiler-plugin configuration (release / source / target), raw. */
  compiler: { release?: string; source?: string; target?: string };
  /** maven-toolchains-plugin <jdk><version>, raw. */
  toolchainJdk?: string;
}

function readDeps(container: XmlNode | undefined): PomDependencyDecl[] {
  const out: PomDependencyDecl[] = [];
  for (const d of xChildren(container, 'dependency')) {
    const groupId = xText(d, 'groupId');
    const artifactId = xText(d, 'artifactId');
    if (!groupId || !artifactId) continue;
    out.push({ groupId, artifactId, version: xText(d, 'version'), scope: xText(d, 'scope'), type: xText(d, 'type') });
  }
  return out;
}

/**
 * Parse one pom.xml. Only project-level <dependencies> are dependencies:
 * <dependencyManagement> entries are managed versions, and dependencies of
 * build plugins or inactive <profiles> are not part of the application.
 */
export function parsePom(content: string): PomModel {
  const doc = parseXml(content);
  const project = xChild(doc, 'project') ?? doc;
  const properties: Record<string, string> = {};
  for (const p of xChild(project, 'properties')?.children ?? []) properties[p.name] = p.text.trim();
  const parentNode = xChild(project, 'parent');
  const parent = parentNode
    ? {
      groupId: xText(parentNode, 'groupId'),
      artifactId: xText(parentNode, 'artifactId'),
      version: xText(parentNode, 'version'),
      // <relativePath/> (empty) means "repository only"; absent means ../pom.xml.
      relativePath: xChild(parentNode, 'relativePath') ? (xChild(parentNode, 'relativePath')!.text.trim()) : undefined,
    }
    : undefined;
  const compiler: PomModel['compiler'] = {};
  let toolchainJdk: string | undefined;
  const build = xChild(project, 'build');
  const plugins = [
    ...xChildren(xChild(build, 'plugins'), 'plugin'),
    ...xChildren(xPath(build, 'pluginManagement', 'plugins'), 'plugin'),
  ];
  for (const pl of plugins) {
    const id = xText(pl, 'artifactId');
    const conf = xChild(pl, 'configuration');
    if (id === 'maven-compiler-plugin') {
      compiler.release ??= xText(conf, 'release');
      compiler.source ??= xText(conf, 'source');
      compiler.target ??= xText(conf, 'target');
    } else if (id === 'maven-toolchains-plugin') {
      toolchainJdk ??= xText(xPath(conf, 'toolchains', 'jdk'), 'version');
    }
  }
  return {
    groupId: xText(project, 'groupId'),
    artifactId: xText(project, 'artifactId'),
    version: xText(project, 'version'),
    parent,
    properties,
    dependencies: readDeps(xChild(project, 'dependencies')),
    managed: readDeps(xPath(project, 'dependencyManagement', 'dependencies')),
    modules: xChildren(xChild(project, 'modules'), 'module').map((m) => m.text.trim()).filter(Boolean),
    compiler,
    toolchainJdk,
  };
}

const PROP_RE = /\$\{([^}]{1,200})\}/g;

/** Replace ${...} placeholders; null when one stays unresolved. */
function interpolate(raw: string, lookup: (key: string) => string | undefined): string | null {
  let cur = raw;
  for (let round = 0; round < 10 && cur.includes('${'); round++) {
    let missing = false;
    cur = cur.replace(PROP_RE, (_m, key: string) => {
      const v = lookup(key.trim());
      if (v === undefined) { missing = true; return `\${${key}}`; }
      return v;
    });
    if (missing) return null;
  }
  return cur.includes('${') ? null : cur;
}

/** Maven version ranges ([1.0,2.0), (,1.5]) and Gradle dynamic versions (1.+, latest.release) are not concrete. */
export function isConcreteVersion(v: string): boolean {
  if (!v) return false;
  if (/^[[(]/.test(v) || v.includes(',')) return false;
  if (v.includes('+') || v.startsWith('latest.')) return false;
  // npm range residue after a prefix strip (`1.0 <2.0`, `1.x`, `^1`, `1 || 2`).
  if (/[\s<>=|^~*]/.test(v) || /(^|\.)[xX](\.|$)/.test(v)) return false;
  return /^\d/.test(v);
}

const MAVEN_SCOPES: ReadonlySet<string> = new Set(['compile', 'runtime', 'provided', 'test', 'system', 'import']);

function mavenScope(raw: string | undefined): JvmScope {
  const s = (raw ?? 'compile').trim();
  return MAVEN_SCOPES.has(s) ? (s as JvmScope) : 'compile';
}

function posixJoin(dir: string, rel: string): string {
  const parts = (dir ? `${dir}/${rel}` : rel).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') { out.pop(); continue; }
    out.push(p);
  }
  return out.join('/');
}

function dirOf(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
}

const SPRING_BOOT_GROUP = 'org.springframework.boot';
const SPRING_BOOT_PARENTS: ReadonlySet<string> = new Set(['spring-boot-starter-parent', 'spring-boot-dependencies']);

interface PomEntry { rel: string; model: PomModel }

function resolveMaven(poms: PomEntry[], out: JvmProject): void {
  const byRel = new Map(poms.map((p) => [p.rel, p] as const));
  const byGa = new Map<string, PomEntry>();
  for (const p of poms) {
    const g = p.model.groupId ?? p.model.parent?.groupId;
    if (g && p.model.artifactId) byGa.set(`${g}:${p.model.artifactId}`, p);
  }

  const parentOf = (p: PomEntry): PomEntry | null => {
    const par = p.model.parent;
    if (!par) return null;
    if (par.relativePath !== '') {
      const rp = par.relativePath ?? '../pom.xml';
      const target = posixJoin(dirOf(p.rel), rp.endsWith('.xml') ? rp : `${rp}/pom.xml`);
      const hit = byRel.get(target);
      if (hit && (!par.artifactId || hit.model.artifactId === par.artifactId)) return hit;
    }
    if (par.groupId && par.artifactId) return byGa.get(`${par.groupId}:${par.artifactId}`) ?? null;
    return null;
  };

  /** Root-first ancestor chain including p (cycle-safe). */
  const chainOf = (p: PomEntry): PomEntry[] => {
    const chain: PomEntry[] = [];
    const seen = new Set<string>();
    let cur: PomEntry | null = p;
    while (cur && !seen.has(cur.rel)) { seen.add(cur.rel); chain.unshift(cur); cur = parentOf(cur); }
    return chain;
  };

  for (const p of poms) {
    const chain = chainOf(p);
    const props: Record<string, string> = {};
    for (const c of chain) Object.assign(props, c.model.properties);
    const m = p.model;
    const projectVersion = m.version ?? m.parent?.version;
    const builtins: Record<string, string | undefined> = {
      'project.version': projectVersion,
      'pom.version': projectVersion,
      version: projectVersion,
      'project.groupId': m.groupId ?? m.parent?.groupId,
      'project.artifactId': m.artifactId,
      'project.parent.version': m.parent?.version,
      'project.parent.groupId': m.parent?.groupId,
    };
    const lookup = (key: string): string | undefined => props[key] ?? builtins[key];
    const resolve = (raw: string | undefined): string | null => (raw === undefined ? null : interpolate(raw, lookup));

    // Spring Boot version: a Boot parent anywhere in the chain (the top of a
    // local chain may itself have a remote Boot parent) or a Boot BOM import.
    let boot: string | null = null;
    for (const c of chain) {
      const par = c.model.parent;
      if (par && par.groupId === SPRING_BOOT_GROUP && par.artifactId && SPRING_BOOT_PARENTS.has(par.artifactId)) {
        out.usesSpringBoot = true;
        boot = resolve(par.version) ?? boot;
      }
    }

    // Managed versions: root first so a child overrides its parent.
    const managed = new Map<string, string | undefined>();
    const visitedBoms = new Set<string>();
    const addManaged = (decls: PomDependencyDecl[]): void => {
      for (const d of decls) {
        if (d.scope === 'import' && (d.type ?? 'jar') === 'pom') {
          if (d.groupId === SPRING_BOOT_GROUP && d.artifactId === 'spring-boot-dependencies') {
            out.usesSpringBoot = true;
            boot = resolve(d.version) ?? boot;
          }
          const bom = byGa.get(`${d.groupId}:${d.artifactId}`);
          if (bom && !visitedBoms.has(bom.rel)) { visitedBoms.add(bom.rel); addManaged(bom.model.managed); }
          continue;
        }
        managed.set(`${d.groupId}:${d.artifactId}`, d.version);
      }
    };
    for (const c of chain) addManaged(c.model.managed);
    if (boot && !out.springBootVersion) out.springBootVersion = boot;

    for (const d of m.dependencies) {
      const group = resolve(d.groupId) ?? d.groupId;
      const artifact = resolve(d.artifactId) ?? d.artifactId;
      let version: string | null = null;
      let source: JvmVersionSource = 'unresolved';
      if (d.version !== undefined) {
        const v = resolve(d.version);
        if (v !== null && isConcreteVersion(v)) { version = v; source = d.version.includes('${') ? 'property' : 'declared'; }
      } else if (managed.has(`${group}:${artifact}`)) {
        const v = resolve(managed.get(`${group}:${artifact}`));
        if (v !== null && isConcreteVersion(v)) { version = v; source = 'managed'; }
      } else if (group === SPRING_BOOT_GROUP && boot && isConcreteVersion(boot)) {
        version = boot; source = 'bom_family';
      }
      if (group === SPRING_BOOT_GROUP) out.usesSpringBoot = true;
      out.dependencies.push(makeDep(group, artifact, version, d.version, mavenScope(d.scope), source, 'maven', true, p.rel));
    }

    // Java release for this module (effective, inherited properties).
    const javaCandidates: Array<[string, string | undefined]> = [
      ['maven-compiler-plugin release', m.compiler.release],
      ['maven.compiler.release', props['maven.compiler.release']],
      ['maven-toolchains-plugin jdk', m.toolchainJdk],
      ['java.version', props['java.version']],
      ['maven.compiler.source', props['maven.compiler.source']],
      ['maven-compiler-plugin source', m.compiler.source],
      ['maven.compiler.target', props['maven.compiler.target']],
    ];
    for (const [key, raw] of javaCandidates) {
      if (raw === undefined) continue;
      const v = resolve(raw);
      const major = v === null ? null : parseJavaMajor(v);
      if (major !== null) { out.javaDeclarations.push({ major, raw: v!, file: p.rel, key }); break; }
    }
  }
}

function makeDep(
  group: string, artifact: string, version: string | null, declared: string | undefined,
  scope: JvmScope, source: JvmVersionSource, tool: JvmBuildTool, direct: boolean, manifest: string,
): JvmDependency {
  const dep: JvmDependency = {
    group, artifact, version, scope, versionSource: source, buildTool: tool, direct, manifest,
    purl: `pkg:maven/${group}/${artifact}${version ? `@${version}` : ''}`,
  };
  if (declared !== undefined) dep.declaredVersion = declared;
  return dep;
}

/**
 * Java feature release from a version string: '1.8' -> 8, '17' -> 17,
 * '17.0.2' -> 17, 'VERSION_1_8' -> 8, 'VERSION_21' -> 21, '[17,18)' -> 17,
 * 'temurin-21.0.1' -> 21. Null when no plausible release (5..40) is found.
 */
export function parseJavaMajor(raw: string): number | null {
  const s = raw.trim().replace(/^VERSION_/, '').replace(/_/g, '.');
  const m = /^[[(]?\s*(?:[A-Za-z]+-)?(?:1\.)?(\d{1,2})(?!\d)/.exec(s);
  if (!m) return null;
  const major = parseInt(m[1]!, 10);
  return major >= 5 && major <= 40 ? major : null;
}

// ---------------------------------------------------------------------------
// Gradle version catalog (TOML subset)
// ---------------------------------------------------------------------------

type TomlValue = string | string[] | Record<string, string>;

/**
 * Parse the TOML subset used by Gradle version catalogs: [section] headers,
 * `key = value` with basic / literal strings, inline tables (flattened to
 * dotted keys: `version.ref`) and arrays of strings, multi-line arrays.
 * Returns section -> key -> value. Linear.
 */
export function parseCatalogToml(content: string): Record<string, Record<string, TomlValue>> {
  const out: Record<string, Record<string, TomlValue>> = {};
  let section = '';
  let pending = '';
  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine);
    if (!pending) {
      const header = /^\s*\[([A-Za-z0-9_.-]+)\]\s*$/.exec(line);
      if (header) { section = header[1]!; out[section] ??= {}; continue; }
    }
    pending = pending ? `${pending} ${line}` : line;
    if (bracketDepth(pending) > 0) continue;
    const stmt = pending.trim();
    pending = '';
    if (!stmt) continue;
    const eq = stmt.indexOf('=');
    if (eq <= 0) continue;
    const key = unquote(stmt.slice(0, eq).trim());
    const value = parseTomlValue(stmt.slice(eq + 1).trim());
    if (value === null) continue;
    (out[section] ??= {})[key] = value;
  }
  return out;
}

function stripTomlComment(line: string): string {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '#') return line.slice(0, i);
  }
  return line;
}

function bracketDepth(s: string): number {
  let depth = 0;
  let quote = '';
  for (const c of s) {
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
  }
  return depth;
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) return t.slice(1, -1);
  return t;
}

/** Split on top-level commas (outside quotes and braces). */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0; let quote = ''; let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 0) { parts.push(s.slice(start, i)); start = i + 1; }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseTomlValue(v: string): TomlValue | null {
  if (v.startsWith('"') || v.startsWith("'")) return unquote(v);
  if (v.startsWith('[')) {
    return splitTopLevel(v.slice(1, v.lastIndexOf(']'))).map(unquote);
  }
  if (v.startsWith('{')) {
    const flat: Record<string, string> = {};
    const flatten = (body: string, prefix: string): void => {
      for (const part of splitTopLevel(body)) {
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        const k = `${prefix}${unquote(part.slice(0, eq).trim())}`;
        const val = part.slice(eq + 1).trim();
        if (val.startsWith('{')) flatten(val.slice(1, val.lastIndexOf('}')), `${k}.`);
        else flat[k] = unquote(val);
      }
    };
    flatten(v.slice(1, v.lastIndexOf('}')), '');
    return flat;
  }
  return v; // bare value (number, boolean)
}

interface CatalogLibrary { group: string; artifact: string; version: string | null; declared?: string }

export interface VersionCatalog {
  versions: Record<string, string>;
  libraries: Map<string, CatalogLibrary>;
  bundles: Map<string, string[]>;
  plugins: Map<string, { id: string; version: string | null }>;
}

/** Gradle accessor normalisation: `spring-boot_starter.web` and `libs.spring.boot.starter.web` meet at `spring.boot.starter.web`. */
export function catalogAccessorKey(alias: string): string {
  return alias.replace(/[-_]/g, '.').toLowerCase();
}

export function parseVersionCatalog(content: string): VersionCatalog {
  const toml = parseCatalogToml(content);
  const versions: Record<string, string> = {};
  for (const [k, v] of Object.entries(toml['versions'] ?? {})) {
    if (typeof v === 'string') versions[k] = v;
    else if (!Array.isArray(v)) {
      const rich = v['strictly'] ?? v['require'] ?? v['prefer'];
      if (rich) versions[k] = rich;
    }
  }
  const versionOf = (v: Record<string, string>): { version: string | null; declared?: string } => {
    const ref = v['version.ref'];
    if (ref) return { version: versions[ref] ?? null, declared: ref };
    const lit = v['version'] ?? v['version.strictly'] ?? v['version.require'] ?? v['version.prefer'];
    return lit ? { version: lit, declared: lit } : { version: null };
  };
  const libraries = new Map<string, CatalogLibrary>();
  for (const [alias, v] of Object.entries(toml['libraries'] ?? {})) {
    let lib: CatalogLibrary | null = null;
    if (typeof v === 'string') {
      const [g, a, ver] = v.split(':');
      if (g && a) lib = { group: g, artifact: a, version: ver ?? null, ...(ver ? { declared: ver } : {}) };
    } else if (!Array.isArray(v)) {
      const module = v['module'];
      const [g, a] = module ? module.split(':') : [v['group'], v['name']];
      if (g && a) lib = { group: g, artifact: a, ...versionOf(v) };
    }
    if (lib) libraries.set(catalogAccessorKey(alias), lib);
  }
  const bundles = new Map<string, string[]>();
  for (const [alias, v] of Object.entries(toml['bundles'] ?? {})) {
    if (Array.isArray(v)) bundles.set(catalogAccessorKey(alias), v.map(catalogAccessorKey));
  }
  const plugins = new Map<string, { id: string; version: string | null }>();
  for (const [alias, v] of Object.entries(toml['plugins'] ?? {})) {
    if (typeof v === 'string') {
      const [id, ver] = v.split(':');
      if (id) plugins.set(catalogAccessorKey(alias), { id, version: ver ?? null });
    } else if (!Array.isArray(v) && v['id']) {
      plugins.set(catalogAccessorKey(alias), { id: v['id'], version: versionOf(v).version });
    }
  }
  return { versions, libraries, bundles, plugins };
}

// ---------------------------------------------------------------------------
// Gradle build scripts
// ---------------------------------------------------------------------------

/** Remove // and /* *\/ comments outside string literals (linear). */
export function stripJvmComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  let quote = '';
  while (i < n) {
    const c = src[i]!;
    if (quote) {
      out += c;
      if (c === '\\' && i + 1 < n) { out += src[i + 1]; i += 2; continue; }
      if (c === quote || c === '\n') quote = '';
      i++;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? n : nl;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Parse gradle.properties (key=value / key: value lines). */
export function parseGradleProperties(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('!')) continue;
    const m = /^([^=:\s]+)\s*[=:]\s*(.*)$/.exec(t);
    if (m) out[m[1]!] = m[2]!.trim();
  }
  return out;
}

/** gradle.lockfile lines: `group:artifact:version=conf1,conf2`. */
export function parseGradleLockfile(content: string): Array<{ group: string; artifact: string; version: string; configurations: string[] }> {
  const out: Array<{ group: string; artifact: string; version: string; configurations: string[] }> = [];
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('empty=')) continue;
    const eq = t.indexOf('=');
    const coord = eq < 0 ? t : t.slice(0, eq);
    const [group, artifact, version] = coord.split(':');
    if (!group || !artifact || !version) continue;
    out.push({ group, artifact, version, configurations: eq < 0 ? [] : t.slice(eq + 1).split(',').map((s) => s.trim()).filter(Boolean) });
  }
  return out;
}

type LockEntry = ReturnType<typeof parseGradleLockfile>[number];

function gradleScope(config: string): JvmScope | null {
  const c = config;
  if (c === 'classpath') return null; // buildscript tooling, not the application
  if (/^test/i.test(c) || /^(integrationTest|functionalTest|e2eTest)/.test(c)) return 'test';
  if (/^(compileOnly|compileOnlyApi|annotationProcessor|kapt|ksp|providedCompile)$/.test(c)) return 'provided';
  if (/^(runtimeOnly|runtime|providedRuntime|developmentOnly)$/.test(c)) return 'runtime';
  if (/^(implementation|api|compile)$/.test(c)) return 'compile';
  if (/(Implementation|Api|CompileOnly|RuntimeOnly)$/.test(c)) return 'compile';
  return null;
}

const BLOCK_PREFIX_RE = /^\s*(?:dependencies|buildscript|allprojects|subprojects)\s*\{/;
const GRADLE_DECL_RE =/^\s*([A-Za-z][A-Za-z0-9]*)[\s(]\s*(.*)$/;
const GRADLE_COORD_RE = /["']([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+)(?::([^"'@:\s]+))?(?::[^"'@:\s]*)?(?:@[A-Za-z]+)?["']/g;
const GRADLE_CATALOG_REF_RE = /\b([a-z][A-Za-z0-9]*)\.([A-Za-z0-9_.]+)/g;
const GRADLE_VAR_RE = /^\s*(?:(?:def|val|var)\s+|(?:project\.)?ext\.)?([A-Za-z_]\w*)\s*(?::\s*String\s*)?=\s*["']([^"'$]+)["']/;
const GRADLE_EXTRA_RE = /extra\[\s*["']([A-Za-z_][\w.]*)["']\s*\]\s*=\s*["']([^"'$]+)["']|set\(\s*["']([A-Za-z_][\w.]*)["']\s*,\s*["']([^"'$]+)["']\s*\)/;
const BOOT_PLUGIN_RE = /id(?:\s*\()?\s*["']org\.springframework\.boot["'](?:\s*\))?\s*version(?:\s*\()?\s*["']([^"']+)["']/;
const BOOT_CLASSPATH_RE = /org\.springframework\.boot:spring-boot-gradle-plugin:([^"'\s]+)["']/;
const CATALOG_PLUGIN_RE = /alias\s*\(\s*([a-z][A-Za-z0-9]*)\.plugins\.([A-Za-z0-9_.]+)\s*\)/g;

interface GradleFileInput { rel: string; content: string }

function gradleVariables(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const m = GRADLE_VAR_RE.exec(line);
    if (m) vars[m[1]!] = m[2]!;
    const e = GRADLE_EXTRA_RE.exec(line);
    if (e) vars[e[1] ?? e[3]!] = e[2] ?? e[4]!;
  }
  return vars;
}

/** Resolve Groovy / Kotlin string interpolation ($v, ${v}, ${rootProject.ext.v}, ${libs.versions.x.get()}). */
function gradleInterpolate(raw: string, vars: Record<string, string>, catalogs: Map<string, VersionCatalog>): string | null {
  if (!raw.includes('$')) return raw;
  let missing = false;
  const lookup = (expr: string): string => {
    const e = expr.trim();
    const cat = /^([a-z][A-Za-z0-9]*)\.versions\.([A-Za-z0-9_.]+?)(?:\.get\(\))?$/.exec(e);
    if (cat) {
      const c = catalogs.get(cat[1]!);
      const key = catalogAccessorKey(cat[2]!);
      const hit = c ? Object.entries(c.versions).find(([k]) => catalogAccessorKey(k) === key)?.[1] : undefined;
      if (hit) return hit;
    }
    const prop = /^(?:project\.)?(?:property|findProperty)\(\s*["']([^"']+)["']\s*\)$/.exec(e);
    const name = prop ? prop[1]! : e.split('.').pop()!;
    const v = vars[e] ?? vars[name];
    if (v === undefined) { missing = true; return ''; }
    return v;
  };
  const out = raw
    .replace(/\$\{([^}]{1,200})\}/g, (_m, expr: string) => lookup(expr))
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name: string) => lookup(name));
  return missing ? null : out;
}

function resolveGradle(
  files: GradleFileInput[],
  baseVars: Record<string, string>,
  propsByDir: Map<string, Record<string, string>>,
  catalogs: Map<string, VersionCatalog>,
  lockfiles: Map<string, ReturnType<typeof parseGradleLockfile>>,
  out: JvmProject,
): void {
  // Root build file variables (ext {} in the root) are visible to every module.
  const sorted = [...files].sort((a, b) => a.rel.split('/').length - b.rel.split('/').length);
  const rootVars: Record<string, string> = { ...baseVars };
  if (sorted[0]) Object.assign(rootVars, gradleVariables(stripJvmComments(sorted[0].content)));

  // Spring Boot version from any build file (plugin DSL, buildscript classpath, catalog plugin alias).
  for (const f of files) {
    const src = stripJvmComments(f.content);
    const vars = { ...rootVars, ...(propsByDir.get(dirOf(f.rel)) ?? {}), ...gradleVariables(src) };
    const plugin = BOOT_PLUGIN_RE.exec(src) ?? BOOT_CLASSPATH_RE.exec(src);
    if (plugin) {
      out.usesSpringBoot = true;
      const v = gradleInterpolate(plugin[1]!, vars, catalogs);
      if (v && isConcreteVersion(v)) out.springBootVersion ??= v;
    }
    for (const m of src.matchAll(CATALOG_PLUGIN_RE)) {
      const p = catalogs.get(m[1]!)?.plugins.get(catalogAccessorKey(m[2]!));
      if (p?.id === SPRING_BOOT_GROUP) {
        out.usesSpringBoot = true;
        if (p.version && isConcreteVersion(p.version)) out.springBootVersion ??= p.version;
      }
    }
  }
  const boot = out.springBootVersion;

  for (const f of files) {
    const src = stripJvmComments(f.content);
    const vars = { ...rootVars, ...(propsByDir.get(dirOf(f.rel)) ?? {}), ...gradleVariables(src) };
    const lock = lockfiles.get(dirOf(f.rel));
    const lockIndex = new Map<string, LockEntry>((lock ?? []).map((l) => [`${l.group}:${l.artifact}`, l]));
    const declared = new Set<string>();
    const push = (group: string, artifact: string, rawVersion: string | undefined, scope: JvmScope, catalogVersion?: { version: string | null; declared?: string }): void => {
      let version: string | null = null;
      let source: JvmVersionSource = 'unresolved';
      const key = `${group}:${artifact}`;
      if (catalogVersion?.version) {
        if (isConcreteVersion(catalogVersion.version)) { version = catalogVersion.version; source = 'catalog'; }
      } else if (rawVersion !== undefined) {
        const v = gradleInterpolate(rawVersion, vars, catalogs);
        if (v !== null && isConcreteVersion(v)) { version = v; source = rawVersion.includes('$') ? 'property' : 'declared'; }
      } else if (group === SPRING_BOOT_GROUP && boot) {
        version = boot; source = 'bom_family';
      }
      const locked = lockIndex.get(key);
      if (locked) { version = locked.version; source = 'lockfile'; }
      if (group === SPRING_BOOT_GROUP) out.usesSpringBoot = true;
      declared.add(key);
      out.dependencies.push(makeDep(group, artifact, version, catalogVersion?.declared ?? rawVersion, scope, source, 'gradle', true, f.rel));
    };

    for (const rawLine of src.split('\n')) {
      // One-line blocks: `dependencies { implementation 'g:a:v' }`.
      let line = rawLine;
      for (let k = 0; k < 4; k++) {
        const next = line.replace(BLOCK_PREFIX_RE, '');
        if (next === line) break;
        line = next;
      }
      const decl = GRADLE_DECL_RE.exec(line);
      if (!decl) continue;
      const scope = gradleScope(decl[1]!);
      if (scope === null) continue;
      const rest = decl[2]!;
      if (/\bproject\s*\(/.test(rest)) continue;
      let matched = false;
      for (const m of rest.matchAll(GRADLE_COORD_RE)) {
        matched = true;
        push(m[1]!, m[2]!, m[3], scope);
      }
      if (matched) continue;
      // Map / named-argument notation: group: 'g', name: 'a', version: 'v'  |  group = "g", name = "a"
      const g = /\bgroup\s*[:=]\s*["']([^"']+)["']/.exec(rest);
      const a = /\bname\s*[:=]\s*["']([^"']+)["']/.exec(rest);
      if (g && a) {
        // version: 'x' (literal) or version: someVar (variable reference)
        const v = /\bversion\s*[:=]\s*(?:["']([^"']+)["']|([A-Za-z_]\w*))/.exec(rest);
        push(g[1]!, a[1]!, v ? (v[1] ?? `\${${v[2]!}}`) : undefined, scope);
        continue;
      }
      // Version catalog accessors: libs.spring.boot.starter.web, libs.bundles.x
      for (const m of rest.matchAll(GRADLE_CATALOG_REF_RE)) {
        const cat = catalogs.get(m[1]!);
        if (!cat) continue;
        // Greedy capture stops at '(' so `libs.x.get()` arrives as `x.get`.
        const path = m[2]!.replace(/\.get$/, '').replace(/\.$/, '');
        if (path.startsWith('versions.') || path.startsWith('plugins.')) continue;
        const aliases = path.startsWith('bundles.')
          ? cat.bundles.get(catalogAccessorKey(path.slice('bundles.'.length))) ?? []
          : [catalogAccessorKey(path)];
        for (const alias of aliases) {
          const lib = cat.libraries.get(alias);
          if (lib) push(lib.group, lib.artifact, undefined, scope, { version: lib.version, declared: lib.declared });
        }
      }
    }

    // Transitive entries pinned by the lockfile.
    for (const l of lock ?? []) {
      const key = `${l.group}:${l.artifact}`;
      if (declared.has(key)) continue;
      const confs = l.configurations;
      const scope: JvmScope = confs.length > 0 && confs.every((c) => /^test/i.test(c))
        ? 'test'
        : confs.some((c) => /runtimeClasspath$/i.test(c) && !/^test/i.test(c)) ? 'runtime' : 'compile';
      out.dependencies.push(makeDep(l.group, l.artifact, l.version, l.version, scope, 'lockfile', 'gradle', false, f.rel));
    }

    // Java toolchain / compatibility.
    const javaRes: Array<[string, RegExp]> = [
      ['java toolchain languageVersion', /JavaLanguageVersion\.of\(\s*([^()\s]+(?:\(\))?)\s*\)/],
      ['kotlin jvmToolchain', /jvmToolchain\(\s*([^()\s]+(?:\(\))?)\s*\)/],
      ['options.release', /options\.release(?:\.set\(\s*|\s*=\s*)([^)\s]+)/],
      ['sourceCompatibility', /sourceCompatibility\s*=\s*([^\s;]+)/],
      ['targetCompatibility', /targetCompatibility\s*=\s*([^\s;]+)/],
    ];
    for (const [key, re] of javaRes) {
      const m = re.exec(src);
      if (!m) continue;
      let token = m[1]!.trim().replace(/^JavaVersion\./, '').replace(/^["']|["']$/g, '');
      if (/^[A-Za-z_][\w.]*(?:\(\))?$/.test(token) && !/^VERSION_/.test(token)) {
        token = gradleInterpolate(`\${${token}}`, vars, catalogs) ?? token;
      }
      const major = parseJavaMajor(token);
      if (major !== null) { out.javaDeclarations.push({ major, raw: m[1]!.trim().replace(/^["']|["']$/g, ''), file: f.rel, key }); break; }
    }
  }
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

const BUILD_FILE_NAMES: ReadonlySet<string> = new Set([
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts',
  'gradle.properties', 'gradle.lockfile', '.java-version', '.sdkmanrc', '.tool-versions',
]);

function readCapped(abs: string, size: number): string | null {
  if (size > MAX_FILE_BYTES) return null;
  try { return readFileSync(abs, 'utf-8'); } catch { return null; }
}

/**
 * Read every Maven and Gradle build file under `sourcePath` and resolve the
 * declared dependencies and Java release. Pure function of the tree; returns
 * an empty project (no build tools) when there is no JVM build file.
 */
export function collectJvmProject(sourcePath: string, opts: CollectJvmProjectOptions = {}): JvmProject {
  const out: JvmProject = {
    buildTools: [], manifests: [], modules: 0, dependencies: [], java: null, javaDeclarations: [],
    springBootVersion: null, usesSpringBoot: false,
  };
  if (!sourcePath) return out;
  const files = listSourceFiles(sourcePath, { purpose: 'manifest', maxDepth: opts.maxDepth ?? 6, includeHidden: true })
    .filter((f) => !f.isTest && (BUILD_FILE_NAMES.has(f.name) || f.name.endsWith('.versions.toml')))
    .slice(0, MAX_MANIFESTS);

  const poms: PomEntry[] = [];
  const gradleFiles: GradleFileInput[] = [];
  const propsByDir = new Map<string, Record<string, string>>();
  const catalogs = new Map<string, VersionCatalog>();
  const lockfiles = new Map<string, ReturnType<typeof parseGradleLockfile>>();
  const versionFiles: Array<{ rel: string; name: string; content: string }> = [];

  for (const f of files) {
    const content = readCapped(f.abs, f.sizeBytes);
    if (content === null) continue;
    if (f.name === 'pom.xml') {
      poms.push({ rel: f.rel, model: parsePom(content) });
      out.manifests.push(f.rel);
    } else if (f.name === 'build.gradle' || f.name === 'build.gradle.kts') {
      gradleFiles.push({ rel: f.rel, content });
      out.manifests.push(f.rel);
    } else if (f.name === 'gradle.properties') {
      propsByDir.set(dirOf(f.rel), parseGradleProperties(content));
    } else if (f.name === 'gradle.lockfile') {
      lockfiles.set(dirOf(f.rel), parseGradleLockfile(content));
    } else if (f.name.endsWith('.versions.toml')) {
      const name = f.name.slice(0, -'.versions.toml'.length);
      if (!catalogs.has(name)) catalogs.set(name, parseVersionCatalog(content));
    } else if (f.name.startsWith('.') && f.depth === 0) {
      versionFiles.push({ rel: f.rel, name: f.name, content });
    }
  }

  if (poms.length > 0) { out.buildTools.push('maven'); resolveMaven(poms, out); }
  if (gradleFiles.length > 0) {
    out.buildTools.push('gradle');
    // Root gradle.properties (shallowest) is the base for every module.
    const rootDir = [...propsByDir.keys()].sort((a, b) => a.length - b.length)[0];
    const baseVars = rootDir !== undefined ? propsByDir.get(rootDir)! : {};
    resolveGradle(gradleFiles, baseVars, propsByDir, catalogs, lockfiles, out);
  }
  out.modules = poms.length + gradleFiles.length;

  // Root version files (.java-version, .sdkmanrc java=, .tool-versions java ...).
  if (out.buildTools.length > 0) {
    for (const vf of versionFiles) {
      let raw: string | undefined;
      if (vf.name === '.java-version') raw = vf.content.trim().split(/\s+/)[0];
      else if (vf.name === '.sdkmanrc') raw = /^\s*java\s*=\s*(\S+)/m.exec(vf.content)?.[1];
      else if (vf.name === '.tool-versions') raw = /^\s*java\s+(\S+)/m.exec(vf.content)?.[1];
      const major = raw ? parseJavaMajor(raw) : null;
      if (major !== null) out.javaDeclarations.push({ major, raw: raw!, file: vf.rel, key: vf.name });
    }
  }

  // Lowest release wins; on a tie the shallowest file (the reactor root that
  // declares it, not a module inheriting it).
  const depthOf = (rel: string): number => rel.split('/').length;
  for (const d of out.javaDeclarations) {
    if (out.java === null || d.major < out.java.major || (d.major === out.java.major && depthOf(d.file) < depthOf(out.java.file))) out.java = d;
  }
  return out;
}
