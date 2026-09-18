// useLlmRunning -- running + saving + polling effects extracted from
// LlmAssessmentScreen.tsx (#2376). Manages orchestration, portfolio event
// emission, and per-call progress polling.

import { useEffect, useRef } from 'react';
import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  orchestrateLegs,
  type ResolvedLeg,
  type OrchestrationResult,
} from '@swao/module-llm-assessment';
import { setWorkspaceRoot, logPortfolio, logApp } from '@swao/core';
import type { SwaoYmlLlmAssessment } from '@swao/core';
import { LicenseGuard } from '../../../../license/license-guard.js';
import { SWAO_VERSION } from '../../../../branding.js';
import type { EligibleApp } from '../types.js';
import { spawnChallenge, spawnLzChallenge } from '../spawnHelpers.js';

const MIN_LEGS = 2;

interface UseLlmRunningParams {
  stage: string;
  selectedApp: EligibleApp | null;
  resolvedLegs: ResolvedLeg[];
  workspacePath: string;
  includeCrawl: boolean;
  llmCfg: SwaoYmlLlmAssessment | null;
  setStage: (s: string) => void;
  setResult: (r: OrchestrationResult) => void;
  setErrorMsg: (m: string) => void;
  setProgress: React.Dispatch<React.SetStateAction<string[]>>;
  setLegCallLines: React.Dispatch<React.SetStateAction<string[]>>;
  result: OrchestrationResult | null;
  legWorkspaceForPollRef: React.MutableRefObject<string | null>;
  runStartedAtRef: React.MutableRefObject<number>;
}

