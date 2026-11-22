// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module -- Application screen
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #2370: extracted application assessment flow from AssessScreen.tsx (Design 098).
// Handles only the application assessment surface; LZ assessment lives in LzAssessmentScreen.tsx.

import { useState, useEffect, useMemo, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { spawn } from 'child_process';
import { appendFileSync, existsSync, readdirSync, writeFileSync, mkdirSync, readFileSync, renameSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { load as loadYaml } from 'js-yaml';
import { CredentialStore, LicenseGuard, writeCrawlSection } from '@swao/core';
import { selfSpawnCommand, providerLabel as centralProviderLabel, providerColumns, parsePassRunningLine, parsePostStepLine, type PostStepLine } from '@swao/core';
import { ConfirmPanel, CONFIRM_PANEL_KEYS, KEY_HINTS, PICKER_VISIBLE_COUNT, isAllowed, terminalFrameWidth, tone, tokenColor, useFlowNavigation, useOptionGuidance, type GuidanceEntry, type KeyHint, type LicenseStateView, type LicenseTier } from '@swao/tui-kit';

// SWAO_TUI_DEBUG=1 enables file-based TUI tracing to wsp/logs/tui-debug.log.
// Never writes to stdout (would corrupt Ink's cursor tracking).
const _tuiDebugPath = process.env['SWAO_TUI_DEBUG']
  ? join(process.cwd(), 'wsp', 'logs', 'tui-debug.log')
  : null;
const tuiDebug = (msg: string): void => {
  if (!_tuiDebugPath) return;
  try {
    mkdirSync(join(process.cwd(), 'wsp', 'logs'), { recursive: true });
    appendFileSync(_tuiDebugPath, `${new Date().toISOString()} ${msg}\n`, 'utf-8');
  } catch { /* best-effort */ }
};

import { TextInput } from '@swao/tui-kit';
import { SelectInput } from '@swao/tui-kit';
import { LENS_SAVE_OPTIONS, LENS_SAVE_YES, lensRunArgs, lensSaveQuestionNeeded } from './lens-save-default.js';
import { linkedAppCatalogueNotice, linkedAppCatalogueShortNotice, linkedAppSeedPrefill, lzCatTargetsArgs } from './lz-source-choice.js';
import { TargetLzNotice, TARGET_LZ_SKIP, TARGET_LZ_SKIP_OPTION, TARGET_LZ_MARKET_SCAN, targetLzMarketScanOption, lzMarketScanArgs, TARGET_LZ_TITLE, TARGET_LZ_PROVIDER_KEYS, TARGET_LZ_GAP_KEYS, TARGET_LZ_PROVIDER_HINT, TARGET_LZ_FILTER_KEYS, TARGET_LZ_MANUAL_REGION_KEYS, targetLzRegionKeys } from './TargetLzNotice.js';
import { setupLzTargetsFor, setupLzTargetsLine, setupTargetsNotOffered, providersWithoutRegion, providersWithoutRegionNotice } from './setup-lz-targets.js';
import { APP_SAVE_YES, appDefaultEdits, appRunChoiceArgs, runAppLlmConfig, appSaveHint, appSaveOptions, saveAppDefault, selectionDiffers } from './app-run-defaults.js';
import { MultiSelect } from '@swao/tui-kit';
import { DetailRow, guidanceOwnsKey, FinishPanel, FINISH_MAIN_MENU, FINISH_PANEL_KEYS, type FinishItem } from '@swao/tui-kit';
import { lensPassPreselection, passesLeftOut } from './lens-passes.js';
import { appFinishGuidance, appFinishView, failedRunGuidance, failedRunView, readAppRunFolder, readLzFitVerdicts, type AppChallengeOffer } from './app-finish.js';
import { CommunityFrameworkPicker } from '@swao/tui-kit';
import type { CommunityFrameworkOption } from '@swao/tui-kit';
import { LlmModelPicker, formatLlmCurrentLabel } from '@swao/tui-kit';
import { PasswordInput } from '@swao/tui-kit';
import { filterList, FILTER_THRESHOLD, SHOW_ALL } from '../list-filter.js';
import { findWorkspace, formatBaselineDecisionLines, readBaselineDecisions } from '@swao/core';
import { logApp } from '@swao/core';
import { createPassLineTracker } from './pass-line-tracker.js';
import { createAppRunSummary, readLatestRunId, readRunType } from './app-run-summary.js';
import { openWithDefaultApp, treeKillPid } from '@swao/core';
import { findInstalledChromium, PLAYWRIGHT_VERSION } from '@swao/core';
import { PASS_DESCRIPTIONS } from './shared/passDescriptions.js';
import { TUI_DEFAULT_PASS_KEYS, DEFAULT_PASS_KEYS as ORCHESTRATOR_DEFAULT_PASS_KEYS, TUI_OPT_IN_PASS_KEYS } from '../../orchestrator.js';
import { ChallengePromptPhase, challengeOfferForApp } from './shared/ChallengePromptPhase.js';
import { RunningPhase } from './shared/RunningPhase.js';
import { PreflightLlmPhase } from './shared/PreflightLlmPhase.js';
import { AppPickerPhase } from './shared/AppPickerPhase.js';
import { FlowFrame } from './shared/flow-frame.js';
import { RUN_OPTIONS_GUIDANCE, RUN_OPT_CACHE, RUN_OPT_ITER, RUN_OPT_SOURCE, RUN_OPT_STATS, appRunOptions } from './app-run-options.js';
import { APP_CRED_LLM, APP_CRED_PW_MFA, APP_CRED_PW_PASS, APP_CRED_PW_URL, APP_CRED_PW_USER, APP_CRED_VCS_TOKEN, APP_CRED_VCS_URL, APP_PHASE_STEP, APP_STEPS, APP_TEXT_PHASES, appBackPhase, appCredentialOptions, isAppPreRunPhase, type AppPhase } from './app-flow.js';
import { CRED_API_PREFIX, CRED_CONTINUE } from './lz-catalog-flow.js';
import { renameAppYmlText } from './app-rename-yml.js';
import { completedPassCount, isPassResultLine, lastPassName, passSubProgress } from '../../commands/pass-progress-line.js';
import type { LocalConnectorInfo } from './shared/types.js';
import { listLocalConnectors as sharedListLocalConnectors } from '@swao/module-llm-providers';
import {
  buildChildEnv,
  discoverCommunityRegimes,
  filterRegimesAgainstInstalled,
  BUILTIN_API_CONNECTORS,
  listApiTokenConnectors,
  readLastRunAppLzTargets,
  insertCountryHeaders,
  lzProviderRowGuidance,
  lzRegionRowGuidance,
  type RegimeOption,
  type AppYamlOptions,
  type LzCatalogueEntry,
  type LzCatalogueHint,
  type LensDef,
  type AssessScaffold,
} from '../assess-helpers.js';

// Core passes used as the first-run default selection (#0901).
// dynamic and malware are opt-in: they require external tooling (Playwright / malware
// scanners) and add significant run time.
// #3419: derived from the one default list (@swao/core DEFAULT_PASS_PROFILE via
// the orchestrator), so the secret scan (`secrets`) is pre-selected and the
// TUI cannot drift from the CLI default.
const DEFAULT_PASS_KEYS: string[] = [...TUI_DEFAULT_PASS_KEYS];

// All-passes string (includes dynamic) used for spawn args when "All passes" is chosen.
// #3419: the CLI `--passes` default itself, not a copy.
// The spawn logic conditionally omits --no-crawl when dynamic is in the selection (#0692).
const ALL_PASSES = ORCHESTRATOR_DEFAULT_PASS_KEYS.join(',');
const ALL_PASS_COUNT = ORCHESTRATOR_DEFAULT_PASS_KEYS.length;


// PASS_DESCRIPTIONS imported from ./assess/shared/passDescriptions.js

const PASS_FAIL_ADVICE: Record<string, string> = {
  synthesis: 'The 7R recommendation and the coverage score are missing from the report. Run synthesis alone by choosing synth on the Passes step. Check the API key in Credentials and that a proxy does not block HTTPS to the LLM endpoint.',
};

/** #4256: the details view of the finish screen (Enter or Esc returns to the finish menu). */
const FINISH_DETAILS_KEYS: readonly KeyHint[] = [{ key: 'Enter', verb: 'back' }];

/** #4255 (Design 126 sections 7.4 and 7.9): key hints of the phases before the run. Esc aborts the
 *  flow; the left arrow (Shift+Tab in a text input) goes back one step with the values kept. */
const K_CONFIRM_BACK: readonly KeyHint[] = KEY_HINTS.textInput;
const K_SELECT_CONFIRM_BACK: readonly KeyHint[] = KEY_HINTS.picker;
const K_PICKER: readonly KeyHint[] = KEY_HINTS.picker;
const K_NEXT_EMPTY_SKIPS: readonly KeyHint[] = [{ key: 'Enter', verb: 'next', object: '(empty skips)' }, { key: 'Shift+Tab', verb: 'back' }, { key: 'Esc', verb: 'abort' }];
const K_SAVE_EMPTY_SKIPS: readonly KeyHint[] = [{ key: 'Enter', verb: 'save', object: '(empty skips)' }, { key: 'Shift+Tab', verb: 'back' }, { key: 'Esc', verb: 'abort' }];
const K_TOGGLE_CONFIRM_BACK: readonly KeyHint[] = KEY_HINTS.multiSelect;
const K_NEXT_BACK: readonly KeyHint[] = [{ key: 'Enter', verb: 'next' }, { key: '←', verb: 'back' }, { key: 'Esc', verb: 'abort' }];
const OP_DONE_KEYS: readonly KeyHint[] = [{ key: 'Enter', verb: 'next' }, { key: 'Esc', verb: 'abort' }];
const K_PASSES: readonly KeyHint[] = [{ key: '↑↓', verb: 'select' }, { key: 'Space', verb: 'toggle' }, { key: 'A', verb: 'toggle', object: 'all' }, { key: 'Enter', verb: 'next' }, { key: '←', verb: 'back' }, { key: 'Esc', verb: 'abort' }];

const PASS_OPTIONS = [
  { label: 'All passes (recommended)',                  value: 'all'     },
  { label: '01-inv        Inventory analysis',          value: 'inv'     },
  { label: '02-state      State detection',             value: 'state'   },
  { label: '03-data       Data classification',         value: 'data'    },
  { label: '04-ctx        Context ingestion',           value: 'ctx'     },
  { label: '05-sbom       Software Bill of Materials',  value: 'sbom'    },
  { label: '06-tf         Terraform analysis',          value: 'tf'      },
  { label: '07-egr        Egress analysis',             value: 'egr'     },
  { label: '08-crypto     Cryptography scan',           value: 'crypto'  },
  { label: '09-synth      AI synthesis + 7R',           value: 'synth'   },
  { label: '10-dynamic    Playwright crawl',             value: 'dynamic' },
  { label: '11-comp       Compliance evaluation (LLM)', value: 'comp'    },
  { label: '12-blocks     Block assessments (LLM)',     value: 'blocks'  },
  { label: '13-scope      Scope analysis',              value: 'scope'   },
  { label: '26-quality    Code health worklist',         value: 'quality' }, // #3405
  // #3419: default secret scan (Gitleaks); the full malware scan supersedes it.
  { label: '14-secrets    Secret scan (Gitleaks)',       value: 'secrets' },
  { label: '14-malware    Malware scan (full)',          value: 'malware' },
];

// #0383: maps short pass keys (PASS_OPTIONS) to the long names used in
// PASS_DESCRIPTIONS so the per-pass GuidanceBox below the picker can show
// the right description as the cursor moves. Keep keys aligned with
// PASS_MAP in src/commands/assess.ts.
const PASS_SHORT_TO_LONG: Record<string, string> = {
  inv:     'inventory_scan',
  state:   'state_analysis',
  data:    'data_classification',
  ctx:     'context_ingestion',
  sbom:    'sbom_cve',
  tf:      'twelve_factor',
  egr:     'egress',
  crypto:  'crypto_posture',
  synth:   'synthesis',
  dynamic: 'dynamic_analysis',
  comp:    'compliance_evaluation',
  blocks:  'block_assessments',
  scope:   'scope_analysis',
  secrets: 'secret_scan',
  quality: 'code_health',
  malware: 'malware_scanning',
};

interface AppAssessmentScreenProps {
  onBack: () => void;
  /** SWAO version string, injected by the host (branding is host-only). */
  version: string;
  /** Workspace scaffolding functions, injected by the host (`swao init` owns them). */
  scaffold: AssessScaffold;
  /** #0928: called when the operator presses C on the assess-done screen to
   *  launch the Stakeholder Challenge for the just-assessed app. */
  onChallenge?: (app: string) => void;
}

function readStoredCredentials(): Record<string, string> {
  try { return new CredentialStore().loadSync(); }
  catch { return {}; }
}

// #0814: fire-and-forget write (set is async; caller does not need to await)
function writeCredential(name: string, value: string): void {
  try { void new CredentialStore().set(name, value); } catch { /* best-effort */ }
}

// #2324: derive the provider-scoped credential key for a VCS token.
// Mirrors vcsTokenKey() in swao/src/providers/vcs/auth.ts; inlined to avoid
// a cross-package import from this guest module.
function deriveVcsTokenKey(vcsUrl: string): string {
  try {
    const host = new URL(vcsUrl).hostname.toLowerCase();
    if (host === 'github.com' || host.endsWith('.github.com') || host.endsWith('.ghe.io')) return 'provider:github:token';
    if (host === 'gitlab.com' || host.endsWith('.gitlab.com')) return 'provider:gitlab:token';
    if (host === 'bitbucket.org' || host.endsWith('.bitbucket.org')) return 'provider:bitbucket:token';
    if (host === 'dev.azure.com' || host.endsWith('.visualstudio.com')) return 'provider:azure-devops:token';
  } catch { /* malformed URL -- use generic fallback */ }
  return 'provider:vcs:token';
}

interface WorkspaceLlmConfig { type?: string; endpoint?: string; model?: string; connector?: string; }

function readWorkspaceLlmConfig(workspace: string | null): WorkspaceLlmConfig {
  if (!workspace) return {};
  try {
    const raw = readFileSync(join(workspace, '.swao.yml'), 'utf-8');
    const providersSection = raw.split('providers:')[1] ?? '';
    const typeMatch     = providersSection.match(/type:\s+([^\s~][^\n]*)/);
    const endpointMatch = providersSection.match(/endpoint:\s+"?([^"\n~]+)"?/);
    const modelMatch    = providersSection.match(/model:\s+([^\s~][^\n]*)/);
    const connectorMatch = providersSection.match(/connector:\s+([^\s~][^\n]*)/);
    return {
      type:     typeMatch?.[1]?.trim(),
      endpoint: endpointMatch?.[1]?.trim(),
      model:    modelMatch?.[1]?.trim(),
      connector: connectorMatch?.[1]?.trim(),
    };
  } catch { return {}; }
}

// #0800: read per-app LLM config (falls back to workspace if absent)
function readAppLlmConfig(workspace: string | null, appId: string): WorkspaceLlmConfig {
  if (!workspace || !appId) return {};
  try {
    const appYml = join(workspace, 'apps', appId, '.swao.yml');
    if (!existsSync(appYml)) return {};
    const raw = readFileSync(appYml, 'utf-8');
    const providersSection = raw.split('providers:')[1] ?? '';
    const typeMatch     = providersSection.match(/type:\s+([^\s~][^\n]*)/);
    const endpointMatch = providersSection.match(/endpoint:\s+"?([^"\n~]+)"?/);
    const modelMatch    = providersSection.match(/model:\s+([^\s~][^\n]*)/);
    const connectorMatch = providersSection.match(/connector:\s+([^\s~][^\n]*)/);
    if (!typeMatch && !connectorMatch) return {};
    return {
      type:     typeMatch?.[1]?.trim(),
      endpoint: endpointMatch?.[1]?.trim(),
      model:    modelMatch?.[1]?.trim(),
      connector: connectorMatch?.[1]?.trim(),
    };
  } catch { return {}; }
}

// #0723: read partnership_lead from workspace .swao.yml to pre-fill assessor: in new app yamls
function readWorkspacePartnershipLead(workspace: string | null): string | undefined {
  if (!workspace) return undefined;
  try {
    const raw = readFileSync(join(workspace, '.swao.yml'), 'utf-8');
    const m = raw.match(/^\s*partnership_lead:\s+"?([^"~\n][^\n]*?)"?\s*$/m);
    return m?.[1]?.trim() || undefined;
  } catch { return undefined; }
}

// #3388 (Design 112): the private listLocalConnectors copy was removed; the one
// reader now lives in @swao/module-llm-providers (imported below) and seeds the
// workspace folder when empty (single source, D-3).
const listLocalConnectors = sharedListLocalConnectors;

