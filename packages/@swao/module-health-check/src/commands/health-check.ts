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
import { LicenseGuard, LicenseInvalidError, logPortfolio, setWorkspaceRoot, readRunStatus, isRunStale } from '@swao/core';
import { createHash } from 'crypto';
import { resolveProviderCatalogue, LzCatalogueSchemaError, LzCatalogueDuplicateIdError, listLzCatalogueProviders } from '@swao/module-landing-zone';
import type { LicenseState } from '@swao/core';
// Result types for the two host-coupled, injected probes (#0573). Their
// builders stay host-side (see HealthCheckHostDeps below); module-health-check needs
// only the result types, which live in @swao/core as the single source of
// truth.
import type { VcsAuthProbeResult, ImportsProbeResult, ProbeContribution } from '@swao/core';
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
import { buildPrerequisitesProbe } from '../probes/prerequisites-probe.js';
import type { PrerequisitesProbeResult } from '../probes/prerequisites-probe.js';
import { buildIngestionProbe } from '../probes/ingestion-probe.js';
import type { IngestionProbeResult } from '../probes/ingestion-probe.js';
import { buildIaCToolchainProbe } from '../probes/iac-toolchain-probe.js';
import type { IaCToolchainProbeResult } from '../probes/iac-toolchain-probe.js';
import { buildWspMetadataProbe } from '../probes/wsp-metadata-probe.js';
import type { WspMetadataProbeResult } from '../probes/wsp-metadata-probe.js';
import { buildCredentialVaultProbe } from '../probes/credential-vault-probe.js';
import { buildIntakeMappingProbe } from '../probes/intake-mapping-probe.js';
import type { IntakeMappingProbeResult } from '../probes/intake-mapping-probe.js';
import { buildApmWeightsProbe } from '../probes/apm-weights-probe.js';
import type { ApmWeightsProbeResult } from '../probes/apm-weights-probe.js';
import { runServiceProbes, formatServiceProbeLine, PROBE_TOTAL } from '../probes/service-probes.js';
import type { ServiceProbeResult } from '../probes/service-probes.js';
import type { CredentialVaultProbeResult } from '../probes/credential-vault-probe.js';

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
      warnings.push(
        `[WARN] ${label}: source directory '${sourcePath}' is empty or contains only README ` +
        `files -- source code was never cloned. Configure source.vcs.url for auto-clone, ` +
        `or populate the directory before running swao assess.`,
      );
    }
  }

  return warnings;
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
  const label = pad('[1/25] License', LABEL_W);
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
  const label = pad('[2/25] Playwright / Chromium', LABEL_W);
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
  const label = pad('[3/25] SWAO-MCP', LABEL_W);
  const head = ((): string => {
    switch (probe.status) {
      case 'ok':
        return `  ${label}  ok    swao server configured at ${probe.commandPath}`;
      case 'missing_entry':
        return `  ${label}  WARN  swao server entry missing from Claude Desktop config (run Setup Wizard to fix)`;
      case 'binary_not_found':
        return `  ${label}  WARN  swao binary path in config not found: ${probe.commandPath}`;
      case 'binary_unreachable':
        return `  ${label}  WARN  swao binary found but did not respond to --version: ${probe.commandPath}`;
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
  return [head, ...detail].join('\n');
}

function formatCommunityFrameworksProbeLine(probe: CommunityFrameworksProbeResult): string {
  const LABEL_W = 26;
  const label = pad('[4/25] Community frameworks', LABEL_W);
  if (probe.status === 'absent') {
    // #2910: when bundled frameworks are available, emit 'ok' with an explanatory note
    // instead of a misleading INFO warning. Bundled frameworks are always functional;
    // the workspace catalog dir is optional (run `swao init` to install local copies).
    if (probe.bundled_count > 0) {
      return `  ${label}  ok    ${probe.bundled_count} bundled frameworks available (no workspace-level overrides -- run \`swao init\` to install local copies)`;
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
      return `  ${pad('', LABEL_W)}  [ok] community/${f.id} -- contributor=${contrib}, ${f.controls_count} controls`;
    });
  return [headLine, ...communityLines].join('\n');
}

function formatImportsProbeLine(probe: ImportsProbeResult): string {
  const LABEL_W = 26;
  const label = pad('[5/25] Import templates', LABEL_W);
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
  const label = pad('[6/25] Traceability', LABEL_W);
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
  const label = pad('[7/25] BI export', LABEL_W);
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
  const label = pad('[8/25] Scope', LABEL_W);
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
  const label = pad('[9/25] Prerequisites', LABEL_W);
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
  const label = pad('[10/25] VCS auth', LABEL_W);
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
  const label = pad('[13/25] LLM gateway', LABEL_W);
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
  const label = pad('[14/25] Engagement', LABEL_W);
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
  const label = pad('[18/25] SWAO_APM weights', 26);
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
  const label = pad('[17/25] Intake mapping', 26);
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
  const label = pad('[11/25] Ingestion folder', LABEL_W);
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
  const label = pad('[12/25] IaC toolchain', LABEL_W);
  switch (probe.status) {
    case 'ok':   return `  ${label}  ok    ${probe.message}`;
    case 'warn': return `  ${label}  WARN  ${probe.message}`;
  }
}

// #1698: LZ catalogue service-dep coverage probe formatter.
function formatLzCatalogueCoverageProbeLine(probe: LzCatalogueCoverageProbeResult): string {
  const LABEL_W = 26;
  const label = pad('[15/25] LZ catalogue', LABEL_W);
  switch (probe.status) {
    case 'ok':   return `  ${label}  ok    ${probe.message}`;
    case 'warn': {
      // #3282: one line per structural issue / grouped quality finding, capped;
      // `health-check --json` carries every finding (lz_catalogue_coverage.quality).
      const indent = `\n  ${pad('', LABEL_W)}        `;
      const lines = probe.detail_lines ?? (probe.detail ? [probe.detail] : []);
      const shown = lines.slice(0, LZ_DETAIL_LINES_MAX);
      const more = lines.length > shown.length ? `${indent}... ${lines.length - shown.length} more (see health-check --json)` : '';
      return `  ${label}  WARN  ${probe.message}` + shown.map((l) => `${indent}${l}`).join('') + more;
    }
    case 'info':  return `  ${label}  INFO  ${probe.message}`;
    case 'fail':  return `  ${label}  FAIL  ${probe.message}`;
  }
}

/** #3282: text-mode cap on LZ catalogue finding lines under probe 15. */
const LZ_DETAIL_LINES_MAX = 15;

// #2325: credential vault probe formatter.
function formatCredentialVaultProbeLine(probe: CredentialVaultProbeResult): string {
  const LABEL_W = 26;
  const label = pad('[16/25] Credential vault', LABEL_W);
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
  llm_provider_errors: string[];
  lzr_snapshot_warnings: string[];
  llm_temperature_warnings: string[];
  llm_context_window_warnings: string[];
  placeholder_input_warnings: string[];
  lzr_coverage_info: string[];
  source_accessibility_warnings: string[];
  run_accumulation_warnings: string[];
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
}

async function gatherProbes(workspacePath: string, host: HealthCheckHostDeps, onProbeLine?: (line: string) => void): Promise<BuildHealthCheckContext> {
  let licenseProbe: LicenseProbeResult;
  let licenseInvalid = false;
  let fingerprint: string = 'unknown';

  // #1786: emit probe.start/complete for every probe so the NDJSON event stream
  // captures per-probe timing and the last start entry identifies a hung probe.
  let t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: license', { context: { probe: 'license' } });
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
  logPortfolio('info', 'health-check.probe.complete', `probe: license status=${licenseProbe.status}`, { context: { probe: 'license', status: licenseProbe.status, elapsed_ms: Date.now() - t0 } });
  onProbeLine?.(formatLicenseProbeLine(licenseProbe));

  // Playwright probe is host-injected + deferred (sprint-038 #0350): the host
  // supplies a thunk that lazy-imports playwright-driver so `--version` /
  // `--help` do not pay the ~50MB init cost.
  // #1682: per-probe portfolio-events so slow probes are visible in the log.
  // #1684: populate probe.start context with available config for support bundle.
  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: playwright', {
    context: {
      probe: 'playwright',
      chromium_path: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'] ?? process.env['CHROMIUM_PATH'] ?? undefined,
    },
  });
  const playwrightProbe: PlaywrightProbeResult = await host.buildPlaywrightProbe();
  logPortfolio('info', 'health-check.probe.complete', `probe: playwright status=${playwrightProbe.status}`, { context: { probe: 'playwright', status: playwrightProbe.status, elapsed_ms: Date.now() - t0 } });
  onProbeLine?.(formatPlaywrightProbeLine(playwrightProbe));

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: mcp', { context: { probe: 'mcp' } });
  const mcpProbe: McpProbeResult = buildMcpProbe();
  logPortfolio('info', 'health-check.probe.complete', `probe: mcp status=${mcpProbe.status}`, { context: { probe: 'mcp', status: mcpProbe.status, configs_checked: mcpProbe.configsChecked?.length ?? 0, stale_entries: mcpProbe.staleEntries?.length ?? 0, elapsed_ms: Date.now() - t0 } });
  onProbeLine?.(formatMcpProbeLine(mcpProbe));

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: community_frameworks', { context: { probe: 'community_frameworks' } });
  const communityFrameworksProbe = buildCommunityFrameworksProbe(workspacePath);
  logPortfolio('info', 'health-check.probe.complete', `probe: community_frameworks status=${communityFrameworksProbe.status}`, { context: { probe: 'community_frameworks', status: communityFrameworksProbe.status, elapsed_ms: Date.now() - t0 } });
  onProbeLine?.(formatCommunityFrameworksProbeLine(communityFrameworksProbe));

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: imports', { context: { probe: 'imports' } });
  const importsProbe = host.buildImportsProbe(workspacePath);
  logPortfolio('info', 'health-check.probe.complete', `probe: imports status=${importsProbe.status}`, { context: { probe: 'imports', status: importsProbe.status, elapsed_ms: Date.now() - t0 } });
  onProbeLine?.(formatImportsProbeLine(importsProbe));

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: traceability', { context: { probe: 'traceability' } });
  const traceabilityProbe = buildTraceabilityProbe(workspacePath);
  logPortfolio('info', 'health-check.probe.complete', `probe: traceability status=${traceabilityProbe.status}`, { context: { probe: 'traceability', status: traceabilityProbe.status, elapsed_ms: Date.now() - t0 } });
  onProbeLine?.(formatTraceabilityProbeLine(traceabilityProbe));

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: bi_export', { context: { probe: 'bi_export' } });
  const biExportProbe = buildBiExportProbe(workspacePath);
  logPortfolio('info', 'health-check.probe.complete', `probe: bi_export status=${biExportProbe.status}`, { context: { probe: 'bi_export', status: biExportProbe.status, elapsed_ms: Date.now() - t0 } });
  onProbeLine?.(formatBiExportProbeLine(biExportProbe));

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: scope', { context: { probe: 'scope' } });
  const scopeProbe = buildScopeProbe(workspacePath);  // #0263 Phase 2
  logPortfolio('info', 'health-check.probe.complete', `probe: scope status=${scopeProbe.status}`, { context: { probe: 'scope', status: scopeProbe.status, elapsed_ms: Date.now() - t0 } });
  onProbeLine?.(formatScopeProbeLine(scopeProbe));

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: prerequisites', { context: { probe: 'prerequisites' } });
  const prerequisitesProbe = buildPrerequisitesProbe(workspacePath);  // #0326 sprint-036; #3375 VCS-aware git rule
  logPortfolio('info', 'health-check.probe.complete', `probe: prerequisites status=${prerequisitesProbe.status}`, { context: { probe: 'prerequisites', status: prerequisitesProbe.status, elapsed_ms: Date.now() - t0 } });
  onProbeLine?.(formatPrerequisitesProbeLine(prerequisitesProbe));

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: vcs_auth', {
    context: { probe: 'vcs_auth', workspace_path: workspacePath },
  });
  const vcsAuthProbe = await host.buildVcsAuthProbe(workspacePath);  // #0326 sprint-036
  logPortfolio('info', 'health-check.probe.complete', `probe: vcs_auth status=${vcsAuthProbe.status}`, { context: { probe: 'vcs_auth', status: vcsAuthProbe.status, elapsed_ms: Date.now() - t0 } });
  onProbeLine?.(formatVcsAuthProbeLine(vcsAuthProbe));

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: ingestion', { context: { probe: 'ingestion' } });
  const ingestionProbe = buildIngestionProbe(workspacePath);  // #0970
  logPortfolio('info', 'health-check.probe.complete', `probe: ingestion status=${ingestionProbe.status}`, { context: { probe: 'ingestion', status: ingestionProbe.status, elapsed_ms: Date.now() - t0 } });
  onProbeLine?.(formatIngestionFolderProbeLine(ingestionProbe));

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: iac_toolchain', { context: { probe: 'iac_toolchain' } });
  const iacToolchainProbe = buildIaCToolchainProbe();  // #1328 design 085 OI-05
  logPortfolio('info', 'health-check.probe.complete', `probe: iac_toolchain status=${iacToolchainProbe.status}`, { context: { probe: 'iac_toolchain', status: iacToolchainProbe.status, elapsed_ms: Date.now() - t0 } });
  onProbeLine?.(formatIaCToolchainProbeLine(iacToolchainProbe));

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: llm_gateway', {
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
  logPortfolio('info', 'health-check.probe.complete', `probe: llm_gateway ok=${llmGatewayProbe.ok}`, { context: { probe: 'llm_gateway', status: llmGatewayStatus(llmGatewayProbe), ok: llmGatewayProbe.ok, ...(llmGatewayProbe.ok !== true ? { message: llmGatewayProbe.message } : {}), elapsed_ms: Date.now() - t0 } });
  onProbeLine?.(formatLlmGatewayLine(llmGatewayProbe));

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: wsp_metadata', { context: { probe: 'wsp_metadata' } });
  const wspMetadataProbe = buildWspMetadataProbe(workspacePath);  // #1509 engagement placeholder guard
  logPortfolio('info', 'health-check.probe.complete', `probe: wsp_metadata status=${wspMetadataProbe.status}`, { context: { probe: 'wsp_metadata', status: wspMetadataProbe.status, elapsed_ms: Date.now() - t0 } });
  onProbeLine?.(formatWspMetadataProbeLine(wspMetadataProbe));

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: lz_catalogue_coverage', { context: { probe: 'lz_catalogue_coverage' } });
  const lzCatalogueCoverageProbe = buildLzCatalogueCoverageProbe(workspacePath);  // #1698
  logPortfolio('info', 'health-check.probe.complete', `probe: lz_catalogue_coverage status=${lzCatalogueCoverageProbe.status}`, { context: { probe: 'lz_catalogue_coverage', status: lzCatalogueCoverageProbe.status, gaps: lzCatalogueCoverageProbe.gaps_count, quality_errors: lzCatalogueCoverageProbe.quality?.errors ?? 0, quality_warnings: lzCatalogueCoverageProbe.quality?.warnings ?? 0, elapsed_ms: Date.now() - t0 } });
  onProbeLine?.(formatLzCatalogueCoverageProbeLine(lzCatalogueCoverageProbe));
  // #2222: persist per-file provenance (hash, origin, last_updated) so Support Bundle
  // captures full catalogue detail without requiring text-format health-check output.
  const lzCatalogueProvenance = checkLzCatalogueProvenance(workspacePath);  // #3282: once per run
  logPortfolio('info', 'health-check.lz-catalogue-provenance', 'LZ catalogue provenance', {
    context: { detail: lzCatalogueProvenance },
  });

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: credential_vault', { context: { probe: 'credential_vault' } });
  const credentialVaultProbe = buildCredentialVaultProbe();  // #2325
  logPortfolio('info', 'health-check.probe.complete', `probe: credential_vault status=${credentialVaultProbe.status}`, { context: { probe: 'credential_vault', status: credentialVaultProbe.status, key_count: credentialVaultProbe.keyCount, categories: credentialVaultProbe.categories, elapsed_ms: Date.now() - t0 } });
  onProbeLine?.(formatCredentialVaultProbeLine(credentialVaultProbe));

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: intake_mapping', { context: { probe: 'intake_mapping' } });
  const intakeMappingProbe = buildIntakeMappingProbe(workspacePath);  // #3084
  logPortfolio('info', 'health-check.probe.complete', `probe: intake_mapping status=${intakeMappingProbe.status}`, { context: { probe: 'intake_mapping', status: intakeMappingProbe.status, errors: intakeMappingProbe.errors.length, warnings: intakeMappingProbe.warnings.length, elapsed_ms: Date.now() - t0 } });
  onProbeLine?.(formatIntakeMappingProbeLine(intakeMappingProbe));

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: apm_weights', { context: { probe: 'apm_weights' } });
  const apmWeightsProbe = buildApmWeightsProbe(workspacePath);  // #3102
  logPortfolio('info', 'health-check.probe.complete', `probe: apm_weights status=${apmWeightsProbe.status}`, { context: { probe: 'apm_weights', status: apmWeightsProbe.status, elapsed_ms: Date.now() - t0 } });
  onProbeLine?.(formatApmWeightsProbeLine(apmWeightsProbe));

  // #3127-#3133 probes [19]-[25]. #3171: start/complete per probe, per-probe elapsed_ms.
  const serviceProbes = runServiceProbes(
    workspacePath,
    (level, code, message, opts) => logPortfolio(level, code, message, opts),
    (sp, i) => onProbeLine?.(formatServiceProbeLine(sp, i)),
  );

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
  };
}

