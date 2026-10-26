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
import { load } from 'js-yaml';
import type { PassContext, PassResult } from '@swao/core';
import type { Signal } from '@swao/core';
import { logPortfolio, listSourceFiles, findShallowestSourceFile } from '@swao/core';
import { TerraformOpenTofuProvider } from '@swao/module-iac-scan';
import { collectJvmProject } from './jvm-build-files.js';
import { collectJvmRuntimeEvidence, findKubernetesProbes, type Evidence } from './tf-runtime-evidence.js';
import { collectConfigEvidence, scoreConfigEvidence, toConfigExternalisation, type ConfigEvidence, type Tf01Verdict } from './tf-config-evidence.js';

function readFileSync_safe(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

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

// #1501: search up to maxDepth levels for a file matching the predicate (shallowest wins).
// #3428: served by the central source scope. Dot-files stay visible
// (.env.example is a search target); dot-directories and the canonical
// dependency / build-output folders are not searched.
function findFileRecursive(
  root: string,
  maxDepth: number,
  test: (name: string) => boolean,
): string | null {
  if (!existsSync(root)) return null;
  return findShallowestSourceFile(root, { purpose: 'config', maxDepth, includeHidden: true }, (f) => test(f.name))?.abs ?? null;
}

/**
 * #3158: top-most directories under `root` (depth <= maxDepth) that contain
 * `.tf` files. A folder below an already-found root is not listed again,
 * because the IaC scanners recurse. Hidden folders (.terraform, .git) and
 * dependency folders are skipped. Capped at `cap` roots.
 * #3428: derived from the central source scope. Top-most roots are disjoint
 * subtrees, which occupy contiguous ranges of the depth-first listing, so
 * ordering by the first .tf file reproduces the old pre-order walk.
 */
export function findTerraformRoots(root: string, maxDepth = 6, cap = 10): string[] {
  const dirs: string[] = [];
  for (const f of listSourceFiles(root, { purpose: 'config', maxDepth, includeHidden: true })) {
    if (!f.name.endsWith('.tf')) continue;
    const relDir = f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '';
    if (!dirs.includes(relDir)) dirs.push(relDir);
  }
  const isUnder = (child: string, parent: string): boolean =>
    parent === '' ? child !== '' : child.startsWith(`${parent}/`);
  const topMost = dirs.filter((d) => !dirs.some((o) => o !== d && isUnder(d, o)));
  return topMost.slice(0, cap).map((d) => (d === '' ? root : join(root, ...d.split('/'))));
}

// #1501: read INV-01 assessment.language from a prior run pass file.
function readInvLanguage(passesDir: string | undefined): string | null {
  if (!passesDir) return null;
  try {
    const raw = readFileSync(join(passesDir, '01-inv.yaml'), 'utf-8');
    const parsed = load(raw) as { assessment?: { language?: unknown } } | null;
    const lang = parsed?.assessment?.language;
    return typeof lang === 'string' ? lang : null;
  } catch { return null; }
}

export async function runTfPass(ctx: PassContext): Promise<PassResult> {
  const { sourcePath, iter, assessedAt, passesDir } = ctx;
  const signals: Signal[] = [];
  const factorScores: Array<{ factor: string; status: string; note?: string }> = [];

  const pkg = readJson(join(sourcePath, 'package.json'));
  const deps = pkg ? allDeps(pkg) : {};

  // #1501: determine primary language for language-gated checks.
  // Prefer INV-01 output (authoritative); fall back to manifest sniffing.
  const invLanguage = readInvLanguage(passesDir);
  const isNode = invLanguage
    ? ['node', 'typescript', 'javascript'].includes(invLanguage)
    : pkg !== null;
  const isRust = invLanguage === 'rust' || existsSync(join(sourcePath, 'Cargo.toml'));
  // #3421: Java / Kotlin services (Maven or Gradle anywhere in the source scope).
  const jvm = existsSync(sourcePath) ? collectJvmProject(sourcePath) : null;
  const isJvm = jvm !== null && jvm.manifests.length > 0
    && (invLanguage ? /^(java|kotlin|scala|groovy)/i.test(invLanguage) : pkg === null);
  const jvmEvidence = isJvm && jvm ? collectJvmRuntimeEvidence(sourcePath, jvm) : null;

  // Search recursively for config/compose files so subdirectory layouts are found (#1499/#1501).
  const envExamplePath = findFileRecursive(sourcePath, 3, (n) => n === '.env.example');
  const envExample = envExamplePath ? readFileSync_safe(envExamplePath) : null;
  const composePath = findFileRecursive(sourcePath, 3, (n) =>
    /^docker-compose.*\.(ya?ml)$/.test(n) || /^compose.*\.(ya?ml)$/.test(n),
  );
  const composeContent = composePath ? readFileSync_safe(composePath) : null;
  const hasK8s = existsSync(join(sourcePath, 'k8s')) || existsSync(join(sourcePath, 'helm'));

  // --- TF-01: Factor III -- Config (env vars) ---
  // #3424: stack-aware. The legacy `.env.example` check stays the Node path
  // (unchanged signal when it is the evidence); Spring, Helm, Kubernetes,
  // Python and .NET idioms count as well, literal endpoints / credentials in
  // packaged config count against, and no recognisable evidence is
  // "not determinable" (medium, factor unknown) instead of a false High.
  const hasEnvExample = envExample !== null && envExample.trim().length > 0;
  const envRelPath = envExamplePath ? envExamplePath.slice(sourcePath.length + 1).replace(/\\/g, '/') : '.env.example';
  const configEvidence = existsSync(sourcePath)
    ? collectConfigEvidence(sourcePath, { isNode, jvm: jvm && jvm.manifests.length > 0 ? jvm : null })
    : null;
  const tf01 = buildTf01(configEvidence, hasEnvExample, envRelPath);
  factorScores.push({ factor: 'III (Config)', status: tf01.verdict.status, ...(tf01.note ? { note: tf01.note } : {}) });
  signals.push({
    id: 'TF-01',
    source: 'static_analysis',
    category: 'application',
    severity: tf01.verdict.severity,
    derivation: tf01.derivation,
    evidence: tf01.evidence,
    confidence: tf01.verdict.confidence,
  });

  // --- TF-02: Factor II -- Dependencies (registry sovereignty) ---
  const composeRelPath = composePath ? composePath.slice(sourcePath.length + 1).replace(/\\/g, '/') : null;
  const hasPublicRegistry = composeContent
    ? /docker\.io|hub\.docker\.com/.test(composeContent) ||
      /image:\s*(postgres|redis|node|nginx|ubuntu)/.test(composeContent)
    : false;
  const factorIiStatus = !composeContent ? 'unknown' : hasPublicRegistry ? 'partial' : 'pass';
  factorScores.push({
    factor: 'II (Dependencies)',
    status: factorIiStatus,
    note: hasPublicRegistry ? 'Registry not sovereign; images from public docker.io' : undefined,
  });

  signals.push({
    id: 'TF-02',
    source: 'static_analysis',
    category: 'infrastructure_platform',
    severity: hasPublicRegistry ? 'medium' : composeContent ? 'positive' : 'low',
    derivation: hasPublicRegistry
      ? `Docker Compose references public docker.io images. For sovereign deployment, images must be mirrored to a sovereign container registry. Factor II partially satisfied.`
      : composeContent
        ? `Docker Compose found at ${composeRelPath}. No public registry references detected. Factor II satisfied.`
        : `No Docker Compose found. Cannot assess Factor II (Dependencies).`,
    evidence: composeRelPath ? [composeRelPath] : [],
    confidence: composeContent ? 'high' : 'low',
  });

  // --- TF-03: Factor VIII -- Concurrency (K8s / horizontal scaling) ---
  const hasCompose = composeContent !== null;
  const factorViiiStatus = hasK8s ? 'pass' : hasCompose ? 'fail' : 'unknown';
  factorScores.push({
    factor: 'VIII (Concurrency)',
    status: factorViiiStatus,
    note: !hasK8s && hasCompose ? 'No orchestrator; DORA resilience gap' : undefined,
  });

  signals.push({
    id: 'TF-03',
    source: 'static_analysis',
    category: 'infrastructure_platform',
    severity: !hasK8s && hasCompose ? 'high' : 'informational',
    derivation: hasK8s
      ? `Kubernetes manifests found. Horizontal scaling supported. Factor VIII satisfied.`
      : hasCompose
        ? `Docker Compose at ${composeRelPath} with no replicas/scaling config. No Kubernetes manifests. Factor VIII not met. DORA operational resilience requires multi-instance deployment.`
        : `No container orchestration config found. Cannot assess Factor VIII.`,
    evidence: hasK8s ? ['k8s/'] : composeRelPath ? [composeRelPath] : [],
    confidence: hasK8s || hasCompose ? 'high' : 'low',
  });

  // --- TF-04: Factor XI -- Logs (structured logging) ---
  // #1501: gate on language; Rust apps use tracing/log crates, not Node.js libs.
  let hasStructuredLogging = false;
  let tf04Derivation: string;
  let tf04Evidence: string[];
  let tf04Severity: Signal['severity'];
  let factorXiStatus: string;

  if (isNode) {
    hasStructuredLogging =
      'pino' in deps || 'winston' in deps || 'bunyan' in deps ||
      'nestjs-pino' in deps || 'pino-http' in deps;
    factorXiStatus = hasStructuredLogging ? 'pass' : 'partial';
    const foundLibs = Object.keys(deps).filter((d) =>
      ['pino', 'winston', 'bunyan', 'nestjs-pino', 'pino-http'].includes(d),
    );
    tf04Severity = hasStructuredLogging ? 'positive' : 'medium';
    tf04Evidence = ['package.json'];
    tf04Derivation = hasStructuredLogging
      ? `Structured logging library detected (${foundLibs.join(', ')}). Factor XI satisfied.`
      : `No structured logging library found in package.json (pino, winston, bunyan). Console/framework default logging does not provide structured JSON output for sovereign SIEM integration. Factor XI partially satisfied.`;
  } else if (isRust) {
    const cargoToml = readFileSync_safe(join(sourcePath, 'Cargo.toml'));
    const rustLogLibs = ['tracing', 'log', 'env_logger', 'tracing-subscriber', 'slog'];
    const foundRustLibs = cargoToml
      ? rustLogLibs.filter((lib) => cargoToml.includes(`"${lib}"`) || cargoToml.includes(`'${lib}'`) || cargoToml.includes(`${lib} =`))
      : [];
    hasStructuredLogging = foundRustLibs.length > 0;
    factorXiStatus = hasStructuredLogging ? 'pass' : 'partial';
    tf04Severity = hasStructuredLogging ? 'positive' : 'medium';
    tf04Evidence = cargoToml ? ['Cargo.toml'] : [];
    tf04Derivation = hasStructuredLogging
      ? `Rust structured logging crate detected (${foundRustLibs.join(', ')}). Factor XI satisfied.`
      : `No structured logging crate found in Cargo.toml (tracing, log, env_logger). Factor XI partially satisfied.`;
  } else if (isJvm && jvm && jvmEvidence) {
    // #3421: Java / Spring Boot. JSON output configured in logback / log4j2 or
    // via Spring Boot structured logging = pass; an encoder library without a
    // configuration that uses it = partial; nothing = partial with the files
    // that were inspected as evidence (a definite result, not "not performed").
    const configured = jvmEvidence.structuredLogging;
    const libs = jvmEvidence.structuredLoggingLibraries;
    const inspected = [...jvm.manifests.slice(0, 3), ...jvmEvidence.loggingConfigFiles, ...jvmEvidence.springConfigFiles].slice(0, 8);
    hasStructuredLogging = configured.length > 0;
    if (configured.length > 0) {
      factorXiStatus = 'pass';
      tf04Severity = 'positive';
      tf04Evidence = [...new Set([...configured.map((e) => e.file), ...libs.map((e) => e.file)])];
      tf04Derivation = `Structured (JSON) logging configured: ${configured.map((e) => `${e.detail} in ${e.file}`).join('; ')}${libs.length > 0 ? ` (library: ${libs.map((e) => e.detail).join(', ')})` : ''}. Factor XI satisfied.`;
    } else if (libs.length > 0) {
      factorXiStatus = 'partial';
      tf04Severity = 'low';
      tf04Evidence = [...new Set([...libs.map((e) => e.file), ...jvmEvidence.loggingConfigFiles])];
      tf04Derivation = `Structured logging library declared (${libs.map((e) => `${e.detail} in ${e.file}`).join('; ')}) but no logback / log4j2 configuration or Spring Boot logging.structured.format setting uses a JSON encoder or layout${jvmEvidence.loggingConfigFiles.length > 0 ? ` (checked ${jvmEvidence.loggingConfigFiles.join(', ')})` : ''}. Factor XI partially satisfied.`;
    } else {
      factorXiStatus = 'partial';
      tf04Severity = 'medium';
      tf04Evidence = inspected;
      tf04Derivation = `No structured (JSON) logging found for this Java service: no logstash-logback-encoder, ECS or log4j2 JSON layout dependency in ${jvm.manifests.slice(0, 3).join(', ')}, no JSON encoder or layout in ${jvmEvidence.loggingConfigFiles.length > 0 ? jvmEvidence.loggingConfigFiles.join(', ') : 'any logback / log4j2 configuration (none present)'}, and no Spring Boot logging.structured.format setting. Default plain-text pattern logging does not provide structured output for sovereign SIEM integration. Factor XI partially satisfied.`;
    }
  } else {
    factorXiStatus = 'unknown';
    tf04Severity = 'informational';
    tf04Evidence = [];
    tf04Derivation = `Language not Node.js, Rust or Java, structured logging check not performed for this stack. Factor XI status unknown.`;
  }

  factorScores.push({
    factor: 'XI (Logs)',
    status: factorXiStatus,
    note: !hasStructuredLogging && factorXiStatus !== 'unknown' ? 'stdout but no structured/sovereign log shipping' : undefined,
  });

  signals.push({
    id: 'TF-04',
    source: 'static_analysis',
    category: 'application',
    severity: tf04Severity,
    derivation: tf04Derivation,
    evidence: tf04Evidence,
    confidence: 'high',
  });

  // --- TF-05: Factor IX -- Disposability (health endpoint) ---
  // #1501: check Rust health handler patterns in addition to Node.js paths.
  const healthEndpointPath = findFileRecursive(sourcePath, 4, (n) =>
    n === 'health.controller.ts' || n === 'health.rs' || n === 'healthcheck.rs' || n === 'health_check.rs',
  );
  const hasHealthEndpoint = healthEndpointPath !== null
    || existsSync(join(sourcePath, 'src', 'health'))
    || existsSync(join(sourcePath, 'apps', 'api', 'src', 'app', 'health'));
  const healthRelPath = healthEndpointPath
    ? healthEndpointPath.slice(sourcePath.length + 1).replace(/\\/g, '/')
    : null;
  // #3421: Spring Boot Actuator health (starter, exposure, probe groups) and
  // Kubernetes liveness / readiness / startup probes for any stack.
  const k8sProbes = existsSync(sourcePath) ? findKubernetesProbes(sourcePath) : [];
  const healthEvidence: Evidence[] = [
    ...(healthRelPath ? [{ file: healthRelPath, detail: 'health handler' }] : []),
    ...(jvmEvidence?.health ?? []),
    ...k8sProbes,
  ];
  const healthFound = hasHealthEndpoint || healthEvidence.length > 0;
  const graceful = jvmEvidence?.gracefulShutdown ?? null;
  const healthText = healthEvidence.length > 0
    ? healthEvidence.slice(0, 6).map((e) => `${e.detail} (${e.file})`).join('; ')
    : '';

  let factorIxStatus: string;
  let tf05Severity: Signal['severity'];
  let tf05Derivation: string;
  let tf05Evidence: string[];
  let tf05Confidence: Signal['confidence'];
  let tf05Note: string | undefined;
  if (healthFound && graceful) {
    // Declarative graceful shutdown (server.shutdown=graceful, or the Spring
    // Boot 3.4+ default) confirms the SIGTERM path the design otherwise
    // leaves open, so Factor IX is satisfied.
    factorIxStatus = 'pass';
    tf05Severity = 'positive';
    tf05Derivation = `Health endpoint detected: ${healthText}. Graceful shutdown configured: ${graceful.detail} (${graceful.file}). Disposability (Factor IX) satisfied.`;
    tf05Evidence = [...new Set([...healthEvidence.map((e) => e.file), graceful.file])];
    tf05Confidence = 'high';
    tf05Note = undefined;
  } else if (healthFound) {
    factorIxStatus = 'partial';
    tf05Severity = 'low';
    const onlyLegacyHandler = (jvmEvidence?.health.length ?? 0) === 0 && k8sProbes.length === 0;
    tf05Derivation = onlyLegacyHandler
      // Pre-#3421 wording for the Node / Rust handler-file detection (unchanged).
      ? `Health endpoint detected${healthRelPath ? ` at ${healthRelPath}` : ''}. Disposability (Factor IX) partially satisfied. Graceful SIGTERM shutdown hooks not confirmed from static analysis.`
      : healthText
      ? `Health endpoint detected: ${healthText}. Disposability (Factor IX) partially satisfied. Graceful SIGTERM shutdown not confirmed from static analysis${isJvm ? ' (no server.shutdown=graceful; Spring Boot before 3.4 shuts down immediately by default)' : ''}.`
      : `Health endpoint detected. Disposability (Factor IX) partially satisfied. Graceful SIGTERM shutdown hooks not confirmed from static analysis.`;
    tf05Evidence = healthEvidence.length > 0 ? [...new Set(healthEvidence.map((e) => e.file))] : ['src/health/'];
    tf05Confidence = 'medium';
    tf05Note = 'Health check present; shutdown hooks unconfirmed';
  } else if (isJvm && jvm && jvmEvidence && jvm.usesSpringBoot) {
    // #3421: a definite negative for Spring Boot services, with the inspected
    // files. Other JVM frameworks (Quarkus, Micronaut, ...) without a
    // recognised health artifact stay "unknown" rather than a false negative.
    factorIxStatus = 'fail';
    tf05Severity = 'medium';
    tf05Derivation = `No health endpoint for this Java service: spring-boot-starter-actuator not declared in ${jvm.manifests.slice(0, 3).join(', ')}, no management.endpoints.web.exposure / health probe settings in ${jvmEvidence.springConfigFiles.length > 0 ? jvmEvidence.springConfigFiles.join(', ') : 'any application configuration (none present)'}, and no Kubernetes livenessProbe / readinessProbe in the source tree. Orchestrators cannot detect an unhealthy instance. Factor IX (Disposability) not met.`;
    tf05Evidence = [...jvm.manifests.slice(0, 3), ...jvmEvidence.springConfigFiles].slice(0, 8);
    tf05Confidence = 'medium';
    tf05Note = 'No health endpoint or orchestrator probe';
  } else {
    factorIxStatus = 'unknown';
    tf05Severity = 'low';
    tf05Derivation = `No health endpoint detected from static analysis. Factor IX (Disposability) status unknown.`;
    tf05Evidence = [];
    tf05Confidence = 'low';
    tf05Note = 'Health check present; shutdown hooks unconfirmed';
  }
  factorScores.push({ factor: 'IX (Disposability)', status: factorIxStatus, note: tf05Note });

  signals.push({
    id: 'TF-05',
    source: 'static_analysis',
    category: 'application',
    severity: tf05Severity,
    derivation: tf05Derivation,
    evidence: tf05Evidence,
    confidence: tf05Confidence,
  });

  // design 085 SS9, #1327: IaC security scanner stub.
  // runs checkov/kics when .tf source files exist in sourcePath.
  // findings emitted as informational signals; not yet scored (sprint-111 scope).
  // #3158: Terraform usually lives in a subfolder (infra/, terraform/,
  // deploy/...), not the source root, so the root-only check never ran the
  // scanner for most repositories. Find the top-most folders holding .tf
  // files and scan each (checkov and kics recurse below a folder).
  // #3431: the root count is also IaC evidence for the portability score.
  let tfRoots: string[] = [];
  try {
    tfRoots = existsSync(sourcePath) ? findTerraformRoots(sourcePath) : [];
    if (tfRoots.length > 0) {
      const iacProvider = new TerraformOpenTofuProvider();
      logPortfolio('info', 'pass.iac.scanner.start', 'IaC static scan starting', {
        context: { source_path: sourcePath, terraform_roots: tfRoots.length, pass: 'tf' },
      });
      const iacFindings: Awaited<ReturnType<TerraformOpenTofuProvider['scanSource']>> = [];
      const seenFindings = new Set<string>();
      for (const root of tfRoots) {
        for (const f of await iacProvider.scanSource({ sourceFiles: [join(root, 'main.tf')] })) {
          const key = `${f.ruleId}|${f.resource}`;
          if (seenFindings.has(key)) continue;
          seenFindings.add(key);
          iacFindings.push(f);
        }
      }
      logPortfolio('info', 'pass.iac.scanner.complete', `IaC static scan complete: ${iacFindings.length} finding(s)`, {
        context: { findings_count: iacFindings.length, pass: 'tf' },
      });
      for (let i = 0; i < iacFindings.length; i++) {
        const finding = iacFindings[i]!;
        signals.push({
          id: `TF-IAC-${String(i + 1).padStart(2, '0')}`,
          source: 'static_analysis',
          category: 'infrastructure_platform',
          severity: finding.severity === 'critical' || finding.severity === 'high' ? 'high' : 'medium',
          derivation: `IaC security finding [${finding.ruleId}]: ${finding.message} (${finding.resource})`,
          evidence: [finding.resource],
          confidence: 'medium',
        });
      }
    }
  } catch {
    logPortfolio('warn', 'pass.iac.scanner.skipped', 'IaC static scan skipped: checkov and kics not found on PATH', {
      context: { pass: 'tf' },
    });
  }

  const passCount = factorScores.filter((f) => f.status === 'pass').length;
  const totalChecked = factorScores.filter((f) => f.status !== 'unknown').length;
  const passRate = totalChecked > 0 ? Math.round((passCount / totalChecked) * 100) / 100 : 0;

  return {
    pass: {
      id: 6,
      name: 'twelve_factor',
      signal_prefix: 'TF',
      status: 'complete',
      iter,
      assessed_at: assessedAt,
    },
    signals,
    assessment: {
      factor_scores: factorScores,
      twelve_factor_pass_rate: passRate,
      // #3431: Terraform / OpenTofu roots in the source scope (IaC evidence, portability score).
      iac_roots: tfRoots.length,
      // #3424: TF-01 evidence for the deterministic cloud-native score (#3431).
      ...(configEvidence ? { config_externalisation: toConfigExternalisation(configEvidence, tf01.verdict) } : {}),
    },
  };
}

const STACK_LABELS: Record<ConfigEvidence['stacks'][number], string> = {
  spring: 'Spring Boot', jvm: 'JVM', helm: 'Helm', kubernetes: 'Kubernetes', node: 'Node.js',
  python: 'Python', dotnet: '.NET', docker: 'Docker',
};

function listEvidence(items: Evidence[], max = 5): string {
  return items.slice(0, max).map((e) => `${e.detail} (${e.file})`).join('; ');
}

/**
 * #3424: TF-01 signal text, evidence and verdict from the collected config
 * evidence. When `.env.example` is the evidence and nothing counts against
 * it, the pre-#3424 signal is emitted unchanged (Node behaviour preserved).
 */
export function buildTf01(
  ev: ConfigEvidence | null,
  hasEnvExample: boolean,
  envRelPath: string,
): { verdict: Tf01Verdict; derivation: string; evidence: string[]; note?: string } {
  if (!ev) {
    return {
      verdict: { status: 'unknown', severity: 'medium', confidence: 'low' },
      derivation: 'Source tree not available. Factor III (Config) compliance not determinable.',
      evidence: [],
    };
  }
  const verdict = scoreConfigEvidence(ev);
  const stacks = ev.stacks.length > 0 ? ev.stacks.map((s) => STACK_LABELS[s]).join(', ') : 'no recognised stack';
  const files = (items: Evidence[]): string[] => [...new Set(items.map((e) => e.file))];

  if (hasEnvExample && verdict.status === 'pass') {
    return {
      verdict,
      derivation: `.env.example present at ${envRelPath}. Runtime configuration externalised via environment variables. Factor III satisfied.`,
      evidence: [envRelPath],
    };
  }
  switch (verdict.status) {
    case 'fail':
      return {
        verdict,
        derivation: `Hard-coded configuration in packaged or deployment config (${stacks}): ${ev.hardCodedCount} literal value(s), ${listEvidence(ev.hardCoded)}${ev.hardCodedCount > 5 ? '; ...' : ''}. Values are not shown.${ev.positiveCount > 0 ? ` Externalisation evidence is also present: ${listEvidence(ev.positive, 3)}.` : ''} Move endpoints and credentials to environment variables, a ConfigMap / Secret or a secret store. Factor III (Config) not met.`,
        evidence: files(ev.hardCoded).slice(0, 10),
        note: 'Hard-coded endpoints or credentials in configuration',
      };
    case 'partial':
      return ev.positiveCount > 0
        ? {
          verdict,
          derivation: `Configuration externalised (${stacks}): ${listEvidence(ev.positive, 3)}.${ev.placeholderDefaults.length > 0 ? ` Placeholders carry literal endpoint defaults: ${listEvidence(ev.placeholderDefaults, 3)}; a missing variable silently falls back to a fixed host.` : ''}${ev.deploymentDefaultLiterals.length > 0 ? ` The chart default values or a ConfigMap hold literal endpoints: ${listEvidence(ev.deploymentDefaultLiterals, 3)}; move environment-specific hosts to per-environment values files or variables.` : ''} Factor III (Config) partially satisfied.`,
          evidence: files([...ev.positive.slice(0, 5), ...ev.placeholderDefaults.slice(0, 5), ...ev.deploymentDefaultLiterals.slice(0, 5)]),
          note: ev.placeholderDefaults.length > 0 ? 'Literal endpoint defaults inside placeholders' : 'Literal endpoints in default deployment configuration',
        }
        : {
          verdict,
          derivation: `Only supporting configuration evidence found (${stacks}): ${listEvidence(ev.supporting)}. No placeholder, environment read or ConfigMap / Secret reference confirms that runtime values come from the environment. Factor III (Config) partially satisfied.`,
          evidence: files(ev.supporting).slice(0, 8),
          note: 'Per-environment files without environment references',
        };
    case 'pass':
      return {
        verdict,
        derivation: `Configuration externalised (${stacks}): ${listEvidence(ev.positive)}${ev.positiveCount > 5 ? ` and ${ev.positiveCount - 5} more` : ''}.${ev.deploymentLiterals.length > 0 ? ` Deployment values hold environment-specific endpoints (${listEvidence(ev.deploymentLiterals, 3)}), which is where they belong.` : ''} No hard-coded endpoint or credential in packaged configuration. Factor III satisfied.`,
        evidence: files(ev.positive).slice(0, 10),
      };
    case 'unknown':
      return {
        verdict,
        derivation: `Factor III (Config) not determinable (${stacks}): no recognised externalisation evidence (.env.example, Spring placeholders or profiles, Helm .Values, Kubernetes ConfigMap / Secret references, environment reads in code) and no hard-coded endpoint or credential found in ${ev.filesChecked} file(s) checked.`,
        evidence: [],
        note: 'Config externalisation not determinable',
      };
  }
}
