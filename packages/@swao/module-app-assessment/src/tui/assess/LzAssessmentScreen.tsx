// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module -- Landing Zone screen
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #2370: extracted landing-zone assessment flow from AssessScreen.tsx (Design 098).
// Handles only the LZ assessment surface; app assessment lives in AppAssessmentScreen.tsx.

import { useState, useEffect, useMemo, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { spawn } from 'child_process';
import { appendFileSync, existsSync, readdirSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { load as loadYaml } from 'js-yaml';
import { CredentialStore, LicenseGuard, findWorkspace, logApp, resolveLzTargets, lzTargetLabel, patchSwaoYmlText, stripCommentedLzTargetsTemplate } from '@swao/core';
import { selfSpawnCommand, providerLabel as centralProviderLabel, parseLzRunMarker, parsePostStepLine, type LzRunMarker, type PostStepLine } from '@swao/core';
import { openWithDefaultApp, treeKillPid } from '@swao/core';
import { ConfirmPanel, CONFIRM_PANEL_KEYS, KEY_HINTS, PICKER_VISIBLE_COUNT, isAllowed, terminalFrameWidth, tone, useFlowNavigation, useOptionGuidance, type GuidanceEntry, type KeyHint, type LicenseStateView, type LicenseTier, type SelectOption } from '@swao/tui-kit';
import { FlowFrame } from './shared/flow-frame.js';
import { CRED_API_PREFIX, CRED_CONTINUE, CRED_LLM, CRED_VCS_TOKEN, CRED_VCS_URL, LZ_CATALOG_PHASE_STEP, LZ_CATALOG_PRE_RUN, LZ_CATALOG_STEPS, lzCatalogBackPhase, lzCredentialOptions, type LzPhase } from './lz-catalog-flow.js';
import { TextInput } from '@swao/tui-kit';
import { MultiSelect } from '@swao/tui-kit';
import { SelectInput } from '@swao/tui-kit';
import { guidanceOwnsKey, FinishPanel, FINISH_MAIN_MENU, FINISH_PANEL_KEYS, type FinishItem } from '@swao/tui-kit';
import { lzFinishGuidance, lzFinishView, type LzChallengeOffer } from './lz-finish.js';
import { failedRunGuidance, failedRunView } from './app-finish.js';
import { LzCatalogPicker, applyLzCuratedLabels } from '@swao/tui-kit';
import { LlmModelPicker, formatLlmCurrentLabel } from '@swao/tui-kit';
import { PasswordInput } from '@swao/tui-kit';
import { filterList, FILTER_THRESHOLD, SHOW_ALL } from '../list-filter.js';
import { AppPickerPhase } from './shared/AppPickerPhase.js';
import { ChallengePromptPhase, challengeOfferForApp } from './shared/ChallengePromptPhase.js';
import { RunningPhase } from './shared/RunningPhase.js';
import { PreflightLlmPhase } from './shared/PreflightLlmPhase.js';
import type { LocalConnectorInfo } from './shared/types.js';
import {
  buildChildEnv,
  listApiTokenConnectors,
  BUILTIN_API_CONNECTORS,
  buildLzProviderGuidance,
  readLastRunLzTargets,
  insertCountryHeaders,
  lzRegionRowGuidance,
  normaliseLzGateFrameworks,
  type AssessScaffold,
  type LzCatalogueHint,
} from '../assess-helpers.js';
import { listLocalConnectors as sharedListLocalConnectors } from '@swao/module-llm-providers';
import { lzTargetPrefill, lzPhaseAfterCredentials, lzTargetsForChoice, type LzTargetPrefill } from './lz-target-prefill.js';
import { deriveLzGapType, lzBlockedGapLabel, type LzGapType } from './lz-gap-type.js';
import { setupLzTargetsFor, setupLzTargetsLine, setupTargetsNotOffered, providersWithoutRegion, providersWithoutRegionNotice } from './setup-lz-targets.js';
import { APP_SAVE_YES, appDefaultEdits, appRunChoiceArgs, runAppLlmConfig, appSaveHint, appSaveOptions, saveAppDefault } from './app-run-defaults.js';

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

function readStoredCredentials(): Record<string, string> {
  try { return new CredentialStore().loadSync(); }
  catch { return {}; }
}

// #2755 / #3281: persist selected LZ targets to the app .swao.yml under
// assessment.landing_zone.targets (the key the CLI reads; the deprecated
// assessment.lz_cat_targets is removed) so `swao assess --type
// landing-zone-catalog` finds them without --lz-cat-targets.
// #4285: through the minimal-patch writer (only assessment.landing_zone.targets
// changes, the deprecated assessment.lz_cat_targets is removed; comments stay).
// For an explicit save-as-default only: no screen calls it on a run (ADR-0067).
export function persistLzCatTargets(workspace: string | null, appId: string, targets: string[]): void {
  if (!workspace || !appId || targets.length === 0) return;
  const ymlPath = join(workspace, 'apps', appId, '.swao.yml');
  if (!existsSync(ymlPath)) return;
  const unique = [...new Set(targets.map((t) => t.trim()).filter(Boolean))];
  // #4320: the commented `# landing_zone:` template of the app file goes when
  // the live key is written, so uncommenting it can never give a second key.
  try {
    const raw = readFileSync(ymlPath, 'utf-8');
    const r = patchSwaoYmlText(stripCommentedLzTargetsTemplate(raw), [
      { path: ['assessment', 'landing_zone', 'targets'], value: unique },
      { path: ['assessment', 'lz_cat_targets'], value: undefined },
    ], { adoptCommentedTemplates: true });
    if (r.ok && r.text !== raw) writeFileSync(ymlPath, r.text, 'utf-8');
  } catch { /* best-effort, as before: a refused patch leaves the file unchanged */ }
}

// #3281: the targets the CLI would use (app .swao.yml, then workspace .swao.yml;
// same resolver), as provider:region labels for pre-selection in the pickers.
export function readConfiguredLzTargets(workspace: string | null, appId: string): string[] {
  if (!workspace || !appId) return [];
  const assessmentOf = (path: string): Record<string, unknown> | undefined => {
    try {
      if (!existsSync(path)) return undefined;
      const yml = loadYaml(readFileSync(path, 'utf-8')) as Record<string, unknown> | null;
      const a = yml?.['assessment'];
      return a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>) : undefined;
    } catch { return undefined; }
  };
  return resolveLzTargets({
    appAssessment: assessmentOf(join(workspace, 'apps', appId, '.swao.yml')),
    workspaceAssessment: assessmentOf(join(workspace, '.swao.yml')),
  }).targets.map(lzTargetLabel);
}

function writeCredential(name: string, value: string): void {
  try { void new CredentialStore().set(name, value); } catch { /* best-effort */ }
}

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
    const section = raw.split('providers:')[1] ?? '';
    const typeMatch     = section.match(/type:\s+([^\s~][^\n]*)/);
    const endpointMatch = section.match(/endpoint:\s+"?([^"\n~]+)"?/);
    const modelMatch    = section.match(/model:\s+([^\s~][^\n]*)/);
    const connMatch     = section.match(/connector:\s+([^\s~][^\n]*)/);
    return {
      type:      typeMatch?.[1]?.trim(),
      endpoint:  endpointMatch?.[1]?.trim(),
      model:     modelMatch?.[1]?.trim(),
      connector: connMatch?.[1]?.trim(),
    };
  } catch { return {}; }
}

