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

// #3424: stack-aware evidence for Pass 06 TF-01 (Factor III, Config),
// Design 079 section 4.2. TF-01 used to look for `.env.example` only and
// scored its absence High for every stack, so Spring Boot services deployed
// with Helm values files were reported as "hard-coded config risk".
//
// This module collects, per stack, the idiomatic externalisation evidence
// (positive) and literal endpoints / credentials in packaged configuration
// (negative). Endpoints come from the shared endpoint scanner (#3405): a
// templated host (`${DB_HOST}`) is positive evidence, a reportable public or
// private host is a hard-coded value. Credentials are matched by key name;
// the value is never copied into evidence (#3415).
//
// Files come from the central source scope (#3428); test code and test
// resources are never evidence for the production runtime. All regexes are
// linear (no nested quantifiers).

import { readFileSync } from 'fs';
import { z } from 'zod';
import { listSourceFiles, maskUserinfo, scanEndpoints, type SourceFile } from '@swao/core';
import type { JvmProject } from './jvm-build-files.js';
import type { Evidence } from './tf-runtime-evidence.js';
import { keyValueLines, type KeyValueLine } from './config-keys.js';

/** Stacks whose configuration idiom TF-01 recognises. */
export const CONFIG_STACKS = ['spring', 'jvm', 'helm', 'kubernetes', 'node', 'python', 'dotnet', 'docker'] as const;
export type ConfigStack = typeof CONFIG_STACKS[number];

const EvidenceSchema = z.object({ file: z.string(), detail: z.string() });

/**
 * #3424: `assessment.config_externalisation` of the TF pass. Consumed by the
 * deterministic cloud-native score (#3431) and the report.
 */
export const ConfigExternalisationSchema = z.object({
  /** Factor III status: pass (positive evidence), partial, fail (hard-coded values), unknown (not determinable). */
  status: z.enum(['pass', 'partial', 'fail', 'unknown']),
  confidence: z.enum(['high', 'medium', 'low']),
  /** Stacks recognised in the source tree (config idiom, not the language census). */
  stacks: z.array(z.enum(CONFIG_STACKS)),
  /** Strong externalisation evidence (placeholders, env reads, ConfigMap refs, `.env.example`). */
  positive: z.array(EvidenceSchema),
  positive_count: z.number().int().nonnegative(),
  /** Supporting evidence only (profile files, per-environment values files, Dockerfile ENV). */
  supporting: z.array(EvidenceSchema),
  /** Literal reportable endpoints or credentials in packaged configuration (`file:line`). */
  hard_coded: z.array(EvidenceSchema),
  hard_coded_count: z.number().int().nonnegative(),
  /** Literal endpoint defaults inside placeholders (`${DB_HOST:10.0.0.1}`). */
  placeholder_defaults: z.array(EvidenceSchema),
  /** Literal endpoints in deployment values (Helm values, ConfigMaps). */
  deployment_literals: z.array(EvidenceSchema),
  /** Of those, literals in a chart's default values.yaml or a ConfigMap (count against TF-01); per-environment overlays stay informational. */
  deployment_default_literal_count: z.number().int().nonnegative().optional(),
  /** Cluster service names in packaged config (`postgres`, `db.ns.svc.cluster.local`): platform-resolved, informational. */
  service_hosts: z.array(EvidenceSchema),
  /** Configuration and source files read. */
  files_checked: z.number().int().nonnegative(),
});
export type ConfigExternalisation = z.infer<typeof ConfigExternalisationSchema>;

/** Raw evidence before scoring. */
export interface ConfigEvidence {
  stacks: ConfigStack[];
  positive: Evidence[];
  positiveCount: number;
  supporting: Evidence[];
  hardCoded: Evidence[];
  hardCodedCount: number;
  placeholderDefaults: Evidence[];
  deploymentLiterals: Evidence[];
  /** Literal hosts in a chart's default values.yaml or a ConfigMap (negative evidence, issue #3424 fix text). */
  deploymentDefaultLiterals: Evidence[];
  serviceHosts: Evidence[];
  /** `.env.example` family file (relative path), when present. */
  envExample: string | null;
  filesChecked: number;
}

