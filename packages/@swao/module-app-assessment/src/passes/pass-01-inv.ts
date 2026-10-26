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
import { listSourceFiles, findShallowestSourceFile, computeLanguageCensus, manifestKindInfo, productionLoc } from '@swao/core';
import type { BuildManifest, LanguageCensus, LanguageCoverage, SourceLanguage } from '@swao/core';
import { buildLanguageCoverage } from './language-coverage.js';
import { findTfstateFiles, parseTfState, collectResourceTypes, extractSourceServices } from './tf-state-parser.js';
import {
  extractCloudNativeServices,
  mergeServiceMaps,
  findPulumiStateFiles,
  parsePulumiState,
  extractPulumiServices,
} from '@swao/module-iac-scan';
import type { IaCResourceGraph } from '@swao/module-iac-scan';
import { runInvReferenceScans, collectDependencyInventory, type DependencyInventory } from './inv-reference-scans.js';
import { deriveServiceFootprint, serviceFootprintSignals } from './service-footprint.js';
import { loadServiceFootprintCatalogue } from '../catalogue/service-footprint-catalogue.js';
import { readWorkspaceInfraRoles, resolveInfraRoleForFile } from './infra-input-role.js';

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

// #3423: languages from the build manifests at any depth inside the source
// scope (before #3423 only the source root was checked, so a Java service
// under service/pom.xml next to systemtest/package.json was reported as
// "TypeScript/Node.js"). Production manifests come first; test-only
// manifests (e.g. systemtest/package.json) count only when there is no
// production manifest. Languages are ordered by production LOC from the
// census, so the primary language (assessment.language) is the one with the
// most production code. Without any manifest the census languages are used.
function manifestLanguage(m: BuildManifest, census: LanguageCensus): SourceLanguage {
  const candidates = manifestKindInfo(m.kind).languages;
  let best: SourceLanguage = candidates[0] as SourceLanguage;
  let bestLoc = -1;
  for (const c of candidates) {
    const row = census.languages.find((r) => r.language === c);
    if (row && row.loc > bestLoc) { best = c; bestLoc = row.loc; }
  }
  return best;
}

function manifestDetail(sourcePath: string, m: BuildManifest, lang: SourceLanguage): string {
  const where = m.path;
  switch (m.kind) {
    case 'cargo': {
      const cargo = readFileSync_safe(join(sourcePath, ...m.path.split('/')));
      if (!cargo) return `Rust (${where})`;
      const nameM = cargo.match(/^\s*name\s*=\s*"([^"]+)"/m);
      const verM  = cargo.match(/^\s*version\s*=\s*"([^"]+)"/m);
      const edM   = cargo.match(/^\s*edition\s*=\s*"([^"]+)"/m);
      return `Rust${nameM ? ' ('+nameM[1]+')' : ''}${verM ? ' v'+verM[1] : ''}${edM ? ' edition '+edM[1] : ''} (${where})`;
    }
    case 'go': {
      const gomod = readFileSync_safe(join(sourcePath, ...m.path.split('/')));
      const modM = gomod?.match(/^module\s+(\S+)/m);
      return `Go${modM ? ' ('+modM[1]+')' : ''} (${where})`;
    }
    case 'maven': return `${lang} (Maven ${where})`;
    case 'gradle': return `${lang} (Gradle ${where})`;
    case 'sbt': return `${lang} (sbt ${where})`;
    case 'npm': return `${lang}/Node.js (${where})`;
    case 'python': return `Python (${where})`;
    case 'dotnet': return `${lang} (.NET ${where})`;
    case 'bundler': return `Ruby (${where})`;
    case 'composer': return `PHP (${where})`;
    default: {
      const never: never = m.kind;
      return never;
    }
  }
}

