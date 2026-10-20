// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync, copyFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { join, resolve, isAbsolute, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { registerChild } from '../tui/child-process-registry.js';
import { dump, load } from 'js-yaml';
import { listLenses, readWorkspaceLenses } from './lenses.js';
import type { Command } from 'commander';
import { CredentialStore, credentialStore } from '@swao/core';
import { resolveVcsToken } from '../credential/vcs-credential.js';
import { LicenseGuard, LicenseTierError, LicenseLimitError, LicenseInvalidError } from '@swao/core';
import { printLicenseGateError, printLicenseLimitError, printLicenseInvalidError } from '../lib/license-gate-error.js';
import { runPortfolioLzr } from '../lzr/portfolio-lzr.js';
// #0579 + #0583: the general (non-LZR) --portfolio case is the spawn-based
// per-app dispatcher in @swao/module-portfolio (Enterprise tier). To keep the
// Enterprise module CODE out of the Community / Consultant bundles, the host no
// longer imports runPortfolio / formatPortfolioResult here; they are injected
// via AssessDeps (gated stubs in lower tiers, real impls in Enterprise) behind
// the requireTier('enterprise') gate. Only the TYPES are imported -- `import
// type` is erased by esbuild so it pulls no module code into the bundle. The LZR
// path above stays host-side (Community), untouched.
import type { PortfolioRunDeps, PortfolioResult } from '@swao/module-portfolio';
// Sprint-038 #0350: playwright-driver loads playwright-core (~50MB JS).
// Static import here would force every `swao --version` / `swao framework
// list` invocation to pay that cost. Dynamic-import inside the assess
// handler defers it to the Pass 10 dynamic-crawl path only.
// import { PlaywrightCrawlProvider } from '../crawl/playwright-driver.js';
import { writeParityBaseline } from '../crawl/parity-baseline.js';
import { findWorkspace, setWorkspaceRoot } from '@swao/core';
// Pass 10 (DYNAMIC) and Pass 23 (LZR) are dispatched directly (they take
// orchestrator-supplied inputs beyond PassContext). The 12 uniform passes are
// looked up via AssessOrchestrator (#0549).
import { runDynamicPass, runLzrPass, findLzrInputFiles } from '../passes/index.js';
import { computeContextBudget } from '../passes/context-budget.js';
import { assessOrchestrator, appAssessmentType, runIngestPrePass, derivePlanForRun, loadAcceptedRun, loadPriorSignals } from '@swao/module-app-assessment';
// #3152 / #3158: pass order, aliases, lens expansion and --skip-llm live in the module (unit-tested there).
import { DEFAULT_PASS_KEYS, INDIVIDUAL_PASS_KEYS, sortPassesCanonical, normaliseRequestedPasses, applySkipLlm, expandPassProfile, filterByPassProfile, markSkippedByFlag, INVALID_LLM_RESPONSE_REASON } from '@swao/module-app-assessment';
// #1434: the audit assessment surface (its module included) was removed;
// `--type audit` stays in KNOWN_ASSESSMENT_TYPES and routes to the router's
// coming-soon path so historical manifests keep loading gracefully.
// type:llm -- LLM Assessment for SWAO (Design 092, #1419/#1420). Gates run
// first (Consultant/Enterprise tier + completed-App-Assessment precondition);
// the run-loop engine lands with #1421..#1426.
import { llmAssessmentType, runLlmAssessment, LlmAssessmentGateError, EnginePendingError, createLegRecorderFromEnv, orchestrateLegs } from '@swao/module-llm-assessment';
import type { ResolvedLeg, ChallengePassResult } from '@swao/module-llm-assessment';
import { serviceAssessmentType, planServicePasses, buildServiceScopeCoverage, formatSkippedSummary, buildPortfolioSummary, discoverApplicationApps, runBinaryAnalysis, type ServicePassPlan } from '@swao/module-service-assessment';
import { SwaoYmlLlmAssessmentSchema } from '@swao/core';
import { landingZoneAssessmentType, assembleLzCatalogWsp, readFrameworkSovereigntyDecls, generateLzNarrative, resolveProviderCatalogue } from '@swao/module-landing-zone';
import { communityFrameworksDir } from '@swao/community-frameworks';
import type { LzFitReport, LzVerdictNarrative } from '@swao/module-landing-zone';
import { createLzRunLifecycle, runLzProviderFits } from './lz-run-lifecycle.js';
import { createRunLifecycle } from './run-lifecycle.js';
import { readLegChallengeAgents, type LegChallengeAgent } from './llm-leg-challenge.js';
import { applyRunRetention } from './run-retention.js';
import { resolveRunLzTargets, readWorkspaceAssessment } from './lz-target-config.js';
import { RunContextSchema, lzTargetLabel, type WspResult } from '@swao/core';
// COMP (Pass 11) lives in @swao/module-framework (#0570). It left the
// app-assessment orchestrator (a module may not import another module), so the
// host dispatches it directly, like Pass 10 (DYNAMIC) and Pass 23 (LZR).
import { runCompliancePass } from '@swao/module-framework';
import { AssessmentTypeRouter, UnknownAssessmentTypeError, deriveConstraints, resolveCatalogsDir } from '@swao/core';
import { createLlmProvider, getLastGatewayProvenance, LlmCacheLayer, UsageTrackingLlmProvider, mergeUsage, LlmConnectivityError, getConnector, resolveModelAlias } from '@swao/module-llm-providers';
import type { LlmProviderConfig } from '@swao/module-llm-providers';
import { preflightLlmProvider, llmUnavailableWarning } from './assess-llm-preflight.js';
import { setAllowlist, setScrubPersonName } from '../util/redact-pre-llm.js';
import { beginRun as beginRedactionRun, flushRedactionReport } from '@swao/core';
import { scrubRunDirectory } from '../util/report-scrub.js';
import { buildAuthenticatedCloneUrl, diagnoseCloneFailure, type VcsTokenScheme } from '../providers/vcs/auth.js';
import { logApp, logPortfolio } from '@swao/core';
import { createPostRunTimer, rebuildPortfolioSummaryStep } from './post-run-timing.js';
import { findInstalledChromium, isPlaywrightPackageInstalled } from '@swao/core';
import type { AccumulatedUsage } from '@swao/module-llm-providers';
import type { PassContext, PassResult } from '@swao/core';
import { enrichSignals } from '@swao/core';
import { PassFileSchema, RunManifestSchema, SwaoYmlSchema } from '../schema/index.js';
import type { PassStat, RunManifest, DataSource } from '../schema/index.js';
import { DEFAULT_WEIGHTS } from '../catalogue/cloud-provider-catalogue.js';
import type { CrawlConfig } from '../crawl/types.js';
import { SWAO_VERSION } from '../branding.js';

// Committed fixture cassettes shipped with SWAO for CI/offline replay without
// real LLM credentials. Resolved from this host file's location so it survives
// the dist layout; bundle.mjs copies src/passes/fixtures -> dist/passes/fixtures
// and pkg.assets snapshots it into the binary. Injected into LlmCacheLayer
// (the cache layer moved to @swao/module-llm-providers in #0568 and owns no
// fixture assets of its own).
const FIXTURE_CASSETTES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'passes',
  'fixtures',
  'cassettes',
);

// The application-assessment pass profile (PASS_MAP) moved into
// @swao/module-app-assessment as AssessOrchestrator (#0549). assess.ts looks
// each pass up via the orchestrator instead of a hardcoded literal. Pass 10
// (DYNAMIC) and Pass 23 (LZR) are dispatched separately below, as before.
type PassKey = string;

// Map internal provider IDs (lowercase slugs) to user-facing display names (#1001).
// Internal YAML keys and code identifiers remain lowercase; only log output uses these.
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  stackit:   'STACKIT',
  gcp:       'GCP',
  aws:       'AWS',
  'aws-esc': 'AWS ESC',
  'aws-iso-e': 'AWS ISO-E',
  azure:     'Azure',
  otc:       'OTC',
  ionos:     'IONOS',
  ovhcloud:  'OVHcloud',
};
function providerDisplayName(id: string): string {
  return PROVIDER_DISPLAY_NAMES[id.toLowerCase()] ?? id;
}

// Written by writeCrawlSection() called from AssessScreen.tsx input-playwright-password phase.
// Field path: crawl.target_url (required), crawl.username, crawl.password (optional, stored).
// Round-trip test: assess-yaml-roundtrip.test.ts (#0751).
export function buildCrawlConfig(swaoYml: Record<string, unknown>): CrawlConfig | null {
  const crawl = swaoYml.crawl as Record<string, unknown> | undefined;
  const rawUrl = crawl?.target_url;
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return null;
  // #1085: normalise bare hostnames -- operators often omit the scheme (e.g.
  // "sovereignhealth.io/login").  Without it, new URL(targetUrl) throws inside
  // fetchSitemapUrls() + extractSameOriginLinks(), both silently caught, so
  // zero links are ever queued and only the first page is captured.
  const targetUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const username = typeof crawl?.username === 'string' && crawl.username.length > 0
    ? crawl.username : undefined;
  const password = typeof crawl?.password === 'string' && crawl.password.length > 0
    ? crawl.password : undefined;
  // Auto-detect form auth: if credentials are present and auth_type is not
  // explicitly set, treat as 'form' so login runs without requiring a YAML re-write.
  const explicitAuthType = crawl?.auth_type as CrawlConfig['authType'] | undefined;
  const authType: CrawlConfig['authType'] =
    explicitAuthType ?? (username && password ? 'form' : 'none');
  return {
    targetUrl,
    authType,
    username,
    password,
    screenshotQuality: typeof crawl?.screenshot_quality === 'number' ? crawl.screenshot_quality : 80,
    viewportWidth: typeof crawl?.viewport_width === 'number' ? crawl.viewport_width : 1280,
    // #2154: default lowered from 80 to 60 to reduce peak Playwright memory pressure.
    // Set crawl.max_turns in .swao.yml to override.
    maxTurns: typeof crawl?.max_turns === 'number' ? crawl.max_turns : 60,
    excludePatterns: Array.isArray(crawl?.exclude_patterns) ? (crawl.exclude_patterns as string[]) : [],
  };
}

// Written by writeLlmToYaml() in tui/screens/SetupWizard.tsx.
// Field path: providers.llm.primary.{type,model,temperature,seed,max_tokens,baseUrl,modelPrefix,costPerToken}.
// Multi-env path: providers.llm.{environments,activeEnv} (Design 082 §4.4).
// Round-trip test: assess-yaml-roundtrip.test.ts (#0751).
export function readLlmPrimaryConfig(swaoYml: Record<string, unknown>): {
  /** SWAO LLM-Gateway connector id (Design 090, #1401). */
  connector?: string;
  /** Gateway environment name. */
  env?: string;
  workspaceRoot?: string;
  type?: string;
  model?: string;
  temperature?: number;
  seed?: number;
  max_tokens?: number;
  baseUrl?: string;
  modelPrefix?: string;
  costPerToken?: { inputPerMillion: number; outputPerMillion: number };
  environments?: Record<string, LlmProviderConfig>;
  activeEnv?: string;
  /** #3284: providers.llm.max_concurrency of the same .swao.yml (validated by the factory). */
  max_concurrency?: number;
} | undefined {
  const llmCfg = (swaoYml.providers as Record<string, unknown> | undefined)?.['llm'] as
    Record<string, unknown> | undefined;
  if (!llmCfg) return undefined;
  const maxConcurrency = readLlmMaxConcurrency(swaoYml);

  const primary = llmCfg['primary'] as Record<string, unknown> | undefined;
  const environments = llmCfg['environments'] as Record<string, LlmProviderConfig> | undefined;
  const activeEnv = llmCfg['activeEnv'] as string | undefined;

  if (primary) {
    return {
      connector: primary['connector'] as string | undefined,
      env: primary['env'] as string | undefined,
      type: primary['type'] as string | undefined,
      model: primary['model'] as string | undefined,
      temperature: primary['temperature'] as number | undefined,
      seed: primary['seed'] as number | undefined,
      max_tokens: primary['max_tokens'] as number | undefined,
      baseUrl: primary['baseUrl'] as string | undefined,
      modelPrefix: primary['modelPrefix'] as string | undefined,
      costPerToken: primary['costPerToken'] as
        | { inputPerMillion: number; outputPerMillion: number }
        | undefined,
      ...(environments ? { environments, activeEnv } : {}),
      ...(maxConcurrency !== undefined ? { max_concurrency: maxConcurrency } : {}),
    };
  }

  // Multi-env config: no primary block, but environments map is present.
  if (environments) {
    return { environments, activeEnv, ...(maxConcurrency !== undefined ? { max_concurrency: maxConcurrency } : {}) };
  }

  return undefined;
}

/**
 * #3284: `providers.llm.max_concurrency` of one .swao.yml (raw value; the LLM
 * factory validates it and reports an invalid value). Precedence, applied in
 * assess.ts: app .swao.yml > workspace .swao.yml > connector > default 4.
 */
export function readLlmMaxConcurrency(swaoYml: Record<string, unknown>): number | undefined {
  const llmCfg = (swaoYml.providers as Record<string, unknown> | undefined)?.['llm'] as
    Record<string, unknown> | undefined;
  const v = llmCfg?.['max_concurrency'];
  return v === undefined || v === null ? undefined : (v as number);
}

// #1703: read providers.llm.secondary block for connectivity-failure failover.
export function readLlmSecondaryConfig(swaoYml: Record<string, unknown>): LlmProviderConfig | undefined {
  const llmCfg = (swaoYml.providers as Record<string, unknown> | undefined)?.['llm'] as
    Record<string, unknown> | undefined;
  if (!llmCfg) return undefined;
  const secondary = llmCfg['secondary'] as Record<string, unknown> | undefined;
  if (!secondary) return undefined;
  return {
    connector: secondary['connector'] as string | undefined,
    env: secondary['env'] as string | undefined,
    type: secondary['type'] as string | undefined,
    model: secondary['model'] as string | undefined,
    temperature: secondary['temperature'] as number | undefined,
    seed: secondary['seed'] as number | undefined,
    max_tokens: secondary['max_tokens'] as number | undefined,
    baseUrl: secondary['baseUrl'] as string | undefined,
    modelPrefix: secondary['modelPrefix'] as string | undefined,
  };
}

/** #1774 (Option A): copy `combined.yaml` from the main workspace into the
 *  leg workspace so the `spawnChallenge` read path finds non-empty results.
 *
 *  #3336: the copied file keeps its `challenged_run` block (#3330), which
 *  names the MAIN run, not a leg run. That is intended: legs run their
 *  challenge against the main workspace and the leg reader
 *  (readLegChallengeAgents) ignores the run id by design. No production
 *  caller uses this helper at present (tests only).
 *
 *  A fresh leg workspace has no `challenge-app/` directory, so running
 *  `swao challenge` there always produces an empty report. When the main
 *  workspace already has recent challenge results (younger than `maxAgeMs`,
 *  default 7 days), we copy them instead of re-running the expensive
 *  subprocess. Returns `true` when the copy was performed (caller skips
 *  spawn), `false` when the main file is absent or stale (caller should
 *  run `swao challenge` as normal).
 *
 *  Injecting `now` and `maxAgeMs` keeps the boundary deterministic in tests.
 */
export function reuseMainChallengeCombined(opts: {
  mainWorkspaceRoot: string;
  legWorkspaceRoot: string;
  appId: string;
  maxAgeMs?: number;
  now?: number;
}): boolean {
  const maxAge = opts.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
  const currentTime = opts.now ?? Date.now();
  const mainYaml = join(opts.mainWorkspaceRoot, 'apps', opts.appId, 'wsp', 'challenge-app', 'combined.yaml');
  if (!existsSync(mainYaml)) return false;
  const ageMs = currentTime - statSync(mainYaml).mtimeMs;
  if (ageMs >= maxAge) return false;
  const legDir = join(opts.legWorkspaceRoot, 'apps', opts.appId, 'wsp', 'challenge-app');
  mkdirSync(legDir, { recursive: true });
  copyFileSync(mainYaml, join(legDir, 'combined.yaml'));
  return true;
}

// #2749: build GIT_CONFIG_* env vars for per-process proxy and TLS overrides.
// Injected via spawnSync `env` so they never touch the user's global gitconfig.
function buildGitConfigEnv(proxy?: string, sslVerify?: boolean): Record<string, string> {
  const entries: Array<[string, string]> = [];
  if (proxy) entries.push(['http.proxy', proxy]);
  if (sslVerify === false) entries.push(['http.sslVerify', 'false']);
  if (entries.length === 0) return {};
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(entries.length) };
  entries.forEach(([k, v], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = k;
    env[`GIT_CONFIG_VALUE_${i}`] = v;
  });
  return env;
}