export function AppAssessmentScreen({ onBack, version, scaffold, onChallenge }: AppAssessmentScreenProps): JSX.Element | null {
  const workspace = findWorkspace(process.cwd());
  const assessmentType = 'application' as const;
  const typeLabel = 'Application Assessment';

  // #2262/#2335: component-level licence state for tier-gate enforcement in key
  // handlers and the running-phase line transformer. Mirrors the PublishScreen
  // pattern (lines 149-152). Fail-closed: a load error yields community tier.
  const licenseState = useMemo<LicenseStateView>(() => {
    try { return LicenseGuard.load().state as LicenseStateView; }
    catch { return { tier: 'community', assessmentCount: 0, firstRun: '' }; }
  }, []);
  const isEnterprise = isAllowed(licenseState, 'enterprise' as LicenseTier);


  const [phase, setPhase]     = useState<AppPhase>('input-app');
  const [app, setApp]         = useState('');
  // #3980 seeding, #4244 (every tier): the target LZ step pre-fills the targets the CLI seeds for a linked app.
  const lzLinkSeed = useMemo(() => linkedAppSeedPrefill(workspace, app), [workspace, app]);
  // #4285: the set-up targets (assessment.landing_zone.targets, app then workspace), geographies resolved as the CLI does.
  const setupLz = useMemo(() => setupLzTargetsFor(workspace, app, scaffold.resolveSetupLzTargets, () => []), [workspace, app, scaffold.resolveSetupLzTargets]);
  // #4285 (#4289 AC2): providers chosen without any region, named before the run.
  const [lzProvidersWithoutRegion, setLzProvidersWithoutRegion] = useState<string[]>([]);
  const [vcsUrl, setVcsUrl]       = useState('');
  const [vcsRef, setVcsRef]       = useState('');
  const [, setVcsSubdir] = useState('');
  const [regimes, setRegimes] = useState<string[]>([]);
  // #0382: tracks the MultiSelect cursor row so the per-framework
  // #0385 Design 074: active lens selection + auto-framework hints from confirmed lenses.
  const [selectedLenses, setSelectedLenses] = useState<string[]>([]);
  // #4283: a refused save-as-default write (the run continues with the lenses).
  const [lensSaveError, setLensSaveError] = useState<string | null>(null);
  // #4284: run-time choices of this run (flags of the run, never written unless saved as the default).
  const [regimesConfirmed, setRegimesConfirmed] = useState(false);
  const [runLlmProvider, setRunLlmProvider] = useState<string | null>(null);
  const [appSaveError, setAppSaveError] = useState<string | null>(null);
  const [lensAutoFrameworks, setLensAutoFrameworks] = useState<string[]>([]);
  // #1068: ref mirrors lensAutoFrameworks so initialSelected in the regime picker reads the
  // synchronously-updated value, not the stale state captured before React flushes the batch.
  const lensAutoFrameworksRef = useRef<string[]>([]);
  // #0991: tracks the MultiSelect cursor for the lens picker so the GuidanceBox
  // below can show per-lens description + pass/framework details.
  const [lensCursor, setLensCursor] = useState<string>('');
  // #0383: tracks the passes-MultiSelect cursor so the per-pass GuidanceBox
  // updates with the highlighted pass's purpose + what it measures.
  const [passCursor, setPassCursor] = useState<string>('all');
  const [passes, setPasses]   = useState<string[]>([]);
  // #0895 -- Stats on by default; set SWAO_ASSESS_STATS=0 to suppress for
  // headless/CI runs.  Toggle with 'S' during input-passes phase.
  const [showStats, setShowStats] = useState<boolean>(process.env['SWAO_ASSESS_STATS'] !== '0');
  // Cassette fallback: true = use committed fixtures when workspace cache misses (default).
  // Toggle with 'C' key. Default OFF -- interactive assessments always call the LLM fresh.
  // Enable only when explicitly replaying a known-good cassette (cost saving / CI).
  const [useCassette, setUseCassette] = useState<boolean>(false);
  // #0259.C1 -- CLI/TUI parity. --source-path overrides .swao.yml source.path
  // (useful for re-running against a fresh clone or a sibling directory
  // without editing the YAML). Empty string = no override. --iter pins the
  // iteration number for the run-manifest; defaults to 1.
  const [sourcePath, setSourcePath] = useState<string>('');
  const [iter, setIter]             = useState<string>('1');
  // #0516 AC#2: inline warning shown when the URL input does not match any
  // recognised pattern (relative path, ambiguous string).
  const [sourceInputWarning, setSourceInputWarning] = useState<string>('');
  const [lzProvider, setLzProvider]       = useState<string>('');
  const [lzRegion, setLzRegion]           = useState<string>('');
  const [lzRegionFilter, setLzRegionFilter] = useState<string>('');
  // #0803: multi-CSP/multi-region LZ target selection.
  // appLzCatProviders: selected provider IDs (multi-select).
  // appLzCatTargets: confirmed "provider:region" pairs passed via --lz-cat-targets.
  // appLzCatFrameworks: selected community framework IDs for sovereignty gate.
  const [appLzCatProviders, setAppLzCatProviders] = useState<string[]>([]);
  const [appLzCatTargets, setAppLzCatTargets]     = useState<string[]>([]);
  const [appLzCatFrameworks, setAppLzCatFrameworks] = useState<string[]>([]);
  const [appLzRegionFilter, setAppLzRegionFilter] = useState<string>('');
  // #4481: opt-in market scan of the bundled provider list (--lz-market-scan), off by default.
  const [appLzMarketScan, setAppLzMarketScan] = useState<boolean>(false);
  // #0814: per-app credential collection. Credentials are stored in CredentialStore
  // with per-app keys (e.g. vcs-token-sovereign-health). appCredStoredKeys tracks
  // which keys are already stored so the UI can show "stored -- Enter to keep."
  const [appCredStoredKeys, setAppCredStoredKeys] = useState<Set<string>>(new Set());
  // #0800: edit-only mode -- E key from input-app opens credential hub without
  // advancing to regimes/passes. Enter/S in hub returns to input-app instead.
  const [editOnlyMode, setEditOnlyMode] = useState(false);
  // #0800: appCursorValue moved to AppPickerPhase local state (#2371).
  // #0800: saved pass profile from app .swao.yml, used as initialSelected in input-passes.
  // #0901: default to core passes only (no dynamic/malware) -- operator opts in explicitly.
  const [initialPassProfile, setInitialPassProfile] = useState<string[]>(DEFAULT_PASS_KEYS);
  // #4499: the app's pass preselection before the lenses; a lens adds to it.
  const basePassProfileRef = useRef<string[]>([...DEFAULT_PASS_KEYS]);
  const setBasePassProfile = (p: readonly string[]): void => { basePassProfileRef.current = [...p]; setInitialPassProfile([...p]); };
  // #0776-C: collect Playwright URL + login credentials before writing atomically
  // at the password step so all three fields land in the crawl block together.
  const [playwrightUrl, setPlaywrightUrl]                     = useState('');
  const [playwrightUsername, setPlaywrightUsername]           = useState('');
  const [playwrightUrlMatchSourceApp, setPlaywrightUrlMatchSourceApp] = useState('');
  // #0908: tracks whether the reuse check was entered from the wizard or the credential hub.
  const [playwrightUrlReuseOrigin, setPlaywrightUrlReuseOrigin] = useState<'wizard' | 'hub'>('wizard');
  // #0763: appFilter moved to AppPickerPhase local state (#2371).
  const [lines, setLines]     = useState<string[]>([]);
  // passNum was tracked when the progress bar was driven by it directly;
  // #0379 replaced that with `completedPasses + subFraction`, leaving
  // passNum as a read-nowhere state. Dropped to satisfy no-unused-vars.
  const [passName, setPassName] = useState('');
  // #0246: per-pass sub-progress label (e.g. "BSI_C5 (3/7)" while
  // Pass 11 iterates regimes). Cleared on every new pass.
  const [passSubLabel, setPassSubLabel] = useState('');
  // #4498: the post-pass step after the last pass ("[post] Portfolio summary: 106 of 235 apps").
  const [postStep, setPostStep] = useState<PostStepLine | null>(null);
  // #0379: track completed passes + intra-pass fractional advancement so the
  // progress bar reflects actual work done. Previously the bar was driven by
  // passNum (rising 1..12) against a hardcoded total of 9, so it pinned at
  // 100 percent the moment passNum reached 9 -- well before Pass 11 (comp)
  // had iterated all selected community frameworks.
  const [completedPasses, setCompletedPasses] = useState(0);
  const [subFraction, setSubFraction] = useState(0);
  const [failedPass, setFailedPass] = useState('');
  const [done, setDone]       = useState(false);
  const [code, setCode]       = useState<number | null>(null);
  const [deleteSelection, setDeleteSelection] = useState<string[]>([]);
  const [renameTarget, setRenameTarget]       = useState('');
  const [opMessage, setOpMessage]             = useState('');
  const [opError, setOpError]                 = useState('');
  // #0928: block assessment verdicts read from 12-blocks.yaml when assess-done.
  const [blockVerdicts, setBlockVerdicts] = useState<Record<string, string>>({});
  // #4256: the finish screen shows its details (block verdicts, baseline decisions) on request.
  const [finishDetails, setFinishDetails] = useState(false);
  // #3981: baseline decisions of the run (ranked contributions per control), from baseline-decisions.json.
  const [baselineDecisionLines, setBaselineDecisionLines] = useState<string[]>([]);
  // #0659: landing-zone verdict + per-target breakdown captured from child stdout
  const [lzVerdict, setLzVerdict] = useState('');
  const [lzTargetVerdicts, setLzTargetVerdicts] = useState<{ target: string; verdict: string; gaps: number }[]>([]);
  // #0715: path to the assess.log written after child closes; drives the L key.
  const [logFilePath, setLogFilePath] = useState('');
  // #0805: ref so the useInput stale-closure sees the live logFilePath value.
  const logFilePathRef = useRef(logFilePath);
  logFilePathRef.current = logFilePath;

  // #2571: ref mirrors passName so the push closure (inside useEffect) can
  // log tui.output events with the correct current pass without a stale closure.
  const passNameRef = useRef(passName);
  passNameRef.current = passName;

  // Read files once at mount -- never during render to avoid lag on every keypress
  const [storedCreds] = useState(() => readStoredCredentials());
  const [wsLlmConfig] = useState(() => readWorkspaceLlmConfig(workspace));

  // #2329/#2351: LLM connector list for the API tokens section of the credential hub.
  const [apiTokenConnectors, setApiTokenConnectors] = useState<LocalConnectorInfo[]>([]);
  const [apiTokenConnectorIdx, setApiTokenConnectorIdx] = useState(0);
  // #2328: resolved connector + apiKey passed as props into PreflightLlmPhase (#2371).
  const [preflightConnector, setPreflightConnector] = useState<LocalConnectorInfo | null>(null);
  // #3383: run the deterministic passes only (adds --skip-llm) when the operator
  // chooses to proceed without a reachable LLM.
  const [skipLlm, setSkipLlm] = useState(false);
  const [preflightApiKey, setPreflightApiKey] = useState<string | undefined>(undefined);

  const detectedProvider = (() => {
    // #1401 sprint-113: gateway connector selection wins (Design 090).
    const connector = wsLlmConfig.connector ?? process.env['SWAO_LLM_CONNECTOR'];
    if (connector) return `Gateway: ${connector}${wsLlmConfig.model ? `  (${wsLlmConfig.model})` : ''}`;
    const type = wsLlmConfig.type ?? process.env['SWAO_LLM_PROVIDER'];
    // #0392 (sprint-040): when .swao.yml pins a provider, the workspace
    // YAML wins -- match buildChildEnv's actual selection so the TUI
    // header does not lie. Previous code returned 'OpenAI' whenever an
    // OpenAI key was stored, even if .swao.yml pinned Anthropic; the
    // run then used Anthropic, leaving the operator confused why their
    // OpenAI key showed "Never used" on the OpenAI dashboard.
    if (type === 'ollama')    return `Ollama  (${wsLlmConfig.endpoint ?? 'http://localhost:11434'})`;
    if (type === 'anthropic') return `Anthropic Claude${wsLlmConfig.model ? ` (${wsLlmConfig.model})` : ''}`;
    if (type === 'openai')    return `OpenAI${wsLlmConfig.model ? ` (${wsLlmConfig.model})` : ''}`;
    // No type in .swao.yml -- fall back to credential availability + ordering
    // (anthropic first because the .swao.yml template defaults to it).
    if (storedCreds['anthropic-api-key'] || process.env['ANTHROPIC_API_KEY']) return 'Anthropic Claude  (credential-only; .swao.yml has no provider pinned)';
    if (storedCreds['openai-api-key']    || process.env['OPENAI_API_KEY'])    return 'OpenAI  (credential-only; .swao.yml has no provider pinned)';
    return 'No LLM credentials configured. Set SWAO_LLM_PROVIDER or add the credentials in Tools, Credentials.';
  })();

  // #0620: terminal-size-based caps keep the TUI frame from overflowing the
  // viewport (which strands the previous frame's header in scrollback).
  // Row budget: outer-padding(2) + header(6) + app-row(1) + progress(3) +
  // status(1) + live-box-overhead(2) + guidance(4) = 19 reserved rows.
  // For input-passes MultiSelect: header(6) + info-row(2) + multiselect-
  // fixed-overhead(4) + guidance(4) + scroll-indicators(2) = 18 reserved.
  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? 24;
  const terminalCols = stdout?.columns ?? 80;
  const passVisibleCount = Math.max(4, terminalRows - 18);
  // Match the GuidanceBox width formula (#0741) so all bordered panels align.
  const guidanceWidth = Math.min(100, Math.max(63, terminalCols - 2));

  // SWAO_TUI_DEBUG: log every phase transition to wsp/logs/tui-debug.log.
  useEffect(() => {
    tuiDebug(`phase:${phase} rows=${terminalRows} cols=${terminalCols}`);
  }, [phase, terminalRows, terminalCols]);

  useEffect(() => {
    if (phase !== 'running') return;

    // Reset counters + output from any previous run in the same session (#0379).
    setCompletedPasses(0);
    // #4256 (A-20): a rerun after a cancel starts on the preparing state, never on the old pass.
    setPassName('');
    setPassSubLabel('');
    setPostStep(null);
    setFailedPass('');
    setSubFraction(0);
    setLines([]);
    setLzVerdict('');
    setLzTargetVerdicts([]);
    // #0805 (sprint-078): do NOT write ANSI escape sequences to stdout from
    // inside a useEffect. Ink's diff renderer does not know the screen was
    // cleared so it uses a stale cursor offset for the next frame, which
    // paints over a blank surface and leaves the TUI visually frozen.
    // The alt-screen buffer (run-app.ts) already gives the running phase a
    // clean viewport; Ink's full re-render overwrites prior content correctly.

    const passArg = passes.includes('all') ? ALL_PASSES : passes.join(',');
    // #0692: include --no-crawl only when dynamic is not in the effective pass list.
    // When "all" is selected, ALL_PASSES now includes dynamic so the crawl runs.
    const includeDynamic = passes.includes('all')
      ? ALL_PASSES.split(',').includes('dynamic')
      : passes.includes('dynamic');
    let args: string[];
    args = ['assess', '--app', app, '--passes', passArg];
    args.push(...lensRunArgs((scaffold.lenses?.length ?? 0) > 0, selectedLenses)); // #4283 lenses_used of this run
    args.push(...appRunChoiceArgs({ regimes: regimesConfirmed ? regimes : null, llmProvider: runLlmProvider })); // #4284 run-time choices
    if (skipLlm) args.push('--skip-llm'); // #3383
    if (!includeDynamic) args.push('--no-crawl');
    if (showStats) args.push('--stats');
    if (!useCassette) args.push('--no-cache');
    if (sourcePath.trim()) args.push('--source-path', sourcePath.trim());
    if (iter.trim() && iter.trim() !== '1') args.push('--iter', iter.trim());
    // #4244: the app LZ step offers the static catalogue only (live landing-zone
    // data is used only by the LZ Live Assessment).
    if (appLzCatTargets.length > 0) {
      // #3980 seeding: the unedited seeded pre-fill carries --lz-cat-targets-seeded.
      const offered = (scaffold.lzCatalogueHint?.entries ?? []).flatMap(e => e.regions.map(r => `${e.provider}:${r.id}`));
      args.push(...lzCatTargetsArgs(appLzCatTargets, lzLinkSeed, offered));
    } else {
      // #3378 (ADR-0067): the TUI chooses LZ targets per run and never falls back
      // to .swao.yml. An empty selection (or skipping the LZ step) means "no LZ
      // fit for this run", so tell the CLI explicitly instead of letting its
      // .swao.yml resolver fire.
      args.push('--no-lz-fit');
    }
    args.push(...lzMarketScanArgs(appLzMarketScan)); // #4481

    // #2495: Design 098 -- emit assess.app.start before spawning the subprocess.
    try { logApp(app, 'info', 'assess.app.start', 'assessment started', { context: { passes: passArg } }); } catch { /* best-effort */ }
    // #4301: passes, signals and run id for assess.app.complete, from the pass tracker's events.
    const runSummary = createAppRunSummary(passArg);

    // #4267: SWAO_PASS_MARKERS=1 opts in to the [pass-start] / [pass-done] markers the event writer reads.
    const selfCmd = selfSpawnCommand(args, { env: { ...buildChildEnv(workspace, storedCreds, wsLlmConfig, runAppLlmConfig(readAppLlmConfig(workspace, app), runLlmProvider)), SWAO_PASS_MARKERS: '1' } });
    const child = spawn(selfCmd.command, selfCmd.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: selfCmd.env,
      cwd: workspace ?? undefined,
      // #0805: prevent child PKG binary from inheriting the parent's Windows
      // console handle. Without this, the child's Node.js runtime calls
      // Windows console APIs (SetConsoleCtrlHandler, GetConsoleMode, etc.)
      // on startup, corrupting the parent Ink terminal state and causing the
      // TUI to go blank immediately after the running-phase transition.
      windowsHide: true,
    });

    const allLines: string[] = [];
    let stopped = false;
    // #4267: per-line pass attribution and assess.app.pass.* events from the child's markers.
    const passTracker = createPassLineTracker();
    // #0996: Filter Node.js runtime deprecation warnings from third-party deps.
    // Buffer() deprecation ([DEP0005]) from xlsx/docx processing is not actionable
    // for the operator and pollutes the assess.log.
    const DEP_WARN_FILTER = /\[DEP\d{4}\] DeprecationWarning|Use `.*--trace-deprecation/;
    // #1686: batch setLines updates so rapid stdout chunks coalesce into one
    // re-render per tick instead of one per line. This keeps the Ink useInput
    // hook responsive to Ctrl+G during active pass execution.
    let pendingLines: string[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushPending = () => {
      if (pendingLines.length > 0) {
        const batch = pendingLines;
        pendingLines = [];
        setLines(prev => [...prev, ...batch]);
      }
      flushTimer = null;
    };
    const push = (chunk: Buffer) => {
      const text = chunk.toString();
      const newLines: string[] = [];
      // #2571: emit each output line to the NDJSON event log so the --- Output ---
      // section is persisted in real-time alongside WSP artefacts.
      // #4267: the pass of each line comes from the tracker (updated per line); the
      // [pass-start] / [pass-done] markers become assess.app.pass.* events and are not shown.
      for (const line of text.split('\n').filter(l => Boolean(l) && !DEP_WARN_FILTER.test(l))) {
        const tracked = passTracker.consume(line);
        for (const ev of tracked.events) {
          runSummary.observe(ev);
          try { logApp(app, 'info', ev.code, ev.message, { context: ev.context }); } catch { /* best-effort */ }
        }
        if (tracked.marker) continue;
        newLines.push(line);
        try { logApp(app, 'info', 'tui.output', line, { context: { pass: tracked.pass } }); } catch { /* best-effort */ }
      }
      allLines.push(...newLines);
      pendingLines.push(...newLines);
      if (!flushTimer) flushTimer = setTimeout(flushPending, 50);
      // Match every "Pass NN, name" occurrence; take the LAST. A single
      // stdout chunk often carries both "[ok] Pass NN, finished" AND the
      // next "[info] Running Pass NN+1, starting" -- with .match() only
      // the first match wins, so passName lagged a pass behind and the
      // label + error-state both showed the wrong pass name. #0403.
      const lastPass = lastPassName(text);
      if (lastPass !== null) {
        setPassName(lastPass);
        setPassSubLabel('');
        setSubFraction(0);
      }
      // #0379: count completed passes via "[ok] Pass NN" so the progress
      // bar denominator stays honest. Use match-all to handle the case
      // where two passes complete in the same stdout chunk.
      const okDelta = completedPassCount(text);
      if (okDelta > 0) {
        setCompletedPasses(prev => prev + okDelta);
        // #2495 / #4267: assess.app.pass.complete is written by the pass tracker above.
      }
      // #0659: landing-zone fit completion -- one line per target in multi-target runs.
      // #1114: use matchAll+/g so multiple targets arriving in one stdout chunk are all
      // captured; provider names may contain spaces (e.g. "AWS ESC") so [^/]* instead of \S+.
      if (/\[ok\].*Landing-zone fit complete/i.test(text)) {
        setCompletedPasses(prev => prev + [...text.matchAll(/\[ok\].*Landing-zone fit complete/gi)].length);
        for (const m of text.matchAll(/fit complete\s+(\S[^/]*\/\S+)\s+verdict:\s+(\S+)\s+(\d+)\s+gap/gi)) {
          const tv = { target: m[1] ?? '', verdict: (m[2] ?? '').toLowerCase(), gaps: parseInt(m[3] ?? '0', 10) };
          setLzTargetVerdicts(prev => [...prev.filter(v => v.target !== tv.target), tv]);
          setLzVerdict(tv.verdict); // single-target fallback; overwritten by Overall: below
        }
      }
      // Overall verdict from multi-target summary line -- always printed even for 1 target.
      const overallM = text.match(/Overall:\s+(\S+)/i);
      if (overallM) setLzVerdict((overallM[1] ?? '').toLowerCase());
      // #0246 + #0379: per-pass sub-progress "[progress] Pass 11, BSI_C5 (3/7)".
      // The label surfaces intra-pass advancement so the operator knows the
      // LLM is making headway; subFraction (n/d) feeds into the bar value
      // so Pass 11's framework loop advances the bar smoothly rather than
      // jumping a full pass-width at the end.
      // #4498: a post-pass step line names the step that runs after the last pass.
      const post = parsePostStepLine(text);
      if (post) setPostStep(post);
      const pm = passSubProgress(text);
      if (pm) {
        const num = pm.done;
        const den = pm.total;
        setPassSubLabel(`${pm.label} (${num}/${den})`);
        if (den > 0) setSubFraction(num / den);
      }
      // #1097: advance sub-fraction when a pass STARTS so the bar shows
      // non-zero progress during long-running LLM calls (not just on completion).
      if (parsePassRunningLine(text) !== null) { // #4402: the one parser of @swao/core
        setSubFraction(0.5);
        // #2495 / #4267: assess.app.pass.start is written by the pass tracker above.
      }
      // Match "[error] Pass synth failed: ..."
      const errM = text.match(/\[error\] Pass (\S+) failed/i);
      if (errM) setFailedPass((errM[1] ?? '').trim());
    };

    child.stdout.on('data', push);
    child.stderr.on('data', push);
    // #0802: surface spawn failures as a normal failure state rather than an
    // unhandled 'error' event that terminates the process silently.
    child.on('error', (err) => {
      setLines(prev => [...prev, `[error] Failed to start assessment process: ${err.message}`]);
      setCode(1);
      setDone(true);
      setPhase('done');
    });
    child.on('close', (exitCode) => {
      // #1686: flush any batched lines before signalling done.
      if (flushTimer) { clearTimeout(flushTimer); flushPending(); }
      // #2495: emit assess.app.complete before signalling done (different code from
      // subprocess's assessment.app.complete -- no double-entry, see #1782 rationale).
      // #4301: run_id, status, duration, passes run and not run, signals, caller.
      try {
        const latest = workspace ? readLatestRunId(resolve(workspace, 'apps', app, 'wsp')) : null;
        // #4400: the run type from the run (run-status.json), not the flow.
        const done = runSummary.complete(exitCode, latest, workspace ? readRunType(resolve(workspace, 'apps', app, 'wsp'), latest) : 'application');
        logApp(app, done.level, 'assess.app.complete', done.message, { context: done.context });
      } catch { /* best-effort */ }
      // #4256: a cancelled run (or a screen that left) keeps its state; the cancel set the phase.
      if (!stopped) { setCode(exitCode); setDone(true); }
      // #1782: lz.assess.complete is emitted by the CLI subprocess (assess.ts)
      // with authoritative context. The TUI emission was redundant and caused
      // double-entry in the NDJSON event log with inconsistent context shapes.
      try {
        const wspDir = workspace ? resolve(workspace, 'apps', app, 'wsp') : null;
        if (wspDir) {
          mkdirSync(wspDir, { recursive: true });
          const latestFile = join(wspDir, 'latest.txt');
          let logDir = wspDir;
          if (existsSync(latestFile)) {
            try {
              const latestPath = readFileSync(latestFile, 'utf-8').trim();
              const runDir = join(wspDir, latestPath);
              if (existsSync(runDir)) logDir = runDir;
            } catch { /* use wspDir */ }
          }
          const logFile = join(logDir, 'assess.log');
          writeFileSync(logFile, allLines.join('\n') + '\n', 'utf-8');
          setLogFilePath(logFile);
        }
      } catch { /* non-fatal */ }
      // #0407 (sprint-040 round-6): on success, pause at an explicit
      // "assessment done" summary screen so the operator can see the
      // final 100% green bar + signals total before deciding to emit the
      // BI bundle. Previously this auto-routed straight to export-prompt
      // and the 100% bar flashed by too quickly.
      // On non-zero exit, the BI bundle is meaningless -- skip the prompt.
      if (stopped) return;
      if (exitCode === 0) {
        setPhase('assess-done');
      } else { setPhase('done'); }
    });
    // #4256 (Design 126 section 7.6): leaving the run phase (cancel) or the screen stops the
    // child process tree (taskkill /T on Windows); the close handler then changes nothing.
    return () => {
      stopped = true;
      if (child.pid) void treeKillPid(child.pid); else child.kill();
      if (flushTimer) clearTimeout(flushTimer);
    };
  }, [phase]);


  // #0397 / #0400 / #0406 / #0407 REVERTED AGAIN: writing \x1b[2J\x1b[H
  // during render confused Ink's diff-renderer -- Ink doesn't know about
  // external terminal mutations, so its next-frame diff was wrong and
  // the post-export screen rendered blank.  Tracked for sprint-041; the
  // bleed-tolerance approach (let Ink redraw within its own bounds, even
  // if a tail of the previous phase shows) is the lesser evil.

  // Event-handler-safe clear: fires inside event callbacks (never during render),
  // so Ink renders the new phase into the already-cleared buffer. Mirrors App.tsx.
  const clearScreen = () => {
    try { process.stdout.write('\x1B[2J\x1B[3J\x1B[H'); } catch { /* terminal gone */ }
  };

  // #0815: auto-advance LZ region phase when only one option exists.
  // Runs as a useEffect (not inline render logic) to avoid React side-effect
  // violations. Fires whenever the input-app-lz-region phase becomes active.
  useEffect(() => {
    if (phase !== 'input-app-lz-region') return;
    const hint = scaffold.lzCatalogueHint;
    if (!hint) return;
    if (phase === 'input-app-lz-region') {
      const allTargets = appLzCatProviders.flatMap(pid => {
        const entry = hint.entries.find(e => e.provider === pid);
        if (!entry) return [];
        return entry.regions.map(r => `${pid}:${r.id}`);
      });
      if (allTargets.length === 1 && appLzCatTargets.length === 0) {
        tuiDebug(`pre-selected single app LZ target: ${allTargets[0]!}`);
        setAppLzCatTargets([allTargets[0]!]);
      }
    }
  }, [phase, appLzCatProviders, appLzCatTargets, scaffold.lzCatalogueHint]);

  // #0814: load stored credential keys when entering the credential hub so the
  // UI can show "already stored -- Enter to keep" hints per sub-step.
  // #2329/#2351: enumerate LLM connectors (built-ins + workspace + llm-gateways/) for the API tokens section.
  useEffect(() => {
    if (phase !== 'input-app-credentials') return;
    const stored = readStoredCredentials();
    const keys = new Set(Object.keys(stored));
    setAppCredStoredKeys(keys);
    setApiTokenConnectors(listApiTokenConnectors(workspace ?? undefined));
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps


  const guidanceOpenRef = useRef(false);

  // #4255 (Design 126 sections 7.4 and 7.5): Esc before the run aborts the flow
  // (AbortDialog once an app is chosen). The screen reads the keys itself (its
  // phases are the steps), so the hook only provides the dialog and the decision.
  const nav = useFlowNavigation({ steps: APP_STEPS, dirty: app !== '', onExit: onBack, what: 'assessment', active: false });
  const flowHeader = useMemo(() => {
    let ls: LicenseStateView | null = null;
    let le: string | null = null;
    try { ls = LicenseGuard.load().state as LicenseStateView; }
    catch (e) { le = (e as Error).message; }
    return { subtitle: typeLabel, version, licenseState: ls, licenseError: le };
  }, [version]);
  const onGuidanceOpenChange = (open: boolean): void => { guidanceOpenRef.current = open; nav.onGuidanceOpenChange(open); };
  /** The frame of a phase before the run: header, licence line, step bar, title (#4255). */
  const frame = { header: flowHeader, steps: APP_STEPS, current: APP_PHASE_STEP[phase], onGuidanceOpenChange, dialog: nav.dialog };
  // #4230: the credential list box follows the highlighted entry.
  // #4255: the run options box follows the highlighted entry.
  const { entry: runOptionEntry, onCursorChange: onRunOptionCursor } = useOptionGuidance(RUN_OPTIONS_GUIDANCE);
  // #4213 (Design 126 section 9): the entry of the highlighted option of the current picker
  // phase; every picker sets it on mount and on each move, so no phase reads a stale entry.
  const [pickEntry, setPickEntry] = useState<GuidanceEntry | undefined>(undefined);
  const onPickCursor = (_v: string, o?: { guidance?: GuidanceEntry }): void => { setPickEntry(o?.guidance); };
  const pickGuidance = pickEntry ? { entry: pickEntry } : {};
  const { entry: credEntry, onCursorChange: onCredCursor } = useOptionGuidance({ title: 'Per-app credentials', what: 'Credentials are keyed to this app only and stored in the SWAO credential store. Every field is optional; Continue goes on.' });

  // #0928: read block verdicts from 12-blocks.yaml when the assessment finishes.
  useEffect(() => {
    if (phase !== 'assess-done' || !workspace || !app) return;
    try {
      const runsDir = join(workspace, 'apps', app, 'wsp', 'runs');
      if (!existsSync(runsDir)) return;
      const latest = readdirSync(runsDir).sort().at(-1);
      if (!latest) return;
      const decisions = readBaselineDecisions(join(runsDir, latest));
      if (decisions) setBaselineDecisionLines(formatBaselineDecisionLines(decisions, 6));
      const blocksPath = join(runsDir, latest, 'passes', '12-blocks.yaml');
      if (!existsSync(blocksPath)) return;
      const parsed = loadYaml(readFileSync(blocksPath, 'utf-8')) as { assessment?: { blocks?: Record<string, unknown> } } | null;
      const blocks = parsed?.assessment?.blocks;
      if (blocks && typeof blocks === 'object') {
        const verdicts: Record<string, string> = {};
        for (const [k, v] of Object.entries(blocks)) {
          if (v && typeof v === 'object' && 'verdict' in (v as object)) {
            verdicts[k] = String((v as Record<string, unknown>)['verdict'] ?? 'UNKNOWN');
          }
        }
        setBlockVerdicts(verdicts);
      }
    } catch { /* no blocks data -- skip */ }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // #2328: Route to preflight-llm if the workspace uses an LLM gateway connector,
  // otherwise go directly to 'running'. Reads per-app override at call time.
  const beginRun = () => {
    // #4284: the LLM provider chosen for this run (preflight on what the run uses).
    const appLlm = runAppLlmConfig(readAppLlmConfig(workspace, app), runLlmProvider);
    const connectorId = appLlm.connector ?? wsLlmConfig.connector;
    if (!connectorId) { setPhase('running'); return; }
    const connectors = listLocalConnectors(workspace ?? undefined);
    const active = connectors.find(c => c.id === connectorId);
    if (!active) { setPhase('running'); return; }
    const resolvedApiKey = active.credentialKey
      ? (storedCreds[active.credentialKey] ?? undefined)
      : (active.envVar ? process.env[active.envVar] : undefined);
    // #3385: ping the model of this run, not the connector default.
    setPreflightConnector({ ...active, model: appLlm.model ?? wsLlmConfig.model });
    setPreflightApiKey(resolvedApiKey);
    setPhase('preflight-llm');
  };

  // #2328: preflight LLM ping logic moved to PreflightLlmPhase (#2371).

  /** #4255 (section 7.1): in a text input the left arrow moves the text cursor; Shift+Tab goes back. */
  const appTextPhase = (): boolean => {
    if (APP_TEXT_PHASES.has(phase)) return true;
    const entries = scaffold.lzCatalogueHint?.entries ?? [];
    if (phase === 'input-app-lz-provider') return entries.length === 0;
    if (phase === 'input-app-lz-region') {
      const n = appLzCatProviders.reduce((sum, pid) => sum + (entries.find(e => e.provider === pid)?.regions.length ?? 0), 0);
      return n === 0 || (n > FILTER_THRESHOLD && appLzRegionFilter === '');
    }
    return false;
  };
  /** #4255 (section 7.2): back one step, values kept; a region filter is cleared first. */
  const backOneStep = (): void => {
    if (phase === 'input-app-lz-region' && appLzRegionFilter) { setAppLzRegionFilter(''); return; }
    if (phase === 'input-app-credentials') setEditOnlyMode(false);
    if (phase === 'confirm-delete') setDeleteSelection([]);
    const to = appBackPhase(phase, { hasLenses: (scaffold.lenses?.length ?? 0) > 0, reuseFromHub: playwrightUrlReuseOrigin === 'hub' });
    if (to) setPhase(to);
  };
  /** #4255 (section 7.10): an entry of the credential list (were the letter keys R, A, T, U, P, M, L and 1 to 9). */
  const onCredentialSelect = (value: string): void => {
    const target: Record<string, AppPhase> = {
      [APP_CRED_VCS_URL]: 'input-app-cred-vcs-url',
      [APP_CRED_VCS_TOKEN]: 'input-app-cred-vcs-token',
      [APP_CRED_PW_URL]: 'input-app-cred-playwright-url',
      [APP_CRED_PW_USER]: 'input-app-cred-playwright-user',
      [APP_CRED_PW_PASS]: 'input-app-cred-playwright-pass',
      [APP_CRED_PW_MFA]: 'input-app-cred-playwright-mfa',
      [APP_CRED_LLM]: 'input-app-llm',
    };
    const to = target[value];
    if (to) { setPhase(to); return; }
    if (value.startsWith(CRED_API_PREFIX)) {
      const idx = apiTokenConnectors.findIndex(c => c.id === value.slice(CRED_API_PREFIX.length));
      if (idx >= 0) { setApiTokenConnectorIdx(idx); setPhase('input-app-cred-api-token'); }
      return;
    }
    if (value !== CRED_CONTINUE) return;
    if (editOnlyMode) { setEditOnlyMode(false); setPhase('input-app'); }
    else { setPhase('input-ingest-tip'); }
  };
  /** #4255 (section 4.4): the delete confirmation's Enter (was the letter key y). */
  const deleteSelectedApps = (): void => {
    try {
      if (!workspace) throw new Error('No workspace found');
      for (const id of deleteSelection) {
        rmSync(join(workspace, 'apps', id), { recursive: true, force: true });
      }
      setOpMessage(`Deleted ${deleteSelection.length} app${deleteSelection.length === 1 ? '' : 's'}: ${deleteSelection.join(', ')}`);
      setOpError('');
    } catch (e) {
      setOpError((e as Error).message);
      setOpMessage('');
    }
    setPhase('op-done');
  };

  useInput((input, key) => {
    // #4230 (Design 126 section 7.8): an open guidance box owns Esc, PgUp and
    // PgDn only; every other key keeps working with the box open.
    if (guidanceOwnsKey(key, guidanceOpenRef.current)) return;
    if (nav.dialogOpen) return; // #4255: the AbortDialog owns Enter and Esc
    // #4256: a failed run ends on FinishPanel (its menu owns Enter); Esc returns to the main menu.
    if (phase === 'done' && (key.escape || (key.return && code === 0))) onBack();
    // #4256 (Design 126 section 4.7): the assess-done finish screen is FinishPanel;
    // its menu owns Enter and the arrows (Stakeholder Challenge, Show details, View
    // the log, Back to main menu; no letter keys). Esc closes the details, else
    // aborts to the main menu.
    if (phase === 'assess-done') {
      if (finishDetails && (key.escape || key.return)) { setFinishDetails(false); return; }
      if (key.escape) onBack();
      return;
    }
    if (phase === 'input-ingest-tip' && key.return) {
      if ((scaffold.lenses?.length ?? 0) > 0) setPhase('input-lenses');
      else setPhase('input-regimes');
    }
    // #0621: in the no-frameworks empty-state there is no active MultiSelect to
    // consume Enter, so advance to the passes step here. Gated on the empty set
    // so it never competes with the picker's own Enter (onConfirm) when present.
    if (phase === 'input-regimes' && key.return && discoverRegimes().length === 0) setPhase('input-passes');
    // #4255 (Design 126 section 7.10): stats, LLM cache, source path and iteration are list
    // entries of the Run options sub-step (were the letter keys S, C, P and I).
    if (phase === 'op-done' && key.return) {
      setOpMessage(''); setOpError(''); setDeleteSelection([]); setRenameTarget('');
      setPhase('input-app');
      return;
    }
    // #4255 (Design 126 sections 7.2 and 7.4): before the run Esc aborts the flow
    // (AbortDialog once an app is chosen); the left arrow, or Shift+Tab in a text
    // input, goes back one step with the values kept. The per-phase Esc targets
    // (A-27) and the letter keys of the credential list are gone (section 7.10,
    // onCredentialSelect); the delete confirmation is a ConfirmPanel.
    if (isAppPreRunPhase(phase)) {
      if (key.escape) { nav.requestAbort(); return; }
      if ((key.tab && key.shift) || (key.leftArrow && !appTextPhase())) { backOneStep(); return; }
    }
  });

  // Single entry point shared with `swao init` (#0227): writes the
  // canonical app .swao.yml + scaffolds wsp/inputs/ (per-type subfolders
  // with samples) + wsp/inputs/source/ for the cloned code tree.
  //
  // #0386 (sprint-040): `localPath` flips the source from a clone-and-mount
  // model (git url + ref + monorepo subdir) to a point-at-existing-tree
  // model. When set, source.path in .swao.yml is the absolute local path
  // and no source.vcs block is emitted.
  const createApp = (appId: string, url: string, ref: string, subdir: string, localPath: string = '') => {
    if (!workspace) return;
    const appDir = join(workspace, 'apps', appId);
    mkdirSync(appDir, { recursive: true });

    // CodeQL #3, #4, #5: parse the URL and match the hostname exactly,
    // not by substring. Substring-includes accepts crafted hosts like
    // gitlab.com.attacker-corp.example. URL.hostname is lowercased and
    // normalised; URL constructor rejects malformed inputs (caught below).
    let vcsType: 'github' | 'gitlab' | 'azure-devops' = 'github';
    let urlHostname = '';
    try {
      urlHostname = new URL(url).hostname.toLowerCase();
    } catch {
      // Malformed URL -- keep the default vcsType and let downstream
      // validation surface a clearer error.
    }
    if (urlHostname === 'gitlab.com' || urlHostname.endsWith('.gitlab.com')) {
      vcsType = 'gitlab';
    } else if (
      urlHostname === 'dev.azure.com' ||
      urlHostname === 'visualstudio.com' ||
      urlHostname.endsWith('.visualstudio.com')
    ) {
      vcsType = 'azure-devops';
    }

    const yaml = scaffold.appYmlTemplate({
      appId,
      vcsType: url ? vcsType : undefined,
      vcsUrl: url || undefined,
      vcsRef: ref || undefined,
      vcsSubdir: subdir || undefined,
      sourcePathOverride: localPath || undefined,
      // #1042: omit regimes so no regimes_active: [all] is written;
      // regimes are set via the Regime Selector TUI after the app is created.
      assessorEmail: readWorkspacePartnershipLead(workspace),
    });
    writeFileSync(join(appDir, '.swao.yml'), yaml, 'utf-8');

    scaffold.imports(appDir);
    scaffold.ingestion(appDir);
    // Only scaffold the source/ landing area when we expect to clone into
    // it. For a local-path engagement the source lives outside the
    // workspace, so the scaffold would just litter wsp/inputs/source/.
    if (!localPath) scaffold.source(appDir);
    scaffold.landingZoneStubs(appDir);

    // #0398 (sprint-040): structured log so an operator's debug bundle
    // shows EXACTLY what they entered + what landed in .swao.yml. Single
    // line, parseable. Useful when an assessment fails later -- support
    // can see whether the operator typed a tree URL, what the splitter
    // produced, and what hand-edited yaml carried into the run.
    try {
      logApp(appId, 'info', 'tui.app.created', `App created from TUI New-App flow`, {
        context: {
          app_id: appId,
          source_mode: localPath ? 'local-path' : (url ? 'git-clone' : 'no-source'),
          vcs_url: url || null,
          vcs_ref: ref || null,
          vcs_subdir: subdir || null,
          local_path: localPath || null,
          vcs_type: url ? vcsType : null,
          yaml_path: join(appDir, '.swao.yml'),
        },
      });
    } catch { /* logging is best-effort; never block app creation */ }
  };

  // #0386: classify the operator's input at the "Source location" prompt.
  // A git URL kicks off the clone flow (branch + monorepo subdir prompts);
  // a local filesystem path skips both and writes source.path directly.
  const classifySourceInput = (raw: string): 'git-url' | 'local-path' | 'ambiguous' => {
    const v = raw.trim();
    if (!v) return 'ambiguous';
    if (/^(https?|ssh|git):\/\//i.test(v)) return 'git-url';
    if (/^git@[^:]+:/.test(v)) return 'git-url';
    // Windows drive letter, UNC, POSIX absolute, or existing dir
    if (/^[a-zA-Z]:[\\/]/.test(v)) return 'local-path';
    if (v.startsWith('\\\\')) return 'local-path';
    if (v.startsWith('/'))    return 'local-path';
    try { if (existsSync(v))  return 'local-path'; } catch { /* fall through */ }
    return 'ambiguous';
  };

  // #0391 (sprint-040): when an operator pastes a GitHub *tree-view* URL
  // (e.g. https://github.com/org/repo/tree/main/apps/health/sovereign-health)
  // we split it into the clone URL + ref + subdirectory so SWAO can clone
  // cleanly. Before this split, the whole URL was stored as the clone
  // *target path* on disk, producing `C:\...\source\https:\github.com\...`
  // -- which Windows rejects (colon in path) and `git clone` reports as
  // "could not create leading directories". Returns null when the input
  // is not a tree URL so the regular git-url path applies.
  interface SplitTreeUrl { cloneUrl: string; ref: string; subdir: string }
  const splitGithubTreeUrl = (raw: string): SplitTreeUrl | null => {
    // Bound first: a repo URL is short; capping keeps the multi-`[^/]+` match
    // constant-time on many-`/` input (CodeQL js/polynomial-redos).
    const m = raw.trim().slice(0, 2048).match(/^(https?:\/\/[^/]+\/[^/]+\/[^/]+)\/tree\/([^/]+)(?:\/(.+))?$/i);
    if (!m) return null;
    return {
      cloneUrl: (m[1] ?? '').replace(/\.git$/, '') + '.git',
      ref:      m[2] ?? 'main',
      subdir:   (m[3] ?? '').replace(/\/+$/, ''),
    };
  };

  // #0382 (sprint-040) -- was reading from `wsp/inputs/catalogs/standard/`
  // which is the legacy scope retired by ADR-0035 (sprint-039 #0358 Phase
  // 3). Now reads each community framework's `framework-meta.yaml` so the
  // list is folder-driven: deleting a folder under
  // `wsp/inputs/catalogs/community/` removes the framework from the picker.
  const discoverRegimes = (): RegimeOption[] =>
    discoverCommunityRegimes(workspace, 'app', scaffold.bundledCommunityDir);

  // #4296: the central provider name map (abbreviation plus full name).
  const lzProviderName = (id: string): string => {
    // #4349: the map label, not the catalogue hint label (a third form).
    const entry = scaffold.lzCatalogueHint?.entries.find(e => e.provider === id);
    return centralProviderLabel(id, 'pair', entry?.name);
  };

  // #1021: truncate a string to fit within the usable terminal line width.
  const truncateLabel = (s: string, reservedChars = 0): string => {
    // #4110: lines are cut at the TerminalFrame width, not the terminal width.
    const cols = (terminalFrameWidth(process.stdout.columns) ?? 80) - 2 - reservedChars;
    return s.length > cols ? s.slice(0, Math.max(0, cols - 3)) + '...' : s;
  };

  // Read the app's current regimes from .swao.yml. #0245: defaults to
  // ['all'] (the picker sentinel that expands to every available regime)
  // so first-time consultants see every regime pre-selected and Enter
  // accepts the "all regimes recommended" default without exploration.
  // #0689: filter stored IDs against currently installed frameworks so stale
  // entries (from a prior full-install) do not become phantom pre-selections.
  const readAppRegimes = (appId: string): string[] => {
    if (!workspace) return ['all'];
    const ymlPath = join(workspace, 'apps', appId, '.swao.yml');
    if (!existsSync(ymlPath)) return ['all'];
    try {
      // #0755: compliance-evaluator reads assessment.regimes_active (since #0748).
      // Fall back to top-level regimes for workspaces created before the fix.
      const yml = loadYaml(readFileSync(ymlPath, 'utf-8')) as {
        regimes?: string[];
        assessment?: { regimes_active?: string[] };
      } | null;
      const stored =
        (Array.isArray(yml?.assessment?.regimes_active) && (yml?.assessment?.regimes_active?.length ?? 0) > 0
          ? yml!.assessment!.regimes_active!
          : null) ??
        (Array.isArray(yml?.regimes) && (yml?.regimes?.length ?? 0) > 0 ? yml!.regimes! : null) ??
        ['all'];
      return filterRegimesAgainstInstalled(stored, discoverCommunityRegimes(workspace, undefined, scaffold.bundledCommunityDir).map(r => r.id));
    } catch { return ['all']; }
  };

  // #0800: read the saved pass profile from the app's .swao.yml assessment.pass_profile.
  // #0901: dynamic and malware are always opt-in -- stripped from any stored profile so
  // they are never pre-selected regardless of what was saved in a previous run.
  // #1018: normalize stored entries -- lowercase + dedup + restrict to known PASS_OPTIONS
  // values so stale uppercase entries (INV, LZR, MAL) or duplicates are silently dropped.
  const readAppPassProfile = (appId: string): string[] => {
    // #3419: TUI opt-in passes come from the orchestrator (dynamic); malware stays opt-in.
    const OPT_IN = new Set([...TUI_OPT_IN_PASS_KEYS, 'malware', 'all']);
    const VALID_KEYS = new Set(PASS_OPTIONS.map(o => o.value));
    if (!workspace) return DEFAULT_PASS_KEYS;
    const ymlPath = join(workspace, 'apps', appId, '.swao.yml');
    if (!existsSync(ymlPath)) return DEFAULT_PASS_KEYS;
    try {
      const yml = loadYaml(readFileSync(ymlPath, 'utf-8')) as {
        assessment?: { pass_profile?: string[] };
      } | null;
      const stored = yml?.assessment?.pass_profile;
      if (Array.isArray(stored) && stored.length > 0) {
        const seen = new Set<string>();
        const normalized = stored
          .map(p => (typeof p === 'string' ? p.toLowerCase() : ''))
          .filter(p => VALID_KEYS.has(p) && !OPT_IN.has(p) && !seen.has(p) && seen.add(p) !== undefined);
        return normalized.length > 0 ? normalized : DEFAULT_PASS_KEYS;
      }
    } catch { /* fall through */ }
    return DEFAULT_PASS_KEYS;
  };


  // Existing app selected -- route to the appropriate next phase based on
  // the selected assessment type (#0630/#0631).
  const handleSelectApp = (id: string) => {
    if (!id) return;
    setApp(id);
    setEditOnlyMode(false);
    // #2715: emit assess.app.select.confirmed so the operator can trace which app was picked.
    try { logApp(id, 'info', 'assess.app.select.confirmed', 'Application selected for assessment', { context: { app_id: id, assessment_type: 'application' } }); } catch { /* best-effort */ }
    // Self-heal: ensure ingestion/ exists for apps created before sprint-070.
    if (workspace) {
      try { scaffold.ingestion(join(workspace, 'apps', id)); } catch { /* best-effort */ }
    }
    setRegimes(readAppRegimes(id));
    setRegimesConfirmed(false); // #4284: run-time choices start from the app defaults
    setRunLlmProvider(null);
    // #0800: pre-load the saved pass profile so input-passes shows saved defaults.
    setBasePassProfile(readAppPassProfile(id));
    // #0814: credential hub -- both application and landing-zone types; LZ shows
    // VCS section only (no Playwright). 'input-app-credentials' uses assessmentType
    // to conditionally render the Playwright section.
    setPhase('input-app-credentials');
  };

  // #0800: E key from input-app -- open credential hub in edit-only mode
  // (no assessment started; Enter/S in hub returns to input-app).
  const handleEditApp = (id: string) => {
    if (!id) return;
    setApp(id);
    setEditOnlyMode(true);
    if (workspace) {
      try { scaffold.ingestion(join(workspace, 'apps', id)); } catch { /* best-effort */ }
    }
    setRegimes(readAppRegimes(id));
    setRegimesConfirmed(false);
    setRunLlmProvider(null);
    setBasePassProfile(readAppPassProfile(id));
    setPhase('input-app-credentials');
  };

  // New app entered in text field (no existing apps case)
  const handleNewAppId = (id: string) => {
    if (!id) return;
    setApp(id);
    setVcsUrl('');
    setVcsRef('');
    setSourcePath('');
    setIter('1');
    setPasses([]);
    // #1073/#1074: clear lens state so a new app never inherits the previous app's
    // lens selection, auto-frameworks, or pass profile.
    setSelectedLenses([]);
    setLensAutoFrameworks([]);
    lensAutoFrameworksRef.current = [];
    setBasePassProfile(DEFAULT_PASS_KEYS);
    setRegimesConfirmed(false); // #4284
    setRunLlmProvider(null);
    setPhase('input-vcs-url');
  };

  // #0833: after the passes are confirmed (and the #4284 save question answered),
  // warn before the run if dynamic_analysis is selected but Chromium is not
  // installed. Runs fresh here so re-entering the screen after install picks up
  // the new state without a restart. The bundled playwright-core can use any
  // discovered Chromium via executablePath (#0971).
  const afterPassesConfirmed = (selected: string[]): void => {
    const hasDynamic = selected.includes('dynamic') || selected.includes('all');
    const chromiumMissing = findInstalledChromium() === null;
    setPhase(hasDynamic && chromiumMissing ? 'playwright-warn' : 'input-app-lz-provider');
  };

  // #4284: the app file holds a passes.malware block already (kept on save).
  const appHasMalwareBlock = (appId: string): boolean => {
    if (!workspace) return false;
    try {
      const yml = loadYaml(readFileSync(join(workspace, 'apps', appId, '.swao.yml'), 'utf-8')) as { passes?: { malware?: unknown } } | null;
      return Boolean(yml?.passes?.malware);
    } catch { return false; }
  };

  // #0379: was hardcoded 9 here but the actual ALL_PASSES contract is 12
  // (inv,state,data,ctx,sbom,tf,egr,crypto,synth,comp,blocks,scope). The 9
  // mismatch was the demo-visible "100 percent mid-Pass-11" bug; now the
  // denominator tracks the count actually being run.
  // #0692: malware is opt-in -- not in ALL_PASSES -- so exclude it from the
  // denominator when individual passes are selected.
  // #3419: malware supersedes the default secret scan (same Pass 14), so
  // "All passes" + malware keeps the count; a manual selection with both
  // counts Pass 14 once.
  const totalPasses = passes.includes('all')
    ? ALL_PASS_COUNT + (passes.includes('malware') && !ALL_PASSES.split(',').includes('secrets') ? 1 : 0)
    : passes.filter(p => p !== 'all' && !(p === 'secrets' && passes.includes('malware'))).length;
  // #4256: the run view (RunPanel) computes the stage percentage from the
  // passes done and the sub-progress of the current pass (run-view.ts).

  // ---- render phases ----

  // #2371: input-app phase delegates to shared AppPickerPhase component.
  if (phase === 'input-app') {
    return (
      <AppPickerPhase
        workspace={workspace}
        assessmentType={assessmentType}
        typeLabel={typeLabel}
        onSelect={handleSelectApp}
        onNew={() => setPhase('input-app-new')}
        onNewApp={handleNewAppId}
        onDelete={() => setPhase('pick-delete')}
        onRename={() => setPhase('pick-rename')}
        onEditCredentials={handleEditApp}
        onBack={nav.requestAbort}
        {...frame}
      />
    );
  }

  if (phase === 'input-app-new') {
    return (
      <FlowFrame {...frame} title={"New Application"} keys={K_CONFIRM_BACK} guidance={{ title: "New application ID", what: "Folder-safe identifier for this app in the engagement (e.g. my-app).", details: [{ label: 'Format', value: 'Lowercase letters, digits, hyphens' }] }}>
        <Text>Workspace: <Text bold>{workspace ?? '(none)'}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-app-new"
            label="New application ID (e.g. my-app)"
            placeholder="my-app"
            onSubmit={handleNewAppId}
            active
          />
        </Box>
      </FlowFrame>
    );
  }

  // #0732: optional target LZ step for app assessments. #4255 (Design 126 section 7.4): Esc aborts;
  // confirming with no provider selected goes on without an LZ fit.
  if (phase === 'input-app-lz-provider') {
    const hint = scaffold.lzCatalogueHint;
    // #4349: provider rows from the central name map (#4296), not the catalogue hint label.
    const providerOptions = hint?.entries.map(e => ({ label: providerColumns(e.provider, e.name), value: e.provider, guidance: lzProviderRowGuidance(e, e.provider) })) ?? [];
    const longNotice = linkedAppCatalogueNotice(workspace, app);
    const providerKeys = providerOptions.length > 0 ? TARGET_LZ_PROVIDER_KEYS : TARGET_LZ_MANUAL_REGION_KEYS;
    return (
      <FlowFrame {...frame} title={TARGET_LZ_TITLE} keys={providerKeys} guidance={{ title: "Target Landing Zone", what: "Optional: select one or more CSPs and regions to run catalogue fits during this assessment. Each combination produces a readiness block in the HTML publication. Enter goes on to the regions; Skip this step (or Enter with no provider selected) goes on without an LZ fit, so nothing is assessed against the catalogue.", details: longNotice ? [{ label: 'LZ source', value: longNotice }] : undefined, ...pickGuidance }}>
        <Text>App: <Text {...tone('accent')}>{app}</Text></Text>
        {/* #3980, #4244: the CLI warning of a linked app (assessed against the static catalogue on every tier).
            #4349: one short LZ source line and the hint in an indented Box; the full notice goes to the guidance. */}
        <TargetLzNotice notice={linkedAppCatalogueShortNotice(workspace, app)} hint={TARGET_LZ_PROVIDER_HINT} />
        <Box marginTop={1}>
          {providerOptions.length > 0 ? (
            <MultiSelect
              label="Cloud provider(s)"
              visibleCount={PICKER_VISIBLE_COUNT}
              // #4255 (Design 126 section 7.7): "Skip this step" is the last entry, an action, not a toggle.
              // #4481: the market scan entry toggles --lz-market-scan (off by default).
              options={[...providerOptions, targetLzMarketScanOption(appLzMarketScan), TARGET_LZ_SKIP_OPTION]}
              onAction={(v) => {
                if (v === TARGET_LZ_MARKET_SCAN) { setAppLzMarketScan(on => !on); return; }
                if (v === TARGET_LZ_SKIP) beginRun();
              }}
              showKeyHints={false}
              onCursorChange={onPickCursor}
              allowEmptyConfirm
              // #4285: pre-select the providers of the set-up targets; #3378 Part B: else
              // this app's last run; #3980: else the providers seeded from the linked landing zone.
              initialSelected={(() => {
                const offered = (ps: string[]): string[] => [...new Set(ps)].filter(p => providerOptions.some(o => o.value === p));
                const setup = offered(setupLz.targets.map(t => t.split(':')[0]!));
                if (setup.length > 0) return setup;
                const last = offered(readLastRunAppLzTargets(workspace, app).map(t => t.split(':')[0]!));
                return last.length > 0 ? last : offered(lzLinkSeed?.providers ?? []);
              })()}
              onConfirm={(selected) => {
                if (selected.length === 0) { beginRun(); return; }
                setAppLzCatProviders(selected);
                setAppLzRegionFilter('');
                setPhase('input-app-lz-region');
              }}
            />
          ) : (
            <TextInput
              key="input-app-lz-provider"
              label="Cloud provider (aws, azure, stackit, ...)"
              placeholder="aws"
              onSubmit={(raw) => {
                const v = raw.trim();
                if (!v) { beginRun(); return; }
                setAppLzCatProviders([v]);
                setAppLzRegionFilter('');
                setPhase('input-app-lz-region');
              }}
              active
            />
          )}
        </Box>
      </FlowFrame>
    );
  }

  // #4285 (#4289 AC2): a provider selected without any region is named before the run.
  if (phase === 'input-app-lz-gap') {
    return (
      <FlowFrame {...frame} keys={TARGET_LZ_GAP_KEYS} guidance={{ title: 'Providers without a region', what: 'A provider without a selected region is not assessed in this run. Go back to the regions to add one, or run with the targets listed.' }}>
        {/* #4255 (section 4.4): a ConfirmPanel with the step bar (was Enter or Esc on a text line). */}
        <ConfirmPanel
          title="Run without these providers?"
          subtitle={`App ${app}`}
          rows={[{ label: 'Targets', value: appLzCatTargets.join(', ') }]}
          risk={providersWithoutRegionNotice(lzProvidersWithoutRegion)}
          onConfirm={beginRun}
          active={!nav.dialogOpen}
        />
      </FlowFrame>
    );
  }

  if (phase === 'input-app-lz-region') {
    const hint = scaffold.lzCatalogueHint;
    // Build a flat list of provider:region options from ALL selected providers.
    // Regions sorted alphabetically within each provider (#1291: eu01 before eu02 in STACKIT).
    const allTargetOptions = appLzCatProviders.flatMap(pid => {
      const entry = hint?.entries.find(e => e.provider === pid);
      if (!entry) return [];
      // #3380: render the shared label; carry country for header grouping.
      return entry.regions.map(r => ({
        label: `${centralProviderLabel(pid, 'abbr')} / ${r.label ?? `${r.id} - ${r.display}`}`,
        value: `${pid}:${r.id}`,
        country: r.country,
        guidance: lzRegionRowGuidance(lzProviderName(pid), r, app),
      }));
    });
    const providerLabel = truncateLabel(appLzCatProviders.map(pid => lzProviderName(pid)).join(', '), 30 + app.length);

    if (allTargetOptions.length > FILTER_THRESHOLD && appLzRegionFilter === '') {
      return (
        <FlowFrame {...frame} title={TARGET_LZ_TITLE} keys={TARGET_LZ_FILTER_KEYS} guidance={{ title: "Filter regions", what: `${allTargetOptions.length} provider/region combinations for ${providerLabel}. Type part of the region ID or name, or leave it empty to show all.` }}>
          <Text>App: <Text {...tone('accent')}>{app}</Text>, CSP(s): <Text {...tone('accent')}>{providerLabel}</Text></Text>
          <Text {...tone('muted')}>{allTargetOptions.length} regions available. Type a substring to filter.</Text>
          <Box marginTop={1}>
            <TextInput
              key="app-lz-region-filter"
              label="Filter by provider/region ID or name (leave it empty to show all)"
              placeholder="eu, Frankfurt, aws-esc"
              onSubmit={(v) => setAppLzRegionFilter(v || SHOW_ALL)}
              active
            />
          </Box>
        </FlowFrame>
      );
    }

    const filteredTargetOptions = filterList(allTargetOptions, appLzRegionFilter, r => r.label);
    if (allTargetOptions.length > 0) {
      return (
        <FlowFrame {...frame} title={TARGET_LZ_TITLE} keys={targetLzRegionKeys(!!appLzRegionFilter && appLzRegionFilter !== SHOW_ALL)} guidance={{ title: "Target Region(s)", what: appLzRegionFilter && appLzRegionFilter !== SHOW_ALL
              ? `${filteredTargetOptions.length} of ${allTargetOptions.length} combinations match "${appLzRegionFilter}".`
              : `${allTargetOptions.length} provider/region combinations across ${appLzCatProviders.length} CSP(s). Select all targets to compare in one run.`, ...pickGuidance }}>
          <Text>App: <Text {...tone('accent')}>{app}</Text>, CSP(s): <Text {...tone('accent')}>{providerLabel}</Text></Text>
          {appLzRegionFilter && appLzRegionFilter !== SHOW_ALL && (
            <Text {...tone('muted')}>Filter: <Text {...tone('accent')}>{appLzRegionFilter}</Text>  ({filteredTargetOptions.length}/{allTargetOptions.length} regions)</Text>
          )}
          {/* #4285: the set-up targets and their geography resolution; a set-up target not offered is named. */}
          {setupLzTargetsLine(setupLz) && <Text {...tone('muted')}>{setupLzTargetsLine(setupLz)}</Text>}
          {(() => {
            const missing = setupTargetsNotOffered(setupLz, appLzCatProviders, allTargetOptions.map(o => o.value));
            return missing.length > 0 ? <Text {...tone('warning')}>Set-up target(s) not in the catalogue: {missing.join(', ')}</Text> : null;
          })()}
          <Box marginTop={1}>
            {filteredTargetOptions.length > 0 ? (
              <MultiSelect
                key={`app-lz-region-${appLzCatProviders.join('-')}-${appLzRegionFilter}`}
                label="Target region(s)"
                options={insertCountryHeaders(filteredTargetOptions)}
                initialSelected={(() => {
                  // #3378 Part B: this run's picks; #4285: else the set-up targets
                  // (geographies resolved); else the last run's targets, else the first option.
                  if (appLzCatTargets.length > 0) return appLzCatTargets;
                  const setup = setupLz.targets.filter(t => filteredTargetOptions.some(o => o.value === t));
                  if (setup.length > 0) return setup;
                  const lastRun = readLastRunAppLzTargets(workspace, app).filter(t => filteredTargetOptions.some(o => o.value === t));
                  if (lastRun.length > 0) return lastRun;
                  // #3980: the targets seeded from the linked landing zone (below Consultant).
                  const seeded = (lzLinkSeed?.targets ?? []).filter(t => filteredTargetOptions.some(o => o.value === t));
                  if (seeded.length > 0) return seeded;
                  return filteredTargetOptions[0] ? [filteredTargetOptions[0].value] : [];
                })()}
                allowEmptyConfirm
                showKeyHints={false}
                visibleCount={12}
                onCursorChange={onPickCursor}
                onConfirm={(selected) => {
                  tuiDebug(`input-app-lz-region:onConfirm selected=[${selected.join(',')}]`);
                  if (selected.length === 0) { beginRun(); return; }
                  setAppLzCatTargets(selected);
                  // #4285: a provider left without a region is named before the run.
                  const missing = providersWithoutRegion(appLzCatProviders, selected);
                  if (missing.length > 0) {
                    try { logApp(app, 'warn', 'assess.lz.provider.skipped', providersWithoutRegionNotice(missing), { context: { app_id: app, providers: missing } }); } catch { /* best-effort */ }
                    setLzProvidersWithoutRegion(missing);
                    setPhase('input-app-lz-gap');
                    return;
                  }
                  beginRun();
                }}
              />
            ) : (
              <Text {...tone('warning')}>No regions match "{appLzRegionFilter}".</Text>
            )}
          </Box>
        </FlowFrame>
      );
    }

    // No catalogue loaded for the selected providers -- fall back to manual entry.
    return (
      <FlowFrame {...frame} title={TARGET_LZ_TITLE} keys={TARGET_LZ_MANUAL_REGION_KEYS} guidance={{ title: "Target Region", what: "No region catalogue loaded for the selected provider(s). Enter the region ID manually." }}>
        <Text>App: <Text {...tone('accent')}>{app}</Text>, CSP(s): <Text {...tone('accent')}>{providerLabel}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-app-lz-region"
            label="Region ID (e.g. eu-central-1, westeurope)"
            placeholder="eu-central-1"
            onSubmit={(raw) => {
              const v = raw.trim();
              if (!v) { beginRun(); return; }
              const target = appLzCatProviders.length > 0
                ? `${appLzCatProviders[0]}:${v}`
                : v;
              setAppLzCatTargets([target]);
              beginRun();
            }}
            active
          />
        </Box>
      </FlowFrame>
    );
  }

  if (phase === 'input-vcs-url') {
    return (
      <FlowFrame {...frame} title={"New Application"} keys={K_NEXT_EMPTY_SKIPS} guidance={{ title: "Git repository URL", what: "SWAO clones the repository using git. Private repos require a stored VCS token (Tools, Credentials).", details: [
            { label: 'GitHub',       value: 'https://github.com/org/repo' },
            { label: 'Azure DevOps', value: 'https://dev.azure.com/org/project/_git/repo' },
            { label: 'GitLab',       value: 'https://gitlab.com/org/repo' },
            { label: 'SSH',          value: 'git@github.com:org/repo.git' },
            { label: 'Local path',   value: 'C:\\path\\to\\app  (absolute, skips clone)' },
          ] }}>
        <Text>App: <Text {...tone('accent')}>{app}</Text></Text>
        <Text {...tone('muted')}>Enter the git repository URL; SWAO clones it before running assessment passes. Branch and subdir follow on the next screen.</Text>
        <Box marginTop={1}>
          <TextInput
            key="input-vcs-url"
            label="Git repository URL"
            placeholder="https://github.com/org/repo"
            onSubmit={(raw) => {
              const value = raw.trim();
              setSourceInputWarning('');
              const kind = classifySourceInput(value);
              if (!value) {
                // Empty -- create the app with no source; operator wires it later
                createApp(app, '', '', '', '');
                setRegimes(['all']);
                setPhase('input-playwright-url');
                return;
              }
              if (kind === 'local-path') {
                // Absolute local path: skip clone, write source.path directly
                setVcsUrl('');
                setVcsRef('');
                setVcsSubdir('');
                createApp(app, '', '', '', value);
                setRegimes(['all']);
                setPhase('input-playwright-url');
                return;
              }
              if (kind === 'ambiguous') {
                // #0516 AC#2: relative path or unrecognised string -- reject with guidance
                setSourceInputWarning(
                  `'${value}' is not a recognised URL or absolute path.\n` +
                  `  git URL:     https://github.com/org/repo  or  git@github.com:org/repo.git\n` +
                  `  local path:  C:\\path\\to\\app  (Windows)  or  /path/to/app  (POSIX)\n` +
                  `  Enter alone to skip and configure manually later.`,
                );
                return;
              }
              // #0391: GitHub tree-view URL? Auto-split into clone URL +
              // ref + subdir so the operator never has to fight Windows'
              // refusal to create folders containing `:` and `/`.
              const split = splitGithubTreeUrl(value);
              if (split) {
                setVcsUrl(split.cloneUrl);
                setVcsRef(split.ref);
                setVcsSubdir(split.subdir);
                createApp(app, split.cloneUrl, split.ref, split.subdir, '');
                setRegimes(['all']);
                setPhase('input-playwright-url');
                return;
              }
              setVcsUrl(value);
              setPhase('input-vcs-ref');
            }}
            active
          />
        </Box>
        {sourceInputWarning ? (
          <Box marginTop={1} flexDirection="column">
            <Text {...tone('warning')}>{sourceInputWarning}</Text>
          </Box>
        ) : null}
      </FlowFrame>
    );
  }

  if (phase === 'input-vcs-ref') {
    return (
      <FlowFrame {...frame} title={"New Application"} keys={K_CONFIRM_BACK} guidance={{ title: "Branch / ref", what: "Branch, tag, or commit SHA to assess. Enter for main.", details: [{ label: 'Format', value: 'Branch name, tag, or 40-char SHA' }] }}>
        <Text>App: <Text {...tone('accent')}>{app}</Text></Text>
        <Text>URL: <Text {...tone('accent')}>{vcsUrl}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-vcs-ref"
            label="Branch / ref (Enter for main)"
            placeholder="main"
            onSubmit={(ref) => {
              setVcsRef(ref || 'main');
              setVcsSubdir('');
              setPhase('input-source-subdir');
            }}
            active
          />
        </Box>
      </FlowFrame>
    );
  }

  if (phase === 'input-source-subdir') {
    return (
      <FlowFrame {...frame} title={"New Application"} keys={K_CONFIRM_BACK} guidance={{ title: "App subdirectory", what: "For monorepos: subfolder containing this app. Enter for repo root.", details: [{ label: 'Format', value: 'Relative path, no leading slash (e.g. apps/billing)' }] }}>
        <Text>App: <Text {...tone('accent')}>{app}</Text>  Ref: <Text {...tone('accent')}>{vcsRef}</Text></Text>
        <Text {...tone('muted')}>If the repository is a monorepo, enter the path to the app inside it.</Text>
        <Text {...tone('muted')}>Example: <Text {...tone('accent')}>apps/health/sovereign-health</Text>, or Enter when the root is the app.</Text>
        <Box marginTop={1}>
          <TextInput
            key="input-source-subdir"
            label="App subdirectory within repository (Enter if repo root is the app)"
            placeholder="apps/my-app"
            onSubmit={(subdirRaw) => {
              // #0395 (sprint-040): sanitise the subdir input. Operators
              // sometimes paste a full GitHub tree URL here instead of
              // just the path-after-tree, which Windows then rejects as
              // a folder name. Strip http(s)://host/owner/repo/tree/ref/
              // prefix if present so the operator gets a working clone
              // either way.
              // Bound first: a pasted repo URL is short; capping keeps the
              // multi-`[^/]+` match constant-time (CodeQL js/polynomial-redos).
              let subdir = subdirRaw.trim().slice(0, 2048);
              const treeMatch = subdir.match(/^https?:\/\/[^/]+\/[^/]+\/[^/]+\/tree\/[^/]+\/(.+)$/i);
              if (treeMatch) subdir = (treeMatch[1] ?? '').replace(/\/+$/, '');
              // Reject any leftover URL-ish characters that would break
              // Windows directory creation.
              subdir = subdir.replace(/^[/\\]+/, '').replace(/[/\\]+$/, '');
              if (/^[a-zA-Z]+:\/\//.test(subdir) || subdir.includes(':')) {
                // Bail out -- still looks like a URL or has a colon
                setVcsSubdir('');
                createApp(app, vcsUrl, vcsRef, '', '');
              } else {
                setVcsSubdir(subdir);
                createApp(app, vcsUrl, vcsRef, subdir, '');
              }
              setRegimes(['all']);
              setPhase('input-playwright-url');
            }}
            active
          />
        </Box>
      </FlowFrame>
    );
  }

  if (phase === 'input-playwright-url') {
    return (
      <FlowFrame {...frame} title={"Playwright crawl URL"} keys={K_SAVE_EMPTY_SKIPS} guidance={{ title: "Playwright crawl URL", what: "SWAO can crawl the app web UI to capture screenshots and network traces during the dynamic analysis pass. Provide the base URL of the running app. Leave empty to skip dynamic analysis.", details: [{ label: 'Stored in', value: 'apps/' + app + '/.swao.yml  (crawl.target_url)' }] }}>
        <Text>App: <Text {...tone('accent')}>{app}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-playwright-url"
            label="Playwright crawl URL (leave it empty to skip)"
            placeholder="https://app.example.com"
            onSubmit={(raw) => {
              const target = raw.trim();
              if (!target) {
                // Empty URL -- skip all crawl sub-steps entirely (#0776-C).
                setPhase('input-app-credentials');
                return;
              }
              // #0885: check for an existing URL match in the credential store.
              setPlaywrightUrl(target);
              const freshCreds = readStoredCredentials();
              const matchSrc = Object.entries(freshCreds).find(
                ([k, v]) => k.startsWith('playwright-url-') && v === target && k !== `playwright-url-${app}`,
              );
              if (matchSrc) {
                setPlaywrightUrlMatchSourceApp(matchSrc[0].replace('playwright-url-', ''));
                setPlaywrightUrlReuseOrigin('wizard');
                setPhase('input-playwright-url-reuse');
              } else {
                // #0776-C: store URL; collect login credentials before writing.
                setPhase('input-playwright-username');
              }
            }}
            active
          />
        </Box>
      </FlowFrame>
    );
  }

  // #0885: credential reuse -- offer to copy stored creds from another app with the same URL.
  if (phase === 'input-playwright-url-reuse') {
    const reuseOptions = [
      {
        label: `Reuse credentials from app "${playwrightUrlMatchSourceApp}"`,
        value: 'reuse',
        guidance: { title: 'Reuse credentials', what: `Copies the stored crawl username and password of app "${playwrightUrlMatchSourceApp}" to ${app} in the SWAO credential store; nothing is typed again.` },
      },
      { label: 'Enter new credentials', value: 'new', guidance: { title: 'Enter new credentials', what: `Asks for the crawl username and password of ${app}; they are stored for this app only.` } },
    ];
    return (
      <FlowFrame {...frame} title={"Reuse credentials"} keys={K_SELECT_CONFIRM_BACK} guidance={{ title: "Reuse credentials", what: `The URL "${playwrightUrl}" is already configured for app "${playwrightUrlMatchSourceApp}". Reuse copies the stored username and password so you do not have to re-enter them.`, ...pickGuidance }}>
        <Text>App: <Text {...tone('accent')}>{app}</Text></Text>
        <Text {...tone('muted')}>URL <Text {...tone('accent')}>{playwrightUrl}</Text> is already stored for app <Text {...tone('accent')}>{playwrightUrlMatchSourceApp}</Text>.</Text>
        <Box marginTop={1}>
          <SelectInput
            label="Reuse stored credentials?"
            options={reuseOptions}
            visibleCount={reuseOptions.length}
            onCursorChange={onPickCursor}
            onSelect={(v) => {
              if (v === 'reuse') {
                const freshCreds = readStoredCredentials();
                const srcUser = freshCreds[`playwright-user-${playwrightUrlMatchSourceApp}`];
                const srcPass = freshCreds[`playwright-pass-${playwrightUrlMatchSourceApp}`];
                if (workspace && playwrightUrl) {
                  const appYmlPath = join(workspace, 'apps', app, '.swao.yml');
                  writeCrawlSection(appYmlPath, {});
                }
                writeCredential(`playwright-url-${app}`, playwrightUrl);
                if (srcUser) writeCredential(`playwright-user-${app}`, srcUser);
                if (srcPass) writeCredential(`playwright-pass-${app}`, srcPass);
                setPlaywrightUrl('');
                setPlaywrightUsername('');
                setPlaywrightUrlMatchSourceApp('');
                setPhase('input-app-credentials');
              } else {
                setPlaywrightUrlMatchSourceApp('');
                // #0908: hub flow uses the hub-specific username/password sub-steps.
                setPhase(playwrightUrlReuseOrigin === 'hub' ? 'input-app-cred-playwright-user' : 'input-playwright-username');
              }
            }}
          />
        </Box>
      </FlowFrame>
    );
  }

  // #0776-C: inline Playwright login sub-step 1 -- username.
  if (phase === 'input-playwright-username') {
    return (
      <FlowFrame {...frame} title={"Playwright login username"} keys={K_SAVE_EMPTY_SKIPS} guidance={{ title: "Playwright login username", what: "Optional: username for the crawl target login form. Leave empty to skip authentication.", details: [{ label: 'Stored in', value: 'apps/' + app + '/.swao.yml  (crawl.username)' }] }}>
        <Text>App: <Text {...tone('accent')}>{app}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-playwright-username"
            label="Playwright login username (leave it empty to skip)"
            placeholder="username"
            onSubmit={(raw) => {
              setPlaywrightUsername(raw.trim());
              setPhase('input-playwright-password');
            }}
            active
          />
        </Box>
      </FlowFrame>
    );
  }

  // #0776-C: inline Playwright login sub-step 2 -- password.
  // Writing all crawl fields atomically here (URL + username + password).
  if (phase === 'input-playwright-password') {
    return (
      <FlowFrame {...frame} title={"Playwright login password"} keys={K_SAVE_EMPTY_SKIPS} guidance={{ title: "Playwright login password", what: "Optional: password for the crawl target login form. Stored encrypted in the SWAO credential vault, so real credentials are safe here.", details: [{ label: 'Stored in', value: 'SWAO credential vault  (crawl-password:<hostname>)' }] }}>
        <Text>App: <Text {...tone('accent')}>{app}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-playwright-password"
            label="Playwright login password (leave it empty to skip)"
            mask="*"
            onSubmit={(raw) => {
              const password = raw.trim();
              if (workspace && playwrightUrl) {
                const appYmlPath = join(workspace, 'apps', app, '.swao.yml');
                writeCrawlSection(appYmlPath, {});
                writeCredential(`playwright-url-${app}`, playwrightUrl);
                if (playwrightUsername) {
                  writeCredential(`playwright-user-${app}`, playwrightUsername);
                }
                if (password) {
                  writeCredential(`playwright-pass-${app}`, password);
                }
              }
              setPlaywrightUrl('');
              setPlaywrightUsername('');
              setPhase('input-app-credentials');
            }}
            active
          />
        </Box>
      </FlowFrame>
    );
  }

  // #0814: credential hub -- shows stored status and shortcuts for each sub-step.
  // Landing Zone assessments show only the VCS section; Playwright section is
  // hidden because LZ assessments are static catalogue comparisons (no crawler).
  // #4255 (section 7.10): the credential list is a SelectInput; its entries replace the letter keys.
  if (phase === 'input-app-credentials') {
    const keyOf: Record<string, string> = {
      [APP_CRED_VCS_URL]: `vcs-url-${app}`,
      [APP_CRED_VCS_TOKEN]: `vcs-token-${app}`,
      [APP_CRED_PW_URL]: `playwright-url-${app}`,
      [APP_CRED_PW_USER]: `playwright-user-${app}`,
      [APP_CRED_PW_PASS]: `playwright-pass-${app}`,
      [APP_CRED_PW_MFA]: `playwright-mfa-${app}`,
    };
    const credOptions = appCredentialOptions({
      editOnly: editOnlyMode,
      stored: (v) => appCredStoredKeys.has(keyOf[v] ?? ''),
      llmDetail: runLlmProvider ?? 'workspace default',
      connectors: apiTokenConnectors,
      storedKey: (k) => appCredStoredKeys.has(k),
    });
    return (
      <FlowFrame
        {...frame}
        title="Credentials"
        subtitle={editOnlyMode ? `App ${app}, edit mode: the first entry saves and returns to the apps` : `App ${app}; every credential is optional`}
        keys={K_PICKER}
        guidance={{ entry: credEntry, maxRows: Math.max(8, terminalRows - 20) }}
      >
        <SelectInput
          key={`app-cred-${app}-${editOnlyMode ? 'edit' : 'run'}`}
          label="Credentials for this app"
          options={credOptions}
          initialIndex={0}
          visibleCount={PICKER_VISIBLE_COUNT}
          showKeyHints={false}
          onCursorChange={onCredCursor}
          onSelect={onCredentialSelect}
          active
        />
      </FlowFrame>
    );
  }

  // #0814: per-app VCS repository URL input
  if (phase === 'input-app-cred-vcs-url') {
    const credKey = `vcs-url-${app}`;
    const alreadyStored = appCredStoredKeys.has(credKey);
    return (
      <FlowFrame {...frame} title={"VCS repository URL"} keys={K_SAVE_EMPTY_SKIPS} guidance={{ title: "VCS repository URL", what: "Full HTTPS clone URL for the application source repository. Stored per-app so different apps can point to different repositories.", details: [{ label: 'Credential key', value: credKey }] }}>
        <Text>App: <Text {...tone('accent')}>{app}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-app-cred-vcs-url"
            label={alreadyStored ? 'Repository URL (leave it empty to keep the stored one)' : 'Repository URL (leave it empty to skip)'}
            placeholder="https://github.com/org/repo"
            onSubmit={(raw) => {
              const val = raw.trim();
              if (val) {
                writeCredential(credKey, val);
                // #2324: mirror into vcsUrl state so the token handler can
                // derive the correct provider-scoped credential key.
                setVcsUrl(val);
                setAppCredStoredKeys(prev => { const n = new Set(prev); n.add(credKey); return n; });
              }
              setPhase('input-app-credentials');
            }}
            active
          />
        </Box>
      </FlowFrame>
    );
  }

  // #0814: per-app VCS token input
  if (phase === 'input-app-cred-vcs-token') {
    // #2324: derive the provider-scoped key from the app's VCS URL so
    // resolveVcsToken() in assess.ts can find it.  Priority: (1) vcsUrl
    // state updated this session, (2) source.vcs.url from .swao.yml, (3)
    // generic fallback.  The old per-app key 'vcs-token-<app>' was never
    // read by the assess pipeline.
    const effectiveVcsUrl = vcsUrl || (() => {
      if (workspace && app) {
        try {
          const yml = loadYaml(readFileSync(join(workspace, 'apps', app, '.swao.yml'), 'utf-8')) as Record<string, unknown>;
          const src = yml.source as Record<string, unknown> | undefined;
          const vcs2 = src?.vcs as Record<string, unknown> | undefined;
          if (typeof vcs2?.url === 'string' && vcs2.url) return vcs2.url as string;
        } catch { /* best-effort */ }
      }
      return '';
    })();
    const credKey = effectiveVcsUrl ? deriveVcsTokenKey(effectiveVcsUrl) : 'provider:vcs:token';
    const alreadyStored = appCredStoredKeys.has(credKey);
    return (
      <FlowFrame {...frame} title={"VCS token"} keys={K_SAVE_EMPTY_SKIPS} guidance={{ title: "VCS token", what: "Personal access token or deploy token for cloning the app repository. Stored under the provider-scoped key so the assess pipeline can find it.", details: [{ label: 'Credential key', value: credKey }] }}>
        <Text>App: <Text {...tone('accent')}>{app}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-app-cred-vcs-token"
            label={alreadyStored ? 'VCS token (leave it empty to keep the stored one)' : 'VCS token (leave it empty to skip)'}
            placeholder=""
            onSubmit={(raw) => {
              const val = raw.trim();
              if (val) {
                writeCredential(credKey, val);
                setAppCredStoredKeys(prev => { const n = new Set(prev); n.add(credKey); return n; });
              }
              setPhase('input-app-credentials');
            }}
            active
          />
        </Box>
      </FlowFrame>
    );
  }

  // #0814: per-app Playwright crawl URL input (from the credential hub)
  if (phase === 'input-app-cred-playwright-url') {
    const credKey = `playwright-url-${app}`;
    const alreadyStored = appCredStoredKeys.has(credKey);
    return (
      <FlowFrame {...frame} title={"Playwright target URL"} keys={K_SAVE_EMPTY_SKIPS} guidance={{ title: "Playwright target URL", what: "URL the Playwright crawler navigates to for this app. Stored per-app in the credential store so different apps can target different URLs.", details: [{ label: 'Credential key', value: credKey }] }}>
        <Text>App: <Text {...tone('accent')}>{app}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-app-cred-playwright-url"
            label={alreadyStored ? 'Playwright target URL (leave it empty to keep the stored one)' : 'Playwright target URL (leave it empty to skip)'}
            placeholder="https://app.example.com"
            onSubmit={(raw) => {
              const val = raw.trim();
              if (val) {
                // #0908: check for an existing URL match before storing (mirrors wizard flow).
                setPlaywrightUrl(val);
                const freshCreds = readStoredCredentials();
                const matchSrc = Object.entries(freshCreds).find(
                  ([k, v]) => k.startsWith('playwright-url-') && v === val && k !== credKey,
                );
                if (matchSrc) {
                  setPlaywrightUrlMatchSourceApp(matchSrc[0].replace('playwright-url-', ''));
                  setPlaywrightUrlReuseOrigin('hub');
                  setPhase('input-playwright-url-reuse');
                  return;
                }
                writeCredential(credKey, val);
                setAppCredStoredKeys(prev => { const n = new Set(prev); n.add(credKey); return n; });
              }
              setPhase('input-app-credentials');
            }}
            active
          />
        </Box>
      </FlowFrame>
    );
  }

  // #0814: Playwright login username
  if (phase === 'input-app-cred-playwright-user') {
    const credKey = `playwright-user-${app}`;
    const alreadyStored = appCredStoredKeys.has(credKey);
    return (
      <FlowFrame {...frame} title={"Playwright login username"} keys={K_SAVE_EMPTY_SKIPS} guidance={{ title: "Playwright login username", what: "Username for form-based or basic authentication during the Playwright dynamic analysis crawl. Leave empty if the app does not require authentication.", details: [{ label: 'Credential key', value: credKey }] }}>
        <Text>App: <Text {...tone('accent')}>{app}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-app-cred-playwright-user"
            label={alreadyStored ? 'Playwright login username (leave it empty to keep the stored one)' : 'Playwright login username (leave it empty to skip)'}
            placeholder=""
            onSubmit={(raw) => {
              const val = raw.trim();
              if (val) {
                writeCredential(credKey, val);
                setAppCredStoredKeys(prev => { const n = new Set(prev); n.add(credKey); return n; });
              }
              setPhase('input-app-credentials');
            }}
            active
          />
        </Box>
      </FlowFrame>
    );
  }

  // #0814: Playwright login password
  if (phase === 'input-app-cred-playwright-pass') {
    const credKey = `playwright-pass-${app}`;
    const alreadyStored = appCredStoredKeys.has(credKey);
    return (
      <FlowFrame {...frame} title={"Playwright login password"} keys={K_SAVE_EMPTY_SKIPS} guidance={{ title: "Playwright login password", what: "Password for form-based or basic authentication during the Playwright dynamic analysis crawl. Stored encrypted in the SWAO credential store. Ctrl+E shows or hides the typed text.", details: [{ label: 'Credential key', value: credKey }] }}>
        <Text>App: <Text {...tone('accent')}>{app}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-app-cred-playwright-pass"
            label={alreadyStored ? 'Playwright login password (leave it empty to keep the stored one)' : 'Playwright login password (leave it empty to skip)'}
            placeholder=""
            mask="*"
            onSubmit={(raw) => {
              const val = raw.trim();
              if (val) {
                writeCredential(credKey, val);
                setAppCredStoredKeys(prev => { const n = new Set(prev); n.add(credKey); return n; });
              }
              setPhase('input-app-credentials');
            }}
            active
          />
        </Box>
      </FlowFrame>
    );
  }

  // #0814: Playwright MFA / TOTP seed
  if (phase === 'input-app-cred-playwright-mfa') {
    const credKey = `playwright-mfa-${app}`;
    const alreadyStored = appCredStoredKeys.has(credKey);
    return (
      <FlowFrame {...frame} title={"MFA / TOTP seed"} keys={K_SAVE_EMPTY_SKIPS} guidance={{ title: "MFA / TOTP seed", what: "Base32-encoded TOTP secret for multi-factor authentication. SWAO generates a one-time code from this seed at crawl time. Typically found in the app authenticator setup QR code.", details: [
            { label: 'Credential key', value: credKey },
            { label: 'Format', value: 'base32, 16-32 uppercase chars (e.g. JBSWY3DPEHPK3PXP)' },
          ] }}>
        <Text>App: <Text {...tone('accent')}>{app}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="input-app-cred-playwright-mfa"
            label={alreadyStored ? 'TOTP MFA seed (leave it empty to keep the stored one)' : 'TOTP MFA seed (leave it empty to skip)'}
            placeholder="JBSWY3DPEHPK3PXP"
            onSubmit={(raw) => {
              const val = raw.trim();
              if (val) {
                writeCredential(credKey, val);
                setAppCredStoredKeys(prev => { const n = new Set(prev); n.add(credKey); return n; });
              }
              setPhase('input-app-credentials');
            }}
            active
          />
        </Box>
      </FlowFrame>
    );
  }

  // #2329: per-connector API token entry
  if (phase === 'input-app-cred-api-token') {
    const connector = apiTokenConnectors[apiTokenConnectorIdx];
    const credKey = connector?.credentialKey;
    if (!connector || !credKey) {
      const infoMsg = connector?.envVar
        ? `${connector.name} uses the environment variable ${connector.envVar}; there is no stored key to enter here.`
        : 'No stored API key for this connector.';
      return (
        <FlowFrame {...frame} title="API key" keys={K_CONFIRM_BACK} guidance={{ title: 'API key', what: infoMsg }}>
          <Text {...tone('warning')}>{infoMsg}</Text>
        </FlowFrame>
      );
    }
    const alreadyStored = appCredStoredKeys.has(credKey);
    return (
      <FlowFrame {...frame} title={`${connector.name} API key`} keys={K_SAVE_EMPTY_SKIPS} guidance={{ title: `${connector.name} API key`, what: `API key for the ${connector.name} LLM gateway connector. Stored in the SWAO credential vault under key "${credKey}".`, details: [
            { label: 'Connector', value: connector.id },
            { label: 'Credential key', value: credKey },
            { label: 'Model', value: connector.defaultModel || '(not set)' },
          ], maxRows: Math.max(8, terminalRows - 20) }}>
        <Text>App: <Text {...tone('accent')}>{app}</Text></Text>
        <Box marginTop={1}>
          <PasswordInput
            label={alreadyStored ? `${connector.name} API key (leave it empty to keep the stored one)` : `${connector.name} API key (leave it empty to skip)`}
            onSubmit={(raw) => {
              const val = raw.trim();
              if (val) {
                writeCredential(credKey, val);
                setAppCredStoredKeys(prev => { const n = new Set(prev); n.add(credKey); return n; });
              }
              setPhase('input-app-credentials');
            }}
            active
          />
        </Box>
      </FlowFrame>
    );
  }

  // #0800: per-app LLM provider override
  if (phase === 'input-app-llm') {
    const currentAppLlm = readAppLlmConfig(workspace, app);
    const currentLabel = formatLlmCurrentLabel(currentAppLlm.type, currentAppLlm.model, wsLlmConfig.type);
    return (
      <FlowFrame {...frame} ownGuidance>
        <LlmModelPicker
          app={app}
          currentLabel={currentLabel}
          onSelect={(v) => {
            // #4284: the choice applies to this run (--llm-provider); saving it as
            // the app default is a separate question that starts on No.
            setRunLlmProvider(v);
            setAppSaveError(null);
            const stored = currentAppLlm.type ?? 'workspace-default';
            setPhase(workspace && v !== stored ? 'input-app-llm-save' : 'input-app-credentials');
          }}
          onGuidanceOpenChange={onGuidanceOpenChange}
        />
      </FlowFrame>
    );
  }

  if (phase === 'pick-delete') {
    const existingApps: string[] = workspace && existsSync(join(workspace, 'apps'))
      ? readdirSync(join(workspace, 'apps'), { withFileTypes: true })
          .filter(d => d.isDirectory()).map(d => d.name)
      : [];
    return (
      <FlowFrame {...frame} title="Delete an app" subtitle={`Workspace ${workspace ?? ''}`} keys={K_TOGGLE_CONFIRM_BACK} guidance={{ title: 'Delete an app', what: 'Select one or more apps to delete. SWAO asks once more before it removes the folders; confirming with nothing selected returns to the app list.', ...pickGuidance }}>
        <Box marginTop={1}>
          <MultiSelect
            label="Apps"
            options={existingApps.map(a => ({ label: a, value: a, guidance: { title: a, what: `Marks apps/${a}/ for deletion: the folder with its runs, reports and exports. SWAO asks once more before it removes it.` } }))}
            initialSelected={[]}
            visibleCount={PICKER_VISIBLE_COUNT}
            showKeyHints={false}
            onCursorChange={onPickCursor}
            onConfirm={(selected) => {
              if (selected.length === 0) { setPhase('input-app'); return; }
              setDeleteSelection(selected);
              setPhase('confirm-delete');
            }}
            active
          />
        </Box>
      </FlowFrame>
    );
  }

  if (phase === 'confirm-delete') {
    return (
      <FlowFrame {...frame} keys={CONFIRM_PANEL_KEYS} guidance={{ title: 'Delete app', what: 'Permanently removes the app directory and all WSP runs, reports, and exports inside it.', details: [
            { label: 'Vault credentials', value: 'Vault keys (playwright-url, playwright-pass, playwright-user, playwright-mfa, provider:*:token) are NOT removed. Remove them separately in Tools, Credentials.' },
          ] }}>
        {/* #4255 (section 4.4, A-27): a ConfirmPanel; Enter deletes, the left arrow goes back, Esc aborts (were y, n and Escape). */}
        <ConfirmPanel
          title={`Delete ${deleteSelection.length === 1 ? 'this app' : `these ${deleteSelection.length} apps`} permanently?`}
          rows={deleteSelection.map(id => ({ label: 'App', value: `apps/${id}/` }))}
          risk="Removes all WSP runs, exports and the source code of the app. Stored credentials stay."
          onConfirm={deleteSelectedApps}
          active={!nav.dialogOpen}
        />
      </FlowFrame>
    );
  }

  if (phase === 'pick-rename') {
    const existingApps: string[] = workspace && existsSync(join(workspace, 'apps'))
      ? readdirSync(join(workspace, 'apps'), { withFileTypes: true })
          .filter(d => d.isDirectory()).map(d => d.name)
      : [];
    return (
      <FlowFrame {...frame} title="Rename an app" subtitle={`Workspace ${workspace ?? ''}`} keys={K_PICKER} guidance={{ title: 'Rename an app', what: 'Pick the app to rename; its folder and its runs keep their content.', ...pickGuidance }}>
        <SelectInput
          label="App to rename"
          options={existingApps.map(a => ({ label: a, value: a, guidance: { title: a, what: `Renames apps/${a}/; the next step asks for the new id. The folder and its runs keep their content.` } }))}
          visibleCount={PICKER_VISIBLE_COUNT}
          filter={existingApps.length > 9}
          itemNoun="apps"
          showKeyHints={false}
          onCursorChange={onPickCursor}
          onSelect={(v) => { setRenameTarget(v); setPhase('input-rename'); }}
          active
        />
      </FlowFrame>
    );
  }

  if (phase === 'input-rename') {
    return (
      <FlowFrame {...frame} title="Rename an app" subtitle={`Renaming ${renameTarget}`} keys={K_CONFIRM_BACK} guidance={{ title: 'New application id', what: 'Lowercase letters, digits and hyphens, starting with a letter. An empty entry or the same id leaves the app as it is.' }}>
        <Text {...tone('muted')}>New id must be lowercase, alphanumeric, hyphen-separated.</Text>
        <Box marginTop={1}>
          <TextInput
            key="input-rename"
            label="New application id"
            placeholder={renameTarget}
            onSubmit={(newId) => {
              if (!newId || newId === renameTarget) { setPhase('input-app'); return; }
              if (!/^[a-z][a-z0-9-]*$/.test(newId)) {
                setOpError(`Invalid id "${newId}". Use lowercase letters, digits, and hyphens; must start with a letter.`);
                setOpMessage('');
                setPhase('op-done');
                return;
              }
              try {
                if (!workspace) throw new Error('No workspace found');
                const oldDir = join(workspace, 'apps', renameTarget);
                const newDir = join(workspace, 'apps', newId);
                if (!existsSync(oldDir)) throw new Error(`Source directory does not exist: apps/${renameTarget}/`);
                if (existsSync(newDir))  throw new Error(`Target id already exists: apps/${newId}/`);
                renameSync(oldDir, newDir);
                const ymlPath = join(newDir, '.swao.yml');
                if (existsSync(ymlPath)) {
                  // #4283 (b): top-level app_id / id and a mirrored name, through the central writer.
                  const renamed = renameAppYmlText(readFileSync(ymlPath, 'utf-8'), renameTarget, newId);
                  if (!renamed.ok) throw new Error(`apps/${newId}/.swao.yml not updated: ${renamed.error}`);
                  if (renamed.changed) writeFileSync(ymlPath, renamed.text, 'utf-8');
                }
                setOpMessage(`Renamed apps/${renameTarget}/ to apps/${newId}/`);
                setOpError('');
              } catch (e) {
                setOpError((e as Error).message);
                setOpMessage('');
              }
              setPhase('op-done');
            }}
            active
          />
        </Box>
      </FlowFrame>
    );
  }

  if (phase === 'op-done') {
    const opWasDelete = opMessage.startsWith('Deleted');
    return (
      <FlowFrame {...frame} title={opWasDelete ? 'Delete complete' : 'Operation complete'} keys={OP_DONE_KEYS} guidance={{ title: opWasDelete ? 'Delete complete' : 'Operation complete', what: opWasDelete
            ? 'App directory and all WSP runs removed. Vault credentials for this app were not cleared; remove them in Tools, Credentials.'
            : opError ? 'Operation failed. Check the error above and try again.' : 'Operation completed successfully.' }}>
        {opMessage && <Text {...tone('ok')}>{opMessage}</Text>}
        {opError   && <Text {...tone('error')}>Error: {opError}</Text>}
      </FlowFrame>
    );
  }

  // #1020: ingestion folder tip -- shown once before lens/regime selection.
  if (phase === 'input-ingest-tip') {
    const ingestPath = workspace
      ? `${workspace}${workspace.endsWith('/') || workspace.endsWith('\\') ? '' : '/'}apps/${app ?? '<app>'}/wsp/inputs/`
      : `wsp/inputs/`;
    const truncIngest = truncateLabel(ingestPath, 0);
    return (
      <FlowFrame {...frame} title="Inputs" subtitle="The ingestion folder of this app" keys={K_NEXT_BACK} guidance={{ title: 'Ingestion folder', what: 'Files dropped into the ingestion folder before the run are read by Pass 00 (INGEST) and used in the analysis.' }}>
        <Text>App: <Text {...tone('accent')}>{app}</Text></Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Before starting the assessment, you can drop files into the ingestion folder.</Text>
          <Text>Pass 00 (INGEST) will pick them up and incorporate them into the analysis.</Text>
        </Box>
        <Box marginTop={1} borderStyle="round" borderColor={tokenColor('border')} paddingX={1} flexDirection="column" width={guidanceWidth}>
          <Text><Text bold>Ingestion folder:</Text></Text>
          <Text {...tone('accent')}>{truncIngest}</Text>
          <Text {...tone('muted')}>Supported: .pdf, .docx, .txt, .md, .yaml, .json, .csv, screenshots</Text>
        </Box>
      </FlowFrame>
    );
  }

  // #0985 Design 074 Step 3: lens selection.
  if (phase === 'input-lenses') {
    const lenses = scaffold.lenses ?? [];
    const activeLenses = selectedLenses.length > 0
      ? selectedLenses
      : (workspace ? (scaffold.readWorkspaceLenses?.(workspace) ?? []) : []);
    const focusedLens = lenses.find(l => l.id === lensCursor) ?? lenses[0];
    return (
      <FlowFrame {...frame} title="Assessment Lenses" keys={K_TOGGLE_CONFIRM_BACK} guidance={focusedLens ? { title: `Lens: ${focusedLens.id}`, what: focusedLens.description ?? 'No description available for this lens.', details: [
                { label: 'Passes', value: focusedLens.passes.length > 0 ? focusedLens.passes.join(', ') : '(none)' },
                { label: 'Auto-frameworks', value: focusedLens.auto_frameworks.length > 0 ? focusedLens.auto_frameworks.join(', ') : '(none)' },
              ] } : { title: 'Assessment Lenses', what: 'Lenses pre-configure the pass set and auto-select compliance frameworks.' }}>
        <Text>App: <Text {...tone('accent')}>{app}</Text></Text>
        <Box marginTop={1} flexDirection="column">
          <Text {...tone('muted')}>Lenses pre-configure the pass set and auto-select compliance frameworks.</Text>
          <Text {...tone('muted')}>Select lenses matching your assessment goal, or skip with Enter for defaults.</Text>
        </Box>
        <Box marginTop={1}>
          <MultiSelect
            label="Select lenses"
            visibleCount={PICKER_VISIBLE_COUNT}
            showKeyHints={false}
            options={lenses.map(l => {
              if (l.auto_frameworks.length > 0) {
                // #1019: show DEMO suffix when only demo variant is installed
                const installedRegimeIds = new Set((workspace ? discoverRegimes() : []).map(r => r.id.toLowerCase()));
                const resolvedFw = l.auto_frameworks.map(fw => {
                  if (installedRegimeIds.has(fw.toLowerCase())) return fw;
                  if (installedRegimeIds.has((fw + '_DEMO').toLowerCase())) return fw + '_DEMO';
                  return fw;
                });
                return { label: `${l.id}  (auto: ${resolvedFw.join(', ')})`, value: l.id };
              }
              return {
                label: `${l.id}${l.passes.length > 0 ? `  (${l.passes.length} passes)` : ''}`,
                value: l.id,
              };
            })}
            initialSelected={activeLenses}
            onCursorChange={(v) => setLensCursor(v)}
            onConfirm={(chosen) => {
              // #4283: the lens choice applies to this run; the workspace
              // .swao.yml is written only after a yes to the save question.
              setSelectedLenses(chosen);
              // #0987: pre-populate frameworks from lens auto-selection
              const confirmed = lenses.filter(l => chosen.includes(l.id));
              // #1059: resolve each auto_framework to the installed variant (GDPR -> GDPR_DEMO
              // when only the demo is present) so the regime selector can find and pre-select it.
              const installedIds = new Set((workspace ? discoverRegimes() : []).map(r => r.id.toLowerCase()));
              const autoFw = Array.from(new Set(confirmed.flatMap(l =>
                l.auto_frameworks.map(fw => {
                  if (installedIds.has(fw.toLowerCase())) return fw;
                  if (installedIds.has((fw + '_DEMO').toLowerCase())) return fw + '_DEMO';
                  return fw;
                })
              )));
              lensAutoFrameworksRef.current = autoFw;   // #1068: sync ref before phase transition
              setLensAutoFrameworks(autoFw);
              // #0986: merge lens passes into pass profile
              // #1054: normalise to lowercase so Set dedup works when prev has lowercase entries.
              const lensPasses = Array.from(new Set(confirmed.flatMap(l => l.passes.map(p => p.toLowerCase()))));
              // #1074: when a lens prescribes specific passes, REPLACE the profile with
              // exactly those passes so the picker shows only the lens-intended selection.
              // Previously, the guard `prev.includes('all') ? prev` silently discarded
              // lens passes when the default 'all' profile was active.
              // #4499 (supersedes the replace rule of #1074): a lens ADDS its passes to the
              // app's pass preselection; it never drops a pass (Pass 10 dynamic stayed out).
              setInitialPassProfile(lensPassPreselection(basePassProfileRef.current, lensPasses));
              const storedLenses = workspace ? (scaffold.readWorkspaceLenses?.(workspace) ?? []) : [];
              setLensSaveError(null);
              setPhase(lensSaveQuestionNeeded(chosen, storedLenses, Boolean(workspace && scaffold.saveWorkspaceLenses))
                ? 'input-lenses-save'
                : 'input-regimes');
            }}
            active
            allowEmptyConfirm
          />
        </Box>
      </FlowFrame>
    );
  }

  // #4283: save-as-default question for the confirmed lenses (starts on No).
  if (phase === 'input-lenses-save') {
    return (
      <FlowFrame {...frame} title="Save as default" subtitle="Assessment lenses" keys={K_PICKER} guidance={{ title: 'Save the lenses as default', what: 'No: the lenses apply to this run only; .swao.yml stays unchanged. Yes: only assessment.lenses in the workspace .swao.yml changes.', ...pickGuidance }}>
        <Text>App: <Text {...tone('accent')}>{app}</Text></Text>
        <Text>Lenses for this run: <Text {...tone('ok')}>{selectedLenses.length > 0 ? selectedLenses.join(', ') : '(none, the defaults apply)'}</Text></Text>
        {lensSaveError && <Text {...tone('error')}>{lensSaveError}</Text>}
        <Box marginTop={1}>
          <SelectInput
            label="Save these lenses as the workspace default?"
            options={[...LENS_SAVE_OPTIONS]}
            initialIndex={0}
            showKeyHints={false}
            onCursorChange={onPickCursor}
            onSelect={(v) => {
              if (v === LENS_SAVE_YES && workspace && scaffold.saveWorkspaceLenses) {
                try {
                  scaffold.saveWorkspaceLenses(workspace, selectedLenses);
                } catch (err) {
                  setLensSaveError(`Not saved: ${(err as Error).message}`);
                  return;
                }
              }
              setPhase('input-regimes');
            }}
            active
          />
        </Box>
      </FlowFrame>
    );
  }

  if (phase === 'input-regimes') {
    const available = discoverRegimes();
    // Compute initialSelected: merge lens auto-frameworks into existing regime selection.
    // #0987/#1068: read from ref for synchronous access; state may not propagate yet.
    const computedInitialSelected = (() => {
      const autoFw = lensAutoFrameworksRef.current;
      if (autoFw.length === 0) return regimes;
      const installedIds = available.map(r => r.id);
      // #1019: DEMO fallback -- if exact ID not installed, check for <ID>_DEMO variant
      const validAuto = autoFw.flatMap(fw => {
        const exactMatch = installedIds.find(id => id.toLowerCase() === fw.toLowerCase());
        if (exactMatch) return [exactMatch];
        const demoMatch = installedIds.find(id => id.toLowerCase() === (fw + '_DEMO').toLowerCase());
        if (demoMatch) return [demoMatch];
        return [];
      });
      return Array.from(new Set([...regimes.filter(r => r !== 'all'), ...validAuto]));
    })();
    const pickerOptions: CommunityFrameworkOption[] = available.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      authority: r.authority,
      controlsCount: r.controlsCount,
      slug: r.slug,
      contributorName: r.contributorName,
    }));
    return (
      <FlowFrame {...frame} ownGuidance>
        <CommunityFrameworkPicker
          app={app}
          options={pickerOptions}
          initialSelected={computedInitialSelected}
          onConfirm={(chosen) => {
            // #4284: the frameworks apply to this run (--regimes); the app file
            // changes only on the save-as-default question (starts on No).
            setRegimes(chosen);
            setRegimesConfirmed(true);
            setAppSaveError(null);
            setPhase(workspace && selectionDiffers(chosen, readAppRegimes(app).filter(r => r !== 'all')) ? 'input-regimes-save' : 'input-passes');
          }}
          onGuidanceOpenChange={onGuidanceOpenChange}
        />
      </FlowFrame>
    );
  }

  // #4284: save-as-default questions of the run-time choices (start on No).
  if (phase === 'input-regimes-save' || phase === 'input-passes-save' || phase === 'input-app-llm-save') {
    const kind = phase === 'input-regimes-save' ? 'regimes' as const : phase === 'input-passes-save' ? 'passes' as const : 'llm' as const;
    const shown = kind === 'regimes' ? (regimes.length > 0 ? regimes.join(', ') : '(none)')
      : kind === 'passes' ? (passes.length > 0 ? passes.join(', ') : '(none)')
        : (runLlmProvider ?? 'workspace-default');
    const next = (): void => {
      if (kind === 'regimes') setPhase('input-passes');
      else if (kind === 'passes') afterPassesConfirmed(passes);
      else setPhase('input-app-credentials');
    };
    return (
      <FlowFrame {...frame} title="Save as default" subtitle={kind === 'regimes' ? 'Community frameworks' : kind === 'passes' ? 'Passes' : 'LLM provider'} keys={K_PICKER} guidance={{ title: 'Save as default', what: appSaveHint(kind), ...pickGuidance }}>
        <Text>App: <Text {...tone('accent')}>{app}</Text></Text>
        <Text>{kind === 'regimes' ? 'Frameworks' : kind === 'passes' ? 'Passes' : 'LLM provider'} for this run: <Text {...tone('ok')}>{shown}</Text></Text>
        {appSaveError && <Text {...tone('error')}>{appSaveError}</Text>}
        <Box marginTop={1}>
          <SelectInput
            label="Save as the new default for this app?"
            visibleCount={PICKER_VISIBLE_COUNT}
            options={appSaveOptions(kind)}
            initialIndex={0}
            showKeyHints={false}
            onCursorChange={onPickCursor}
            onSelect={(v) => {
              if (v === APP_SAVE_YES && workspace) {
                const edits = kind === 'regimes' ? appDefaultEdits({ kind, regimes })
                  : kind === 'passes' ? appDefaultEdits({ kind, passes, hasMalwareBlock: appHasMalwareBlock(app) })
                    : appDefaultEdits({ kind, provider: runLlmProvider ?? 'workspace-default' });
                const err = saveAppDefault(workspace, app, edits);
                if (err) { setAppSaveError(err); return; }
                try { logApp(app, 'info', 'assess.app.default.saved', `Saved the ${kind} of this run as the app default`, { context: { app_id: app, kind } }); } catch { /* best-effort */ }
                if (kind === 'passes') setInitialPassProfile(passes);
              }
              next();
            }}
            active
          />
        </Box>
      </FlowFrame>
    );
  }

  if (phase === 'input-passes') {
    const llmMode = detectedProvider;
    const llmColor = 'green';
    // #4255: the box follows the highlighted pass (one box per screen, section 9.1).
    const passLong = PASS_SHORT_TO_LONG[passCursor];
    const passDesc = passLong ? PASS_DESCRIPTIONS[passLong] : undefined;
    const passGuidance = passCursor === 'all' || !passDesc || !passLong
      ? {
        title: 'All passes',
        what: `Runs all ${ALL_PASS_COUNT} passes (inv through scope, including dynamic crawl). Static: ~30 s. LLM passes: 3-8 min. Malware (14) is opt-in only.`,
        details: [
          { label: 'Static',    value: 'inv, state, sbom, tf, egr, crypto, scope' },
          { label: 'Dynamic',   value: 'dynamic (Playwright crawl, requires Chromium)' },
          { label: 'LLM',       value: 'data, ctx, synth, comp, blocks' },
          { label: 'Next', value: 'Run options: the stats table, the LLM cache, a source path and an iteration number for this run' },
        ],
      }
      : { title: `${passCursor}: ${passLong.replace(/_/g, ' ')}`, what: passDesc.summary, details: passDesc.tip ? [{ label: 'Tip', value: passDesc.tip }] : [] };
    return (
      <FlowFrame {...frame} title="Passes" keys={K_PASSES} guidance={passGuidance}>
        <Box flexDirection="column" marginBottom={1}>
          <Box flexDirection="row">
            <Text>App: <Text {...tone('accent')}>{app}</Text></Text>
            <Text>{'   '}</Text>
            <Text>LLM: <Text color={llmColor}>{llmMode}</Text></Text>
          </Box>
        </Box>
        <MultiSelect
          label="Select passes to run"
          options={PASS_OPTIONS}
          initialSelected={initialPassProfile}
          allValue="all"
          showKeyHints={false}
          onCursorChange={(v) => setPassCursor(v)}
          onConfirm={(selected) => {
            setPasses(selected);
            // #4284: the passes apply to this run (--passes); the app file changes
            // only on the save-as-default question (starts on No).
            setAppSaveError(null);
            // #4255: the run options of this run come next (Continue is the first entry).
            setPhase('input-run-options');
          }}
          active
          visibleCount={passVisibleCount}
        />
      </FlowFrame>
    );
  }

  // #4255 (Design 126 sections 7.7 and 7.10): the options of this run as list
  // entries (were the letter keys S, C, P and I on the passes step). Continue
  // is the first entry, so Enter goes on as before; a toggle keeps the cursor.
  if (phase === 'input-run-options') {
    const options = appRunOptions({ showStats, useCassette, sourcePath, iter });
    return (
      <FlowFrame {...frame} title="Run options" subtitle="Options of this run only; nothing is written to .swao.yml." keys={K_PICKER} guidance={runOptionEntry}>
        <SelectInput
          label="Run options"
          options={options}
          visibleCount={options.length}
          showKeyHints={false}
          onCursorChange={onRunOptionCursor}
          onSelect={(v) => {
            if (v === RUN_OPT_STATS) { setShowStats(x => !x); return; }
            if (v === RUN_OPT_CACHE) { setUseCassette(x => !x); return; }
            if (v === RUN_OPT_SOURCE) { setPhase('input-source-path'); return; }
            if (v === RUN_OPT_ITER) { setPhase('input-iter'); return; }
            if (workspace && selectionDiffers(passes, readAppPassProfile(app))) { setPhase('input-passes-save'); return; }
            afterPassesConfirmed(passes);
          }}
          active
        />
      </FlowFrame>
    );
  }

  // #0833: playwright-warn phase -- shown when dynamic_analysis is selected
  // but Chromium is not installed. Operator can proceed or return to pass selection.
  if (phase === 'playwright-warn') {
    return (
      <FlowFrame {...frame} title={"Chromium not installed"} keys={K_SELECT_CONFIRM_BACK} guidance={{ title: "Chromium not installed", what: "Pass 10 (dynamic_analysis) crawls the application UI using a Playwright-controlled Chromium browser. It is safe to skip if you only need static analysis results.", details: [
            { label: 'Install', value: `npx playwright@${PLAYWRIGHT_VERSION} install chromium` },
            { label: 'Detect',  value: 'Health Check (the Playwright row shows the installed path)' },
          ], ...pickGuidance }}>
        <Box marginTop={1} flexDirection="column" borderStyle="single" paddingX={1} width={guidanceWidth}>
          <Text {...tone('warning')}>Pass 10 (dynamic_analysis) requires the Chromium browser, which is not installed.</Text>
          <Text {...tone('muted')}>The pass will fail mid-run because no Chromium executable was found.</Text>
          <Text {...tone('muted')}>Deselect it or install Chromium first.</Text>
        </Box>
        <Box marginTop={1}>
          <SelectInput
            label="Continue anyway?"
            visibleCount={PICKER_VISIBLE_COUNT}
            options={[
              {
                label: 'Yes, proceed with dynamic_analysis (will fail at runtime)',
                value: 'yes',
                guidance: { title: 'Proceed without Chromium', what: `Keeps Pass 10 (dynamic_analysis) selected; it fails at run time until Chromium is installed (npx playwright@${PLAYWRIGHT_VERSION} install chromium). The other passes run.` },
              },
              { label: 'No, return to pass selection', value: 'no', guidance: { title: 'Return to pass selection', what: 'Goes back to the passes to deselect dynamic_analysis, or to keep it once Chromium is installed.' } },
            ]}
            showKeyHints={false}
            onCursorChange={onPickCursor}
            onSelect={(value) => {
              if (value === 'yes') {
                setPhase('input-app-lz-provider');
              } else {
                setPhase('input-passes');
              }
            }}
            active
          />
        </Box>
      </FlowFrame>
    );
  }

  if (phase === 'input-source-path') {
    return (
      <FlowFrame {...frame} title="Source path" keys={K_CONFIRM_BACK} guidance={{ title: "Source Path Override", what: "Overrides source.path for this run only; it is not written to .swao.yml.", details: [
            { label: 'Format', value: 'Absolute path (C:/...) or workspace-relative path' },
            { label: 'Persist', value: 'Edit source.path in apps/{app}/.swao.yml to make it permanent' },
          ] }}>
        <Text>App: <Text {...tone('accent')}>{app}</Text></Text>
        <Text {...tone('muted')}>Overrides the source.path field in apps/{app}/.swao.yml for this run only.</Text>
        <Text {...tone('muted')}>Leave empty (Enter on blank) to clear the override.</Text>
        <Box marginTop={1}>
          <TextInput
            key="input-source-path"
            label="Source path (absolute or relative to workspace)"
            placeholder={sourcePath || 'C:/path/to/source'}
            onSubmit={(value) => { setSourcePath(value); setPhase('input-run-options'); }}
            active
          />
        </Box>
      </FlowFrame>
    );
  }

  if (phase === 'input-iter') {
    return (
      <FlowFrame {...frame} title="Iteration" keys={K_CONFIRM_BACK} guidance={{ title: "Iteration Number", what: "Tags the run-manifest with an iteration counter. Useful for comparing repeated runs.", details: [
            { label: 'Default', value: '1' },
            { label: 'Usage', value: 'Increment each time you re-run to track assessment evolution' },
          ] }}>
        <Text>App: <Text {...tone('accent')}>{app}</Text></Text>
        <Text {...tone('muted')}>Pins the iteration number in the run-manifest. Defaults to 1.</Text>
        <Text {...tone('muted')}>Useful for re-running the same assessment with the same iter tag.</Text>
        <Box marginTop={1}>
          <TextInput
            key="input-iter"
            label="Iteration number"
            placeholder={iter}
            onSubmit={(value) => {
              const trimmed = (value || '1').trim();
              const n = parseInt(trimmed, 10);
              setIter(Number.isFinite(n) && n > 0 ? String(n) : '1');
              setPhase('input-run-options');
            }}
            active
          />
        </Box>
      </FlowFrame>
    );
  }

  // #2328: pre-flight LLM connectivity check screen.
  // Shown between the last input step and 'running' when a gateway connector is active.
  // #2371: preflight-llm phase delegates to shared PreflightLlmPhase component.
  // #4256: in the flow frame (header, licence line, step bar on Run).
  if (phase === 'preflight-llm' && preflightConnector) {
    return (
      <PreflightLlmPhase
        connector={preflightConnector}
        apiKey={preflightApiKey}
        app={app}
        onPass={() => { setSkipLlm(false); setPhase('running'); }}
        onBack={() => setPhase('input-app-credentials')}
        onRunWithoutLlm={() => { setSkipLlm(true); setPhase('running'); }}
        frame={frame}
      />
    );
  }

  // #0407 (sprint-040 round-6): assessment-done summary screen.
  // #4256 (Design 126 section 4.7, owner 2026-11-10 10:51): FinishPanel in the
  // flow frame with the real run folder, the pass count, the block and LZ fit
  // verdicts, the degraded or skipped passes and What next; the key hints of
  // the frame directly above the guidance box.
  if (phase === 'assess-done') {
    const signalsTotal = lines.filter(isPassResultLine).length;
    const passesLabel = passes.includes('all') ? 'all' : (passes.join(', ').length > 40 ? `${passes.slice(0, 3).join(', ')} +${passes.length - 3} more` : passes.join(', '));
    // #0716: detect connectivity-degraded passes from structured warning lines.
    const degradedPasses = lines
      .filter(l => l.includes('connectivity-degraded pass='))
      .map(l => { const m = l.match(/pass=(\S+)/); return m ? m[1] : null; })
      .filter((p): p is string => p !== null);
    // #1004: detect skipped passes from structured warning lines emitted before the run.
    const skippedPassGroups: Array<{ passes: string; reason: string }> = [];
    if (lines.some(l => l.includes('Pass 10 (dynamic_analysis) skipped'))) {
      skippedPassGroups.push({ passes: 'dynamic (10)', reason: 'Playwright not installed' });
    }
    if (lines.some(l => l.includes('No LLM provider configured'))) {
      skippedPassGroups.push({ passes: 'data, ctx, synth, comp, blocks', reason: 'no LLM provider configured' });
    }
    const runFolder = readAppRunFolder(workspace, app);
    const challenge: AppChallengeOffer = !onChallenge ? 'none' : skipLlm ? 'no-llm' : !isEnterprise ? 'not-licensed' : 'offer';
    const finishInput = {
      app, typeLabel, totalPasses, passesLabel, passFiles: signalsTotal, llm: detectedProvider, skipLlm, runFolder,
      lzFit: readLzFitVerdicts(workspace, runFolder), blockVerdicts, degradedPasses, skippedPassGroups,
      detailLines: baselineDecisionLines, logAvailable: !!logFilePath, challenge,
      // #4499: the default passes this run left out.
      leftOutPasses: passesLeftOut(passes),
    };
    const view = appFinishView(finishInput);
    if (finishDetails) {
      return (
        <FlowFrame {...frame} title="Details of the run" keys={FINISH_DETAILS_KEYS} guidance={{ entry: { title: 'Details of the run', what: 'The verdict of each operational block and the policy baseline decisions of this run.' } }}>
          {Object.entries(blockVerdicts).map(([k, v]) => (
            <DetailRow key={k} label={k.charAt(0).toUpperCase() + k.slice(1)} value={v} />
          ))}
          {/* #3981: Client LZ Policy Baseline decisions (labels only). */}
          {baselineDecisionLines.map((l, i) => <Text key={`bd${i}`} wrap="wrap">{`  ${l}`}</Text>)}
        </FlowFrame>
      );
    }
    return (
      <FlowFrame {...frame} keys={FINISH_PANEL_KEYS} guidance={{ entry: appFinishGuidance(finishInput) }}>
        <FinishPanel
          title={view.title}
          level={view.level}
          rows={view.rows}
          items={view.items}
          next={view.next}
          onSelect={(v) => {
            if (v === FINISH_MAIN_MENU) { onBack(); return; }
            if (v === 'details') { setFinishDetails(true); return; }
            // #0715: the log opens in the OS default viewer (ref: the live path, #0805).
            if (v === 'log') { if (logFilePathRef.current) openWithDefaultApp(logFilePathRef.current); return; }
            // #0988 Design 074 Step 8: the challenge offer (cost, roles) before it starts.
            if (v === 'challenge') setPhase('challenge-prompt');
          }}
        />
      </FlowFrame>
    );
  }

  // #0988 Design 074 Step 8 / #2371: post-assessment challenge prompt extracted to shared phase.
  if (phase === 'challenge-prompt') {
    return (
      <ChallengePromptPhase
        app={app}
        type={assessmentType}
        isEnterprise={isEnterprise}
        onConfirm={() => { onChallenge?.(app); }}
        onBack={onBack}
        frame={frame}
        offer={challengeOfferForApp(workspace, app, assessmentType)} /* #3427 */
      />
    );
  }

  // #2335: on Community/Consultant the challenge module is absent and the LLM
  // orchestrator emits "challenge complete (0 agents)" progress lines. Replace
  // those with a plain "skipped" label so operators are not confused into
  // thinking challenge ran successfully with zero results.
  const displayLines = isEnterprise
    ? lines
    : lines.map(l =>
        /\[llm-assessment\].*challenge complete \(0 agents\)/i.test(l)
          ? l.replace(/challenge complete \(0 agents\)/i, 'challenge skipped (requires Enterprise tier)')
          : l
      );

  // #2371 / #4256 (Design 126 sections 4.6 and 7.6, A-20): the run view on
  // RunPanel in the flow frame; the stage line names the pass and the guidance
  // follows the run state. Esc asks (AbortDialog), then the run stops (child
  // tree killed by the run effect's cleanup) and the flow returns to the
  // Target LZ step, the step that started the run, with the choices kept.
  if (phase === 'running' && !done) {
    return (
      <RunningPhase
        header={flowHeader}
        steps={APP_STEPS}
        current={APP_PHASE_STEP.running}
        run={{ kind: 'application', app, passName, passSubLabel, completed: completedPasses, total: totalPasses, postStep }}
        lines={displayLines}
        onCancel={() => setPhase('input-app-lz-provider')}
        onGuidanceOpenChange={(open) => { guidanceOpenRef.current = open; }}
      />
    );
  }

  // #4256: a run that did not complete ends on FinishPanel (level fail) in the
  // flow frame: App, exit code, the failed pass, View the log; the cause and
  // the log path in the guidance box.
  const failed = failedRunView(typeLabel, app, code, !!logFilePath);
  const failedItems: FinishItem[] = failedPass
    ? [{ level: 'fail', label: `Pass ${failedPass.split('_').join(' ')}`, reason: 'failed; the guidance names the likely cause' }]
    : [];
  return (
    <FlowFrame {...frame} keys={FINISH_PANEL_KEYS} guidance={{ entry: failedRunGuidance({ typeLabel, app, code, lastLines: lines.slice(-12).join('\n'), logPath: logFilePath || null, ...(failedPass && PASS_FAIL_ADVICE[failedPass] ? { failedPassAdvice: PASS_FAIL_ADVICE[failedPass] } : {}) }) }}>
      <FinishPanel
        title={failed.title}
        level={failed.level}
        rows={failed.rows}
        items={failedItems}
        next={failed.next}
        onSelect={(v) => {
          if (v === 'log') { if (logFilePathRef.current) openWithDefaultApp(logFilePathRef.current); return; }
          onBack();
        }}
      />
    </FlowFrame>
  );
}