export interface CollectConfigEvidenceOptions {
  /** Node stack per INV-01 / package.json (pass 06 decides). */
  isNode: boolean;
  /** JVM project (collectJvmProject), when the pass recognised one. */
  jvm: JvmProject | null;
}

const MAX_LIST_DEPTH = 10;
const MAX_CONFIG_BYTES = 1_000_000;
const MAX_SOURCE_BYTES = 512_000;
const MAX_CONFIG_FILES = 200;
const MAX_YAML_FILES = 400;
const MAX_SOURCE_FILES = 3000;
/** Evidence items kept per list (the counts stay exact). */
const MAX_EVIDENCE = 20;

const SPRING_CONFIG_RE = /^(application|bootstrap)([-.][\w.-]+)?\.(ya?ml|properties)$/i;
/** Spring profiles whose files never reach production (test fixtures). */
const SPRING_TEST_PROFILE_RE = /^(application|bootstrap)-(test|tests|it|junit|integration-?test)\.(ya?ml|properties)$/i;
const APPSETTINGS_RE = /^appsettings(\.[\w-]+)?\.json$/i;
const HELM_VALUES_RE = /^values([-.][\w.-]+)?\.ya?ml$/i;
const ENV_EXAMPLE_NAMES: ReadonlySet<string> = new Set(['.env.example', '.env.sample', '.env.template', '.env.dist']);
const PY_MANIFESTS: ReadonlySet<string> = new Set(['requirements.txt', 'pyproject.toml', 'setup.py', 'setup.cfg', 'pipfile']);

const PLACEHOLDER_RE = /\$\{[A-Za-z_][\w.-]*/;
const SPRING_DEFAULT_RE = /\$\{([A-Za-z_][\w.-]*):([^}]*)\}/;

/** Leaf keys (lower-cased, `-` and `_` dropped) that hold a credential. */
const CREDENTIAL_KEY_RE = /(password|passwd|pwd|secret|token|apikey|accesskey|secretkey|privatekey|credentials?)$/;
/** Keys that end like a credential but are not one. */
const CREDENTIAL_KEY_EXCLUDE_RE = /(tokenuri|tokenurl|tokenendpoint|secretname|secretref|passwordencoder|tokenvalidity|tokenheader|secretsmanager|secretkeyref|passwordpolicy|passwordfile|tokenfile|secretfile|keyfile|existingsecret|imagepullsecrets?|tlssecret|secretkeyselector|secretprovider(class)?)$/;

/**
 * #3424: single-label hosts (`postgres`, `config-server`) and Kubernetes
 * service DNS names (`db.ns.svc`, `db.ns.svc.cluster.local`). The endpoint
 * scanner classifies them `private`; the platform resolves them per
 * namespace, so they bind a backing service by name rather than hard-code an
 * environment. Informational for TF-01.
 */