async function cloneIfNeeded(
  workspaceAppDir: string,
  swaoYml: Record<string, unknown>,
  appId?: string,
): Promise<void> {
  const source = swaoYml.source as Record<string, unknown> | undefined;
  let rawPath = (source?.path as string | undefined) ?? 'source/';

  // #0401 (sprint-040 round-5): auto-sanitise legacy .swao.yml files
  // that have a tree URL embedded in source.path. Pre-sprint-040 the TUI
  // New-App flow could write source.path = `wsp/inputs/source/https://.../tree/<ref>/<subdir>`
  // when the operator pasted a GitHub tree URL at the URL prompt. Windows
  // then refuses the folder name (colon in path) and `git clone` exits 128.
  // Auto-extract the path-after-tree so re-runs against a broken yaml
  // self-heal instead of repeating the same failure forever.
  const treeMatch = rawPath.match(/^(?:wsp\/inputs\/source\/)?https?:\/\/[^/]+\/[^/]+\/[^/]+\/tree\/[^/]+\/(.+)$/i);
  if (treeMatch) {
    const recovered = `wsp/inputs/source/${(treeMatch[1] ?? '').replace(/\/+$/, '')}`;
    console.warn(
      `[warn] source.path in .swao.yml contained an embedded tree URL -- self-healing.\n` +
      `  was: ${rawPath}\n` +
      `  now: ${recovered}\n` +
      `  (Update apps/${appId ?? '<id>'}/.swao.yml to make this permanent.)`,
    );
    rawPath = recovered;
  }

  const targetPath = resolve(workspaceAppDir, rawPath);

  if (existsSync(targetPath)) {
    // Directory has real source files -- a previous clone or manual placement.
    // Skip the clone entirely so we do not overwrite existing work.
    if (checkSourceNonEmpty(targetPath)) return;
    // Directory exists but contains only scaffold files (README, .gitkeep).
    // Only proceed if a vcs.url is actually configured; otherwise leave it.
    const vcsCheck = source?.vcs as Record<string, unknown> | undefined;
    if (!vcsCheck || typeof vcsCheck.url !== 'string' || !vcsCheck.url) return;
    // Remove the scaffold-only directory so the clone can write into it.
    rmSync(targetPath, { recursive: true, force: true });
  }

  const vcs = source?.vcs as Record<string, unknown> | undefined;
  let vcsUrl: string | undefined = (typeof vcs?.url === 'string' && vcs.url) ? (vcs.url as string) : undefined;

  // #2324: fall back to vault key 'vcs-url-<appId>' when source.vcs.url is
  // absent from .swao.yml.  The credential hub stores the URL there so users
  // do not need to hand-edit .swao.yml after setting it via the TUI.
  if (!vcsUrl && appId) {
    try { vcsUrl = (await new CredentialStore().get(`vcs-url-${appId}`)) ?? undefined; } catch { /* best-effort */ }
  }

  if (!vcsUrl) {
    console.error(
      `[error] Source directory not found and no vcs.url configured.\n` +
      `  Expected: ${targetPath}\n` +
      `  Either clone the repository manually into ${rawPath}, add a\n` +
      `  source.vcs block to apps/<appId>/.swao.yml, or set the URL via\n` +
      `  the credential hub (swao assess > E > R).`,
    );
    process.exit(1);
  }

  // #0388 (sprint-040): fail fast when source.vcs.url is a local
  // filesystem path under a vcs `type` (github/gitlab/azure-devops).
  // Hand-edited .swao.yml files pasted a Windows path here and `git
  // clone` would try to make a folder containing `:` and `/` -- which
  // Windows rejects, producing the cryptic "could not create leading
  // directories" failure observed during the sprint-040 binary test.
  // The TUI New-App flow now writes local paths to source.path
  // (sourcePathOverride per #0386); this validation covers the
  // hand-edited path.
  const looksLikeLocalPath =
    /^[a-zA-Z]:[\\/]/.test(vcsUrl) ||           // Windows drive letter
    vcsUrl.startsWith('\\\\') ||                // UNC
    vcsUrl.startsWith('/') ||                   // POSIX absolute
    (existsSync(vcsUrl) && !/^[a-z]+:\/\//i.test(vcsUrl));
  if (looksLikeLocalPath) {
    console.error(
      `[error] source.vcs.url looks like a local filesystem path:\n` +
      `  ${vcsUrl}\n\n` +
      `  vcs blocks expect a clone URL (https://, ssh://, git@host:).\n` +
      `  To point SWAO at a local working tree instead, edit\n` +
      `  apps/${appId ?? '<id>'}/.swao.yml so it reads:\n\n` +
      `    source:\n` +
      `      path: ${vcsUrl}\n\n` +
      `  and REMOVE the source.vcs: block. Re-run assess afterwards.`,
    );
    process.exit(2);
  }
  const ref = vcs?.ref as string | undefined;
  const refLabel = ref ?? 'default branch';

  const store = new CredentialStore();
  // #0421: resolve token via provider-scoped key with legacy fallback.
  const token = await resolveVcsToken(store, vcsUrl);

  // Provider-aware token injection per #0326. The previous hard-coded
  // 'oauth2' username worked for GitLab but caused GitHub PAT auth to
  // fail with a misleading 403. The builder switches on the URL host.
  // An operator can override the scheme via
  // `.swao.yml providers.vcs.token_scheme: <x-access-token|oauth2|...>`.
  const schemeOverride = (vcs?.token_scheme as VcsTokenScheme | undefined) ?? undefined;
  const { cloneUrl, schemeUsed } = buildAuthenticatedCloneUrl(vcsUrl, token ?? undefined, schemeOverride);

  console.log(`[info] Cloning ${vcsUrl} (ref: ${refLabel}) into ${targetPath}...`);

  // #0398 (sprint-040): structured clone-start log so debug bundles
  // capture the full clone context BEFORE git runs -- previously only
  // failures were logged, leaving the operator unsure whether the
  // attempt even started.
  if (appId) {
    try {
      logApp(appId, 'info', 'provider.vcs.clone-start', `git clone starting`, {
        context: {
          app_id: appId,
          vcs_url: vcsUrl,
          ref: ref ?? null,
          target_path: targetPath,
          token_scheme: schemeUsed,
          token_present: !!token,
        },
      });
    } catch { /* logging best-effort */ }
  }

  // #2750: detect missing git BEFORE clone so ENOENT produces actionable guidance.
  const gitCheck = spawnSync('git', ['--version'], { encoding: 'utf-8' });
  if ((gitCheck.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT' || gitCheck.status === null) {
    const appRef = appId ?? 'your-app-id';
    console.error(
      '[error] git is not installed or not on PATH.\n' +
      '  SWAO requires git to clone source.vcs repositories. Options:\n\n' +
      '  Option A -- Portable Git (no admin rights needed):\n' +
      '    1. Download from https://git-scm.com/download/win\n' +
      '       Choose "64-bit Git for Windows Portable" (PortableGit-*.exe)\n' +
      `    2. Run the .exe and extract to e.g. ${homedir()}\\PortableGit\\\n` +
      '    3. Add to PATH for this session:\n' +
      `       $env:PATH = "${homedir()}\\PortableGit\\cmd;$env:PATH"\n` +
      `    4. Re-run: swao assess --app ${appRef}\n\n` +
      '  Option B -- winget (requires Windows 10 1709+):\n' +
      '    winget install Git.Git\n\n' +
      '  Option C -- manual source (no git required):\n' +
      `    Remove source.vcs: from apps/${appRef}/.swao.yml\n` +
      `    Place source code at: apps/${appRef}/source/\n` +
      `    Re-run: swao assess --app ${appRef}`,
    );
    process.exit(1);
  }

  // #2749: read proxy + TLS settings from source.vcs block; inject as
  // GIT_CONFIG_* env vars so clone and remote set-url both respect corporate
  // proxy and self-signed cert configurations without touching global gitconfig.
  const gitProxy = vcs?.git_proxy as string | undefined;
  const sslVerify = vcs?.ssl_verify as boolean | undefined;
  if (sslVerify === false) {
    console.warn('[warn] source.vcs.ssl_verify: false -- TLS certificate verification disabled for git clone. Not recommended outside trusted environments.');
  }
  const gitConfigEnv = buildGitConfigEnv(gitProxy, sslVerify);

  // --quiet suppresses the per-tick "Updating files: N%" progress flood
  // that git writes to stderr (#0619). Errors still surface on stderr
  // (--quiet only silences progress, not error output).
  const args = ['clone', '--depth', '1', '--quiet'];
  if (ref) args.push('--branch', ref);
  args.push(cloneUrl, targetPath);

  // Capture stderr so we can pattern-match it for a structured diagnosis
  // (#0326 Part C) instead of just dumping a generic error.
  const result = spawnSync('git', args, { encoding: 'utf-8', env: { ...process.env, ...gitConfigEnv } });
  if (result.stdout) process.stdout.write(result.stdout);
  // Only mirror stderr on failure: --quiet already suppresses progress lines,
  // but error output (auth failures, unreachable host) still lands in stderr
  // and diagnoseCloneFailure needs it to produce a structured hint.
  if (result.status !== 0 && result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    const stderr = result.stderr ?? '';
    const diagnosis = diagnoseCloneFailure(stderr, vcsUrl, schemeUsed, appId);
    console.error(
      `[error] git clone failed (exit ${result.status ?? 'unknown'}).\n` +
      `  URL: ${vcsUrl}\n` +
      (ref ? `  Ref: ${ref}\n` : '') +
      `  Target: ${targetPath}\n` +
      `  Token scheme used: ${schemeUsed}\n` +
      `\n${diagnosis.hint}\n` +
      `\nStructured event logged as ${diagnosis.logCode} -- see\n` +
      `  swao log tail --level error\n`,
    );
    process.exit(1);
  }

  // Strip token from remote.origin.url so it is not persisted in .git/config
  if (token) {
    spawnSync('git', ['-C', targetPath, 'remote', 'set-url', 'origin', vcsUrl], { env: { ...process.env, ...gitConfigEnv } });
  }

  console.log(`[ok]  Clone complete -> ${targetPath}`);
  if (appId) {
    try {
      logApp(appId, 'info', 'provider.vcs.clone-ok', `git clone complete`, {
        context: { app_id: appId, vcs_url: vcsUrl, ref: ref ?? null, target_path: targetPath },
      });
    } catch { /* logging best-effort */ }
  }
}

function resolveSourcePath(
  workspaceAppDir: string,
  swaoYml: Record<string, unknown>,
  cliSourcePath: string | undefined,
): string {
  if (cliSourcePath) return isAbsolute(cliSourcePath) ? cliSourcePath : resolve(cliSourcePath);
  const src = swaoYml.source as Record<string, unknown> | undefined;
  const srcPath = src?.path;
  const base = typeof srcPath === 'string' && srcPath.length > 0
    ? resolve(workspaceAppDir, srcPath)
    : resolve(workspaceAppDir, 'source');
  // #1499: when vcs.subdir is configured, scope every analysis pass to that
  // subdirectory so mono-repo clones do not produce cross-app findings.
  const vcsSubdir = (src?.vcs as Record<string, unknown> | undefined)?.subdir;
  if (typeof vcsSubdir === 'string' && vcsSubdir.length > 0) {
    return join(base, vcsSubdir);
  }
  return base;
}

// #0516: returns true when dir contains at least one non-README source file.
// An all-README directory means the source was never cloned -- passes would
// silently run with no evidence and emit all-UNKNOWN signals.
function checkSourceNonEmpty(dir: string): boolean {
  if (!existsSync(dir)) return false;
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

// #0264: recursive file count for run-manifest.files_assessed.
// Counts every file (no extension filter -- matches operator intuition that
// "files scanned" = everything under that dir, including markdown / yaml /
// images). Skips dot-dirs (.git, .swao) so VCS noise stays out. Returns 0
// for missing or unreadable directories.
function countFilesRecursive(rootDir: string): number {
  if (!existsSync(rootDir)) return 0;
  let total = 0;
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) stack.push(join(dir, e.name));
      else if (e.isFile()) total++;
    }
  }
  return total;
}