function detectNonNodeLanguages(
  sourcePath: string,
  census: LanguageCensus,
): { detected: SourceLanguage[]; details: string; evidence: string[] } {
  const prodManifests = census.manifests.filter((m) => !m.is_test);
  const manifests = prodManifests.length > 0 ? prodManifests : census.manifests;
  const byLang = new Map<SourceLanguage, string[]>();
  const evidence: string[] = [];
  for (const m of manifests) {
    const lang = manifestLanguage(m, census);
    const list = byLang.get(lang) ?? [];
    // Up to three manifests named per language; evidence is capped at ten paths.
    if (list.length < 3) list.push(manifestDetail(sourcePath, m, lang) + (m.is_test ? ' [test code]' : ''));
    byLang.set(lang, list);
    if (evidence.length < 10) evidence.push(m.path);
  }
  if (byLang.size === 0) {
    // No build manifest: fall back to the languages the census counted.
    const anyProd = census.languages.some((r) => productionLoc(r) > 0);
    for (const r of census.languages) {
      if (!anyProd || productionLoc(r) > 0) {
        byLang.set(r.language, [`${r.language} (${r.files} file${r.files === 1 ? '' : 's'}, no build manifest)`]);
      }
    }
  }
  const prodLoc = (l: SourceLanguage): number => {
    const row = census.languages.find((r) => r.language === l);
    return row ? productionLoc(row) : 0;
  };
  // Stable: equal LOC keeps manifest order (shallowest first).
  const detected = [...byLang.keys()]
    .map((l, i) => ({ l, i }))
    .sort((a, b) => prodLoc(b.l) - prodLoc(a.l) || a.i - b.i)
    .map((x) => x.l);
  const details = detected.flatMap((l) => byLang.get(l) ?? []).join(', ');
  return { detected, details, evidence };
}

/** #3423: census summary, e.g. "Java 79,534 LOC (test 8,120; 812 files), TypeScript 13,443 LOC (...)". */
function censusLine(census: LanguageCensus, max = 6): string {
  const fmt = (n: number): string => n.toLocaleString('en-GB');
  const parts = census.languages.slice(0, max).map((r) =>
    `${r.language} ${fmt(r.loc)} LOC (${r.loc_test > 0 ? `test ${fmt(r.loc_test)}; ` : ''}${fmt(r.files)} file${r.files === 1 ? '' : 's'})`);
  if (census.languages.length > max) parts.push(`${census.languages.length - max} more`);
  return parts.join(', ');
}

/** Highest INV number used for service_dep signals (#3423: INV-90 and INV-91 are fixed). */
const INV_SERVICE_DEP_MAX = 89;

/** #3423: production build manifests other than the root package.json (polyglot repos), for the Node INV-01. */
function otherManifestsNote(sourcePath: string, census: LanguageCensus): string {
  const others = census.manifests.filter((m) => !m.is_test && m.path !== 'package.json' && m.kind !== 'npm');
  if (others.length === 0) return '';
  const named = others.slice(0, 5).map((m) => manifestDetail(sourcePath, m, manifestLanguage(m, census)));
  return ` Further build manifests: ${named.join(', ')}${others.length > 5 ? `, ${others.length - 5} more` : ''}.`;
}

/**
 * #3423: INV-90 (informational) carries the language census; INV-91 (medium,
 * negative) warns when more than LANGUAGE_COVERAGE_WARNING_SHARE of the
 * production lines are in languages no deterministic code-analysis pass reads.
 */
function languageSignals(census: LanguageCensus, coverage: LanguageCoverage): Signal[] {
  if (census.languages.length === 0) return [];
  const out: Signal[] = [];
  const prodTotal = census.total_loc - census.total_loc_test;
  const excluded = [
    census.files_generated_excluded > 0 ? `${census.files_generated_excluded} generated or minified file(s)` : '',
    census.files_too_large > 0 ? `${census.files_too_large} file(s) above 2 MB` : '',
  ].filter(Boolean).join(' and ');
  out.push({
    id: 'INV-90',
    source: 'static_analysis',
    category: 'application',
    severity: 'informational',
    derivation: `Language census (non-blank lines, test code tagged by the source scope): ${censusLine(census)}. Total ${census.total_loc.toLocaleString('en-GB')} LOC, of which ${prodTotal.toLocaleString('en-GB')} production and ${census.total_loc_test.toLocaleString('en-GB')} test.${excluded ? ` Excluded: ${excluded}.` : ''}${coverage.dominant_language ? ` Dominant language: ${coverage.dominant_language}.` : ''}`,
    evidence: census.manifests.slice(0, 10).map((m) => m.path),
    confidence: 'high',
    outcome: 'neutral',
  });
  if (coverage.warning) {
    const uncovered = coverage.rows.filter((r) => !r.has_deterministic).map((r) => r.language);
    const pct = Math.round(coverage.uncovered_loc_share * 100);
    out.push({
      id: 'INV-91',
      source: 'static_analysis',
      category: 'application',
      severity: 'medium',
      derivation: `${pct}% of the production code is in ${uncovered.join(', ')}, which no rule-based code-analysis pass (state, data, sbom, tf, egr, crypto) reads. Apart from the language-independent secret scan, SWAO analyses this code only where an LLM prompt includes it (see the LLM cells of the language coverage matrix) or not at all; absence of a finding is not evidence of absence. Plan a manual or tool-based review of this code.`,
      evidence: census.manifests.filter((m) => !m.is_test).slice(0, 10).map((m) => m.path),
      confidence: 'high',
      outcome: 'negative',
    });
  }
  return out;
}