export function isServiceDiscoveryHost(host: string): boolean {
  const h = host.toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')) return false;
  return !h.includes('.') || /\.svc(\.cluster\.local)?$/.test(h) || h.endsWith('.cluster.local');
}
/** Values that are references, not literals. */
const CREDENTIAL_VALUE_REF_RE = /^(\$\{|\{\{|#\{|<|ENC\(|\{cipher\}|vault:|classpath:|file:|env:|secret:|ref\+|arn:aws:secretsmanager|projects\/[^/]+\/secrets\/)/i;
const CREDENTIAL_VALUE_TRIVIAL: ReadonlySet<string> = new Set(['', 'null', '~', 'none', 'true', 'false', '""', "''"]);
/** `Password=...;` inside a connection string. */
const CONN_STRING_PASSWORD_RE = /(?:^|;)\s*(?:password|pwd)\s*=\s*([^;"]*)/i;

// Code-level patterns (one test per line, no nested quantifiers).
const JAVA_VALUE_RE = /@Value\(\s*"\$\{/;
const JAVA_CONFIG_PROPS_RE = /@ConfigurationProperties\b/;
const JAVA_GETENV_RE = /\bSystem\.getenv\(/;
const NODE_ENV_READ_RE = /\bprocess\.env(?:\.(?!NODE_ENV\b)[A-Za-z_]\w*|\[)/;
const NODE_DOTENV_RE = /\brequire\(\s*['"]dotenv(?:\/config)?['"]\s*\)|\bfrom\s+['"]dotenv(?:\/config)?['"]|\bimport\s+['"]dotenv\/config['"]/;
const PY_ENV_RE = /\bos\.(?:environ\b|getenv\()/;
const PY_SETTINGS_RE = /\bclass\s+\w+\(\s*(?:pydantic_settings\.)?BaseSettings\s*\)/;
const PY_LIB_RE = /^\s*(?:from|import)\s+(?:environs|decouple|dotenv)\b/;
const DOTNET_ENV_RE = /\bAddEnvironmentVariables\(|\bEnvironment\.GetEnvironmentVariable\(/;

// Deployment manifests.
const K8S_KIND_RE = /^[ \t]*kind:[ \t]*['"]?(ConfigMap|Secret)\b/m;
const K8S_REF_RE = /^[ \t-]*(envFrom|configMapKeyRef|secretKeyRef|configMapRef|secretRef|configMapGenerator|secretGenerator)[ \t]*:/m;
const HELM_VALUES_REF_RE = /\.Values\./;
const DOCKER_ENV_RE = /^[ \t]*(ENV|ARG)[ \t]+[A-Za-z_]/m;
const COMPOSE_ENV_RE = /^[ \t]*(environment|env_file)[ \t]*:/m;

function read(f: SourceFile, cap: number): string | null {
  if (f.sizeBytes > cap) return null;
  try { return readFileSync(f.abs, 'utf-8'); } catch { return null; }
}

function lineOf(content: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content.charCodeAt(i) === 10) n++;
  return n;
}

function normKey(k: string): string {
  return k.toLowerCase().replace(/[-_]/g, '');
}

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) return t.slice(1, -1);
  return t;
}

// #3485: the YAML / properties key tracker is shared with the JVM passes.
export { keyValueLines, type KeyValueLine } from './config-keys.js';

/** `"Key": "value"` pairs of a JSON file (one per line, typical for appsettings.json). */
function jsonStringLines(content: string): KeyValueLine[] {
  const out: KeyValueLine[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /"([A-Za-z0-9_.:-]+)"\s*:\s*"([^"]*)"/.exec(lines[i] ?? '');
    if (m) out.push({ key: m[1]!, value: m[2]!, line: i + 1 });
  }
  return out;
}

/**
 * #3424: credential literal check for one key / value pair. Returns the
 * evidence detail (never the value) or null.
 */
export function credentialLiteral(key: string, value: string): string | null {
  const leaf = normKey(key.split('.').pop() ?? key);
  const v = unquote(value);
  // Connection string with an inline password (any key).
  const conn = CONN_STRING_PASSWORD_RE.exec(v);
  if (conn && v.includes(';')) {
    const pw = conn[1]!.trim();
    if (pw.length > 0 && !CREDENTIAL_VALUE_REF_RE.test(pw) && !PLACEHOLDER_RE.test(pw)) return `literal password in the connection string ${key}`;
  }
  if (!CREDENTIAL_KEY_RE.test(leaf) || CREDENTIAL_KEY_EXCLUDE_RE.test(leaf)) return null;
  if (CREDENTIAL_VALUE_TRIVIAL.has(v.toLowerCase())) return null;
  const def = SPRING_DEFAULT_RE.exec(v);
  if (def) {
    const d = unquote(def[2]!.trim());
    return d.length > 0 && !CREDENTIAL_VALUE_REF_RE.test(d) ? `literal default for ${key} inside the placeholder \${${def[1]}}` : null;
  }
  if (CREDENTIAL_VALUE_REF_RE.test(v) || PLACEHOLDER_RE.test(v)) return null;
  return `literal value for ${key}`;
}

function push(list: Evidence[], e: Evidence): void {
  if (list.length < MAX_EVIDENCE && !list.some((x) => x.file === e.file && x.detail === e.detail)) list.push(e);
}

/**
 * #3424: collect TF-01 evidence for every recognised stack. One source-scope
 * listing; files are read once and capped.
 */
export function collectConfigEvidence(sourcePath: string, opts: CollectConfigEvidenceOptions): ConfigEvidence {
  const ev: ConfigEvidence = {
    stacks: [], positive: [], positiveCount: 0, supporting: [], hardCoded: [], hardCodedCount: 0,
    placeholderDefaults: [], deploymentLiterals: [], deploymentDefaultLiterals: [], serviceHosts: [], envExample: null, filesChecked: 0,
  };
  const stacks = new Set<ConfigStack>();
  const all = listSourceFiles(sourcePath, { purpose: 'config', maxDepth: MAX_LIST_DEPTH, includeHidden: true })
    .filter((f) => !f.isTest);

  const positive = (e: Evidence): void => { ev.positiveCount++; push(ev.positive, e); };
  const hardCoded = (e: Evidence): void => { ev.hardCodedCount++; push(ev.hardCoded, e); };

  // --- stack recognition (manifests and config idioms) ---
  if (opts.isNode || all.some((f) => f.name === 'package.json' && f.depth <= 2)) stacks.add('node');
  if (opts.jvm && opts.jvm.manifests.length > 0) stacks.add(opts.jvm.usesSpringBoot ? 'spring' : 'jvm');
  if (all.some((f) => PY_MANIFESTS.has(f.name.toLowerCase()))) stacks.add('python');
  if (all.some((f) => f.ext === '.csproj' || APPSETTINGS_RE.test(f.name))) stacks.add('dotnet');
  const chartDirs = all.filter((f) => f.name === 'Chart.yaml' || f.name === 'Chart.yml')
    .map((f) => (f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/') + 1) : ''));
  if (chartDirs.length > 0) stacks.add('helm');
  const inChart = (rel: string): boolean => chartDirs.some((d) => rel.startsWith(d));

  // --- .env.example family (any stack; legacy TF-01 evidence) ---
  for (const f of all) {
    if (!ENV_EXAMPLE_NAMES.has(f.name.toLowerCase())) continue;
    const content = read(f, MAX_CONFIG_BYTES);
    if (content === null || content.trim().length === 0) continue;
    ev.filesChecked++;
    if (!ev.envExample) ev.envExample = f.rel;
    positive({ file: f.rel, detail: `${f.name} documents the environment variables` });
  }

  // --- packaged application configuration: Spring and .NET appsettings ---
  const springFiles = all.filter((f) => SPRING_CONFIG_RE.test(f.name));
  if (springFiles.length > 0 && !stacks.has('spring') && opts.jvm) stacks.add('spring');
  const appConfig = [
    ...springFiles,
    ...all.filter((f) => APPSETTINGS_RE.test(f.name)),
  ].slice(0, MAX_CONFIG_FILES);

  for (const f of appConfig) {
    const content = read(f, MAX_CONFIG_BYTES);
    if (content === null) continue;
    ev.filesChecked++;
    const isSpring = SPRING_CONFIG_RE.test(f.name);
    const isTestProfile = SPRING_TEST_PROFILE_RE.test(f.name);
    const pairs = f.ext === '.json' ? jsonStringLines(content) : keyValueLines(f.name, content);

    if (isSpring && /^(application|bootstrap)-[\w.-]+\./i.test(f.name) && !isTestProfile) {
      push(ev.supporting, { file: f.rel, detail: 'Spring profile-specific configuration file' });
    }
    if (APPSETTINGS_RE.test(f.name) && /^appsettings\.[\w-]+\.json$/i.test(f.name)) {
      push(ev.supporting, { file: f.rel, detail: '.NET environment-specific appsettings override' });
    }

    let placeholders = 0;
    for (const p of pairs) {
      const at = `${f.rel}:${p.line}`;
      const k = normKey(p.key);
      if (isSpring) {
        if (k === 'spring.config.import') positive({ file: at, detail: `spring.config.import=${maskUserinfo(unquote(p.value)).slice(0, 80)}` });
        else if (k === 'spring.cloud.config.uri' || k === 'spring.cloud.vault.uri') positive({ file: at, detail: `${p.key} (external configuration server)` });
        else if (k === 'spring.profiles.active' || k === 'spring.profiles.include' || k === 'spring.config.activate.onprofile') {
          push(ev.supporting, { file: at, detail: `${p.key}=${unquote(p.value).slice(0, 60)}` });
        }
      }
      if (PLACEHOLDER_RE.test(p.value)) {
        placeholders++;
        // Only the variable name: a placeholder default may be a credential (#3415).
        const name = /\$\{([A-Za-z_][\w.-]*)/.exec(p.value)?.[1] ?? '';
        if (placeholders <= 3) positive({ file: at, detail: `${p.key} resolved from the placeholder \${${name}}` });
        else ev.positiveCount++;
      }
      if (isTestProfile) continue;
      const cred = credentialLiteral(p.key, p.value);
      if (cred) hardCoded({ file: at, detail: cred });
    }

    if (isTestProfile) continue;
    for (const hit of scanEndpoints(content)) {
      const at = `${f.rel}:${hit.line}`;
      if (hit.classification === 'templated') {
        // The raw authority may carry userinfo or a default: show the variable name only.
        const name = /\$\{([A-Za-z_][\w.-]*)/.exec(hit.host)?.[1] ?? /\{\{\s*([\w.]+)/.exec(hit.host)?.[1] ?? 'template';
        positive({ file: at, detail: `templated ${hit.scheme ?? 'URL'} endpoint host (${name})` });
        // A literal default inside the placeholder authority (`${DB_HOST:10.0.0.1}`).
        for (const inner of scanEndpoints(hit.host)) {
          if (inner.reportable) push(ev.placeholderDefaults, { file: at, detail: `literal ${inner.classification} default ${inner.host} inside a placeholder` });
        }
        continue;
      }
      if (!hit.reportable) continue;
      if (hit.kind === 'url' && isServiceDiscoveryHost(hit.host)) {
        push(ev.serviceHosts, { file: at, detail: `cluster service name ${hit.host} (${hit.scheme}), resolved by the platform` });
        continue;
      }
      const lineText = content.split(/\r?\n/)[hit.line - 1] ?? '';
      if (PLACEHOLDER_RE.test(lineText)) {
        push(ev.placeholderDefaults, { file: at, detail: `literal ${hit.classification} default ${hit.host} inside a placeholder` });
      } else {
        hardCoded({ file: at, detail: `hard-coded ${hit.classification} ${hit.kind === 'url' ? `endpoint ${hit.scheme}://${hit.host}` : `IP ${hit.host}`}` });
      }
    }
  }

  // --- deployment manifests: Helm, Kubernetes, Docker, Compose ---
  const yamlFiles = all.filter((f) => (f.ext === '.yaml' || f.ext === '.yml' || f.ext === '.tpl') && !SPRING_CONFIG_RE.test(f.name))
    .slice(0, MAX_YAML_FILES);
  for (const f of yamlFiles) {
    const content = read(f, MAX_CONFIG_BYTES);
    if (content === null) continue;
    const chart = inChart(f.rel);
    const isValues = HELM_VALUES_RE.test(f.name);
    const isTemplate = chart && f.rel.includes('templates/');
    const kind = K8S_KIND_RE.exec(content);
    const ref = K8S_REF_RE.exec(content);
    const helmRef = isTemplate ? HELM_VALUES_REF_RE.exec(content) : null;
    const compose = /^(docker-)?compose[\w.-]*\.ya?ml$/i.test(f.name) ? COMPOSE_ENV_RE.exec(content) : null;
    if (!kind && !ref && !helmRef && !isValues && !compose) continue;
    ev.filesChecked++;
    if (kind) { stacks.add('kubernetes'); positive({ file: `${f.rel}:${lineOf(content, kind.index)}`, detail: `Kubernetes ${kind[1]} manifest` }); }
    if (ref) { stacks.add('kubernetes'); positive({ file: `${f.rel}:${lineOf(content, ref.index)}`, detail: `${ref[1]} reference in the workload spec` }); }
    if (helmRef) positive({ file: `${f.rel}:${lineOf(content, helmRef.index)}`, detail: 'Helm template reads configuration from .Values' });
    if (compose) { stacks.add('docker'); push(ev.supporting, { file: `${f.rel}:${lineOf(content, compose.index)}`, detail: `Compose ${compose[1]} block` }); }
    if (isValues && (chart || stacks.has('helm'))) {
      push(ev.supporting, { file: f.rel, detail: /^values[-.][\w-]+\.ya?ml$/i.test(f.name) ? 'per-environment Helm values file' : 'Helm values file' });
    }
    // Deployment config: credentials are committed secrets (hard-coded).
    // Literal hosts in per-environment overlays (values-<env>.yaml) are the
    // intended externalisation and stay informational; in the chart default
    // values.yaml or a ConfigMap they bake one environment into the artefact
    // and count against TF-01 (partial / low).
    if (isValues || kind) {
      const baseline = (isValues && /^values\.ya?ml$/i.test(f.name)) || kind?.[1] === 'ConfigMap';
      for (const p of keyValueLines(f.name, content)) {
        const cred = credentialLiteral(p.key, p.value);
        if (cred) hardCoded({ file: `${f.rel}:${p.line}`, detail: `${cred} in deployment configuration` });
      }
      for (const hit of scanEndpoints(content)) {
        if (!hit.reportable) continue;
        const lit = { file: `${f.rel}:${hit.line}`, detail: `${hit.classification} ${hit.kind === 'url' ? 'endpoint' : 'IP'} ${hit.host} in deployment values` };
        push(ev.deploymentLiterals, lit);
        if (baseline) push(ev.deploymentDefaultLiterals, lit);
      }
    }
  }

  for (const f of all) {
    const lower = f.name.toLowerCase();
    if (!(lower === 'dockerfile' || lower.startsWith('dockerfile.') || lower.endsWith('.dockerfile') || lower === 'containerfile')) continue;
    const content = read(f, MAX_CONFIG_BYTES);
    if (content === null) continue;
    ev.filesChecked++;
    stacks.add('docker');
    const m = DOCKER_ENV_RE.exec(content);
    if (m) push(ev.supporting, { file: `${f.rel}:${lineOf(content, m.index)}`, detail: `Dockerfile ${m[1]} instruction` });
  }

  // --- build-file dependencies (JVM) ---
  for (const d of opts.jvm?.dependencies ?? []) {
    if (!d.direct || d.scope === 'test' || d.group !== 'org.springframework.cloud') continue;
    if (/^spring-cloud-(starter-config|config-client|starter-vault-config|starter-kubernetes[\w-]*config|starter-consul-config|starter-aws-parameter-store-config)/.test(d.artifact)) {
      positive({ file: d.manifest, detail: `${d.artifact} (external configuration source)` });
    }
  }

  // --- code-level reads (capped) ---
  const codeExt = new Set<string>();
  if (stacks.has('spring') || stacks.has('jvm')) { codeExt.add('.java'); codeExt.add('.kt'); }
  if (stacks.has('node')) for (const e of ['.ts', '.js', '.mjs', '.cjs', '.tsx', '.jsx']) codeExt.add(e);
  if (stacks.has('python')) codeExt.add('.py');
  if (stacks.has('dotnet')) codeExt.add('.cs');
  if (codeExt.size > 0) {
    const rules: Array<{ re: RegExp; ext: ReadonlySet<string>; detail: string }> = [
      { re: JAVA_VALUE_RE, ext: new Set(['.java', '.kt']), detail: '@Value("${...}") property injection' },
      { re: JAVA_CONFIG_PROPS_RE, ext: new Set(['.java', '.kt']), detail: '@ConfigurationProperties binding' },
      { re: JAVA_GETENV_RE, ext: new Set(['.java', '.kt']), detail: 'System.getenv read' },
      { re: NODE_ENV_READ_RE, ext: new Set(['.ts', '.js', '.mjs', '.cjs', '.tsx', '.jsx']), detail: 'process.env read' },
      { re: NODE_DOTENV_RE, ext: new Set(['.ts', '.js', '.mjs', '.cjs', '.tsx', '.jsx']), detail: 'dotenv loader' },
      { re: PY_ENV_RE, ext: new Set(['.py']), detail: 'os.environ / os.getenv read' },
      { re: PY_SETTINGS_RE, ext: new Set(['.py']), detail: 'pydantic BaseSettings class' },
      { re: PY_LIB_RE, ext: new Set(['.py']), detail: 'environment configuration library import' },
      { re: DOTNET_ENV_RE, ext: new Set(['.cs']), detail: 'environment variable configuration provider' },
    ];
    const seen = new Set<string>();
    const sources = all.filter((f) => codeExt.has(f.ext) && !f.isGenerated).slice(0, MAX_SOURCE_FILES);
    for (const f of sources) {
      const content = read(f, MAX_SOURCE_BYTES);
      if (content === null) continue;
      ev.filesChecked++;
      for (const r of rules) {
        if (!r.ext.has(f.ext)) continue;
        const m = r.re.exec(content);
        if (!m) continue;
        ev.positiveCount++;
        // One evidence item per pattern keeps the list readable; the count stays exact.
        if (!seen.has(r.detail)) { seen.add(r.detail); push(ev.positive, { file: `${f.rel}:${lineOf(content, m.index)}`, detail: r.detail }); }
      }
    }
  }

  ev.stacks = CONFIG_STACKS.filter((s) => stacks.has(s));
  return ev;
}

/** Scored TF-01 verdict. */
export interface Tf01Verdict {
  status: ConfigExternalisation['status'];
  severity: 'positive' | 'low' | 'medium' | 'high';
  confidence: ConfigExternalisation['confidence'];
}

/**
 * #3424: TF-01 severity calibration (Design 079 section 4.2).
 *   hard-coded values in packaged config -> high / fail;
 *   strong evidence plus literal placeholder defaults, or literal hosts in a
 *   chart default values.yaml / ConfigMap -> low / partial;
 *   strong evidence -> positive / pass;
 *   supporting evidence only -> low / partial;
 *   nothing recognisable -> medium / unknown (not determinable), confidence low.
 */
export function scoreConfigEvidence(ev: ConfigEvidence): Tf01Verdict {
  if (ev.hardCodedCount > 0) return { status: 'fail', severity: 'high', confidence: 'high' };
  if (ev.positiveCount > 0 && (ev.placeholderDefaults.length > 0 || ev.deploymentDefaultLiterals.length > 0)) return { status: 'partial', severity: 'low', confidence: 'medium' };
  if (ev.positiveCount > 0) return { status: 'pass', severity: 'positive', confidence: 'high' };
  if (ev.supporting.length > 0) return { status: 'partial', severity: 'low', confidence: 'medium' };
  return { status: 'unknown', severity: 'medium', confidence: 'low' };
}

/** #3424: the `assessment.config_externalisation` block (Zod-validated). */
export function toConfigExternalisation(ev: ConfigEvidence, verdict: Tf01Verdict): ConfigExternalisation {
  return ConfigExternalisationSchema.parse({
    status: verdict.status,
    confidence: verdict.confidence,
    stacks: ev.stacks,
    positive: ev.positive,
    positive_count: ev.positiveCount,
    supporting: ev.supporting,
    hard_coded: ev.hardCoded,
    hard_coded_count: ev.hardCodedCount,
    placeholder_defaults: ev.placeholderDefaults,
    deployment_literals: ev.deploymentLiterals,
    deployment_default_literal_count: ev.deploymentDefaultLiterals.length,
    service_hosts: ev.serviceHosts,
    files_checked: ev.filesChecked,
  });
}
