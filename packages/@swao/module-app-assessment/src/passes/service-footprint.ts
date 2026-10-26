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

// #3430: landing-zone service footprint (Pass 01). Unions the backing services
// an application needs from every deterministic source SWAO can read, not only
// the framework-mandated ones:
//
//   build_file        Maven / Gradle / npm / pip dependencies (DependencyInventory)
//   compose           docker-compose service images
//   kubernetes        manifest kinds, pod-spec images, Helm chart dependencies,
//                     StatefulSet volume claims, LoadBalancer Services
//   config            application* / bootstrap* configuration, Helm values,
//                     ConfigMap data (JDBC URLs, broker endpoints, issuer URIs)
//   db_migration      Liquibase changelog `dbms` dialects
//   docs              README / CHANGELOG / docs/ and prose in wsp/inputs/
//                     (whole-word keywords; low confidence when alone)
//   inventory_signal  service_dep tags already emitted by Pass 01 (INV-02,
//                     INV-03, Cargo, Terraform / Pulumi state)
//
// The mapping lives in swao/controls/service-footprint-catalogue.yaml (Zod
// validated, no regular expressions in the catalogue). Files are listed through
// the central source scope (#3428) and listInputFiles; there is no own walk.
// Target-role inputs (#3429) never contribute: they describe the candidate
// landing zone, not the application.

import { readFileSync } from 'fs';
import { join } from 'path';
import { loadAll } from 'js-yaml';
import { isTestPath, listInputFiles, listSourceFiles, type Signal } from '@swao/core';
import type { DependencyInventory, DependencyRef } from './inv-reference-scans.js';
import { imageRepository } from './inv-reference-scans.js';
import type { ServiceFootprintCatalogue, ServiceFootprintCapability, ServiceFootprintCategory } from '../catalogue/service-footprint-catalogue.js';
import { readWorkspaceInfraRoles, resolveInfraRoleForFile } from './infra-input-role.js';

export type FootprintSourceKind =
  | 'build_file'
  | 'compose'
  | 'kubernetes'
  | 'config'
  | 'db_migration'
  | 'docs'
  | 'inventory_signal';

export const FOOTPRINT_SOURCE_KINDS: readonly FootprintSourceKind[] = [
  'build_file', 'compose', 'kubernetes', 'config', 'db_migration', 'docs', 'inventory_signal',
];

export type FootprintConfidence = 'high' | 'medium' | 'low';

export interface FootprintSource {
  kind: FootprintSourceKind;
  /** Path relative to the source root, or wsp/inputs/<rel> for context documents. */
  path: string;
  /** What matched (dependency coordinate, image, manifest kind, keyword, signal id). */
  detail: string;
}

export interface ServiceFootprintEntry {
  /** Landing-zone capability (`fulfills` token, `service_dep:<capability>`). */
  capability: string;
  label: string;
  category?: ServiceFootprintCategory;
  /** high: build file, compose, Kubernetes or an INV signal; medium: configuration or changelog only; low: documents only. */
  confidence: FootprintConfidence;
  documentation_only: boolean;
  source_kinds: FootprintSourceKind[];
  sources: FootprintSource[];
  /** Signal that carries `service_dep:<capability>` (an existing INV signal or the footprint signal). */
  signal_id?: string;
}

export interface ServiceFootprint {
  /** 'loaded', or why the catalogue was skipped. */
  catalogue: string;
  entries: ServiceFootprintEntry[];
  /** Files read per source kind (0 = nothing of that kind in scope). */
  files_scanned: Record<'build_file' | 'compose' | 'kubernetes' | 'config' | 'db_migration' | 'docs', number>;
}

