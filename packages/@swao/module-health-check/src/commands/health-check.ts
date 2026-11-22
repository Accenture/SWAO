// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Doctor module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import type { Command } from 'commander';
import { resolve, join, extname, isAbsolute } from 'path';
import { existsSync, readFileSync, readdirSync, statSync, appendFileSync, mkdirSync, writeFileSync } from 'fs';
import { load } from 'js-yaml';
import { prefetchAppInputs, withSharedAppConfigWalk } from '../app-config-walk.js';
import { meterStepAsync, probeMeterLogFields, startProbeMeter, takeProbeMeterReading } from '../probe-meter.js';
import { LicenseGuard, LicenseInvalidError, logPortfolio, setWorkspaceRoot, readRunStatus, isRunStale, detectCodeHealthTools, fileBackedToolRunner, PROBE_DETECT_OPTIONS, buildProvenance } from '@swao/core';
import { createHash } from 'crypto';
import { homedir } from 'os';
import { resolveProviderCatalogue, LzCatalogueSchemaError, LzCatalogueDuplicateIdError, listLzCatalogueProviders } from '@swao/module-landing-zone';
import { seedBundledConnectors, resolveBundledConnectorsDir, updateBundledConnectors } from '@swao/module-llm-providers';
import type { LicenseState } from '@swao/core';
// Result types for the two host-coupled, injected probes (#0573). Their
// builders stay host-side (see HealthCheckHostDeps below); module-health-check needs
// only the result types, which live in @swao/core as the single source of
// truth.
import type { VcsAuthProbeResult, ImportsProbeResult, ProbeContribution, DetectedCodeHealthTool } from '@swao/core';
import { buildMcpProbe, formatStaleEntry, VERSION_CHECK_TIMEOUT_MS } from '../probes/claude-desktop.js';
import type { McpProbeResult } from '../probes/claude-desktop.js';
import { buildCommunityFrameworksProbe } from '../probes/compliance-catalogues-probe.js';
import type { CommunityFrameworksProbeResult } from '../probes/compliance-catalogues-probe.js';
import { buildLzCatalogueCoverageProbe } from '../probes/lz-catalogue-coverage-probe.js';
import type { LzCatalogueCoverageProbeResult } from '../probes/lz-catalogue-coverage-probe.js';
import { buildTraceabilityProbe } from '../probes/traceability-probe.js';
import type { TraceabilityProbeResult } from '../probes/traceability-probe.js';
import { buildBiExportProbe } from '../probes/bi-probe.js';
import type { BiExportProbeResult } from '../probes/bi-probe.js';
import { buildScopeProbe } from '../probes/scope-probe.js';
import type { ScopeProbeResult } from '../probes/scope-probe.js';
import { buildPrerequisitesProbe, detectPrerequisiteTools } from '../probes/prerequisites-probe.js';
import type { PrerequisiteDetections, PrerequisitesProbeResult } from '../probes/prerequisites-probe.js';
import { buildIngestionProbe } from '../probes/ingestion-probe.js';
import type { IngestionProbeResult } from '../probes/ingestion-probe.js';
import { buildIaCToolchainProbe } from '../probes/iac-toolchain-probe.js';
import type { IaCToolchainProbeResult } from '../probes/iac-toolchain-probe.js';
import { buildWspMetadataProbe } from '../probes/wsp-metadata-probe.js';
import type { WspMetadataProbeResult } from '../probes/wsp-metadata-probe.js';
import { buildCredentialVaultProbe } from '../probes/credential-vault-probe.js';
import { buildLzConnectionsProbe, formatLzConnectionScopeLines } from '../probes/lz-connections-probe.js';
import type { LzConnectionsProbeResult } from '../probes/lz-connections-probe.js';
import { buildIntakeMappingProbe } from '../probes/intake-mapping-probe.js';
import type { IntakeMappingProbeResult } from '../probes/intake-mapping-probe.js';
import { buildApmWeightsProbe } from '../probes/apm-weights-probe.js';
import type { ApmWeightsProbeResult } from '../probes/apm-weights-probe.js';
import { checkRecordedIntake, runServiceProbes, formatServiceProbeLine, PROBE_TOTAL } from '../probes/service-probes.js';
import type { RecordedIntakeCheck, ServiceProbeResult } from '../probes/service-probes.js';
import type { CredentialVaultProbeResult } from '../probes/credential-vault-probe.js';
import { isProbeInScope, isCheckInScope, scopedProbeLineEmitter, notInScopeProbe, type HealthProbeKey } from '../probe-scope.js';
import { parseHealthCheckOutput } from '../tui/components/health-check-parse.js';
import { formatMcpHttpProbeDetail, type McpHttpProbeResult } from '../probes/mcp-http.js';
import { SETUP_SCOPES, parseSetupAssessmentType, type SetupScope } from '@swao/core';

// ---------------------------------------------------------------------------
// #0470 -- LLM provider config check + LZR snapshot staleness
// ---------------------------------------------------------------------------

export function checkLlmProviderConfig(workspacePath: string | null): string[] {
  const errors: string[] = [];
  const hasEnv = !!process.env['SWAO_LLM_PROVIDER'];
  let hasYmlProvider = false;
  if (workspacePath) {
    const ymlPath = join(workspacePath, '.swao.yml');
    if (existsSync(ymlPath)) {
      const raw = readFileSync(ymlPath, 'utf-8');
      // #2752: also accept the gateway connector path (providers.llm.primary.connector: <id>)
      hasYmlProvider =
        /providers\s*:[\s\S]*?llm\s*:[\s\S]*?primary\s*:[\s\S]*?type\s*:/m.test(raw) ||
        /providers\s*:[\s\S]*?llm\s*:[\s\S]*?primary\s*:[\s\S]*?connector\s*:/m.test(raw);
    }
  }
  if (!hasEnv && !hasYmlProvider) {
    // LLM-optional alignment (#0550): a missing provider is a WARNING, not a
    // hard error. The assessment still completes; the five LLM-dependent
    // passes degrade to no_llm_provider skip signals. List them so the
    // operator knows what is affected.
    errors.push(
      '[WARN] No LLM provider configured. The five LLM-dependent passes ' +
      '(DATA, CTX, SYNTH, COMP, BLOCKS) will be skipped (no_llm_provider) and the ' +
      'assessment will complete without them. Set SWAO_LLM_PROVIDER, ' +
      'providers.llm.primary.type (anthropic | openai | ollama), or ' +
      'providers.llm.primary.connector (LLM-Gateway connector id) in .swao.yml.',
    );
  }
  return errors;
}

const LZR_SNAPSHOT_NAMES = ['lz-aws-snapshot.json', 'lz-azure-snapshot.json', 'lz-meshstack-snapshot.json'];
const LZR_STALENESS_DAYS_DEFAULT = 7;

export function checkLzrSnapshots(workspacePath: string, maxAgeDays = LZR_STALENESS_DAYS_DEFAULT): string[] {
  const warnings: string[] = [];
  const terraformDir = join(workspacePath, 'wsp', 'inputs', 'terraform');
  if (!existsSync(terraformDir)) return warnings;
  for (const name of LZR_SNAPSHOT_NAMES) {
    const filePath = join(terraformDir, name);
    if (!existsSync(filePath)) continue;
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8')) as { snapshot_generated_at?: string; fabricated?: boolean };
      if (data.fabricated) {
        warnings.push(`[WARN] ${name} carries fabricated: true -- likely copied from examples workspace.`);
      }
      if (data.snapshot_generated_at) {
        const ageDays = (Date.now() - new Date(data.snapshot_generated_at).getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays > maxAgeDays) {
          warnings.push(`[WARN] ${name} is ${Math.floor(ageDays)} days old (threshold: ${maxAgeDays}). LZR verdict may not reflect current state.`);
        }
      }
    } catch { /* skip unreadable */ }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// #2968 -- context.allocations + context.categories validation
// ---------------------------------------------------------------------------

const KNOWN_CTX_CATEGORIES = new Set([
  'architecture', 'compliance', 'intake', 'workshops', 'docs', 'terraform', 'operations', 'structured',
]);

/** Validate .swao.yml context block. Returns errors ([ERROR] prefix) and warnings ([WARN] prefix). */
export function checkContextConfig(workspacePath: string | null): string[] {
  const messages: string[] = [];
  if (!workspacePath) return messages;
  const ymlPath = join(workspacePath, '.swao.yml');
  if (!existsSync(ymlPath)) return messages;
  let parsed: { context?: { allocations?: Record<string, unknown>; categories?: Record<string, unknown> } } | null;
  try {
    parsed = load(readFileSync(ymlPath, 'utf-8')) as typeof parsed;
  } catch {
    return messages;
  }
  const ctx = parsed?.context;
  if (!ctx) return messages;

  for (const [key, val] of Object.entries(ctx.allocations ?? {})) {
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 10_000 || val > 500_000) {
      messages.push(`[ERROR] context.allocations.${key}: must be an integer between 10,000 and 500,000 (got ${val})`);
    }
  }

  for (const [key, val] of Object.entries(ctx.categories ?? {})) {
    if (typeof val !== 'number' || val < 0 || val > 1) {
      messages.push(`[ERROR] context.categories.${key}: must be a number between 0.0 and 1.0 (got ${val})`);
    } else if (!KNOWN_CTX_CATEGORIES.has(key)) {
      messages.push(`[WARN] context.categories.${key}: unknown category name (typo?). Known categories: ${[...KNOWN_CTX_CATEGORIES].join(', ')}`);
    }
  }

  return messages;
}

// ---------------------------------------------------------------------------
// #2956 -- image sidecar check and template seeding
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp']);

const SIDECAR_TEMPLATE = [
  '# Sidecar description for: <image-filename>',
  '#',
  '# Paste a written description of this image here. SWAO will include',
  '# this text in the context ingestion pass (Pass 04) instead of the image file.',
  '#',
  '# Tips:',
  '#   - Describe what the diagram shows: components, data flows, trust boundaries.',
  '#   - Include names visible in the diagram (service names, endpoints, zones).',
  '#   - A 3-5 sentence description is sufficient for LLM coverage.',
  '#   - Save this file as <image-filename>.description.txt next to the image.',
  '#',
  '# Example: 06-01-Compute-Networking.png.description.txt',
  '# "The diagram shows two compute clusters (app-tier and db-tier) connected via',
  '#  an internal VPC with no public ingress. All external traffic enters through',
  '#  an ALB in a DMZ subnet. The db-tier has no outbound internet route."',
].join('\n') + '\n';

/** Seed `wsp/inputs/ingestion-sidecar.example.txt` if it does not exist yet. */
export function seedIngestionSidecarExample(workspacePath: string): void {
  const inputsDir = join(workspacePath, 'wsp', 'inputs');
  const destPath = join(inputsDir, 'ingestion-sidecar.example.txt');
  if (existsSync(destPath)) return;
  try {
    mkdirSync(inputsDir, { recursive: true });
    writeFileSync(destPath, SIDECAR_TEMPLATE, 'utf-8');
  } catch { /* non-fatal: seeding failure must not break health-check */ }
}