export function useLlmRunning({
  stage,
  selectedApp,
  resolvedLegs,
  workspacePath,
  includeCrawl,
  llmCfg,
  setStage,
  setResult,
  setErrorMsg,
  setProgress,
  setLegCallLines,
  result,
  legWorkspaceForPollRef,
  runStartedAtRef,
}: UseLlmRunningParams): void {
  // Keep stable refs to setters so the async callbacks always target the live
  // React dispatch without needing to add setters to dep arrays.
  const setStageRef    = useRef(setStage);
  const setResultRef   = useRef(setResult);
  const setErrorRef    = useRef(setErrorMsg);
  const setProgressRef = useRef(setProgress);
  const setLegCallRef  = useRef(setLegCallLines);
  setStageRef.current    = setStage;
  setResultRef.current   = setResult;
  setErrorRef.current    = setErrorMsg;
  setProgressRef.current = setProgress;
  setLegCallRef.current  = setLegCallLines;

  // ---- Stage: running ----
  useEffect(() => {
    if (stage !== 'running') return;
    if (!selectedApp || resolvedLegs.length < MIN_LEGS) return;

    runStartedAtRef.current = Date.now();
    // #2598: set workspace root once before orchestration so logApp writes to the
    // correct app NDJSON path during the onProgress callback below.
    setWorkspaceRoot(workspacePath);
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
          keepLegWsp:       cfg.keep_leg_wsp ?? false,
          passSuiteVersion: SWAO_VERSION,
          onProgress: (m) => {
            if (!cancelled) {
              setProgressRef.current((prev) => [...prev, m]);
              // #2598: persist each orchestrator progress line to the NDJSON log
              // so monitors and the log viewer can see leg-level events in real-time.
              try { logApp(selectedApp.id, 'info', 'llm.assess.progress', m); } catch { /* best-effort */ }
            }
          },
          // #2506: only pass challenge spawners for Enterprise tier; on lower tiers
          // the spawned process exits 2 (tier gate) with no output. Omitting the
          // callbacks causes the orchestrator to skip challenge entirely and emit
          // a clearer progress line instead of silent "0 agents".
          ...(() => {
            const guardState = (() => { try { return LicenseGuard.load().state; } catch { return null; } })();
            const isEnterprise = guardState?.tier === 'enterprise';
            if (!isEnterprise) {
              setProgressRef.current((prev) => [...prev, 'challenge phase: [Enterprise] not available on this tier -- skipping']);
            }
            return isEnterprise
              ? {
                  spawnChallenge:   (leg: ResolvedLeg, legWsr: string, legEnv: Record<string,string>) => spawnChallenge(selectedApp.id, workspacePath, leg, legWsr, legEnv),
                  spawnLzChallenge: (leg: ResolvedLeg, legWsr: string, legEnv: Record<string,string>) => spawnLzChallenge(selectedApp.id, workspacePath, leg, legWsr, legEnv),
                }
              : {};
          })(),
          spawnLeg: (leg, legWorkspaceRoot, legEnv) => {
            if (!cancelled) {
              legWorkspaceForPollRef.current = legWorkspaceRoot;
              setLegCallRef.current([]);
            }
            return new Promise((resolveSpawn) => {
              const started = Date.now();
              const isPkg = Boolean((process as { pkg?: unknown }).pkg);
              const cmd = process.execPath;
              const baseArgs = isPkg ? [] : [process.argv[1] ?? ''];
              const child = spawn(
                cmd,
                [...baseArgs, 'assess', '--app', selectedApp.id, '--llm', `${leg.connector}:${leg.model}`, '--no-cache', ...(includeCrawl ? [] : ['--no-crawl'])],
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
          setResultRef.current(orch);
          setStageRef.current('saving');
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setErrorRef.current(err instanceof Error ? err.message : String(err));
          setStageRef.current('error');
        }
      }
    })();

    return () => { cancelled = true; };
  }, [stage]);

  // ---- Stage: saving (#1673 + #2412) ----
  useEffect(() => {
    if (stage !== 'saving') return;

    if (result && workspacePath) {
      try {
        setWorkspaceRoot(workspacePath);
        const models = resolvedLegs.map(l => `${l.connector}${l.model !== 'default' ? ':' + l.model : ''}`);
        logPortfolio('info', 'llm_assess.complete', 'LLM Assessment run complete', {
          context: {
            run_dir: result.runDir,
            legs: resolvedLegs.length,
            findings: result.findingsCount,
            wall_clock_ms: runStartedAtRef.current > 0 ? Date.now() - runStartedAtRef.current : undefined,
            models,
          },
        });
      } catch { /* best-effort */ }
    }

    // #2614: do not auto-spawn reports here -- report generation is a deliberate
    // manual step. Transition to 'done' immediately after logging completion.
    const handle = setImmediate(() => setStageRef.current('done'));
    return () => clearImmediate(handle);
  }, [stage]);

  // ---- Stage: running -- per-call progress polling (#1477) ----
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
      if (newLogPath !== currentLogPath) { currentLogPath = newLogPath; seenCount = 0; }
      if (!existsSync(currentLogPath)) return;

      let raw: string;
      try { raw = readFileSync(currentLogPath, 'utf-8'); } catch { return; }
      const lines = raw.split('\n').filter(l => l.trim());
      const newLines: string[] = [];
      for (let i = seenCount; i < lines.length; i++) {
        try {
          const entry = JSON.parse(lines[i]) as { code?: string; message?: string; context?: Record<string, unknown> };
          const code = entry.code ?? '';
          const ctx = (entry.context ?? {}) as Record<string, unknown>;
          let callLine: string | null = null;
          // #2598: show orchestrator-level progress lines (leg start/complete/challenge) in real-time
          if (code === 'llm.assess.progress') {
            callLine = entry.message ?? '';
          } else if (code === 'assessment.pass.start') {
            callLine = `  pass ${String(ctx['num'] ?? '?')} -- ${String(ctx['name'] ?? ctx['pass'] ?? '?')} starting`;
          } else if (code === 'assessment.pass.complete') {
            const ms = typeof ctx['wall_clock_ms'] === 'number' ? `${Math.round((ctx['wall_clock_ms'] as number) / 1000)}s` : '?';
            callLine = `  pass ${String(ctx['num'] ?? '?')} -- ${String(ctx['name'] ?? ctx['pass'] ?? '?')} complete (${ms})`;
          } else if (/^provider\.llm\.[^.]+\.retry$/.test(code)) {
            callLine = `    retrying (attempt ${typeof ctx['attempt'] === 'number' ? String(ctx['attempt']) : '?'})`;
          } else if (/^provider\.llm\.[^.]+\.ok$/.test(code)) {
            const ms = typeof ctx['latency_ms'] === 'number' ? `${Math.round((ctx['latency_ms'] as number) / 1000)}s` : '?';
            const att = typeof ctx['attempt'] === 'number' ? ` call ${ctx['attempt']}` : '';
            callLine = `    LLM${att} complete (${ms})`;
          }
          if (callLine) newLines.push(callLine);
        } catch { /* skip */ }
      }
      seenCount = lines.length;
      if (newLines.length > 0) {
        setLegCallRef.current(prev => [...prev, ...newLines].slice(-10));
      }
    }, 1500);

    return () => clearInterval(timer);
  }, [stage, selectedApp?.id]);
}
