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

// L4 TUI flow for LLM Assessment (Design 092, #1427).
//
// Gate order mirrors the CLI (assess.ts llm branch, #1419):
//   1. app picker with precondition check (gates.ts)
//   2. leg builder -- add legs one at a time; same connector allowed with
//      different models (#1444 redesign: was multi-select of connectors)
//   3. per-leg model picker -- catalogue select or custom (#1442)
//   4. per-leg health check -- live ping before commit (#1442)
//   5. config review -- legs + cost preview (092 s5.4)
//   6. leg orchestration (orchestrator.ts)
//   8. ranked result table (comparison-engine.ts)

import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { load, dump as yamlDump } from 'js-yaml';
import {
  findWorkspace,
  SwaoYmlSchema,
  credentialStore,
} from '@swao/core';
import type { SwaoYmlLlmAssessment } from '@swao/core';
import {
  checkAppAssessmentPrecondition,
  orchestrateLegs,
  trafficLight,
} from '@swao/module-llm-assessment';
import type { ResolvedLeg, OrchestrationResult, ChallengePassResult } from '@swao/module-llm-assessment';
import {
  listConnectors,
  createProviderFromConnector,
  classifyPingFailure,
  type LoadedConnector,
} from '@swao/module-llm-providers';
import { SelectInput, GuidanceBox, TextInput, ProgressBar, PICKER_VISIBLE_COUNT } from '@swao/tui-kit';
import { Header } from '../components/Header.js';
import { SWAO_VERSION } from '../../branding.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Stage =
  | 'loading'
  | 'picking-app'
  | 'no-apps'
  | 'no-legs'
  | 'build-legs'
  | 'pick-model'
  | 'pick-model-custom'
  | 'health-check'
  | 'review-config'
  | 'running'
  | 'saving'
  | 'done'
  | 'error';

interface EligibleApp {
  id: string;
  passCount: number;
}

interface PendingLeg {
  connectorId: string;
  connector: LoadedConnector;
  model: string;
}

export interface LlmAssessmentScreenProps {
  workspacePath?: string;
  onBack: () => void;
}

const MAX_LEGS = 5;
const MIN_LEGS = 2;

// ---------------------------------------------------------------------------
// Pure render: result table (exported for unit tests)
// ---------------------------------------------------------------------------