function msToHuman(ms: number): string {
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function printStatsTable(stats: PassStat[], totalMs: number, totalSignals: number): void {
  const COL_PASS = 34;
  const COL_SIG = 8;
  const COL_MS = 10;
  const sep = '-'.repeat(COL_PASS + COL_SIG + COL_MS + 4);

  console.log('');
  console.log('Pass statistics');
  console.log(sep);
  console.log(
    `${'Pass'.padEnd(COL_PASS)}  ${'Items'.padStart(COL_SIG)}  ${'Wall clock'.padStart(COL_MS)}`,
  );
  console.log(sep);
  for (const s of stats) {
    const label = `Pass ${s.num} -- ${s.pass}`;
    // #0846: use items_emitted (signals OR blocks evaluated OR malware items) when available;
    // fall back to signals_emitted so older manifests still display correctly.
    const displayed = s.items_emitted ?? s.signals_emitted;
    console.log(
      `${label.padEnd(COL_PASS)}  ${String(displayed).padStart(COL_SIG)}  ${msToHuman(s.wall_clock_ms).padStart(COL_MS)}`,
    );
  }
  console.log(sep);
  console.log(
    `${'Total'.padEnd(COL_PASS)}  ${String(totalSignals).padStart(COL_SIG)}  ${msToHuman(totalMs).padStart(COL_MS)}`,
  );
  console.log('');
}

/**
 * Host dependencies injected into registerAssess (#0579 + #0583). `runForApp` is
 * the production per-app runner the host builds from its resolved swao CLI path
 * (buildSpawnRunForApp); the general --portfolio branch dispatches through it.
 *
 * #0583 (per-tier builds): runPortfolio / formatPortfolioResult are injected so
 * the Enterprise module CODE can be excluded from lower-tier bundles. In
 * Community + Consultant builds they are gated stubs (throw the Enterprise tier
 * error); the requireTier('enterprise') gate in the action fires FIRST in those
 * tiers, so the stub is never reached on the happy path. The types are imported
 * via `import type` (erased by esbuild), so declaring these slots does NOT pull
 * the module code into the bundle.
 */
export interface AssessDeps {
  runForApp: PortfolioRunDeps['runForApp'];
  /** Enterprise: spawn-based per-app portfolio dispatcher. */
  runPortfolio?: (
    workspacePath: string,
    command: 'assess' | 'report',
    extraArgs: string[],
    deps: PortfolioRunDeps,
  ) => Promise<PortfolioResult>;
  /** Enterprise: render a PortfolioResult as a human-readable summary block. */
  formatPortfolioResult?: (result: PortfolioResult) => string;
}

export function registerAssess(program: Command, deps: AssessDeps): void {
  program
    .command('assess')
    .description('Run WSP assessment passes against a workspace app (inv, state, data, ctx, sbom, tf, egr, crypto, synth, comp, blocks, scope). Pass 11 (comp) and Pass 12 (blocks) require an LLM key. Use --portfolio to assess all apps in one run (Enterprise).')
    .option('--app <appId>', 'Application ID to assess (required unless --portfolio)')
    .option('--type <type>', 'Assessment type: application (default), service, landing-zone-catalog, llm. Overrides assessment.type in .swao.yml. For Service Portfolio Assessment use the swao service command. Use landing-zone (deprecated) as alias for landing-zone-catalog. Legacy types (audit, hybrid) print a coming-soon notice.')
    .option('--workspace <path>', 'Portfolio workspace directory (default: cwd)')
    .option(
      '--passes <list>',
      `Comma-separated pass list: ${DEFAULT_PASS_KEYS.join(',')} (default: all ${DEFAULT_PASS_KEYS.length}). The list is a set; passes always run in canonical order. Pass \`dynamic\` to opt into the Playwright crawl; exclude it for fast static-only runs. Opt-in extras (not in default): malware (Gitleaks + OSV-Scanner + ClamAV + YARA -- install tools to PATH first). Pass 23 (LZR) runs via --lzr.`,
      DEFAULT_PASS_KEYS.join(','),
    )
    .option('--source-path <path>', 'Override source code path (overrides .swao.yml source.path)')
    .option('--no-cache', 'Disable LLM response cache and fixture cassettes; always call the real provider')
    .option('--no-cassette', 'Use workspace cache only; skip committed fixture cassettes (useful when seeding fresh cassettes)')
    .option('--force', 'Override accepted-run lock and run assessment anyway')
    .option('--iter <n>', 'Iteration number', '1')
    .option('--stats', 'Print per-pass timing table after run', false)
    .option('--no-crawl', 'Skip dynamic analysis (Playwright crawl)')
    .option('--lzr <landingZoneId>', 'Run Pass 23 (LZR) for the specified landing zone ID')
    .option('--lzr-fail-on-blocked', 'Exit 4 when LZR overall_verdict is blocked', false)
    .option('--lz-provider <provider>', 'For --type landing-zone-catalog: CSP catalogue provider (aws, azure, stackit, ...). Falls back to assessment.landing_zone.provider in .swao.yml.')
    .option('--lz-region <regionId>', 'For --type landing-zone-catalog: catalogue region id (e.g. eu-central-1). Falls back to assessment.landing_zone.region in .swao.yml.')
    .option('--lz-cat-provider <provider>', 'For app assessment: run inline LZ catalogue fit against this CSP provider. Overrides assessment.landing_zone.provider in .swao.yml.')
    .option('--lz-cat-region <regionId>', 'For app assessment: run inline LZ catalogue fit against this region. Overrides assessment.landing_zone.region in .swao.yml.')
    .option('--lz-cat-targets <pairs>', 'For app assessment: comma-separated provider:region pairs for multiple LZ catalogue fits (e.g. aws-esc:eusc-de-east-1,azure:westeurope). Supersedes --lz-cat-provider/--lz-cat-region.')
    .option('--lz-frameworks <ids>', 'Comma-separated community framework IDs to activate sovereignty gate for LZ assessment (e.g. BSI_C5,GDPR). Falls back to frameworks in .swao.yml.')
    .option('--portfolio', 'Assess all apps in the workspace (Enterprise feature)', false)
    .option('--malware-fail-on-detection', 'Exit 5 when a MAL-01 or MAL-03 detection is present in the malware pass', false)
    .option('--fail-on <condition>', 'Exit 6 when any signal matches the condition (e.g. severity=critical, severity=high). Checks all completed passes.')
    .option('--model <modelId>', 'Override the LLM model for this run (takes precedence over providers.llm.primary.model in .swao.yml). Priority: --model flag > .swao.yml > SWAO_ANTHROPIC_MODEL / SWAO_OPENAI_MODEL env var. Example: --model claude-opus-4-8')
    .option('--llm <connector[:model]>', 'SWAO LLM-Gateway connector (Design 090) with optional model, e.g. --llm openrouter:mistralai/mistral-large. Connectors are discovered from bundled seeds + wsp/inputs/llm-gateway/.')
    .option('--skip-llm', 'Make no LLM call: removes ctx, comp and blocks from the pass list, runs data and synth without an LLM (they record a DATA-00 / SYNTH-00 skip marker) and disables Pass 10 vision analysis. Alias: --no-llm', false)
    .on('option:portfolio', () => {
      try {
        LicenseGuard.load().requireTier('enterprise', { feature: 'assess --portfolio' });
      } catch (e) {
        if (e instanceof LicenseTierError) {
          printLicenseGateError(e.feature ?? 'swao assess --portfolio', e.required, e.current);
        }
        if (e instanceof LicenseLimitError) {
          printLicenseLimitError(e);
        }
      }
    })
    .action(
      async (opts: {
        app?: string;
        type?: string;
        workspace?: string;
        passes: string;
        sourcePath?: string;
        cache: boolean;
        cassette: boolean;
        force: boolean;
        iter: string;
        stats: boolean;
        crawl: boolean;
        lzr?: string;
        lzrFailOnBlocked: boolean;
        lzProvider?: string;
        lzRegion?: string;
        lzCatProvider?: string;
        lzCatRegion?: string;
        lzCatTargets?: string;
        lzFrameworks?: string;
        portfolio: boolean;
        malwareFailOnDetection: boolean;
        failOn?: string;
        model?: string;
        llm?: string;
        skipLlm: boolean;
      }) => {
        // #0137 / #2185: resolve via --workspace or walk up. Exit early if not found.
        const workspaceRoot = opts.workspace
          ? resolve(opts.workspace)
          : findWorkspace(process.cwd());
        if (!workspaceRoot) {
          console.error('[error] No SWAO workspace found in the current directory or any parent.\n' +
                        '  Run `swao init` to initialise a workspace here, or navigate to an existing workspace.');
          process.exit(1);
        }
        setWorkspaceRoot(workspaceRoot);

        // #3158: an explicit --passes overrides lens/pass_profile opt-in additions.
        // Compared as a set: callers may still send the previous default order.
        const passesExplicit = (() => {
          const given = new Set(opts.passes.split(',').map((p) => p.trim().toLowerCase()).filter((p) => p.length > 0));
          return given.size !== DEFAULT_PASS_KEYS.length || DEFAULT_PASS_KEYS.some((k) => !given.has(k));
        })();
        // #1625: --skip-llm removes comp and blocks from the pass list so
        // CI/smoke/offline runs do not need to enumerate every static pass manually.
        // #2441: also exclude ctx (pass 04) -- it calls llm.complete() unconditionally when
        // llm is configured, and a non-JSON response throws, aborting the whole run.
        // #3158: --skip-llm also withholds the provider from every remaining pass
        // (llmConfigured is forced to false below), so DATA and SYNTH no longer call
        // a configured LLM; they record their skip marker instead.
        if (opts.skipLlm) {
          opts.passes = applySkipLlm(opts.passes);
        }

        // --- Portfolio enterprise gate ---
        if (opts.portfolio) {
          const guard = LicenseGuard.load();
          try {
            guard.requireTier('enterprise', { feature: 'assess --portfolio' });
          } catch (err) {
            if (err instanceof LicenseTierError) {
              printLicenseGateError(err.feature ?? 'swao assess --portfolio', err.required, err.current);
            }
            if (err instanceof LicenseLimitError) {
              printLicenseLimitError(err);
            }
            if (err instanceof LicenseInvalidError) {
              printLicenseInvalidError((err as Error).message);
            }
            throw err;
          }

          if (opts.lzr) {
            const summary = await runPortfolioLzr(workspaceRoot, opts.lzr);
            // Symmetric dual-wsp (#0230): portfolio outputs go under
            // <workspace>/wsp/, matching the per-app <app>/wsp/ shape.
            const runTs = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
            const portfolioWspDir = join(workspaceRoot, 'wsp');
            const portfolioRunDir = join(portfolioWspDir, 'runs', runTs);
            mkdirSync(portfolioRunDir, { recursive: true });
            const summaryPath = join(portfolioRunDir, 'lzr-summary.json');
            writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
            writeFileSync(join(portfolioWspDir, 'latest.txt'), `runs/${runTs}`, 'utf-8');
            console.log(
              `[ok]  Portfolio LZR: ${summary.counts.ready} ready, ${summary.counts.advisory} advisory, ${summary.counts.blocked} blocked, ${summary.counts.skipped} skipped`,
            );
            console.log(`[ok]  Overall verdict: ${summary.overall_verdict.toUpperCase()}`);
            console.log(`[ok]  Results written to ${summaryPath}`);
          } else {
            // #0579: general portfolio assess. The orchestrator discovers apps
            // under <workspace>/apps/ and spawns `swao assess --app <id>` per
            // app via the host-injected runForApp, then aggregates ok/fail. It
            // does NOT pass --portfolio to the per-app runs (no re-entry).
            // #0583: runPortfolio / formatPortfolioResult are Enterprise-tier
            // injected deps. The requireTier('enterprise') gate above fires
            // first in lower tiers, so this is unreachable there; the guard is
            // defensive (a missing impl re-asserts the same Enterprise gate).
            if (!deps.runPortfolio || !deps.formatPortfolioResult) {
              LicenseGuard.load().requireTier('enterprise', { feature: 'assess --portfolio' });
              throw new Error('[bug] assess --portfolio: Enterprise portfolio impl not injected.');
            }
            const portfolioExtraArgs: string[] = [];
            if (opts.passes) portfolioExtraArgs.push('--passes', opts.passes);
            if (opts.type) portfolioExtraArgs.push('--type', opts.type);
            // #3319: forward --skip-llm so each per-app child also withholds the
            // provider from DATA / SYNTH (#3158), not just the reduced pass list.
            if (opts.skipLlm) portfolioExtraArgs.push('--skip-llm');
            const result = await deps.runPortfolio(workspaceRoot, 'assess', portfolioExtraArgs, deps as PortfolioRunDeps);
            console.log(deps.formatPortfolioResult(result));
            process.exit(result.counts.failed > 0 ? 1 : 0);
          }
          process.exit(0);
        }
        if (!opts.app) {
          console.error('[error] --app <appId> is required for single-app assess. Use --portfolio for cross-app (Enterprise).');
          process.exit(1);
        }
        const workspaceAppDir = join(workspaceRoot, 'apps', opts.app);

        if (!existsSync(workspaceAppDir)) {
          console.error(
            `[error] App '${opts.app}' not found in workspace.\n` +
            `  Expected: ${workspaceAppDir}\n` +
            `  -- Run 'swao setup' if you have not configured a workspace yet, or\n` +
            `  -- cd into your workspace directory and try again.\n` +
            `  Workspace searched: ${workspaceRoot}`,
          );
          process.exit(1);
        }

        // --- Accepted-run guard (#0477 C-21) ---
        // When wsp/accepted-run.json exists and --force is not passed, warn and exit.
        if (!opts.force) {
          const accepted = loadAcceptedRun(workspaceAppDir);
          if (accepted) {
            console.error(`[warn] An accepted run exists for '${opts.app}': ${accepted.run_id}`);
            console.error(`       Accepted at: ${accepted.accepted_at}${accepted.note ? `  Note: ${accepted.note}` : ''}`);
            console.error(`       Run 'swao assess --force' to override, or 'swao accept --unset' to clear the lock.`);
            process.exit(2);
          }
        }

        // --- Licence assessment-budget gate (M18 #0273) ---
        // No-op for Community (no budget) and for Enterprise with
        // `assessment_limit: null` (unlimited). Blocks before any pass
        // runs so we do not waste LLM tokens or wall-clock time.
        try {
          LicenseGuard.load().guardAssessmentBudget();
        } catch (err) {
          if (err instanceof LicenseLimitError) {
            printLicenseLimitError(err);
          }
          if (err instanceof LicenseInvalidError) {
            printLicenseInvalidError((err as Error).message);
          }
          throw err;
        }

        const swaoYmlPath = join(workspaceAppDir, '.swao.yml');
        let swaoYml: Record<string, unknown> = {};
        if (existsSync(swaoYmlPath)) {
          const raw = load(readFileSync(swaoYmlPath, 'utf-8')) ?? {};
          const parsed = SwaoYmlSchema.safeParse(raw);
          if (!parsed.success) {
            const firstIssue = parsed.error.issues[0];
            console.error(`[error] .swao.yml validation failed: ${firstIssue?.message ?? 'invalid format'}`);
            process.exit(1);
          }
          swaoYml = parsed.data as Record<string, unknown>;
        }

        // --- Assessment-type routing (#0554) ---
        // Resolve the assessment type from --type, else assessment.type in
        // .swao.yml, else the default (application). The router in @swao/core
        // owns default + deprecated-alias normalisation, the coming-soon guard,
        // and the unknown-type error. `type: application` is driven by the
        // pass loop below (which owns the LLM factory + WSP I/O); other types
        // route through their registered AssessmentTypeContribution, and
        // known-but-unimplemented types print a coming-soon notice and exit 0.
        const assessmentCfg = swaoYml.assessment as Record<string, unknown> | undefined;
        const requestedType = opts.type ?? (assessmentCfg?.['type'] as string | undefined);
        const assessRouter = new AssessmentTypeRouter();
        assessRouter.register(appAssessmentType);
        assessRouter.register(landingZoneAssessmentType);
        assessRouter.register(llmAssessmentType);
        assessRouter.register(serviceAssessmentType); // ADR-0064
        let routeDecision;
        try {
          routeDecision = assessRouter.route(requestedType);
        } catch (err) {
          if (err instanceof UnknownAssessmentTypeError) {
            console.error(`[error] ${err.message}`);
            process.exit(1);
          }
          throw err;
        }
        if (routeDecision.kind === 'coming-soon') {
          console.log(`[assess] ${routeDecision.message}`);
          console.log('[assess] Run `swao assess --type application` for the standard application-workload assessment.');
          process.exit(0);
        }
        if (routeDecision.type === 'llm') {
          // LLM Assessment for SWAO (Design 092). L1 dispatch: gates fire in
          // order (tier, then completed-App-Assessment precondition); the leg
          // engine (#1421..#1426) replaces the EnginePendingError path.
          logApp(opts.app, 'info', 'llm-assessment.start', 'LLM Assessment starting', {
            context: { workspace: workspaceRoot },
          });
          if (!opts.app) {
            console.error('[error] --app <id> is required for --type llm (the target app must have a completed App Assessment).');
            process.exit(1);
          }
          const llmAppId: string = opts.app;
          try {
            // Resolve legs from the PORTFOLIO-level llm_assessment config
            // (092 s4 -- the block lives in the workspace root .swao.yml,
            // not the app-level one this command parsed above).
            const portfolioYmlPath = join(workspaceRoot, '.swao.yml');
            const portfolioYml = existsSync(portfolioYmlPath)
              ? ((load(readFileSync(portfolioYmlPath, 'utf-8')) ?? {}) as Record<string, unknown>)
              : {};
            const llmCfgParse = SwaoYmlLlmAssessmentSchema.safeParse(
              portfolioYml['llm_assessment'] ?? {},
            );
            if (!llmCfgParse.success) {
              console.error(`[error] .swao.yml llm_assessment block invalid: ${llmCfgParse.error.issues[0]?.message}`);
              process.exit(1);
            }
            const llmCfg = llmCfgParse.data;
            if (!llmCfg.legs || llmCfg.legs.length < 2) {
              console.error('[error] LLM Assessment needs 2..5 legs in the portfolio .swao.yml, e.g.:');
              console.error('  llm_assessment:');
              console.error('    legs:');
              console.error('      - { connector: openrouter, model: anthropic/claude-sonnet-4, primary: true }');
              console.error('      - { connector: openrouter, model: deepseek/deepseek-v4-flash }');
              process.exit(1);
            }
            // Resolve ~-prefix model aliases before running legs (#1817).
            const legs: ResolvedLeg[] = await Promise.all(llmCfg.legs.map(async (l, i) => {
              let model = l.model ?? 'default';
              if (model.startsWith('~')) {
                const loaded = getConnector(l.connector, { workspaceRoot });
                if (loaded) {
                  const credKey = loaded.file.connector.auth?.credential_key;
                  let apiKey: string | undefined;
                  if (credKey) {
                    try {
                      const store = new CredentialStore().loadSync();
                      apiKey = store[credKey] || undefined;
                    } catch { /* store unavailable */ }
                  }
                  model = await resolveModelAlias(model, loaded.file.connector, apiKey);
                }
              }
              return {
                id: `${l.connector}--${model.replace(/[^a-zA-Z0-9.-]/g, '_')}`,
                connector: l.connector,
                model,
                primary: l.primary ?? i === 0,
                // Cost source refinement (configured prices, sha256 capture)
                // lands with the L4 cost preview; local connectors are the
                // ones with no platform billing.
                costSource: l.connector === 'ollama' ? 'local' : 'billed',
              };
            }));
            const result = await runLlmAssessment(
              {
                appId: opts.app,
                workspacePath: workspaceRoot,
                iter: parseInt(opts.iter, 10) || 1,
                assessedAt: new Date().toISOString().slice(0, 10),
                // Gates and orchestration need no CoreContext; providers are
                // resolved inside the leg CHILD processes.
                core: undefined as never,
              },
              async () => {
                const orchestration = await orchestrateLegs({
                  workspaceRoot,
                  appId: llmAppId,
                  legs,
                  execution: llmCfg.execution ?? 'serial',
                  repeat: llmCfg.repeat ?? 1,
                  weights: {
                    quality: llmCfg.weights?.quality ?? 0.5,
                    reliability: llmCfg.weights?.reliability ?? 0.2,
                    performance: llmCfg.weights?.performance ?? 0.15,
                    cost: llmCfg.weights?.cost ?? 0.15,
                    security: llmCfg.weights?.security ?? 0.1,
                  },
                  keepLegWsp: llmCfg.keep_leg_wsp ?? false,
                  passSuiteVersion: SWAO_VERSION,
                  onProgress: (m) => console.log(`[llm-assessment] ${m}`),
                  // #1587: invoke challenge prompts per leg using the leg's own
                  // provider connector and model. Enterprise-gated via the outer
                  // `assess --type llm` requirement (lines 582-593). Each leg runs
                  // its own adversarial challenge against its own App Assessment
                  // findings so cross-leg resilience scores are non-degenerate.
                  spawnChallenge: async (leg, _legWorkspaceRoot, legEnv): Promise<ChallengePassResult> => {
                    const challengeStarted = Date.now();

                    logApp(llmAppId, 'info', 'assess.pass.challenge.start',
                      `Challenge starting for leg ${leg.id} (${leg.connector}/${leg.model})`, {
                        context: { leg_id: leg.id, connector: leg.connector, model: leg.model },
                      });

                    const isPkg = Boolean((process as { pkg?: unknown }).pkg);
                    const cmd = process.execPath;
                    const baseArgs = isPkg ? [] : [process.argv[1] ?? ''];
                    // Pass --connector and --model so challenge uses this leg's
                    // provider, not the workspace default (#1587).
                    const challengeArgs = [
                      ...baseArgs,
                      'challenge', '--app', llmAppId, '--all-agents', '--report',
                      '--connector', leg.connector,
                      ...(leg.model !== 'default' ? ['--model', leg.model] : []),
                    ];
                    // #2901: inject the parent's live token so the challenge subprocess
                    // does not re-read an expired vault entry. The parent's token (loaded
                    // at session start) is valid; the vault copy may be expired by the time
                    // challenge passes run (ADFS TTL = 60 min, 4-leg runs can exceed this).
                    const challengeLoaded = getConnector(leg.connector, { workspaceRoot });
                    const challengeTokenEnv: Record<string, string> = {};
                    if (challengeLoaded) {
                      const cAuth = challengeLoaded.file.connector.auth;
                      if (cAuth.env_var) {
                        const liveToken = process.env[cAuth.env_var]
                          ?? (() => {
                            try {
                              const credKey = cAuth.credential_key;
                              if (!credKey) return '';
                              const store = new CredentialStore().loadSync();
                              return (credKey in store && store[credKey]) ? store[credKey] : '';
                            } catch { return ''; }
                          })();
                        if (liveToken) challengeTokenEnv[cAuth.env_var] = liveToken;
                      }
                    }
                    const spawnResult = await new Promise<{ exitCode: number | null }>((res) => {
                      const child = spawn(
                        cmd,
                        challengeArgs,
                        {
                          // Run from the MAIN workspace -- the leg workspace is a
                          // fresh temp copy that has no challenge agents configured
                          // (#1774). The main workspace carries the .swao.yml
                          // challenge section and any prior combined.yaml artefacts.
                          cwd: workspaceRoot,
                          // Forward SWAO_LLM_ASSESSMENT_* so challenge
                          // subprocess streams CallRecords to the leg sink (#1819).
                          env: { ...process.env, ...legEnv, ...challengeTokenEnv, PKG_EXECPATH: '' },
                          stdio: 'ignore',
                          windowsHide: true,
                        },
                      );
                      registerChild(child);
                      child.on('error', () => res({ exitCode: null }));
                      child.on('exit', (code) => res({ exitCode: code }));
                    });

                    const durationMs = Date.now() - challengeStarted;
                    // Read the challenge this leg's subprocess wrote (#3336): files
                    // older than the spawn are ignored; the run id is ignored by
                    // design (every leg challenges the main run, see llm-leg-challenge.ts).
                    type AgentEntry = LegChallengeAgent;
                    const legRead = readLegChallengeAgents(join(workspaceRoot, 'apps', llmAppId, 'wsp'), 'app', challengeStarted);
                    const agentData: Array<AgentEntry> = legRead.agents;
                    if (legRead.source && agentData.length > 0 && !legRead.source.endsWith('combined.yaml')) {
                      logApp(llmAppId, 'info', 'challenge.input.loaded',
                        `Challenge data loaded from ${legRead.source} (combined.yaml absent)`, {
                          context: { leg_id: leg.id, source_dir: legRead.source, agent_count: agentData.length },
                        });
                    }
                    // #2283: exit code 2 from the challenge subprocess = no agents configured
                    // (clean skip, not an error). Normalise to 0 so downstream tooling treats
                    // it as a successful no-op rather than an error condition.
                    const noAgentsConfigured = spawnResult.exitCode === 2 && agentData.length === 0;
                    const effectiveExitCode = noAgentsConfigured ? 0 : spawnResult.exitCode;
                    const result: ChallengePassResult = {
                      completed_at: new Date().toISOString(),
                      agents: agentData.map((a) => ({
                        agent_id: String(a['agent_id'] ?? 'unknown'),
                        calls: 1,
                        dnf: effectiveExitCode !== 0,
                        duration_ms: Math.round(durationMs / Math.max(agentData.length, 1)),
                      })),
                      exit_code: effectiveExitCode,
                    };

                    const agentsCompleted = result.agents.filter(a => !a.dnf).length;
                    if (noAgentsConfigured) {
                      logApp(llmAppId, 'info', 'assess.pass.challenge.skip',
                        `Challenge skipped for leg ${leg.id}: no agents configured`, {
                          context: { leg_id: leg.id, connector: leg.connector, model: leg.model, duration_ms: durationMs },
                        });
                    } else {
                      logApp(llmAppId, 'info', 'assess.pass.challenge.complete',
                        `Challenge complete for leg ${leg.id}: ${agentsCompleted}/${result.agents.length} agents`, {
                          context: {
                            leg_id: leg.id, connector: leg.connector, model: leg.model,
                            agents_completed: agentsCompleted,
                            agents_total: result.agents.length,
                            exit_code: result.exit_code,
                            duration_ms: durationMs,
                          },
                        });
                    }

                    return result;
                  },
                  spawnLeg: (leg, legWorkspaceRoot, legEnv) =>
                    new Promise((resolveSpawn) => {
                      const started = Date.now();
                      // Self-spawn: pkg binary spawns itself; dev spawns
                      // node + the CLI entry. PKG_EXECPATH must be cleared
                      // (#0807-P3) or the pkg spawn patch injects the parent
                      // binary path into the child.
                      const isPkg = Boolean((process as { pkg?: unknown }).pkg);
                      const cmd = process.execPath;
                      const baseArgs = isPkg ? [] : [process.argv[1] ?? ''];
                      const child = spawn(
                        cmd,
                        // Only suppress crawl in legs when the parent was also called
                        // with --no-crawl; if the app has dynamic in its pass profile
                        // the leg should honour it too (#1818).
                        [...baseArgs, 'assess', '--app', llmAppId, '--llm', `${leg.connector}:${leg.model}`, '--no-cache', ...(opts.crawl === false ? ['--no-crawl'] : [])],
                        {
                          cwd: legWorkspaceRoot,
                          env: { ...process.env, ...legEnv, PKG_EXECPATH: '' },
                          stdio: ['ignore', 'pipe', 'pipe'],
                          windowsHide: true,
                        },
                      );
                      registerChild(child);
                      let tail = '';
                      const keepTail = (d: Buffer) => { tail = (tail + d.toString()).slice(-4000); };
                      child.stdout?.on('data', keepTail);
                      child.stderr?.on('data', keepTail);
                      child.on('error', () => resolveSpawn({ exitCode: null, durationMs: Date.now() - started }));
                      child.on('exit', (code) => {
                        if (code !== 0) console.error(`[llm-assessment] leg ${leg.id} output tail:\n${tail.slice(-1500)}`);
                        resolveSpawn({ exitCode: code, durationMs: Date.now() - started });
                      });
                    }),
                  // #1820: LZ sovereignty challenge per leg -- mirrors spawnChallenge
                  // but invokes `swao challenge --lz --all-agents`. Results produce
                  // C2-namespace PassGroups in the comparison report.
                  spawnLzChallenge: async (leg, _legWorkspaceRoot, legEnv): Promise<ChallengePassResult> => {
                    const lzStarted = Date.now();
                    logApp(llmAppId, 'info', 'assess.pass.challenge-lz.start',
                      `LZ Challenge starting for leg ${leg.id} (${leg.connector}/${leg.model})`, {
                        context: { leg_id: leg.id, connector: leg.connector, model: leg.model },
                      });
                    const isPkgLz = Boolean((process as { pkg?: unknown }).pkg);
                    const cmdLz = process.execPath;
                    const baseArgsLz = isPkgLz ? [] : [process.argv[1] ?? ''];
                    const challengeLzArgs = [
                      ...baseArgsLz,
                      'challenge', '--type', 'lz', '--app', llmAppId, '--all-agents',
                      '--connector', leg.connector,
                      ...(leg.model !== 'default' ? ['--model', leg.model] : []),
                    ];
                    // #2901: same live-token injection as spawnChallenge.
                    const lzLoaded = getConnector(leg.connector, { workspaceRoot });
                    const lzTokenEnv: Record<string, string> = {};
                    if (lzLoaded) {
                      const lzAuth = lzLoaded.file.connector.auth;
                      if (lzAuth.env_var) {
                        const lzLiveToken = process.env[lzAuth.env_var]
                          ?? (() => {
                            try {
                              const credKey = lzAuth.credential_key;
                              if (!credKey) return '';
                              const store = new CredentialStore().loadSync();
                              return (credKey in store && store[credKey]) ? store[credKey] : '';
                            } catch { return ''; }
                          })();
                        if (lzLiveToken) lzTokenEnv[lzAuth.env_var] = lzLiveToken;
                      }
                    }
                    const spawnResultLz = await new Promise<{ exitCode: number | null }>((res) => {
                      const childLz = spawn(
                        cmdLz,
                        challengeLzArgs,
                        {
                          cwd: workspaceRoot,
                          env: { ...process.env, ...legEnv, ...lzTokenEnv, PKG_EXECPATH: '' },
                          stdio: 'ignore',
                          windowsHide: true,
                        },
                      );
                      registerChild(childLz);
                      childLz.on('error', () => res({ exitCode: null }));
                      childLz.on('exit', (code) => res({ exitCode: code }));
                    });
                    const durationMsLz = Date.now() - lzStarted;
                    // LZCA_*.yaml of the challenge-lz/<ts>/ folder this leg wrote (#3336;
                    // folders older than the spawn are ignored, run id ignored by design).
                    const lzAgentData = readLegChallengeAgents(join(workspaceRoot, 'apps', llmAppId, 'wsp'), 'lz', lzStarted).agents
                      .map(a => ({ agent_id: String(a.agent_id ?? 'unknown') }));
                    // #2283: exit code 2 = no LZ agents configured (clean skip).
                    const noLzAgentsConfigured = spawnResultLz.exitCode === 2 && lzAgentData.length === 0;
                    const effectiveLzExitCode = noLzAgentsConfigured ? 0 : spawnResultLz.exitCode;
                    const lzResult: ChallengePassResult = {
                      completed_at: new Date().toISOString(),
                      agents: lzAgentData.map((a) => ({
                        agent_id: String(a.agent_id),
                        calls: 1,
                        dnf: effectiveLzExitCode !== 0,
                        duration_ms: Math.round(durationMsLz / Math.max(lzAgentData.length, 1)),
                      })),
                      exit_code: effectiveLzExitCode,
                    };
                    const lzCompleted = lzResult.agents.filter(a => !a.dnf).length;
                    if (noLzAgentsConfigured) {
                      logApp(llmAppId, 'info', 'assess.pass.challenge-lz.skip',
                        `LZ Challenge skipped for leg ${leg.id}: no agents configured`, {
                          context: { leg_id: leg.id, connector: leg.connector, model: leg.model, duration_ms: durationMsLz },
                        });
                    } else {
                      logApp(llmAppId, 'info', 'assess.pass.challenge-lz.complete',
                        `LZ Challenge complete for leg ${leg.id}: ${lzCompleted}/${lzResult.agents.length} agents`, {
                          context: {
                            leg_id: leg.id, connector: leg.connector, model: leg.model,
                            agents_completed: lzCompleted,
                            agents_total: lzResult.agents.length,
                            exit_code: lzResult.exit_code,
                            duration_ms: durationMsLz,
                          },
                        });
                    }
                    return lzResult;
                  },
                });
                console.log('');
                console.log(`[llm-assessment] complete: ${orchestration.records.length} calls across ${legs.length} legs, ${orchestration.findingsCount} finding(s)`);
                const ranks = Object.entries(orchestration.final.rank)
                  .filter((e): e is [string, number] => e[1] !== null)
                  .sort((a, b) => a[1] - b[1]);
                for (const [legId, rank] of ranks) {
                  const score = orchestration.final.score[legId];
                  const partial = orchestration.final.partial[legId] ? ' (partial: no ' + orchestration.final.partial[legId]!.join('/') + ' score)' : '';
                  console.log(`[llm-assessment]   ${rank}. ${legId}  score ${score}${partial}`);
                }
                console.log(`[llm-assessment] results: ${orchestration.runDir}`);

                // #1587: include per-leg challenge results in WSP output (additive
                // minor version bump per ADR-0012). Read challengePassGroups from
                // the publication model that orchestrateLegs already wrote to disk.
                // Shape: LlmPassGroup[] -- { pass_id, legs: Record<legId, { calls, dnf, ... }>, rank }
                // (see llm-pub-data.ts LlmPassGroup + LlmPassLegAggregate).
                // dnf is a COUNT (integer), not a boolean.
                type RawLegAgg = { calls: number; dnf: number };
                type RawPassGroup = { pass_id: string; legs: Record<string, RawLegAgg> };
                let challengePassGroups: RawPassGroup[] = [];
                let challengeResilienceScore = 0;
                try {
                  const pubModelPath = join(orchestration.runDir, 'comparison', 'publication-model.json');
                  if (existsSync(pubModelPath)) {
                    const pubModel = JSON.parse(readFileSync(pubModelPath, 'utf-8')) as Record<string, unknown>;
                    const raw = pubModel['challengePassGroups'];
                    if (Array.isArray(raw)) {
                      challengePassGroups = raw as RawPassGroup[];
                      const allAggs = challengePassGroups.flatMap(g => Object.values(g.legs));
                      const totalCalls = allAggs.reduce((n, a) => n + (a.calls ?? 0), 0);
                      const totalDnf = allAggs.reduce((n, a) => n + (a.dnf ?? 0), 0);
                      challengeResilienceScore = totalCalls > 0
                        ? Math.round((1 - totalDnf / totalCalls) * 100) / 100
                        : 0;
                    }
                  }
                } catch { /* non-fatal -- challenge results absent in WSP is acceptable */ }

                return {
                  wsp_version: 'llm-assessment/1.1',
                  generated_at: new Date().toISOString(),
                  signals: [],
                  run_dir: orchestration.runDir,
                  challenge_results: challengePassGroups,
                  challenge_resilience_score: challengeResilienceScore,
                };
              },
            );
            void result;
            // #2399: LLM Assessment runs are always counted; the
            // inputs_changed_since_last_app_assessment guard must not gate this.
            try { LicenseGuard.load().incrementAssessmentCount(); } catch { /* best-effort */ }
            process.exit(0);
          } catch (err) {
            const e = err as Error;
            if (e instanceof EnginePendingError) {
              console.log(`[assess] ${e.message}`);
              process.exit(0);
            }
            const kind = e instanceof LlmAssessmentGateError ? 'precondition'
              : e.name === 'LicenseTierError' ? 'tier'
              : 'error';
            logApp(opts.app, 'warn', 'llm-assessment.refused', `LLM Assessment refused (${kind})`, {
              context: { reason: e.message },
            });
            console.error(`[error] ${e.message}`);
            process.exit(1);
          }
        }
        if (routeDecision.type === 'landing-zone-catalog') {
          // type: landing-zone-catalog (ADR-0051, #0781). Deterministic, no LLM.
          // Fits the app's assessed needs (from a prior app WSP) against a CSP
          // catalogue region + the workspace LZ scan, with framework-driven
          // sovereignty. Writes wsp/runs/<ts>/passes/lz-fit.yaml + run-manifest
          // + latest.txt + latest-landing-zone-catalog.txt. Does NOT touch the
          // LLM factory / derive-plan / report.

          // Required services from the app's prior WSP (the headline: fit vs the
          // app's ASSESSED needs). loadPriorSignals reads the latest run's
          // signals; deriveConstraints extracts service_dep:<key> tokens, which
          // are the abstract capability keys the catalogue/scan fulfils.
          const priorSignals = loadPriorSignals(workspaceAppDir);
          const constraints = deriveConstraints(priorSignals);
          const lzRequired = constraints.requiredServices.map((s) => ({ code: s.name, signalId: s.signalId }));
          if (lzRequired.length === 0) {
            console.warn('[warn] No app required-services found (no service_dep signals in the latest WSP). Run `swao assess --app ' + opts.app + '` first for a fit against the app\'s assessed needs; reporting catalogue/scan availability only.');
          }

          const lzStart = new Date();
          const lzAssessedAt = lzStart.toISOString().slice(0, 10);
          const lzIter = parseInt(opts.iter, 10) || 1;
          const lzRunTs = lzStart.toISOString().slice(0, 19).replace(/[:.]/g, '-');
          const lzWspDir = join(workspaceAppDir, 'wsp');
          const lzRunDir = join(lzWspDir, 'runs', lzRunTs);
          const lzPassesDir = join(lzRunDir, 'passes');

          // #1614-B: workspace LZ catalogues take precedence for all tiers.
          // Pass the explicit catalogues path so run-lz uses workspace-installed
          // providers (azure-local, delos, oci, otc) regardless of licence tier.
          const _lzCataloguesDirCandidate = join(workspaceRoot, 'wsp', 'inputs', 'catalogs', 'lz-catalogues');
          const lzCataloguesDir = existsSync(_lzCataloguesDirCandidate) ? _lzCataloguesDirCandidate : undefined;

          // #3281: targets from --lz-cat-targets, then --lz-provider/--lz-region, then
          // assessment.landing_zone.targets (app, then workspace .swao.yml), the
          // deprecated assessment.lz_cat_targets, and the single provider + region.
          // A known geography (azure:Europe) resolves to its documented default region.
          const lzTargetConfig = resolveRunLzTargets({
            app: opts.app,
            workspaceRoot,
            cataloguesDir: lzCataloguesDir,
            cliTargets: opts.lzCatTargets,
            cliProvider: opts.lzProvider,
            cliRegion: opts.lzRegion,
            appAssessment: assessmentCfg,
            workspaceAssessment: readWorkspaceAssessment(workspaceRoot),
          });
          const lzRawTargets: { provider: string; region: string }[] = lzTargetConfig.targets;
          if (lzRawTargets.length === 0) {
            console.error('[error] --type landing-zone-catalog requires targets: --lz-cat-targets, --lz-provider and --lz-region, or assessment.landing_zone.targets in .swao.yml. Run `swao lz catalogue list` to see providers.');
            process.exit(1);
          }
          mkdirSync(lzPassesDir, { recursive: true });

          // #3223/#3245: every exit path from here on closes the run: provider.error,
          // lz.assessment.error/complete and swao.run.complete with status + exit_code,
          // plus run-status.json in the run dir (started -> complete | failed | aborted).
          const lzLifecycle = createLzRunLifecycle({
            app: opts.app, runDir: lzRunDir, startedAt: lzStart, targets: lzRawTargets, swaoVersion: SWAO_VERSION,
            resolvedTargets: lzTargetConfig.resolved,
          });
          lzLifecycle.markStarted();
          lzLifecycle.installProcessGuards();
          // The body below is intentionally not re-indented under this try, to keep the
          // diff reviewable; the matching catch follows the final process.exit(0).
          try {

          // #1704: lz.assessment.start -- emitted here only; TUI-side duplicate removed by #1782.
          // #2288: renamed from lz.assess.start to lz.assessment.start for consistency with portfolio-events.
          const lzTargetsStr = lzRawTargets.map(t => `${t.provider}:${t.region}`).join(',');
          try {
            logApp(opts.app, 'info', 'lz.assessment.start', 'Landing Zone Catalog Assessment started', {
              context: { app_id: opts.app, lz_targets: lzTargetsStr },
            });
          } catch { /* logging is best-effort */ }

          // D-LZ-07: load sovereignty declarations from the selected frameworks.
          // Prefers --lz-frameworks flag; falls back to .swao.yml assessment.frameworks,
          // then assessment.regimes_active (#0924 -- compliance pass uses regimes_active).
          const lzFwIds = opts.lzFrameworks
            ? opts.lzFrameworks.split(',').map((s: string) => s.trim()).filter(Boolean)
            : (assessmentCfg?.['frameworks'] as string[] | undefined)
              ?? (assessmentCfg?.['regimes_active'] as string[] | undefined)
              ?? [];
          const lzFrameworkDecls = readFrameworkSovereigntyDecls(lzFwIds, resolveCatalogsDir(workspaceAppDir), communityFrameworksDir);

          // #1794: emit portfolio-level events so the portfolio log is queryable
          // for LZ assessment runs (lz.assessment.* events).
          // #2397: also emit swao.run.start/complete wrapper so portfolio monitors have
          // a uniform envelope regardless of assessment type.
          try {
            logPortfolio('info', 'swao.run.start', 'LZ Catalog Assessment started', {
              context: { type: 'lz-catalog', app: opts.app, swao_version: SWAO_VERSION, provider_count: lzRawTargets.length },
            });
          } catch { /* best-effort */ }
          try {
            logPortfolio('info', 'lz.assessment.start', 'LZ Catalog Assessment started', {
              context: { app: opts.app, providers: lzRawTargets.map(t => `${t.provider}:${t.region}`), provider_count: lzRawTargets.length },
            });
          } catch { /* best-effort */ }

          // Loop over all CSP/region targets and collect results (#0899).
          // Phase 1: compute all fits, buffer results -- no file writes yet.
          // Deferred writes allow remediation patching when the same run contains
          // both SOVEREIGNTY_BLOCKED and READY regions (#1352), and enable accurate
          // per-pass timing in the run manifest (#1354).
          const lzFitBuffer: Array<{
            provider: string; region: string; lzIdx: number;
            wsp: WspResult;
            lzReport: Record<string, unknown>;
            overall: string; passName: string; fileName: string; catFitFileName: string; fitMs: number;
          }> = [];
          const lzTargetResults: { provider: string; region: string; overall: string; signals: number; passName: string; fileName: string; fitMs: number }[] = [];
          let lzTotalSignals = 0;

          // #3223: the loop (provider.start / provider.complete events) lives in
          // runLzProviderFits. Owner decision 2026-10-17: a target that returns
          // ok:false (e.g. unknown region `azure:Europe`) or throws is logged
          // (provider.error + [warning]) and skipped; the run continues and closes
          // as `partial`, or fails (exit 1) only when every target failed.
          const lzLoop = runLzProviderFits({
            app: opts.app,
            targets: lzRawTargets,
            fit: ({ provider: lzP, region: lzR }) => {
              const assembled = assembleLzCatalogWsp({
                workspacePath: workspaceAppDir,
                provider: lzP,
                regionId: lzR,
                requiredServices: lzRequired,
                frameworkDecls: lzFrameworkDecls,
                cataloguesDir: lzCataloguesDir,
                assessedAt: lzAssessedAt,
              });
              if (!assembled.ok) {
                // Unknown region: hand the provider's valid region ids to the loop so
                // provider.error and the console warning can name usable ones.
                let validRegions: string[] | undefined;
                if (/^Region ".*" not found/.test(assembled.error)) {
                  try {
                    validRegions = resolveProviderCatalogue(lzP, workspaceRoot, lzCataloguesDir).catalogue.regions.map((r) => r.id);
                  } catch { /* hint is best-effort */ }
                }
                return { ok: false, error: assembled.error, validRegions };
              }
              const lzReport = assembled.wsp['lz'] as Record<string, unknown>;
              return { ok: true, value: { wsp: assembled.wsp, lzReport }, overall: (lzReport['overall'] as string) ?? 'UNKNOWN' };
            },
          });
          const lzFailedTargets = lzLoop.failures;
          if (lzLoop.results.length === 0) {
            const lzAllFailedReason = `All ${lzRawTargets.length} LZ target(s) failed`;
            lzLifecycle.fail({ status: 'failed', reason: lzAllFailedReason, exitCode: 1, failedTargets: lzFailedTargets });
            console.error(`[error] ${lzAllFailedReason}: ${lzFailedTargets.map(f => `${f.provider}:${f.region}`).join(', ')}`);
            process.exit(1);
          }
          for (const { target: { provider: lzP, region: lzR }, idx: lzIdx, value: { wsp: lzWsp, lzReport }, overall, fitMs } of lzLoop.results) {
            // Single-target preserves the legacy lz-fit.yaml name for backward compat.
            const passName = lzRawTargets.length === 1 ? 'lz_fit' : `lz_fit_${lzIdx}`;
            const fileName = lzRawTargets.length === 1 ? 'lz-fit.yaml' : `lz-fit-${lzP}-${lzR}.yaml`;
            const catFitFileName = lzRawTargets.length === 1
              ? 'lz-catalogue-fit.yaml'
              : `lz-catalogue-fit-${lzP}-${lzR.replace(/[^a-zA-Z0-9-]/g, '-')}.yaml`;
            lzFitBuffer.push({ provider: lzP, region: lzR, lzIdx, wsp: lzWsp, lzReport, overall, passName, fileName, catFitFileName, fitMs });
          }

          // Phase 2: patch SOVEREIGNTY_GAP remediation text when READY alternatives
          // exist in the same run (#1352). Helps the operator identify the sovereign
          // landing zone immediately from the gap report.
          const lzReadyRegions = lzFitBuffer
            .filter(e => e.overall === 'READY')
            .map(e => `${providerDisplayName(e.provider)}/${e.region}`);
          if (lzReadyRegions.length > 0) {
            const altSuffix = ` In this assessment, ${lzReadyRegions.join(' and ')} satisfies all sovereignty requirements and is available as a sovereign-compliant alternative.`;
            for (const exec of lzFitBuffer) {
              if (exec.overall === 'SOVEREIGNTY_BLOCKED') {
                const items = (exec.lzReport['items'] ?? []) as Array<Record<string, unknown>>;
                for (const item of items) {
                  if (item['verdict'] === 'SOVEREIGNTY_GAP' && typeof item['remediation'] === 'string') {
                    item['remediation'] += altSuffix;
                  }
                }
              }
            }
          }

          // Phase 3: validate and write all pass files + build lzTargetResults.
          for (const exec of lzFitBuffer) {
            const { provider: lzP, region: lzR, lzIdx, wsp, lzReport, overall, passName, fileName, catFitFileName, fitMs } = exec;
            // Wrap the fit WSP as one pass-shaped artefact for PassFileSchema
            // validation + write (orchestrateLandingZone returns a WspResult, not
            // PassResult[], so we do not reuse the audit per-pass loop verbatim).
            const lzPassFile = {
              pass: { id: lzIdx, name: passName, signal_prefix: 'LZ', status: 'complete' as const, iter: lzIter, assessed_at: lzAssessedAt },
              signals: wsp.signals,
              assessment: lzReport,
            };
            const lzValidation = PassFileSchema.safeParse(lzPassFile);
            if (!lzValidation.success) {
              console.error(`[error] LZ fit (${lzP}/${lzR}) output failed schema validation:\n`, JSON.stringify(lzValidation.error.issues, null, 2));
              lzLifecycle.fail({ status: 'failed', reason: 'LZ fit output failed schema validation', exitCode: 1, target: { provider: lzP, region: lzR } });
              process.exit(1);
            }
            writeFileSync(join(lzPassesDir, fileName), dump(lzPassFile), 'utf-8');
            // Mirror the fit report to the run-dir root so `swao publish --block-profile lz-catalog`
            // can find it via the same path the extractor expects (lz-catalogue-fit[-<p>-<r>].yaml).
            // The extractor was designed for the inline-LZ path (lz-catalogue-fit.yaml at root);
            // standalone --type landing-zone-catalog must also write it there (#1345).
            writeFileSync(join(lzRunDir, catFitFileName), dump(lzReport as object, { lineWidth: 120 }), 'utf-8');
            lzTotalSignals += wsp.signals.length;
            lzTargetResults.push({ provider: lzP, region: lzR, overall, signals: wsp.signals.length, passName, fileName, fitMs });
            console.log(
              `[ok]  Landing-zone fit complete  ${providerDisplayName(lzP)}/${lzR}  verdict: ${overall}  ` +
              `${wsp.signals.length} gap(s)  ->  wsp/runs/${lzRunTs}/passes/${fileName}`,
            );
          }

          // Narrative WSP file: lz-narratives.json (#1358).
          // Template-based plain-language summaries -- no LLM call required.
          const lzNarratives: LzVerdictNarrative[] = lzFitBuffer.map((exec) =>
            generateLzNarrative({
              lz_id: `${exec.provider}/${exec.region}`,
              region_id: exec.region,
              display: `${providerDisplayName(exec.provider)} / ${exec.region}`,
              fit: exec.lzReport as unknown as LzFitReport,
              evidence_files: [exec.fileName],
            }),
          );
          writeFileSync(join(lzRunDir, 'lz-narratives.json'), JSON.stringify(lzNarratives, null, 2), 'utf-8');

          // Collect per-provider catalogue provenance for the run manifest (#1437).
          // One entry per unique provider; sha256 lets the audit trail detect
          // edits to workspace-local catalogues between runs.
          const lzCatalogueMap: Record<string, { origin: 'workspace' | 'installed' | 'bundled'; sha256: string; last_updated?: string }> = {};
          for (const p of [...new Set(lzRawTargets.map(t => t.provider))]) {
            try {
              const { catalogue, provenance, filePath } = resolveProviderCatalogue(p, workspaceRoot, lzCataloguesDir);
              const sha256 = createHash('sha256').update(readFileSync(filePath)).digest('hex');
              lzCatalogueMap[p] = { origin: provenance, sha256, last_updated: catalogue.meta.last_updated };
            } catch { /* best-effort: skip if resolution fails */ }
          }

          const lzFinished = new Date();
          const lzManifest: RunManifest = {
            schema_version: '1.4',
            run_id: lzStart.toISOString(),
            app: opts.app,
            iter: lzIter,
            assessed_at: lzAssessedAt,
            started_at: lzStart.toISOString(),
            finished_at: lzFinished.toISOString(),
            duration_ms: lzFinished.getTime() - lzStart.getTime(),
            passes_executed: lzTargetResults.map(r => r.passName),
            total_signals_emitted: lzTotalSignals,
            pass_stats: lzTargetResults.map((r, i) => ({
              pass: r.passName, num: String(i).padStart(2, '0'), wall_clock_ms: r.fitMs, signals_emitted: r.signals,
            })),
            provenance: {
              temperature: 0,
              cassette_hits: [],
              placeholder_inputs: [],
              false_positive_flags: 0,
              lzr_input_type: 'catalogue',
              crawl_type: 'none',
              swao_version: SWAO_VERSION,
            },
            lz_catalogues: Object.keys(lzCatalogueMap).length > 0 ? lzCatalogueMap : undefined,
          };
          RunManifestSchema.parse(lzManifest);
          writeFileSync(join(lzRunDir, 'run-manifest.json'), JSON.stringify(lzManifest, null, 2), 'utf-8');
          writeFileSync(join(lzWspDir, 'latest-landing-zone-catalog.txt'), `runs/${lzRunTs}`, 'utf-8');
          const lzRunCtx = RunContextSchema.parse({ assessment_type: 'landing-zone-catalog', run_timestamp: lzStart.toISOString(), swao_version: SWAO_VERSION });
          writeFileSync(join(lzRunDir, 'run-context.yaml'), dump(lzRunCtx), 'utf-8');
          // #2503: write findings.yaml placeholder so WSP monitor and tooling can detect a
          // completed LZ catalog run (mirrors the app assessment findings.yaml pattern).
          try { writeFileSync(join(lzRunDir, 'findings.yaml'), dump({ findings: [] }), 'utf-8'); } catch { /* best-effort */ }

          // #1505/#1510: Write primary LZ selection to a workspace-level pointer file.
          // Never mutate a previous run's wsp.yaml -- each run's output files are immutable
          // once written (#1510). The extractor reads latest-lz-primary.yaml as a fallback
          // when spine.landing_zone.primary is null.
          const firstBestTarget = lzTargetResults.find(
            r => r.overall === 'READY' || r.overall === 'NEEDS_VERIFICATION',
          );
          if (firstBestTarget) {
            const lzPrimaryRecord = {
              landing_zone: {
                primary: `${firstBestTarget.provider}/${firstBestTarget.region}`,
                verdict: firstBestTarget.overall,
              },
              generated_by: `runs/${lzRunTs}`,
              generated_at: lzAssessedAt,
            };
            try {
              writeFileSync(join(lzWspDir, 'latest-lz-primary.yaml'), dump(lzPrimaryRecord), 'utf-8');
            } catch (err) {
              console.warn(`[warn] LZ: could not write latest-lz-primary.yaml: ${err instanceof Error ? err.message : String(err)}`);
            }
          }

          try { LicenseGuard.load().incrementAssessmentCount(); } catch { /* best-effort */ }

          // Multi-target console summary table.
          const lzVerdictRank: Record<string, number> = { READY: 0, ADVISORY: 1, NEEDS_VERIFICATION: 1, BLOCKED: 2, SOVEREIGNTY_BLOCKED: 3 };
          const lzOverallVerdict = lzTargetResults.reduce((worst, r) => {
            return (lzVerdictRank[r.overall] ?? -1) > (lzVerdictRank[worst] ?? -1) ? r.overall : worst;
          }, lzTargetResults[0]?.overall ?? 'READY');
          if (lzRawTargets.length > 1) {
            console.log('\n[ok]  Landing-zone multi-target summary:');
            console.log('  Target                           Verdict    Gaps');
            console.log('  ' + '-'.repeat(46));
            for (const r of lzTargetResults) {
              console.log(`  ${`${r.provider}/${r.region}`.padEnd(32)} ${r.overall.padEnd(10)} ${r.signals}`);
            }
            console.log(`\n  Overall: ${lzOverallVerdict}  (${lzTargetResults.length} CSP/region target(s) assessed)`);
          }
          // #3223: partial run -- name the skipped targets once more after the summary.
          const lzPartial = lzFailedTargets.length > 0;
          const lzRunStatus = lzPartial ? 'partial' : 'complete';
          const lzCloseLevel = lzPartial ? 'warn' : 'info';
          const lzCloseSuffix = lzPartial ? ` (partial: ${lzFailedTargets.length} of ${lzRawTargets.length} target(s) failed)` : '';
          const lzPartialCtx = lzPartial ? { failed_targets: lzFailedTargets } : {};
          if (lzPartial) {
            console.warn(
              `[warning] Landing-zone assessment is partial: ${lzFailedTargets.length} of ${lzRawTargets.length} target(s) failed and were skipped: ` +
              lzFailedTargets.map(f => `${f.provider}:${f.region}`).join(', '),
            );
          }

          // #3309: the combined portfolio summary reads apps/<id>/wsp/latest-lz-primary.yaml
          // for application apps (APP-MIG-02, Design 103 §22.2), so an LZ catalogue run on an
          // application app rebuilds it; LZ catalogue apps are not portfolio apps. Best effort.
          // Before the close events so assess.post_run.* precedes swao.run.complete (#3224); the
          // summary reads latest-lz-primary.yaml only, not this run's marker.
          try {
            if (discoverApplicationApps(workspaceRoot).some((a) => a.appId === opts.app)) {
              const lzPostRun = createPostRunTimer({ app: opts.app!, runId: lzStart.toISOString(), assessmentType: 'landing-zone-catalog' });
              if (rebuildPortfolioSummaryStep(lzPostRun, lzRunStatus, () => buildPortfolioSummary(workspaceRoot))) {
                console.log('[ok]  SWAO_APM: landing zone fit updated  ->  wsp/portfolio-summary.json');
              }
            }
          } catch (e) {
            console.warn(`[warn] Portfolio summary not updated: ${(e as Error).message}`);
          }

          // #1704: lz.assessment.complete -- emitted here only; TUI-side duplicate removed by #1782.
          // #2288: renamed from lz.assess.complete to lz.assessment.complete for consistency.
          // Includes overall_verdict + per-target breakdown (per #1693 acceptance criteria).
          try {
            logApp(opts.app, lzCloseLevel, 'lz.assessment.complete', `Landing Zone Catalog Assessment complete${lzCloseSuffix}`, {
              context: {
                app_id: opts.app,
                lz_targets: lzTargetsStr,
                status: lzRunStatus,
                ...lzPartialCtx,
                exit_code: 0,
                overall_verdict: lzOverallVerdict,
                targets: lzTargetResults.map(r => ({
                  target: `${r.provider}:${r.region}`,
                  verdict: r.overall,
                  gaps: r.signals,
                })),
              },
            });
          } catch { /* logging is best-effort */ }
          // #1794: portfolio-level complete event.
          try {
            const lzElapsedMs = Date.now() - lzStart.getTime();
            logPortfolio(lzCloseLevel, 'lz.assessment.complete', `LZ Catalog Assessment complete${lzCloseSuffix}`, {
              context: {
                app: opts.app,
                status: lzRunStatus,
                ...lzPartialCtx,
                exit_code: 0,
                providers_run: lzRawTargets.length,
                providers_failed: lzFailedTargets.length,
                ready: lzTargetResults.filter(r => r.overall === 'READY').length,
                blocked: lzTargetResults.filter(r => r.overall !== 'READY').length,
                duration_ms: lzElapsedMs,
                elapsed_ms: lzElapsedMs,
              },
            });
          } catch { /* best-effort */ }
          // #2397: close the swao.run.* envelope so portfolio monitors see lz-catalog
          // runs in the same taxonomy as app-assessment runs.
          try {
            const lzElapsedMs = Date.now() - lzStart.getTime();
            logPortfolio(lzCloseLevel, 'swao.run.complete', `LZ Catalog Assessment complete${lzCloseSuffix}`, {
              context: { type: 'lz-catalog', app: opts.app, status: lzRunStatus, ...lzPartialCtx, exit_code: 0, overall_verdict: lzOverallVerdict, duration_ms: lzElapsedMs, elapsed_ms: lzElapsedMs },
            });
          } catch { /* best-effort */ }

          lzLifecycle.complete(lzFailedTargets);
          process.exit(0);
          } catch (lzErr) {
            // #3223: any throw after the run dir exists (scan JSON parse, schema parse,
            // file writes) closes the event sequence and writes run-status.json.
            const lzErrMsg = lzErr instanceof Error ? lzErr.message : String(lzErr);
            lzLifecycle.fail({ status: 'failed', reason: lzErrMsg, exitCode: 1 });
            console.error(`[error] Landing Zone Catalog Assessment failed: ${lzErrMsg}`);
            process.exit(1);
          }
        }
        // ADR-0064: service runs the application pipeline with the service pass profile.
        const isService = routeDecision.type === 'service';
        if (routeDecision.type !== 'application' && !isService) {
          // Another registered non-application type with no inline CLI driver yet.
          console.error(
            `[error] Assessment type "${routeDecision.type}" is registered but its CLI dispatch is not wired yet.`,
          );
          process.exit(1);
        }

        // Auto-clone from vcs.url when source/ is absent and no CLI override
        if (!opts.sourcePath && !isService) {
          await cloneIfNeeded(workspaceAppDir, swaoYml, opts.app);
        }

        let sourcePath: string;
        try {
          // Service apps have no source tree; the service plan sets sourcePath below.
          sourcePath = isService ? join(workspaceAppDir, 'wsp', 'service-no-source') : resolveSourcePath(workspaceAppDir, swaoYml, opts.sourcePath);
        } catch (e) {
          console.error(`[error] ${(e as Error).message}`);
          process.exit(1);
        }

        // #0516: abort before any pass when source is empty or README-only.
        if (!isService && !checkSourceNonEmpty(sourcePath)) {
          console.error(
            `[error] Source directory is empty or contains only README files.\n` +
            `[error]   Path: ${sourcePath}\n` +
            `[error] Configure source.vcs.url in .swao.yml with a git repository URL,\n` +
            `[error] or set source.path to the local folder containing your application code.`,
          );
          process.exit(1);
        }

        const iter = parseInt(opts.iter, 10) || 1;
        const startedAt = new Date();
        const assessedAt = startedAt.toISOString().slice(0, 10);
        const runId = startedAt.toISOString();
        const runTs = startedAt.toISOString().slice(0, 19).replace(/[:.]/g, '-');

        // #3158: resolve aliases (mal, dyn) and drop lzr, which the TUI may write
        // from a lens; Pass 23 is driven by --lzr <landingZoneId>.
        const normalisedRequest = normaliseRequestedPasses(opts.passes.split(','));
        const allRequestedKeys = normalisedRequest.passes;
        if (normalisedRequest.lzrRequested && !opts.lzr) {
          console.log('[info] Pass selection names LZR: Pass 23 runs only with --lzr <landingZoneId>; skipped.');
        }
        // #0844/#0927: skip Pass 10 (dynamic_analysis) upfront when playwright is not
        // available. Uses isPlaywrightPackageInstalled() (#0927 canonical check) +
        // findInstalledChromium() -- both must be present for the binary to crawl.
        // isHostPlaywrightAvailable (old module-level check) was inconsistent with the
        // SetupWizard and is replaced here.
        const inBinary = Object.prototype.hasOwnProperty.call(process, 'pkg');
        const includeDynamic = allRequestedKeys.includes('dynamic');
        // #1955/#1960: track Playwright availability separately from includeDynamic.
        // When Playwright is absent, do NOT skip the entire dynamic block -- parity-baseline
        // vision can still run without a live crawl (pre-captured screenshots).
        // playwrightReadyForCrawl=false gates the live-crawl branch below while leaving
        // the parity-baseline fallback intact.
        let playwrightReadyForCrawl = true;
        if (includeDynamic && inBinary) {
          const chromiumPath = findInstalledChromium();
          const pkgInstalled  = isPlaywrightPackageInstalled();
          if (!chromiumPath || !pkgInstalled) {
            const missing = !chromiumPath ? 'Chromium browser' : 'playwright-core npm package';
            console.warn(`[warn] Pass 10 live crawl unavailable -- ${missing} not found. Parity-baseline vision active if screenshots exist. Run: swao install-playwright to enable live crawl.`);
            logApp(opts.app, 'warn', 'dynamic.playwright-absent', `Pass 10 playwright absent: ${missing}; parity-baseline active`, { context: { chromium_found: chromiumPath !== null, pkg_installed: pkgInstalled } });
            playwrightReadyForCrawl = false;
          } else {
            console.log(`[info] Pass 10 (dynamic_analysis): Chromium at ${chromiumPath}, playwright-core installed.`);
            logApp(opts.app, 'info', 'dynamic.start', 'Pass 10 dynamic_analysis starting', { context: { chromium_path: chromiumPath } });
          }
        }
        // #1054: dedup after lowercasing -- TUI may write both 'data' and 'DATA' when a
        // lens (uppercase passes) is merged with a manual selection (lowercase passes).
        // Canonical execution order -- passes have defined signal-read dependencies
        // (CANONICAL_PASS_ORDER in @swao/module-app-assessment documents them, #3152).
        // The user-supplied --passes order and pass_profile order are treated as a
        // SET, not a sequence (#1282 root B, #1350).
        let requestedPasses = sortPassesCanonical(allRequestedKeys) as PassKey[];

        // Apply pass_profile / lenses filter if configured in .swao.yml (#0878).
        // assessment.lenses is the canonical field (ADR-0051); pass_profile is the
        // deprecated alias. Either resolves to a list of lens IDs such as
        // 'security-focus' or 'cloud-migration'.  Each lens expands to a set of
        // pass prefix codes (uppercase: 'SBOM', 'CRYPTO', ...); passes whose
        // lowercased prefix is not in the union of enabled codes are dropped.
        // No profile configured -> no filtering (acceptance criterion: JP-04).
        // #3158: lens pass codes go through the same alias map as individual
        // entries (MAL -> malware; LZR -> Pass 23, driven by --lzr).
        const activeProfile = (assessmentCfg?.['lenses'] ?? assessmentCfg?.['pass_profile']) as string[] | undefined;
        if (activeProfile && activeProfile.length > 0) {
          const allLenses = listLenses();
          const expansion = expandPassProfile(activeProfile, allLenses);
          for (const entry of expansion.duplicateEntries) {
            console.warn(`[warn] Duplicate pass_profile entry removed: "${entry}" (case-insensitive duplicate)`);
          }
          if (expansion.unknownEntries.length > 0) {
            const validLensIds = allLenses.map(l => l.id).join(', ');
            const validPassIds = [...INDIVIDUAL_PASS_KEYS].sort().join(', ');
            console.warn(
              `[warn] Unrecognised pass_profile entries ignored: ${expansion.unknownEntries.map(e => `"${e}"`).join(', ')}.\n` +
              `  Valid lens IDs: ${validLensIds}\n` +
              `  Valid pass IDs: ${validPassIds}`
            );
          }
          if (expansion.lzrRequested && !opts.lzr) {
            console.log('[info] Lens / pass_profile names LZR: Pass 23 runs only with --lzr <landingZoneId>; skipped.');
          }
          requestedPasses = filterByPassProfile(requestedPasses, expansion, passesExplicit) as PassKey[];
        }

        // ADR-0064 / Design 103 §5: drop source-only passes, gate conditional ones on their inputs.
        let servicePlan: ServicePassPlan | undefined;
        const servicePassStatuses: Record<string, string> = {};
        if (isService) {
          // Pass 25 BINARY first: CRYPTO reads its certificate data (Design 103 §6.3).
          try {
            const bin = runBinaryAnalysis(workspaceRoot, opts.app);
            console.log(bin.analysis.skipped_reason
              ? '[info] Pass 25 -- binary: no binary inputs (ingestion/binary/)'
              : `[ok]  Pass 25 -- binary  ${bin.analysis.files.length} file(s), ${bin.signals.length} BINARY signal(s)  ->  wsp/inputs/binary/binary-analysis.json`);
          } catch (e) {
            console.warn(`[warn] Pass 25 -- binary analysis failed: ${(e as Error).message}`);
          }
          servicePlan = planServicePasses(workspaceAppDir, requestedPasses, swaoYml as Record<string, unknown>);
          requestedPasses = servicePlan.run as PassKey[];
          sourcePath = servicePlan.baseSourcePath;
          console.log(`[info] ${formatSkippedSummary(servicePlan)}`);
        }

        // #3152: Pass 23 (LZR) is scheduled inside the pass loop at its canonical
        // position (after the static passes, before COMP and SYNTH) so SYNTH reads
        // the verdict of THIS run. It used to run after the loop, so SYNTH read the
        // previous run's 23-lzr.yaml. Its inputs are checked after Pass 00 INGEST
        // (which routes .tfstate files) but before any pass runs.
        if (opts.lzr) {
          requestedPasses = sortPassesCanonical([...requestedPasses, 'lzr']) as PassKey[];
        }

        const wspDir = join(workspaceAppDir, 'wsp');
        const runDir = join(wspDir, 'runs', runTs);
        const passesDir = join(runDir, 'passes');
        mkdirSync(passesDir, { recursive: true });
        // latest.txt is written AFTER run-manifest.json at completion to avoid
        // pointing at an incomplete run if the process aborts (#1023).

        // Emit license tier + machine fingerprint at run start so the exported
        // NDJSON log carries everything support needs to triage filed issues.
        try {
          const startGuard = LicenseGuard.load();
          logApp(opts.app!, 'info', 'swao.run.start', `SWAO ${SWAO_VERSION} (${startGuard.state.tier ?? 'community'})`, {
            context: {
              swao_version: SWAO_VERSION,
              license_tier: startGuard.state.tier ?? 'community',
              machine_fingerprint: (startGuard.state.fingerprint ?? '').substring(0, 8),
            },
            run_id: runId,
          });
        } catch { /* diagnostics log is best-effort; never block an assessment run */ }

        // #3283: run-status.json for application and service runs (shared lifecycle,
        // generalised from the LZ one). Marker `started` now; closed on every exit
        // path: complete / partial below, failed on a gate exit, an uncaught error or
        // any process exit before completion, aborted on SIGINT / SIGTERM. Each failing
        // close emits swao.run.aborted (#2391, kept for log consumers) and
        // swao.run.complete with status + exit_code.
        const runLifecycle = createRunLifecycle({
          assessmentType: isService ? 'service' : 'application',
          app: opts.app!,
          runDir,
          startedAt,
          runId,
          swaoVersion: SWAO_VERSION,
          onFail: (failure, { elapsedMs }) => {
            clearInterval(_heartbeatTimer);
            // swao.run.aborted keeps its #2391 meaning: SIGINT, SIGTERM or an uncaught
            // exception only. Gate exits and other failures are carried by
            // swao.run.complete (status + exit_code) below.
            if (failure.status === 'aborted' || failure.reason.startsWith('uncaught:')) {
              try {
                logApp(opts.app!, 'warn', 'swao.run.aborted', `Assessment aborted: ${failure.reason}`, {
                  context: { run_id: runId, reason: failure.reason },
                  run_id: runId,
                });
              } catch { /* best-effort */ }
            }
            try {
              logApp(opts.app!, failure.status === 'aborted' ? 'warn' : 'error', 'swao.run.complete', `Assessment ${failure.status}`, {
                context: {
                  run_id: runId,
                  status: failure.status,
                  exit_code: failure.exitCode,
                  reason: failure.reason,
                  duration_ms: elapsedMs,
                  assessment_type: isService ? 'service' : 'application',
                },
              });
            } catch { /* best-effort */ }
          },
        });
        runLifecycle.markStarted();
        runLifecycle.installProcessGuards();

        // #2248: whole-run heartbeat so the log monitor never sees >2 min silence
        // during long passes (dynamic analysis / Playwright crawl, context ingestion).
        // Fires every 90 s; cleared at normal completion and on abort.
        const _heartbeatTimer = setInterval(() => {
          try {
            logApp(opts.app!, 'info', 'assessment.heartbeat', 'Assessment in progress', {
              context: { run_id: runId, elapsed_ms: Date.now() - startedAt.getTime() },
            });
          } catch { /* best-effort; never block the assessment */ }
        }, 90_000);

        // PII pre-flight (#0354, design 032). Reset the redaction sink for
        // this run, load the optional workspace allowlist, honour the
        // person_name opt-in. The sink is process-wide module state so a
        // clean reset is essential when assess is invoked repeatedly
        // (TUI, tests, MCP).
        beginRedactionRun();
        const allowlistPath = join(workspaceRoot, '.swao-pii-allowlist.txt');
        if (existsSync(allowlistPath)) {
          const entries = readFileSync(allowlistPath, 'utf-8')
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l.length > 0 && !l.startsWith('#'));
          setAllowlist(entries);
        } else {
          setAllowlist([]);
        }
        setScrubPersonName(process.env['SWAO_SCRUB_PERSON_NAME'] === '1');

        // Bootstrap credentials from store when env vars are absent (covers MCP-spawned invocations)
        {
          const store = new CredentialStore();
          const stored = store.loadSync();
          if (!process.env['SWAO_LLM_PROVIDER']) {
            const anthropicKey = stored['anthropic-api-key'];
            const openaiKey    = stored['openai-api-key'];
            if (anthropicKey && !process.env['SWAO_ANTHROPIC_API_KEY'] && !process.env['ANTHROPIC_API_KEY']) {
              process.env['SWAO_ANTHROPIC_API_KEY'] = anthropicKey;
              process.env['SWAO_LLM_PROVIDER']      = 'anthropic';
            } else if (openaiKey && !process.env['SWAO_OPENAI_API_KEY'] && !process.env['OPENAI_API_KEY']) {
              process.env['SWAO_OPENAI_API_KEY'] = openaiKey;
              process.env['SWAO_LLM_PROVIDER']   = 'openai';
            }
          }
          const ollamaEndpoint = stored['ollama-endpoint'];
          const ollamaModel    = stored['ollama-model'];
          if (ollamaEndpoint && !process.env['SWAO_OLLAMA_URL'])   process.env['SWAO_OLLAMA_URL']   = ollamaEndpoint;
          if (ollamaModel    && !process.env['SWAO_OLLAMA_MODEL']) process.env['SWAO_OLLAMA_MODEL'] = ollamaModel;
        }

        const passStats: PassStat[] = [];
        let totalSignals = 0;
        // #1421: leg-mode call recorder (null unless the LLM Assessment
        // orchestrator spawned this run with the SWAO_LLM_ASSESSMENT_* env).
        const legRecorder = createLegRecorderFromEnv();
        // #1709: LLM Assessment leg traces dir -- derived from the sink NDJSON path
        // set by the orchestrator. Null in standalone App Assessment runs.
        const legSink = process.env['SWAO_LLM_ASSESSMENT_RECORD'];
        const legTracesDir = legSink ? legSink.replace(/\.ndjson$/, '') : null;
        // #0188: per-run LLM usage accumulator. Each LLM-backed pass
        // wraps its provider in UsageTrackingLlmProvider so we record
        // tokens + cost without changing the pass-engine code.
        let totalLlmUsage: AccumulatedUsage = { input_tokens: 0, output_tokens: 0, cost_usd: 0, call_count: 0 };
        // Track the provider name + model actually used (the first LLM pass
        // sets this; subsequent passes carry the same provider). Reported to
        // run-manifest.llm.{provider,model} as the source-of-truth for the
        // assessment, replacing the env-var-based detection (#0217).
        let llmProviderUsed: { name: string; model: string } | undefined;

        // Read provider type + model from .swao.yml's providers.llm.primary
        // block once -- the same config applies to every LLM-backed pass.
        // Reading .swao.yml lets the factory honour the configured model
        // rather than defaulting to haiku-4-5 (#0217).
        // #1409: the app-level .swao.yml wins when it has a providers.llm
        // block; otherwise fall back to the WORKSPACE .swao.yml -- the Setup
        // Wizard writes the LLM (and gateway connector) config there, and
        // without this fallback the engine silently rerouted gateway
        // workspaces to the legacy key-based provider detection.
        let llmProviderConfig = readLlmPrimaryConfig(swaoYml);
        if (!llmProviderConfig && workspaceRoot) {
          const wsYmlPath = join(workspaceRoot, '.swao.yml');
          if (wsYmlPath !== swaoYmlPath && existsSync(wsYmlPath)) {
            try {
              const wsRaw = (load(readFileSync(wsYmlPath, 'utf-8')) ?? {}) as Record<string, unknown>;
              llmProviderConfig = readLlmPrimaryConfig(wsRaw);
            } catch { /* unreadable workspace yml -- fall through to env detection */ }
          }
        }
        // #3284: an app-level providers.llm.max_concurrency wins even when the app
        // .swao.yml has no primary block (the primary config came from the
        // workspace file above); the factory falls back to the workspace value,
        // then the connector, then 4.
        {
          const appMaxConcurrency = readLlmMaxConcurrency(swaoYml);
          if (llmProviderConfig && appMaxConcurrency !== undefined) {
            llmProviderConfig = { ...llmProviderConfig, max_concurrency: appMaxConcurrency };
          }
        }
        // #1703: read secondary LLM provider for connectivity-failure failover.
        const llmSecondaryConfig = readLlmSecondaryConfig(swaoYml)
          ?? (() => {
            if (!workspaceRoot) return undefined;
            const wsYmlPath = join(workspaceRoot, '.swao.yml');
            if (wsYmlPath === swaoYmlPath || !existsSync(wsYmlPath)) return undefined;
            try {
              const wsRaw = (load(readFileSync(wsYmlPath, 'utf-8')) ?? {}) as Record<string, unknown>;
              return readLlmSecondaryConfig(wsRaw);
            } catch { return undefined; }
          })();
        if (!llmProviderConfig && opts.llm) llmProviderConfig = {};

        // #1401: gateway workspace discovery -- workspace connectors under
        // wsp/inputs/llm-gateway/ are resolvable without further config.
        if (llmProviderConfig) llmProviderConfig.workspaceRoot = workspaceRoot;

        // #1401: --llm <connector[:model]> overrides the .swao.yml connector.
        if (opts.llm) {
          const [connectorId, ...modelParts] = String(opts.llm).split(':');
          llmProviderConfig!.connector = connectorId;
          const modelOverride = modelParts.join(':');
          if (modelOverride) llmProviderConfig!.model = modelOverride;
        }

        // #1150: --model flag overrides providers.llm.primary.model in .swao.yml.
        // Priority: CLI flag > YAML > env var (env handled inside createLlmProvider).
        if (opts.model) {
          if (llmProviderConfig) {
            llmProviderConfig.model = opts.model;
          } else {
            console.warn('[warn] --model flag ignored: no LLM provider configured. Set providers.llm.primary.type in .swao.yml first.');
          }
        }

        // LLM-optional alignment (#0550). createLlmProvider throws when no
        // provider is configured; detect that condition here so LLM-dependent
        // passes receive ctx.llm = undefined and degrade gracefully (emit a
        // skip signal) instead of aborting the whole assessment. An explicitly
        // configured-but-invalid provider still throws inside the factory.
        // Multi-env configs have environments but no top-level type; treat as configured.
        // #2201: use let so the gateway-preflight catch can flip it to false, letting
        // LLM-dependent passes degrade gracefully instead of aborting the whole assessment.
        let llmConfigured = Boolean(
          llmProviderConfig?.connector ||
          process.env['SWAO_LLM_CONNECTOR'] ||
          (llmProviderConfig?.type ?? process.env['SWAO_LLM_PROVIDER']) ||
          llmProviderConfig?.environments,
        );
        // #3158: --skip-llm guarantees no LLM call. The provider is withheld from
        // every pass (DATA and SYNTH record their skip marker, Pass 10 vision is
        // off) and the gateway preflight below is skipped.
        if (opts.skipLlm) {
          llmConfigured = false;
          console.log('[info] --skip-llm: no LLM calls in this run. CTX, COMP and BLOCKS are removed; DATA and SYNTH record a skip marker.');
        } else if (!llmConfigured) {
          console.warn(
            '[warn] No LLM provider configured. DATA, CTX, SYNTH, COMP and BLOCKS will be skipped ' +
            '(emit no_llm_provider signals). Set providers.llm.primary in .swao.yml or ' +
            'export SWAO_LLM_PROVIDER to enable them.',
          );
        }

        // #1401 polish: gateway connector preflight. Constructing the provider
        // once up-front surfaces unknown-connector / unknown-environment /
        // missing-credential failures early with a clean message.
        // #2201: changed from hard-exit to soft-warn: when the gateway is
        // unreachable (e.g. no API key), set llmConfigured=false so every
        // LLM-dependent pass receives ctx.llm=undefined and degrades gracefully
        // (emits no_llm_provider skip signals) rather than aborting the run.
        // Static passes (inv, state, sbom, tf, egr, crypto, scope) are unaffected.
        // #3340: the preflight now covers every configured provider, not only
        // connectors: a `type: anthropic` config without an API key threw per
        // pass and left the Enterprise binary hanging (unhandled rejection).
        if (llmConfigured) {
          const preflight = preflightLlmProvider(createLlmProvider, opts.app, llmProviderConfig);
          if (!preflight.available) {
            console.warn(llmUnavailableWarning(preflight.reason));
            llmConfigured = false;
          }
        }

        // #0474 (C-16/C-17): provenance accumulators -- aggregated across all LLM passes.
        // #0479/#0480: lzrInputType tracks the actual input path used; updated when LZR pass runs.
        // #0910: 'catalogue' added to the union -- set by the inline LZ cat fit section.
        let lzrInputType: 'snapshot' | 'terraform' | 'live_api' | 'catalogue' | 'none' = 'none';
        const allPlaceholderInputs: string[] = [];
        const cassetteHits: string[] = [];
        let totalFpFlags = 0;
        // #0550: LLM-dependent passes that degraded to no_llm_provider skip
        // signals. Surfaced in run-manifest.provenance.llm_skipped_passes and
        // the HTML report health section.
        const llmSkippedPasses: string[] = [];
        // #0716: passes that degraded due to connectivity failure (retries exhausted).
        // #1702: now typed so each entry carries the failure reason for run-manifest.passes_failed.
        const llmConnectivityFailedPasses: Array<{ pass: string; reason: 'connectivity_failure' | 'provider_error' }> = [];
        // Captured for --malware-fail-on-detection gate; null when malware pass was not requested.
        let malwarePassResult: PassResult | null = null;
        // Accumulated for --fail-on gate; only populated when the flag is set.
        const failOnSignals: Array<{ id: string; severity: string; pass: string }> = [];

        // Pass 00 (INGEST) pre-pass (#0551 / #0962 / #0963). Normalises any
        // files dropped in <app>/ingestion/ into the structured wsp/inputs/
        // tree that Pass 04 (CTX) reads. Uses content-based routing and
        // SHA-256 delta detection. Manifest written to ingestion/ingestion-manifest.json.
        // No-op when ingestion/ is absent or empty.
        // #1322: if iac.pulumi.stacks is configured in .swao.yml, pre-fetch stack exports
        // from Pulumi Cloud API into wsp/inputs/pulumi/ before file-based normalisation.
        const rawPulumiStacks = (swaoYml['iac'] as { pulumi?: { stacks?: Array<{ org: string; project: string; stack: string }> } } | undefined)?.pulumi?.stacks;
        let pulumiIngest: { stacks: Array<{ org: string; project: string; stack: string }>; vaultReader: (key: string) => string | undefined } | undefined;
        if (Array.isArray(rawPulumiStacks) && rawPulumiStacks.length > 0) {
          const token = await credentialStore.get('pulumi-api-token');
          const resolvedToken = typeof token === 'string' ? token : undefined;
          pulumiIngest = { stacks: rawPulumiStacks, vaultReader: (key: string) => key === 'pulumi-api-token' ? resolvedToken : undefined };
        }
        // #3212: service apps have no ingestion/binary/ hint folder; installers anywhere are referenced for Pass 25
        const ingestManifest = await runIngestPrePass({ workspacePath: workspaceAppDir, assessedAt, pulumi: pulumiIngest, referenceInstallersAnywhere: isService });
        if (ingestManifest) {
          const c = ingestManifest.counts;
          const countStr = Object.entries(c).map(([k, v]) => `${k}: ${v}`).join(', ');
          console.log(
            `[ok]  Ingestion normalised  ${ingestManifest.files.length} file(s)  ` +
            `(${countStr})  ->  wsp/inputs/ + ingestion-manifest.json`,
          );
        }

        // #2959: pre-compute CTX prompt budget from active connector's context window.
        const connectorForBudget = llmProviderConfig?.connector
          ? getConnector(llmProviderConfig.connector, { workspaceRoot })
          : undefined;
        const ctxPromptBudget = computeContextBudget({
          context_window_k: connectorForBudget?.file.connector.context_window_k,
          model: connectorForBudget?.file.connector.models.default,
        });

        // Pass 23 -- LZR (Landing Zone Readiness, Terraform/local).
        // #3152: dispatched from the pass loop at the 'lzr' slot of the canonical
        // order (before COMP and SYNTH). The --lzr-fail-on-blocked exit stays after
        // the loop so the remaining passes still run.
        // #3153: the provider is derived from the selected landing zone (ID, then
        // assessment.landing_zone.provider, then the Terraform resource prefixes)
        // instead of the fixed 'stackit_de_sovereign'.
        let lzrBlockedBlockers: number | null = null;
        if (opts.lzr && findLzrInputFiles(workspaceAppDir).length === 0) {
          console.error('[error] --lzr requires at least one .tfstate file or JSON plan (.tfplan, from `terraform show -json`) in wsp/inputs/terraform/. Landing-zone snapshots (lz-*-snapshot.json) are read by --portfolio --lzr only.');
          process.exit(1);
        }
        const runLzrStep = async (landingZoneId: string): Promise<void> => {
          console.log(`[info] Running Pass 23 -- lzr (landing_zone_readiness) for "${landingZoneId}"...`);
          const lzrStart = Date.now();
          const lzrCtx: PassContext = {
            appId: opts.app!,
            sourcePath,
            workspacePath: workspaceAppDir,
            iter,
            assessedAt,
            passesDir,
          };
          const configuredLzProvider = (assessmentCfg?.['landing_zone'] as Record<string, unknown> | undefined)?.['provider'];
          const lzrResultRaw = await runLzrPass(lzrCtx, {
            landingZoneId,
            configuredProvider: opts.lzCatProvider ?? (typeof configuredLzProvider === 'string' ? configuredLzProvider : undefined),
          });
          if (lzrResultRaw.assessment['provider_id_source'] === 'default') {
            console.warn(`[warn] Pass 23 -- could not derive the provider for landing zone "${landingZoneId}"; using ${lzrResultRaw.lzrResult.provider_id}. Name the provider in the landing-zone ID or set assessment.landing_zone.provider.`);
          }
          // v0.10 auditor enrichment for the LZR pass.
          const lzrResult = {
            ...lzrResultRaw,
            signals: enrichSignals(lzrResultRaw.signals, {
              assessor: 'rule_engine' as const,
              assessedAt,
            }),
          };
          const lzrMs = Date.now() - lzrStart;
          const lzrOutFile = join(passesDir, '23-lzr.yaml');
          writeFileSync(lzrOutFile, dump(lzrResult, { lineWidth: 120 }), 'utf-8');
          passStats.push({
            pass: 'lzr',
            num: '23',
            wall_clock_ms: lzrMs,
            signals_emitted: lzrResult.signals.length,
            items_emitted: lzrResult.signals.length,
          });
          totalSignals += lzrResult.signals.length;
          const verdict = lzrResult.lzrResult.overall_verdict;
          // #0479/#0480: read input_type from adapter result (set by aws/meshstack adapters).
          // Pass-23 (Terraform) doesn't set it; fall back to 'terraform'.
          lzrInputType = ((lzrResult.lzrResult as unknown as Record<string, unknown>)['input_type'] as typeof lzrInputType) ?? 'terraform';
          console.log(
            `[ok]  Pass 23 -- lzr  ${lzrResult.signals.length} signals  verdict: ${verdict.toUpperCase()}  provider: ${lzrResult.lzrResult.provider_id}  ->  wsp/runs/${runTs}/passes/23-lzr.yaml  [${lzrMs}ms]`,
          );
          if (verdict === 'blocked') lzrBlockedBlockers = lzrResult.lzrResult.blockers.length;
        };

        for (const passKey of requestedPasses) {
          if (passKey === 'lzr') {
            if (opts.lzr) await runLzrStep(opts.lzr);
            continue;
          }
          // #1282: DYN (Pass 10) is dispatched inline at its natural position in the
          // pass list (canonical order: ...dynamic,scope,malware,lzr,comp,synth,blocks) so that DYN
          // signals are written to passesDir before comp, blocks, and synth run.
          if (passKey === 'dynamic') {
            if (!includeDynamic) continue; // pass 10 not in requested passes
            // #2018: emit the same pass.start events as the standard loop so log
            // streams and portfolio-events are not silent during the dynamic phase.
            // #2286: renamed to assessment.pass.start for consistency with portfolio-events.
            // #2231: pass_id added for cross-log correlation.
            logApp(opts.app!, 'info', 'assessment.pass.start', 'Pass 10 dynamic_analysis starting', {
              context: { pass: 'dynamic', num: '10', name: 'dynamic_analysis', pass_id: `${runTs}-p10-dynamic` },
            });
            logPortfolio('info', 'assessment.pass.start', 'Pass 10 dynamic_analysis starting', {
              context: { pass: 'dynamic', num: '10', name: 'dynamic_analysis', app: opts.app, pass_id: `${runTs}-p10-dynamic` },
            });
            const dynamicPassStart = Date.now();
            // #1952/#1955/#1960: Skip live crawl when --no-crawl OR Playwright absent.
            // parity-baseline vision still runs (else branch below) in both cases.
            const canLiveCrawl = opts.crawl && playwrightReadyForCrawl;
            let crawlConfig = canLiveCrawl ? buildCrawlConfig(swaoYml) : undefined;
            const vaultUrl  = canLiveCrawl ? await credentialStore.get(`playwright-url-${opts.app}`) : undefined;
            const vaultPw   = canLiveCrawl ? await credentialStore.get(`playwright-pass-${opts.app}`) : undefined;
            const vaultUser = canLiveCrawl ? await credentialStore.get(`playwright-user-${opts.app}`) : undefined;
            // #2322: MFA seed for TOTP -- stored in vault, never in .swao.yml
            const vaultMfa  = canLiveCrawl ? await credentialStore.get(`playwright-mfa-${opts.app}`) : undefined;
            if (!crawlConfig && typeof vaultUrl === 'string' && vaultUrl.length > 0) {
              const crawlBlock = swaoYml.crawl as Record<string, unknown> | undefined;
              crawlConfig = {
                targetUrl: /^https?:\/\//i.test(vaultUrl) ? vaultUrl : `https://${vaultUrl}`,
                ...(typeof crawlBlock?.max_turns === 'number'          ? { maxTurns: crawlBlock.max_turns as number }                    : {}),
                ...(typeof crawlBlock?.screenshot_quality === 'number' ? { screenshotQuality: crawlBlock.screenshot_quality as number } : {}),
                ...(typeof crawlBlock?.viewport_width === 'number'     ? { viewportWidth: crawlBlock.viewport_width as number }         : {}),
                ...(Array.isArray(crawlBlock?.exclude_patterns)        ? { excludePatterns: crawlBlock.exclude_patterns as string[] }   : {}),
              };
            }
            if (crawlConfig) {
              if (typeof vaultUrl === 'string' && vaultUrl.length > 0) {
                crawlConfig.targetUrl = /^https?:\/\//i.test(vaultUrl) ? vaultUrl : `https://${vaultUrl}`;
              }
              if (!crawlConfig.password && vaultPw) crawlConfig.password = vaultPw;
              if (!crawlConfig.username && vaultUser) crawlConfig.username = vaultUser;
              if (!crawlConfig.mfaSeed && vaultMfa) crawlConfig.mfaSeed = vaultMfa;
              if ((!crawlConfig.authType || crawlConfig.authType === 'none') && crawlConfig.username && crawlConfig.password) {
                crawlConfig.authType = 'form';
              }
            }
            // #2823/#2824: read opt-in flag from .swao.yml assessment block.
            // Cloud vision (any provider except ollama) is blocked unless allow_cloud_vision: true.
            const allowCloudVision = (swaoYml.assessment as Record<string, unknown> | undefined)?.['allow_cloud_vision'] === true;
            if (crawlConfig) {
              console.log('[info] Running Pass 10 -- dynamic_analysis (Playwright crawl)...');
              const crawlStart = Date.now();
              try {
                const { PlaywrightCrawlProvider } = await import('../crawl/playwright-driver.js');
                const provider = new PlaywrightCrawlProvider();
                const crawlResult = await provider.crawl(crawlConfig, workspaceAppDir);
                const crawlMs = Date.now() - crawlStart;
                writeParityBaseline(workspaceAppDir, crawlResult);
                // #1812: vision analysis auto-enabled when dynamic pass is active and LLM is configured.
                // The previous assessment.vision_analysis: true gate is removed -- dynamic pass + LLM
                // available is sufficient. Sovereignty warning still fires for cloud connectors.
                const assessmentBlock = swaoYml.assessment as Record<string, unknown> | undefined;
                const visionMaxScreens = typeof assessmentBlock?.['vision_max_screens'] === 'number'
                  ? assessmentBlock['vision_max_screens'] as number
                  : 5;
                let visionLlm: ReturnType<typeof createLlmProvider> | undefined;
                let effectiveVisionLlm: import('@swao/module-llm-providers').LlmProvider | undefined;
                if (llmConfigured) {
                  try {
                    visionLlm = createLlmProvider(opts.app, 'dynamic-vision', llmProviderConfig);
                    // #2824: treat any provider that is not explicitly local (ollama) as off-box cloud.
                    const isCloud = visionLlm.name !== 'ollama';
                    if (isCloud && !allowCloudVision) {
                      // Fail closed: skip vision, do not send screenshots to cloud.
                      console.warn(
                        `[info] Pass 10 vision analysis skipped: cloud connector "${visionLlm.name}" detected but ` +
                        'allow_cloud_vision is not set in .swao.yml. Add "allow_cloud_vision: true" under the ' +
                        'assessment block to enable screenshot upload to cloud LLMs.',
                      );
                      logApp(opts.app, 'warn', 'dynamic.vision.skipped', 'Pass 10 vision analysis skipped: cloud connector without allow_cloud_vision opt-in', {
                        context: { provider: visionLlm.name, reason: 'allow_cloud_vision_not_set' },
                      });
                      visionLlm = undefined;
                      effectiveVisionLlm = undefined;
                    } else {
                      if (isCloud) {
                        console.warn(
                          '[SOVEREIGNTY WARNING] Pass 10 dynamic_analysis -- Playwright screenshots will be sent to ' +
                          `the configured ${visionLlm.name} cloud connector for vision analysis. Screenshots may contain ` +
                          'PII from authenticated app screens. allow_cloud_vision is set -- proceeding.',
                        );
                        logApp(opts.app, 'warn', 'dynamic.vision.cloud', 'Pass 10 cloud vision enabled via allow_cloud_vision', {
                          context: { provider: visionLlm.name },
                        });
                      }
                      logApp(opts.app, 'info', 'dynamic.vision.start', 'Pass 10 vision analysis starting', {
                        context: { max_screens: visionMaxScreens, provider: visionLlm.name, model: visionLlm.model },
                      });
                    // #1997 Gap 1: route live Playwright vision calls through the leg
                    // recorder so they appear in per-leg NDJSON with call_type:'vision'.
                    const visionTracking = new UsageTrackingLlmProvider(visionLlm);
                    effectiveVisionLlm = visionTracking;
                    if (legRecorder) {
                      legRecorder.setPass('10-dynamic', 'dynamic-vision');
                      effectiveVisionLlm = legRecorder.wrap(visionTracking, () => visionTracking.snapshot());
                    }
                    }
                  } catch {
                    visionLlm = undefined;
                    effectiveVisionLlm = undefined;
                  }
                } else {
                  console.warn('[warn] Pass 10 dynamic_analysis: no LLM provider configured -- vision analysis skipped.');
                  logApp(opts.app, 'warn', 'dynamic.vision.skipped', 'Pass 10 vision analysis skipped: no LLM configured', {});
                }
                const dynamicCtx: PassContext = {
                  appId: opts.app,
                  sourcePath,
                  workspacePath: workspaceAppDir,
                  iter,
                  assessedAt,
                  passesDir,
                  llm: effectiveVisionLlm,
                };
                const visionOpts = visionLlm ? { maxScreens: visionMaxScreens } : undefined;
                let dynamicResult = await runDynamicPass(dynamicCtx, crawlResult, visionOpts);
                dynamicResult = { ...dynamicResult, signals: enrichSignals(dynamicResult.signals, { assessor: 'rule_engine', assessedAt }) };
                const dynamicOutFile = join(passesDir, '10-dynamic.yaml');
                writeFileSync(dynamicOutFile, dump(dynamicResult, { lineWidth: 120 }), 'utf-8');
                passStats.push({ pass: 'dynamic_analysis', num: '10', wall_clock_ms: crawlMs, signals_emitted: dynamicResult.signals.length, items_emitted: crawlResult.screenCount, iter });
                totalSignals += dynamicResult.signals.length;
                // #2572: vision_screens_analysed is returned under 'assessment', not 'diagnostics'.
                const visionScreens = ((dynamicResult as unknown as Record<string, unknown>)['assessment'] as Record<string, unknown> | undefined)?.['vision_screens_analysed'] as number | undefined ?? 0;
                if (visionLlm) {
                  // #2285: add wall_clock_ms (full dynamic pass time) and provider to vision.complete.
                  logApp(opts.app, 'info', 'dynamic.vision.complete', 'Pass 10 vision analysis complete', {
                    context: { screens_analysed: visionScreens, max_screens: visionMaxScreens, provider: visionLlm.name, wall_clock_ms: crawlMs },
                  });
                }
                console.log(`[ok]  Pass 10 -- dynamic_analysis  ${dynamicResult.signals.length} signals  ${crawlResult.screenCount} screens  ->  wsp/runs/${runTs}/passes/10-dynamic.yaml  [${msToHuman(crawlMs)}]`);
                logApp(opts.app, 'info', 'dynamic.complete', 'Pass 10 dynamic_analysis complete', { context: { signals: dynamicResult.signals.length, screens: crawlResult.screenCount, vision_screens_analysed: visionScreens, wall_clock_ms: crawlMs } });
              } catch (e) {
                const err = e as Error;
                console.warn(`[warn] Dynamic analysis failed: ${err.message} -- continuing without crawl`);
                logApp(opts.app, 'warn', 'dynamic.error', `Pass 10 dynamic_analysis failed: ${err.message}`, { context: { error: err.message } });
                if (process.env['SWAO_DEBUG']) console.warn(err.stack ?? '(no stack)');
              }
            } else {
              if (!opts.crawl) {
                console.log('[info] --no-crawl -- skipping live crawl; parity-baseline vision will run if available');
                logApp(opts.app, 'info', 'dynamic.skip', 'Pass 10 live crawl skipped (--no-crawl); parity-baseline vision fallback active', {});
              } else {
                console.log('[info] crawl.target_url not set in .swao.yml -- skipping live crawl; parity-baseline vision will run if available');
                logApp(opts.app, 'info', 'dynamic.skip', 'Pass 10 skipped -- crawl.target_url not configured', {});
              }
              // #1952: Fall back to parity-baseline screenshots for vision analysis
              // when no live crawl ran. Runs vision pass only (no DOM/a11y signals).
              const baselineDir = join(workspaceAppDir, 'parity-baseline');
              if (llmConfigured && existsSync(baselineDir)) {
                const assessmentBlock = swaoYml.assessment as Record<string, unknown> | undefined;
                const visionMaxScreens = typeof assessmentBlock?.['vision_max_screens'] === 'number'
                  ? assessmentBlock['vision_max_screens'] as number : 5;
                try {
                  const slugDirs = readdirSync(baselineDir, { withFileTypes: true })
                    .filter(d => d.isDirectory())
                    .sort((a, b) => a.name.localeCompare(b.name));
                  const syntheticScreens = slugDirs
                    .map((d, idx): import('@swao/core').ScreenArtefact | null => {
                      const jpegPath = join(baselineDir, d.name, 'screenshot.jpg');
                      if (!existsSync(jpegPath)) return null;
                      return {
                        index: idx, url: d.name, title: d.name, timestamp: assessedAt,
                        slug: d.name, screenshotJpeg: readFileSync(jpegPath),
                        domSnapshot: '', a11yJson: null, networkEntries: [], consoleEntries: [],
                        a11yViolations: 0,
                      };
                    })
                    .filter((s): s is import('@swao/core').ScreenArtefact => s !== null)
                    .slice(0, visionMaxScreens);
                  if (syntheticScreens.length > 0) {
                    let visionLlm: ReturnType<typeof createLlmProvider> | undefined;
                    try { visionLlm = createLlmProvider(opts.app, 'dynamic-vision', llmProviderConfig); } catch { /* skip */ }
                    // #2823/#2824: gate cloud vision behind allow_cloud_vision opt-in (same as live-crawl path).
                    if (visionLlm && visionLlm.name !== 'ollama' && !allowCloudVision) {
                      console.warn(
                        `[info] Pass 10 parity-baseline vision skipped: cloud connector "${visionLlm.name}" detected but ` +
                        'allow_cloud_vision is not set in .swao.yml. Add "allow_cloud_vision: true" under the ' +
                        'assessment block to enable screenshot upload to cloud LLMs.',
                      );
                      logApp(opts.app, 'warn', 'dynamic.vision.skipped', 'Pass 10 parity-baseline vision skipped: cloud connector without allow_cloud_vision opt-in', {
                        context: { provider: visionLlm.name, reason: 'allow_cloud_vision_not_set', source: 'parity-baseline' },
                      });
                      visionLlm = undefined;
                    }
                    if (visionLlm) {
                      // Route vision calls through the leg recorder so they appear in
                      // per-leg NDJSON with call_type:'vision' (#1997 Gap 1).
                      const visionTracking = new UsageTrackingLlmProvider(visionLlm);
                      let effectiveVisionLlm: import('@swao/module-llm-providers').LlmProvider = visionTracking;
                      if (legRecorder) {
                        legRecorder.setPass('10-dynamic', 'dynamic-vision');
                        effectiveVisionLlm = legRecorder.wrap(visionTracking, () => visionTracking.snapshot());
                      }
                      const visionCtx: PassContext = {
                        appId: opts.app, sourcePath, workspacePath: workspaceAppDir,
                        iter, assessedAt, passesDir, llm: effectiveVisionLlm,
                      };
                      const syntheticCrawl: import('@swao/core').CrawlResult = {
                        targetUrl: 'parity-baseline', screenCount: syntheticScreens.length,
                        screens: syntheticScreens, durationMs: 0, engineVersion: 'parity-baseline',
                      };
                      const visionStart = Date.now();
                      let dynamicResult = await runDynamicPass(visionCtx, syntheticCrawl, { maxScreens: visionMaxScreens });
                      dynamicResult = { ...dynamicResult, signals: enrichSignals(dynamicResult.signals, { assessor: 'rule_engine', assessedAt }) };
                      writeFileSync(join(passesDir, '10-dynamic.yaml'), dump(dynamicResult, { lineWidth: 120 }), 'utf-8');
                      const visionMs = Date.now() - visionStart;
                      passStats.push({ pass: 'dynamic_analysis', num: '10', wall_clock_ms: visionMs, signals_emitted: dynamicResult.signals.length, items_emitted: syntheticScreens.length, iter });
                      totalSignals += dynamicResult.signals.length;
                      logApp(opts.app, 'info', 'dynamic.vision.baseline',
                        `Pass 10 vision analysis from parity-baseline: ${syntheticScreens.length} screens`, {
                          context: { screens: syntheticScreens.length, max_screens: visionMaxScreens, source: 'parity-baseline' },
                        });
                    }
                  }
                } catch (e) {
                  const msg = (e as Error).message;
                  logApp(opts.app, 'warn', 'dynamic.vision.baseline.error', `Pass 10 parity-baseline vision failed: ${msg}`, { context: { error: msg } });
                }
              }
            }
            // #2266: emit assessment.pass.complete for pass 10 so the TUI progress
            // display shows "starting" -> "complete (Xs)" consistently with all
            // other passes (the dynamic path previously only emitted dynamic.complete
            // which the TUI polling timer does not handle).
            // #2286: renamed to assessment.pass.complete for consistency with portfolio-events.
            // #2231: pass_id matches assessment.pass.start for cross-log correlation.
            logApp(opts.app!, 'info', 'assessment.pass.complete', 'Pass 10 dynamic_analysis complete', {
              context: { pass: 'dynamic', num: '10', name: 'dynamic_analysis', wall_clock_ms: Date.now() - dynamicPassStart, duration_ms: Date.now() - dynamicPassStart, pass_id: `${runTs}-p10-dynamic` },
            });
            // #2390: mirror pass.complete to the portfolio event log (same pattern as
            // logPortfolio at line ~2384 for the standard pass loop).
            logPortfolio('info', 'assessment.pass.complete', 'Pass 10 dynamic_analysis complete', {
              context: { pass: 'dynamic', num: '10', name: 'dynamic_analysis', status: 'ok', duration_ms: Date.now() - dynamicPassStart, elapsed_ms: Date.now() - dynamicPassStart, app: opts.app, pass_id: `${runTs}-p10-dynamic` },
            });
            continue;
          }

          // COMP (Pass 11) is dispatched from @swao/module-framework (#0570);
          // every other pass is owned by the app-assessment orchestrator.
          let passDef = assessOrchestrator.getPass(passKey);
          if (!passDef && passKey === 'comp') {
            passDef = { num: '11', name: 'compliance_evaluation', runner: runCompliancePass, llmPassName: 'comp' };
          }
          if (!passDef) {
            console.warn(`[warn] Unknown pass "${passKey}" -- skipping`);
            continue;
          }
          // ADR-0064: service-mode runner for passes whose application runner needs a source tree.
          const serviceRunner = servicePlan?.runners[passKey];
          // #3158: the service runners are deterministic, so no LLM provider is
          // created for them and their output is not labelled with an LLM model.
          if (serviceRunner) passDef = { ...passDef, runner: serviceRunner, llmPassName: null };

          const rawLlm =
            passDef.llmPassName !== null && llmConfigured
              ? createLlmProvider(opts.app, passDef.llmPassName, llmProviderConfig)
              : undefined;
          const cacheLayer =
            rawLlm && opts.cache
              ? new LlmCacheLayer(rawLlm, workspaceAppDir, 30, opts.cassette, FIXTURE_CASSETTES_DIR)
              : null;
          const baseLlm = cacheLayer ?? rawLlm;
          const trackingLlm = baseLlm ? new UsageTrackingLlmProvider(baseLlm) : undefined;
          // #1709: points to whichever tracking wrapper produced the final result.
          // Updated to secondaryTracking when the secondary failover path is taken.
          let resultTracking: UsageTrackingLlmProvider | undefined = trackingLlm;
          // #1421 (design 092 s3.1): in leg mode (child process spawned by the
          // LLM Assessment orchestrator) every call streams a CallRecord to
          // the sink named by SWAO_LLM_ASSESSMENT_RECORD. Null outside legs.
          if (legRecorder && trackingLlm) {
            legRecorder.setPass(`${passDef.num}-${passKey}`, passDef.llmPassName ?? 'pass-llm');
          }
          const recordedLlm = legRecorder && trackingLlm
            ? legRecorder.wrap(trackingLlm, () => trackingLlm.snapshot())
            : undefined;
          if (rawLlm && !llmProviderUsed) {
            llmProviderUsed = { name: rawLlm.name, model: rawLlm.model };
          }

          const ctx: PassContext = {
            appId: opts.app,
            sourcePath: servicePlan?.sourceOverrides[passKey] ?? sourcePath,
            workspacePath: workspaceAppDir,
            iter,
            assessedAt,
            llm: recordedLlm ?? trackingLlm ?? baseLlm,
            passesDir, // #1055: lets synthesis read prior passes during an active run
            ctxPromptBudget, // #2959: connector-aware budget
          };

          console.log(`[info] Running Pass ${passDef.num} -- ${passDef.name}...`);
          // #1687: app-events entry so the support bundle shows pass execution.
          // #2286: renamed to assessment.pass.start for consistency with portfolio-events.
          // #2231: pass_id added for cross-log correlation.
          const passId = `${runTs}-p${passDef.num}-${passKey}`;
          logApp(opts.app!, 'info', 'assessment.pass.start', `Pass ${passDef.num} ${passDef.name} starting`, {
            context: { pass: passKey, num: passDef.num, name: passDef.name, pass_id: passId },
          });
          // #1769: unconditional portfolio-events for monitoring / audit trail.
          logPortfolio('info', 'assessment.pass.start', `Pass ${passDef.num} ${passDef.name} starting`, {
            context: { pass: passKey, num: passDef.num, name: passDef.name, app: opts.app, pass_id: passId },
          });
          // #1695: per-pass portfolio-events so the LLM Assessment leg is not silent.
          if (process.env['SWAO_LLM_ASSESSMENT_LEG_ID']) {
            logPortfolio('info', 'llm-assessment.pass.start', `leg pass starting: ${passKey}`, {
              context: { leg_id: process.env['SWAO_LLM_ASSESSMENT_LEG_ID'], pass_id: `${passDef.num}-${passKey}`, model: llmProviderUsed?.model },
            });
          }

          const passStart = Date.now();
          let result: PassResult;
          try {
            result = await passDef.runner(ctx);
          } catch (e) {
            if (e instanceof LlmConnectivityError) {
              // #1703: attempt secondary LLM connector before degrading the pass.
              if (llmSecondaryConfig && passDef.llmPassName) {
                try {
                  const secondaryRaw = createLlmProvider(opts.app, passDef.llmPassName, {
                    ...llmSecondaryConfig,
                    workspaceRoot,
                  });
                  logPortfolio('warn', 'provider.llm.leg-failover', `Primary LLM failed (connectivity), attempting secondary connector`, {
                    context: {
                      pass: passKey,
                      reason: 'connectivity_failure',
                      primary_connector: llmProviderConfig?.connector ?? llmProviderConfig?.type ?? 'unknown',
                      secondary_connector: llmSecondaryConfig.connector ?? llmSecondaryConfig.type ?? 'unknown',
                    },
                  });
                  console.warn(`[warn] Primary LLM connectivity failure on pass ${passKey} -- trying secondary connector (${llmSecondaryConfig.connector ?? llmSecondaryConfig.type})`);
                  const secondaryTracking = new UsageTrackingLlmProvider(secondaryRaw);
                  const secondaryCtx: PassContext = { ...ctx, llm: secondaryTracking };
                  result = await passDef.runner(secondaryCtx);
                  const secUsage = secondaryTracking.snapshot();
                  if (secUsage) totalLlmUsage = mergeUsage(totalLlmUsage, secUsage);
                  resultTracking = secondaryTracking;
                  console.log(`[ok]  Pass ${passKey} recovered via secondary LLM connector`);
                } catch (_secondaryErr) {
                  // Secondary also failed -- degrade gracefully (original #0716 path).
                  const connMsg = `Pass ${passKey} degraded (connectivity failure): primary and secondary LLM connectors exhausted`;
                  console.error(`[warn] ${connMsg}`);
                  console.log(`[warn] connectivity-degraded pass=${passKey}`);
                  logApp(opts.app!, 'error', 'assessment.pass.connectivity-failure', connMsg, {
                    context: { pass: passKey, reason: 'connectivity_failure' },
                  });
                  // #1769: portfolio-level failure event.
                  logPortfolio('error', 'assessment.pass.complete', connMsg, {
                    context: { pass: passKey, num: passDef.num, name: passDef.name, status: 'failed', duration_ms: Date.now() - passStart, elapsed_ms: Date.now() - passStart, reason: 'llm-connectivity-failure', app: opts.app },
                  });
                  llmConnectivityFailedPasses.push({ pass: passDef.name, reason: 'connectivity_failure' });
                  result = {
                    pass: {
                      id: parseInt(passDef.num, 10),
                      name: passDef.name,
                      signal_prefix: passKey.toUpperCase().slice(0, 6),
                      status: 'not_applicable',
                      iter,
                      assessed_at: assessedAt,
                    },
                    signals: [],
                    assessment: { skipped: true, skipped_reason: 'connectivity_failure' },
                  };
                }
              } else {
              // #0716: LLM connectivity failure -- degrade gracefully instead of aborting.
              const connMsg = `Pass ${passKey} degraded (connectivity failure): all LLM retries exhausted`;
              console.error(`[warn] ${connMsg}`);
              // Structured line for TUI detection (#0716)
              console.log(`[warn] connectivity-degraded pass=${passKey}`);
              logApp(opts.app!, 'error', 'assessment.pass.connectivity-failure', connMsg, {
                context: { pass: passKey, reason: 'connectivity_failure' },
              });
              llmConnectivityFailedPasses.push({ pass: passDef.name, reason: 'connectivity_failure' });
              result = {
                pass: {
                  id: parseInt(passDef.num, 10),
                  name: passDef.name,
                  signal_prefix: passKey.toUpperCase().slice(0, 6),
                  status: 'not_applicable',
                  iter,
                  assessed_at: assessedAt,
                },
                signals: [],
                assessment: { skipped: true, skipped_reason: 'connectivity_failure' },
              };
              }
            } else if (process.env['SWAO_LLM_ASSESSMENT_LEG_ID']) {
              // #1608: in LLM Assessment leg mode degrade on any provider error so the
              // remaining passes still run (same pattern as LlmConnectivityError above).
              const errMsg = (e as Error).message ?? String(e);
              const degradedMsg = `Pass ${passKey} degraded (provider error): ${errMsg.slice(0, 200)}`;
              console.error(`[warn] ${degradedMsg}`);
              console.log(`[warn] connectivity-degraded pass=${passKey}`);
              logApp(opts.app!, 'error', 'assessment.pass.provider-error', degradedMsg, {
                context: { pass: passKey, reason: 'provider_error', error: errMsg.slice(0, 500) },
              });
              llmConnectivityFailedPasses.push({ pass: passDef.name, reason: 'provider_error' });
              result = {
                pass: {
                  id: parseInt(passDef.num, 10),
                  name: passDef.name,
                  signal_prefix: passKey.toUpperCase().slice(0, 6),
                  status: 'not_applicable',
                  iter,
                  assessed_at: assessedAt,
                },
                signals: [],
                assessment: { skipped: true, skipped_reason: 'provider_error' },
              };
            } else {
              const errMsg = (e as Error).message ?? String(e);
              console.error(`[error] Pass ${passKey} failed: ${errMsg}`);
              const diagPath = join(workspaceRoot, 'wsp', 'logs', `portfolio-events-${new Date().toISOString().slice(0, 7)}.ndjson`);
              console.error(`[error] Full diagnostics: ${diagPath}`);
              // #1677: log structured error to portfolio-events before exiting.
              try {
                logPortfolio('error', 'assessment.pass.fatal', `Pass ${passKey} failed: ${errMsg}`, {
                  context: { pass: passKey, app: opts.app, error: errMsg.slice(0, 500) },
                });
              } catch { /* best-effort */ }
              // #1677: write assess.log to the run directory for audit trail.
              try {
                const assessLogLines = [
                  `ts: ${new Date().toISOString()}`,
                  `pass: ${passKey}`,
                  `error: ${errMsg}`,
                  `diagnostics: ${diagPath}`,
                ];
                writeFileSync(join(runDir, 'assess.log'), assessLogLines.join('\n') + '\n', 'utf-8');
              } catch { /* best-effort */ }
              process.exit(1);
            }
          }
          const passMs = Date.now() - passStart;
          const passUsage = trackingLlm?.snapshot();
          if (passUsage) totalLlmUsage = mergeUsage(totalLlmUsage, passUsage);

          // #0550: record LLM-dependent passes that degraded for want of a
          // provider (DATA/CTX/SYNTH skip outright; COMP/BLOCKS mark their
          // assessment). The marker is the uniform no_llm_provider reason.
          if (result.assessment?.['skipped_reason'] === 'no_llm_provider') {
            llmSkippedPasses.push(passDef.name);
            // #3158: say "skipped by --skip-llm", not "no provider configured".
            if (opts.skipLlm) result = markSkippedByFlag(result);
          } else if (result.assessment?.['skipped_reason'] === INVALID_LLM_RESPONSE_REASON) {
            // #3158: DATA, CTX and SYNTH degrade on an unusable LLM answer instead of
            // aborting the run; keep the degradation visible in the manifest and log.
            llmSkippedPasses.push(passDef.name);
            logApp(opts.app!, 'warn', 'assessment.pass.invalid-llm-response', `Pass ${passDef.num} ${passDef.name} degraded: unusable LLM response`, {
              context: { pass: passKey, reason: INVALID_LLM_RESPONSE_REASON, detail: String(result.assessment['invalid_response_detail'] ?? '') },
            });
          }

          // v0.10 auditor enrichment (#0172). Default outcome / assessor /
          // assessed_at on every signal that did not set them. ADR-0025;
          // design 020. False-positive narrative is intentionally not
          // defaulted; the traceability probe warns when missing.
          result = {
            ...result,
            signals: enrichSignals(result.signals, {
              assessor: passDef.llmPassName ? 'llm' : 'rule_engine',
              assessedAt,
            }),
          };

          // #0474 (C-16) + #0472: inject data_source block for LLM-driven passes.
          if (passDef.llmPassName !== null && rawLlm) {
            const isCacheHit = cacheLayer?.wasCacheHit() ?? false;
            if (isCacheHit) cassetteHits.push(passDef.name);
            const dsPlaceholders = Array.isArray(result.assessment['placeholder_inputs'])
              ? (result.assessment['placeholder_inputs'] as string[])
              : [];
            const dsFpFlags = result.signals.filter((s) => s.false_positive_flag).length;
            allPlaceholderInputs.push(...dsPlaceholders);
            totalFpFlags += dsFpFlags;
            const dataSource: DataSource = {
              llm_provider: rawLlm.name,
              llm_model: rawLlm.model,
              llm_temperature: llmProviderConfig?.temperature ?? 0,
              llm_seed: llmProviderConfig?.seed ?? null,
              cassette_hit: isCacheHit,
              placeholder_inputs: dsPlaceholders,
              false_positive_flags: dsFpFlags,
              assessed_at: assessedAt,
            };
            result = { ...result, data_source: dataSource };
          }

          // #0478 (C-22): inject per-signal provenance block for all passes.
          // source = "<provider>/<model>" for LLM passes, "rule_engine" for static.
          {
            const isCacheHit = result.data_source?.cassette_hit ?? false;
            const provSource = (passDef.llmPassName !== null && rawLlm)
              ? `${rawLlm.name}/${rawLlm.model}`
              : 'rule_engine';
            result = {
              ...result,
              signals: result.signals.map((s) => ({
                ...s,
                provenance: { source: provSource, run_id: runId, cassette_hit: isCacheHit, assessed_at: assessedAt },
              })),
            };
          }

          const validation = PassFileSchema.safeParse(result);
          if (!validation.success) {
            console.error(
              `[error] Pass ${passKey} output failed schema validation:\n`,
              JSON.stringify(validation.error.issues, null, 2),
            );
            process.exit(1);
          }

          const outFile = join(passesDir, `${passDef.num}-${passKey === 'state' ? 'state' : passKey}.yaml`);
          writeFileSync(outFile, dump(result, { lineWidth: 120 }), 'utf-8');
          if (servicePlan) servicePassStatuses[passKey] = result.pass.status;

          // #1709: write LLM prompt trace (post-redaction prompt + response) for
          // each LLM-driven pass. First call wins for looping sites (pass 11, 12).
          if (passDef.llmPassName !== null && rawLlm) {
            const firstTrace = resultTracking?.getFirstTrace();
            if (firstTrace) {
              const traceOutDir = legTracesDir
                ? join(legTracesDir, 'traces')
                : join(runDir, 'llm-traces');
              mkdirSync(traceOutDir, { recursive: true });
              const traceObj = {
                pass: `${passDef.num}-${passKey}`,
                call_index: 1,
                leg: process.env['SWAO_LLM_ASSESSMENT_LEG_ID'] ?? undefined,
                model: rawLlm.model,
                connector: rawLlm.name,
                timestamp: new Date().toISOString(),
                prompt: {
                  chars: firstTrace.scrubbedPrompt.length,
                  tokens_est: Math.ceil(firstTrace.scrubbedPrompt.length / 4),
                  redacted_placeholders: (firstTrace.scrubbedPrompt.match(/\[REDACTED/g) ?? []).length,
                  note: 'post-redaction only -- [REDACTED...] markers in place',
                  content: firstTrace.scrubbedPrompt,
                },
                response: {
                  chars: firstTrace.response.length,
                  tokens: trackingLlm?.snapshot().output_tokens,
                  parse_valid: (() => { try { JSON.parse(firstTrace.response); return true; } catch { return false; } })(),
                  content: firstTrace.response,
                },
              };
              writeFileSync(
                join(traceOutDir, `${passDef.num}-${passKey}-call-1.json`),
                JSON.stringify(traceObj, null, 2),
                'utf-8',
              );
            }
          }

          if (passKey === 'malware') malwarePassResult = result;

          // #0389 (sprint-040): Pass 12 (blocks) emits its output under
          // `assessment.blocks` instead of `signals[]`, so a literal
          // "0 signals emitted" line + 0 in the manifest looked like a
          // bug. Surface the block count too so operators see real
          // progress + cost justification. The legacy signals_emitted
          // field stays for downstream-consumer compatibility; a new
          // items_emitted field carries the canonical "how much did
          // this pass produce" count (signals OR blocks evaluated).
          const blocksEvaluated = ((result as { assessment?: { blocks_evaluated?: number } }).assessment?.blocks_evaluated) ?? 0;
          const itemsEmitted = result.signals.length || blocksEvaluated;
          const itemSummary = result.signals.length > 0
            ? `${result.signals.length} signals emitted`
            : blocksEvaluated > 0
              ? `0 signals + ${blocksEvaluated} blocks evaluated`
              : '0 items emitted';

          const passLabel = result.pass.status === 'not_applicable' ? '[skip]' : '[ok]';
          console.log(
            `${passLabel}  Pass ${passDef.num} -- ${passDef.name}  ${itemSummary}  ->  wsp/runs/${runTs}/passes/${passDef.num}-${passKey === 'state' ? 'state' : passKey}.yaml  [${msToHuman(passMs)}]`,
          );
          // #1687: app-events pass completion entry.
          // #2286: renamed to assessment.pass.complete for consistency with portfolio-events.
          // #2231: pass_id matches assessment.pass.start for cross-log correlation.
          logApp(opts.app!, 'info', 'assessment.pass.complete', `Pass ${passDef.num} ${passDef.name} complete`, {
            context: { pass: passKey, num: passDef.num, name: passDef.name, signals: result.signals.length, items: itemsEmitted, wall_clock_ms: passMs, duration_ms: passMs, pass_id: passId, ...(passUsage?.call_count ? { llm_calls: passUsage.call_count } : {}) },
          });
          // #1769: unconditional portfolio-events for monitoring / audit trail.
          logPortfolio('info', 'assessment.pass.complete', `Pass ${passDef.num} ${passDef.name} complete`, {
            context: { pass: passKey, num: passDef.num, name: passDef.name, status: 'ok', signals_emitted: result.signals.length, duration_ms: passMs, elapsed_ms: passMs, app: opts.app, pass_id: passId, ...(passUsage?.call_count ? { llm_calls: passUsage.call_count } : {}) },
          });
          // #1695: per-pass portfolio-events for LLM Assessment legs.
          if (process.env['SWAO_LLM_ASSESSMENT_LEG_ID']) {
            logPortfolio('info', 'llm-assessment.pass.complete', `leg pass complete: ${passKey}`, {
              context: { leg_id: process.env['SWAO_LLM_ASSESSMENT_LEG_ID'], pass_id: `${passDef.num}-${passKey}`, duration_ms: passMs, elapsed_ms: passMs, signals: result.signals.length },
            });
          }

          passStats.push({
            pass: passDef.name,
            num: passDef.num,
            wall_clock_ms: passMs,
            signals_emitted: result.signals.length,
            items_emitted: itemsEmitted,
            tokens_in: passUsage?.input_tokens,
            tokens_out: passUsage?.output_tokens,
            cost_usd: passUsage?.cost_usd,
            llm_calls: passUsage?.call_count,
            iter,
          });
          totalSignals += result.signals.length;
          if (opts.failOn) {
            const eqIdx = opts.failOn.indexOf('=');
            const field = eqIdx >= 0 ? opts.failOn.slice(0, eqIdx) : opts.failOn;
            const val   = eqIdx >= 0 ? opts.failOn.slice(eqIdx + 1) : '';
            if (field === 'severity' && val) {
              for (const sig of result.signals) {
                if (sig.severity === val) failOnSignals.push({ id: sig.id, severity: sig.severity ?? '', pass: passKey });
              }
            }
          }
        }

        // #1282: DYN (Pass 10) is dispatched inline within the main pass loop
        // at its natural position (before comp/blocks/synth). The block that
        // was here was moved into the loop body above.

        // Pass 23 ran inside the loop (#3152); the fail gate is applied here so
        // every requested pass completes first.
        if (opts.lzr && opts.lzrFailOnBlocked && lzrBlockedBlockers !== null) {
          console.error(`[error] LZR verdict is BLOCKED for landing zone "${opts.lzr}". ${lzrBlockedBlockers} blocker(s) found.`);
          runLifecycle.fail({ status: 'failed', reason: `--lzr-fail-on-blocked: LZR verdict BLOCKED (${lzrBlockedBlockers} blocker(s))`, exitCode: 4 });
          process.exit(4);
        }

        if (opts.malwareFailOnDetection) {
          if (malwarePassResult === null) {
            console.warn('[warn] --malware-fail-on-detection is set but the malware pass was not requested');
          } else {
            // MAL-01 and MAL-03 are also emitted with severity 'positive' on clean scans;
            // only exit 5 when the signal represents an actual detection, not an all-clear.
            const detections = malwarePassResult.signals.filter(
              (s) => (s.id === 'MAL-01' || s.id === 'MAL-03') && s.severity !== 'positive',
            );
            if (detections.length > 0) {
              console.error(`[error] Malware detections found: ${detections.map((s) => s.id).join(', ')} (${detections.length} detection(s)).`);
              runLifecycle.fail({ status: 'failed', reason: `--malware-fail-on-detection: ${detections.length} detection(s)`, exitCode: 5 });
              process.exit(5);
            }
          }
        }
        if (opts.failOn && failOnSignals.length > 0) {
          console.error(`[error] --fail-on ${opts.failOn}: ${failOnSignals.length} signal(s) matched (${failOnSignals.map((s) => s.id).join(', ')}).`);
          runLifecycle.fail({ status: 'failed', reason: `--fail-on ${opts.failOn}: ${failOnSignals.length} signal(s) matched`, exitCode: 6 });
          process.exit(6);
        }

        let inlineLzTargets: Array<{ provider: string; region: string }> = [];
        // LZ Catalogue fit (all tiers, inline during App assessment).
        // Runs when targets are configured (#3281: --lz-cat-targets, --lz-cat-provider/
        // --lz-cat-region, or assessment.landing_zone.targets / provider + region in the
        // app, then the workspace .swao.yml).
        // Derives service requirements from this run's pass signals, evaluates them
        // against the LZ Catalogue, and writes lz-catalogue-fit.yaml to the run dir.
        // All tiers get the fit: community uses bundled catalogue;
        // consultant/enterprise also checks a workspace-level override folder.
        {
          // #1614-B: workspace LZ catalogues take precedence for all tiers (same as lzCataloguesDir above).
          const _lzCatCatalogueDirCandidate = join(workspaceRoot, 'wsp', 'inputs', 'catalogs', 'lz-catalogues');
          const lzCatCataloguesDir = existsSync(_lzCatCatalogueDirCandidate) ? _lzCatCatalogueDirCandidate : undefined;
          // #3281: one resolver for the standalone run, this inline fit and run-context.yaml.
          // --lz-cat-targets (multi) supersedes the --lz-cat-provider/--lz-cat-region pair;
          // geographies (azure:Europe) resolve to their documented default region.
          const lzCatTargetConfig = resolveRunLzTargets({
            app: opts.app!,
            workspaceRoot,
            cataloguesDir: lzCatCataloguesDir,
            cliTargets: opts.lzCatTargets,
            cliProvider: opts.lzCatProvider,
            cliRegion: opts.lzCatRegion,
            appAssessment: assessmentCfg,
            workspaceAssessment: readWorkspaceAssessment(workspaceRoot),
          });
          const lzCatTargets = lzCatTargetConfig.targets;
          inlineLzTargets = lzCatTargets;
          const lzCatSignals = lzCatTargets.length > 0 ? loadPriorSignals(workspaceAppDir) : null;
          const lzCatRequired = lzCatSignals
            ? deriveConstraints(lzCatSignals).requiredServices.map((s) => ({ code: s.name, signalId: s.signalId }))
            : [];
          // D-LZ-07: load sovereignty declarations from the app's selected frameworks.
          // Falls back to regimes_active (#0924 -- compliance pass uses that key).
          const lzCatFwIds = (assessmentCfg?.['frameworks'] as string[] | undefined)
            ?? (assessmentCfg?.['regimes_active'] as string[] | undefined)
            ?? [];
          const lzCatFrameworkDecls = readFrameworkSovereigntyDecls(lzCatFwIds, resolveCatalogsDir(workspaceAppDir), communityFrameworksDir);
          // #1009: track per-target verdicts for the aggregate summary after the loop.
          // Two-phase: compute all fits first, patch SOVEREIGNTY_GAP remediation when
          // READY alternatives exist in the same run (#1352), then write all files.
          const lzCatVerdicts: string[] = [];
          const lzCatFitBuffer: Array<{
            provider: string; region: string; lzReport: Record<string, unknown>; fitFileName: string; verdict: string; fitMs: number;
          }> = [];

          // #3306: the per-target loop is the one of the standalone run
          // (runLzProviderFits): a target that fails (unknown region, fit error,
          // no LZ report) emits lz.assessment.provider.error with the valid-region
          // hint and is skipped. Requested, resolved and skipped targets are
          // recorded in this application run's run-status.json; skipped targets
          // close the run `partial` (Design 051 addendum: the application result
          // stays usable, so the run never fails because of the inline fit).
          const lzCatLoop = runLzProviderFits({
            app: opts.app!,
            targets: lzCatTargets,
            fit: ({ provider: lzCatProvider, region: lzCatRegion }) => {
              console.log(`[info] LZ Catalogue fit -- ${providerDisplayName(lzCatProvider)}/${lzCatRegion}...`);
              const lzCatResult = assembleLzCatalogWsp({
                workspacePath: workspaceAppDir,
                provider: lzCatProvider,
                regionId: lzCatRegion,
                requiredServices: lzCatRequired,
                frameworkDecls: lzCatFrameworkDecls,
                cataloguesDir: lzCatCataloguesDir,
                assessedAt,
              });
              if (!lzCatResult.ok) {
                let validRegions: string[] | undefined;
                if (/^Region ".*" not found/.test(lzCatResult.error)) {
                  try {
                    validRegions = resolveProviderCatalogue(lzCatProvider, workspaceRoot, lzCatCataloguesDir).catalogue.regions.map((r) => r.id);
                  } catch { /* hint is best-effort */ }
                }
                return { ok: false, error: lzCatResult.error, validRegions };
              }
              if (!lzCatResult.wsp['lz']) return { ok: false, error: 'LZ catalogue fit produced no report' };
              const lzCatReport = lzCatResult.wsp['lz'] as Record<string, unknown>;
              return { ok: true, value: lzCatReport, overall: (lzCatReport['overall'] as string) ?? 'UNKNOWN' };
            },
          });
          for (const { target: { provider: lzCatProvider, region: lzCatRegion }, value: lzCatReport, overall, fitMs } of lzCatLoop.results) {
            const fitFileName = lzCatTargets.length === 1
              ? 'lz-catalogue-fit.yaml'
              : `lz-catalogue-fit-${lzCatProvider}-${lzCatRegion.replace(/[^a-zA-Z0-9-]/g, '-')}.yaml`;
            lzCatFitBuffer.push({ provider: lzCatProvider, region: lzCatRegion, lzReport: lzCatReport, fitFileName, verdict: overall, fitMs });
          }
          if (lzCatTargets.length > 0) {
            runLifecycle.recordTargets({
              targets: lzCatTargets.map(lzTargetLabel),
              resolvedTargets: lzCatTargetConfig.resolved,
              failedTargets: lzCatLoop.failures,
            });
          }

          // Patch SOVEREIGNTY_GAP remediation with passing alternatives (#1352).
          const lzCatReadyRegions = lzCatFitBuffer
            .filter(e => e.verdict === 'READY')
            .map(e => `${providerDisplayName(e.provider)}/${e.region}`);
          if (lzCatReadyRegions.length > 0) {
            const catAltSuffix = ` In this assessment, ${lzCatReadyRegions.join(' and ')} satisfies all sovereignty requirements and is available as a sovereign-compliant alternative.`;
            for (const exec of lzCatFitBuffer) {
              if (exec.verdict === 'SOVEREIGNTY_BLOCKED') {
                const items = (exec.lzReport['items'] ?? []) as Array<Record<string, unknown>>;
                for (const item of items) {
                  if (item['verdict'] === 'SOVEREIGNTY_GAP' && typeof item['remediation'] === 'string') {
                    item['remediation'] += catAltSuffix;
                  }
                }
              }
            }
          }

          for (const exec of lzCatFitBuffer) {
            writeFileSync(join(runDir, exec.fitFileName), dump(exec.lzReport as object, { lineWidth: 120 }), 'utf-8');
            lzCatVerdicts.push(exec.verdict);
            console.log(`[ok]  LZ Catalogue fit  ${providerDisplayName(exec.provider)}/${exec.region}  verdict: ${exec.verdict}  [${exec.fitMs}ms]`);
          }
          // Narrative WSP file: lz-narratives.json (#1358).
          // Template-based plain-language summaries for the standalone landing-zone-catalog type.
          if (lzCatFitBuffer.length > 0) {
            const lzCatNarratives: LzVerdictNarrative[] = lzCatFitBuffer.map((exec) =>
              generateLzNarrative({
                lz_id: `${exec.provider}/${exec.region}`,
                region_id: exec.region,
                display: `${providerDisplayName(exec.provider)} / ${exec.region}`,
                fit: exec.lzReport as unknown as LzFitReport,
                evidence_files: [exec.fitFileName],
              }),
            );
            writeFileSync(join(runDir, 'lz-narratives.json'), JSON.stringify(lzCatNarratives, null, 2), 'utf-8');
          }
          // #1009: aggregate summary when all selected targets are blocked.
          if (lzCatVerdicts.length > 0 && lzCatVerdicts.every(v => v === 'SOVEREIGNTY_BLOCKED')) {
            const fwsWithSovereignty = lzCatFrameworkDecls
              .filter(d => d.sovereignty_requirements && (
                (d.sovereignty_requirements.forbid_exposure?.length ?? 0) > 0 ||
                (d.sovereignty_requirements.require_operator_jurisdiction?.length ?? 0) > 0 ||
                (d.sovereignty_requirements.require_certifications?.length ?? 0) > 0 ||
                (d.sovereignty_requirements.require_residency_country?.length ?? 0) > 0
              ))
              .map(d => d.id);
            const fwStr = fwsWithSovereignty.length > 0
              ? fwsWithSovereignty.join(', ')
              : lzCatFwIds.join(', ') || '(no framework)';
            console.warn(
              `[warn] LZ Catalogue: all ${lzCatVerdicts.length} target(s) SOVEREIGNTY_BLOCKED -- ` +
              `no selected region satisfies sovereignty requirements for [${fwStr}]. ` +
              `Run \`swao lz catalogue list\` for alternatives.`
            );
          }
          // #0910: mark run-manifest provenance so publication and assessment-scope block
          // know LZ fit results are available even when run via full app assessment.
          if (lzCatTargets.length > 0) lzrInputType = 'catalogue';
        }

        const finishedAt = new Date();
        const durationMs = finishedAt.getTime() - startedAt.getTime();
        // #3224: every post-pass step logs start/complete with duration_ms, and
        // swao.run.complete reports total wall clock (run-manifest.json keeps
        // the pass-phase duration because it is written before these steps).
        const postRun = createPostRunTimer({ app: opts.app!, runId, assessmentType: isService ? 'service' : 'application' });

        // v1.3 stats: provider + model come from the actual LLM instance
        // used during the pass loop (#0217). Previously this read from env
        // vars only, which silently ignored .swao.yml's
        // `providers.llm.primary.model` setting and defaulted to haiku-4-5
        // when SWAO_ANTHROPIC_MODEL was unset.
        const provider = llmProviderUsed?.name;
        const model = llmProviderUsed?.model;
        const inventoryCount = passStats.find((s) => s.num === '01')?.signals_emitted;

        const manifest: RunManifest = {
          schema_version: '1.5',
          run_id: runId,
          app: opts.app,
          iter,
          assessed_at: assessedAt,
          started_at: startedAt.toISOString(),
          finished_at: finishedAt.toISOString(),
          duration_ms: durationMs,
          passes_executed: passStats.map((s) => s.pass),
          total_signals_emitted: totalSignals,
          pass_stats: passStats,
          llm: (provider || model || totalLlmUsage.call_count > 0)
            ? {
                provider,
                model,
                total_tokens_in: totalLlmUsage.input_tokens || undefined,
                total_tokens_out: totalLlmUsage.output_tokens || undefined,
                total_cost_usd: totalLlmUsage.cost_usd || undefined,
                call_count: totalLlmUsage.call_count || undefined,
                // #1401: gateway connector provenance (undefined on legacy path).
                gateway: (() => {
                  const p = getLastGatewayProvenance();
                  return p
                    ? {
                        connector_id: p.connector_id,
                        connector_sha256: p.connector_sha256 || undefined,
                        connector_origin: p.connector_origin,
                        protocol: p.protocol,
                        base_url: p.base_url,
                      }
                    : undefined;
                })(),
              }
            : undefined,
          files_assessed: {
            inventory_count: inventoryCount,
            // #0264: count source files under the resolved source path +
            // all imports files under wsp/inputs/. PowerBI "files scanned"
            // tiles need these to render non-empty.
            ...postRun.step('file_counts', () => ({
              source_files_total: countFilesRecursive(sourcePath),
              imports_files_total: countFilesRecursive(join(workspaceAppDir, 'wsp', 'inputs')),
            })),
          },
          landing_zone_weights: { ...DEFAULT_WEIGHTS },
          // #0474 (C-17): provenance block -- aggregated from per-pass data_source blocks.
          // lzr_input_type and crawl_type are coarse; #0479/#0480 (live adapters) will
          // refine lzr_input_type once the live/terraform paths are implemented.
          provenance: {
            temperature: llmProviderConfig?.temperature ?? 0,
            seed: llmProviderConfig?.seed,
            cassette_hits: [...cassetteHits],
            placeholder_inputs: [...new Set(allPlaceholderInputs)],
            false_positive_flags: totalFpFlags,
            lzr_input_type: lzrInputType,
            crawl_type: opts.crawl && (swaoYml as Record<string, unknown>)['crawl'] ? 'playwright' : 'none',
            swao_version: SWAO_VERSION,
            ...(llmSkippedPasses.length > 0 ? { llm_skipped_passes: [...llmSkippedPasses] } : {}),
            // #0989 Design 074 §3.3: record active lenses from workspace .swao.yml.
            ...((() => {
              const wsLenses = readWorkspaceLenses(join(workspaceRoot, '.swao.yml'));
              return wsLenses.length > 0 ? { lenses_used: wsLenses } : {};
            })()),
          },
          // #1702: record passes that degraded (connectivity / provider error).
          ...(llmConnectivityFailedPasses.length > 0 ? { passes_failed: [...llmConnectivityFailedPasses] } : {}),
        };

        postRun.step('run_manifest', () => {
          RunManifestSchema.parse(manifest);
          writeFileSync(join(runDir, 'run-manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
          // Update latest pointer so report and TUI can find this run
          writeFileSync(join(wspDir, 'latest.txt'), `runs/${runTs}`, 'utf-8');
          writeFileSync(join(wspDir, isService ? 'latest-service.txt' : 'latest-application.txt'), `runs/${runTs}`, 'utf-8');
        });
        // #0911: compute audit-trail fields for run-context.yaml.
        const _defaultPassKeys = [...DEFAULT_PASS_KEYS];
        const _excludedPasses = [...new Set([
          ..._defaultPassKeys.filter(p => !allRequestedKeys.includes(p)),
          ...(servicePlan?.skipped.map(s => s.key) ?? []),
        ])];
        // #3281: the targets the inline fit actually used (after geography resolution).
        const _lzTargets: string[] = inlineLzTargets.map(t => `${t.provider}/${t.region}`);
        const _activeFrameworks = (assessmentCfg?.['regimes_active'] as string[] | undefined)
          ?? (assessmentCfg?.['frameworks'] as string[] | undefined) ?? [];
        const appRunCtx = RunContextSchema.parse({
          assessment_type: isService ? 'service' : 'application',
          run_timestamp: startedAt.toISOString(),
          swao_version: SWAO_VERSION,
          ...(_excludedPasses.length > 0 ? { excluded_passes: _excludedPasses } : {}),
          ...(_lzTargets.length > 0 ? { lz_targets: _lzTargets } : {}),
          ...(_activeFrameworks.length > 0 ? { active_frameworks: _activeFrameworks } : {}),
        });
        postRun.step('run_context', () => writeFileSync(join(runDir, 'run-context.yaml'), dump(appRunCtx), 'utf-8'));
        if (servicePlan) {
          const plan = servicePlan;
          postRun.step('scope_coverage', () => writeFileSync(join(runDir, 'scope-coverage.json'), JSON.stringify(buildServiceScopeCoverage(plan, servicePassStatuses), null, 2), 'utf-8'));
          // The SWAO_APM summary is rebuilt after the run closes (#3309), see below.
        }

        // Derive wsp-plan.yaml + wsp.yaml + wsp-evidence.yaml (#0232).
        // The BI star export reads compliance.regimes[], security_findings[],
        // and risk_register[] from wsp-plan.yaml to populate
        // dim_control / fact_controls / fact_findings / fact_risks.
        try {
          const r = postRun.step('plan_derivation', () => derivePlanForRun(workspaceRoot, workspaceAppDir, runDir, opts.app!, runId, assessedAt));
          console.log(
            `[ok]  Plan derived  ->  wsp/runs/${runTs}/wsp-plan.yaml  ` +
              `(${r.regimesIncluded.join(',') || 'no regimes'}, ${r.controlsCount} controls, ${r.findingsCount} findings, ${r.risksCount} risks)`,
          );
          // #2674: populate findings.yaml from wsp-plan.yaml compliance controls.
          try {
            postRun.step('findings', () => {
              const planRaw = load(readFileSync(r.planPath, 'utf-8')) as {
                compliance?: { regimes?: Array<{ id?: string; controls?: Array<Record<string, unknown>> }> };
              } | null;
              const regimes = planRaw?.compliance?.regimes ?? [];
              const flatFindings = regimes.flatMap(regime =>
                (regime.controls ?? []).map(ctrl => ({
                  id: ctrl['id'],
                  title: ctrl['title'] ?? '',
                  severity: ctrl['severity'] ?? 'medium',
                  outcome: ctrl['outcome'] ?? 'UNKNOWN',
                  regime: regime.id ?? '',
                  assessed_at: String(ctrl['assessed_at'] ?? assessedAt),
                })),
              );
              writeFileSync(join(runDir, 'findings.yaml'), dump({ findings: flatFindings }), 'utf-8');
            });
          } catch (findingsErr) {
            console.warn(`[warn] findings.yaml write failed: ${(findingsErr as Error).message}`);
          }
        } catch (e) {
          console.warn(`[warn] Plan derivation failed: ${(e as Error).message}`);
        }

        // PII post-run scrub + report flush (#0354, design 032 §13). Runs
        // after every artefact is on disk (run-manifest, pass-emit YAMLs,
        // wsp-plan) so the sweep catches them all. The redaction-report
        // itself is written LAST so the sweep does not scrub its own
        // counts (the SKIP_BASENAMES list in report-scrub.ts also
        // protects it; this ordering is belt + braces).
        try {
          postRun.step('pii_scrub', () => {
            const scrubResult = scrubRunDirectory(runDir);
            if (scrubResult.files_scrubbed > 0) {
              console.log(
                `[ok]  PII scrub  ->  ${scrubResult.files_scrubbed}/${scrubResult.files_scanned} files, ` +
                  `${scrubResult.total_chars_removed} chars removed`,
              );
            }
            flushRedactionReport(join(runDir, 'redaction-report.json'));
          });
        } catch (e) {
          console.warn(`[warn] PII scrub / report flush failed: ${(e as Error).message}`);
        }

        // Lifetime assessment counter (M18 #0273). Increments after a
        // successful run regardless of tier; consumed by
        // `guardAssessmentBudget()` for licensed users with a positive
        // `assessment_limit` and shown as an informational counter for
        // Community users.
        try {
          postRun.step('assessment_counter', () => LicenseGuard.load().incrementAssessmentCount());
        } catch (e) {
          console.warn(`[warn] Could not update lifetime assessment counter: ${(e as Error).message}`);
        }

        // #1016: run retention cleanup -- remove oldest runs when keep_latest is set.
        try {
          postRun.step('run_retention', () => {
            const retentionCfg = (swaoYml?.['workspace'] as Record<string, unknown> | undefined)
              ?.['run_retention'] as Record<string, unknown> | undefined;
            const keepLatest = typeof retentionCfg?.['keep_latest'] === 'number'
              ? (retentionCfg['keep_latest'] as number)
              : undefined;
            if (keepLatest && keepLatest > 0) {
              // #3283: keep the N latest usable runs (run-status.json complete / partial,
              // or a manifest for older runs); failed or aborted runs do not count.
              const removed = applyRunRetention(wspDir, keepLatest, runTs);
              if (removed.length > 0) {
                console.log(`[ok]  Run retention: removed ${removed.length} run(s) (kept latest ${keepLatest} usable)`);
              }
            }
          });
        } catch (e) {
          console.warn(`[warn] Run retention cleanup failed: ${(e as Error).message}`);
        }

        // #2391: assessment completed normally -- stop the heartbeat; the lifecycle
        // close below (#3283) removes the abort / exit guards.
        clearInterval(_heartbeatTimer);

        // #0921: emit swao.run.complete so log consumers can calculate duration and confirm normal exit.
        // #1702: warn when mandatory passes were dropped due to LLM connectivity failure.
        // Mandatory = compliance (pass 11) and block_assessments (pass 12).
        const mandatoryPassNames = ['compliance', 'block_assessments'];
        const mandatoryFailed = llmConnectivityFailedPasses.filter(p =>
          mandatoryPassNames.includes(p.pass),
        );
        const failedCount = llmConnectivityFailedPasses.length;

        const runCompleteExitCode = mandatoryFailed.length > 0 ? 1 : 0;
        // #3283: close run-status.json: `partial` when passes failed (LLM connectivity),
        // otherwise `complete`; exit_code mirrors the process exit code below.
        runLifecycle.complete({ failedPasses: llmConnectivityFailedPasses.map(p => p.pass), exitCode: runCompleteExitCode });
        // Design 103 §7.2, §22.1 (#3101, #3309): rebuild the combined workspace SWAO_APM
        // summary after every application or service run that closed complete or partial.
        // After the close because the summary reads usable runs only (#3283); best effort,
        // the exit code is never changed.
        const portfolioSummary = rebuildPortfolioSummaryStep(postRun, runLifecycle.status, () => buildPortfolioSummary(workspaceRoot));
        if (portfolioSummary) {
          const me = portfolioSummary.apps.find((a) => a.id === opts.app);
          console.log(`[ok]  SWAO_APM: TIME ${me?.time_quadrant ?? 'n/a'} (${me?.time_reason ?? ''}), risk ${me?.risk_score ?? 'n/a'}  ->  wsp/portfolio-summary.json`);
        }
        // #3224: duration_ms is total wall clock (passes + post-pass steps).
        const totalDurationMs = Date.now() - startedAt.getTime();
        const postRunSummary = postRun.summary();
        try {
          logApp(opts.app!, 'info', 'swao.run.complete', `Assessment complete`, {
            context: {
              run_id: runId,
              duration_ms: totalDurationMs,
              passes_duration_ms: durationMs,
              post_pass_ms: postRunSummary.post_pass_ms,
              post_pass_steps: postRunSummary.post_pass_steps.map(s => ({ step: s.step, duration_ms: s.duration_ms, status: s.status })),
              signals_emitted: totalSignals,
              exit_code: runCompleteExitCode,
              status: runLifecycle.status,
              assessment_type: isService ? 'service' : 'application',
              ...(failedCount > 0 ? {
                failed_passes: failedCount,
                failed_pass_names: llmConnectivityFailedPasses.map(p => p.pass),
              } : {}),
            },
          });
        } catch { /* logging is best-effort */ }

        if (failedCount > 0) {
          const names = llmConnectivityFailedPasses.map(p => p.pass).join(', ');
          console.warn(`[warn] ${failedCount} pass(es) skipped due to LLM connectivity failure: ${names}`);
          console.warn(`[warn] Re-run with --passes ${llmConnectivityFailedPasses.map(p => p.pass.slice(0, 4)).join(',')} to retry only the missing passes.`);
        }

        console.log(
          `[ok]  Assessment complete  ${totalSignals} signals total  duration: ${msToHuman(totalDurationMs)}  ->  wsp/runs/${runTs}/run-manifest.json`,
        );

        if (opts.stats) {
          printStatsTable(passStats, durationMs, totalSignals);
        }

        // #1702: exit non-zero when mandatory passes (compliance, block_assessments) were dropped.
        if (mandatoryFailed.length > 0) {
          process.exit(1);
        }
      },
    );
}