const MAX_SOURCES_PER_ENTRY = 20;
const MAX_TEXT_BYTES = 1_000_000;
const MAX_DOC_FILES = 400;
const DOC_EXTENSIONS = new Set(['.md', '.txt', '.adoc', '.rst']);
const YAML_EXTENSIONS = new Set(['.yaml', '.yml']);
/** wsp/inputs/ folders that never describe the application (CTX skips the same, pass-04-ctx.ts). */
const INPUT_SKIP_TOP_DIRS = ['source', 'catalogs', 'llm-gateway'];
const COMPOSE_NAME_RE = /^(docker-)?compose.*\.ya?ml$/;
const WORKLOAD_KINDS = new Set(['deployment', 'statefulset', 'daemonset', 'replicaset', 'job', 'cronjob', 'pod']);

// ---------------------------------------------------------------------------
// Linear matchers (no catalogue-supplied regular expressions)
// ---------------------------------------------------------------------------

/** `name` against a package pattern; a trailing `*` is a prefix match. Case-insensitive. */
export function matchesPackage(name: string, pattern: string): boolean {
  const n = name.toLowerCase();
  const p = pattern.toLowerCase();
  return p.endsWith('*') ? n.startsWith(p.slice(0, -1)) : n === p;
}

/** Maven / Gradle coordinate against "group:artifact" ("group:*" or a trailing `*` on the artifact = prefix). */
export function matchesMaven(dep: Pick<DependencyRef, 'group' | 'name'>, pattern: string): boolean {
  const colon = pattern.indexOf(':');
  if (colon < 0 || !dep.group) return false;
  return dep.group.toLowerCase() === pattern.slice(0, colon).toLowerCase() && matchesPackage(dep.name, pattern.slice(colon + 1));
}

/** Glob where `*` matches any run of characters; case-insensitive, linear in the input. */
export function matchesGlob(value: string, glob: string): boolean {
  const v = value.toLowerCase();
  const parts = glob.toLowerCase().split('*');
  if (parts.length === 1) return v === parts[0];
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  if (!v.startsWith(first) || v.length < first.length + last.length || !v.endsWith(last)) return false;
  let pos = first.length;
  const end = v.length - last.length;
  for (let i = 1; i < parts.length - 1; i++) {
    const idx = v.indexOf(parts[i]!, pos);
    if (idx < 0 || idx + parts[i]!.length > end) return false;
    pos = idx + parts[i]!.length;
  }
  return true;
}

function isWordChar(c: string | undefined): boolean {
  if (c === undefined) return false;
  const code = c.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || c === '_';
}

/** True when `lowerText` contains `phrase` as a whole word or phrase (case-insensitive; caller lower-cases the text). */
export function containsWord(lowerText: string, phrase: string): boolean {
  const p = phrase.toLowerCase();
  if (p.length === 0) return false;
  let from = 0;
  for (;;) {
    const idx = lowerText.indexOf(p, from);
    if (idx < 0) return false;
    if (!isWordChar(lowerText[idx - 1]) && !isWordChar(lowerText[idx + p.length])) return true;
    from = idx + 1;
  }
}

/** Kubernetes kind pattern "Kind" or "Kind@api.group" against a manifest's kind and apiVersion. */
export function matchesK8sKind(kind: string, apiVersion: string, pattern: string): boolean {
  const at = pattern.indexOf('@');
  const wantKind = (at < 0 ? pattern : pattern.slice(0, at)).toLowerCase();
  if (kind.toLowerCase() !== wantKind) return false;
  if (at < 0) return true;
  const slash = apiVersion.indexOf('/');
  const group = slash < 0 ? '' : apiVersion.slice(0, slash);
  return group.toLowerCase() === pattern.slice(at + 1).toLowerCase();
}

// ---------------------------------------------------------------------------
// Accumulator
// ---------------------------------------------------------------------------

class FootprintAccumulator {
  private readonly byCap = new Map<string, { sources: FootprintSource[]; keys: Set<string> }>();

  add(capability: string, src: FootprintSource): void {
    const slot = this.byCap.get(capability) ?? { sources: [], keys: new Set<string>() };
    const key = `${src.kind}|${src.path}|${src.detail}`;
    if (!slot.keys.has(key)) {
      slot.keys.add(key);
      slot.sources.push(src);
    }
    this.byCap.set(capability, slot);
  }

  capabilities(): string[] {
    return [...this.byCap.keys()];
  }

