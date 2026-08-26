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
import { findTfstateFiles, parseTfState, collectResourceTypes, extractSourceServices } from './tf-state-parser.js';
import {
  extractCloudNativeServices,
  mergeServiceMaps,
  findPulumiStateFiles,
  parsePulumiState,
  extractPulumiServices,
} from '@swao/module-iac';
import type { IaCResourceGraph } from '@swao/module-iac';

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

function detectFrameworks(deps: Record<string, string>): string[] {
  const out: string[] = [];
  if ('@nestjs/core' in deps || '@nestjs/common' in deps) out.push('NestJS');
  if ('@angular/core' in deps) out.push('Angular');
  if ('next' in deps) out.push('Next.js');
  if ('fastify' in deps) out.push('Fastify');
  if ('express' in deps) out.push('Express');
  if ('react' in deps && !('@angular/core' in deps) && !('next' in deps)) out.push('React');
  if ('nx' in deps || '@nx/workspace' in deps) out.push('Nx');
  return out;
}

// Detect non-Node.js languages from well-known manifest files.
// Returns a summary string for INV-01 and an array of detected language names.
function detectNonNodeLanguages(sourcePath: string): { detected: string[]; details: string } {
  const detected: string[] = [];
  const details: string[] = [];

  // Rust
  if (existsSync(join(sourcePath, 'Cargo.toml'))) {
    detected.push('Rust');
    try {
      const cargo = readFileSync(join(sourcePath, 'Cargo.toml'), 'utf-8');
      const nameM = cargo.match(/^\s*name\s*=\s*"([^"]+)"/m);
      const verM  = cargo.match(/^\s*version\s*=\s*"([^"]+)"/m);
      const edM   = cargo.match(/^\s*edition\s*=\s*"([^"]+)"/m);
      details.push(`Rust${nameM ? ' ('+nameM[1]+')' : ''}${verM ? ' v'+verM[1] : ''}${edM ? ' edition '+edM[1] : ''}`);
    } catch { details.push('Rust'); }
  }

  // Python
  if (existsSync(join(sourcePath, 'pyproject.toml')) ||
      existsSync(join(sourcePath, 'requirements.txt')) ||
      existsSync(join(sourcePath, 'setup.py'))) {
    detected.push('Python');
    details.push('Python (pyproject.toml / requirements.txt)');
  }

  // Go
  if (existsSync(join(sourcePath, 'go.mod'))) {
    detected.push('Go');
    try {
      const gomod = readFileSync(join(sourcePath, 'go.mod'), 'utf-8');
      const modM = gomod.match(/^module\s+(\S+)/m);
      details.push(`Go${modM ? ' ('+modM[1]+')' : ''}`);
    } catch { details.push('Go'); }
  }

  // Java / Kotlin (Maven or Gradle)
  if (existsSync(join(sourcePath, 'pom.xml'))) {
    detected.push('Java'); details.push('Java (Maven pom.xml)');
  } else if (existsSync(join(sourcePath, 'build.gradle')) ||
             existsSync(join(sourcePath, 'build.gradle.kts'))) {
    detected.push('Java/Kotlin'); details.push('Java/Kotlin (Gradle)');
  }

  // C# .NET
  const csprojFiles = existsSync(sourcePath) ? (() => {
    try { return readdirSync(sourcePath).some((f) => f.endsWith('.csproj') || f.endsWith('.sln')); }
    catch { return false; }
  })() : false;
  if (csprojFiles) { detected.push('C#'); details.push('C# (.NET .csproj/.sln)'); }

  // #1498: also detect TypeScript/Node.js in subdirectories (e.g. frontend/ within a Rust mono-repo).
  // Looks 2 levels deep for package.json so multi-language apps are correctly described.
  const subPkgJsonPath = findFirstMatchRecursive(sourcePath, 2, (n) => n === 'package.json');
  if (subPkgJsonPath) {
    const subDir = subPkgJsonPath.slice(sourcePath.length + 1).replace(/\\/g, '/').split('/')[0];
    if (!detected.includes('TypeScript') && !detected.includes('Node.js')) {
      detected.push('TypeScript');
      details.push(`TypeScript/Node.js (${subDir}/package.json)`);
    }
  }

  return { detected, details: details.join(', ') };
}