/** Warn for every image file in apps/<app>/ingestion/** that lacks a .description.txt sidecar. */
export function checkImageSidecars(workspacePath: string): string[] {
  const warnings: string[] = [];
  const appsDir = join(workspacePath, 'apps');
  if (!existsSync(appsDir)) return warnings;
  let appNames: string[];
  try {
    appNames = readdirSync(appsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch { return warnings; }
  for (const appId of appNames) {
    const ingestionDir = join(appsDir, appId, 'ingestion');
    if (!existsSync(ingestionDir)) continue;
    function walk(dir: string): void {
      let entries: string[];
      try { entries = readdirSync(dir); } catch { return; }
      for (const entry of entries) {
        const full = join(dir, entry);
        try {
          const st = statSync(full);
          if (st.isDirectory()) { walk(full); continue; }
          if (!IMAGE_EXTENSIONS.has(extname(entry).toLowerCase())) continue;
          const sidecar = full + '.description.txt';
          if (!existsSync(sidecar)) {
            warnings.push(
              `[WARN] ingestion/${appId}: ${entry} has no .description.txt sidecar` +
              ` -- add ${entry}.description.txt to include this image in LLM pass coverage`,
            );
          }
        } catch { /* skip unreadable */ }
      }
    }
    walk(ingestionDir);
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// #0476 -- additional C-19 diagnostics
// ---------------------------------------------------------------------------

export function checkLlmTemperature(workspacePath: string | null): string[] {
  const warnings: string[] = [];
  if (!workspacePath) return warnings;
  const ymlPath = join(workspacePath, '.swao.yml');
  if (!existsSync(ymlPath)) return warnings;
  const raw = readFileSync(ymlPath, 'utf-8');
  const hasLlmPrimary = /providers\s*:[\s\S]*?llm\s*:[\s\S]*?primary\s*:/m.test(raw);
  const hasTemperature = /temperature\s*:/m.test(raw);
  if (hasLlmPrimary && !hasTemperature) {
    warnings.push('[WARN] LLM temperature is not set explicitly in .swao.yml. Default is 0 (deterministic). Add temperature: 0 under providers.llm.primary to make this explicit.');
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// #0571 -- LLM context-window adequacy
// See docs/design/057-llm-prompt-size-analysis.md. Most pass prompts are bounded
// by deliberate caps (DATA 16 files; CTX 4k/doc; SYNTH 10 signals x 120 chars),
// but COMP does not cap the NUMBER of signals it summarises, so a signal-heavy
// portfolio can push a single COMP batch past 16k tokens. Warn when the
// configured model's context window is below that minimum.
// ---------------------------------------------------------------------------

// Known model context windows (tokens). Conservative; an unknown model yields
// no warning -- we do not assert a window we cannot identify. First match wins,
// so more specific patterns precede broader ones.
const MODEL_CONTEXT_WINDOWS: Array<[RegExp, number]> = [
  [/^claude/i, 200_000],
  [/^gpt-4o/i, 128_000],
  [/^gpt-4-turbo/i, 128_000],
  [/^gpt-4/i, 8_192],
  [/^gpt-3\.5/i, 16_385],
  [/^o[1-4]/i, 128_000],
  [/^llama-?3\.[1-9]/i, 131_072],
  [/^llama/i, 8_192],
  [/^(mistral|mixtral)/i, 32_768],
  [/^qwen/i, 32_768],
  [/^gemma/i, 8_192],
  [/^phi/i, 16_384],
  [/^deepseek/i, 65_536],
];

const COMP_MIN_CONTEXT_TOKENS = 16_384;
const RECOMMENDED_CONTEXT_TOKENS = 32_768;

function resolveConfiguredModel(workspacePath: string | null): string | null {
  const envModel =
    process.env['SWAO_ANTHROPIC_MODEL'] ??
    process.env['SWAO_OPENAI_MODEL'] ??
    process.env['SWAO_OLLAMA_MODEL'] ??
    process.env['SWAO_LLM_MODEL'];
  if (envModel) return envModel;
  if (!workspacePath) return null;
  const ymlPath = join(workspacePath, '.swao.yml');
  if (!existsSync(ymlPath)) return null;
  // Bound the input before the regex (ReDoS hygiene): .swao.yml is small.
  const raw = readFileSync(ymlPath, 'utf-8').slice(0, 100_000);
  const m = raw.match(/primary\s*:[\s\S]{0,2000}?\bmodel\s*:\s*["']?([^\s"'#]+)/m);
  return m ? m[1]! : null;
}

export function checkLlmContextWindow(workspacePath: string | null): string[] {
  const warnings: string[] = [];
  const model = resolveConfiguredModel(workspacePath);
  if (!model) return warnings; // no explicit model -> provider-config check covers it
  const entry = MODEL_CONTEXT_WINDOWS.find(([re]) => re.test(model));
  if (!entry) return warnings; // unknown model -> do not assert a window we don't know
  const window = entry[1];
  if (window < COMP_MIN_CONTEXT_TOKENS) {
    warnings.push(
      `[WARN] LLM model '${model}' has a ~${window.toLocaleString()}-token context window, below the ` +
      `${COMP_MIN_CONTEXT_TOKENS.toLocaleString()}-token minimum the COMP pass can require for a ` +
      `signal-heavy assessment (docs/design/057). COMP batches may be truncated; prefer a model with ` +
      `>= ${RECOMMENDED_CONTEXT_TOKENS.toLocaleString()} tokens, or reduce the selected regimes/signal volume.`,
    );
  }
  return warnings;
}

const PLACEHOLDER_PATTERNS = [
  /Sample\s*\/\s*placeholder/i,
  /replace-with-/i,
  /Replace before the assessment/i,
];
const INPUT_EXTENSIONS = new Set(['.md', '.txt', '.yaml', '.yml', '.json', '.csv']);
const SKIP_TOP_DIRS = new Set(['source', 'catalogs']);

export function checkPlaceholderInputs(workspacePath: string): string[] {
  const warnings: string[] = [];
  const importsDir = join(workspacePath, 'wsp', 'inputs');
  if (!existsSync(importsDir)) return warnings;

  function walk(dir: string, prefix: string): void {
    let entries: string[];
    try { entries = readdirSync(dir).sort(); } catch { return; }
    for (const entry of entries) {
      if (prefix === '' && SKIP_TOP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      try {
        const st = statSync(full);
        if (st.isDirectory()) { walk(full, rel); continue; }
        if (!INPUT_EXTENSIONS.has(extname(entry).toLowerCase())) continue;
        const content = readFileSync(full, 'utf-8');
        if (PLACEHOLDER_PATTERNS.some((p) => p.test(content))) {
          warnings.push(`[WARN] wsp/inputs/${rel} contains placeholder text. Replace with real engagement data before running swao assess.`);
        }
      } catch { /* skip unreadable */ }
    }
  }

  walk(importsDir, '');
  return warnings;
}

function hasLzrInputs(appDir: string): boolean {
  const tfDir = join(appDir, 'wsp', 'inputs', 'terraform');
  if (!existsSync(tfDir)) return false;
  try {
    const files = readdirSync(tfDir);
    return files.some((f) => f.endsWith('.tfstate') || f.endsWith('.tfplan') || LZR_SNAPSHOT_NAMES.includes(f));
  } catch { return false; }
}

export function checkLzrCoveragePerApp(workspacePath: string): string[] {
  const info: string[] = [];
  const appsDir = join(workspacePath, 'apps');
  if (!existsSync(appsDir)) {
    if (!hasLzrInputs(workspacePath)) {
      const appId = workspacePath.split('/').pop() ?? workspacePath;
      info.push(`[INFO] No LZR snapshot or Terraform state found for app "${appId}". Pass 23 will skip LZR assessment.`);
    }
    return info;
  }
  try {
    const appNames = readdirSync(appsDir).filter((n) => statSync(join(appsDir, n)).isDirectory());
    for (const appName of appNames) {
      if (!hasLzrInputs(join(appsDir, appName))) {
        info.push(`[INFO] No LZR snapshot or Terraform state found for app "${appName}". Pass 23 will skip LZR assessment.`);
      }
    }
  } catch { /* skip */ }
  return info;
}

// #1437 (sprint-114): per-provider LZ catalogue provenance check.
// Reports origin, sha256, last_updated for each known provider. Workspace-local
// files that fail schema validation are emitted as [WARN] rather than crashing.
export function checkLzCatalogueProvenance(workspacePath: string): string[] {
  const lines: string[] = [];

  // Discover all providers: bundled catalogue files + workspace copies in every
  // layout the resolver reads (#3155, #3298: shared discovery, no index.json).
  const allProviders = new Set<string>(listLzCatalogueProviders(workspacePath));

  if (allProviders.size === 0) {
    return ['[INFO] LZ catalogues: no providers found (no catalogue files found).'];
  }

  let workspaceCount = 0;
  for (const p of [...allProviders].sort()) {
    try {
      const { catalogue, provenance, filePath } = resolveProviderCatalogue(p, workspacePath);
      const sha256 = createHash('sha256').update(readFileSync(filePath)).digest('hex').slice(0, 12);
      const lastUpdated = catalogue.meta.last_updated;
      if (provenance === 'workspace') workspaceCount++;
      lines.push(`[INFO] LZ catalogue: ${p.padEnd(16)} origin=${provenance}  hash=${sha256}  last_updated=${lastUpdated}`);
    } catch (err) {
      if (err instanceof LzCatalogueSchemaError || err instanceof LzCatalogueDuplicateIdError) {
        workspaceCount++;
        lines.push(`[WARN] LZ catalogue: ${p.padEnd(16)} origin=workspace  INVALID: ${err.message}`);
      } else if (!(err instanceof Error && err.message.startsWith('No catalogue found'))) {
        // #3282: a bundled catalogue that fails to parse or validate is a WARN
        // naming file and reason; it used to be skipped silently.
        const reason = err instanceof Error ? err.message.replace(/\s+/g, ' ').slice(0, 300) : String(err);
        lines.push(`[WARN] LZ catalogue: ${p.padEnd(16)} origin=bundled  file=${p}.json  INVALID: ${reason}`);
      }
      // No file in any layer: cannot occur, the provider list is built from the files (#3298).
    }
  }

  if (workspaceCount === 0) {
    lines.push('[INFO] LZ catalogues: all providers use bundled catalogues (no workspace-local overrides).');
  }
  return lines;
}

// #0516 AC#3: returns true when dir contains at least one non-README source
// file. An all-README directory means the source was never cloned.
function isSourceNonEmpty(dir: string): boolean {
  const ignoredNames = new Set(['readme.md', 'readme.txt', 'readme', '.gitkeep']);
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) { stack.push(join(current, e.name)); continue; }
      if (e.isFile() && !ignoredNames.has(e.name.toLowerCase())) return true;
    }
  }
  return false;
}

// #0516 AC#3: checks source accessibility for all configured apps.
// Warns when source.path exists but is empty/README-only (root cause of
// the silent all-UNKNOWN assessment from the sovereign-health UAT finding).
export function checkSourceAccessibility(workspacePath: string): string[] {
  const warnings: string[] = [];
  const appsDir = join(workspacePath, 'apps');
  let appEntries: Array<{ id: string; dir: string }>;

  if (existsSync(appsDir)) {
    try {
      appEntries = readdirSync(appsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => ({ id: e.name, dir: join(appsDir, e.name) }));
    } catch { return warnings; }
  } else {
    appEntries = [{ id: '', dir: workspacePath }];
  }

  for (const { id, dir } of appEntries) {
    const ymlPath = join(dir, '.swao.yml');
    if (!existsSync(ymlPath)) continue;
    let sourcePath: string | undefined;
    let hasVcsUrl = false;
    let isServiceApp = false;
    try {
      const raw = readFileSync(ymlPath, 'utf-8').slice(0, 100_000);
      // Service Portfolio Assessment apps (ADR-0064) have no source code by design.
      isServiceApp = /^\s+type\s*:\s*service\s*$/m.test(raw);
      const pathMatch = raw.match(/source\s*:[\s\S]*?(?:^|\s)path\s*:\s*["']?([^\s"'#\n]+)/m);
      if (pathMatch) sourcePath = pathMatch[1];
      hasVcsUrl = /source\s*:[\s\S]*?vcs\s*:[\s\S]*?url\s*:/m.test(raw);
    } catch { continue; }

    const label = id ? `apps/${id}` : 'workspace';

    if (isServiceApp) continue;

    if (!sourcePath && !hasVcsUrl) {
      warnings.push(
        `[WARN] ${label}/.swao.yml has no source.path or source.vcs.url. ` +
        `swao assess will fail without a source location.`,
      );
      continue;
    }

    if (!sourcePath) continue; // vcs.url configured -- will auto-clone, not a warning

    const resolved = isAbsolute(sourcePath) ? sourcePath : join(dir, sourcePath);
    if (!existsSync(resolved)) {
      if (!hasVcsUrl) {
        warnings.push(
          `[WARN] ${label}: source.path '${sourcePath}' does not exist and no ` +
          `source.vcs.url is configured. Add source.vcs.url to .swao.yml to enable auto-clone, ` +
          `or point source.path at the correct directory.`,
        );
      }
      continue;
    }

    if (!isSourceNonEmpty(resolved)) {
      // #4261: with source.vcs.url set, the assessment clones the repository
      // into the directory, so an empty directory is expected before the
      // first run and is information, not a warning asking for vcs.url.
      warnings.push(hasVcsUrl
        ? `[INFO] ${label}: source directory '${sourcePath}' holds no source yet; source.vcs.url is set, ` +
          `so swao assess clones the repository into it at the next run.`
        : `[WARN] ${label}: source directory '${sourcePath}' is empty or contains only README ` +
          `files, so the source code is missing. Set source.vcs.url so swao assess clones it, ` +
          `or populate the directory before running swao assess.`,
      );
    }
  }

  return warnings;
}

/**
 * #3388 (Design 112, D-3): the LLM gateway connector folder is the single
 * source of truth (the runtime bundled fallback is being dropped), so a
 * workspace with no seeded connectors would have none at all. This check
 * detects a missing/empty `wsp/inputs/llm-gateway/`, best-effort re-seeds the
 * packaged connectors into it (idempotent: never overwrites, `.seeded` marker),
 * and WARNs only when it still ends up empty.
 *
 * Community frameworks and LZ catalogues are NOT re-seeded here: they keep a
 * bundled fallback and already have their own probes (buildCommunityFrameworks-
 * Probe, buildLzCatalogueCoverageProbe), which report their presence.
 */
export function checkSeededAssets(workspacePath: string | null): string[] {
  const out: string[] = [];
  if (!workspacePath) return out;
  // #3388: self-heal seeding only ever runs in a real workspace (a `.swao.yml`
  // present). health-check resolves workspacePath from `process.cwd()` when no
  // `--workspace` is given (health-check.ts), so without this guard a run from
  // any directory would create wsp/inputs/llm-gateway/ there. A non-workspace
  // directory reports nothing here; the workspace-resolution output already
  // tells the operator no workspace was found. Mirrors readLzrMaxAgeDays below.
  if (!existsSync(join(workspacePath, '.swao.yml'))) return out;
  const dir = join(workspacePath, 'wsp', 'inputs', 'llm-gateway');
  const countYaml = (d: string): number => {
    try { return existsSync(d) ? readdirSync(d).filter(f => (f.endsWith('.yaml') || f.endsWith('.yml')) && !f.startsWith('_')).length : 0; }
    catch { return 0; }
  };

  let present = countYaml(dir);
  if (present === 0) {
    // Nothing seeded yet: try to seed from the packaged connectors.
    if (resolveBundledConnectorsDir()) {
      try {
        const { copied } = seedBundledConnectors(workspacePath);
        if (copied.length > 0) {
          out.push(`[INFO] Seeded ${copied.length} LLM gateway connector(s) into wsp/inputs/llm-gateway/ (single source, Design 112).`);
        }
      } catch { /* best-effort */ }
      present = countYaml(dir);
    }
    if (present === 0) {
      out.push(
        '[WARN] No LLM gateway connectors in wsp/inputs/llm-gateway/ and none could be seeded. ' +
        'LLM-dependent passes have no gateway to call. Run `swao init` in this workspace, ' +
        'or copy a connector YAML into wsp/inputs/llm-gateway/.',
      );
    }
  }
  // #3388 (D-2): INFO when an unchanged seed has a newer packaged version. A
  // dry-run update reports exactly those (unchanged seeds that differ from the
  // packaged copy); user-edited connectors are not listed. No files are written.
  try {
    const stale = updateBundledConnectors(workspacePath, { dryRun: true }).updated;
    if (stale.length > 0) {
      out.push(
        `[INFO] ${stale.length} packaged LLM gateway connector(s) have a newer version ` +
        `(${stale.join(', ')}). Run \`swao llm-gateway update\` to refresh them; your edited connectors are kept.`,
      );
    }
  } catch { /* best-effort */ }
  return out;
}

function readLzrMaxAgeDays(workspacePath: string | null): number {
  if (!workspacePath) return LZR_STALENESS_DAYS_DEFAULT;
  const ymlPath = join(workspacePath, '.swao.yml');
  if (!existsSync(ymlPath)) return LZR_STALENESS_DAYS_DEFAULT;
  try {
    const raw = readFileSync(ymlPath, 'utf-8');
    const match = /doctor\s*:[\s\S]*?lzr_snapshot_max_age_days\s*:\s*(\d+)/.exec(raw);
    if (match) return parseInt(match[1], 10);
  } catch { /* fallback */ }
  return LZR_STALENESS_DAYS_DEFAULT;
}

function pad(s: string, w: number): string {
  // Always add at least 2 dots so the TUI HEADER_RE (/\.+/) always matches,
  // even when the label text is already longer than w (e.g. [2/15] Playwright / Chromium).
  return s + '.'.repeat(Math.max(2, w - s.length));
}

export interface LicenseProbeResult {
  status: 'ok' | 'near_limit' | 'exhausted' | 'expiring_soon' | 'expired' | 'invalid';
  tier: string;
  assessments_used: number;
  /** Per-licence budget. `null` means unlimited; `undefined` means
   *  Community (no licence budget exists). */
  assessments_limit?: number | null;
  days_elapsed: number;
  /** Whole days until the licence `exp` (negative if already past). `null`
   *  when there is no expiry (Community, or an unlimited key with no exp). */
  days_until_expiry?: number | null;
  warning: string | null;
}

// Design 062 Â§6 step 3: warn proactively when a paid licence is within this many
// days of expiry so the operator can re-issue against the EVB-IT renewal before
// it lapses (offline keys self-expire; renewal = re-issue, ADR-0050).
const LICENSE_EXPIRY_WARN_DAYS = 30;

export interface PlaywrightProbeResult {
  status: 'ok' | 'fail' | 'warn';
  version: string | null;
  path: string | null;
  error: string | null;
  /** #4451: why the probe is not ok: Chromium not found, playwright-core missing, a slow test launch (warn) or a launch error. */
  reason?: 'not_found' | 'package_missing' | 'timeout' | 'launch_error';
  /** Design 126: the raw launch error, logged only. */
  detail?: string;
  /** #4461: duration of the test launch, when one ran. */
  launch_ms?: number;
  /** #4461: duration of the browser close; null when it still ran after the close wait. */
  close_ms?: number | null;
}

/**
 * #4451 / #4461: the log fields of the Playwright probe: the reason and the
 * message of a warn or fail, and the launch and close timings.
 */
export function playwrightProbeLogFields(probe: PlaywrightProbeResult): Record<string, unknown> {
  return {
    ...(probe.status !== 'ok' && probe.error ? { message: probe.error } : {}),
    ...(probe.reason ? { reason: probe.reason } : {}),
    ...(probe.detail ? { error_detail: probe.detail } : {}),
    ...(probe.launch_ms !== undefined ? { launch_ms: probe.launch_ms } : {}),
    ...(probe.close_ms !== undefined ? { close_ms: probe.close_ms } : {}),
  };
}

// Host-coupled probe builders injected by the host (#0573). These three probes
// cannot move into module-health-check: buildPlaywrightProbe drives playwright-core
// (binary-excluded, shared with assess); buildVcsAuthProbe runs `git ls-remote`
// against configured VCS hosts; buildImportsProbe walks the host workspace
// layout. The host owns them and passes them in via this interface so the
// module stays free of host imports.
//
// Sprint-038 #0350: buildPlaywrightProbe must be supplied as a deferred async
// thunk so `swao --version` / `--help` do not pay the ~50MB playwright-core
// init cost. The host wires `async () => (await import(...)).buildPlaywrightProbe()`
// at the injection site (swao/src/index.ts).
export interface HealthCheckHostDeps {
  buildPlaywrightProbe: () => Promise<PlaywrightProbeResult>;
  buildVcsAuthProbe: (workspacePath: string) => Promise<VcsAuthProbeResult>;
  buildImportsProbe: (workspacePath: string) => ImportsProbeResult;
  // #1402 sprint-113: SWAO LLM-Gateway connector probe, contributed by
  // @swao/module-llm-providers (host-mediated: the module must not import a
  // sibling module directly, so the host injects the ProbeContribution).
  // #1434: the audit-remote-ingestion probe (formerly host-injected the same
  // way) was removed with the audit assessment surface.
  llmGatewayProbe: ProbeContribution;
  /** #3487: optional override of the Pass 26 code health tool detection (tests). */
  detectCodeHealthTools?: () => Promise<DetectedCodeHealthTool[]>;
  /** #4461: optional override of the concurrent prerequisite version probes (tests). */
  detectPrerequisiteTools?: () => Promise<PrerequisiteDetections>;
  /** #3589: optional override of the LZ connections probe [26] (tests; default live read-only probe). */
  buildLzConnectionsProbe?: (workspacePath: string) => Promise<LzConnectionsProbeResult>;
  /**
   * #4392: probe of the HTTP MCP endpoint (probes/mcp-http.ts probeMcpHttpEndpoint),
   * shown under the SWAO-MCP line; informational, never part of the verdict.
   * The host wires the live probe; without it (tests) no request is sent.
   */
  mcpHttpProbe?: () => Promise<McpHttpProbeResult>;
  /**
   * #4430: the host version with its build, e.g. "1.6.1 (4c8dd01e, 2026-11-14)"
   * (host branding SWAO_VERSION_LABEL; the module cannot import host code).
   * Printed under the start line of the text output.
   */
  swaoVersionLabel?: string;
}

export function buildLicenseProbe(state: LicenseState): LicenseProbeResult {
  // After M18 D-05 (revised): Community has no cap, so the only
  // exhaustion path is a licensed user hitting their `assessment_limit`.
  // "Near limit" is reported when within 5 assessments of the budget.
  const limit = state.assessmentLimit;
  const isLicensed = state.tier !== 'community';

  // Whole days until expiry (Math.ceil so the final partial day still reads as
  // "1 day", not "0"). `null` when the licence carries no expiry.
  const daysUntilExpiry = isLicensed && state.exp
    ? Math.ceil((new Date(state.exp).getTime() - Date.now()) / 86_400_000)
    : null;

  let status: LicenseProbeResult['status'] = 'ok';
  let warning: string | null = null;

  // Precedence: a reached budget is a hard stop (it blocks the next assess), so
  // it outranks the proactive expiry heads-up, which in turn outranks the
  // near-budget heads-up. Each sets a single status + warning line.
  if (isLicensed && limit != null && state.assessmentCount >= limit) {
    status = 'exhausted';
    warning = `License assessment budget reached (${state.assessmentCount}/${limit}) -- contact Accenture for renewal`;
  } else if (daysUntilExpiry != null && daysUntilExpiry <= LICENSE_EXPIRY_WARN_DAYS) {
    status = 'expiring_soon';
    warning = daysUntilExpiry <= 0
      ? `Licence expired on ${state.exp} -- contact Accenture to renew (re-issue a key against the EVB-IT renewal)`
      : `Licence expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'} (${state.exp}) -- contact Accenture to renew before it lapses`;
  } else if (isLicensed && limit != null && state.assessmentCount >= limit - 5) {
    status = 'near_limit';
    warning = `Near licence budget: ${state.assessmentCount}/${limit} assessments used`;
  }

  return {
    status,
    tier: state.tier,
    assessments_used: state.assessmentCount,
    ...(limit !== undefined ? { assessments_limit: limit } : {}),
    days_elapsed: state.daysElapsed,
    ...(daysUntilExpiry !== null ? { days_until_expiry: daysUntilExpiry } : {}),
    warning,
  };
}

function formatLicenseProbeLine(probe: LicenseProbeResult): string {
  const LABEL_W = 26;
  const label = pad(`[1/${PROBE_TOTAL}] License`, LABEL_W);
  const tierDisplay = probe.tier === 'community' ? 'Community (free, unlimited)' : probe.tier;
  const limit = probe.assessments_limit;
  const budgetDisplay =
    limit == null
      ? `${probe.assessments_used} run`
      : `${probe.assessments_used}/${limit} used`;

  if (probe.status === 'invalid') {
    return `  ${label}  FAIL  license key invalid`;
  }
  if (probe.status === 'expired') {
    return `  ${label}  WARN  license expired`;
  }
  if (probe.status === 'expiring_soon') {
    const days = probe.days_until_expiry;
    const when = days != null && days > 0 ? `expires in ${days}d` : 'expired';
    return `  ${label}  WARN  ${tierDisplay}  ${budgetDisplay}  ${when}`;
  }
  if (probe.status === 'exhausted') {
    return `  ${label}  WARN  ${tierDisplay}  ${budgetDisplay}  budget reached`;
  }
  if (probe.status === 'near_limit') {
    return `  ${label}  WARN  ${tierDisplay}  ${budgetDisplay}`;
  }
  return `  ${label}  ok    ${tierDisplay}  ${budgetDisplay}`;
}

function formatPlaywrightProbeLine(probe: PlaywrightProbeResult): string {
  const LABEL_W = 26;
  const label = pad(`[2/${PROBE_TOTAL}] Playwright / Chromium`, LABEL_W);
  if (probe.status === 'fail') {
    return `  ${label}  FAIL  ${probe.error ?? 'Chromium unavailable'}`;
  }
  if (probe.status === 'warn') {
    return `  ${label}  WARN  ${probe.error ?? 'Playwright not available in this binary build'}`;
  }
  const versionDisplay = probe.version ? `Chromium ${probe.version}` : 'Chromium installed';
  return `  ${label}  ok    ${versionDisplay}`;
}

function formatMcpProbeLine(probe: McpProbeResult): string {
  const LABEL_W = 26;
  const label = pad(`[3/${PROBE_TOTAL}] SWAO-MCP`, LABEL_W);
  const head = ((): string => {
    switch (probe.status) {
      case 'ok':
        return `  ${label}  ok    swao server configured at ${probe.commandPath}`;
      case 'missing_entry':
        return `  ${label}  WARN  swao server entry missing from Claude Desktop config (run Setup Wizard to fix)`;
      case 'binary_not_found':
        return `  ${label}  WARN  swao binary path in config not found: ${probe.commandPath}`;
      case 'binary_unreachable':
        return `  ${label}  WARN  swao binary found but did not respond to --version${probe.reason ? ` (${probe.reason})` : ''}: ${probe.commandPath}`;
      case 'binary_slow':
        // #3333: timed out twice (VERSION_CHECK_TIMEOUT_MS each); the binary exists and is not reported as unreachable.
        return `  ${label}  WARN  swao binary found but slow to respond to --version (>${VERSION_CHECK_TIMEOUT_MS / 1000} s, retried once): ${probe.commandPath}`;
      case 'stale_entry': {
        const n = probe.staleEntries?.length ?? 0;
        return `  ${label}  WARN  ${n} stale SWAO entr${n === 1 ? 'y' : 'ies'} in Claude Desktop config (run Setup Wizard or swao mcp install to fix)`;
      }
      case 'not_installed':
        return `  ${label}  INFO  Claude Desktop not installed (config file absent)`;
    }
  })();
  // #3163: one continuation line per stale entry, in any of the configs checked.
  const detail = (probe.staleEntries ?? []).map((e) => `          ${formatStaleEntry(e)}`);
  // #4392: the HTTP endpoint (Claude Code, the Claude Desktop Code tab).
  const http = probe.http ? formatMcpHttpProbeDetail(probe.http) : [];
  return [head, ...detail, ...http].join('\n');
}

/** Exported for tests (#3577). */
export function formatCommunityFrameworksProbeLine(probe: CommunityFrameworksProbeResult): string {
  const LABEL_W = 26;
  const label = pad(`[4/${PROBE_TOTAL}] Community frameworks`, LABEL_W);
  if (probe.status === 'absent') {
    // #2910: when bundled frameworks are available, emit 'ok' with an explanatory note
    // instead of a misleading INFO warning. Bundled frameworks are always functional;
    // the workspace catalog dir is optional (run `swao init` to install local copies).
    if (probe.bundled_count > 0) {
      return `  ${label}  ok    ${probe.bundled_count} bundled frameworks available (no workspace-level overrides; run \`swao init\` to install local copies)`;
    }
    return `  ${label}  INFO  no catalogs at ${probe.catalogs_dir} (run \`swao init\`)`;
  }
  if (probe.status === 'fail') {
    const head = probe.errors[0] ?? 'catalogue load failed';
    return `  ${label}  FAIL  ${head}`;
  }
  const counts = `${probe.standard_count} standard + ${probe.community_count} community`;
  const headLine = probe.status === 'warn'
    ? `  ${label}  WARN  ${counts}  ${probe.warnings[0] ?? 'integrity issue'}`
    : `  ${label}  ok    ${counts}  no integrity issues`;

  // Sprint-037 #0342: one info line per community framework so the
  // operator can see contributor + controls count at a glance during
  // the go-live smoke. (`classification` removed in sprint-038 #0349.)
  const communityLines = probe.frameworks
    .filter((f) => f.scope === 'community')
    .map((f) => {
      const contrib = f.contributor ?? '(missing)';
      // #3577: service-mapping coverage (Design 120 §8.2); absent = every capability grey.
      const sm = f.service_mapping;
      const mapping = sm.status === 'ok' ? `service mapping ${sm.mapped}/${sm.in_use} capability tags`
        : sm.status === 'invalid' ? 'service mapping invalid' : 'no service mapping';
      // #3869: policy baseline state (Design 123 section 7.4); absent = not a baseline, nothing shown.
      const pb = f.policy_baseline;
      const baseline = pb.status === 'absent' ? ''
        : pb.status === 'invalid' ? ', policy baseline invalid'
        : `, policy baseline ${pb.enabled}/${pb.policies} enabled${pb.not_set.length > 0 ? `, ${pb.not_set.length} not reviewed` : ''}${pb.stale ? `, stale (${pb.catalogue_version} < shipped ${pb.shipped_version})` : ''}`;
      const marker = pb.status === 'invalid' ? 'FAIL' : 'ok';
      return `  ${pad('', LABEL_W)}  [${marker}] community/${f.id}: contributor=${contrib}, ${f.controls_count} controls, ${mapping}${baseline}`;
    });
  // #4452: every further warning on a line of its own (the head line shows the first).
  const warnLines = probe.status === 'warn'
    ? probe.warnings.slice(1).map((w) => `  ${pad('', LABEL_W)}  [warn] ${w}`)
    : [];
  return [headLine, ...warnLines, ...communityLines].join('\n');
}

function formatImportsProbeLine(probe: ImportsProbeResult): string {
  const LABEL_W = 26;
  const label = pad(`[5/${PROBE_TOTAL}] Import templates`, LABEL_W);
  switch (probe.status) {
    case 'absent':
      return `  ${label}  INFO  ${probe.message}`;
    case 'ok':
      return `  ${label}  ok    ${probe.message}`;
    case 'degraded':
      return `  ${label}  WARN  ${probe.message}`;
    case 'blocked':
      return `  ${label}  FAIL  ${probe.message}`;
    case 'fail':
      return `  ${label}  FAIL  ${probe.message}`;
  }
}

function formatTraceabilityProbeLine(probe: TraceabilityProbeResult): string {
  const LABEL_W = 26;
  const label = pad(`[6/${PROBE_TOTAL}] Traceability`, LABEL_W);
  switch (probe.status) {
    case 'absent':
      return `  ${label}  INFO  ${probe.message}`;
    case 'ok':
      return `  ${label}  ok    ${probe.message}`;
    case 'warn':
      return `  ${label}  WARN  ${probe.message}`;
    case 'fail':
      return `  ${label}  FAIL  ${probe.message}`;
  }
}

function formatBiExportProbeLine(probe: BiExportProbeResult): string {
  const LABEL_W = 26;
  const label = pad(`[7/${PROBE_TOTAL}] BI export`, LABEL_W);
  switch (probe.status) {
    case 'absent':
      return `  ${label}  INFO  ${probe.message}`;
    case 'ok':
      return `  ${label}  ok    ${probe.message}`;
    case 'warn':
      return `  ${label}  WARN  ${probe.message}`;
    case 'fail':
      return `  ${label}  FAIL  ${probe.message}`;
  }
}

// #0263 Phase 2 -- Scope coverage probe formatter.
function formatScopeProbeLine(probe: ScopeProbeResult): string {
  const LABEL_W = 26;
  const label = pad(`[8/${PROBE_TOTAL}] Scope`, LABEL_W);
  switch (probe.status) {
    case 'absent':
      return `  ${label}  INFO  ${probe.message}`;
    case 'info':
      return `  ${label}  INFO  ${probe.message}`;
    case 'ok':
      return `  ${label}  ok    ${probe.message}`;
    case 'warn':
      return `  ${label}  WARN  ${probe.message}`;
  }
}

// #0326 sprint-036 -- Prerequisites probe formatter (git / ssh / node on PATH).
function formatPrerequisitesProbeLine(probe: PrerequisitesProbeResult): string {
  const LABEL_W = 26;
  const label = pad(`[9/${PROBE_TOTAL}] Prerequisites`, LABEL_W);
  switch (probe.status) {
    case 'ok':
      return `  ${label}  ok    ${probe.message}`;
    case 'info':
      return `  ${label}  INFO  ${probe.message}`;
    case 'warn':
      return `  ${label}  WARN  ${probe.message}`;
    case 'fail':
      return `  ${label}  FAIL  ${probe.message}`;
  }
}

// #0326 sprint-036 -- VCS auth probe formatter (ls-remote against configured URLs).
function formatVcsAuthProbeLine(probe: VcsAuthProbeResult): string {
  const LABEL_W = 26;
  const label = pad(`[10/${PROBE_TOTAL}] VCS auth`, LABEL_W);
  switch (probe.status) {
    case 'ok':
      return `  ${label}  ok    ${probe.message}`;
    case 'warn':
      return `  ${label}  WARN  ${probe.message}`;
    case 'fail':
      return `  ${label}  FAIL  ${probe.message}`;
    case 'info':
      return `  ${label}  INFO  ${probe.message}`;
  }
}

// #1402 sprint-113: LLM-Gateway connector probe formatter. Its
// ProbeContribution returns only { ok, message }; the message is
// self-describing with a bracketed state prefix ([PASS] / [WARNING] / [N/A]).
// Map that prefix to the same aligned status token the other probe lines use
// so the output stays visually uniform.
/** #3375: JSON / log status of the LLM gateway probe; ok === null with a [WARNING] prefix is 'warn' (no LLM configured), otherwise 'skip'. */
export function llmGatewayStatus(probe: { ok: boolean | null; message: string }): 'ok' | 'warn' | 'skip' | 'fail' {
  if (probe.ok === true) return 'ok';
  if (probe.ok === false) return 'fail';
  return /^\[WARNING\]/.test(probe.message) ? 'warn' : 'skip';
}

export function formatLlmGatewayLine(probe: { ok: boolean | null; message: string }): string {
  const LABEL_W = 26;
  const label = pad(`[13/${PROBE_TOTAL}] LLM gateway`, LABEL_W);
  const m = probe.message.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
  const msgState = m ? m[1]!.toUpperCase() : (probe.ok === true ? 'PASS' : probe.ok === null ? 'N/A' : 'FAIL');
  // #2366: probe.ok is authoritative; a [WARNING] message prefix must not
  // downgrade a failed probe to WARN in the TUI output.
  // #2897: ok === null = SKIP (credential not loaded); only ok === false forces FAIL.
  const state = (probe.ok === false && msgState !== 'FAIL') ? 'FAIL' : msgState;
  const body = m ? m[2]! : probe.message;
  switch (state) {
    case 'PASS':
      return `  ${label}  ok    ${body}`;
    case 'WARNING':
      return `  ${label}  WARN  ${body}`;
    case 'N/A':
      return `  ${label}  INFO  ${body}`;
    default:
      return `  ${label}  FAIL  ${body}`;
  }
}

// #1509: wsp metadata (engagement placeholder) probe formatter.
function formatWspMetadataProbeLine(probe: WspMetadataProbeResult): string {
  const LABEL_W = 26;
  const label = pad(`[14/${PROBE_TOTAL}] Engagement`, LABEL_W);
  switch (probe.status) {
    case 'absent':
      return `  ${label}  INFO  ${probe.message}`;
    case 'ok':
      return `  ${label}  ok    ${probe.message}`;
    case 'warn':
      return `  ${label}  WARN  ${probe.message}`;
  }
}

// #3102: SWAO_APM domain-weights probe formatter.
function formatApmWeightsProbeLine(probe: ApmWeightsProbeResult): string {
  const label = pad(`[18/${PROBE_TOTAL}] SWAO_APM weights`, 26);
  switch (probe.status) {
    case 'skip':
      return `  ${label}  INFO  ${probe.message}`;
    case 'ok':
      return `  ${label}  ok    ${probe.message}`;
    case 'warn':
      return `  ${label}  WARN  ${probe.message}`;
    case 'error':
      return `  ${label}  FAIL  ${probe.message}`;
  }
}

// #3084: service intake column-mapping probe formatter.
function formatIntakeMappingProbeLine(probe: IntakeMappingProbeResult): string {
  const label = pad(`[17/${PROBE_TOTAL}] Intake mapping`, 26);
  switch (probe.status) {
    case 'skip':
      return `  ${label}  INFO  ${probe.message}`;
    case 'ok':
      return `  ${label}  ok    ${probe.message}`;
    case 'warn':
      return `  ${label}  WARN  ${probe.message}`;
    case 'error':
      return `  ${label}  FAIL  ${probe.message}`;
  }
}

// #0995 / #1212: ingestion folder probe formatter.
function formatIngestionFolderProbeLine(probe: IngestionProbeResult): string {
  const LABEL_W = 26;
  const label = pad(`[11/${PROBE_TOTAL}] Ingestion folder`, LABEL_W);
  switch (probe.status) {
    case 'ok':
      return `  ${label}  ok    ${probe.message}`;
    case 'processed':
      return `  ${label}  ok    ${probe.message}`;
    case 'warn':
      return `  ${label}  WARN  ${probe.message}`;
    case 'info':
      return `  ${label}  INFO  ${probe.message}`;
    case 'absent':
      return `  ${label}  INFO  ${probe.message}`;
  }
}

// #1340: IaC toolchain probe formatter.
function formatIaCToolchainProbeLine(probe: IaCToolchainProbeResult): string {
  const LABEL_W = 26;
  const label = pad(`[12/${PROBE_TOTAL}] IaC toolchain`, LABEL_W);
  switch (probe.status) {
    case 'ok':   return `  ${label}  ok    ${probe.message}`;
    case 'warn': return `  ${label}  WARN  ${probe.message}`;
    case 'info': return `  ${label}  INFO  ${probe.message}`;
  }
}

// #1698: LZ catalogue service-dep coverage probe formatter.
export function formatLzCatalogueCoverageProbeLine(probe: LzCatalogueCoverageProbeResult): string {
  const LABEL_W = 26;
  const label = pad(`[15/${PROBE_TOTAL}] LZ catalogue`, LABEL_W);
  switch (probe.status) {
    case 'ok':   return `  ${label}  ok    ${probe.message}`;
    case 'warn': {
      // #3282: one line per structural issue / grouped quality finding.
      // #4113: the text detail lists every line (no cap); findings are grouped
      // per rule and catalogue, so the list stays short.
      const indent = `\n  ${pad('', LABEL_W)}        `;
      const lines = probe.detail_lines ?? (probe.detail ? [probe.detail] : []);
      return `  ${label}  WARN  ${probe.message}` + lines.map((l) => `${indent}${l}`).join('');
    }
    case 'info':  return `  ${label}  INFO  ${probe.message}`;
    case 'fail':  return `  ${label}  FAIL  ${probe.message}`;
  }
}

/**
 * #3589: probe [26] LZ connections. Never FAIL: a write-capable operator login
 * is the expected test-tenant setup (Design 120 section 6.3), so refused and
 * unverifiable are warnings; per scope a state line and a facts line (#4233). Exported for tests.
 */
export function formatLzConnectionsProbeLine(probe: LzConnectionsProbeResult): string {
  const LABEL_W = 26;
  const label = pad(`[26/${PROBE_TOTAL}] LZ connections`, LABEL_W);
  const state = probe.status === 'ok' ? 'ok  ' : probe.status === 'warn' ? 'WARN' : 'INFO';
  const indent = `\n  ${pad('', LABEL_W)}        `;
  return `  ${label}  ${state}  ${probe.message}` + probe.scopes.flatMap(formatLzConnectionScopeLines).map((l) => `${indent}${l}`).join('');
}

/** #3282: text-mode cap on LZ catalogue finding lines under probe 15. */
/**
 * #4113: NDJSON fields naming the LZ catalogue quality findings (grouped and
 * capped by the probe) so the log entry is actionable, not a bare count.
 */
export function lzQualityFindingsLogFields(probe: LzCatalogueCoverageProbeResult): Record<string, unknown> {
  if (!probe.quality_findings || probe.quality_findings.length === 0) return {};
  return {
    quality_findings: probe.quality_findings.map((f) => ({
      catalogue: f.catalogue,
      rule: f.rule,
      severity: f.severity,
      count: f.count,
      ...(f.regions.length > 0 ? { regions: f.regions } : {}),
      text: f.text,
    })),
    ...(probe.quality_findings_more ? { quality_findings_more: probe.quality_findings_more } : {}),
  };
}

// #2325: credential vault probe formatter.
function formatCredentialVaultProbeLine(probe: CredentialVaultProbeResult): string {
  const LABEL_W = 26;
  const label = pad(`[16/${PROBE_TOTAL}] Credential vault`, LABEL_W);
  switch (probe.status) {
    case 'ok':   return `  ${label}  ok    ${probe.message}`;
    case 'warn': return `  ${label}  WARN  ${probe.message}`;
    case 'fail': return `  ${label}  FAIL  ${probe.message}`;
  }
}

// #1016: report run directory count per app and warn when it exceeds 100.
export function checkRunAccumulation(workspacePath: string | null): string[] {
  if (!workspacePath) return [];
  const warnings: string[] = [];
  const appsDir = join(workspacePath, 'apps');
  if (!existsSync(appsDir)) return warnings;
  let apps: string[];
  try {
    apps = readdirSync(appsDir).filter(d => {
      try { return statSync(join(appsDir, d)).isDirectory(); } catch { return false; }
    });
  } catch { return warnings; }
  const HIGH_WATER = 100;
  for (const app of apps) {
    const runsDir = join(appsDir, app, 'wsp', 'runs');
    if (!existsSync(runsDir)) continue;
    try {
      const count = readdirSync(runsDir).filter(d => /^\d{4}-\d{2}-\d{2}/.test(d)).length;
      if (count > HIGH_WATER) {
        warnings.push(
          `[WARN] apps/${app}/wsp/runs/ has ${count} run directories. ` +
          `Add workspace.run_retention.keep_latest: N to .swao.yml to cap accumulation.`,
        );
      }
    } catch { /* skip unreadable */ }
  }
  return warnings;
}

// #3283: runs among the latest N per app whose run-status.json says `failed`
// or `aborted`, or that stayed `started` past the stale threshold (a crashed
// or killed run). Runs without a marker (before #3283) are not reported.
export const RUN_STATUS_LATEST_N = 10;
export function checkRunStatusMarkers(workspacePath: string | null, opts: { latestN?: number; now?: Date } = {}): string[] {
  if (!workspacePath) return [];
  const latestN = opts.latestN ?? RUN_STATUS_LATEST_N;
  const warnings: string[] = [];
  const appsDir = join(workspacePath, 'apps');
  if (!existsSync(appsDir)) return warnings;
  let apps: string[];
  try {
    apps = readdirSync(appsDir).filter(d => {
      try { return statSync(join(appsDir, d)).isDirectory(); } catch { return false; }
    }).sort();
  } catch { return warnings; }
  for (const app of apps) {
    const runsDir = join(appsDir, app, 'wsp', 'runs');
    if (!existsSync(runsDir)) continue;
    let runs: string[];
    try { runs = readdirSync(runsDir).filter(d => /^\d{4}-\d{2}-\d{2}/.test(d)).sort().reverse().slice(0, latestN); } catch { continue; }
    for (const run of runs) {
      const s = readRunStatus(join(runsDir, run));
      if (!s) continue;
      const where = `apps/${app}/wsp/runs/${run}`;
      if (s.status === 'failed' || s.status === 'aborted') {
        warnings.push(`[WARN] ${where}: ${s.assessment_type} run ${s.status}${s.exit_code !== undefined ? ` (exit ${s.exit_code})` : ''}${s.reason ? `: ${s.reason}` : ''}`);
      } else if (isRunStale(s, opts.now)) {
        warnings.push(`[WARN] ${where}: ${s.assessment_type} run started at ${s.started_at} and never closed (stale; the process was killed or crashed)`);
      }
    }
  }
  return warnings;
}

// #0192: extracted so health-check-json.test.ts can call this directly instead of
// spawning `npx tsx` per case (~150 s saved on a full vitest run). The CLI
// `.action` below reuses the exact same payload for `--format json`.
export interface HealthCheckPayload {
  license: LicenseProbeResult & { fingerprint: string };
  playwright: PlaywrightProbeResult;
  mcp: McpProbeResult;
  community_frameworks: CommunityFrameworksProbeResult;
  imports: ImportsProbeResult;
  traceability: TraceabilityProbeResult;
  bi_export: BiExportProbeResult;
  scope: ScopeProbeResult;
  prerequisites: PrerequisitesProbeResult;
  vcs_auth: VcsAuthProbeResult;
  // #0970: workspace-level ingestion folder probe.
  ingestion: IngestionProbeResult;
  iac_toolchain: IaCToolchainProbeResult;
  /** #1402 sprint-113: SWAO LLM-Gateway connector discovery + validation. #2897: ok: null = credential not loaded (SKIP). */
  llm_gateway: { ok: boolean | null; message: string };
  /** #1509: engagement.name placeholder guard. */
  wsp_metadata: WspMetadataProbeResult;
  /** #1698: LZ catalogue service-dep coverage check. */
  lz_catalogue_coverage: LzCatalogueCoverageProbeResult;
  /** #2325: credential vault accessibility + completeness. */
  credential_vault: CredentialVaultProbeResult;
  /** #3084: service intake column-mapping validation (skip outside service workspaces). */
  intake_mapping: IntakeMappingProbeResult;
  /** #3102: SWAO_APM domain_weights integrity (skip outside service workspaces). */
  apm_weights: ApmWeightsProbeResult;
  /** #3127-#3133: service workspace probes keyed by probe key. */
  service_probes: Record<string, ServiceProbeResult>;
  /** #3589: LZ connection probes [26] (read-only result and coverage per registered scope). */
  lz_connections: LzConnectionsProbeResult;
  llm_provider_errors: string[];
  lzr_snapshot_warnings: string[];
  llm_temperature_warnings: string[];
  llm_context_window_warnings: string[];
  placeholder_input_warnings: string[];
  lzr_coverage_info: string[];
  source_accessibility_warnings: string[];
  run_accumulation_warnings: string[];
  /** #3388 (Design 112): missing/empty seeded LLM gateway connector folder; auto-seeds best-effort. */
  seeded_asset_warnings: string[];
  /** #3283: failed, aborted or stale started runs among the latest N per app (run-status.json). */
  run_status_warnings: string[];
  /** #2968: .swao.yml context block validation messages. */
  context_config_messages: string[];
  /** #2956: image files in apps/<app>/ingestion/ without a .description.txt sidecar. */
  image_sidecar_warnings: string[];
}

export interface BuildHealthCheckContext {
  licenseProbe: LicenseProbeResult;
  licenseInvalid: boolean;
  fingerprint: string;
  playwrightProbe: PlaywrightProbeResult;
  mcpProbe: McpProbeResult;
  communityFrameworksProbe: CommunityFrameworksProbeResult;
  importsProbe: ImportsProbeResult;
  traceabilityProbe: TraceabilityProbeResult;
  biExportProbe: BiExportProbeResult;
  scopeProbe: ScopeProbeResult;
  prerequisitesProbe: PrerequisitesProbeResult;
  vcsAuthProbe: VcsAuthProbeResult;
  llmGatewayProbe: { ok: boolean | null; message: string };
  ingestionProbe: IngestionProbeResult;
  iacToolchainProbe: IaCToolchainProbeResult;
  wspMetadataProbe: WspMetadataProbeResult;
  lzCatalogueCoverageProbe: LzCatalogueCoverageProbeResult;
  /** #3282: provenance lines computed once in gatherProbes (logged + printed in text mode). */
  lzCatalogueProvenance?: string[];
  credentialVaultProbe: CredentialVaultProbeResult;
  intakeMappingProbe: IntakeMappingProbeResult;
  apmWeightsProbe: ApmWeightsProbeResult;
  /** #3127-#3133: service workspace probes [19]-[25]; each skips outside a service workspace. */
  serviceProbes: ServiceProbeResult[];
  /** #3589: probe [26], LZ connections. */
  lzConnectionsProbe: LzConnectionsProbeResult;
  /** #4260: the probe lines as printed (renumbered in a scoped run); absent in hand-built test contexts. */
  probeLines?: string[];
}

/**
 * #4461: one shared walk of the app configs and the probe meter for the whole
 * gather, so every probe reads apps/<id>/.swao.yml from one walk and a probe
 * over 10 s names its cause in health-check.probe.complete.
 */
async function gatherProbes(workspacePath: string, host: HealthCheckHostDeps, onProbeLineRaw?: (line: string) => void, scope?: SetupScope): Promise<BuildHealthCheckContext> {
  return withSharedAppConfigWalk(async () => {
    const stopMeter = startProbeMeter();
    try {
      return await gatherProbesMetered(workspacePath, host, onProbeLineRaw, scope);
    } finally {
      stopMeter();
    }
  });
}

async function gatherProbesMetered(workspacePath: string, host: HealthCheckHostDeps, onProbeLineRaw?: (line: string) => void, scope?: SetupScope): Promise<BuildHealthCheckContext> {
  // #4461: a probe start resets the meter, so each reading covers one probe.
  const probeStart = (message: string, opts: { context: Record<string, unknown> }): void => {
    takeProbeMeterReading();
    logPortfolio('info', 'health-check.probe.start', message, opts);
  };
  // #4197 (Design 125 section 6): with a scope, probes that do not serve it are
  // neither run nor listed; the listed lines are renumbered [k/M].
  const want = (k: HealthProbeKey): boolean => isProbeInScope(k, scope);
  // #4260: every printed probe line is kept (also in json and yaml mode), so the
  // warned probes of health-check.complete come from the very lines the Setup
  // Wizard parses (computeWarnedProbes).
  const probeLines: string[] = [];
  const onProbeLine = scopedProbeLineEmitter((line: string) => { probeLines.push(line); onProbeLineRaw?.(line); }, scope);
  // #4260: health-check.probe.complete takes its level from the status token of
  // the probe line (ok and INFO info, WARN warn, FAIL error). The line itself is
  // printed, so the console mirror is skipped.
  const completeProbe = (line: string, message: string, context: Record<string, unknown>): void => {
    // #4461: CPU time, files read and the slowest step; a slow_cause above SLOW_PROBE_MS.
    const elapsed = typeof context['elapsed_ms'] === 'number' ? context['elapsed_ms'] : 0;
    const metered = { ...context, ...probeMeterLogFields(elapsed, takeProbeMeterReading()) };
    logPortfolio(probeLineLogLevel(line), 'health-check.probe.complete', message, { context: metered, mirror: false });
    onProbeLine?.(line);
  };
  // #4461: the waits that need no probe result start now and overlap the first
  // probes (playwright launches a browser): the concurrent read of the app
  // configs and research stubs, and the tool version probes of prerequisites.
  // Each probe that needs them awaits them; the wait left is in its elapsed_ms.
  const prefetchStart = Date.now();
  // #4487: the prefetch is logged at its start and at its end (app inputs, tool version checks).
  logPortfolio('info', 'health-check.prefetch.start', 'prefetch: app inputs and tool version checks', {
    context: { app_inputs: true, research_stubs: want('research_cache'), tool_versions: want('prerequisites') },
    mirror: false,
  });
  // #4487: a failed prefetch is logged (the probes then read the files themselves).
  let prefetchError: string | null = null;
  const prefetchP = prefetchAppInputs(workspacePath, { researchStubs: want('research_cache') }).catch((err: unknown) => {
    prefetchError = err instanceof Error ? err.message : String(err);
    return null;
  });
  const prereqP: Promise<PrerequisiteDetections | null> | null = want('prerequisites')
    ? (host.detectPrerequisiteTools ?? (() => detectPrerequisiteTools()))()
      .then((d) => {
        // #4487 / #4488: per tool the wall clock, the outcome and the retry of a timed-out check.
        logPortfolio(d.timedOut.length > 0 ? 'warn' : 'info', 'health-check.prefetch.tools.complete', `tool version checks: ${Object.keys(d.outcome).length} tools in ${d.totalMs} ms${d.timedOut.length > 0 ? `, timed out: ${d.timedOut.join(', ')}` : ''}`, {
          context: { ms: d.ms, outcome: d.outcome, retry_ms: d.retryMs, timed_out: d.timedOut, total_ms: d.totalMs, since_start_ms: Date.now() - prefetchStart },
          mirror: false,
        });
        return d;
      })
      .catch(() => null)
    : null;
  const codeHealthP: Promise<DetectedCodeHealthTool[]> | null = want('prerequisites')
    ? (host.detectCodeHealthTools ?? (() => detectCodeHealthTools(fileBackedToolRunner, undefined, PROBE_DETECT_OPTIONS)))()
    : null;
  // Never an unhandled rejection while the first probes run; the probe awaits the original.
  codeHealthP?.catch(() => undefined);
  let licenseProbe: LicenseProbeResult;
  let licenseInvalid = false;
  let fingerprint: string = 'unknown';

  // #1786: emit probe.start/complete for every probe so the NDJSON event stream
  // captures per-probe timing and the last start entry identifies a hung probe.
  let t0 = Date.now();
  probeStart('probe: license', { context: { probe: 'license' } });
  try {
    const guard = LicenseGuard.load();
    fingerprint = guard.state.fingerprint.substring(0, 8);
    licenseProbe = buildLicenseProbe(guard.state);
  } catch (e) {
    if (e instanceof LicenseInvalidError) {
      licenseInvalid = true;
      licenseProbe = {
        status: 'invalid',
        tier: 'unknown',
        assessments_used: 0,
        days_elapsed: 0,
        warning: e.message,
      };
    } else {
      throw e;
    }
  }
  completeProbe(formatLicenseProbeLine(licenseProbe), `probe: license status=${licenseProbe.status}`, { probe: 'license', status: licenseProbe.status, elapsed_ms: Date.now() - t0 });

  // Playwright probe is host-injected + deferred (sprint-038 #0350): the host
  // supplies a thunk that lazy-imports playwright-driver so `--version` /
  // `--help` do not pay the ~50MB init cost.
  // #1682: per-probe portfolio-events so slow probes are visible in the log.
  // #1684: populate probe.start context with available config for support bundle.
  let playwrightProbe: PlaywrightProbeResult = notInScopeProbe<PlaywrightProbeResult>();
  if (want('playwright')) {
  t0 = Date.now();
  probeStart('probe: playwright', {
    context: {
      probe: 'playwright',
      chromium_path: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'] ?? process.env['CHROMIUM_PATH'] ?? undefined,
    },
  });
  playwrightProbe = await host.buildPlaywrightProbe();
  completeProbe(formatPlaywrightProbeLine(playwrightProbe), `probe: playwright status=${playwrightProbe.status}`, { probe: 'playwright', status: playwrightProbe.status, ...playwrightProbeLogFields(playwrightProbe), elapsed_ms: Date.now() - t0 });
  }

  t0 = Date.now();
  probeStart('probe: mcp', { context: { probe: 'mcp' } });
  const mcpProbe: McpProbeResult = buildMcpProbe();
  // #4392: the HTTP endpoint; a failing probe never fails the health check.
  if (host.mcpHttpProbe) {
    try { mcpProbe.http = await host.mcpHttpProbe(); } catch { /* informational only */ }
  }
  completeProbe(formatMcpProbeLine(mcpProbe), `probe: mcp status=${mcpProbe.status}`, { probe: 'mcp', status: mcpProbe.status, configs_checked: mcpProbe.configsChecked?.length ?? 0, stale_entries: mcpProbe.staleEntries?.length ?? 0, ...mcpProbeLogFields(mcpProbe), ...(mcpProbe.http ? { http_status: mcpProbe.http.status } : {}), elapsed_ms: Date.now() - t0 });

  // #4461: the prefetch of the app inputs is done before the first probe that reads apps/.
  {
    const waitStart = Date.now();
    const prefetch = await prefetchP;
    if (!prefetch && prefetchError !== null) {
      logPortfolio('warn', 'health-check.prefetch.failed', `app inputs prefetch failed: ${prefetchError}`, {
        context: { error: prefetchError, waited_ms: Date.now() - waitStart, since_start_ms: Date.now() - prefetchStart },
        mirror: false,
      });
    }
    if (prefetch) {
      logPortfolio('info', 'health-check.prefetch.complete', `app inputs read: ${prefetch.files_read} files (${prefetch.apps} apps, ${prefetch.service_apps} service apps)`, {
        context: { ...prefetch, waited_ms: Date.now() - waitStart, since_start_ms: Date.now() - prefetchStart },
        mirror: false,
      });
    }
  }

  t0 = Date.now();
  probeStart('probe: community_frameworks', { context: { probe: 'community_frameworks' } });
  const communityFrameworksProbe = buildCommunityFrameworksProbe(workspacePath);
  completeProbe(formatCommunityFrameworksProbeLine(communityFrameworksProbe), `probe: community_frameworks status=${communityFrameworksProbe.status}`, { probe: 'community_frameworks', status: communityFrameworksProbe.status, elapsed_ms: Date.now() - t0 });

  let importsProbe: ImportsProbeResult = notInScopeProbe<ImportsProbeResult>();
  if (want('imports')) {
  t0 = Date.now();
  probeStart('probe: imports', { context: { probe: 'imports' } });
  importsProbe = host.buildImportsProbe(workspacePath);
  completeProbe(formatImportsProbeLine(importsProbe), `probe: imports status=${importsProbe.status}`, { probe: 'imports', status: importsProbe.status, elapsed_ms: Date.now() - t0 });
  }

  let traceabilityProbe: TraceabilityProbeResult = notInScopeProbe<TraceabilityProbeResult>();
  if (want('traceability')) {
  t0 = Date.now();
  probeStart('probe: traceability', { context: { probe: 'traceability' } });
  traceabilityProbe = buildTraceabilityProbe(workspacePath);
  completeProbe(formatTraceabilityProbeLine(traceabilityProbe), `probe: traceability status=${traceabilityProbe.status}`, { probe: 'traceability', status: traceabilityProbe.status, elapsed_ms: Date.now() - t0 });
  }

  let biExportProbe: BiExportProbeResult = notInScopeProbe<BiExportProbeResult>();
  if (want('bi_export')) {
  t0 = Date.now();
  probeStart('probe: bi_export', { context: { probe: 'bi_export' } });
  biExportProbe = buildBiExportProbe(workspacePath);
  completeProbe(formatBiExportProbeLine(biExportProbe), `probe: bi_export status=${biExportProbe.status}`, { probe: 'bi_export', status: biExportProbe.status, elapsed_ms: Date.now() - t0 });
  }

  let scopeProbe: ScopeProbeResult = notInScopeProbe<ScopeProbeResult>();
  if (want('scope')) {
  t0 = Date.now();
  probeStart('probe: scope', { context: { probe: 'scope' } });
  scopeProbe = buildScopeProbe(workspacePath);  // #0263 Phase 2
  completeProbe(formatScopeProbeLine(scopeProbe), `probe: scope status=${scopeProbe.status}`, { probe: 'scope', status: scopeProbe.status, elapsed_ms: Date.now() - t0 });
  }

  let prerequisitesProbe: PrerequisitesProbeResult = notInScopeProbe<PrerequisitesProbeResult>();
  if (want('prerequisites')) {
  t0 = Date.now();
  probeStart('probe: prerequisites', { context: { probe: 'prerequisites' } });
  // #3487: optional Pass 26 code health tools, detected with the Windows-safe async runner.
  // #4461: both detections were started with the first probe and ran concurrently.
  const codeHealthTools = await meterStepAsync('detect code health tools', () => codeHealthP!);
  const detections = await meterStepAsync('detect tool versions', () => prereqP!);
  prerequisitesProbe = buildPrerequisitesProbe(workspacePath, { codeHealthTools, ...(detections ? { detect: detections.detect, unanswered: detections.unanswered } : {}) });  // #0326 sprint-036; #3375 VCS-aware git rule
  // #4488: per tool the wall clock, the outcome, the retry and the tools that timed out.
  completeProbe(formatPrerequisitesProbeLine(prerequisitesProbe), `probe: prerequisites status=${prerequisitesProbe.status}`, { probe: 'prerequisites', status: prerequisitesProbe.status, ...(detections ? { detect_ms: detections.ms, detect_outcome: detections.outcome, detect_retry_ms: detections.retryMs, detect_timed_out: detections.timedOut, detect_total_ms: detections.totalMs } : {}), elapsed_ms: Date.now() - t0 });
  }

  let vcsAuthProbe: VcsAuthProbeResult = notInScopeProbe<VcsAuthProbeResult>();
  if (want('vcs_auth')) {
  t0 = Date.now();
  probeStart('probe: vcs_auth', {
    context: { probe: 'vcs_auth', workspace_path: workspacePath },
  });
  vcsAuthProbe = await host.buildVcsAuthProbe(workspacePath);  // #0326 sprint-036
  completeProbe(formatVcsAuthProbeLine(vcsAuthProbe), `probe: vcs_auth status=${vcsAuthProbe.status}`, { probe: 'vcs_auth', status: vcsAuthProbe.status, elapsed_ms: Date.now() - t0 });
  }

  let ingestionProbe: IngestionProbeResult = notInScopeProbe<IngestionProbeResult>();
  if (want('ingestion')) {
  t0 = Date.now();
  probeStart('probe: ingestion', { context: { probe: 'ingestion' } });
  ingestionProbe = buildIngestionProbe(workspacePath);  // #0970
  completeProbe(formatIngestionFolderProbeLine(ingestionProbe), `probe: ingestion status=${ingestionProbe.status}`, { probe: 'ingestion', status: ingestionProbe.status, elapsed_ms: Date.now() - t0 });
  }

  let iacToolchainProbe: IaCToolchainProbeResult = notInScopeProbe<IaCToolchainProbeResult>();
  if (want('iac_toolchain')) {
  t0 = Date.now();
  probeStart('probe: iac_toolchain', { context: { probe: 'iac_toolchain' } });
  iacToolchainProbe = buildIaCToolchainProbe(workspacePath);  // #1328 design 085 OI-05; #4224 IaC sources decide a warning
  completeProbe(formatIaCToolchainProbeLine(iacToolchainProbe), `probe: iac_toolchain status=${iacToolchainProbe.status}`, { probe: 'iac_toolchain', status: iacToolchainProbe.status, elapsed_ms: Date.now() - t0 });
  }

  t0 = Date.now();
  probeStart('probe: llm_gateway', {
    context: {
      probe: 'llm_gateway',
      workspace_path: workspacePath,
      connector: process.env['SWAO_LLM_CONNECTOR'] ?? undefined,
    },
  });
  const llmGatewayProbe = await host.llmGatewayProbe.run({ workspacePath });  // #1402 sprint-113
  // #2318: include message in log when probe is not ok so support bundle captures the reason.
  // #2251: add status field (string) to match all other probe.complete events; ok:boolean kept for compat.
  // #2897: ok: null = credential not loaded (skip) -- distinct from fail.
  completeProbe(formatLlmGatewayLine(llmGatewayProbe), `probe: llm_gateway ok=${llmGatewayProbe.ok}`, { probe: 'llm_gateway', status: llmGatewayStatus(llmGatewayProbe), ok: llmGatewayProbe.ok, ...(llmGatewayProbe.ok !== true ? { message: llmGatewayProbe.message } : {}), elapsed_ms: Date.now() - t0 });

  t0 = Date.now();
  probeStart('probe: wsp_metadata', { context: { probe: 'wsp_metadata' } });
  const wspMetadataProbe = buildWspMetadataProbe(workspacePath);  // #1509 engagement placeholder guard
  completeProbe(formatWspMetadataProbeLine(wspMetadataProbe), `probe: wsp_metadata status=${wspMetadataProbe.status}`, { probe: 'wsp_metadata', status: wspMetadataProbe.status, elapsed_ms: Date.now() - t0 });

  let lzCatalogueCoverageProbe: LzCatalogueCoverageProbeResult = notInScopeProbe<LzCatalogueCoverageProbeResult>();
  let lzCatalogueProvenance: string[] = [];
  if (want('lz_catalogue_coverage')) {
  t0 = Date.now();
  probeStart('probe: lz_catalogue_coverage', { context: { probe: 'lz_catalogue_coverage' } });
  lzCatalogueCoverageProbe = buildLzCatalogueCoverageProbe(workspacePath);  // #1698
  completeProbe(formatLzCatalogueCoverageProbeLine(lzCatalogueCoverageProbe), `probe: lz_catalogue_coverage status=${lzCatalogueCoverageProbe.status}`, { probe: 'lz_catalogue_coverage', status: lzCatalogueCoverageProbe.status, gaps: lzCatalogueCoverageProbe.gaps_count, quality_errors: lzCatalogueCoverageProbe.quality?.errors ?? 0, quality_warnings: lzCatalogueCoverageProbe.quality?.warnings ?? 0, ...lzQualityFindingsLogFields(lzCatalogueCoverageProbe), elapsed_ms: Date.now() - t0 });
  // #2222: persist per-file provenance (hash, origin, last_updated) so Support Bundle
  // captures full catalogue detail without requiring text-format health-check output.
  lzCatalogueProvenance = checkLzCatalogueProvenance(workspacePath);  // #3282: once per run
  logPortfolio('info', 'health-check.lz-catalogue-provenance', 'LZ catalogue provenance', {
    context: { detail: lzCatalogueProvenance },
  });
  }

  t0 = Date.now();
  probeStart('probe: credential_vault', { context: { probe: 'credential_vault' } });
  const credentialVaultProbe = buildCredentialVaultProbe();  // #2325
  completeProbe(formatCredentialVaultProbeLine(credentialVaultProbe), `probe: credential_vault status=${credentialVaultProbe.status}`, { probe: 'credential_vault', status: credentialVaultProbe.status, key_count: credentialVaultProbe.keyCount, categories: credentialVaultProbe.categories, elapsed_ms: Date.now() - t0 });

  let intakeMappingProbe: IntakeMappingProbeResult = notInScopeProbe<IntakeMappingProbeResult>();
  if (want('intake_mapping')) {
  t0 = Date.now();
  probeStart('probe: intake_mapping', { context: { probe: 'intake_mapping' } });
  intakeMappingProbe = buildIntakeMappingProbe(workspacePath);  // #3084
  completeProbe(formatIntakeMappingProbeLine(intakeMappingProbe), `probe: intake_mapping status=${intakeMappingProbe.status}`, { probe: 'intake_mapping', status: intakeMappingProbe.status, errors: intakeMappingProbe.errors.length, warnings: intakeMappingProbe.warnings.length, elapsed_ms: Date.now() - t0 });
  }

  let apmWeightsProbe: ApmWeightsProbeResult = notInScopeProbe<ApmWeightsProbeResult>();
  if (want('apm_weights')) {
  t0 = Date.now();
  probeStart('probe: apm_weights', { context: { probe: 'apm_weights' } });
  apmWeightsProbe = buildApmWeightsProbe(workspacePath);  // #3102
  completeProbe(formatApmWeightsProbeLine(apmWeightsProbe), `probe: apm_weights status=${apmWeightsProbe.status}`, { probe: 'apm_weights', status: apmWeightsProbe.status, elapsed_ms: Date.now() - t0 });
  }

  // #3127-#3133 probes [19]-[25]. #3171: start/complete per probe, per-probe elapsed_ms.
  // #4295: before the first import the service workspace probe reports the recorded intake's rows, or why it cannot be read.
  let intakeCheck: RecordedIntakeCheck | null = null;
  if (want('service_workspace')) {
    try { intakeCheck = await checkRecordedIntake(workspacePath); } catch { intakeCheck = null; }
  }
  const serviceProbes = want('service_workspace') ? runServiceProbes(
    workspacePath,
    (level, code, message, opts) => {
      // #4461: the meter reading of each service probe (reset at its start).
      if (code === 'health-check.probe.start') {
        takeProbeMeterReading();
        logPortfolio(level, code, message, { ...opts, mirror: false });
        return;
      }
      const elapsed = typeof opts.context['elapsed_ms'] === 'number' ? opts.context['elapsed_ms'] : 0;
      logPortfolio(level, code, message, { context: { ...opts.context, ...probeMeterLogFields(elapsed, takeProbeMeterReading()) }, mirror: false });
    },
    (sp, i) => onProbeLine?.(formatServiceProbeLine(sp, i)),
    new Date(),
    Date.now,
    intakeCheck,
  ) : [];

  // #3589 probe [26]: LZ connections (read-only + coverage per registered scope).
  t0 = Date.now();
  if (want('lz_connections')) probeStart('probe: lz_connections', { context: { probe: 'lz_connections' } });
  let lzConnectionsProbe: LzConnectionsProbeResult = notInScopeProbe<LzConnectionsProbeResult>();
  if (want('lz_connections')) {
  try {
    lzConnectionsProbe = await (host.buildLzConnectionsProbe ?? ((ws: string) => buildLzConnectionsProbe(ws)))(workspacePath);
  } catch (e) {
    lzConnectionsProbe = { status: 'warn', message: `LZ connections could not be checked: ${(e as Error).message}`, scopes: [] };
  }
  completeProbe(formatLzConnectionsProbeLine(lzConnectionsProbe), `probe: lz_connections status=${lzConnectionsProbe.status}`, { probe: 'lz_connections', status: lzConnectionsProbe.status, scopes: lzConnectionsProbe.scopes.length, states: lzConnectionsProbe.scopes.map((s) => s.state), stale: lzConnectionsProbe.scopes.filter((s) => s.stale).length, elapsed_ms: Date.now() - t0 });
  }

  return {
    licenseProbe,
    licenseInvalid,
    fingerprint,
    playwrightProbe,
    mcpProbe,
    communityFrameworksProbe,
    importsProbe,
    traceabilityProbe,
    biExportProbe,
    scopeProbe,
    prerequisitesProbe,
    vcsAuthProbe,
    ingestionProbe,
    iacToolchainProbe,
    llmGatewayProbe,
    wspMetadataProbe,
    lzCatalogueCoverageProbe,
    lzCatalogueProvenance,
    credentialVaultProbe,
    intakeMappingProbe,
    apmWeightsProbe,
    serviceProbes,
    lzConnectionsProbe,
    probeLines,
  };
}

/**
 * #4197 (Design 125 section 6): the payload of a scoped run keeps the probes
 * and checks of the scope only (`service_probes` follows `service_workspace`).
 */
export function filterHealthCheckPayload(payload: HealthCheckPayload, scope: SetupScope | undefined): Partial<HealthCheckPayload> {
  if (scope === undefined) return payload;
  return Object.fromEntries(Object.entries(payload).filter(([k]) => {
    if (k === 'service_probes') return isProbeInScope('service_workspace', scope);
    if (k.endsWith('_warnings') || k.endsWith('_errors') || k.endsWith('_info') || k.endsWith('_messages')) return isCheckInScope(k, scope);
    return isProbeInScope(k, scope);
  })) as Partial<HealthCheckPayload>;
}

/** #4197: parses `--type`; accepts the setup ids, `generic` and the assess type ids. */
export function parseHealthCheckScope(value: string | undefined): SetupScope | undefined | Error {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'generic') return 'generic';
  const t = parseSetupAssessmentType(v);
  return t ?? new Error(`unknown --type ${value}; expected one of ${SETUP_SCOPES.join(', ')}`);
}

export async function buildHealthCheckPayload(workspacePath: string, host: HealthCheckHostDeps): Promise<HealthCheckPayload> {
  return buildPayloadFromContext(workspacePath, await gatherProbes(workspacePath, host));
}

/** #4197: the payload of one scope; probes outside it are not run. */
export async function buildScopedHealthCheckPayload(workspacePath: string, host: HealthCheckHostDeps, scope: SetupScope): Promise<Partial<HealthCheckPayload>> {
  return filterHealthCheckPayload(buildPayloadFromContext(workspacePath, await gatherProbes(workspacePath, host, undefined, scope)), scope);
}

function buildPayloadFromContext(workspacePath: string, ctx: BuildHealthCheckContext): HealthCheckPayload {
  return {
    license: { ...ctx.licenseProbe, fingerprint: ctx.fingerprint },
    playwright: ctx.playwrightProbe,
    mcp: ctx.mcpProbe,
    community_frameworks: ctx.communityFrameworksProbe,
    imports: ctx.importsProbe,
    traceability: ctx.traceabilityProbe,
    bi_export: ctx.biExportProbe,
    scope: ctx.scopeProbe,
    prerequisites: ctx.prerequisitesProbe,
    vcs_auth: ctx.vcsAuthProbe,
    ingestion: ctx.ingestionProbe,
    iac_toolchain: ctx.iacToolchainProbe,
    llm_gateway: ctx.llmGatewayProbe,
    wsp_metadata: ctx.wspMetadataProbe,
    llm_provider_errors: checkLlmProviderConfig(workspacePath),
    lzr_snapshot_warnings: checkLzrSnapshots(workspacePath, readLzrMaxAgeDays(workspacePath)),
    llm_temperature_warnings: checkLlmTemperature(workspacePath),
    llm_context_window_warnings: checkLlmContextWindow(workspacePath),
    placeholder_input_warnings: checkPlaceholderInputs(workspacePath),
    lzr_coverage_info: checkLzrCoveragePerApp(workspacePath),
    source_accessibility_warnings: checkSourceAccessibility(workspacePath),
    seeded_asset_warnings: checkSeededAssets(workspacePath),
    run_accumulation_warnings: checkRunAccumulation(workspacePath),
    run_status_warnings: checkRunStatusMarkers(workspacePath),
    context_config_messages: checkContextConfig(workspacePath),
    image_sidecar_warnings: checkImageSidecars(workspacePath),
    lz_catalogue_coverage: ctx.lzCatalogueCoverageProbe,
    credential_vault: ctx.credentialVaultProbe,
    intake_mapping: ctx.intakeMappingProbe,
    apm_weights: ctx.apmWeightsProbe,
    service_probes: Object.fromEntries(ctx.serviceProbes.map((sp) => [sp.key, sp])),
    lz_connections: ctx.lzConnectionsProbe,
  };
}

/**
 * #3170: the single definition of a health-check failure, shared by the
 * health-check.complete NDJSON event (fail_count / failed_probes), the
 * `--json` exit code, the text-mode exit code and the text summary line that
 * the Setup Wizard reads. Only FAIL-level outcomes count: WARN, INFO, skip,
 * absent and the MCP probe's binary_not_found / missing_entry states are
 * warnings, never failures. Before #3170 the three call sites each kept their
 * own list and disagreed (imports, traceability, BI export, VCS auth and the
 * LLM gateway were counted by some and not others).
 */
export function computeFailedProbes(ctx: BuildHealthCheckContext): string[] {
  const failed: string[] = [];
  if (ctx.licenseInvalid) failed.push('license');
  if (ctx.playwrightProbe.status === 'fail') failed.push('playwright');
  if (ctx.communityFrameworksProbe.status === 'fail') failed.push('community-frameworks');
  if (ctx.importsProbe.status === 'fail' || ctx.importsProbe.status === 'blocked') failed.push('imports');
  if (ctx.traceabilityProbe.status === 'fail') failed.push('traceability');
  if (ctx.biExportProbe.status === 'fail') failed.push('bi-export');
  if (ctx.prerequisitesProbe.status === 'fail') failed.push('prerequisites');
  if (ctx.vcsAuthProbe.status === 'fail') failed.push('vcs-auth');
  if (ctx.llmGatewayProbe.ok === false) failed.push('llm-gateway');  // #2897: null = skip, not failure
  if (ctx.credentialVaultProbe.status === 'fail') failed.push('credential-vault');
  if (ctx.intakeMappingProbe.status === 'error') failed.push('intake-mapping');
  if (ctx.apmWeightsProbe.status === 'error') failed.push('apm-weights');
  for (const sp of ctx.serviceProbes) if (sp.status === 'error') failed.push(sp.key.replace(/_/g, '-'));
  return failed;
}

/**
 * #3170: text-mode epilogue. The Setup Wizard parses this line (via
 * summariseHealthCheckOutput) instead of re-deriving failures from the probe
 * lines, so both always report the same count.
 */
export function formatHealthCheckSummaryLine(failedProbes: readonly string[], warnedProbes: readonly string[] = []): string {
  // #4260: "All probes passed." only when no probe failed or warned; the
  // warnings line names the warned probes (read by summariseHealthCheckOutput).
  const failLine = failedProbes.length > 0
    ? `${failedProbes.length} probe(s) failed: ${failedProbes.join(', ')}.`
    : warnedProbes.length > 0 ? 'No probe failed.' : 'All probes passed.';
  return warnedProbes.length === 0 ? failLine : `${failLine}\n${formatHealthCheckWarningsLine(warnedProbes)}`;
}

/** #4260: the runner's warnings epilogue, "Warnings (2): SWAO-MCP, IaC toolchain." */
export function formatHealthCheckWarningsLine(warnedProbes: readonly string[]): string {
  return `Warnings (${warnedProbes.length}): ${warnedProbes.join(', ')}.`;
}

/** #4260: a path with the user's home folder replaced by `<home>` (log redaction). */
export function redactHomePath(p: string, home: string = homedir()): string {
  if (!home) return p;
  const win = process.platform === 'win32';
  const hay = win ? p.toLowerCase() : p;
  const needle = win ? home.toLowerCase() : home;
  return hay.startsWith(needle) ? `<home>${p.slice(home.length)}` : p;
}

/**
 * #4260: the MCP probe fields of health-check.probe.complete: the checked
 * config entry (effective config and command, home folder redacted) and, for
 * binary_unreachable, the reason code of the `--version` check.
 */
export function mcpProbeLogFields(probe: McpProbeResult, home: string = homedir()): Record<string, unknown> {
  if (probe.status === 'ok' || probe.status === 'not_installed') return {};
  return {
    config_path: redactHomePath(probe.configPath, home),
    ...(probe.commandPath ? { command_path: redactHomePath(probe.commandPath, home) } : {}),
    ...(probe.reason ? { reason: probe.reason } : {}),
  };
}

/** #4260: log level of a printed probe line from its status token (ok and INFO info, WARN warn, FAIL error). */
export function probeLineLogLevel(line: string): 'info' | 'warn' | 'error' {
  const status = parseHealthCheckOutput(line.split('\n'))[0]?.status;
  return status === 'FAIL' ? 'error' : status === 'WARN' ? 'warn' : 'info';
}

/** #4261: name of the source accessibility check when it counts as a warning. */
export const SOURCE_ACCESS_WARNING_NAME = 'Source access';

/**
 * #4260: the warned probes of a run, by the display name of the probe line
 * (the names the Setup Wizard reports in setup.health-check.complete). The
 * probe lines are parsed with the wizard's own parser, so both events agree.
 * #4261: a `[WARN]` entry of the source accessibility check counts as a
 * warning named "Source access".
 */
export function computeWarnedProbes(ctx: BuildHealthCheckContext, checks?: Record<string, string[]>, scope?: SetupScope): string[] {
  const lines = (ctx.probeLines ?? []).flatMap((l) => l.split('\n'));
  const warned = parseHealthCheckOutput(lines).filter((p) => p.status === 'WARN').map((p) => p.name);
  const source = checks?.['source_accessibility_warnings'] ?? [];
  if (isCheckInScope('source_accessibility_warnings', scope) && source.some((w) => w.startsWith('[WARN]'))) warned.push(SOURCE_ACCESS_WARNING_NAME);
  // #4262: a service-scoped check in which every service probe skipped checked
  // nothing of the service setup; that is a warning naming the reason.
  if (scope === 'service' && allServiceProbesSkipped(ctx)) warned.push(SERVICE_PROBES_SKIPPED_NAME);
  return warned;
}

/** #4262: warned-check name of a service-scoped run whose service probes all skipped. */
export const SERVICE_PROBES_SKIPPED_NAME = 'Service probes (all skipped as not a service workspace)';

/** #4262: true when the intake mapping, SWAO_APM weights and probes [19] to [25] all skipped. */
export function allServiceProbesSkipped(ctx: BuildHealthCheckContext): boolean {
  return ctx.serviceProbes.length > 0
    && ctx.serviceProbes.every((sp) => sp.status === 'skip')
    && ctx.intakeMappingProbe.status === 'skip'
    && ctx.apmWeightsProbe.status === 'skip';
}

/** #4261: number of apps (apps/<id>/.swao.yml) in the workspace. */
export function countConfiguredApps(workspacePath: string): number {
  const appsDir = join(workspacePath, 'apps');
  try {
    return readdirSync(appsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(appsDir, e.name, '.swao.yml'))).length;
  } catch {
    return 0;
  }
}

/**
 * #4260 / #4261: the health-check.complete message. It never says "all probes
 * ok" when a probe failed or warned, and names the app count instead of "no
 * apps to assess" when apps exist but none has an assessment run yet.
 */
export function formatHealthCheckCompleteMessage(input: {
  failedProbes: readonly string[];
  warnedProbes: readonly string[];
  /** Probes that reported `absent` because no app or no run exists (scope, traceability). */
  absentProbes: readonly string[];
  appCount: number;
}): string {
  const { failedProbes, warnedProbes, absentProbes, appCount } = input;
  const warnText = warnedProbes.length > 0 ? `${warnedProbes.length} warning(s): ${warnedProbes.join(', ')}` : '';
  if (failedProbes.length > 0) {
    return `Health-check found ${failedProbes.length} failure(s): ${failedProbes.join(', ')}${warnText ? `; ${warnText}` : ''}`;
  }
  const skipped = absentProbes.length > 0 ? ` (${absentProbes.join(', ')} skipped)` : '';
  const apps = absentProbes.length === 0 ? ''
    : appCount === 0 ? `, workspace only, no apps yet${skipped}`
    : `, ${appCount} app(s) configured, none assessed yet${skipped}`;
  if (warnedProbes.length > 0) return `Health-check passed with ${warnText}${apps}`;
  return apps ? `Health-check passed${apps}` : 'Health-check passed, all probes ok';
}

// #1094: extracted so health-check-json.test.ts can unit-test the log context
// without spawning the CLI. Mirrors the #0192 pattern for buildHealthCheckPayload.
// Returns the compact per-probe context written to health-check.complete.
export function buildHealthCheckLogContext(
  ctx: BuildHealthCheckContext,
  failedProbes: string[],
  checks?: Record<string, string[]>,
  scope?: SetupScope,
): Record<string, unknown> {
  // #4197: a scoped run logs only the probes and checks of its scope.
  if (scope !== undefined) {
    const full = buildHealthCheckLogContext(ctx, failedProbes, checks ? Object.fromEntries(Object.entries(checks).filter(([k]) => isCheckInScope(k, scope))) : undefined);
    const probes = Object.fromEntries(Object.entries(full['probes'] as Record<string, unknown>).filter(([k]) => isProbeInScope(k, scope)));
    const warned = computeWarnedProbes(ctx, checks, scope);
    return { ...full, scope, probe_count: Object.keys(probes).length, warn_count: warned.length, warned_probes: warned, probes };
  }
  // #3388: the string[] check results (warnings / info / seed detection) are
  // logged alongside the 25 probes so health-check.complete is a complete record.
  // Every supplied check is logged, including the ones that came back clean (an
  // empty array documents "this check ran and found nothing to report") -- the
  // operator asked that all health checks be documented in the log, not only the
  // ones that failed. The `checks` key is omitted only when no checks are
  // supplied at all (the verdict-only log context).
  const checkResults = checks
    ? Object.fromEntries(Object.entries(checks).filter(([, v]) => Array.isArray(v)))
    : undefined;
  // #1683: include message field for warn/info probes so support bundle captures the reason.
  function probeEntry(probe: { status: string; message?: string | null; warning?: string | null }): Record<string, unknown> {
    const entry: Record<string, unknown> = { status: probe.status };
    const msg = probe.message ?? probe.warning;
    if (msg && probe.status !== 'ok') entry.message = msg;
    return entry;
  }
  // #4260: warn_count / warned_probes, the same list setup.health-check.complete reports.
  const warnedProbes = computeWarnedProbes(ctx, checks);
  return {
    fail_count: failedProbes.length,
    failed_probes: failedProbes,
    warn_count: warnedProbes.length,
    warned_probes: warnedProbes,
    probe_count: PROBE_TOTAL,
    ...(checkResults && Object.keys(checkResults).length > 0 ? { checks: checkResults } : {}),
    probes: {
      license: probeEntry(ctx.licenseProbe),
      // #4451: a warn or fail carries its reason and message.
      playwright: { status: ctx.playwrightProbe.status, ...playwrightProbeLogFields(ctx.playwrightProbe) },
      mcp: probeEntry(ctx.mcpProbe),
      community_frameworks: {
        ...probeEntry(ctx.communityFrameworksProbe),
        community_count: ctx.communityFrameworksProbe.community_count,
      },
      imports: probeEntry(ctx.importsProbe),
      traceability: probeEntry(ctx.traceabilityProbe),
      bi_export: probeEntry(ctx.biExportProbe),
      scope: probeEntry(ctx.scopeProbe),
      prerequisites: probeEntry(ctx.prerequisitesProbe),
      vcs_auth: probeEntry(ctx.vcsAuthProbe),
      ingestion: { ...probeEntry(ctx.ingestionProbe), file_count: ctx.ingestionProbe.file_count },
      iac_toolchain: probeEntry(ctx.iacToolchainProbe),
      // #2318: include message when probe is not ok. #2897: null = skip (credential not loaded).
      llm_gateway: { status: llmGatewayStatus(ctx.llmGatewayProbe), ...(ctx.llmGatewayProbe.ok !== true ? { message: ctx.llmGatewayProbe.message } : {}) },
      wsp_metadata: probeEntry(ctx.wspMetadataProbe),
      lz_catalogue_coverage: {
        ...probeEntry(ctx.lzCatalogueCoverageProbe),
        gaps_count: ctx.lzCatalogueCoverageProbe.gaps_count,
        // #3282: quality rule counts (the full findings list is in --json).
        ...(ctx.lzCatalogueCoverageProbe.quality ? { quality_errors: ctx.lzCatalogueCoverageProbe.quality.errors, quality_warnings: ctx.lzCatalogueCoverageProbe.quality.warnings } : {}),
        // #4113: the findings by name (catalogue, rule, short text), capped with a count of the rest.
        ...lzQualityFindingsLogFields(ctx.lzCatalogueCoverageProbe),
      },
      credential_vault: { ...probeEntry(ctx.credentialVaultProbe), key_count: ctx.credentialVaultProbe.keyCount, categories: ctx.credentialVaultProbe.categories },
      intake_mapping: probeEntry(ctx.intakeMappingProbe),
      apm_weights: probeEntry(ctx.apmWeightsProbe),
      ...Object.fromEntries(ctx.serviceProbes.map((sp) => [sp.key, probeEntry(sp)])),
      lz_connections: { ...probeEntry(ctx.lzConnectionsProbe), scopes: ctx.lzConnectionsProbe.scopes.length },
    },
  };
}

export function registerHealthCheck(program: Command, host: HealthCheckHostDeps): void {
  program
    .command('health-check')
    .alias('doctor') // #2745: restore backward-compat alias removed from module rename (sprint-074)
    .description('Health Check: run pre-flight environment checks -- licence state, Playwright/Chromium, SWAO-MCP server, compliance catalogues, import templates, traceability, BI export, scope, prerequisites, VCS auth, ingestion folder, IaC toolchain, LLM gateway, engagement metadata, LZ catalogue coverage, credential vault, service intake mapping, SWAO_APM weights, and service workspace checks (25 probes total).')
    .option('--format <fmt>', 'Output format: text, yaml, or json (default: text)', 'text')
    .option('--json', 'Shorthand for --format json; exits with code 1 when errors are present')
    .option('--workspace <path>', 'Workspace path (default: current directory)')
    .option('--type <type>', 'Run only the probes of one setup scope: generic, application, service, lz-catalog, lz-live or llm (Design 125)')
    .action(async (opts: { format: string; json?: boolean; workspace?: string; type?: string }) => {
      if (opts.json) opts.format = 'json';
      // #4197: scoped health check (Design 125 section 6).
      const scope = parseHealthCheckScope(opts.type);
      if (scope instanceof Error) {
        console.error(`[error] ${scope.message}`);
        process.exit(2);
      }
      if (scope !== undefined && opts.format === 'yaml') {
        console.error('[error] --type supports the text and json formats');
        process.exit(2);
      }
      if (opts.format === 'text') {
        // #4430: name the build, so two builds of one version can be told apart.
        console.log(host.swaoVersionLabel ? `Running swao health-check (SWAO ${host.swaoVersionLabel})...\n` : 'Running swao health-check...\n');
      }

      const workspacePath = opts.workspace ? resolve(opts.workspace) : process.cwd();
      // #3388 / #3406: only a directory with a `.swao.yml` is a real workspace.
      // health-check resolves the path from process.cwd() when no `--workspace` is
      // given, so without this guard a run from any directory writes a wsp/ tree
      // there (seeds, scaffolds and NDJSON logs). The read-only environment probes
      // still run. Passing null to setWorkspaceRoot makes emit() fall back to
      // resolveWorkspaceRoot(), which drops file writes outside a workspace.
      const isRealWorkspace = existsSync(join(workspacePath, '.swao.yml'));
      setWorkspaceRoot(isRealWorkspace ? workspacePath : null);
      if (isRealWorkspace) {
        seedIngestionSidecarExample(workspacePath); // #2956: seed sidecar template into wsp/inputs/
      }
      // #1685: include environment context in health-check.start for support bundle diagnostics.
      let startTier = 'unknown';
      try { startTier = LicenseGuard.load().state.tier ?? 'unknown'; } catch { /* best-effort */ }
      logPortfolio('info', 'health-check.start', 'Health-check starting', {
        context: {
          workspace: workspacePath,
          format: opts.format,
          tier: startTier,
          platform: process.platform,
          node_version: process.version,
          dev_build: process.env['SWAO_DEV_BUILD'] === '1',
          // #4430: the build that ran the check (build-info stamp of the bundle).
          ...buildProvenance(),
        },
      });
      const onProbeLine = opts.format === 'text' ? console.log : undefined;
      const ctx = await gatherProbes(workspacePath, host, onProbeLine, scope);
      const {
        licenseProbe,
        fingerprint,
        playwrightProbe,
        mcpProbe,
        communityFrameworksProbe,
        importsProbe,
        traceabilityProbe,
        biExportProbe,
        scopeProbe,
        prerequisitesProbe,
        vcsAuthProbe,
        ingestionProbe,
        iacToolchainProbe,
        llmGatewayProbe,
        wspMetadataProbe,
        lzCatalogueCoverageProbe,
        credentialVaultProbe,
        intakeMappingProbe,
        apmWeightsProbe,
        serviceProbes,
        lzConnectionsProbe,
      } = ctx;

      // #3170: one shared failure definition for the log, the JSON exit code and the text summary.
      const hcFailedProbes = computeFailedProbes(ctx);
      // #1047: scope and traceability probes return 'absent' when no apps exist.
      // Report this in the summary so the operator knows the check was partial.
      const hcAbsentProbes: string[] = [];
      if (scopeProbe.status === 'absent') hcAbsentProbes.push('scope');
      if (traceabilityProbe.status === 'absent') hcAbsentProbes.push('traceability');
      // #3388: capture every string[] check result so health-check.complete (log
      // + NDJSON) records the full outcome, not only the 25 probes.
      const loggedChecks: Record<string, string[]> = {
        llm_provider_errors:         checkLlmProviderConfig(workspacePath),
        lzr_snapshot_warnings:       checkLzrSnapshots(workspacePath, readLzrMaxAgeDays(workspacePath)),
        llm_temperature_warnings:    checkLlmTemperature(workspacePath),
        llm_context_window_warnings: checkLlmContextWindow(workspacePath),
        placeholder_input_warnings:  checkPlaceholderInputs(workspacePath),
        lzr_coverage_info:           checkLzrCoveragePerApp(workspacePath),
        source_accessibility_warnings: checkSourceAccessibility(workspacePath),
        seeded_asset_warnings:       checkSeededAssets(workspacePath),
        run_accumulation_warnings:   checkRunAccumulation(workspacePath),
        run_status_warnings:         checkRunStatusMarkers(workspacePath),
        context_config_messages:     checkContextConfig(workspacePath),
        image_sidecar_warnings:      checkImageSidecars(workspacePath),
        lz_catalogue_provenance:     ctx.lzCatalogueProvenance ?? [],
      };
      // #4260: the warned probes (same list as the wizard's setup.health-check.complete).
      const hcWarnedProbes = computeWarnedProbes(ctx, loggedChecks, scope);
      const hcLevel = hcFailedProbes.length > 0 || hcWarnedProbes.length > 0 ? 'warn' : 'info';
      logPortfolio(
        hcLevel,
        'health-check.complete',
        formatHealthCheckCompleteMessage({
          failedProbes: hcFailedProbes,
          warnedProbes: hcWarnedProbes,
          absentProbes: hcAbsentProbes,
          appCount: countConfiguredApps(workspacePath),
        }),
        // A warnings-only run is shown by the probe lines and the summary; the
        // console mirror stays for failures as before.
        { context: buildHealthCheckLogContext(ctx, hcFailedProbes, loggedChecks, scope), mirror: hcFailedProbes.length > 0 },
      );

      // #1277: persist results to wsp/logs/health-check-YYYY-MM.ndjson so
      // operators can review history without parsing the full portfolio log.
      // #3388 / #3406: only inside a real workspace, so a non-workspace run (cwd)
      // writes no log tree.
      if (isRealWorkspace) try {
        const logsDir = join(workspacePath, 'wsp', 'logs');
        const month   = new Date().toISOString().slice(0, 7);
        mkdirSync(logsDir, { recursive: true });
        // #1890-1892: add event + level so the log-monitor schema validator
        // treats health-check lines identically to portfolio-events lines.
        const entry = JSON.stringify({
          ts:        new Date().toISOString(),
          event:     'health-check.complete',
          level:     hcLevel,
          workspace: workspacePath,
          ...buildHealthCheckLogContext(ctx, hcFailedProbes, loggedChecks, scope),
        });
        appendFileSync(join(logsDir, `health-check-${month}.ndjson`), entry + '\n', 'utf-8');
      } catch {
        // log write failures must never abort the health-check run
      }

      if (opts.format === 'json') {
        // #0024: machine-readable JSON output for CI consumers, MCP, and
        // any tool that does not want to parse YAML.
        const maxAge = readLzrMaxAgeDays(workspacePath);
        const llmProviderErrors = checkLlmProviderConfig(workspacePath);
        const lzrSnapshotWarnings = checkLzrSnapshots(workspacePath, maxAge);
        const llmTempWarnings = checkLlmTemperature(workspacePath);
        const llmContextWarnings = checkLlmContextWindow(workspacePath);
        const placeholderWarnings = checkPlaceholderInputs(workspacePath);
        const lzrCoverageInfo = checkLzrCoveragePerApp(workspacePath);
        const payload: HealthCheckPayload = {
          license: { ...licenseProbe, fingerprint },
          playwright: playwrightProbe,
          mcp: mcpProbe,
          community_frameworks: communityFrameworksProbe,
          imports: importsProbe,
          traceability: traceabilityProbe,
          bi_export: biExportProbe,
          scope: scopeProbe,
          prerequisites: prerequisitesProbe,
          vcs_auth: vcsAuthProbe,
          // #3215: reuse the gatherProbes results; each probe runs once per invocation.
          ingestion: ingestionProbe,
          iac_toolchain: iacToolchainProbe,
          llm_gateway: llmGatewayProbe,
          wsp_metadata: wspMetadataProbe,
          lz_catalogue_coverage: lzCatalogueCoverageProbe,
          credential_vault: credentialVaultProbe,
          intake_mapping: intakeMappingProbe,
          apm_weights: apmWeightsProbe,
          service_probes: Object.fromEntries(serviceProbes.map((sp) => [sp.key, sp])),
          lz_connections: lzConnectionsProbe,
          llm_provider_errors: llmProviderErrors,
          lzr_snapshot_warnings: lzrSnapshotWarnings,
          llm_temperature_warnings: llmTempWarnings,
          llm_context_window_warnings: llmContextWarnings,
          placeholder_input_warnings: placeholderWarnings,
          lzr_coverage_info: lzrCoverageInfo,
          source_accessibility_warnings: checkSourceAccessibility(workspacePath),
          seeded_asset_warnings: checkSeededAssets(workspacePath),
          run_accumulation_warnings: checkRunAccumulation(workspacePath),
          run_status_warnings: checkRunStatusMarkers(workspacePath),
          context_config_messages: checkContextConfig(workspacePath),
          image_sidecar_warnings: checkImageSidecars(workspacePath),
        };
        console.log(JSON.stringify(filterHealthCheckPayload(payload, scope), null, 2));
        // #0550: llmProviderErrors is now WARN-level (LLM-optional); it no
        // longer fails doctor. The assessment completes without an LLM.
        // #1790: blocked status (e.g. imports probe with missing required column)
        // is treated as an error for CI consumers -- exit 1 so scripts can detect it.
        // #2229: call process.exit() unconditionally so dangling HTTP connections
        // from the LLM gateway probe do not hold the event loop open when stdout
        // is a pipe (Windows grandchild pipe deadlock variant).
        // #3170: same failure definition as health-check.complete fail_count.
        const hasErrors = hcFailedProbes.length > 0;
        process.exit(hasErrors ? 1 : 0);
      } else if (opts.format === 'yaml') {
        const yamlLines = [
          'health_check:',
          '  license:',
          `    status: ${licenseProbe.status}`,
          `    tier: ${licenseProbe.tier}`,
          `    assessments_used: ${licenseProbe.assessments_used}`,
          `    assessments_limit: ${licenseProbe.assessments_limit === undefined ? 'null' : licenseProbe.assessments_limit}`,
          `    days_elapsed: ${licenseProbe.days_elapsed}`,
          `    days_until_expiry: ${licenseProbe.days_until_expiry === undefined || licenseProbe.days_until_expiry === null ? 'null' : licenseProbe.days_until_expiry}`,
          `    warning: ${licenseProbe.warning === null ? 'null' : JSON.stringify(licenseProbe.warning)}`,
          `    fingerprint: ${fingerprint}`,
          '  playwright:',
          `    status: ${playwrightProbe.status}`,
          `    version: ${playwrightProbe.version === null ? 'null' : JSON.stringify(playwrightProbe.version)}`,
          `    path: ${playwrightProbe.path === null ? 'null' : JSON.stringify(playwrightProbe.path)}`,
          `    error: ${playwrightProbe.error === null ? 'null' : JSON.stringify(playwrightProbe.error)}`,
          ...(playwrightProbe.reason ? [`    reason: ${playwrightProbe.reason}`] : []),
          ...(playwrightProbe.detail ? [`    detail: ${JSON.stringify(playwrightProbe.detail)}`] : []),
          '  mcp:',
          `    status: ${mcpProbe.status}`,
          `    config_path: ${JSON.stringify(mcpProbe.configPath)}`,
          `    command_path: ${mcpProbe.commandPath === null ? 'null' : JSON.stringify(mcpProbe.commandPath)}`,
          '  community_frameworks:',
          `    status: ${communityFrameworksProbe.status}`,
          `    catalogs_dir: ${JSON.stringify(communityFrameworksProbe.catalogs_dir)}`,
          `    standard_count: ${communityFrameworksProbe.standard_count}`,
          `    community_count: ${communityFrameworksProbe.community_count}`,
          `    collisions: ${JSON.stringify(communityFrameworksProbe.collisions)}`,
          `    warnings: ${JSON.stringify(communityFrameworksProbe.warnings)}`,
          `    errors: ${JSON.stringify(communityFrameworksProbe.errors)}`,
          `    frameworks: ${JSON.stringify(communityFrameworksProbe.frameworks)}`,
          '  imports:',
          `    status: ${importsProbe.status}`,
          `    message: ${JSON.stringify(importsProbe.message)}`,
          `    findings: ${JSON.stringify(importsProbe.findings)}`,
          '  traceability:',
          `    status: ${traceabilityProbe.status}`,
          `    message: ${JSON.stringify(traceabilityProbe.message)}`,
          `    apps: ${JSON.stringify(traceabilityProbe.apps)}`,
          `    targets: ${JSON.stringify(traceabilityProbe.targets)}`,
          '  bi_export:',
          `    status: ${biExportProbe.status}`,
          `    bundle_dir: ${biExportProbe.bundle_dir === null ? 'null' : JSON.stringify(biExportProbe.bundle_dir)}`,
          `    message: ${JSON.stringify(biExportProbe.message)}`,
          `    findings: ${JSON.stringify(biExportProbe.findings)}`,
          '  scope:',
          `    status: ${scopeProbe.status}`,
          `    apps_with_scope: ${scopeProbe.apps_with_scope}`,
          `    apps_total: ${scopeProbe.apps_total}`,
          `    total_blind_spots: ${scopeProbe.total_blind_spots}`,
          `    closed: ${scopeProbe.closed}`,
          `    partial: ${scopeProbe.partial}`,
          `    open: ${scopeProbe.open}`,
          `    coverage_ratio: ${scopeProbe.coverage_ratio}`,
          `    message: ${JSON.stringify(scopeProbe.message)}`,
          '  prerequisites:',
          `    status: ${prerequisitesProbe.status}`,
          `    message: ${JSON.stringify(prerequisitesProbe.message)}`,
          `    tools: ${JSON.stringify(prerequisitesProbe.tools)}`,
          '  vcs_auth:',
          `    status: ${vcsAuthProbe.status}`,
          `    message: ${JSON.stringify(vcsAuthProbe.message)}`,
          `    apps: ${JSON.stringify(vcsAuthProbe.apps)}`,
          '  ingestion:',
          `    status: ${ingestionProbe.status}`,
          `    file_count: ${ingestionProbe.file_count}`,
          `    has_manifest: ${ingestionProbe.has_manifest}`,
          `    message: ${JSON.stringify(ingestionProbe.message)}`,
          '  iac_toolchain:',
          `    status: ${iacToolchainProbe.status}`,
          `    message: ${JSON.stringify(iacToolchainProbe.message)}`,
          '  wsp_metadata:',
          `    status: ${wspMetadataProbe.status}`,
          `    engagement_name: ${JSON.stringify(wspMetadataProbe.engagement_name)}`,
          `    message: ${JSON.stringify(wspMetadataProbe.message)}`,
        ];
        console.log(yamlLines.join('\n'));
        // #2229: explicit exit so LLM gateway HTTP connections do not hold event loop.
        process.exit(0);
      } else {
        // Probe lines are already emitted by the onProbeLine callback inside gatherProbes().

        // #0470 + #0476 + #0516: LLM config, LZR staleness, temperature, placeholders, source
        const maxAge = readLzrMaxAgeDays(workspacePath);
        if (isCheckInScope('llm_provider_errors', scope)) for (const msg of checkLlmProviderConfig(workspacePath)) { console.log(`  ${msg}`); }
        if (isCheckInScope('lzr_snapshot_warnings', scope)) for (const msg of checkLzrSnapshots(workspacePath, maxAge)) { console.log(`  ${msg}`); }
        if (isCheckInScope('llm_temperature_warnings', scope)) for (const msg of checkLlmTemperature(workspacePath)) { console.log(`  ${msg}`); }
        if (isCheckInScope('llm_context_window_warnings', scope)) for (const msg of checkLlmContextWindow(workspacePath)) { console.log(`  ${msg}`); }
        if (isCheckInScope('placeholder_input_warnings', scope)) for (const msg of checkPlaceholderInputs(workspacePath)) { console.log(`  ${msg}`); }
        if (isCheckInScope('lzr_coverage_info', scope)) for (const msg of checkLzrCoveragePerApp(workspacePath)) { console.log(`  ${msg}`); }
        if (isCheckInScope('lz_catalogue_provenance', scope)) for (const msg of ctx.lzCatalogueProvenance ?? []) { console.log(`  ${msg}`); }
        if (isCheckInScope('source_accessibility_warnings', scope)) for (const msg of checkSourceAccessibility(workspacePath)) { console.log(`  ${msg}`); }
        if (isCheckInScope('seeded_asset_warnings', scope)) for (const msg of checkSeededAssets(workspacePath)) { console.log(`  ${msg}`); }
        if (isCheckInScope('run_accumulation_warnings', scope)) for (const msg of checkRunAccumulation(workspacePath)) { console.log(`  ${msg}`); }
        if (isCheckInScope('run_status_warnings', scope)) for (const msg of checkRunStatusMarkers(workspacePath)) { console.log(`  ${msg}`); }
        if (isCheckInScope('context_config_messages', scope)) for (const msg of checkContextConfig(workspacePath)) { console.log(`  ${msg}`); }
        if (isCheckInScope('image_sidecar_warnings', scope)) for (const msg of checkImageSidecars(workspacePath)) { console.log(`  ${msg}`); }

        console.log(`\n  Machine fingerprint: ${fingerprint}  (needed when requesting a license key)`);
        if (licenseProbe.warning) {
          console.log(`\n  [!] ${licenseProbe.warning}`);
        }
        // #2222 / #3170: text-format exit code and summary use the same
        // failure definition as the NDJSON fail_count (computeFailedProbes).
        const failCount = hcFailedProbes.length;
        console.log(`\n${formatHealthCheckSummaryLine(hcFailedProbes, hcWarnedProbes)}`);
        // #2229: explicit exit so LLM gateway HTTP connections do not hold event loop.
        process.exit(failCount > 0 ? 1 : 0);
      }
    });
}