  sources(capability: string): FootprintSource[] {
    return this.byCap.get(capability)?.sources ?? [];
  }
}

const DETERMINISTIC_HIGH: ReadonlySet<FootprintSourceKind> = new Set(['build_file', 'compose', 'kubernetes', 'inventory_signal']);

function confidenceOf(kinds: Set<FootprintSourceKind>): FootprintConfidence {
  for (const k of kinds) if (DETERMINISTIC_HIGH.has(k)) return 'high';
  for (const k of kinds) if (k !== 'docs') return 'medium';
  return 'low';
}

function readText(abs: string, size: number): string | null {
  if (size > MAX_TEXT_BYTES) return null;
  try {
    return readFileSync(abs, 'utf-8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Source scanners
// ---------------------------------------------------------------------------

function scanDependencies(cat: ServiceFootprintCatalogue, inv: DependencyInventory, acc: FootprintAccumulator): Set<string> {
  const files = new Set<string>();
  for (const dep of inv.deps) {
    if (dep.scope === 'test' || isTestPath(dep.file)) continue;
    for (const cap of cat.capabilities) {
      let hit = false;
      switch (dep.ecosystem) {
        case 'maven': hit = (cap.detect.maven ?? []).some((p) => matchesMaven(dep, p)); break;
        case 'npm': hit = (cap.detect.npm ?? []).some((p) => matchesPackage(dep.name, p)); break;
        case 'pip': hit = (cap.detect.pip ?? []).some((p) => matchesPackage(dep.name.replace(/[-_.]+/g, '-'), p.replace(/[-_.]+/g, '-'))); break;
        case 'cargo':
        case 'nuget':
          // Cargo crates are mapped by Pass 01 (extractCargoServiceDeps); NuGet has no footprint rules yet.
          hit = false;
          break;
        default: {
          const never: never = dep.ecosystem;
          void never;
        }
      }
      if (hit) {
        files.add(dep.file);
        const coord = dep.group ? `${dep.group}:${dep.name}` : dep.name;
        acc.add(cap.id, { kind: 'build_file', path: dep.file, detail: `${dep.ecosystem} ${coord}${dep.version ? ` ${dep.version}` : ''}` });
      }
    }
  }
  return files;
}

function matchImage(cat: ServiceFootprintCatalogue, image: string): ServiceFootprintCapability[] {
  const repo = imageRepository(image);
  return cat.capabilities.filter((c) => (c.detect.images ?? []).some((g) => matchesGlob(repo, g)));
}

function scanComposeImages(cat: ServiceFootprintCatalogue, inv: DependencyInventory, acc: FootprintAccumulator): Set<string> {
  const files = new Set<string>();
  for (const img of inv.images) {
    const base = img.file.split('/').pop()?.toLowerCase() ?? '';
    if (!COMPOSE_NAME_RE.test(base) || isTestPath(img.file)) continue;
    files.add(img.file);
    for (const cap of matchImage(cat, img.image)) {
      acc.add(cap.id, { kind: 'compose', path: img.file, detail: `image ${img.image}` });
    }
  }
  return files;
}

/** Lower-case with `_` and `-` read as `.`, so spring.kafka.bootstrap-servers and SPRING_KAFKA_BOOTSTRAP_SERVERS compare equal. */
function normaliseConfig(text: string): string {
  return text.toLowerCase().replace(/[_-]/g, '.');
}

function scanConfigText(cat: ServiceFootprintCatalogue, text: string, path: string, acc: FootprintAccumulator, kind: FootprintSourceKind = 'config'): boolean {
  const norm = normaliseConfig(text);
  let any = false;
  for (const cap of cat.capabilities) {
    for (const needle of cap.detect.config ?? []) {
      if (norm.includes(normaliseConfig(needle))) {
        acc.add(cap.id, { kind, path, detail: `configuration "${needle}"` });
        any = true;
        break;
      }
    }
  }
  return any;
}

interface K8sDoc {
  apiVersion: string;
  kind: string;
  doc: Record<string, unknown> | null;
}

/** Collect container images under any `containers` / `initContainers` array. */
function podImages(node: unknown, out: string[], depth = 0): void {
  if (depth > 12 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) podImages(n, out, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if ((k === 'containers' || k === 'initContainers') && Array.isArray(v)) {
      for (const c of v) {
        const img = c && typeof c === 'object' ? (c as Record<string, unknown>)['image'] : undefined;
        if (typeof img === 'string' && img.length > 0) out.push(img);
      }
    } else {
      podImages(v, out, depth + 1);
    }
  }
}

const KIND_LINE_RE = /^kind:[ \t]*["']?([A-Za-z][A-Za-z0-9]*)["']?[ \t]*$/m;
const API_LINE_RE = /^apiVersion:[ \t]*["']?([A-Za-z0-9./-]+)["']?[ \t]*$/m;
const IMAGE_LINE_RE = /^[ \t-]*image:[ \t]*["']?([^\s"'{}]+)/gm;

/**
 * Kubernetes documents of a YAML file. Parsed with js-yaml; when the file does
 * not parse (Helm templates with `{{ }}`), falls back to line-anchored
 * apiVersion / kind scans per `---` document. A document counts only when it
 * has both apiVersion and kind.
 */
export function parseK8sDocuments(text: string): { docs: K8sDoc[]; templateImages: string[] } {
  try {
    const out: K8sDoc[] = [];
    for (const d of loadAll(text)) {
      if (!d || typeof d !== 'object' || Array.isArray(d)) continue;
      const rec = d as Record<string, unknown>;
      if (typeof rec['apiVersion'] === 'string' && typeof rec['kind'] === 'string') {
        out.push({ apiVersion: rec['apiVersion'], kind: rec['kind'], doc: rec });
      }
    }
    return { docs: out, templateImages: [] };
  } catch {
    const out: K8sDoc[] = [];
    const templateImages: string[] = [];
    for (const part of text.split(/^---/m)) {
      const kind = KIND_LINE_RE.exec(part)?.[1];
      const api = API_LINE_RE.exec(part)?.[1];
      if (kind && api) out.push({ apiVersion: api, kind, doc: null });
    }
    if (out.length > 0) {
      for (const m of text.matchAll(IMAGE_LINE_RE)) templateImages.push(m[1]!);
    }
    return { docs: out, templateImages };
  }
}

function scanK8sDocument(cat: ServiceFootprintCatalogue, d: K8sDoc, path: string, acc: FootprintAccumulator): void {
  for (const cap of cat.capabilities) {
    if ((cap.detect.k8s_kinds ?? []).some((p) => matchesK8sKind(d.kind, d.apiVersion, p))) {
      acc.add(cap.id, { kind: 'kubernetes', path, detail: `${d.kind} (${d.apiVersion})` });
    }
  }
  if (!d.doc) return;
  const kindLower = d.kind.toLowerCase();
  const spec = d.doc['spec'] && typeof d.doc['spec'] === 'object' ? (d.doc['spec'] as Record<string, unknown>) : undefined;
  // A Service of type LoadBalancer provisions a cloud load balancer; ClusterIP Services do not.
  if (kindLower === 'service' && spec && spec['type'] === 'LoadBalancer') {
    acc.add('load_balancer', { kind: 'kubernetes', path, detail: 'Service type LoadBalancer' });
  }
  // StatefulSet volume claim templates create persistent volumes like a PVC.
  if (kindLower === 'statefulset' && spec && Array.isArray(spec['volumeClaimTemplates']) && spec['volumeClaimTemplates'].length > 0) {
    acc.add('block_storage', { kind: 'kubernetes', path, detail: 'StatefulSet volumeClaimTemplates' });
  }
  if (WORKLOAD_KINDS.has(kindLower)) {
    const images: string[] = [];
    podImages(spec, images);
    for (const img of images) {
      for (const cap of matchImage(cat, img)) acc.add(cap.id, { kind: 'kubernetes', path, detail: `${d.kind} image ${img}` });
    }
  }
  if (kindLower === 'configmap') {
    const data = d.doc['data'];
    if (data && typeof data === 'object') {
      // Keys too: environment-style keys (SPRING_KAFKA_BOOTSTRAP_SERVERS) name the service.
      const text = Object.entries(data as Record<string, unknown>).map(([k, v]) => `${k}=${typeof v === 'string' ? v : ''}`).join('\n');
      scanConfigText(cat, text, path, acc);
    }
  }
}

/** Liquibase `dbms` values (XML attribute, YAML key, formatted-SQL comment); negated values are skipped. */
export function liquibaseDialects(text: string): string[] {
  const out = new Set<string>();
  const add = (list: string): void => {
    for (const raw of list.split(',')) {
      const v = raw.trim().toLowerCase();
      if (v && !v.startsWith('!')) out.add(v);
    }
  };
  for (const m of text.matchAll(/\bdbms\s*=\s*"([^"]*)"/g)) add(m[1]!);
  for (const m of text.matchAll(/\bdbms:[ \t]*([A-Za-z0-9_, !]+)/g)) add(m[1]!);
  return [...out];
}

function isConfigFileName(lower: string): boolean {
  if (!/\.(ya?ml|properties)$/.test(lower)) return false;
  return lower.startsWith('application') || lower.startsWith('bootstrap') || lower.startsWith('values');
}

function scanSourceConfigAndManifests(
  cat: ServiceFootprintCatalogue,
  sourcePath: string,
  acc: FootprintAccumulator,
  counts: ServiceFootprint['files_scanned'],
): void {
  const files = listSourceFiles(sourcePath, {
    purpose: 'config',
    extensions: ['.yaml', '.yml', '.properties', '.xml', '.sql'],
  });
  for (const f of files) {
    if (f.isTest || f.isGenerated) continue;
    const lower = f.name.toLowerCase();
    const isChangelog = lower.includes('changelog') && f.ext !== '.properties';
    const isConfig = isConfigFileName(lower);
    const isChart = lower === 'chart.yaml';
    const isYaml = YAML_EXTENSIONS.has(f.ext);
    if (!isChangelog && !isConfig && !isChart && !isYaml) continue;
    if (COMPOSE_NAME_RE.test(lower)) continue; // compose images come from the dependency inventory
    if (/(^|[-.])lock\.ya?ml$/.test(lower)) continue; // pnpm-lock.yaml and friends: dependency locks, not manifests
    const text = readText(f.abs, f.sizeBytes);
    if (text === null) continue;

    if (isChangelog) {
      const dialects = liquibaseDialects(text);
      if (dialects.length > 0) counts.db_migration++;
      for (const dialect of dialects) {
        for (const cap of cat.capabilities) {
          if ((cap.detect.db_dialects ?? []).some((p) => p.toLowerCase() === dialect)) {
            acc.add(cap.id, { kind: 'db_migration', path: f.rel, detail: `Liquibase dbms ${dialect}` });
          }
        }
      }
      if (!isYaml) continue;
    }
    if (isChart) {
      counts.kubernetes++;
      acc.add('kubernetes', { kind: 'kubernetes', path: f.rel, detail: 'Helm chart' });
      let chart: unknown = null;
      try { chart = loadAll(text)[0]; } catch { chart = null; }
      const deps = chart && typeof chart === 'object' ? (chart as Record<string, unknown>)['dependencies'] : undefined;
      for (const dep of Array.isArray(deps) ? deps : []) {
        const name = dep && typeof dep === 'object' ? (dep as Record<string, unknown>)['name'] : undefined;
        if (typeof name !== 'string') continue;
        for (const cap of cat.capabilities) {
          if ((cap.detect.helm_charts ?? []).some((p) => matchesPackage(name, p))) {
            acc.add(cap.id, { kind: 'kubernetes', path: f.rel, detail: `Helm chart dependency ${name}` });
          }
        }
      }
      continue;
    }
    if (isConfig) {
      counts.config++;
      scanConfigText(cat, text, f.rel, acc);
      if (!lower.startsWith('values')) continue;
    }
    if (!isYaml) continue;
    const { docs, templateImages } = parseK8sDocuments(text);
    if (docs.length === 0) continue;
    counts.kubernetes++;
    for (const d of docs) scanK8sDocument(cat, d, f.rel, acc);
    for (const img of templateImages) {
      for (const cap of matchImage(cat, img)) acc.add(cap.id, { kind: 'kubernetes', path: f.rel, detail: `template image ${img}` });
    }
  }
}

function scanDocText(cat: ServiceFootprintCatalogue, text: string, path: string, acc: FootprintAccumulator): void {
  const lower = text.toLowerCase();
  const isChangelog = path.toLowerCase().split('/').pop()?.startsWith('changelog') === true;
  for (const cap of cat.capabilities) {
    const word = (cap.detect.docs ?? []).find((w) => containsWord(lower, w));
    if (word) acc.add(cap.id, { kind: 'docs', path, detail: `${isChangelog ? 'changelog' : 'document'} mentions "${word}"` });
  }
}

function scanDocuments(
  cat: ServiceFootprintCatalogue,
  sourcePath: string,
  workspacePath: string | undefined,
  acc: FootprintAccumulator,
  counts: ServiceFootprint['files_scanned'],
): void {
  let budget = MAX_DOC_FILES;
  for (const f of listSourceFiles(sourcePath, { purpose: 'docs', extensions: DOC_EXTENSIONS })) {
    if (budget <= 0) return;
    if (f.isTest || f.isGenerated) continue;
    const text = readText(f.abs, f.sizeBytes);
    if (text === null) continue;
    budget--;
    counts.docs++;
    scanDocText(cat, text, f.rel, acc);
  }
  if (!workspacePath) return;
  const inputsDir = join(workspacePath, 'wsp', 'inputs');
  const roles = readWorkspaceInfraRoles(workspacePath);
  for (const f of listInputFiles(inputsDir, { skipTopLevelDirs: INPUT_SKIP_TOP_DIRS })) {
    if (budget <= 0) return;
    if (!DOC_EXTENSIONS.has(f.ext)) continue;
    // #3429: a target-role input describes the candidate landing zone, not the application.
    if (resolveInfraRoleForFile(f.abs, workspacePath, roles) === 'target') continue;
    const text = readText(f.abs, f.sizeBytes);
    if (text === null) continue;
    budget--;
    counts.docs++;
    scanDocText(cat, text, `wsp/inputs/${f.rel}`, acc);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface DeriveServiceFootprintInput {
  sourcePath: string;
  workspacePath?: string;
  inventory: DependencyInventory;
  /** Signals already emitted by Pass 01; their service_dep tags join the footprint as inventory_signal sources. */
  priorSignals: Signal[];
  catalogue: ServiceFootprintCatalogue;
}

export function deriveServiceFootprint(input: DeriveServiceFootprintInput): ServiceFootprint {
  const { catalogue: cat } = input;
  const acc = new FootprintAccumulator();
  const counts: ServiceFootprint['files_scanned'] = { build_file: 0, compose: 0, kubernetes: 0, config: 0, db_migration: 0, docs: 0 };

  // Existing service_dep signals (INV-02, INV-03, Cargo, Terraform / Pulumi).
  const signalOf = new Map<string, string>();
  for (const s of input.priorSignals) {
    for (const tag of s.implies ?? []) {
      if (!tag.startsWith('service_dep:')) continue;
      const cap = tag.slice('service_dep:'.length).split('@')[0]!;
      if (!signalOf.has(cap)) signalOf.set(cap, s.id);
      acc.add(cap, { kind: 'inventory_signal', path: s.evidence?.[0] ?? '', detail: s.id });
    }
  }

  counts.build_file = scanDependencies(cat, input.inventory, acc).size;
  counts.compose = scanComposeImages(cat, input.inventory, acc).size;
  scanSourceConfigAndManifests(cat, input.sourcePath, acc, counts);
  scanDocuments(cat, input.sourcePath, input.workspacePath, acc, counts);

  const byId = new Map(cat.capabilities.map((c) => [c.id, c] as const));
  const order = new Map(cat.capabilities.map((c, i) => [c.id, i] as const));
  const entries: ServiceFootprintEntry[] = acc.capabilities().map((capability) => {
    const all = acc.sources(capability);
    const kinds = new Set(all.map((s) => s.kind));
    const meta = byId.get(capability);
    const entry: ServiceFootprintEntry = {
      capability,
      label: meta?.label ?? capability,
      ...(meta ? { category: meta.category } : {}),
      confidence: confidenceOf(kinds),
      documentation_only: kinds.size === 1 && kinds.has('docs'),
      source_kinds: FOOTPRINT_SOURCE_KINDS.filter((k) => kinds.has(k)),
      sources: all.slice(0, MAX_SOURCES_PER_ENTRY),
    };
    const sig = signalOf.get(capability);
    if (sig) entry.signal_id = sig;
    return entry;
  });
  entries.sort((a, b) => (order.get(a.capability) ?? 999) - (order.get(b.capability) ?? 999) || a.capability.localeCompare(b.capability));
  return { catalogue: 'loaded', entries, files_scanned: counts };
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<FootprintSourceKind, string> = {
  build_file: 'build file',
  compose: 'compose',
  kubernetes: 'Kubernetes manifest',
  config: 'configuration',
  db_migration: 'database changelog',
  docs: 'documentation',
  inventory_signal: 'inventory signal',
};

function uniquePaths(sources: FootprintSource[], max: number): string[] {
  return [...new Set(sources.map((s) => s.path).filter((p) => p.length > 0))].slice(0, max);
}

/**
 * service_dep signals for footprint capabilities no earlier Pass 01 signal
 * carries. One signal per capability with deterministic evidence; one
 * aggregated low-confidence signal for all documentation-only capabilities
 * (so documents do not multiply low-confidence signals). Evidence entries of
 * the aggregated signal are prefixed "<capability>: " so the landing-zone fit
 * can attribute them per capability. Sets `signal_id` on the entries.
 */
export function serviceFootprintSignals(footprint: ServiceFootprint, nextId: () => string | null): Signal[] {
  const out: Signal[] = [];
  const fresh = footprint.entries.filter((e) => !e.signal_id);
  for (const e of fresh.filter((x) => !x.documentation_only)) {
    const id = nextId();
    if (!id) break;
    e.signal_id = id;
    const details = e.sources.filter((s) => s.kind !== 'docs').slice(0, 3).map((s) => `${s.detail} in ${s.path}`);
    out.push({
      id,
      source: 'static_analysis',
      category: 'infrastructure_platform',
      severity: 'informational',
      derivation: `Service footprint: the application needs ${e.label} (${e.capability}), evidenced by ${e.source_kinds.map((k) => KIND_LABEL[k]).join(', ')}: ${details.join('; ')}.`,
      evidence: uniquePaths(e.sources, 10),
      confidence: e.confidence,
      outcome: 'neutral',
      implies: [`service_dep:${e.capability}`],
    });
  }
  const docOnly = fresh.filter((x) => x.documentation_only);
  if (docOnly.length > 0) {
    const id = nextId();
    if (id) {
      for (const e of docOnly) e.signal_id = id;
      out.push({
        id,
        source: 'static_analysis',
        category: 'infrastructure_platform',
        severity: 'informational',
        derivation: `Service footprint (documentation only, low confidence): ${docOnly.map((e) => `${e.label} (${e.capability})`).join(', ')} named in the documentation but not evidenced by build files, compose, Kubernetes manifests or configuration. Confirm before treating them as landing-zone requirements.`,
        evidence: docOnly.flatMap((e) => uniquePaths(e.sources, 3).map((p) => `${e.capability}: ${p}`)).slice(0, 20),
        confidence: 'low',
        outcome: 'neutral',
        implies: docOnly.map((e) => `service_dep:${e.capability}`),
      });
    }
  }
  return out;
}
