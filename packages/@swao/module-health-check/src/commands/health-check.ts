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
import { existsSync, readFileSync, readdirSync, statSync, appendFileSync, mkdirSync } from 'fs';
import { LicenseGuard, LicenseInvalidError, logPortfolio, setWorkspaceRoot } from '@swao/core';
import { createHash } from 'crypto';
import { resolveProviderCatalogue, LzCatalogueSchemaError, resolveLzCataloguesDir, loadLzCatalogueIndex } from '@swao/module-landing-zone';
import type { LicenseState } from '@swao/core';
// Result types for the two host-coupled, injected probes (#0573). Their
// builders stay host-side (see HealthCheckHostDeps below); module-health-check needs
// only the result types, which live in @swao/core as the single source of
// truth.
import type { VcsAuthProbeResult, ImportsProbeResult, ProbeContribution } from '@swao/core';
import { buildMcpProbe } from '../probes/claude-desktop.js';
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
      hasYmlProvider = /providers\s*:[\s\S]*?llm\s*:[\s\S]*?primary\s*:[\s\S]*?type\s*:/m.test(raw);
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
      'assessment will complete without them. Set SWAO_LLM_PROVIDER or ' +
      'providers.llm.primary.type in .swao.yml to enable them. Valid values: ' +
      'anthropic | openai | ollama.',
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

  // Discover all providers: bundled index + any workspace-local extras.
  const allProviders = new Set<string>();
  try {
    const bundledDir = resolveLzCataloguesDir();
    if (bundledDir) {
      const idx = loadLzCatalogueIndex(bundledDir);
      for (const e of idx.catalogues) allProviders.add(e.provider);
    }
  } catch { /* bundled index unreadable -- continue with workspace-only */ }

  // Workspace-local extras (canonical path).
  const canonicalBaseDir = join(workspacePath, 'wsp', 'inputs', 'catalogs', 'lz-catalogues');
  if (existsSync(canonicalBaseDir)) {
    try {
      for (const entry of readdirSync(canonicalBaseDir, { withFileTypes: true })) {
        if (entry.isDirectory() && existsSync(join(canonicalBaseDir, entry.name, 'index.json'))) {
          allProviders.add(entry.name);
        } else if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'index.json') {
          const providerName = entry.name.replace(/\.json$/, '');
          // aws-service-meta is a metadata file, not a provider catalogue (#1581)
          if (providerName !== 'aws-service-meta') allProviders.add(providerName);
        }
      }
    } catch { /* skip unreadable */ }
  }
  // Legacy path.
  const oldBaseDir = join(workspacePath, 'lz-catalogues');
  if (existsSync(oldBaseDir)) {
    try {
      for (const entry of readdirSync(oldBaseDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'index.json') {
          allProviders.add(entry.name.replace(/\.json$/, ''));
        }
      }
    } catch { /* skip unreadable */ }
  }

  if (allProviders.size === 0) {
    return ['[INFO] LZ catalogues: no providers found (bundled index unresolvable).'];
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
      if (err instanceof LzCatalogueSchemaError) {
        workspaceCount++;
        lines.push(`[WARN] LZ catalogue: ${p.padEnd(16)} origin=workspace  INVALID: ${err.message}`);
      }
      // Provider not found or bundled-only + resolution failed: skip silently.
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
    try {
      const raw = readFileSync(ymlPath, 'utf-8').slice(0, 100_000);
      const pathMatch = raw.match(/source\s*:[\s\S]*?(?:^|\s)path\s*:\s*["']?([^\s"'#\n]+)/m);
      if (pathMatch) sourcePath = pathMatch[1];
      hasVcsUrl = /source\s*:[\s\S]*?vcs\s*:[\s\S]*?url\s*:/m.test(raw);
    } catch { continue; }

    const label = id ? `apps/${id}` : 'workspace';

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
  const label = pad('[1/15] License', LABEL_W);
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
  const label = pad('[2/15] Playwright / Chromium', LABEL_W);
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
  const label = pad('[3/15] SWAO-MCP', LABEL_W);
  switch (probe.status) {
    case 'ok':
      return `  ${label}  ok    swao server configured at ${probe.commandPath}`;
    case 'missing_entry':
      return `  ${label}  WARN  swao server entry missing from Claude Desktop config (run Setup Wizard to fix)`;
    case 'binary_not_found':
      return `  ${label}  WARN  swao binary path in config not found: ${probe.commandPath}`;
    case 'not_installed':
      return `  ${label}  INFO  Claude Desktop not installed (config file absent)`;
  }
}

function formatCommunityFrameworksProbeLine(probe: CommunityFrameworksProbeResult): string {
  const LABEL_W = 26;
  const label = pad('[4/15] Community frameworks', LABEL_W);
  if (probe.status === 'absent') {
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
  const label = pad('[5/15] Import templates', LABEL_W);
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
  const label = pad('[6/15] Traceability', LABEL_W);
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
  const label = pad('[7/15] BI export', LABEL_W);
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
  const label = pad('[8/15] Scope', LABEL_W);
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
  const label = pad('[9/15] Prerequisites', LABEL_W);
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
  const label = pad('[10/15] VCS auth', LABEL_W);
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
function formatLlmGatewayLine(probe: { ok: boolean; message: string }): string {
  const LABEL_W = 26;
  const label = pad('[13/15] LLM gateway', LABEL_W);
  const m = probe.message.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
  const state = m ? m[1]!.toUpperCase() : (probe.ok ? 'PASS' : 'FAIL');
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
  const label = pad('[14/15] Engagement', LABEL_W);
  switch (probe.status) {
    case 'absent':
      return `  ${label}  INFO  ${probe.message}`;
    case 'ok':
      return `  ${label}  ok    ${probe.message}`;
    case 'warn':
      return `  ${label}  WARN  ${probe.message}`;
  }
}

// #0995 / #1212: ingestion folder probe formatter.
function formatIngestionFolderProbeLine(probe: IngestionProbeResult): string {
  const LABEL_W = 26;
  const label = pad('[11/15] Ingestion folder', LABEL_W);
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
  const label = pad('[12/15] IaC toolchain', LABEL_W);
  switch (probe.status) {
    case 'ok':   return `  ${label}  ok    ${probe.message}`;
    case 'warn': return `  ${label}  WARN  ${probe.message}`;
  }
}

// #1698: LZ catalogue service-dep coverage probe formatter.
function formatLzCatalogueCoverageProbeLine(probe: LzCatalogueCoverageProbeResult): string {
  const LABEL_W = 26;
  const label = pad('[15/15] LZ catalogue', LABEL_W);
  switch (probe.status) {
    case 'ok':   return `  ${label}  ok    ${probe.message}`;
    case 'warn':
      return `  ${label}  WARN  ${probe.message}` +
        (probe.detail ? `\n  ${pad('', LABEL_W)}        ${probe.detail}` : '');
    case 'info':  return `  ${label}  INFO  ${probe.message}`;
    case 'fail':  return `  ${label}  FAIL  ${probe.message}`;
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
  /** #1402 sprint-113: SWAO LLM-Gateway connector discovery + validation. */
  llm_gateway: { ok: boolean; message: string };
  /** #1509: engagement.name placeholder guard. */
  wsp_metadata: WspMetadataProbeResult;
  /** #1698: LZ catalogue service-dep coverage check. */
  lz_catalogue_coverage: LzCatalogueCoverageProbeResult;
  llm_provider_errors: string[];
  lzr_snapshot_warnings: string[];
  llm_temperature_warnings: string[];
  llm_context_window_warnings: string[];
  placeholder_input_warnings: string[];
  lzr_coverage_info: string[];
  source_accessibility_warnings: string[];
  run_accumulation_warnings: string[];
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
  llmGatewayProbe: { ok: boolean; message: string };
  ingestionProbe: IngestionProbeResult;
  iacToolchainProbe: IaCToolchainProbeResult;
  wspMetadataProbe: WspMetadataProbeResult;
  lzCatalogueCoverageProbe: LzCatalogueCoverageProbeResult;
}

async function gatherProbes(workspacePath: string, host: HealthCheckHostDeps): Promise<BuildHealthCheckContext> {
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

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: mcp', { context: { probe: 'mcp' } });
  const mcpProbe: McpProbeResult = buildMcpProbe();
  logPortfolio('info', 'health-check.probe.complete', `probe: mcp status=${mcpProbe.status}`, { context: { probe: 'mcp', status: mcpProbe.status, elapsed_ms: Date.now() - t0 } });

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: community_frameworks', { context: { probe: 'community_frameworks' } });
  const communityFrameworksProbe = buildCommunityFrameworksProbe(workspacePath);
  logPortfolio('info', 'health-check.probe.complete', `probe: community_frameworks status=${communityFrameworksProbe.status}`, { context: { probe: 'community_frameworks', status: communityFrameworksProbe.status, elapsed_ms: Date.now() - t0 } });

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: imports', { context: { probe: 'imports' } });
  const importsProbe = host.buildImportsProbe(workspacePath);
  logPortfolio('info', 'health-check.probe.complete', `probe: imports status=${importsProbe.status}`, { context: { probe: 'imports', status: importsProbe.status, elapsed_ms: Date.now() - t0 } });

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: traceability', { context: { probe: 'traceability' } });
  const traceabilityProbe = buildTraceabilityProbe(workspacePath);
  logPortfolio('info', 'health-check.probe.complete', `probe: traceability status=${traceabilityProbe.status}`, { context: { probe: 'traceability', status: traceabilityProbe.status, elapsed_ms: Date.now() - t0 } });

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: bi_export', { context: { probe: 'bi_export' } });
  const biExportProbe = buildBiExportProbe(workspacePath);
  logPortfolio('info', 'health-check.probe.complete', `probe: bi_export status=${biExportProbe.status}`, { context: { probe: 'bi_export', status: biExportProbe.status, elapsed_ms: Date.now() - t0 } });

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: scope', { context: { probe: 'scope' } });
  const scopeProbe = buildScopeProbe(workspacePath);  // #0263 Phase 2
  logPortfolio('info', 'health-check.probe.complete', `probe: scope status=${scopeProbe.status}`, { context: { probe: 'scope', status: scopeProbe.status, elapsed_ms: Date.now() - t0 } });

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: prerequisites', { context: { probe: 'prerequisites' } });
  const prerequisitesProbe = buildPrerequisitesProbe();  // #0326 sprint-036
  logPortfolio('info', 'health-check.probe.complete', `probe: prerequisites status=${prerequisitesProbe.status}`, { context: { probe: 'prerequisites', status: prerequisitesProbe.status, elapsed_ms: Date.now() - t0 } });

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: vcs_auth', {
    context: { probe: 'vcs_auth', workspace_path: workspacePath },
  });
  const vcsAuthProbe = await host.buildVcsAuthProbe(workspacePath);  // #0326 sprint-036
  logPortfolio('info', 'health-check.probe.complete', `probe: vcs_auth status=${vcsAuthProbe.status}`, { context: { probe: 'vcs_auth', status: vcsAuthProbe.status, elapsed_ms: Date.now() - t0 } });

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: ingestion', { context: { probe: 'ingestion' } });
  const ingestionProbe = buildIngestionProbe(workspacePath);  // #0970
  logPortfolio('info', 'health-check.probe.complete', `probe: ingestion status=${ingestionProbe.status}`, { context: { probe: 'ingestion', status: ingestionProbe.status, elapsed_ms: Date.now() - t0 } });

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: iac_toolchain', { context: { probe: 'iac_toolchain' } });
  const iacToolchainProbe = buildIaCToolchainProbe();  // #1328 design 085 OI-05
  logPortfolio('info', 'health-check.probe.complete', `probe: iac_toolchain status=${iacToolchainProbe.status}`, { context: { probe: 'iac_toolchain', status: iacToolchainProbe.status, elapsed_ms: Date.now() - t0 } });

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: llm_gateway', {
    context: {
      probe: 'llm_gateway',
      workspace_path: workspacePath,
      connector: process.env['SWAO_LLM_CONNECTOR'] ?? undefined,
    },
  });
  const llmGatewayProbe = await host.llmGatewayProbe.run({ workspacePath });  // #1402 sprint-113
  logPortfolio('info', 'health-check.probe.complete', `probe: llm_gateway ok=${llmGatewayProbe.ok}`, { context: { probe: 'llm_gateway', ok: llmGatewayProbe.ok, elapsed_ms: Date.now() - t0 } });

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: wsp_metadata', { context: { probe: 'wsp_metadata' } });
  const wspMetadataProbe = buildWspMetadataProbe(workspacePath);  // #1509 engagement placeholder guard
  logPortfolio('info', 'health-check.probe.complete', `probe: wsp_metadata status=${wspMetadataProbe.status}`, { context: { probe: 'wsp_metadata', status: wspMetadataProbe.status, elapsed_ms: Date.now() - t0 } });

  t0 = Date.now();
  logPortfolio('info', 'health-check.probe.start', 'probe: lz_catalogue_coverage', { context: { probe: 'lz_catalogue_coverage' } });
  const lzCatalogueCoverageProbe = buildLzCatalogueCoverageProbe(workspacePath);  // #1698
  logPortfolio('info', 'health-check.probe.complete', `probe: lz_catalogue_coverage status=${lzCatalogueCoverageProbe.status}`, { context: { probe: 'lz_catalogue_coverage', status: lzCatalogueCoverageProbe.status, gaps: lzCatalogueCoverageProbe.gaps_count, elapsed_ms: Date.now() - t0 } });

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
    lz_catalogue_coverage: ctx.lzCatalogueCoverageProbe,
  };
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
    probe_count: 15,
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
      llm_gateway: { status: ctx.llmGatewayProbe.ok ? 'ok' : 'fail' },
      wsp_metadata: probeEntry(ctx.wspMetadataProbe),
      lz_catalogue_coverage: { ...probeEntry(ctx.lzCatalogueCoverageProbe), gaps_count: ctx.lzCatalogueCoverageProbe.gaps_count },
    },
  };
}