export async function runInvPass(ctx: PassContext): Promise<PassResult> {
  const { sourcePath, workspacePath, iter, assessedAt } = ctx;
  const signals: Signal[] = [];
  const assessment: Record<string, unknown> = {};

  // --- INV-01: language, framework, version ---
  const pkg = readJson(join(sourcePath, 'package.json'));
  if (pkg) {
    const deps = allDeps(pkg);
    const isTs = existsSync(join(sourcePath, 'tsconfig.json')) || 'typescript' in deps;
    const frameworks = detectFrameworks(deps);
    const version = typeof pkg.version === 'string' ? pkg.version : 'unknown';
    const nodeConstraint = (pkg.engines as Record<string, string> | undefined)?.node ?? 'unspecified';

    assessment.language = isTs ? 'typescript' : 'javascript';
    assessment.framework = frameworks;
    assessment.app_version = version;
    assessment.node_version_constraint = nodeConstraint;

    signals.push({
      id: 'INV-01',
      source: 'static_analysis',
      category: 'application',
      severity: 'informational',
      derivation: `Language: ${isTs ? 'TypeScript' : 'JavaScript'}. Frameworks: ${frameworks.join(', ') || 'none detected'}. Version: ${version}. Node: ${nodeConstraint}.`,
      evidence: ['package.json'],
      confidence: 'high',
    });

    // --- INV-02: DB engine from package.json / prisma schema ---
    const prisma = readFileSync_safe(join(sourcePath, 'prisma', 'schema.prisma'));
    const dbFromPrisma = prisma ? extractPrismaProvider(prisma) : null;
    const hasMongoose = 'mongoose' in deps || 'mongodb' in deps;
    const hasPrisma = '@prisma/client' in deps || 'prisma' in deps;

    if (dbFromPrisma || hasPrisma || hasMongoose) {
      const dbEngine = dbFromPrisma ?? (hasMongoose ? 'mongodb' : 'unknown');
      const orm = hasPrisma ? 'prisma' : hasMongoose ? 'mongoose' : 'unknown';
      assessment.database_engine = dbEngine;
      assessment.orm = orm;
      const dbImplies = ['postgresql', 'mysql', 'mongodb'].includes(dbEngine)
        ? [`service_dep:${dbEngine}`]
        : [];
      signals.push({
        id: 'INV-02',
        source: 'static_analysis',
        category: 'application',
        severity: 'informational',
        derivation: `Primary database engine: ${dbEngine}. ORM: ${orm}.`,
        evidence: prisma
          ? ['prisma/schema.prisma']
          : ['package.json'],
        confidence: 'high',
        implies: dbImplies.length > 0 ? dbImplies : undefined,
      });
    }

    // --- INV-03: Redis / queue detection ---
    const hasRedis =
      '@keyv/redis' in deps ||
      'ioredis' in deps ||
      'redis' in deps;
    const hasBull = 'bull' in deps || '@nestjs/bull' in deps || 'bullmq' in deps;
    if (hasRedis || hasBull) {
      assessment.cache_engine = hasRedis ? 'redis' : null;
      assessment.queue_engine = hasBull ? 'bull' : null;
      signals.push({
        id: 'INV-03',
        source: 'static_analysis',
        category: 'infrastructure_platform',
        severity: 'informational',
        derivation: `Cache: ${hasRedis ? 'Redis' : 'none detected'}. Queue: ${hasBull ? 'Bull/BullMQ' : 'none detected'}.`,
        evidence: ['package.json'],
        confidence: 'high',
        implies: hasRedis ? ['STATE-02', 'service_dep:redis'] : ['STATE-02'],
      });
    }

    // --- INV-04: app version EOL / maintenance status ---
    assessment.node_eol_status = deriveNodeEol(nodeConstraint);
    signals.push({
      id: 'INV-04',
      source: 'static_analysis',
      category: 'application',
      severity: 'informational',
      derivation: `App version ${version}. Node constraint: ${nodeConstraint}. EOL status: ${assessment.node_eol_status as string}.`,
      evidence: ['package.json'],
      confidence: version !== 'unknown' ? 'high' : 'low',
    });
  }

  // --- INV-05: container runtime from docker-compose / Dockerfile (#1498: recursive) ---
  // Search 3 levels deep so compose files in ops/, deploy/, docker/ subdirs are found.
  const composeFilePath = findFirstMatchRecursive(sourcePath, 3, (n) =>
    /^docker-compose.*\.(ya?ml)$/.test(n) || /^compose.*\.(ya?ml)$/.test(n),
  );
  const dockerfilePath = findFirstMatchRecursive(sourcePath, 3, (n) =>
    n === 'Dockerfile' || n.startsWith('Dockerfile.'),
  );
  const hasCompose = composeFilePath !== null;
  const hasDockerfile = dockerfilePath !== null;
  const hasK8s = existsSync(join(sourcePath, 'k8s')) || existsSync(join(sourcePath, 'helm'));
  const composeContent = composeFilePath ? readFileSync_safe(composeFilePath) : null;
  const serviceCount = composeContent ? countComposeServices(composeContent) : 0;
  const composeRelPath = composeFilePath ? composeFilePath.slice(sourcePath.length + 1).replace(/\\/g, '/') : null;
  const dockerfileRelPath = dockerfilePath ? dockerfilePath.slice(sourcePath.length + 1).replace(/\\/g, '/') : null;

  const hasContainer = hasCompose || hasDockerfile;
  assessment.runtime_type = hasK8s ? 'kubernetes' : hasContainer ? 'container' : 'unknown';
  assessment.docker_compose = hasCompose;
  assessment.dockerfile = hasDockerfile;
  assessment.k8s_manifests = hasK8s;
  assessment.compose_service_count = serviceCount;

  signals.push({
    id: 'INV-05',
    source: 'static_analysis',
    category: 'infrastructure_platform',
    severity: hasK8s ? 'informational' : hasContainer ? 'medium' : 'high',
    derivation: hasK8s
      ? `Kubernetes manifests found. Cloud-native deployment pattern.`
      : hasCompose
        ? `Docker Compose with ${serviceCount} service(s) found at ${composeRelPath}.${hasDockerfile ? ` Dockerfile at ${dockerfileRelPath}.` : ''} No Kubernetes manifests.`
        : hasDockerfile
          ? `Dockerfile found at ${dockerfileRelPath}. No Compose or Kubernetes manifests.`
          : `No container config found. Deployment type unknown.`,
    evidence: [
      ...(composeRelPath ? [composeRelPath] : []),
      ...(dockerfileRelPath && !hasCompose ? [dockerfileRelPath] : []),
      ...(hasK8s ? ['k8s/'] : []),
    ],
    confidence: hasContainer || hasK8s ? 'high' : 'low',
    implies: hasContainer && !hasK8s ? ['STATE-04'] : undefined,
  });

  // --- INV-00: non-Node.js language detection ---
  // Runs regardless of whether package.json was found.
  // Produces an informational signal for the LLM passes so they know
  // the source language even when static analysis is limited.
  if (!pkg) {
    const { detected, details } = detectNonNodeLanguages(sourcePath);
    if (detected.length > 0) {
      assessment.language = detected[0].toLowerCase();
      assessment.detected_languages = detected;
      signals.push({
        id: 'INV-01',
        source: 'static_analysis',
        category: 'application',
        severity: 'informational',
        derivation: `Language detected: ${details}. Note: full static analysis (framework detection, SBOM, crypto pattern matching) is only available for Node.js/TypeScript. LLM-based passes (CTX, SYNTH, COMP) will read and reason over source files in any language.`,
        evidence: [
          existsSync(join(sourcePath, 'Cargo.toml')) ? 'Cargo.toml' : '',
          existsSync(join(sourcePath, 'go.mod')) ? 'go.mod' : '',
          existsSync(join(sourcePath, 'pyproject.toml')) ? 'pyproject.toml' : '',
          existsSync(join(sourcePath, 'requirements.txt')) ? 'requirements.txt' : '',
          existsSync(join(sourcePath, 'pom.xml')) ? 'pom.xml' : '',
        ].filter(Boolean),
        confidence: 'high',
        outcome: 'neutral',
      });

      // #0660: extract service_dep signals from Cargo.toml (Rust workspaces)
      // INV-10..INV-99 reserved for service_dep signals; service name carried
      // in derivation + implies so the ID only needs to be a valid INV-NN.
      const cargoContent = readFileSync_safe(join(sourcePath, 'Cargo.toml'));
      if (cargoContent && detected.includes('Rust')) {
        const cargoDeps = extractCargoServiceDeps(cargoContent);
        const seen = new Set<string>();
        let serviceDepIdx = 10;
        for (const { service, note } of cargoDeps) {
          if (seen.has(service)) continue;
          seen.add(service);
          signals.push({
            id: `INV-${String(serviceDepIdx++).padStart(2, '0')}`,
            source: 'static_analysis',
            category: 'application',
            severity: 'informational',
            derivation: `Rust project requires ${service} (detected via ${note} in Cargo.toml).`,
            evidence: ['Cargo.toml'],
            confidence: 'high',
            implies: [`service_dep:${service}`],
          });
        }
      }
    } else {
      // No language indicator at all -- warn
      signals.push({
        id: 'INV-00',
        source: 'static_analysis',
        category: 'application',
        severity: 'high',
        derivation: 'No source language indicator found (no package.json, Cargo.toml, go.mod, pyproject.toml, pom.xml). Source directory may be empty or the project root is in a subdirectory. Static passes cannot analyse without source code. Set source.vcs.url or source.path in .swao.yml to the correct application root.',
        evidence: [],
        confidence: 'high',
        outcome: 'negative',
      });
    }
  }

  // --- INV-10+ / INV-06: Terraform state detection + HCL guidance ---
  // Reads wsp/inputs/terraform/*.tfstate (ingestion folder) and *.tfstate at source root.
  // Emits service_dep signals for services not already covered by source-code analysis.
  // INV-06: guidance signal when .tf HCL files are present but no state file is available.
  {
    const tfFiles = findTfstateFiles(workspacePath, sourcePath);

    const hasTfHcl = existsSync(sourcePath) && (() => {
      try { return readdirSync(sourcePath).some((f) => f.endsWith('.tf')); }
      catch { return false; }
    })();

    if (tfFiles.length === 0 && hasTfHcl) {
      signals.push({
        id: 'INV-06',
        source: 'static_analysis',
        category: 'infrastructure_platform',
        severity: 'informational',
        derivation: 'Terraform HCL (.tf) files found in source tree but no JSON state file is available. Run `terraform show -json > terraform.tfstate` and place the output in wsp/inputs/terraform/ for automated service dependency detection.',
        evidence: ['.tf'],
        confidence: 'high',
      });
    } else if (tfFiles.length > 0) {
      const alreadyDetected = new Set(
        signals
          .flatMap((s) => s.implies ?? [])
          .filter((tag) => tag.startsWith('service_dep:'))
          .map((tag) => tag.slice('service_dep:'.length)),
      );

      const usedInvNums = signals
        .map((s) => s.id.match(/^INV-(\d{2})$/)?.[1])
        .filter((n): n is string => n !== undefined)
        .map(Number)
        .filter((n) => n >= 10);
      let nextIdx = usedInvNums.length > 0 ? Math.max(...usedInvNums) + 1 : 10;

      const states = tfFiles.map(parseTfState);
      const byType = collectResourceTypes(states);
      // Merge docker-image detection (source envs) + cloud-native resource type detection
      const tfServices = mergeServiceMaps(
        extractSourceServices(byType),
        extractCloudNativeServices(byType),
      );

      for (const [service, evidence] of tfServices) {
        if (alreadyDetected.has(service)) continue;
        if (nextIdx > 99) break;
        alreadyDetected.add(service);
        signals.push({
          id: `INV-${String(nextIdx++).padStart(2, '0')}`,
          source: 'static_analysis',
          category: 'infrastructure_platform',
          severity: 'informational',
          derivation: `Terraform/OpenTofu state declares ${service} (${evidence.join('; ')}). Service detected from deployed infrastructure.`,
          evidence: tfFiles.map((f) => f.split(/[\\/]/).pop() ?? f),
          confidence: 'high',
          implies: [`service_dep:${service}`],
        });
      }
    }
  }

  // --- INV Pulumi state detection ---
  // Reads wsp/inputs/pulumi/*.json (written by manual placement or #1322 Cloud API ingestion).
  {
    const pulumiFiles = findPulumiStateFiles(workspacePath);
    if (pulumiFiles.length > 0) {
      const alreadyDetected = new Set(
        signals
          .flatMap((s) => s.implies ?? [])
          .filter((tag) => tag.startsWith('service_dep:'))
          .map((tag) => tag.slice('service_dep:'.length)),
      );

      const usedInvNums = signals
        .map((s) => s.id.match(/^INV-(\d{2})$/)?.[1])
        .filter((n): n is string => n !== undefined)
        .map(Number)
        .filter((n) => n >= 10);
      let nextIdx = usedInvNums.length > 0 ? Math.max(...usedInvNums) + 1 : 10;

      const pulumiGraph: IaCResourceGraph = {
        toolchain: 'pulumi',
        formatVersion: '3',
        resources: pulumiFiles.flatMap((f) => parsePulumiState(f).resources),
      };
      const pulumiServices = extractPulumiServices(pulumiGraph);

      for (const [service, evidence] of pulumiServices) {
        if (alreadyDetected.has(service)) continue;
        if (nextIdx > 99) break;
        alreadyDetected.add(service);
        signals.push({
          id: `INV-${String(nextIdx++).padStart(2, '0')}`,
          source: 'static_analysis',
          category: 'infrastructure_platform',
          severity: 'informational',
          derivation: `Pulumi state declares ${service} (${evidence.join('; ')}). Service detected from deployed infrastructure.`,
          evidence: pulumiFiles.map((f) => f.split(/[\\/]/).pop() ?? f),
          confidence: 'high',
          implies: [`service_dep:${service}`],
        });
      }
    }
  }

  return {
    pass: {
      id: 1,
      name: 'inventory',
      signal_prefix: 'INV',
      status: 'complete',
      iter,
      assessed_at: assessedAt,
    },
    signals,
    assessment,
  };
}