function shortModelName(leg: ResolvedLeg): string {
  const model = leg.model.replace(/^~[^/]+\//, '');
  const parts = model.split('/');
  return parts[parts.length - 1] ?? model;
}

export function LlmResultTable({
  result,
  legs,
}: {
  result: OrchestrationResult;
  legs: ResolvedLeg[];
}): React.JSX.Element {
  const legIds = legs.map((l) => l.id);
  const colW = Math.max(12, Math.floor(64 / Math.max(1, legs.length)));

  function tlColor(tl: ReturnType<typeof trafficLight>): string | undefined {
    if (tl === 'ok')   return 'green';
    if (tl === 'warn') return 'yellow';
    if (tl === 'red')  return 'red';
    return undefined;
  }

  function scoreCell(score: number | null | undefined, rank: number | null | undefined): string {
    const s = score !== null && score !== undefined ? `${Math.round(score)}` : '--';
    const r = rank !== null && rank !== undefined  ? `#${rank}` : '--';
    return `${s} (${r})`;
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" marginBottom={1}>
        <Box width={20}><Text bold>Dimension</Text></Box>
        {legs.map((leg) => (
          <Box key={leg.id} width={colW}>
            <Text bold wrap="truncate-end">{shortModelName(leg)}</Text>
          </Box>
        ))}
      </Box>
      {result.groups.map((g) => (
        <Box key={g.group} flexDirection="row">
          <Box width={20}><Text>{g.group}</Text></Box>
          {legIds.map((id) => {
            const tl = trafficLight(g.score[id] ?? null);
            return (
              <Box key={id} width={colW}>
                <Text color={tlColor(tl)}>{scoreCell(g.score[id], g.rank[id])}</Text>
              </Box>
            );
          })}
        </Box>
      ))}
      <Box flexDirection="row" marginTop={1}>
        <Box width={20}><Text bold>FINAL</Text></Box>
        {legIds.map((id) => {
          const tl = trafficLight(result.final.score[id] ?? null);
          return (
            <Box key={id} width={colW}>
              <Text bold color={tlColor(tl)}>
                {scoreCell(result.final.score[id], result.final.rank[id])}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {result.records.length} call(s) across {legs.length} LLM Provider(s), {result.findingsCount} finding(s).
        </Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function LlmAssessmentScreen({
  workspacePath: workspacePathProp,
  onBack,
}: LlmAssessmentScreenProps): React.JSX.Element {
  const [stage,             setStage]           = useState<Stage>('loading');
  const [errorMsg,          setErrorMsg]         = useState('');
  const [workspacePath,     setWp]              = useState('');
  const [eligibleApps,      setEligibleApps]     = useState<EligibleApp[]>([]);
  const [selectedApp,       setSelectedApp]      = useState<EligibleApp | null>(null);
  const [llmCfg,            setLlmCfg]           = useState<SwaoYmlLlmAssessment | null>(null);
  const [resolvedLegs,      setResolvedLegs]     = useState<ResolvedLeg[]>([]);
  const [progressLines,     setProgress]         = useState<string[]>([]);
  const [legCallLines,      setLegCallLines]     = useState<string[]>([]);
  const [result,            setResult]           = useState<OrchestrationResult | null>(null);
  // Workspace-only connectors + credential status
  const [loadedConnectors,  setLoadedConnectors] = useState<LoadedConnector[]>([]);
  const [configuredCredKeys, setConfiguredCredKeys] = useState<Set<string>>(new Set());
  // Leg builder state (#1444)
  const [pendingLegs,       setPendingLegs]      = useState<PendingLeg[]>([]);
  const [nextLeg,           setNextLeg]          = useState<PendingLeg | null>(null);
  const [buildError,        setBuildError]       = useState('');
  // Health check state (#1442)
  const [healthStatus,      setHealthStatus]     = useState<'running' | 'ok' | 'fail' | null>(null);
  const [healthMessage,     setHealthMessage]    = useState('');
  // #1783: true when the ping returned a permanent (non-transient) error such
  // as HTTP 404 "model removed from provider". Blocks leg addition so the user
  // is forced to pick a different model rather than proceeding to an 84-second
  // run of 7 guaranteed-failing API calls.
  const [healthPermanent,   setHealthPermanent]  = useState(false);

  const guidanceOpenRef = useRef(false);
  // Ref so health-check effect always reads the current nextLeg without adding
  // it to deps (avoids retriggering on every model change).
  const nextLegRef = useRef<PendingLeg | null>(null);
  nextLegRef.current = nextLeg;
  // #1477: tracks the current leg subprocess workspace for per-call polling.
  const legWorkspaceForPollRef = useRef<string | null>(null);

  // -------------------------------------------------------------------------
  // Stage: loading
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (stage !== 'loading') return;
    try {
      const wp = workspacePathProp ?? findWorkspace(process.cwd()) ?? process.cwd();
      setWp(wp);

      let parsedCfg: SwaoYmlLlmAssessment | null = null;
      try {
        const raw = load(readFileSync(join(wp, '.swao.yml'), 'utf8'));
        const res = SwaoYmlSchema.safeParse(raw);
        if (res.success && res.data.llm_assessment) {
          parsedCfg = res.data.llm_assessment;
        }
      } catch { /* no .swao.yml or parse failure */ }
      setLlmCfg(parsedCfg);

      const appsDir = join(wp, 'apps');
      const appNames: string[] = existsSync(appsDir) ? (readdirSync(appsDir) as string[]) : [];
      const eligible: EligibleApp[] = [];
      for (const appId of appNames) {
        try {
          const pre = checkAppAssessmentPrecondition(wp, appId);
          if (pre.ok) eligible.push({ id: appId, passCount: pre.latestRun?.passStats?.length ?? 0 });
        } catch { /* skip unreadable app */ }
      }
      setEligibleApps(eligible);

      try {
        const { connectors } = listConnectors({ workspaceRoot: wp });
        // Only show connectors the operator has configured in this workspace.
        // Bundled seeds with no workspace override are excluded -- they have no
        // API key and would fail the health check immediately.
        const wsConnectors = connectors.filter(c => c.origin === 'workspace');
        setLoadedConnectors(wsConnectors);

        // Build the set of credential keys that are currently stored, so we
        // can show a "(no key)" warning without performing a blocking async
        // lookup per connector.
        const creds = credentialStore.loadSync();
        setConfiguredCredKeys(new Set(Object.keys(creds)));
      } catch { /* no connectors */ }

      setStage(eligible.length === 0 ? 'no-apps' : 'picking-app');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStage('error');
    }
  }, [stage]);

  // -------------------------------------------------------------------------
  // Stage: health-check -- live ping (#1442)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (stage !== 'health-check') return;
    const pending = nextLegRef.current;
    if (!pending) return;

    setHealthStatus('running');
    setHealthMessage('');
    setHealthPermanent(false);

    let cancelled = false;
    const PING_PROMPT = 'SWAO connectivity check. Reply with the single word: OK';
    const PING_TIMEOUT_MS = 20_000; // consistent with gateway-probe.ts wizard (#1814)

    void (async () => {
      try {
        const resolved = createProviderFromConnector(pending.connector, { model: pending.model });
        await Promise.race([
          resolved.provider.complete(PING_PROMPT),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`ping timed out after ${PING_TIMEOUT_MS}ms`)),
              PING_TIMEOUT_MS,
            ).unref?.(),
          ),
        ]);
        if (!cancelled) {
          setHealthStatus('ok');
          setHealthMessage(`PASS -- ${pending.connectorId} / ${pending.model}`);
        }
      } catch (err) {
        if (!cancelled) {
          const raw = err instanceof Error ? err.message : String(err);
          const hint = classifyPingFailure(raw, {
            credentialKey: pending.connector.file.connector.auth.credential_key ?? '',
            model: pending.model,
          });
          // #1783: detect permanent (non-transient) failure -- 4xx other than 429.
          // "request failed: 404" = model removed from provider; no retry will help.
          const permanent = /request failed: 4(?!29)\d\d/.test(raw);
          setHealthPermanent(permanent);
          setHealthStatus('fail');
          setHealthMessage(hint);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [stage]);

  // -------------------------------------------------------------------------
  // Stage: running -- tier gate then orchestrate (async)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (stage !== 'running') return;
    if (!selectedApp || resolvedLegs.length < MIN_LEGS) return;

    let cancelled = false;

    void (async () => {
      try {
        const cfg = llmCfg!;
        const orch = await orchestrateLegs({
          workspaceRoot: workspacePath,
          appId: selectedApp.id,
          legs: resolvedLegs,
          execution:       cfg.execution    ?? 'serial',
          repeat:          cfg.repeat       ?? 1,
          weights: {
            quality:     cfg.weights?.quality     ?? 0.5,
            reliability: cfg.weights?.reliability ?? 0.2,
            performance: cfg.weights?.performance ?? 0.15,
            cost:        cfg.weights?.cost        ?? 0.15,
          },
          keepLegWsp:      cfg.keep_leg_wsp ?? false,
          passSuiteVersion: SWAO_VERSION,
          onProgress: (m) => {
            if (!cancelled) setProgress((prev) => [...prev, m]);
          },
          // #1587/#1820: spawn challenge and LZ challenge per leg so the TUI
          // path produces the same challengePassGroups as the CLI path.
          // Mirrors assess.ts spawnChallenge/spawnLzChallenge; cwd=workspacePath
          // (main workspace) not the leg temp dir (#1774).
          spawnChallenge: async (leg, _legWorkspaceRoot, legEnv): Promise<ChallengePassResult> => {
            const challengeStarted = Date.now();
            const isPkg = Boolean((process as { pkg?: unknown }).pkg);
            const cmd = process.execPath;
            const baseArgs = isPkg ? [] : [process.argv[1] ?? ''];
            const challengeArgs = [
              ...baseArgs,
              'challenge', '--app', selectedApp.id, '--all-agents', '--report',
              '--connector', leg.connector,
              ...(leg.model !== 'default' ? ['--model', leg.model] : []),
            ];
            const spawnResult = await new Promise<{ exitCode: number | null }>((res) => {
              const child = spawn(cmd, challengeArgs, {
                cwd: workspacePath,
                env: { ...process.env, ...legEnv, PKG_EXECPATH: '' },
                stdio: 'ignore',
                windowsHide: true,
              });
              child.on('error', () => res({ exitCode: null }));
              child.on('exit', (code) => res({ exitCode: code }));
            });
            const durationMs = Date.now() - challengeStarted;
            const reportPath = join(workspacePath, 'apps', selectedApp.id, 'wsp', 'challenge-app', 'combined.yaml');
            type AgentEntry = { agent_id?: string; [k: string]: unknown };
            let agentData: Array<AgentEntry> = [];
            if (existsSync(reportPath)) {
              agentData = (load(readFileSync(reportPath, 'utf-8')) as { reports?: AgentEntry[] })?.reports ?? [];
            } else {
              const challengeAppDir = join(workspacePath, 'apps', selectedApp.id, 'wsp', 'challenge-app');
              if (existsSync(challengeAppDir)) {
                const tsDir = readdirSync(challengeAppDir, { withFileTypes: true })
                  .filter(d => d.isDirectory())
                  .sort((a, b) => b.name.localeCompare(a.name))[0];
                if (tsDir) {
                  const aaFiles = readdirSync(join(challengeAppDir, tsDir.name))
                    .filter(f => f.startsWith('AA_') && f.endsWith('.yaml'));
                  for (const f of aaFiles) {
                    try {
                      const parsed = load(readFileSync(join(challengeAppDir, tsDir.name, f), 'utf-8'));
                      if (parsed && typeof parsed === 'object') agentData.push(parsed as AgentEntry);
                    } catch { /* skip malformed */ }
                  }
                }
              }
            }
            return {
              completed_at: new Date().toISOString(),
              agents: agentData.map((a) => ({
                agent_id: String(a['agent_id'] ?? 'unknown'),
                calls: 1,
                dnf: spawnResult.exitCode !== 0,
                duration_ms: Math.round(durationMs / Math.max(agentData.length, 1)),
              })),
              exit_code: spawnResult.exitCode,
            };
          },
          spawnLzChallenge: async (leg, _legWorkspaceRoot, legEnv): Promise<ChallengePassResult> => {
            const lzStarted = Date.now();
            const isPkg = Boolean((process as { pkg?: unknown }).pkg);
            const cmd = process.execPath;
            const baseArgs = isPkg ? [] : [process.argv[1] ?? ''];
            const challengeLzArgs = [
              ...baseArgs,
              'challenge', '--type', 'lz', '--app', selectedApp.id, '--all-agents',
              '--connector', leg.connector,
              ...(leg.model !== 'default' ? ['--model', leg.model] : []),
            ];
            const spawnResultLz = await new Promise<{ exitCode: number | null }>((res) => {
              const childLz = spawn(cmd, challengeLzArgs, {
                cwd: workspacePath,
                env: { ...process.env, ...legEnv, PKG_EXECPATH: '' },
                stdio: 'ignore',
                windowsHide: true,
              });
              childLz.on('error', () => res({ exitCode: null }));
              childLz.on('exit', (code) => res({ exitCode: code }));
            });
            const durationMsLz = Date.now() - lzStarted;
            const lzBaseDir = join(workspacePath, 'apps', selectedApp.id, 'wsp', 'challenge-lz');
            const lzAgentData: Array<{ agent_id: string }> = [];
            if (existsSync(lzBaseDir)) {
              const tsDirs = readdirSync(lzBaseDir)
                .filter(d => /^\d{4}-\d{2}-\d{2}T/.test(d))
                .sort()
                .reverse();
              const latestDir = tsDirs[0];
              if (latestDir) {
                const files = readdirSync(join(lzBaseDir, latestDir))
                  .filter(f => f.startsWith('LZCA_') && f.endsWith('.yaml'));
                for (const f of files) {
                  lzAgentData.push({ agent_id: f.replace(/^LZCA_/, '').replace(/\.yaml$/, '') });
                }
              }
            }
            return {
              completed_at: new Date().toISOString(),
              agents: lzAgentData.map((a) => ({
                agent_id: String(a.agent_id),
                calls: 1,
                dnf: spawnResultLz.exitCode !== 0,
                duration_ms: Math.round(durationMsLz / Math.max(lzAgentData.length, 1)),
              })),
              exit_code: spawnResultLz.exitCode,
            };
          },
          spawnLeg: (leg, legWorkspaceRoot, legEnv) => {
            // #1477: capture current leg workspace so the polling effect can
            // watch its app-scope event log for per-call progress events.
            if (!cancelled) {
              legWorkspaceForPollRef.current = legWorkspaceRoot;
              setLegCallLines([]);
            }
            return new Promise((resolveSpawn) => {
              const started = Date.now();
              const isPkg = Boolean((process as { pkg?: unknown }).pkg);
              const cmd = process.execPath;
              const baseArgs = isPkg ? [] : [process.argv[1] ?? ''];
              const child = spawn(
                cmd,
                [...baseArgs, 'assess', '--app', selectedApp.id, '--llm', `${leg.connector}:${leg.model}`, '--no-cache', '--no-crawl'],
                {
                  cwd: legWorkspaceRoot,
                  env: { ...process.env, ...legEnv, PKG_EXECPATH: '' },
                  stdio: ['ignore', 'pipe', 'pipe'],
                  windowsHide: true,
                },
              );
              child.on('error', () => resolveSpawn({ exitCode: null, durationMs: Date.now() - started }));
              child.on('exit', (code) => resolveSpawn({ exitCode: code, durationMs: Date.now() - started }));
            });
          },
        });

        if (!cancelled) {
          setResult(orch);
          // #1673: set 'saving' immediately so keyboard becomes responsive;
          // 'saving' transitions to 'done' on the next event-loop tick via its
          // own effect, showing a brief indicator while Ink re-renders.
          setStage('saving');
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : String(err));
          setStage('error');
        }
      }
    })();

    return () => { cancelled = true; };
  }, [stage]);

  // -------------------------------------------------------------------------
  // Stage: saving (#1673) -- yield one event-loop tick then enter 'done'
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (stage !== 'saving') return;
    const handle = setImmediate(() => setStage('done'));
    return () => clearImmediate(handle);
  }, [stage]);

  // -------------------------------------------------------------------------
  // Stage: running -- per-call progress polling (#1477)
  // Polls the current leg's app-scope event log every 1.5s for call-level
  // events (provider.llm.*.attempt / ok / retry) and surfaces them below the
  // leg progress bar so the user can see activity within a long leg.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (stage !== 'running' || !selectedApp) return;

    let seenCount = 0;
    let currentLogPath: string | null = null;

    const timer = setInterval(() => {
      const legWsp = legWorkspaceForPollRef.current;
      if (!legWsp) return;

      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const newLogPath = join(legWsp, 'apps', selectedApp.id, 'wsp', 'logs', `app-events-${monthKey}.ndjson`);

      if (newLogPath !== currentLogPath) {
        currentLogPath = newLogPath;
        seenCount = 0;
      }

      if (!existsSync(currentLogPath)) return;
      let raw: string;
      try { raw = readFileSync(currentLogPath, 'utf-8'); } catch { return; }
      const lines = raw.split('\n').filter(l => l.trim());

      const newLines: string[] = [];
      for (let i = seenCount; i < lines.length; i++) {
        try {
          const entry = JSON.parse(lines[i]) as { code?: string; context?: Record<string, unknown> };
          const code = entry.code ?? '';
          const ctx = (entry.context ?? {}) as Record<string, unknown>;
          let callLine: string | null = null;
          if (code === 'assess.pass.start') {
            const num = String(ctx['num'] ?? '?');
            const name = String(ctx['name'] ?? ctx['pass'] ?? '?');
            callLine = `  pass ${num} -- ${name} starting`;
          } else if (code === 'assess.pass.complete') {
            const ms = typeof ctx['wall_clock_ms'] === 'number'
              ? `${Math.round((ctx['wall_clock_ms'] as number) / 1000)}s`
              : '?';
            const num = String(ctx['num'] ?? '?');
            const name = String(ctx['name'] ?? ctx['pass'] ?? '?');
            callLine = `  pass ${num} -- ${name} complete (${ms})`;
          } else if (/^provider\.llm\.[^.]+\.retry$/.test(code)) {
            const attempt = typeof ctx['attempt'] === 'number' ? ctx['attempt'] : null;
            callLine = `    retrying (attempt ${attempt !== null ? String(attempt) : '?'})`;
          } else if (/^provider\.llm\.[^.]+\.ok$/.test(code)) {
            const ms = typeof ctx['latency_ms'] === 'number'
              ? `${Math.round((ctx['latency_ms'] as number) / 1000)}s`
              : '?';
            const attempt = typeof ctx['attempt'] === 'number' ? ` call ${ctx['attempt']}` : '';
            callLine = `    LLM${attempt} complete (${ms})`;
          }
          if (callLine) newLines.push(callLine);
        } catch { /* skip malformed */ }
      }
      seenCount = lines.length;
      if (newLines.length > 0) {
        setLegCallLines(prev => [...prev, ...newLines].slice(-10));
      }
    }, 1500);

    return () => clearInterval(timer);
  }, [stage, selectedApp?.id]);

  // -------------------------------------------------------------------------
  // Key handler
  // -------------------------------------------------------------------------
  useInput((_input, key) => {
    if (guidanceOpenRef.current) return;
    if (key.escape) {
      if (stage === 'picking-app' || stage === 'no-apps' || stage === 'error' || stage === 'saving' || stage === 'done') {
        onBack();
      } else if (stage === 'no-legs') {
        onBack();
      } else if (stage === 'build-legs') {
        if (pendingLegs.length === 0) {
          onBack();
        } else {
          // Pop the last confirmed leg so the user can re-add it differently.
          setPendingLegs(prev => prev.slice(0, -1));
          setBuildError('');
        }
      } else if (stage === 'pick-model' || stage === 'pick-model-custom') {
        // Discard nextLeg -- return to leg builder.
        setNextLeg(null);
        setBuildError('');
        setStage('build-legs');
      } else if (stage === 'health-check') {
        if (healthStatus !== 'running') {
          // Keep nextLeg so the model picker shows the connector pre-selected.
          setStage('pick-model');
        }
      } else if (stage === 'review-config') {
        // Restore pendingLegs from resolvedLegs so the builder shows what was
        // previously configured and the user can amend without starting over.
        const restored: PendingLeg[] = resolvedLegs.map((rl) => {
          const loaded = loadedConnectors.find((c) => c.file.connector.id === rl.connector);
          if (!loaded) return null;
          return { connectorId: rl.connector, connector: loaded, model: rl.model };
        }).filter((l): l is PendingLeg => l !== null);
        setPendingLegs(restored);
        setResolvedLegs([]);
        setStage('build-legs');
      }
    }
    if (key.return) {
      if (stage === 'review-config') {
        setStage('running');
      }
      if (stage === 'health-check' && healthStatus !== 'running') {
        handleHealthCheckConfirm();
      }
    }
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function handleAppSelect(appId: string): void {
    const app = eligibleApps.find((a) => a.id === appId);
    if (!app) return;
    setSelectedApp(app);
    // Always enter the leg builder -- no fast-path that skips model/health-check
    // selection. If a prior config exists, it is shown as reference in the
    // guidance box but the user builds the leg set explicitly.
    setPendingLegs([]);
    setNextLeg(null);
    setBuildError('');
    setStage(loadedConnectors.length === 0 ? 'no-legs' : 'build-legs');
  }

  function handleConnectorSelect(connectorId: string): void {
    if (connectorId === '__done__') {
      if (pendingLegs.length >= MIN_LEGS) finaliseLegConfig(pendingLegs);
      return;
    }
    const loaded = loadedConnectors.find((c) => c.file.connector.id === connectorId);
    if (!loaded) return;
    const conn = loaded.file.connector;
    setNextLeg({
      connectorId,
      connector: loaded,
      model: conn.models.default,
    });
    setHealthStatus(null);
    setHealthMessage('');
    setBuildError('');
    setStage('pick-model');
  }

  function handleModelSelect(model: string): void {
    if (!nextLeg) return;
    setNextLeg({ ...nextLeg, model });
    setHealthStatus(null);
    setHealthMessage('');
    setHealthPermanent(false);
    setStage('health-check');
  }

  function handleHealthCheckConfirm(): void {
    const leg = nextLegRef.current;
    if (!leg) return;
    // #1783: block permanently-unavailable models (non-transient 4xx from provider).
    // Running 7+ API calls against a removed model wastes 84s and produces
    // misleading "timeout" findings in the leg log. Force the user to pick a
    // working model instead.
    if (healthStatus === 'fail' && healthPermanent) {
      setBuildError(
        `Model permanently unavailable (404 -- model removed from provider). Remove from llm-compare.yaml and pick a different model.`,
      );
      setNextLeg(null);
      setHealthPermanent(false);
      setStage('build-legs');
      return;
    }
    // Guard: same (connector, model) pair already in the list is meaningless.
    if (pendingLegs.some((l) => l.connectorId === leg.connectorId && l.model === leg.model)) {
      setBuildError(`Leg ${leg.connectorId} / ${leg.model} is already in the list. Pick a different model.`);
      setNextLeg(null);
      setStage('build-legs');
      return;
    }
    const newLegs = [...pendingLegs, leg];
    setPendingLegs(newLegs);
    setNextLeg(null);
    if (newLegs.length >= MAX_LEGS) {
      // Reached the maximum -- auto-finalise without returning to build-legs.
      finaliseLegConfig(newLegs);
    } else {
      setStage('build-legs');
    }
  }

  function writeLlmLegsToSwaoYml(
    wp: string,
    legs: Array<{ connector: string; model?: string; primary?: boolean }>,
  ): void {
    const yamlPath = join(wp, '.swao.yml');
    let raw: Record<string, unknown> = {};
    try {
      const existing = load(readFileSync(yamlPath, 'utf8')) as Record<string, unknown>;
      if (existing && typeof existing === 'object') raw = existing;
    } catch { /* fresh file */ }
    raw['llm_assessment'] = {
      ...(typeof raw['llm_assessment'] === 'object' && raw['llm_assessment'] !== null
        ? (raw['llm_assessment'] as Record<string, unknown>)
        : {}),
      legs,
    };
    writeFileSync(
      yamlPath,
      '# .swao.yml -- SWAO workspace configuration\n' + yamlDump(raw),
      'utf-8',
    );
  }

  function finaliseLegConfig(legs: PendingLeg[]): void {
    const legDefs = legs.map((l, i) => ({
      connector: l.connectorId,
      model: l.model,
      primary: i === 0 ? (true as const) : undefined,
    }));
    const resolved: ResolvedLeg[] = legs.map((l, i) => ({
      id: `${l.connectorId}--${l.model.replace(/[^a-zA-Z0-9.-]/g, '_')}`,
      connector: l.connectorId,
      model: l.model,
      primary: i === 0,
      costSource: (l.connectorId === 'ollama' ? 'local' : 'billed') as 'local' | 'billed',
    }));
    try {
      writeLlmLegsToSwaoYml(workspacePath, legDefs);
    } catch (err: unknown) {
      setErrorMsg(`Could not write .swao.yml: ${err instanceof Error ? err.message : String(err)}`);
      setStage('error');
      return;
    }
    setLlmCfg({ legs: legDefs });
    setResolvedLegs(resolved);
    setStage('review-config');
  }

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------

  function hasCredential(c: LoadedConnector): boolean {
    const key = c.file.connector.auth.credential_key;
    if (!key) return true; // no credential required (e.g. Ollama with no API key)
    return configuredCredKeys.has(key);
  }

  const buildLegConnectorOpts = loadedConnectors.map((c) => ({
    label: `${c.file.connector.name}  [${c.file.connector.id}]` +
           (hasCredential(c) ? '' : '  [no key -- run swao setup]'),
    value: c.file.connector.id,
  }));
  const buildLegOptions = [
    ...buildLegConnectorOpts,
    ...(pendingLegs.length >= MIN_LEGS
      ? [{ label: `--- Done  (${pendingLegs.length} LLM Provider(s) ready)`, value: '__done__' }]
      : []),
  ];

  const costEstimate = selectedApp && resolvedLegs.length > 0
    ? selectedApp.passCount * resolvedLegs.length * 0.002
    : 0;

  // Progress bar (#1443): count completed providers from progress messages
  const completedLegs = progressLines.filter(l => l.includes(': complete')).length;
  const startingLegs = progressLines.filter(l => l.includes(': starting')).length;
  const inFlightLegs = Math.max(0, startingLegs - completedLegs);
  const progressValue = completedLegs + (inFlightLegs > 0 ? 0.5 : 0);
  const lastStartLine = [...progressLines].reverse().find(l => l.includes(': starting'));
  const currentLegLabel = lastStartLine
    ? (lastStartLine.match(/\(([^)]+)\)/)?.[1] ?? '')
    : (resolvedLegs[0] ? `${resolvedLegs[0].connector} / ${resolvedLegs[0].model}` : '');

  // Model picker helpers for pick-model stage (nextLeg is the leg being configured)
  const activeConn = nextLeg?.connector.file.connector;
  const GW_PICKER_CAP = 40;
  const fmtCost = (v: number): string => String(+v.toFixed(4));
  const catalogue = activeConn?.models.catalogue ?? [];
  const modelOptions = activeConn && nextLeg ? [
    { label: 'Other model...  (type any model id the platform serves)', value: '__custom__' },
    ...catalogue.slice(0, GW_PICKER_CAP).map(m => ({
      label: `${m.id}` +
        (m.id === nextLeg.model ? '  (current)' : (m.id === activeConn.models.default ? '  (default)' : '')) +
        (m.cost ? `  [$${fmtCost(m.cost.input_per_million)}/M in, $${fmtCost(m.cost.output_per_million)}/M out]` : ''),
      value: m.id,
    })),
  ] : [];

  // Previous-run leg summary for guidance hint
  const prevLegHint = llmCfg?.legs
    ? llmCfg.legs.map((l) => `${l.connector} / ${l.model}`).join(', ')
    : 'none';

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const stageSubtitle: Record<Stage, string> = {
    loading:          'LLM Assessment',
    'picking-app':    'Select Application',
    'no-apps':        'No Eligible Apps',
    'no-legs':        'No Connectors',
    'build-legs':     'Select LLM Providers',
    'pick-model':     'Select Model',
    'pick-model-custom': 'Custom Model',
    'health-check':   'Connectivity Check',
    'review-config':  'Review Configuration',
    running:          'Running',
    saving:           'Complete',
    done:             'Complete',
    error:            'Error',
  };
  return (
    <Box flexDirection="column" paddingX={1}>
      <Header contextPrefix="LLM Assessment" subtitle={stageSubtitle[stage]} />

      {stage === 'loading' && <Text>Loading workspace...</Text>}

      {stage === 'no-apps' && (
        <Box flexDirection="column">
          <Text color="yellow">No eligible applications found.</Text>
          <Text>Run `swao assess --app &lt;id&gt;` first to complete at least one App Assessment.</Text>
          <Box marginTop={1}>
            <GuidanceBox
              title="LLM Assessment -- No Apps"
              what="The LLM Assessment compares how different LLM connectors perform on your application's pass suite. You need at least one completed Application Assessment run before you can run LLM Assessment."
              details={[{ label: 'Next step', value: 'Run `swao assess --app <id>` then return here.' }]}
              affordances={['Esc -- go back']}
              onOpenChange={(open) => { guidanceOpenRef.current = open; }}
            />
          </Box>
        </Box>
      )}

      {stage === 'no-legs' && (
        <Box flexDirection="column">
          <Text color="yellow">No LLM connectors configured in this workspace.</Text>
          <Text>Run `swao setup` to configure at least two LLM connectors, then try again.</Text>
          <Box marginTop={1}>
            <GuidanceBox
              title="LLM Assessment -- No Connectors"
              what="LLM Assessment compares multiple LLM legs on your application pass suite. You need at least two connectors configured in your workspace (wsp/inputs/llm-gateway/) via `swao setup`."
              affordances={['Esc -- go back']}
              onOpenChange={(open) => { guidanceOpenRef.current = open; }}
            />
          </Box>
        </Box>
      )}

      {stage === 'build-legs' && (
        <Box flexDirection="column">
          {pendingLegs.length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold>LLM Providers ({pendingLegs.length}/{MAX_LEGS}):</Text>
              {pendingLegs.map((leg, i) => (
                <Text key={i} color="green">  [{i + 1}] {leg.connectorId} / {leg.model}</Text>
              ))}
            </Box>
          )}
          {buildError && (
            <Box marginBottom={1}><Text color="yellow">{buildError}</Text></Box>
          )}
          <SelectInput
            label={pendingLegs.length === 0
              ? 'Select connector for LLM Provider 1:'
              : `Add LLM Provider ${pendingLegs.length + 1} -- or select Done:`}
            options={buildLegOptions}
            onSelect={handleConnectorSelect}
            active={!guidanceOpenRef.current}
          />
          <GuidanceBox
            title="LLM Assessment -- Select LLM Providers"
            what={`Add LLM Providers one at a time. Each provider is one connector + one model. You can add the same connector (e.g. OpenRouter) multiple times with different models to compare them head-to-head. Minimum ${MIN_LEGS}, maximum ${MAX_LEGS} providers.`}
            details={[
              { label: 'Auth',      value: 'Keys are per-connector (set via swao setup). A connector marked [no key] will fail the connectivity check.' },
              { label: 'Previous',  value: prevLegHint },
              { label: 'Remove',    value: 'Esc removes the last provider from the list.' },
            ]}
            affordances={['Enter -- select  |  Esc -- remove last provider / back to app picker']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {stage === 'pick-model' && nextLeg && activeConn && (
        <Box flexDirection="column">
          <Text bold>LLM Provider {pendingLegs.length + 1} -- Select model</Text>
          <Text>  Connector: <Text color="cyanBright">{activeConn.name}</Text>  [{nextLeg.connectorId}]</Text>
          {catalogue.length === 0 ? (
            <Box marginTop={1}>
              <TextInput
                key={`pick-model-notxt-${pendingLegs.length}`}
                label={`Model id (Enter for default: ${activeConn.models.default})`}
                initialValue={nextLeg.model}
                onSubmit={(v) => { handleModelSelect(v.trim() || activeConn.models.default); }}
              />
            </Box>
          ) : (
            <Box marginTop={1}>
              <SelectInput
                label="Model"
                options={modelOptions}
                onSelect={(v) => {
                  if (v === '__custom__') {
                    setStage('pick-model-custom');
                    return;
                  }
                  handleModelSelect(v);
                }}
                active={!guidanceOpenRef.current}
                visibleCount={PICKER_VISIBLE_COUNT}
              />
            </Box>
          )}
          <GuidanceBox
            title={`Select model -- ${activeConn.name}`}
            what={`Pick the model this leg will use. Only models in your workspace catalogue are shown${activeConn.models.discovery_endpoint ? '; "Other..." lets you type any model id the platform serves' : ' -- add more via swao setup'}. Your choice is written to portfolio .swao.yml.`}
            details={[
              { label: 'Default', value: activeConn.models.default },
              { label: 'Current', value: nextLeg.model },
              ...(activeConn.sovereignty?.data_residency
                ? [{ label: 'Residency', value: String(activeConn.sovereignty.data_residency) }]
                : []),
            ]}
            affordances={['Up/Down -- select  |  Enter -- confirm  |  Esc -- back to leg builder']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {stage === 'pick-model-custom' && nextLeg && activeConn && (
        <Box flexDirection="column">
          <Text bold>LLM Provider {pendingLegs.length + 1} -- Custom model</Text>
          <Text>  Connector: <Text color="cyanBright">{activeConn.name}</Text>  [{nextLeg.connectorId}]</Text>
          <Box marginTop={1}>
            <TextInput
              key={`pick-model-custom-${pendingLegs.length}`}
              label={`Model id (leave blank for default: ${activeConn.models.default})`}
              initialValue=""
              onSubmit={(v) => { handleModelSelect(v.trim() || activeConn.models.default); }}
            />
          </Box>
          <GuidanceBox
            title="Custom model id"
            what="Type the model identifier exactly as the platform expects it. For aggregators, use the vendor-prefixed id (e.g. google/gemini-2.0-flash-001, mistralai/mistral-large)."
            affordances={['Enter -- confirm  |  Esc -- back to leg builder']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {stage === 'health-check' && nextLeg && activeConn && (
        <Box flexDirection="column">
          <Text bold>LLM Provider {pendingLegs.length + 1} -- Connectivity check</Text>
          <Text>
            Connector: <Text color="cyanBright">{activeConn.name}</Text>
            {'  '}Model: <Text color="cyanBright">{nextLeg.model}</Text>
          </Text>
          <Box marginTop={1}>
            {healthStatus === 'running' && <Text dimColor>Pinging endpoint... (up to 10s)</Text>}
            {healthStatus === 'ok' && (
              <Text color="green">PASS -- {healthMessage}</Text>
            )}
            {healthStatus === 'fail' && (
              <Box flexDirection="column">
                <Text color="yellow">WARNING -- {healthMessage}</Text>
                <Text dimColor>You can continue anyway (e.g. air-gapped legs) or go back to change the model.</Text>
              </Box>
            )}
          </Box>
          {healthStatus !== 'running' && (
            <Box marginTop={1}>
              <Text dimColor>
                Enter -- add to leg set  |  Esc -- change model
              </Text>
            </Box>
          )}
          <GuidanceBox
            title="Connectivity check"
            what="A minimal prompt is sent to the connector/model combination to verify the endpoint is reachable and the API key is valid. FAIL does not block the assessment -- you can continue and inspect the findings log for details."
            details={[
              { label: 'Timeout',  value: '10 seconds per connector' },
              { label: 'Cost',     value: 'Negligible -- single short prompt' },
              { label: 'Air-gap',  value: 'Pings will FAIL for intentionally air-gapped connectors -- this is expected.' },
            ]}
            affordances={['Enter -- add to leg set  |  Esc -- change model']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {stage === 'picking-app' && (
        <Box flexDirection="column">
          <SelectInput
            label="Select application to assess:"
            options={eligibleApps.map((a) => ({
              label: `${a.id}  (${a.passCount} pass(es))`,
              value: a.id,
            }))}
            onSelect={handleAppSelect}
            active={!guidanceOpenRef.current}
          />
          <GuidanceBox
            title="LLM Assessment -- Select Application"
            what="Select the application whose pass suite will be used to benchmark your LLM providers. The application must have at least one completed App Assessment run. SWAO will run the same pass suite through each LLM Provider you configure."
            details={[
              { label: 'Requirement', value: 'At least one completed `swao assess --app <id>` run.' },
              { label: 'Next steps',  value: 'After selecting an app you will configure which LLM Providers to compare.' },
            ]}
            affordances={['Up/Down -- select  |  Enter -- confirm  |  Esc -- back to menu']}
            onOpenChange={(open) => { guidanceOpenRef.current = open; }}
          />
        </Box>
      )}

      {stage === 'review-config' && selectedApp && resolvedLegs.length > 0 && (
        <Box flexDirection="column">
          <Text bold>Review LLM Assessment configuration</Text>
          <Box flexDirection="column" marginTop={1}>
            <Text>Application : {selectedApp.id}</Text>
            <Text>LLM Providers ({resolvedLegs.length}):</Text>
            {resolvedLegs.map((leg) => (
              <Text key={leg.id}>  {leg.connector} / {leg.model}{leg.primary ? '  [primary]' : ''}</Text>
            ))}
          </Box>
          <Box marginTop={1}>
            <Text>
              Estimated cost: ~${costEstimate.toFixed(3)}
              {'  '}({selectedApp.passCount} pass(es) x {resolvedLegs.length} LLM Provider(s) x $0.002)
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Enter -- start assessment   Esc -- back to provider builder</Text>
          </Box>
          <Box marginTop={1}>
            <GuidanceBox
              title="LLM Assessment -- Review Configuration"
              what="Confirm the LLM Providers and cost estimate before starting. Each provider will run the full pass suite independently; results are compared with weighted dimension scoring."
              details={[
                { label: 'Cost basis', value: '$0.002 per pass per LLM Provider (approximate; depends on model pricing).' },
                { label: 'Duration',   value: 'Serial mode: providers run one at a time. Parallel mode: providers run concurrently.' },
              ]}
              affordances={['Enter -- start  |  Esc -- back to provider builder']}
              initiallyCollapsed
              onOpenChange={(open) => { guidanceOpenRef.current = open; }}
            />
          </Box>
        </Box>
      )}

      {stage === 'running' && (
        <Box flexDirection="column">
          <Text bold>Running LLM Assessment...</Text>
          {/* #1585: ensure at least 0.5 progress when running but no messages yet */}
          <ProgressBar
            value={progressValue > 0 ? progressValue : 0.5}
            total={resolvedLegs.length}
            label={completedLegs < resolvedLegs.length
              ? `LLM Provider ${completedLegs + 1}/${resolvedLegs.length}: ${currentLegLabel}`
              : 'All LLM Providers complete'}
            color={completedLegs >= resolvedLegs.length ? 'green' : 'cyan'}
            width={28}
          />
          {progressLines.slice(-6).map((line, i) => (
            <Text key={i} dimColor>{line}</Text>
          ))}
          {/* #1477: per-call progress from the active leg's app event log */}
          {legCallLines.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              {legCallLines.map((line, i) => (
                <Text key={i} color="white" dimColor>{line}</Text>
              ))}
            </Box>
          )}
          {/* #1586: stable key prevents GuidanceBox remount when legCallLines appear */}
          <Box key="guidance-running" marginTop={1}>
            <GuidanceBox
              title="LLM Assessment -- Running"
              what="Each provider runs the full pass suite in serial. Results are saved to the run folder. Do not close this window until the assessment completes."
              details={[
                { label: 'Providers', value: `${resolvedLegs.length} total -- running in serial` },
                { label: 'App',       value: selectedApp?.id ?? '' },
                { label: 'Duration',  value: `Approx ${resolvedLegs.length * 5}-${resolvedLegs.length * 10} min total (varies by model latency)` },
                { label: 'Cancel',    value: 'Ctrl+C to cancel -- partial results are saved to the run folder' },
                { label: 'Log',       value: 'llm-assessments/swao/<timestamp>/log.ndjson' },
              ]}
              affordances={['Ctrl+G -- open/close this guidance  |  Ctrl+C to cancel']}
              initiallyCollapsed
              onOpenChange={(open) => { guidanceOpenRef.current = open; }}
            />
          </Box>
        </Box>
      )}

      {stage === 'saving' && result && (
        <Box flexDirection="column">
          <Box marginBottom={1}><Text bold color="green">Assessment complete.</Text></Box>
          <LlmResultTable result={result} legs={resolvedLegs} />
          <Box marginTop={1}><Text dimColor>Saving results...</Text></Box>
        </Box>
      )}

      {stage === 'done' && result && (
        <Box flexDirection="column">
          <Box marginBottom={1}><Text bold color="green">Assessment complete.</Text></Box>
          <LlmResultTable result={result} legs={resolvedLegs} />
          <Box marginTop={1}><Text dimColor>Esc -- back to menu</Text></Box>
          <Box marginTop={1}>
            <GuidanceBox
              title="LLM Assessment -- Complete"
              what="Assessment complete. Results show score (0-100) and rank per dimension group. Publish an HTML report via the Publish menu (option 5) to share with stakeholders."
              affordances={['Esc -- back to main menu']}
              initiallyCollapsed
              onOpenChange={(open) => { guidanceOpenRef.current = open; }}
            />
          </Box>
        </Box>
      )}

      {stage === 'error' && (
        <Box flexDirection="column">
          <Text color="red">LLM Assessment failed:</Text>
          <Box marginTop={1}><Text>{errorMsg}</Text></Box>
          <Box marginTop={1}>
            <GuidanceBox
              title="LLM Assessment -- Error"
              what="The assessment could not complete. Common causes: licence tier (Consultant+ required), missing connector credentials, or a leg that returned no parseable responses."
              affordances={['Esc -- go back']}
              onOpenChange={(open) => { guidanceOpenRef.current = open; }}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
}