export async function runInvPass(ctx: PassContext): Promise<PassResult> {
  const { sourcePath, workspacePath, iter, assessedAt } = ctx;
  const signals: Signal[] = [];
  const assessment: Record<string, unknown> = {};

  // #3423: language census and build manifests at any depth (central source scope).
  const census: LanguageCensus = existsSync(sourcePath)
    ? computeLanguageCensus(sourcePath)
    : { method: 'non_blank_lines', total_files: 0, total_loc: 0, total_loc_test: 0, files_generated_excluded: 0, files_too_large: 0, languages: [], manifests: [], manifests_total: 0 };
  const coverage: LanguageCoverage = buildLanguageCoverage(census);
  assessment.language_census = census;
  assessment.language_coverage = coverage;

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
      derivation: `Language: ${isTs ? 'TypeScript' : 'JavaScript'}. Frameworks: ${frameworks.join(', ') || 'none detected'}. Version: ${version}. Node: ${nodeConstraint}.${otherManifestsNote(sourcePath, census)}`,
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
    const { detected, details, evidence } = detectNonNodeLanguages(sourcePath, census);
    if (detected.length > 0) {
      assessment.language = (detected[0] as string).toLowerCase();
      assessment.detected_languages = detected;
      signals.push({
        id: 'INV-01',
        source: 'static_analysis',
        category: 'application',
        severity: 'informational',
        derivation: `Language detected: ${details}. Note: deterministic coverage differs per language (see the language coverage matrix, INV-90); LLM-based passes (CTX, SYNTH, COMP) read and reason over source files in any language.`,
        // #3423: the manifests found at any depth (e.g. service/pom.xml).
        evidence,
        confidence: 'high',
        outcome: 'neutral',
      });

      // #0660: extract service_dep signals from Cargo.toml (Rust workspaces)
      // INV-10..INV-89 reserved for service_dep signals (#3423: INV-90/91 are the
      // language census and coverage warning); service name carried
      // in derivation + implies so the ID only needs to be a valid INV-NN.
      // #2945: also scan member-crate Cargo.toml files one level deep when the
      // root file is a [workspace] manifest (no direct deps in workspace root).
      const cargoContent = readFileSync_safe(join(sourcePath, 'Cargo.toml'));
      if (cargoContent && detected.includes('Rust')) {
        const allCargoContents: Array<{ content: string; relPath: string }> = [
          { content: cargoContent, relPath: 'Cargo.toml' },
        ];
        if (/^\[workspace\]/m.test(cargoContent)) {
          const membersM = cargoContent.match(/\bmembers\s*=\s*\[([^\]]*)\]/s);
          if (membersM) {
            const memberPaths = (membersM[1] ?? '')
              .match(/"([^"]+)"|'([^']+)'/g)
              ?.map((q) => q.replace(/["']/g, '')) ?? [];
            for (const member of memberPaths) {
              const memberCargoPath = join(sourcePath, member, 'Cargo.toml');
              const memberContent = readFileSync_safe(memberCargoPath);
              if (memberContent) {
                allCargoContents.push({ content: memberContent, relPath: `${member}/Cargo.toml` });
              }
            }
          }
        }
        const seen = new Set<string>();
        let serviceDepIdx = 10;
        for (const { content, relPath } of allCargoContents) {
          for (const { service, note } of extractCargoServiceDeps(content)) {
            if (seen.has(service)) continue;
            if (serviceDepIdx > INV_SERVICE_DEP_MAX) break;
            seen.add(service);
            signals.push({
              id: `INV-${String(serviceDepIdx++).padStart(2, '0')}`,
              source: 'static_analysis',
              category: 'application',
              severity: 'informational',
              derivation: `Rust project requires ${service} (detected via ${note} in ${relPath}).`,
              evidence: [relPath],
              confidence: 'high',
              implies: [`service_dep:${service}`],
            });
          }
        }
      }
    } else {
      // No language indicator at all -- warn
      signals.push({
        id: 'INV-00',
        source: 'static_analysis',
        category: 'application',
        severity: 'high',
        derivation: 'No source language indicator found (no build manifest such as package.json, pom.xml, build.gradle, go.mod, Cargo.toml, pyproject.toml or *.csproj at any depth, and no source file in a recognised language). Source directory may be empty or point at the wrong folder. Static passes cannot analyse without source code. Set source.vcs.url or source.path in .swao.yml to the correct application root.',
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
  // #3429: only CURRENT infrastructure describes the app's own services. A state
  // file declared target (context.infra_roles or infra/target/) feeds LZR only.
  const infraRoles = readWorkspaceInfraRoles(workspacePath);
  const isCurrentInfra = (f: string): boolean => resolveInfraRoleForFile(f, workspacePath, infraRoles) !== 'target';
  {
    const tfFiles = findTfstateFiles(workspacePath, sourcePath).filter(isCurrentInfra);

    const hasTfHcl = existsSync(sourcePath)
      && listSourceFiles(sourcePath, { purpose: 'config', maxDepth: 0 }).some((f) => f.name.endsWith('.tf'));

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
        .filter((n) => n >= 10 && n <= INV_SERVICE_DEP_MAX);
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
        if (nextIdx > INV_SERVICE_DEP_MAX) break;
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
    const pulumiFiles = findPulumiStateFiles(workspacePath).filter(isCurrentInfra);
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
        .filter((n) => n >= 10 && n <= INV_SERVICE_DEP_MAX);
      let nextIdx = usedInvNums.length > 0 ? Math.max(...usedInvNums) + 1 : 10;

      const pulumiGraph: IaCResourceGraph = {
        toolchain: 'pulumi',
        formatVersion: '3',
        resources: pulumiFiles.flatMap((f) => parsePulumiState(f).resources),
      };
      const pulumiServices = extractPulumiServices(pulumiGraph);

      for (const [service, evidence] of pulumiServices) {
        if (alreadyDetected.has(service)) continue;
        if (nextIdx > INV_SERVICE_DEP_MAX) break;
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

  // --- INV-07 / INV-08 / INV-09: reference catalogue scans (#3160) ---
  // db-compatibility-catalogue.yaml (INV-07), legacy-indicators-catalogue.yaml
  // (INV-08) and vendor-sdk-catalogue.yaml (INV-09) are matched against the
  // manifests, container images and file names of the source tree. A scan
  // failure never fails the pass; it is recorded in the assessment block.
  // #3430: one dependency inventory for the reference scans and the service footprint.
  let inventory: DependencyInventory | undefined;
  try {
    inventory = collectDependencyInventory(sourcePath);
    const ref = runInvReferenceScans({
      sourcePath,
      priorSignals: signals,
      databaseEngine: typeof assessment.database_engine === 'string' ? assessment.database_engine : undefined,
      inventory,
    });
    signals.push(...ref.signals);
    Object.assign(assessment, ref.assessment);
  } catch (err) {
    assessment.reference_catalogue_checks = { error: (err as Error).message.split('\n')[0] };
  }

  // --- Service footprint (#3430): backing services from build files, compose,
  // Kubernetes, configuration, Liquibase changelogs and documents. Runs after
  // every other service_dep producer so their INV ids stay stable; emits
  // service_dep only for capabilities no earlier signal carries. A failure
  // never fails the pass; it is recorded in the assessment block.
  try {
    const cat = loadServiceFootprintCatalogue();
    if (!cat.ok) {
      assessment.service_footprint = { catalogue: `skipped: ${cat.reason}`, entries: [], files_scanned: {} };
    } else {
      const footprint = deriveServiceFootprint({
        sourcePath,
        workspacePath,
        inventory: inventory ?? collectDependencyInventory(sourcePath),
        priorSignals: signals,
        catalogue: cat.data,
      });
      const used = new Set(signals.map((s) => s.id));
      let idx = 10;
      const nextId = (): string | null => {
        while (idx <= INV_SERVICE_DEP_MAX && used.has(`INV-${String(idx).padStart(2, '0')}`)) idx++;
        if (idx > INV_SERVICE_DEP_MAX) return null;
        const id = `INV-${String(idx++).padStart(2, '0')}`;
        used.add(id);
        return id;
      };
      signals.push(...serviceFootprintSignals(footprint, nextId));
      assessment.service_footprint = footprint;
    }
  } catch (err) {
    assessment.service_footprint = { catalogue: `error: ${(err as Error).message.split('\n')[0]}`, entries: [], files_scanned: {} };
  }

  // --- INV-90 / INV-91: language census and coverage warning (#3423) ---
  signals.push(...languageSignals(census, coverage));

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
// Returns the absolute file path, or null. Shallowest wins.
// #3428: served by the central source scope (canonical skips; the old BFS
// skipped dot-entries only and so could match node_modules/x/package.json).
function findFirstMatchRecursive(
  root: string,
  maxDepth: number,
  test: (name: string, fullPath: string) => boolean,
): string | null {
  if (!existsSync(root)) return null;
  return findShallowestSourceFile(root, { purpose: 'manifest', maxDepth }, (f) => test(f.name, f.abs))?.abs ?? null;
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
