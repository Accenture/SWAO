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
import { load } from 'js-yaml';
import type { PassContext, PassResult } from '@swao/core';
import type { Signal } from '@swao/core';
import { logPortfolio } from '@swao/core';
import { TerraformOpenTofuProvider } from '@swao/module-iac';

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

// #1501: search up to maxDepth levels for a file matching the predicate (BFS, shallowest wins).
function findFileRecursive(
  root: string,
  maxDepth: number,
  test: (name: string) => boolean,
): string | null {
  const queue: Array<[string, number]> = [[root, 0]];
  while (queue.length > 0) {
    const [dir, depth] = queue.shift()!;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory() && e.name.startsWith('.')) continue;
      if (e.isFile() && test(e.name)) return join(dir, e.name);
      if (e.isDirectory() && depth < maxDepth) queue.push([join(dir, e.name), depth + 1]);
    }
  }
  return null;
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

  // Search recursively for config/compose files so subdirectory layouts are found (#1499/#1501).
  const envExamplePath = findFileRecursive(sourcePath, 3, (n) => n === '.env.example');
  const envExample = envExamplePath ? readFileSync_safe(envExamplePath) : null;
  const composePath = findFileRecursive(sourcePath, 3, (n) =>
    /^docker-compose.*\.(ya?ml)$/.test(n) || /^compose.*\.(ya?ml)$/.test(n),
  );
  const composeContent = composePath ? readFileSync_safe(composePath) : null;
  const hasK8s = existsSync(join(sourcePath, 'k8s')) || existsSync(join(sourcePath, 'helm'));

  // --- TF-01: Factor III -- Config (env vars) ---
  const hasEnvExample = envExample !== null && envExample.trim().length > 0;
  const envRelPath = envExamplePath ? envExamplePath.slice(sourcePath.length + 1).replace(/\\/g, '/') : '.env.example';
  const factorIiiStatus = hasEnvExample ? 'pass' : 'fail';
  factorScores.push({ factor: 'III (Config)', status: factorIiiStatus });

  signals.push({
    id: 'TF-01',
    source: 'static_analysis',
    category: 'application',
    severity: hasEnvExample ? 'positive' : 'high',
    derivation: hasEnvExample
      ? `.env.example present at ${envRelPath}. Runtime configuration externalised via environment variables. Factor III satisfied.`
      : `.env.example not found. Cannot confirm Factor III (Config) compliance. Hard-coded config risk.`,
    evidence: hasEnvExample ? [envRelPath] : [],
    confidence: 'high',
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
  } else {
    factorXiStatus = 'unknown';
    tf04Severity = 'informational';
    tf04Evidence = [];
    tf04Derivation = `Language not Node.js or Rust -- structured logging check not performed for this stack. Factor XI status unknown.`;
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
  const factorIxStatus = hasHealthEndpoint ? 'partial' : 'unknown';
  factorScores.push({
    factor: 'IX (Disposability)',
    status: factorIxStatus,
    note: 'Health check present; shutdown hooks unconfirmed',
  });

  signals.push({
    id: 'TF-05',
    source: 'static_analysis',
    category: 'application',
    severity: 'low',
    derivation: hasHealthEndpoint
      ? `Health endpoint detected${healthRelPath ? ` at ${healthRelPath}` : ''}. Disposability (Factor IX) partially satisfied. Graceful SIGTERM shutdown hooks not confirmed from static analysis.`
      : `No health endpoint detected from static analysis. Factor IX (Disposability) status unknown.`,
    evidence: healthRelPath ? [healthRelPath] : hasHealthEndpoint ? ['src/health/'] : [],
    confidence: hasHealthEndpoint ? 'medium' : 'low',
  });

  // design 085 SS9, #1327: IaC security scanner stub.
  // runs checkov/kics when .tf source files exist in sourcePath.
  // findings emitted as informational signals; not yet scored (sprint-111 scope).
  try {
    const hasTfSource = existsSync(sourcePath) &&
      readdirSync(sourcePath).some((e) => e.endsWith('.tf'));
    if (hasTfSource) {
      const iacProvider = new TerraformOpenTofuProvider();
      logPortfolio('info', 'pass.iac.scanner.start', 'IaC static scan starting', {
        context: { source_path: sourcePath, pass: 'tf' },
      });
      const iacFindings = await iacProvider.scanSource({ sourceFiles: [join(sourcePath, 'main.tf')] });
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
    },
  };
}