function readAppLlmConfig(workspace: string | null, appId: string): WorkspaceLlmConfig {
  if (!workspace || !appId) return {};
  try {
    const appYml = join(workspace, 'apps', appId, '.swao.yml');
    if (!existsSync(appYml)) return {};
    const raw = readFileSync(appYml, 'utf-8');
    const section = raw.split('providers:')[1] ?? '';
    const typeMatch = section.match(/type:\s+([^\s~][^\n]*)/);
    const connMatch = section.match(/connector:\s+([^\s~][^\n]*)/);
    if (!typeMatch && !connMatch) return {};
    const endpointMatch = section.match(/endpoint:\s+"?([^"\n~]+)"?/);
    const modelMatch    = section.match(/model:\s+([^\s~][^\n]*)/);
    return {
      type:      typeMatch?.[1]?.trim(),
      endpoint:  endpointMatch?.[1]?.trim(),
      model:     modelMatch?.[1]?.trim(),
      connector: connMatch?.[1]?.trim(),
    };
  } catch { return {}; }
}

// #3388 (Design 112): the private listLocalConnectors copy was removed; the one
// reader now lives in @swao/module-llm-providers (imported below) and seeds the
// workspace folder when empty (single source, D-3).
const listLocalConnectors = sharedListLocalConnectors;

// LZ-only phase set. Shared credential-hub sub-phases + running/done phases are included.
// Playwright phases are absent -- LZ is a static catalogue comparison, no crawler.
interface LzAssessmentScreenProps {
  onBack: () => void;
  version: string;
  scaffold: AssessScaffold;
  onLzChallenge?: (app: string) => void;
}

const API_TOKEN_PAGE_SIZE = 9;