// #1498: search up to maxDepth levels for a file matching the predicate.
// Returns the file path relative to root, or null. BFS order -- shallowest wins.
function findFirstMatchRecursive(
  root: string,
  maxDepth: number,
  test: (name: string, fullPath: string) => boolean,
): string | null {
  const queue: Array<[string, number]> = [[root, 0]];
  while (queue.length > 0) {
    const [dir, depth] = queue.shift()!;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isFile() && test(e.name, full)) return full;
      if (e.isDirectory() && depth < maxDepth) queue.push([full, depth + 1]);
    }
  }
  return null;
}

function readFileSync_safe(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function extractPrismaProvider(content: string): string | null {
  const match = content.match(/provider\s*=\s*"([^"]+)"/);
  return match ? match[1] : null;
}

// #0660: extract service_dep capabilities from Cargo.toml / Cargo.lock for
// Rust workspaces.  Sovereign-health uses sqlx+postgres and would otherwise
// report 0 required-services in the LZ fit because pass-01 only parsed
// Node.js deps.
function extractCargoServiceDeps(cargoToml: string): Array<{ service: string; note: string }> {
  const deps: Array<{ service: string; note: string }> = [];

  // sqlx with postgres/mysql/sqlite feature
  const sqlxM = cargoToml.match(/sqlx\s*=\s*\{[^}]*features\s*=\s*\[([^\]]*)\]/s);
  if (sqlxM) {
    const feats = sqlxM[1] ?? '';
    if (/["']postgres["']/.test(feats)) deps.push({ service: 'postgresql', note: 'sqlx+postgres feature' });
    else if (/["']mysql["']/.test(feats))    deps.push({ service: 'mysql',      note: 'sqlx+mysql feature' });
    else if (/["']sqlite["']/.test(feats))   deps.push({ service: 'sqlite',     note: 'sqlx+sqlite feature' });
  }
  // diesel ORM
  if (/diesel\s*=/.test(cargoToml)) {
    const dieselM = cargoToml.match(/diesel\s*=\s*\{[^}]*features\s*=\s*\[([^\]]*)\]/s);
    if (dieselM) {
      const feats = dieselM[1] ?? '';
      if (/["']postgres["']/.test(feats)) deps.push({ service: 'postgresql', note: 'diesel+postgres feature' });
      else if (/["']mysql["']/.test(feats))  deps.push({ service: 'mysql',   note: 'diesel+mysql feature'  });
      else if (/["']sqlite["']/.test(feats)) deps.push({ service: 'sqlite',  note: 'diesel+sqlite feature' });
    }
  }
  // sea-orm
  const seaM = cargoToml.match(/sea-orm\s*=\s*\{[^}]*features\s*=\s*\[([^\]]*)\]/s);
  if (seaM) {
    const feats = seaM[1] ?? '';
    if (/["']sqlx-postgres["']/.test(feats)) deps.push({ service: 'postgresql', note: 'sea-orm+sqlx-postgres' });
    else if (/["']sqlx-mysql["']/.test(feats)) deps.push({ service: 'mysql', note: 'sea-orm+sqlx-mysql' });
  }
  // redis crates
  if (/\b(redis|fred|deadpool-redis)\s*=/.test(cargoToml)) {
    deps.push({ service: 'redis', note: 'redis/fred/deadpool-redis crate' });
  }
  // mongodb
  if (/\b(mongodb)\s*=/.test(cargoToml)) {
    deps.push({ service: 'mongodb', note: 'mongodb crate' });
  }
  return deps;
}

function countComposeServices(content: string): number {
  const matches = content.match(/^\s{0,2}\w[\w-]*:/gm) ?? [];
  return Math.max(0, matches.filter((l) => !l.trim().startsWith('#')).length - 1);
}

function deriveNodeEol(constraint: string): string {
  if (constraint === 'unspecified') return 'unknown';
  const major = parseInt(constraint.replace(/^[^0-9]*/, ''), 10);
  if (isNaN(major)) return 'unknown';
  if (major >= 22) return 'active_lts';
  if (major >= 20) return 'maintenance_lts';
  return 'eol';
}