export function registerHealthCheck(program: Command, host: HealthCheckHostDeps): void {
  program
    .command('health-check')
    .alias('doctor')
    .description('Health Check: run pre-flight environment checks -- licence state, Playwright/Chromium, SWAO-MCP server, compliance catalogues, import templates, traceability, BI export, scope, prerequisites, VCS auth, ingestion folder, IaC toolchain, LLM gateway, engagement metadata, LZ catalogue coverage (15 probes total).')
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
      const ctx = await gatherProbes(workspacePath, host);
      const {
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
      } = ctx;

      const hcFailedProbes: string[] = [];
      if (licenseInvalid) hcFailedProbes.push('license');
      if (playwrightProbe.status === 'fail') hcFailedProbes.push('playwright');
      if (communityFrameworksProbe.status === 'fail') hcFailedProbes.push('community-frameworks');
      if (prerequisitesProbe.status === 'fail') hcFailedProbes.push('prerequisites');
      if (!llmGatewayProbe.ok) hcFailedProbes.push('llm-gateway');
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
          ingestion: buildIngestionProbe(workspacePath),
          iac_toolchain: buildIaCToolchainProbe(),
          llm_gateway: llmGatewayProbe,
          wsp_metadata: buildWspMetadataProbe(workspacePath),
          lz_catalogue_coverage: lzCatalogueCoverageProbe,
          llm_provider_errors: llmProviderErrors,
          lzr_snapshot_warnings: lzrSnapshotWarnings,
          llm_temperature_warnings: llmTempWarnings,
          llm_context_window_warnings: llmContextWarnings,
          placeholder_input_warnings: placeholderWarnings,
          lzr_coverage_info: lzrCoverageInfo,
          source_accessibility_warnings: checkSourceAccessibility(workspacePath),
          run_accumulation_warnings: checkRunAccumulation(workspacePath),
        };
        console.log(JSON.stringify(payload, null, 2));
        // #0550: llmProviderErrors is now WARN-level (LLM-optional); it no
        // longer fails doctor. The assessment completes without an LLM.
        // #1790: blocked status (e.g. imports probe with missing required column)
        // is treated as an error for CI consumers -- exit 1 so scripts can detect it.
        const hasErrors = licenseInvalid ||
          (playwrightProbe.status === 'fail') ||
          (communityFrameworksProbe.status === 'fail') ||
          (prerequisitesProbe.status === 'fail') ||
          (importsProbe.status === 'blocked' || importsProbe.status === 'fail');
        if (hasErrors) process.exit(1);
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
      } else {
        console.log(formatLicenseProbeLine(licenseProbe));
        console.log(formatPlaywrightProbeLine(playwrightProbe));
        console.log(formatMcpProbeLine(mcpProbe));
        console.log(formatCommunityFrameworksProbeLine(communityFrameworksProbe));
        console.log(formatImportsProbeLine(importsProbe));
        console.log(formatTraceabilityProbeLine(traceabilityProbe));
        console.log(formatBiExportProbeLine(biExportProbe));
        console.log(formatScopeProbeLine(scopeProbe));
        console.log(formatPrerequisitesProbeLine(prerequisitesProbe));
        console.log(formatVcsAuthProbeLine(vcsAuthProbe));
        console.log(formatIngestionFolderProbeLine(ingestionProbe));
        console.log(formatIaCToolchainProbeLine(iacToolchainProbe));
        console.log(formatLlmGatewayLine(llmGatewayProbe));
        console.log(formatWspMetadataProbeLine(wspMetadataProbe));
        console.log(formatLzCatalogueCoverageProbeLine(lzCatalogueCoverageProbe));

        // #0470 + #0476 + #0516: LLM config, LZR staleness, temperature, placeholders, source
        const maxAge = readLzrMaxAgeDays(workspacePath);
        for (const msg of checkLlmProviderConfig(workspacePath)) { console.log(`  ${msg}`); }
        for (const msg of checkLzrSnapshots(workspacePath, maxAge)) { console.log(`  ${msg}`); }
        for (const msg of checkLlmTemperature(workspacePath)) { console.log(`  ${msg}`); }
        for (const msg of checkLlmContextWindow(workspacePath)) { console.log(`  ${msg}`); }
        for (const msg of checkPlaceholderInputs(workspacePath)) { console.log(`  ${msg}`); }
        for (const msg of checkLzrCoveragePerApp(workspacePath)) { console.log(`  ${msg}`); }
        for (const msg of checkLzCatalogueProvenance(workspacePath)) { console.log(`  ${msg}`); }
        for (const msg of checkSourceAccessibility(workspacePath)) { console.log(`  ${msg}`); }
        for (const msg of checkRunAccumulation(workspacePath)) { console.log(`  ${msg}`); }

        console.log(`\n  Machine fingerprint: ${fingerprint}  (needed when requesting a license key)`);
        if (licenseProbe.warning) {
          console.log(`\n  [!] ${licenseProbe.warning}`);
        }
        const failCount =
          (licenseInvalid ? 1 : 0) +
          (playwrightProbe.status === 'fail' ? 1 : 0) +
          (communityFrameworksProbe.status === 'fail' ? 1 : 0) +
          (importsProbe.status === 'fail' || importsProbe.status === 'blocked' ? 1 : 0) +
          (traceabilityProbe.status === 'fail' ? 1 : 0) +
          (biExportProbe.status === 'fail' ? 1 : 0) +
          (prerequisitesProbe.status === 'fail' ? 1 : 0) +
          (vcsAuthProbe.status === 'fail' ? 1 : 0);
        if (failCount === 0) {
          console.log('\nAll probes passed.');
        } else {
          console.log(`\n${failCount} probe(s) failed.`);
        }
      }
    });
}