/** #4256: the run folder of an LZ Catalog run, relative to the workspace, from latest-landing-zone-catalog.txt. */
export function lzRunFolder(app: string, latestPath: string): string {
  const rel = latestPath.trim().split('\\').join('/').replace(/^\.\//, '').replace(/\/+$/, '');
  return `apps/${app}/wsp/${rel}/`;
}

/** #4255 (Design 126 sections 7.4 and 7.9): key hints of the phases before the run. Esc aborts the
 *  flow; the left arrow (Shift+Tab in a text input) goes back one step with the values kept. */
const K_TEXT: readonly KeyHint[] = KEY_HINTS.textInput;
const K_PICKER: readonly KeyHint[] = KEY_HINTS.picker;
const K_SAVE_EMPTY_SKIPS: readonly KeyHint[] = [{ key: 'Enter', verb: 'save', object: '(empty skips)' }, { key: 'Shift+Tab', verb: 'back' }, { key: 'Esc', verb: 'abort' }];
const K_MULTI: readonly KeyHint[] = [{ key: '↑↓', verb: 'select' }, { key: 'Space', verb: 'toggle' }, { key: 'A', verb: 'toggle', object: 'all' }, { key: 'Enter', verb: 'next' }, { key: '←', verb: 'back' }, { key: 'Esc', verb: 'abort' }];
const K_FILTER: readonly KeyHint[] = [{ key: 'Type', verb: 'filter' }, { key: 'Enter', verb: 'next' }, { key: 'Shift+Tab', verb: 'back' }, { key: 'Esc', verb: 'abort' }];

export function LzAssessmentScreen({ onBack, version, scaffold, onLzChallenge }: LzAssessmentScreenProps): JSX.Element | null {
  const workspace = findWorkspace(process.cwd());
  const typeLabel = 'Landing Zone Catalog Assessment';

  const licenseState = useMemo<LicenseStateView>(() => {
    try { return LicenseGuard.load().state as LicenseStateView; }
    catch { return { tier: 'community', assessmentCount: 0, firstRun: '' }; }
  }, []);
  const isEnterprise = isAllowed(licenseState, 'enterprise' as LicenseTier);

  const [phase, setPhase] = useState<LzPhase>('input-app');
  // #4284: the LLM provider chosen for this run (--llm-provider); written only on save-as-default.
  const [runLlmProvider, setRunLlmProvider] = useState<string | null>(null);
  const [lzProvidersWithoutRegion, setLzProvidersWithoutRegion] = useState<string[]>([]); // #4285
  const [appSaveError, setAppSaveError] = useState<string | null>(null);
  const [app, setApp] = useState('');
  // #4198: which target list the pickers preselect (setup first; last run on request).
  const [lzPrefillChoice, setLzPrefillChoice] = useState<'setup' | 'last-run'>('setup');
  const [vcsUrl, setVcsUrl] = useState('');
  const [editOnlyMode, setEditOnlyMode] = useState(false);
  const [appLzCatProviders, setAppLzCatProviders] = useState<string[]>([]);
  // #3399: provider under the cursor, so the guidance box describes each cloud.
  const [activeLzProvider, setActiveLzProvider] = useState<string>('');
  // #3383: run the LZ assessment deterministically (adds --skip-llm) when the
  // operator chooses "run without LLM" at the preflight check.
  const [skipLlm, setSkipLlm] = useState(false);
  const [appLzCatTargets, setAppLzCatTargets] = useState<string[]>([]);
  const [appLzCatFrameworks, setAppLzCatFrameworks] = useState<string[]>([]);
  const [appLzRegionFilter, setAppLzRegionFilter] = useState<string>('');
  const [appCredStoredKeys, setAppCredStoredKeys] = useState<Set<string>>(new Set());
  const [apiTokenConnectors, setApiTokenConnectors] = useState<LocalConnectorInfo[]>([]);
  const [apiTokenConnectorIdx, setApiTokenConnectorIdx] = useState(0);
  const [apiTokenPage, setApiTokenPage] = useState(0);
  const [preflightConnector, setPreflightConnector] = useState<LocalConnectorInfo | null>(null);
  const [preflightApiKey, setPreflightApiKey] = useState<string | undefined>(undefined);
  const [lines, setLines] = useState<string[]>([]);
  const [passName, setPassName] = useState('');
  const [passSubLabel, setPassSubLabel] = useState('');
  const [completedPasses, setCompletedPasses] = useState(0);
  // #4506: the post-run step after the fits ([post] lines), shown on the Stage bar.
  const [postStep, setPostStep] = useState<PostStepLine | null>(null);
  const [subFraction, setSubFraction] = useState(0);
  const [failedPass, setFailedPass] = useState('');
  const [done, setDone] = useState(false);
  const [code, setCode] = useState<number | null>(null);
  const [lzVerdict, setLzVerdict] = useState('');
  const [lzTargetVerdicts, setLzTargetVerdicts] = useState<{ target: string; verdict: string; gaps: number }[]>([]);
  const [lzTargetGapDetails, setLzTargetGapDetails] = useState<Record<string, {
    gapType: LzGapType;
    sovereigntyStatement: string;
    assessmentMode: 'catalogue-sovereignty-only' | 'partial' | 'full';
    coverageWarning?: string;
  }>>({});
  const [logFilePath, setLogFilePath] = useState('');
  const logFilePathRef = useRef(logFilePath);
  logFilePathRef.current = logFilePath;
  // #2599: ref mirrors passName so the push closure can log tui.output events
  // with the correct current pass without a stale closure (mirrors AppAssessmentScreen).
  const passNameRef = useRef(passName);
  passNameRef.current = passName;
  const guidanceOpenRef = useRef(false);

  // #4255 (Design 126 sections 7.4 and 7.5): Esc before the run aborts the flow
  // (AbortDialog once an app is chosen). The screen reads the keys itself (its
  // phases are the steps), so the hook only provides the dialog and the decision.
  const nav = useFlowNavigation({ steps: LZ_CATALOG_STEPS, dirty: app !== '', onExit: onBack, what: 'assessment', active: false });
  const flowHeader = useMemo(() => {
    let ls: LicenseStateView | null = null;
    let le: string | null = null;
    try { ls = LicenseGuard.load().state as LicenseStateView; }
    catch (e) { le = (e as Error).message; }
    return { subtitle: typeLabel, version, licenseState: ls, licenseError: le };
  }, [version]);
  const onGuidanceOpenChange = (open: boolean): void => { guidanceOpenRef.current = open; nav.onGuidanceOpenChange(open); };
  /** The frame of a phase before the run: header, licence line, step bar, title (#4255). */
  const frame = { header: flowHeader, steps: LZ_CATALOG_STEPS, current: LZ_CATALOG_PHASE_STEP[phase], onGuidanceOpenChange, dialog: nav.dialog };
  // #4230: the credential list box follows the highlighted entry.
  // #4213 (Design 126 section 9): the entry of the highlighted option of the current picker
  // phase; every picker sets it on mount and on each move, so no phase reads a stale entry.
  const [pickEntry, setPickEntry] = useState<GuidanceEntry | undefined>(undefined);
  const onPickCursor = (_v: string, o?: { guidance?: GuidanceEntry }): void => { setPickEntry(o?.guidance); };
  const pickGuidance = pickEntry ? { entry: pickEntry } : {};
  const { entry: credEntry, onCursorChange: onCredCursor } = useOptionGuidance({ title: 'Credentials', what: 'Credentials are keyed to this app only and stored in the SWAO credential store. Every field is optional; Continue goes on.' });

  const [storedCreds] = useState(() => readStoredCredentials());
  const [wsLlmConfig] = useState(() => readWorkspaceLlmConfig(workspace));

  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? 24;
  const terminalCols = stdout?.columns ?? 80;
  const passVisibleCount = Math.max(4, terminalRows - 18);
  const guidanceWidth = Math.min(100, Math.max(63, terminalCols - 2));

  const totalPasses = appLzCatTargets.length || 1;

  // #4296: the central provider name map (abbreviation plus full name).
  const lzProviderName = (id: string): string => {
    const entry = scaffold.lzCatalogueHint?.entries.find(e => e.provider === id);
    return entry?.label ?? centralProviderLabel(id, 'pair', entry?.name);
  };

  // #4198 (Design 125 section 5.7, ADR-0067 amendment 2026-11-09): the setup
  // targets (assessment.landing_zone.targets, the same resolver as the CLI)
  // are preselected first; the last run's targets are a second choice offered
  // on the 'input-lz-target-source' phase when they differ. Without setup
  // targets the last run's targets are preselected (#3378 Part B). The screen
  // does not write the app .swao.yml.
  // #4285 (#4289): the set-up targets resolved as the CLI does (azure:germany ->
  // azure:germanywestcentral), so a geography target matches a region option.
  const setupLz = setupLzTargetsFor(workspace, app, scaffold.resolveSetupLzTargets, () => readConfiguredLzTargets(workspace, app));
  const readLzTargetPrefill = (): LzTargetPrefill =>
    lzTargetPrefill(setupLz.targets, readLastRunLzTargets(workspace, app));
  const prefillLzTargets = (): string[] => {
    return lzTargetsForChoice(readLzTargetPrefill(), lzPrefillChoice);
  };

  const truncateLabel = (s: string, reservedChars = 0): string => {
    // #4110: lines are cut at the TerminalFrame width, not the terminal width.
    const cols = (terminalFrameWidth(process.stdout.columns) ?? 80) - 2 - reservedChars;
    return s.length > cols ? s.slice(0, Math.max(0, cols - 3)) + '...' : s;
  };

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

  const handleSelectApp = (id: string) => {
    if (!id) return;
    setApp(id);
    setRunLlmProvider(null); // #4284
    setEditOnlyMode(false);
    setPhase('input-app-credentials');
  };

  const handleEditApp = (id: string) => {
    if (!id) return;
    setApp(id);
    setRunLlmProvider(null); // #4284
    setEditOnlyMode(true);
    setPhase('input-app-credentials');
  };

  // LZ assessment has no New app flow -- select existing app only.
  const handleNewAppId = (_id: string) => { /* no-op: LZ mode does not create new apps */ };

  useEffect(() => {
    tuiDebug(`lz-phase:${phase} rows=${terminalRows} cols=${terminalCols}`);
  }, [phase, terminalRows, terminalCols]);

  useEffect(() => {
    if (phase !== 'running') return;
    setCompletedPasses(0);
    // #4256 (A-20): a rerun after a cancel starts on the preparing state, never on the old pass.
    setPassName('');
    setPassSubLabel('');
    setFailedPass('');
    setSubFraction(0);
    setLines([]);
    setLzVerdict('');
    setLzTargetVerdicts([]);
    setPostStep(null);
    // #2646: lifecycle event -- assess start
    try { logApp(app, 'info', 'assess.lz.start', 'LZ assessment started', { context: { targets: appLzCatTargets, frameworks: appLzCatFrameworks } }); } catch { /* best-effort */ }

    const args = ['assess', '--type', 'landing-zone', '--app', app,
                  '--lz-cat-targets', appLzCatTargets.join(','), '--no-crawl'];
    if (appLzCatFrameworks.length > 0) {
      args.push('--lz-frameworks', appLzCatFrameworks.join(','));
    }
    if (skipLlm) args.push('--skip-llm'); // #3383: deterministic-only LZ run (no LLM narrative)
    args.push(...appRunChoiceArgs({ regimes: null, llmProvider: runLlmProvider })); // #4284

    // #4506: SWAO_PASS_MARKERS=1 opts in to the LZ markers (Stage bar, Done screen verdicts).
    const selfCmd = selfSpawnCommand(args, { env: { ...buildChildEnv(workspace, storedCreds, wsLlmConfig, runAppLlmConfig(readAppLlmConfig(workspace, app), runLlmProvider)), SWAO_PASS_MARKERS: '1' } });
    const child = spawn(selfCmd.command, selfCmd.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: selfCmd.env,
      cwd: workspace ?? undefined,
      windowsHide: true,
    });

    const allLines: string[] = [];
    let stopped = false;
    // #4506: one marker of the CLI applied to the run state (pass start and end, verdicts).
    const applyLzRunMarker = (m: LzRunMarker): void => {
      switch (m.kind) {
        case 'pass':
          setPassName(m.pass);
          setPassSubLabel(m.label);
          // #2646: lifecycle event -- pass start
          try { logApp(app, 'info', 'assess.lz.pass.start', `LZ pass started: ${m.pass}`, { context: { pass: m.pass, target: m.label } }); } catch { /* best-effort */ }
          return;
        case 'pass-done':
          setCompletedPasses(p => p + 1); setPassSubLabel('');
          // #2646: lifecycle event -- pass complete
          try { logApp(app, 'info', 'assess.lz.pass.complete', `LZ pass complete: ${m.pass}`, { context: { pass: m.pass } }); } catch { /* best-effort */ }
          return;
        case 'target-verdict':
          setLzTargetVerdicts(prev => [...prev.filter(v => v.target !== m.target), { target: m.target, verdict: m.verdict, gaps: m.gaps }]);
          return;
        case 'verdict':
          setLzVerdict(m.verdict);
          return;
      }
    };
    const DEP_WARN_FILTER = /\[DEP\d{4}\] DeprecationWarning|Use `.*--trace-deprecation/;
    let pending = false;
    const flush = () => {
      pending = false;
      setLines([...allLines]);
    };
    const push = (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      for (const raw of text.split('\n')) {
        const l = raw.replace(/\r$/, '');
        if (!l || DEP_WARN_FILTER.test(l)) continue;
        // #4506: the markers of the CLI (@swao/core lz-run-marker.ts, opted in with
        // SWAO_PASS_MARKERS=1) drive the Stage bar and the Done screen; they are not output.
        const marker = parseLzRunMarker(l);
        if (marker) {
          applyLzRunMarker(marker);
          continue;
        }
        allLines.push(l);
        // #2599: emit each output line to the NDJSON event log in real-time (parity with AppAssessmentScreen #2571)
        try { logApp(app, 'info', 'tui.output', l, { context: { pass: passNameRef.current || undefined } }); } catch { /* best-effort */ }
        // #4506: a post-run step line ("[post] Portfolio summary: 106 of 235 apps") names the step after the fits.
        const post = parsePostStepLine(l);
        if (post) setPostStep(post);
        const fracMatch = l.match(/^\[sub-fraction\] ([\d.]+)/);
        if (fracMatch) setSubFraction(parseFloat(fracMatch[1] ?? '0'));
        const logMatch = l.match(/^\[log-path\] (.+)/);
        if (logMatch) setLogFilePath(logMatch[1]?.trim() ?? '');
      }
      if (!pending) { pending = true; setImmediate(flush); }
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('error', (err) => {
      if (stopped) return;
      allLines.push(`[error] Failed to start assessment: ${err.message}`);
      setLines([...allLines]);
      setCode(1);
      setDone(true);
    });
    child.on('close', (exitCode) => {
      // #2646: lifecycle event -- assessment complete
      try { logApp(app, exitCode === 0 ? 'info' : 'warn', 'assess.lz.complete', `LZ assessment complete (exit ${exitCode})`, { context: { exit_code: exitCode } }); } catch { /* best-effort */ }
      // #4256: a cancelled run (or a screen that left) keeps its state; the cancel set the phase.
      if (stopped) return;
      flush();
      setCode(exitCode);
      setDone(true);
      if (exitCode === 0) setPhase('assess-done');
    });
    // #4256 (Design 126 section 7.6): leaving the run phase (cancel) or the screen
    // stops the child process tree (taskkill /T on Windows).
    return () => {
      stopped = true;
      if (child.pid) void treeKillPid(child.pid); else child.kill();
    };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // #0815/#0832: auto-select logic for LZ region phase.
  useEffect(() => {
    if (phase !== 'input-lz-region') return;
    // No auto-advance -- operator must confirm even single-region catalogues.
  }, [phase, appLzCatProviders, appLzCatTargets, scaffold.lzCatalogueHint]);

  // #0814: load stored credential keys + API token connectors on hub entry.
  useEffect(() => {
    if (phase !== 'input-app-credentials') return;
    const stored = readStoredCredentials();
    setAppCredStoredKeys(new Set(Object.keys(stored)));
    setApiTokenConnectors(listApiTokenConnectors(workspace ?? undefined));
    setApiTokenPage(0);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // #4256: the real run folder of the finish screen (never `<ts>`).
  const [lzRunPath, setLzRunPath] = useState<string | null>(null);
  // #2331: read lz-catalogue-fit*.yaml after assessment to classify BLOCKED gap types.
  useEffect(() => {
    if (phase !== 'assess-done' || !workspace || !app) return;
    try {
      const wspDir = join(workspace, 'apps', app, 'wsp');
      const latestFile = join(wspDir, 'latest-landing-zone-catalog.txt');
      if (!existsSync(latestFile)) return;
      const latestPath = readFileSync(latestFile, 'utf-8').trim();
      const runDir = join(wspDir, latestPath);
      if (!existsSync(runDir)) return;
      setLzRunPath(lzRunFolder(app, latestPath));
      const yamlFiles = readdirSync(runDir).filter(f => /^lz-catalogue-fit.*\.yaml$/.test(f));
      const details: Record<string, {
        gapType: LzGapType;
        sovereigntyStatement: string;
        assessmentMode: 'catalogue-sovereignty-only' | 'partial' | 'full';
        coverageWarning?: string;
      }> = {};
      for (const f of yamlFiles) {
        try {
          const parsed = loadYaml(readFileSync(join(runDir, f), 'utf-8')) as {
            region?: string; assessment_mode?: string; sovereignty_statement?: string;
            coverage_warning?: string; items?: Array<{ verdict?: string }>;
          } | null;
          if (!parsed?.region) continue;
          const items = Array.isArray(parsed.items) ? parsed.items : [];
          // #3569: shared classification incl. BLOCKED_BY_POLICY (lz-gap-type.ts)
          const gapType: LzGapType = deriveLzGapType(items);
          const rawMode = parsed.assessment_mode ?? 'full';
          const assessmentMode: 'catalogue-sovereignty-only' | 'partial' | 'full' =
            rawMode === 'catalogue-sovereignty-only' || rawMode === 'partial' ? rawMode : 'full';
          details[parsed.region] = {
            gapType,
            sovereigntyStatement: parsed.sovereignty_statement ?? '',
            assessmentMode,
            coverageWarning: parsed.coverage_warning,
          };
        } catch { /* skip unreadable files */ }
      }
      setLzTargetGapDetails(details);
    } catch { /* non-fatal */ }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  /** #4255: the region choices of the selected providers (the region step is a text filter above the threshold). */
  const regionChoiceCount = (): number => appLzCatProviders.reduce((n, pid) => n + (scaffold.lzCatalogueHint?.entries.find(e => e.provider === pid)?.regions.length ?? 0), 0);
  /** #4255 (section 7.1): in a text input the left arrow moves the text cursor; Shift+Tab goes back. */
  const lzTextPhase = (): boolean => {
    switch (phase) {
      case 'input-app-cred-vcs-url': case 'input-app-cred-vcs-token': case 'input-app-cred-api-token': return true;
      case 'input-lz-provider': return (scaffold.lzCatalogueHint?.entries.length ?? 0) === 0;
      case 'input-lz-region': { const n = regionChoiceCount(); return n === 0 || (n > FILTER_THRESHOLD && appLzRegionFilter === ''); }
      default: return false;
    }
  };
  /** #4255 (section 7.2): back one step, values kept; a region filter is cleared first. */
  const backOneStep = (): void => {
    if (phase === 'input-lz-region' && appLzRegionFilter) { setAppLzRegionFilter(''); return; }
    if (phase === 'input-app-credentials') setEditOnlyMode(false);
    const to = lzCatalogBackPhase(phase);
    if (to) setPhase(to);
  };
  /** #4255 (section 7.10): an entry of the credential list (were the letter keys R, A, L and 1 to 9). */
  const onCredentialSelect = (value: string): void => {
    if (value === CRED_VCS_URL) { setPhase('input-app-cred-vcs-url'); return; }
    if (value === CRED_VCS_TOKEN) { setPhase('input-app-cred-vcs-token'); return; }
    if (value === CRED_LLM) { setPhase('input-app-llm'); return; }
    if (value.startsWith(CRED_API_PREFIX)) {
      const idx = apiTokenConnectors.findIndex(c => c.id === value.slice(CRED_API_PREFIX.length));
      if (idx >= 0) { setApiTokenConnectorIdx(idx); setPhase('input-app-cred-api-token'); }
      return;
    }
    if (value !== CRED_CONTINUE) return;
    if (editOnlyMode) { setEditOnlyMode(false); setPhase('input-app'); return; }
    setAppLzCatProviders([]); setAppLzCatTargets([]); setAppLzCatFrameworks([]); setAppLzRegionFilter('');
    // #4198: offer the last run's targets as a second choice when they differ from the setup targets.
    setLzPrefillChoice('setup');
    setPhase(lzPhaseAfterCredentials(readLzTargetPrefill()));
  };

  useInput((input, key) => {
    // #4230 (Design 126 section 7.8): an open guidance box owns Esc, PgUp and PgDn only.
    if (guidanceOwnsKey(key, guidanceOpenRef.current)) return;
    if (nav.dialogOpen) return; // #4255: the AbortDialog owns Enter and Esc
    // #4256: a failed run ends on FinishPanel (its menu owns Enter); Esc returns to the main menu.
    if (phase === 'done' && (key.escape || (key.return && code === 0))) onBack();
    // #4256: the finish menu (FinishPanel) owns Enter and the arrows; Esc aborts to the main menu.
    if (phase === 'assess-done') { if (key.escape) onBack(); return; }
    // #4255 (Design 126 sections 7.2 and 7.4): before the run Esc aborts the flow
    // (AbortDialog once an app is chosen); the left arrow, or Shift+Tab in a text
    // input, goes back one step with the values kept. The letter keys of the
    // credential list became list entries (section 7.10, onCredentialSelect).
    if (LZ_CATALOG_PRE_RUN.has(phase)) {
      if (key.escape) { nav.requestAbort(); return; }
      if ((key.tab && key.shift) || (key.leftArrow && !lzTextPhase())) { backOneStep(); return; }
    }
  });

  // ---- render ----

  if (phase === 'input-app') {
    return (
      <AppPickerPhase
        workspace={workspace}
        assessmentType="landing-zone"
        typeLabel={typeLabel}
        onSelect={handleSelectApp}
        onNew={() => { /* LZ: no new-app flow */ }}
        onNewApp={handleNewAppId}
        onDelete={() => { /* LZ: no delete flow */ }}
        onRename={() => { /* LZ: no rename flow */ }}
        onEditCredentials={handleEditApp}
        onBack={nav.requestAbort}
        {...frame}
      />
    );
  }

  // #4255 (section 7.10): the credential list is a SelectInput; its entries replace the letter keys.
  if (phase === 'input-app-credentials') {
    const credOptions = lzCredentialOptions({ app, editOnly: editOnlyMode, stored: (k) => appCredStoredKeys.has(k), connectors: apiTokenConnectors });
    return (
      <FlowFrame
        {...frame}
        title="Credentials"
        subtitle={editOnlyMode ? `App ${app}, edit mode: the first entry saves and returns to the apps` : `App ${app}; every credential is optional`}
        keys={K_PICKER}
        guidance={{ entry: credEntry, maxRows: Math.max(8, terminalRows - 20) }}
      >
        <SelectInput
          key={`lz-cred-${app}-${editOnlyMode ? 'edit' : 'run'}`}
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

  if (phase === 'input-app-cred-vcs-url') {
    const credKey = `vcs-url-${app}`;
    const alreadyStored = appCredStoredKeys.has(credKey);
    return (
      <FlowFrame
        {...frame}
        title="Repository URL"
        subtitle={`App ${app}`}
        keys={K_SAVE_EMPTY_SKIPS}
        guidance={{ title: 'Repository URL', what: 'Full HTTPS clone URL for the application source repository.', details: [{ label: 'Credential key', value: credKey }] }}
      >
        <TextInput
          key="lz-input-app-cred-vcs-url"
          label={alreadyStored ? 'Repository URL (leave it empty to keep the stored one)' : 'Repository URL (leave it empty to skip)'}
          placeholder="https://github.com/org/repo"
          onSubmit={(raw) => {
            const val = raw.trim();
            if (val) {
              writeCredential(credKey, val);
              setVcsUrl(val);
              setAppCredStoredKeys(prev => { const n = new Set(prev); n.add(credKey); return n; });
            }
            setPhase('input-app-credentials');
          }}
          active
        />
      </FlowFrame>
    );
  }

  if (phase === 'input-app-cred-vcs-token') {
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
      <FlowFrame
        {...frame}
        title="Access token"
        subtitle={`App ${app}`}
        keys={K_SAVE_EMPTY_SKIPS}
        guidance={{ title: 'Access token', what: 'Personal access token for cloning the app repository. Stored under the provider-scoped key.', details: [{ label: 'Credential key', value: credKey }] }}
      >
        <TextInput
          key="lz-input-app-cred-vcs-token"
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
      </FlowFrame>
    );
  }

  if (phase === 'input-app-cred-api-token') {
    const connector = apiTokenConnectors[apiTokenConnectorIdx];
    const credKey = connector?.credentialKey;
    if (!connector || !credKey) {
      const infoMsg = connector?.envVar
        ? `${connector.name} uses the environment variable ${connector.envVar}; there is no stored key to enter here.`
        : 'No stored API key for this connector.';
      return (
        <FlowFrame {...frame} title="API key" subtitle={`App ${app}`} keys={K_TEXT} guidance={{ title: 'API key', what: infoMsg }}>
          <Text {...tone('warning')}>{infoMsg}</Text>
        </FlowFrame>
      );
    }
    const alreadyStored = appCredStoredKeys.has(credKey);
    return (
      <FlowFrame
        {...frame}
        title={`${connector.name} API key`}
        subtitle={`App ${app}`}
        keys={K_SAVE_EMPTY_SKIPS}
        guidance={{
          title: `${connector.name} API key`,
          what: `API key for the ${connector.name} LLM gateway connector. Stored in the SWAO credential vault.`,
          details: [{ label: 'Connector', value: connector.id }, { label: 'Credential key', value: credKey }],
          maxRows: Math.max(8, terminalRows - 20),
        }}
      >
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
      </FlowFrame>
    );
  }

  // #4284: save the LLM provider of this run as the app default (starts on No).
  if (phase === 'input-app-llm-save') {
    return (
      <FlowFrame
        {...frame}
        title="Save as default"
        subtitle={`App ${app}, LLM provider for this run: ${runLlmProvider ?? 'workspace-default'}`}
        keys={K_PICKER}
        guidance={{ title: 'Save as default', what: appSaveHint('llm'), ...pickGuidance }}
      >
        {appSaveError && <Text {...tone('error')}>{appSaveError}</Text>}
        <SelectInput
          label="Save as the new default for this app?"
          visibleCount={PICKER_VISIBLE_COUNT}
          options={appSaveOptions('llm')}
          initialIndex={0}
          showKeyHints={false}
          onCursorChange={onPickCursor}
          onSelect={(v) => {
            if (v === APP_SAVE_YES && workspace) {
              const err = saveAppDefault(workspace, app, appDefaultEdits({ kind: 'llm', provider: runLlmProvider ?? 'workspace-default' }));
              if (err) { setAppSaveError(err); return; }
            }
            setPhase('input-app-credentials');
          }}
          active
        />
      </FlowFrame>
    );
  }

  if (phase === 'input-app-llm') {
    const currentAppLlm = readAppLlmConfig(workspace, app);
    const currentLabel = formatLlmCurrentLabel(currentAppLlm.type, currentAppLlm.model, wsLlmConfig.type);
    return (
      <FlowFrame {...frame} ownGuidance>
        <LlmModelPicker
          app={app}
          currentLabel={currentLabel}
          onSelect={(v) => {
            // #4284: this run only; the app file changes on the save-as-default question.
            setRunLlmProvider(v);
            setAppSaveError(null);
            setPhase(workspace && v !== (currentAppLlm.type ?? 'workspace-default') ? 'input-app-llm-save' : 'input-app-credentials');
          }}
          onGuidanceOpenChange={onGuidanceOpenChange}
        />
      </FlowFrame>
    );
  }

  if (phase === 'input-lz-target-source') {
    const p = readLzTargetPrefill();
    const list = (targets: readonly string[]): string => truncateLabel(targets.join(', '), 34);
    return (
      <FlowFrame
        {...frame}
        title="Target regions to preselect"
        subtitle={`App ${app}`}
        keys={K_PICKER}
        guidance={{
          title: 'Target regions to preselect',
          what: 'The targets set up in .swao.yml (assessment.landing_zone.targets) are preselected. The last run of this app used other targets; pick them to preselect those instead. You can still change the selection in the next steps.',
          details: [
            { label: 'Setup', value: 'Change the default targets in the LZ Catalog setup.' },
            { label: 'Saved', value: 'The choice of this run is not written to .swao.yml.' },
          ],
          initiallyCollapsed: true,
          ...pickGuidance,
        }}
      >
        <SelectInput
          label="Target regions to preselect"
          visibleCount={PICKER_VISIBLE_COUNT}
          options={[
            {
              label: `Setup targets (default): ${list(p.preselected)}`,
              value: 'setup',
              guidance: { title: 'Setup targets', what: `Preselects the targets set up in .swao.yml (assessment.landing_zone.targets): ${p.preselected.join(', ') || 'none'}.` },
            },
            {
              label: `Last run's targets: ${list(p.alternative ?? [])}`,
              value: 'last-run',
              guidance: { title: "Last run's targets", what: `Preselects the targets of the last run of this app: ${(p.alternative ?? []).join(', ') || 'none'}. The choice is not written to .swao.yml.` },
            },
          ]}
          initialIndex={0}
          showKeyHints={false}
          onCursorChange={onPickCursor}
          onSelect={(v) => {
            setLzPrefillChoice(v === 'last-run' ? 'last-run' : 'setup');
            setPhase('input-lz-provider');
          }}
          active
        />
      </FlowFrame>
    );
  }

  if (phase === 'input-lz-provider') {
    const hint = scaffold.lzCatalogueHint;
    // #3399: `<id> - <name>` from the shared helper (host pre-computes e.label).
    const providerOptions = hint?.entries.map(e => ({ label: e.label ?? `${e.name}  (${e.provider})`, value: e.provider })) ?? [];
    const guidedProvider = activeLzProvider || providerOptions[0]?.value || '';
    const guidance = buildLzProviderGuidance(hint?.entries.find(e => e.provider === guidedProvider));
    return (
      <FlowFrame
        {...frame}
        title="Cloud providers"
        subtitle={`App ${app}; the bundled catalogue, refreshed by the LZ catalogue update`}
        keys={providerOptions.length > 0 ? K_MULTI : K_TEXT}
        guidance={{
          title: guidedProvider ? `Cloud Service Provider: ${guidedProvider}` : 'Cloud Service Provider',
          what: guidance.what,
          details: [
            ...guidance.details,
            { label: 'Edit catalogues', value: 'Place a lz-catalogues/ folder in the workspace root to override or extend the bundled provider JSON files.' },
            { label: 'aws vs aws-esc', value: `Standard aws (eu-central-1) is SOVEREIGNTY_BLOCKED under BSI_C5/Cloud Act frameworks. Select aws-esc (${centralProviderLabel('aws-esc', 'full')}) for EU-entity sovereignty evaluation.` },
          ],
        }}
      >
        {providerOptions.length > 0 ? (
          <MultiSelect
            label="Cloud provider(s)"
            visibleCount={PICKER_VISIBLE_COUNT}
            options={providerOptions}
            showKeyHints={false}
            // #4198: pre-select the providers of the setup targets (else the last run's).
            initialSelected={[...new Set(prefillLzTargets().map(t => t.split(':')[0]!))]
              .filter(p => providerOptions.some(o => o.value === p))}
            // #3399: track the highlighted provider for the guidance box.
            onCursorChange={(v) => setActiveLzProvider(v)}
            onConfirm={(selected) => {
              if (selected.length === 0) return;
              setAppLzCatProviders(selected);
              setAppLzCatFrameworks([]);
              setAppLzRegionFilter('');
              // #2716: emit assess.lz.provider.selected for Design 098 observability.
              try { logApp(app, 'info', 'assess.lz.provider.selected', 'LZ provider(s) selected', { context: { app_id: app, providers: selected } }); } catch { /* best-effort */ }
              setPhase('input-lz-frameworks');
            }}
          />
        ) : (
          <TextInput
            key="lz-input-lz-provider"
            label="Cloud provider (aws, azure, stackit, ...)"
            placeholder="aws"
            onSubmit={(raw) => {
              const v = raw.trim();
              if (!v) return;
              setAppLzCatProviders([v]);
              setAppLzCatFrameworks([]);
              setAppLzRegionFilter('');
              // #2716: emit assess.lz.provider.selected for Design 098 observability.
              try { logApp(app, 'info', 'assess.lz.provider.selected', 'LZ provider selected', { context: { app_id: app, providers: [v] } }); } catch { /* best-effort */ }
              setPhase('input-lz-frameworks');
            }}
            active
          />
        )}
      </FlowFrame>
    );
  }

  if (phase === 'input-lz-frameworks') {
    const providerLabel = truncateLabel(appLzCatProviders.map(pid => lzProviderName(pid)).join(', '), 30 + app.length);
    const discovered = scaffold.discoverLzGateFrameworks?.(workspace ?? '', app) ?? [];
    const lzFwOptions = applyLzCuratedLabels(normaliseLzGateFrameworks(discovered)); // #4501
    return (
      <FlowFrame {...frame} ownGuidance>
        <LzCatalogPicker
          app={app}
          providerLabel={providerLabel}
          options={lzFwOptions}
          visibleCount={passVisibleCount}
          onConfirm={(selected) => {
            setAppLzCatFrameworks(selected);
            // #2716: emit assess.lz.frameworks.selected for Design 098 observability.
            try { logApp(app, 'info', 'assess.lz.frameworks.selected', 'LZ compliance frameworks selected', { context: { app_id: app, frameworks: selected, count: selected.length } }); } catch { /* best-effort */ }
            setPhase('input-lz-region');
          }}
          onGuidanceOpenChange={onGuidanceOpenChange}
        />
      </FlowFrame>
    );
  }

  // #4285 (#4289 AC2): a provider selected without any region is named before the run.
  // #4255 (section 4.4): a ConfirmPanel with the step bar; Enter runs without them, the left arrow goes back.
  if (phase === 'input-lz-gap') {
    return (
      <FlowFrame
        {...frame}
        keys={CONFIRM_PANEL_KEYS}
        guidance={{ title: 'Providers without a region', what: 'A provider without a selected region is not assessed in this run. Go back to the regions to add one, or run with the targets listed.' }}
      >
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

  if (phase === 'input-lz-region') {
    const hint = scaffold.lzCatalogueHint;
    const allTargetOptions = appLzCatProviders.flatMap(pid => {
      const entry = hint?.entries.find(e => e.provider === pid);
      if (!entry) return [];
      // #3380: render the shared label; carry country so the picker can group with headers.
      return entry.regions.map(r => ({
        label: `${pid.toUpperCase()} / ${r.label ?? `${r.id} - ${r.display}`}`,
        value: `${pid}:${r.id}`,
        country: r.country,
        // #4213: the guidance box names the full target of the highlighted row.
        guidance: lzRegionRowGuidance(lzProviderName(pid), r, app),
      }));
    });
    const providerLabel = truncateLabel(appLzCatProviders.map(pid => lzProviderName(pid)).join(', '), 30 + app.length);
    const regionSubtitle = `App ${app}, CSP(s) ${providerLabel}`;

    if (allTargetOptions.length > FILTER_THRESHOLD && appLzRegionFilter === '') {
      return (
        <FlowFrame
          {...frame}
          title="Target regions"
          subtitle={regionSubtitle}
          keys={K_FILTER}
          guidance={{
            title: 'Filter regions',
            what: `${allTargetOptions.length} regions across ${appLzCatProviders.length} CSP(s). Type part of the region ID or display name, or leave it empty to show all.`,
            details: [
              { label: 'Filter by provider', value: 'Type the provider key (e.g. "stackit", "aws", "gcp") to see ALL regions for that provider.' },
              { label: 'STACKIT Germany vs Austria', value: 'eu01 (Germany, BSI_C5-certified) vs eu02 (Austria, SOVEREIGNTY_BLOCKED under BSI_C5). Type "eu01" for the German region.' },
            ],
          }}
        >
          <Text {...tone('muted')}>{allTargetOptions.length} regions available. Type a substring to filter.</Text>
          <Box marginTop={1}>
            <TextInput
              key="lz-region-filter"
              label="Filter by provider/region ID or name (leave it empty to show all)"
              placeholder="eu, Frankfurt, aws"
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
        <FlowFrame
          {...frame}
          title="Target regions"
          subtitle={regionSubtitle}
          keys={K_MULTI}
          guidance={{
            title: 'Target Regions',
            what: appLzRegionFilter && appLzRegionFilter !== SHOW_ALL
              ? `${filteredTargetOptions.length} of ${allTargetOptions.length} combinations match "${appLzRegionFilter}". The left arrow clears the filter.`
              : `${allTargetOptions.length} provider/region combinations. Select all targets to compare in one run.`,
            ...pickGuidance,
          }}
        >
          {/* #4285: the set-up targets and their geography resolution; a set-up target not offered is named. */}
          {setupLzTargetsLine(setupLz) && <Text {...tone('muted')}>{setupLzTargetsLine(setupLz)}</Text>}
          {(() => {
            const missing = setupTargetsNotOffered(setupLz, appLzCatProviders, allTargetOptions.map(o => o.value));
            return missing.length > 0 ? <Text {...tone('warning')}>Set-up target(s) not in the catalogue: {missing.join(', ')}</Text> : null;
          })()}
          {appLzRegionFilter && appLzRegionFilter !== SHOW_ALL && (
            <Text {...tone('muted')}>Filter: <Text {...tone('accent')}>{appLzRegionFilter}</Text>  ({filteredTargetOptions.length}/{allTargetOptions.length} regions)
              {appLzCatProviders.length > 1 && (
                <Text {...tone('muted')}>  [{appLzCatProviders.map(pid => {
                  const n = filteredTargetOptions.filter(o => o.value.startsWith(`${pid}:`)).length;
                  return `${pid.toUpperCase()}: ${n}`;
                }).join('  ')}]</Text>
              )}
            </Text>
          )}
          <Box marginTop={1}>
            {filteredTargetOptions.length > 0 ? (
              <MultiSelect
                key={`lz-region-${appLzCatProviders.join('-')}-${appLzRegionFilter}`}
                label="Target region(s)"
                // #3380: group the filtered regions by country with header rows.
                options={insertCountryHeaders(filteredTargetOptions)}
                // #4198: pre-select the setup targets (else the last run's).
                initialSelected={prefillLzTargets().filter(t => filteredTargetOptions.some(o => o.value === t))}
                visibleCount={12}
                showKeyHints={false}
                onCursorChange={onPickCursor}
                onConfirm={(selected) => {
                  if (selected.length === 0) return;
                  // #3378 Part B (ADR-0067): no .swao.yml write; the run record is the memory.
                  setAppLzCatTargets(selected);
                  // #2716: emit assess.lz.region.selected for Design 098 observability.
                  try { logApp(app, 'info', 'assess.lz.region.selected', 'LZ target region(s) selected', { context: { app_id: app, targets: selected, count: selected.length } }); } catch { /* best-effort */ }
                  // #4285 (#4289 AC2): a provider left without a region is named before the run.
                  const missing = providersWithoutRegion(appLzCatProviders, selected);
                  if (missing.length > 0) {
                    try { logApp(app, 'warn', 'assess.lz.provider.skipped', providersWithoutRegionNotice(missing), { context: { app_id: app, providers: missing } }); } catch { /* best-effort */ }
                    setLzProvidersWithoutRegion(missing);
                    setPhase('input-lz-gap');
                    return;
                  }
                  beginRun();
                }}
              />
            ) : (
              <Text {...tone('warning')}>No regions match "{appLzRegionFilter}". The left arrow clears the filter.</Text>
            )}
          </Box>
        </FlowFrame>
      );
    }

    // No catalogue data -- manual TextInput fallback.
    return (
      <FlowFrame
        {...frame}
        title="Target regions"
        subtitle={regionSubtitle}
        keys={K_TEXT}
        guidance={{ entry: { title: 'Landing Zone Region', what: 'No region catalogue loaded. Enter the region ID manually.', cli: 'swao lz catalogue list' } }}
      >
        <TextInput
          key="lz-input-lz-region"
          label="Region ID (e.g. eu-central-1, westeurope)"
          placeholder="eu-central-1"
          onSubmit={(raw) => {
            const v = raw.trim();
            if (!v) return;
            const target = appLzCatProviders.length > 0
              ? `${appLzCatProviders[0]}:${v}`
              : v;
            // #3378 Part B (ADR-0067): no .swao.yml write; the run record is the memory.
            setAppLzCatTargets([target]);
            beginRun();
          }}
          active
        />
      </FlowFrame>
    );
  }

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

  if (phase === 'assess-done') {
    // #4256 (Design 126 section 4.7): FinishPanel in the flow frame with the
    // verdict per target, the blocked targets with their gap type, the real run
    // folder and What next; no letter keys, no double dash.
    const finishInput = {
      app, typeLabel, targets: lzTargetVerdicts, overallVerdict: lzVerdict, gapDetails: lzTargetGapDetails,
      runFolder: lzRunPath, catalogueOnly: lines.some(l => l.includes('No app required-services found')),
      logAvailable: !!logFilePath,
      challenge: (!onLzChallenge ? 'none' : skipLlm ? 'no-llm' : !isEnterprise ? 'not-licensed' : 'offer') as LzChallengeOffer,
    };
    const view = lzFinishView(finishInput);
    return (
      <FlowFrame {...frame} keys={FINISH_PANEL_KEYS} guidance={{ entry: lzFinishGuidance(finishInput) }}>
        <FinishPanel
          title={view.title}
          level={view.level}
          rows={view.rows}
          items={view.items}
          next={view.next}
          onSelect={(v) => {
            if (v === FINISH_MAIN_MENU) { onBack(); return; }
            if (v === 'log') { if (logFilePathRef.current) openWithDefaultApp(logFilePathRef.current); return; }
            if (v === 'challenge') setPhase('challenge-prompt');
          }}
        />
      </FlowFrame>
    );
  }

  if (phase === 'challenge-prompt') {
    return (
      <ChallengePromptPhase
        app={app}
        type="landing-zone"
        isEnterprise={isEnterprise}
        onConfirm={() => { onLzChallenge?.(app); }}
        onBack={onBack}
        frame={frame}
        offer={challengeOfferForApp(workspace, app, 'landing-zone')} /* #3427 */
      />
    );
  }

  // #4256 (Design 126 sections 4.6 and 7.6, A-20): the run view on RunPanel in
  // the flow frame; the stage line names the target or pass that runs now and
  // the guidance follows the run state (never "Cloning..." once a target runs).
  // Esc asks (AbortDialog), then the child tree stops and the flow returns to
  // the Regions step, the step that started the run, with the choices kept.
  if (phase === 'running' && !done) {
    return (
      <RunningPhase
        header={flowHeader}
        steps={LZ_CATALOG_STEPS}
        current={LZ_CATALOG_PHASE_STEP.running}
        run={{ kind: 'landing-zone', app, passName, passSubLabel, completed: completedPasses, total: totalPasses, postStep }}
        lines={lines}
        onCancel={() => setPhase('input-lz-region')}
        onGuidanceOpenChange={(open) => { guidanceOpenRef.current = open; }}
      />
    );
  }

  // #4256: a run that did not complete ends on FinishPanel (level fail) in the
  // flow frame: App, exit code, the failed pass, View the log; the cause and
  // the log path in the guidance box.
  const failed = failedRunView(typeLabel, app, code, !!logFilePath);
  const failedItems: FinishItem[] = failedPass
    ? [{ level: 'fail', label: failedPass.split('_').join(' '), reason: 'failed; the guidance names the likely cause' }]
    : [];
  return (
    <FlowFrame {...frame} keys={FINISH_PANEL_KEYS} guidance={{ entry: failedRunGuidance({ typeLabel, app, code, lastLines: lines.slice(-12).join('\n'), logPath: logFilePath || null }) }}>
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
