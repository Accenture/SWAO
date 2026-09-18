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
import { appendFileSync, existsSync, readdirSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { load as loadYaml, dump as dumpYaml } from 'js-yaml';
import { CredentialStore, LicenseGuard, findWorkspace, logApp } from '@swao/core';
import { openWithDefaultApp } from '@swao/core';
import { HeaderView, isAllowed, type LicenseStateView, type LicenseTier } from '@swao/tui-kit';
import { TextInput } from '@swao/tui-kit';
import { MultiSelect } from '@swao/tui-kit';
import { GuidanceBox } from '@swao/tui-kit';
import { LzCatalogPicker, applyLzCuratedLabels } from '@swao/tui-kit';
import { LlmModelPicker, formatLlmCurrentLabel } from '@swao/tui-kit';
import { PasswordInput } from '@swao/tui-kit';
import { filterList, FILTER_THRESHOLD, SHOW_ALL } from '../list-filter.js';
import { AppPickerPhase } from './shared/AppPickerPhase.js';
import { ChallengePromptPhase } from './shared/ChallengePromptPhase.js';
import { RunningPhase } from './shared/RunningPhase.js';
import { PreflightLlmPhase } from './shared/PreflightLlmPhase.js';
import type { LocalConnectorInfo } from './shared/types.js';
import {
  buildChildEnv,
  listApiTokenConnectors,
  BUILTIN_API_CONNECTORS,
  type AssessScaffold,
  type LzCatalogueHint,
} from '../AssessScreen.js';

const BIN  = process.execPath;
const SELF = process.argv[1] as string;

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

// #2755: persist selected LZ targets to the app .swao.yml so the CLI
// `swao assess --type landing-zone-catalog` can find them without --lz-cat-targets.
function persistLzCatTargets(workspace: string | null, appId: string, targets: string[]): void {
  if (!workspace || !appId || targets.length === 0) return;
  try {
    const ymlPath = join(workspace, 'apps', appId, '.swao.yml');
    if (!existsSync(ymlPath)) return;
    const yml = loadYaml(readFileSync(ymlPath, 'utf-8')) as Record<string, unknown>;
    const assessment = (yml['assessment'] ?? {}) as Record<string, unknown>;
    assessment['lz_cat_targets'] = targets.join(',');
    yml['assessment'] = assessment;
    writeFileSync(ymlPath, dumpYaml(yml, { lineWidth: 120 }), 'utf-8');
  } catch { /* best-effort -- never block the UI */ }
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

function listLocalConnectors(workspaceRoot?: string): LocalConnectorInfo[] {
  if (!workspaceRoot) return [];
  const wsDir = join(workspaceRoot, 'wsp', 'inputs', 'llm-gateway');
  if (!existsSync(wsDir)) return [];
  const out: LocalConnectorInfo[] = [];
  const seen = new Set<string>();
  let entries: string[];
  try {
    entries = readdirSync(wsDir).filter(f => (f.endsWith('.yaml') || f.endsWith('.yml')) && !f.startsWith('_'));
  } catch { return []; }
  for (const entry of entries.sort()) {
    try {
      const raw = loadYaml(readFileSync(join(wsDir, entry), 'utf-8')) as {
        connector?: { id?: string; name?: string; base_url?: string; protocol?: string; models?: { default?: string }; auth?: { credential_key?: string; env_var?: string } };
      } | null;
      const c = raw?.connector;
      const id = c?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name: c?.name ?? id, credentialKey: c?.auth?.credential_key, envVar: c?.auth?.env_var, baseUrl: c?.base_url ?? '', protocol: c?.protocol ?? '', defaultModel: c?.models?.default ?? '' });
    } catch { /* skip */ }
  }
  return out;
}

// LZ-only phase set. Shared credential-hub sub-phases + running/done phases are included.
// Playwright phases are absent -- LZ is a static catalogue comparison, no crawler.
type LzPhase =
  | 'input-app'
  | 'input-app-credentials'
  | 'input-app-cred-vcs-url'
  | 'input-app-cred-vcs-token'
  | 'input-app-cred-api-token'
  | 'input-app-llm'
  | 'input-lz-provider'
  | 'input-lz-frameworks'
  | 'input-lz-region'
  | 'preflight-llm'
  | 'running'
  | 'assess-done'
  | 'challenge-prompt'
  | 'done';

interface LzAssessmentScreenProps {
  onBack: () => void;
  version: string;
  scaffold: AssessScaffold;
  onLzChallenge?: (app: string) => void;
}

const API_TOKEN_PAGE_SIZE = 9;

