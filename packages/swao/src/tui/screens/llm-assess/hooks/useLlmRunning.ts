// useLlmRunning -- running + saving + polling effects extracted from
// LlmAssessmentScreen.tsx (#2376). Manages orchestration, portfolio event
// emission, and per-call progress polling.

import { useEffect, useRef } from 'react';
import {
  orchestrateLegs,
  type ResolvedLeg,
  type OrchestrationResult,
  type LegChallengeContext,
  type LegSpawnHooks,
} from '@swao/module-llm-assessment';
import { setWorkspaceRoot, logPortfolio, logApp } from '@swao/core';
import type { SwaoYmlLlmAssessment } from '@swao/core';
import { LicenseGuard } from '../../../../license/license-guard.js';
import { SWAO_VERSION } from '../../../../branding.js';
import type { EligibleApp } from '../types.js';
import { spawnChallenge, spawnLzChallenge } from '../spawnHelpers.js';
import { createLegPreflight } from '../../../../commands/llm-leg-preflight.js';
import { spawnLegProcess } from '../../../../commands/llm-leg-spawn.js';
import { createLegLogPoller } from '../legLogPoller.js';
import { legPriceWarning } from '../../../../commands/llm-leg-cost.js';

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
  /** #4472: passes the polled leg has completed (Stage bar), with that leg's id. */
  setLegPassesDone?: (n: number, legId?: string) => void;
  result: OrchestrationResult | null;
  legWorkspaceForPollRef: React.MutableRefObject<string | null>;
  runStartedAtRef: React.MutableRefObject<number>;
  /** #4243: transient preparation line (null clears it). */
  setStatusLine: (line: string | null) => void;
  /** #4243: Esc cancel aborts this controller (created per run). */
  abortRef: React.MutableRefObject<AbortController | null>;
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
  setLegPassesDone,
  result,
  legWorkspaceForPollRef,
  runStartedAtRef,
  setStatusLine,
  abortRef,
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
  const setPassesRef   = useRef(setLegPassesDone);
  setPassesRef.current   = setLegPassesDone;
  // #4472: the leg whose log the poll reads; its passes never count for another leg.
  const pollLegRef = useRef<string | null>(null);
  const setStatusRef   = useRef(setStatusLine);
  setStatusRef.current   = setStatusLine;

  // ---- Stage: running ----
  useEffect(() => {
    if (stage !== 'running') return;
    if (!selectedApp || resolvedLegs.length < MIN_LEGS) return;

    runStartedAtRef.current = Date.now();
    // #2598: set workspace root once before orchestration so logApp writes to the
    // correct app NDJSON path during the onProgress callback below.
    setWorkspaceRoot(workspacePath);
    let cancelled = false;
    const abort = new AbortController();
    abortRef.current = abort;

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
          signal: abort.signal,
          // #4242: the application run the comparison refers to (run.start, publication model).
          ...(selectedApp.suiteRun ? { suiteRun: { runTs: selectedApp.suiteRun.runTs, assessmentType: 'application', passCount: selectedApp.suiteRun.passCount } } : {}),
          onStatus: (line) => { if (!cancelled) setStatusRef.current(line); },
          // #4244 (Design 092 section 7.2a): the leg command is checked with
          // `assess --preflight` in the main workspace before its leg workspace is
          // copied; a failure ends the leg in red with the real reason.
          preflightLeg: createLegPreflight({ workspaceRoot: workspacePath, appId: selectedApp.id, crawl: includeCrawl, signal: abort.signal }),
          // #4372: warn before the run about candidates without a price (shared with the CLI).
          pricePreflight: (leg) => legPriceWarning(leg, workspacePath),
          onProgress: (m) => {
            if (!cancelled) {
              setProgressRef.current((prev) => [...prev, m]);
              // #2598: persist each orchestrator progress line to the NDJSON log
              // so monitors and the log viewer can see leg-level events in real-time.
              // #4243: one event family (llm_assess.*); failed legs log at error level.
              const level = /: failed\b/.test(m) ? 'error' : 'info';
              try { logApp(selectedApp.id, level, 'llm_assess.progress', m); } catch { /* best-effort */ }
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
              setProgressRef.current((prev) => [...prev, 'challenge phase: needs the Enterprise tier, skipped']);
            }
            return isEnterprise
              ? {
                  // #4277: challenges run in the leg workspace on the staged run (ctx).
                  // #4478: the challenge signal (Esc cancel or a fired challenge limit) kills the challenge tree.
                  spawnChallenge:   (leg: ResolvedLeg, legWsr: string, legEnv: Record<string,string>, ctx: LegChallengeContext, signal?: AbortSignal, hooks?: LegSpawnHooks) => spawnChallenge(selectedApp.id, workspacePath, leg, legWsr, legEnv, ctx, signal, hooks),
                  spawnLzChallenge: (leg: ResolvedLeg, legWsr: string, legEnv: Record<string,string>, ctx: LegChallengeContext, signal?: AbortSignal, hooks?: LegSpawnHooks) => spawnLzChallenge(selectedApp.id, workspacePath, leg, legWsr, legEnv, ctx, signal, hooks),
                }
              : {};
          })(),
          spawnLeg: (leg, legWorkspaceRoot, legEnv, signal, hooks) => {
            if (!cancelled) {
              legWorkspaceForPollRef.current = legWorkspaceRoot;
              pollLegRef.current = leg.id;
              setLegCallRef.current([]);
              setPassesRef.current?.(0, leg.id);
            }
            // #4241 / #4244 / #4470: the shared leg spawn (CLI parity): self-spawn with
            // the preflight argv, both pipes drained (#4243), the PID to the orchestrator,
            // and the leg signal (Esc cancel or a fired leg limit) stops the process tree by PID.
            return spawnLegProcess({
              appId: selectedApp.id, leg, legWorkspaceRoot, legEnv, crawl: includeCrawl,
              ...(signal ? { signal } : {}), ...(hooks ? { hooks } : {}),
            });
          },
        });

        // #4256: after an Esc cancel (RunPanel aborts, then the screen returns to the review) the result stays unused.
        if (!cancelled && !abort.signal.aborted) {
          setStatusRef.current(null);
          setResultRef.current(orch);
          setStageRef.current('saving');
        }
      } catch (err: unknown) {
        if (!cancelled && !abort.signal.aborted) {
          setErrorRef.current(err instanceof Error ? err.message : String(err));
          setStageRef.current('error');
        }
      }
    })();

    return () => { cancelled = true; abortRef.current = null; };
  }, [stage]);

  // ---- Stage: saving (#1673 + #2412) ----
  useEffect(() => {
    if (stage !== 'saving') return;

    if (result && workspacePath) {
      try {
        setWorkspaceRoot(workspacePath);
        const models = resolvedLegs.map(l => `${l.connector}${l.model !== 'default' ? ':' + l.model : ''}`);
        // #4243: the status says whether the comparison is complete.
        const level = result.status === 'complete' ? 'info' : result.status === 'failed' ? 'error' : 'warn';
        logPortfolio(level, 'llm_assess.complete', `LLM Assessment run ${result.status}`, {
          context: {
            run_dir: result.runDir,
            status: result.status,
            legs_failed: result.legs.filter((l) => l.status === 'failed').map((l) => ({ id: l.id, reason: l.reason ?? null })),
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

    // #4479: only the bytes added since the last tick are read (was the whole leg log every 1.5 s).
    const poller = createLegLogPoller(selectedApp.id);
    const timer = setInterval(() => {
      const { lines: newLines, passesDone } = poller.poll(legWorkspaceForPollRef.current);
      if (newLines.length > 0) {
        setLegCallRef.current(prev => [...prev, ...newLines].slice(-10));
      }
      if (passesDone !== null) setPassesRef.current?.(passesDone, pollLegRef.current ?? undefined);
    }, 1500);
    return () => clearInterval(timer);
  }, [stage, selectedApp?.id]);
}