export async function buildHealthCheckPayload(workspacePath: string, host: HealthCheckHostDeps): Promise<HealthCheckPayload> {
  const ctx = await gatherProbes(workspacePath, host);
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
    run_accumulation_warnings: checkRunAccumulation(workspacePath),
    run_status_warnings: checkRunStatusMarkers(workspacePath),
    context_config_messages: checkContextConfig(workspacePath),
    image_sidecar_warnings: checkImageSidecars(workspacePath),
    lz_catalogue_coverage: ctx.lzCatalogueCoverageProbe,
    credential_vault: ctx.credentialVaultProbe,
    intake_mapping: ctx.intakeMappingProbe,
    apm_weights: ctx.apmWeightsProbe,
    service_probes: Object.fromEntries(ctx.serviceProbes.map((sp) => [sp.key, sp])),
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
export function formatHealthCheckSummaryLine(failedProbes: readonly string[]): string {
  return failedProbes.length === 0
    ? 'All probes passed.'
    : `${failedProbes.length} probe(s) failed: ${failedProbes.join(', ')}.`;
}

// #1094: extracted so health-check-json.test.ts can unit-test the log context
// without spawning the CLI. Mirrors the #0192 pattern for buildHealthCheckPayload.
// Returns the compact per-probe context written to health-check.complete.
export function buildHealthCheckLogContext(
  ctx: BuildHealthCheckContext,
  failedProbes: string[],
): Record<string, unknown> {
  // #1683: include message field for warn/info probes so support bundle captures the reason.
  function probeEntry(probe: { status: string; message?: string | null; warning?: string | null }): Record<string, unknown> {
    const entry: Record<string, unknown> = { status: probe.status };
    const msg = probe.message ?? probe.warning;
    if (msg && probe.status !== 'ok') entry.message = msg;
    return entry;
  }
  return {
    fail_count: failedProbes.length,
    failed_probes: failedProbes,
    probe_count: PROBE_TOTAL,
    probes: {
      license: probeEntry(ctx.licenseProbe),
      playwright: probeEntry(ctx.playwrightProbe),
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
      },
      credential_vault: { ...probeEntry(ctx.credentialVaultProbe), key_count: ctx.credentialVaultProbe.keyCount, categories: ctx.credentialVaultProbe.categories },
      intake_mapping: probeEntry(ctx.intakeMappingProbe),
      apm_weights: probeEntry(ctx.apmWeightsProbe),
      ...Object.fromEntries(ctx.serviceProbes.map((sp) => [sp.key, probeEntry(sp)])),
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
    .action(async (opts: { format: string; json?: boolean; workspace?: string }) => {
      if (opts.json) opts.format = 'json';
      if (opts.format === 'text') {
        console.log('Running swao health-check...\n');
      }

      const workspacePath = opts.workspace ? resolve(opts.workspace) : process.cwd();
      setWorkspaceRoot(workspacePath);
      seedIngestionSidecarExample(workspacePath); // #2956: seed sidecar template into wsp/inputs/
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
        },
      });
      const onProbeLine = opts.format === 'text' ? console.log : undefined;
      const ctx = await gatherProbes(workspacePath, host, onProbeLine);
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
      } = ctx;

      // #3170: one shared failure definition for the log, the JSON exit code and the text summary.
      const hcFailedProbes = computeFailedProbes(ctx);
      // #1047: scope and traceability probes return 'absent' when no apps exist.
      // Report this in the summary so the operator knows the check was partial.
      const hcAbsentProbes: string[] = [];
      if (scopeProbe.status === 'absent') hcAbsentProbes.push('scope');
      if (traceabilityProbe.status === 'absent') hcAbsentProbes.push('traceability');
      const okMessage = hcAbsentProbes.length > 0
        ? `Health-check passed -- workspace only, no apps to assess (${hcAbsentProbes.join(', ')} skipped)`
        : 'Health-check passed -- all probes ok';
      logPortfolio(
        hcFailedProbes.length > 0 ? 'warn' : 'info',
        'health-check.complete',
        hcFailedProbes.length > 0
          ? `Health-check found ${hcFailedProbes.length} failure(s): ${hcFailedProbes.join(', ')}`
          : okMessage,
        { context: buildHealthCheckLogContext(ctx, hcFailedProbes) },
      );

      // #1277: persist results to wsp/logs/health-check-YYYY-MM.ndjson so
      // operators can review history without parsing the full portfolio log.
      try {
        const logsDir = join(workspacePath, 'wsp', 'logs');
        const month   = new Date().toISOString().slice(0, 7);
        mkdirSync(logsDir, { recursive: true });
        // #1890-1892: add event + level so the log-monitor schema validator
        // treats health-check lines identically to portfolio-events lines.
        const entry = JSON.stringify({
          ts:        new Date().toISOString(),
          event:     'health-check.complete',
          level:     hcFailedProbes.length > 0 ? 'warn' : 'info',
          workspace: workspacePath,
          ...buildHealthCheckLogContext(ctx, hcFailedProbes),
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
          llm_provider_errors: llmProviderErrors,
          lzr_snapshot_warnings: lzrSnapshotWarnings,
          llm_temperature_warnings: llmTempWarnings,
          llm_context_window_warnings: llmContextWarnings,
          placeholder_input_warnings: placeholderWarnings,
          lzr_coverage_info: lzrCoverageInfo,
          source_accessibility_warnings: checkSourceAccessibility(workspacePath),
          run_accumulation_warnings: checkRunAccumulation(workspacePath),
          run_status_warnings: checkRunStatusMarkers(workspacePath),
          context_config_messages: checkContextConfig(workspacePath),
          image_sidecar_warnings: checkImageSidecars(workspacePath),
        };
        console.log(JSON.stringify(payload, null, 2));
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
        for (const msg of checkLlmProviderConfig(workspacePath)) { console.log(`  ${msg}`); }
        for (const msg of checkLzrSnapshots(workspacePath, maxAge)) { console.log(`  ${msg}`); }
        for (const msg of checkLlmTemperature(workspacePath)) { console.log(`  ${msg}`); }
        for (const msg of checkLlmContextWindow(workspacePath)) { console.log(`  ${msg}`); }
        for (const msg of checkPlaceholderInputs(workspacePath)) { console.log(`  ${msg}`); }
        for (const msg of checkLzrCoveragePerApp(workspacePath)) { console.log(`  ${msg}`); }
        for (const msg of ctx.lzCatalogueProvenance ?? []) { console.log(`  ${msg}`); }
        for (const msg of checkSourceAccessibility(workspacePath)) { console.log(`  ${msg}`); }
        for (const msg of checkRunAccumulation(workspacePath)) { console.log(`  ${msg}`); }
        for (const msg of checkRunStatusMarkers(workspacePath)) { console.log(`  ${msg}`); }
        for (const msg of checkContextConfig(workspacePath)) { console.log(`  ${msg}`); }
        for (const msg of checkImageSidecars(workspacePath)) { console.log(`  ${msg}`); }

        console.log(`\n  Machine fingerprint: ${fingerprint}  (needed when requesting a license key)`);
        if (licenseProbe.warning) {
          console.log(`\n  [!] ${licenseProbe.warning}`);
        }
        // #2222 / #3170: text-format exit code and summary use the same
        // failure definition as the NDJSON fail_count (computeFailedProbes).
        const failCount = hcFailedProbes.length;
        console.log(`\n${formatHealthCheckSummaryLine(hcFailedProbes)}`);
        // #2229: explicit exit so LLM gateway HTTP connections do not hold event loop.
        process.exit(failCount > 0 ? 1 : 0);
      }
    });
}