export function LzAssessmentScreen({ onBack, version, scaffold, onLzChallenge }: LzAssessmentScreenProps): JSX.Element | null {
  const workspace = findWorkspace(process.cwd());
  const typeLabel = 'Landing Zone Catalog Assessment';

  const licenseState = useMemo<LicenseStateView>(() => {
    try { return LicenseGuard.load().state as LicenseStateView; }
    catch { return { tier: 'community', assessmentCount: 0, firstRun: '' }; }
  }, []);
  const isEnterprise = isAllowed(licenseState, 'enterprise' as LicenseTier);

  const Header = useMemo(() => {
    let ls: LicenseStateView | null = null;
    let le: string | null = null;
    try { ls = LicenseGuard.load().state as LicenseStateView; }
    catch (e) { le = (e as Error).message; }
    return function Header(props: { subtitle?: string }): JSX.Element {
      return <HeaderView {...props} version={version} licenseState={ls} licenseError={le} />;
    };
  }, [version]);

  const [phase, setPhase] = useState<LzPhase>('input-app');
  const [app, setApp] = useState('');
  const [vcsUrl, setVcsUrl] = useState('');
  const [editOnlyMode, setEditOnlyMode] = useState(false);
  const [appLzCatProviders, setAppLzCatProviders] = useState<string[]>([]);
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
  const [subFraction, setSubFraction] = useState(0);
  const [failedPass, setFailedPass] = useState('');
  const [done, setDone] = useState(false);
  const [code, setCode] = useState<number | null>(null);
  const [lzVerdict, setLzVerdict] = useState('');
  const [lzTargetVerdicts, setLzTargetVerdicts] = useState<{ target: string; verdict: string; gaps: number }[]>([]);
  const [lzTargetGapDetails, setLzTargetGapDetails] = useState<Record<string, {
    gapType: 'sovereignty' | 'availability' | 'sovereignty+availability' | 'other';
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

  const [storedCreds] = useState(() => readStoredCredentials());
  const [wsLlmConfig] = useState(() => readWorkspaceLlmConfig(workspace));

  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? 24;
  const terminalCols = stdout?.columns ?? 80;
  const maxLiveLines = Math.max(3, terminalRows - 19);
  const passVisibleCount = Math.max(4, terminalRows - 18);
  const guidanceWidth = Math.min(100, Math.max(63, terminalCols - 2));

  const totalPasses = appLzCatTargets.length || 1;
  const inProgressValue = Math.min(totalPasses, completedPasses + subFraction);
  const progressValue = done ? (code === 0 ? totalPasses : inProgressValue) : inProgressValue;
  const rawDisplayProgress = (phase === 'running' && progressValue === 0) ? totalPasses * 0.1 : progressValue;
  const displayProgressValue = phase === 'running' ? Math.min(totalPasses * 0.95, rawDisplayProgress) : progressValue;

  const lzProviderName = (id: string): string =>
    scaffold.lzCatalogueHint?.entries.find(e => e.provider === id)?.name ?? id;

  const truncateLabel = (s: string, reservedChars = 0): string => {
    const cols = (process.stdout.columns ?? 80) - 2 - reservedChars;
    return s.length > cols ? s.slice(0, Math.max(0, cols - 3)) + '...' : s;
  };

  const writeAppLlmProvider = (appId: string, type: string, model?: string, endpoint?: string): void => {
    if (!workspace) return;
    const ymlPath = join(workspace, 'apps', appId, '.swao.yml');
    if (!existsSync(ymlPath)) return;
    try {
      const yml = loadYaml(readFileSync(ymlPath, 'utf-8')) as Record<string, unknown>;
      const providers = (yml['providers'] ?? {}) as Record<string, unknown>;
      const llm = (providers['llm'] ?? {}) as Record<string, unknown>;
      const primary: Record<string, unknown> = { type };
      if (model)    primary['model']    = model;
      if (endpoint) primary['endpoint'] = endpoint;
      llm['primary']    = primary;
      providers['llm']  = llm;
      yml['providers']  = providers;
      writeFileSync(ymlPath, dumpYaml(yml, { lineWidth: 120 }), 'utf-8');
    } catch { /* best-effort */ }
  };

  const clearAppLlmProvider = (appId: string): void => {
    if (!workspace) return;
    const ymlPath = join(workspace, 'apps', appId, '.swao.yml');
    if (!existsSync(ymlPath)) return;
    try {
      const yml = loadYaml(readFileSync(ymlPath, 'utf-8')) as Record<string, unknown>;
      const providers = yml['providers'] as Record<string, unknown> | undefined;
      if (!providers) return;
      delete (providers['llm'] as Record<string, unknown> | undefined)?.['primary'];
      writeFileSync(ymlPath, dumpYaml(yml, { lineWidth: 120 }), 'utf-8');
    } catch { /* best-effort */ }
  };

  const beginRun = () => {
    const appLlm = readAppLlmConfig(workspace, app);
    const connectorId = appLlm.connector ?? wsLlmConfig.connector;
    if (!connectorId) { setPhase('running'); return; }
    const connectors = listLocalConnectors(workspace ?? undefined);
    const active = connectors.find(c => c.id === connectorId);
    if (!active) { setPhase('running'); return; }
    const resolvedApiKey = active.credentialKey
      ? (storedCreds[active.credentialKey] ?? undefined)
      : (active.envVar ? process.env[active.envVar] : undefined);
    setPreflightConnector(active);
    setPreflightApiKey(resolvedApiKey);
    setPhase('preflight-llm');
  };

  const handleSelectApp = (id: string) => {
    if (!id) return;
    setApp(id);
    setEditOnlyMode(false);
    setPhase('input-app-credentials');
  };

  const handleEditApp = (id: string) => {
    if (!id) return;
    setApp(id);
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
    setSubFraction(0);
    setLines([]);
    setLzVerdict('');
    setLzTargetVerdicts([]);
    // #2646: lifecycle event -- assess start
    try { logApp(app, 'info', 'assess.lz.start', 'LZ assessment started', { context: { targets: appLzCatTargets, frameworks: appLzCatFrameworks } }); } catch { /* best-effort */ }

    const args = ['assess', '--type', 'landing-zone', '--app', app,
                  '--lz-cat-targets', appLzCatTargets.join(','), '--no-crawl'];
    if (appLzCatFrameworks.length > 0) {
      args.push('--lz-frameworks', appLzCatFrameworks.join(','));
    }

    const child = spawn(BIN, [SELF, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildChildEnv(workspace, storedCreds, wsLlmConfig, readAppLlmConfig(workspace, app)),
      cwd: workspace ?? undefined,
      windowsHide: true,
    });

    const allLines: string[] = [];
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
        allLines.push(l);
        // #2599: emit each output line to the NDJSON event log in real-time (parity with AppAssessmentScreen #2571)
        try { logApp(app, 'info', 'tui.output', l, { context: { pass: passNameRef.current || undefined } }); } catch { /* best-effort */ }
        // Parse progress tokens
        const passMatch = l.match(/^\[pass\] (\S+)(?:\s+(.+))?$/);
        if (passMatch) {
          setPassName(passMatch[1] ?? '');
          setPassSubLabel(passMatch[2] ?? '');
          // #2646: lifecycle event -- pass start
          try { logApp(app, 'info', 'assess.lz.pass.start', `LZ pass started: ${passMatch[1]}`, { context: { pass: passMatch[1] } }); } catch { /* best-effort */ }
        }
        const doneMatch = l.match(/^\[pass-done\] (\S+)/);
        if (doneMatch) {
          setCompletedPasses(p => p + 1); setPassSubLabel('');
          // #2646: lifecycle event -- pass complete
          try { logApp(app, 'info', 'assess.lz.pass.complete', `LZ pass complete: ${doneMatch[1]}`, { context: { pass: doneMatch[1] } }); } catch { /* best-effort */ }
        }
        const fracMatch = l.match(/^\[sub-fraction\] ([\d.]+)/);
        if (fracMatch) setSubFraction(parseFloat(fracMatch[1] ?? '0'));
        const verdictMatch = l.match(/^\[lz-verdict\] (\S+)/);
        if (verdictMatch) setLzVerdict(verdictMatch[1] ?? '');
        const tvMatch = l.match(/^\[lz-target-verdict\] target=(\S+) verdict=(\S+) gaps=(\d+)/);
        if (tvMatch) {
          setLzTargetVerdicts(prev => [...prev, {
            target: tvMatch[1] ?? '',
            verdict: tvMatch[2] ?? '',
            gaps: parseInt(tvMatch[3] ?? '0', 10),
          }]);
        }
        const logMatch = l.match(/^\[log-path\] (.+)/);
        if (logMatch) setLogFilePath(logMatch[1]?.trim() ?? '');
      }
      if (!pending) { pending = true; setImmediate(flush); }
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('error', (err) => {
      allLines.push(`[error] Failed to start assessment: ${err.message}`);
      setLines([...allLines]);
      setCode(1);
      setDone(true);
    });
    child.on('close', (exitCode) => {
      flush();
      setCode(exitCode);
      setDone(true);
      // #2646: lifecycle event -- assessment complete
      try { logApp(app, exitCode === 0 ? 'info' : 'warn', 'assess.lz.complete', `LZ assessment complete (exit ${exitCode})`, { context: { exit_code: exitCode } }); } catch { /* best-effort */ }
      if (exitCode === 0) setPhase('assess-done');
    });
    return () => { child.kill(); };
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
      const yamlFiles = readdirSync(runDir).filter(f => /^lz-catalogue-fit.*\.yaml$/.test(f));
      const details: Record<string, {
        gapType: 'sovereignty' | 'availability' | 'sovereignty+availability' | 'other';
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
          const hasSov   = items.some(i => i.verdict === 'SOVEREIGNTY_GAP');
          const hasAvail = items.some(i => i.verdict === 'NOT_AVAILABLE_IN_REGION');
          const gapType: 'sovereignty' | 'availability' | 'sovereignty+availability' | 'other' =
            hasSov && hasAvail ? 'sovereignty+availability'
            : hasSov ? 'sovereignty' : hasAvail ? 'availability' : 'other';
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

  useInput((input, key) => {
    if (guidanceOpenRef.current && !(input === 'c' || input === 'C' || input === 'l' || input === 'L')) return;
    if (phase === 'done' && (key.return || key.escape)) onBack();
    if (phase === 'assess-done' && key.escape) onBack();
    if (phase === 'assess-done' && key.return) {
      if (onLzChallenge && isEnterprise) { setPhase('challenge-prompt'); }
      else { onBack(); }
    }
    if (phase === 'assess-done' && (input === 'l' || input === 'L') && logFilePathRef.current) {
      openWithDefaultApp(logFilePathRef.current);
    }
    if (phase === 'assess-done' && (input === 'c' || input === 'C')) {
      if (!isEnterprise) return;
      onLzChallenge?.(app);
    }
    if (phase === 'input-app-credentials' && key.escape) { setEditOnlyMode(false); setPhase('input-app'); }
    if (phase === 'input-app-cred-vcs-url'   && key.escape) setPhase('input-app-credentials');
    if (phase === 'input-app-cred-vcs-token' && key.escape) setPhase('input-app-credentials');
    if (phase === 'input-app-cred-api-token' && key.escape) setPhase('input-app-credentials');
    if (phase === 'input-app-llm'            && key.escape) setPhase('input-app-credentials');
    // Credential hub hot-keys (LZ: R=URL, A=token, L=LLM, 1-9=API)
    if (phase === 'input-app-credentials' && (input === 'r' || input === 'R')) setPhase('input-app-cred-vcs-url');
    if (phase === 'input-app-credentials' && (input === 'a' || input === 'A')) setPhase('input-app-cred-vcs-token');
    if (phase === 'input-app-credentials' && (input === 'l' || input === 'L')) setPhase('input-app-llm');
    if (phase === 'input-app-credentials' && /^[1-9]$/.test(input)) {
      const pageStart = apiTokenPage * API_TOKEN_PAGE_SIZE;
      const idx = pageStart + parseInt(input, 10) - 1;
      if (idx < apiTokenConnectors.length) {
        setApiTokenConnectorIdx(idx);
        setPhase('input-app-cred-api-token');
      }
    }
    if (phase === 'input-app-credentials' && (input === ']')) {
      const totalPages = Math.ceil(apiTokenConnectors.length / API_TOKEN_PAGE_SIZE);
      if (apiTokenPage < totalPages - 1) setApiTokenPage(p => p + 1);
    }
    if (phase === 'input-app-credentials' && (input === '[')) {
      if (apiTokenPage > 0) setApiTokenPage(p => p - 1);
    }
    if (phase === 'input-app-credentials' && (key.return || input === 's' || input === 'S')) {
      if (editOnlyMode) { setEditOnlyMode(false); setPhase('input-app'); }
      else { setAppLzCatProviders([]); setAppLzCatTargets([]); setAppLzCatFrameworks([]); setAppLzRegionFilter(''); setPhase('input-lz-provider'); }
    }
    if (phase === 'input-lz-provider'    && key.escape) setPhase('input-app');
    if (phase === 'input-lz-frameworks'  && key.escape) { setAppLzCatFrameworks([]); setPhase('input-lz-provider'); }
    if (phase === 'input-lz-region'      && key.escape) {
      if (appLzRegionFilter) { setAppLzRegionFilter(''); } else { setPhase('input-lz-frameworks'); }
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
        onBack={onBack}
        Header={Header}
      />
    );
  }

  if (phase === 'input-app-credentials') {
    const vcsUrlKey = `vcs-url-${app}`;
    const vcsKey    = `vcs-token-${app}`;
    const s = (k: string) => appCredStoredKeys.has(k);
    const dot = (k: string) => (
      <Text color={s(k) ? 'green' : 'gray'}>{s(k) ? '[stored]' : '[  --  ]'}</Text>
    );
    const continueLabel = editOnlyMode ? 'Save + back' : 'continue';
    const apiTotalPages = Math.max(1, Math.ceil(apiTokenConnectors.length / API_TOKEN_PAGE_SIZE));
    const apiPageStart = apiTokenPage * API_TOKEN_PAGE_SIZE;
    const apiPageConnectors = apiTokenConnectors.slice(apiPageStart, apiPageStart + API_TOKEN_PAGE_SIZE);
    const apiPageIndicator = apiTotalPages > 1 ? ` (page ${apiTokenPage + 1}/${apiTotalPages})` : '';
    const apiPageNav = apiTotalPages > 1 ? '  |  [ / ] -- prev/next page' : '';
    const apiKeyConnectors = apiPageConnectors.filter(c => c.credentialKey);
    const apiNumHint = apiKeyConnectors.length > 0
      ? `  |  1${apiKeyConnectors.length > 1 ? `-${apiKeyConnectors.length}` : ''} -- API token`
      : '';
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <Text>App: <Text color="cyanBright">{app}</Text>{editOnlyMode && <Text dimColor>  (edit mode -- Enter to save and return)</Text>}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Credentials for this app</Text>
          <Text color="gray">Press a shortcut to edit a credential, or Enter to continue.</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>  VCS:</Text>
          <Text>    {dot(vcsUrlKey)}  <Text bold>R</Text>  Repository URL</Text>
          <Text>    {dot(vcsKey)}  <Text bold>A</Text>  Access token</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>  API tokens{apiPageIndicator}:</Text>
          {apiPageConnectors.map((c, i) => {
            const stored = c.credentialKey ? appCredStoredKeys.has(c.credentialKey) : false;
            const statusText = c.credentialKey ? (stored ? '[stored]' : '[  --  ]') : '[env-var]';
            return (
              <Text key={c.id}>    <Text color={stored ? 'green' : 'gray'}>{statusText.padEnd(9)}</Text> <Text bold={!!c.credentialKey}>{i + 1}</Text>  {c.name}</Text>
            );
          })}
        </Box>
        <GuidanceBox
          title="Per-app credentials"
          what="Credentials are keyed to this app only. Stored securely in the SWAO credential store. All fields are optional."
          details={[{ label: 'VCS URL key', value: vcsUrlKey }, { label: 'VCS token key', value: vcsKey }]}
          affordances={[`R -- repo URL  |  A -- access token  |  L -- LLM override${apiNumHint}${apiPageNav}  |  Enter/S -- ${continueLabel}  |  Esc -- back`]}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          maxRows={Math.max(8, terminalRows - 20)}
        />
      </Box>
    );
  }

  if (phase === 'input-app-cred-vcs-url') {
    const credKey = `vcs-url-${app}`;
    const alreadyStored = appCredStoredKeys.has(credKey);
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="lz-input-app-cred-vcs-url"
            label={alreadyStored ? 'Repository URL (Enter to keep existing)' : 'Repository URL (Enter to skip)'}
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
        </Box>
        <GuidanceBox
          title="VCS repository URL"
          what="Full HTTPS clone URL for the application source repository."
          details={[{ label: 'Credential key', value: credKey }]}
          affordances={['Enter -- save and return  |  Enter (empty) -- skip  |  Esc -- back']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
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
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <Box marginTop={1}>
          <TextInput
            key="lz-input-app-cred-vcs-token"
            label={alreadyStored ? 'VCS token (Enter to keep existing)' : 'VCS token (Enter to skip)'}
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
        <GuidanceBox
          title="VCS token"
          what="Personal access token for cloning the app repository. Stored under the provider-scoped key."
          details={[{ label: 'Credential key', value: credKey }]}
          affordances={['Enter -- save and return  |  Enter (empty) -- skip  |  Esc -- back']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  if (phase === 'input-app-cred-api-token') {
    const connector = apiTokenConnectors[apiTokenConnectorIdx];
    const credKey = connector?.credentialKey;
    if (!connector || !credKey) {
      const infoMsg = connector?.envVar
        ? `${connector.name} uses an environment variable (${connector.envVar}) -- no vault key to enter here.`
        : 'No vault-stored API key for this connector.';
      return (
        <Box flexDirection="column" padding={1}>
          <Header subtitle={typeLabel} />
          <Text color="yellow">{infoMsg}</Text>
          <Text dimColor>Press Esc to return.</Text>
        </Box>
      );
    }
    const alreadyStored = appCredStoredKeys.has(credKey);
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <Box marginTop={1}>
          <PasswordInput
            label={alreadyStored ? `${connector.name} API key (Enter to keep existing)` : `${connector.name} API key (Enter to skip)`}
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
        <GuidanceBox
          title={`${connector.name} API key`}
          what={`API key for the ${connector.name} LLM gateway connector. Stored in the SWAO credential vault.`}
          details={[{ label: 'Connector', value: connector.id }, { label: 'Credential key', value: credKey }]}
          affordances={['Enter -- save and return  |  Enter (empty) -- skip  |  Esc -- back']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          maxRows={Math.max(8, terminalRows - 20)}
        />
      </Box>
    );
  }

  if (phase === 'input-app-llm') {
    const currentAppLlm = readAppLlmConfig(workspace, app);
    const currentLabel = formatLlmCurrentLabel(currentAppLlm.type, currentAppLlm.model, wsLlmConfig.type);
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <LlmModelPicker
          app={app}
          currentLabel={currentLabel}
          onSelect={(v) => {
            if (v === 'workspace-default') { clearAppLlmProvider(app); }
            else { writeAppLlmProvider(app, v); }
            setPhase('input-app-credentials');
          }}
          onGuidanceOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  if (phase === 'input-lz-provider') {
    const hint = scaffold.lzCatalogueHint;
    const providerOptions = hint?.entries.map(e => ({ label: `${e.name}  (${e.provider})`, value: e.provider })) ?? [];
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle="Landing Zone Catalog Assessment" />
        <Text>App: <Text color="cyanBright">{app}</Text></Text>
        <Text dimColor>  Catalog: bundled  |  run `swao lz catalogue update` to refresh</Text>
        <Box marginTop={1}>
          {providerOptions.length > 0 ? (
            <MultiSelect
              label="Cloud provider(s)"
              options={providerOptions}
              onConfirm={(selected) => {
                if (selected.length === 0) return;
                setAppLzCatProviders(selected);
                setAppLzCatFrameworks([]);
                setAppLzRegionFilter('');
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
                setPhase('input-lz-frameworks');
              }}
              active
            />
          )}
        </Box>
        <GuidanceBox
          title="Cloud Service Provider"
          what="The CSP whose service catalogue SWAO fetches and matches the app's assessed requirements. Select multiple CSPs to run a side-by-side comparison."
          details={[
            { label: 'Edit catalogues', value: 'Place a lz-catalogues/ folder in the workspace root to override or extend the bundled provider JSON files.' },
            { label: 'aws vs aws-esc', value: 'Standard aws (eu-central-1) is SOVEREIGNTY_BLOCKED under BSI_C5/Cloud Act frameworks. Select aws-esc (AWS European Sovereign Cloud) for EU-entity sovereignty evaluation.' },
          ]}
          affordances={['Up/Down -- move  |  Space -- toggle  |  A -- all  |  Enter -- confirm  |  Esc -- back']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  if (phase === 'input-lz-frameworks') {
    const providerLabel = truncateLabel(appLzCatProviders.map(pid => lzProviderName(pid)).join(', '), 30 + app.length);
    const discovered = scaffold.discoverLzGateFrameworks?.(workspace ?? '', app) ?? [];
    const lzFwOptions = applyLzCuratedLabels(discovered);
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle="Landing Zone Catalog Assessment" />
        <LzCatalogPicker
          app={app}
          providerLabel={providerLabel}
          options={lzFwOptions}
          visibleCount={passVisibleCount}
          onConfirm={(selected) => {
            setAppLzCatFrameworks(selected);
            setPhase('input-lz-region');
          }}
          onGuidanceOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  if (phase === 'input-lz-region') {
    const hint = scaffold.lzCatalogueHint;
    const allTargetOptions = appLzCatProviders.flatMap(pid => {
      const entry = hint?.entries.find(e => e.provider === pid);
      if (!entry) return [];
      return [...entry.regions]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(r => ({
          label: `${pid.toUpperCase()} / ${r.id} - ${r.display}${r.country ? ` [${r.country}]` : ''}`,
          value: `${pid}:${r.id}`,
        }));
    });
    const providerLabel = truncateLabel(appLzCatProviders.map(pid => lzProviderName(pid)).join(', '), 30 + app.length);

    if (allTargetOptions.length > FILTER_THRESHOLD && appLzRegionFilter === '') {
      return (
        <Box flexDirection="column" padding={1}>
          <Header subtitle="Landing Zone Catalog Assessment" />
          <Text>App: <Text color="cyanBright">{app}</Text> | CSP(s): <Text color="cyanBright">{providerLabel}</Text></Text>
          <Text dimColor>{allTargetOptions.length} regions available. Type a substring to filter.</Text>
          <Box marginTop={1}>
            <TextInput
              key="lz-region-filter"
              label="Filter by provider/region ID or name (Enter to show all)"
              placeholder="eu, Frankfurt, aws"
              onSubmit={(v) => setAppLzRegionFilter(v || SHOW_ALL)}
              active
            />
          </Box>
          <GuidanceBox
            title="Filter regions"
            what={`${allTargetOptions.length} regions across ${appLzCatProviders.length} CSP(s). Type part of the region ID or display name, or Enter to show all.`}
            details={[
              { label: 'Filter by provider', value: 'Type the provider key (e.g. "stackit", "aws", "gcp") to see ALL regions for that provider.' },
              { label: 'STACKIT Germany vs Austria', value: 'eu01 (Germany, BSI_C5-certified) vs eu02 (Austria, SOVEREIGNTY_BLOCKED under BSI_C5). Type "eu01" for the German region.' },
            ]}
            affordances={['Type -- filter  |  Enter -- apply  |  Esc -- back to provider']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      );
    }

    const filteredTargetOptions = filterList(allTargetOptions, appLzRegionFilter, r => r.label);
    if (allTargetOptions.length > 0) {
      return (
        <Box flexDirection="column" padding={1}>
          <Header subtitle="Landing Zone Catalog Assessment" />
          <Text>App: <Text color="cyanBright">{app}</Text> | CSP(s): <Text color="cyanBright">{providerLabel}</Text></Text>
          {appLzRegionFilter && appLzRegionFilter !== SHOW_ALL && (
            <Text dimColor>Filter: <Text color="cyanBright">{appLzRegionFilter}</Text>  ({filteredTargetOptions.length}/{allTargetOptions.length} regions)
              {appLzCatProviders.length > 1 && (
                <Text dimColor>  [{appLzCatProviders.map(pid => {
                  const n = filteredTargetOptions.filter(o => o.value.startsWith(`${pid}:`)).length;
                  return `${pid.toUpperCase()}: ${n}`;
                }).join('  ')}]</Text>
              )}
              <Text dimColor>  Esc to clear</Text>
            </Text>
          )}
          <Box marginTop={1}>
            {filteredTargetOptions.length > 0 ? (
              <MultiSelect
                key={`lz-region-${appLzCatProviders.join('-')}-${appLzRegionFilter}`}
                label="Target region(s) -- Space to toggle, Enter to confirm"
                options={filteredTargetOptions}
                visibleCount={12}
                onConfirm={(selected) => {
                  if (selected.length === 0) return;
                  persistLzCatTargets(workspace, app, selected); // #2755
                  setAppLzCatTargets(selected);
                  beginRun();
                }}
              />
            ) : (
              <Text color="yellow">No regions match "{appLzRegionFilter}". Press Esc to clear filter.</Text>
            )}
          </Box>
          <GuidanceBox
            title="Target Regions"
            what={appLzRegionFilter && appLzRegionFilter !== SHOW_ALL
              ? `${filteredTargetOptions.length} of ${allTargetOptions.length} combinations match "${appLzRegionFilter}".`
              : `${allTargetOptions.length} provider/region combinations. Select all targets to compare in one run.`}
            affordances={['Up/Down -- move  |  Space -- toggle  |  A -- all  |  Enter -- confirm  |  Esc -- clear filter or back']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      );
    }

    // No catalogue data -- manual TextInput fallback.
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle="Landing Zone Catalog Assessment" />
        <Text>App: <Text color="cyanBright">{app}</Text> | CSP(s): <Text color="cyanBright">{providerLabel}</Text></Text>
        <Box marginTop={1}>
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
              persistLzCatTargets(workspace, app, [target]); // #2755
              setAppLzCatTargets([target]);
              beginRun();
            }}
            active
          />
        </Box>
        <GuidanceBox
          title="Landing Zone Region"
          what="No region catalogue loaded. Enter the region ID manually. Run `swao lz catalogue list` to see available regions."
          affordances={['Enter -- confirm  |  Esc -- back']}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
    );
  }

  if (phase === 'preflight-llm' && preflightConnector) {
    return (
      <PreflightLlmPhase
        connector={preflightConnector}
        apiKey={preflightApiKey}
        app={app}
        typeLabel={typeLabel}
        onPass={() => setPhase('running')}
        onBack={() => setPhase('input-app-credentials')}
        Header={Header}
      />
    );
  }

  if (phase === 'assess-done') {
    const lzCatalogueOnly = lines.some(l => l.includes('No app required-services found'));
    return (
      <Box flexDirection="column" padding={1}>
        <Header subtitle={typeLabel} />
        <Box>
          <Text color="green">Assessment complete.</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>  App:     <Text color="cyanBright">{app}</Text></Text>
          <Text>  Passes:  <Text color="cyanBright">{appLzCatTargets.length} (lz_fit)</Text></Text>
          {lzTargetVerdicts.length > 0 ? (
            <Box flexDirection="column">
              <Text>  Verdicts:</Text>
              {lzTargetVerdicts.map(tv => {
                const col = tv.verdict === 'ready' ? 'green'
                  : (tv.verdict === 'advisory' || tv.verdict === 'needs_verification') ? 'yellow'
                  : 'red';
                const regionId = tv.target.split('/').at(-1) ?? tv.target;
                const gapDetail = lzTargetGapDetails[regionId];
                const isBlocked = tv.verdict === 'blocked' || tv.verdict === 'sovereignty_blocked';
                const gapLabel = isBlocked && gapDetail
                  ? (gapDetail.gapType === 'sovereignty' ? '  BLOCKED (sovereignty)'
                    : gapDetail.gapType === 'availability' ? '  BLOCKED (availability)'
                    : gapDetail.gapType === 'sovereignty+availability' ? '  BLOCKED (sovereignty + availability)'
                    : '')
                  : '';
                return (
                  <Box key={tv.target} flexDirection="column">
                    <Text>    <Text color="cyanBright">{tv.target}</Text>{'  '}<Text color={col}>{tv.verdict.toUpperCase()}</Text>{gapLabel ? <Text color="red">{gapLabel}</Text> : null}{tv.gaps > 0 ? <Text dimColor>{`  (${tv.gaps} gap${tv.gaps !== 1 ? 's' : ''})`}</Text> : null}</Text>
                    {gapDetail?.assessmentMode === 'partial' && (
                      <Text dimColor>      [partial coverage -- some baseline service categories missing from service signals]</Text>
                    )}
                  </Box>
                );
              })}
            </Box>
          ) : (
            <>
              {lzVerdict === 'ready'    && <Text>  Verdict: <Text color="green">READY  (all LZ controls passed)</Text></Text>}
              {lzVerdict === 'blocked'  && <Text>  Verdict: <Text color="red">BLOCKED  (blocker-severity controls failed -- review run dir)</Text></Text>}
              {lzVerdict === 'advisory' && <Text>  Verdict: <Text color="yellow">ADVISORY  (advisory warnings raised -- migration score penalised)</Text></Text>}
              {lzVerdict && lzVerdict !== 'ready' && lzVerdict !== 'blocked' && lzVerdict !== 'advisory' && <Text>  Verdict: <Text color="gray">{lzVerdict.toUpperCase()}</Text></Text>}
            </>
          )}
          <Text>  Outputs: <Text color="cyanBright">apps/{app}/wsp/runs/&lt;ts&gt;/passes/lz-fit*.yaml</Text></Text>
          {lzCatalogueOnly && (
            <Box marginTop={1} flexDirection="column">
              <Text color="yellow">  [!] Catalogue-only result: no service signals found from a prior App Assessment.</Text>
              <Text dimColor>      Run App Assessment first, then re-run LZ for full service-fit results.</Text>
            </Box>
          )}
        </Box>
        <Box marginTop={1}>
          <Text>Press <Text color="cyanBright">Esc</Text> (or Enter) to return to the main menu.{logFilePath ? <Text>  <Text color="cyanBright">L</Text> -- view log</Text> : null}{onLzChallenge ? <Text>  {isEnterprise ? <Text color="cyanBright">C</Text> : <Text dimColor>C</Text>} -- LZ Sovereignty Challenge{isEnterprise ? null : <Text dimColor> [Enterprise]</Text>}</Text> : null}</Text>
        </Box>
        <GuidanceBox
          title="Assessment complete"
          what={lzVerdict === 'ready'
            ? 'No blockers detected. Catalogue-level service requirements are met. Use swao publish to include the LZ Catalogue section in the HTML report.'
            : lzVerdict === 'sovereignty_blocked'
              ? 'One or more target regions fail sovereignty requirements. Red regions lack required certifications. Select compliant regions or adjust the framework selection.'
              : lzVerdict === 'blocked'
                ? 'One or more compliance controls failed with severity: blocker. Review 23-lzr.yaml in the run directory.'
                : lzVerdict === 'advisory'
                  ? 'No hard blockers, but advisory-severity controls raised warnings. Review advisory items before proceeding.'
                  : 'Landing-zone fit written to the run dir. Use swao publish to include the LZ Catalogue section in the HTML report.'}
          details={[
            { label: 'Run dir', value: `apps/${app}/wsp/runs/<latest>/` },
            ...(() => {
              const blocked = lzTargetVerdicts.find(tv => tv.verdict === 'blocked' || tv.verdict === 'sovereignty_blocked');
              if (!blocked) return [];
              const regionId = blocked.target.split('/').at(-1) ?? blocked.target;
              const stmt = lzTargetGapDetails[regionId]?.sovereigntyStatement;
              if (!stmt) return [];
              return [{ label: 'Sovereignty statement', value: stmt }];
            })(),
          ]}
          affordances={[
            ...(logFilePath ? ['L -- view log file'] : []),
            ...(onLzChallenge ? [isEnterprise ? 'C -- LZ Sovereignty Challenge' : 'C -- LZ Sovereignty Challenge [Enterprise only]'] : []),
            'Ctrl+G -- close guidance',
            'Esc -- main menu',
          ]}
          onOpenChange={(open) => { guidanceOpenRef.current = open; }}
        />
      </Box>
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
        Header={Header}
      />
    );
  }

  if (phase === 'running' && !done) {
    return (
      <RunningPhase
        progressValue={displayProgressValue}
        progressLabel={passSubLabel ? `${passName} -- ${passSubLabel}` : passName}
        totalPasses={totalPasses}
        liveLines={lines}
        passName={passName}
        typeLabel={typeLabel}
        onBack={onBack}
        Header={Header}
      />
    );
  }

  // done or running+done fallback
  return (
    <Box flexDirection="column" padding={1}>
      <Header subtitle={typeLabel} />
      <Text dimColor>
        {done && code === 0
          ? 'Assessment complete.'
          : done
            ? `Assessment finished with warnings (exit ${code ?? '?'}).`
            : 'Running...'}
      </Text>
      {failedPass && (
        <Text color="yellow">Pass {failedPass} failed. Check the output above for details.</Text>
      )}
      <Box marginTop={1}>
        <Text dimColor>Press Enter or Escape to return to menu...</Text>
      </Box>
    </Box>
  );
}
