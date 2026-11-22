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

import { useState, useEffect, useCallback } from 'react';
import { Text, useInput } from 'ink';
import { spawn } from 'child_process';
import { logPortfolio } from '@swao/core';
import { runWizardHealthCheck, type WizardHealthSummary } from './health-check-run.js';
import { selfSpawnCommand } from '@swao/core';
import { HealthCheckProbeList } from '@swao/module-health-check';
import type { SetupScope } from '@swao/core';
import { tone, useGuidanceOpen, type GuidanceEntry } from '@swao/tui-kit';
import { SetupStepFrame } from '../../../../setup/setup-frame.js';

// #4410: the run logic (output buffering, idle watchdog, logged summary) lives in
// health-check-run.ts so a stubbed runner can drive it in tests.
export { logSetupHealthCheckResult, runWizardHealthCheck, incompleteHealthSummary, logSetupHealthCheckTimeout, healthCheckStopText, lastProbeStartedInLog, healthIncompleteText, HEALTH_CHECK_IDLE_LIMIT_MS, HEALTH_CHECK_INCOMPLETE_PREFIX } from './health-check-run.js';
export type { WizardHealthSummary, HealthCheckStopInfo, HealthCheckChild } from './health-check-run.js';

/** #4197: the CLI arguments of the wizard's health-check run; a scope adds `--type`. Exported for tests. */
export function healthCheckArgs(scope?: SetupScope): string[] {
  return ['health-check', ...(scope ? ['--type', scope] : [])];
}

// -- Step 4: Health Check -------------------------------------------------

/** #4230: the guidance of the health check while its probes run; afterwards the box follows the highlighted probe. */
const HEALTH_CHECK_RUNNING_GUIDANCE: GuidanceEntry = {
  title: 'Health Check',
  what: 'SWAO checks the workspace: configuration, LLM connection, tools and the inputs of the chosen assessment types. Each probe reports ok, warn or fail with its cause.',
  cli: 'swao health-check',
};

export function HealthCheckStep({ onNext, scope, title }: {
  onNext: (summary?: WizardHealthSummary) => void;
  stepNumber?: number;
  /** #4197 (Design 125 section 6): run only the probes of this scope (`health-check --type`). */
  scope?: SetupScope;
  /** Heading; defaults to "Health Check" (#4254: step titles carry no number). */
  title?: string;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  // #4120: summary of this run, handed to the Ready step through onNext.
  const [summary, setSummary] = useState<WizardHealthSummary | undefined>(undefined);
  // #4348: the guidance of the selected probe goes to the wizard frame (block 8,
  // bounded by ScreenLayout), so the list counts no box of its own.
  const [probeEntry, setProbeEntry] = useState<GuidanceEntry | undefined>(undefined);
  const onCursorEntry = useCallback((e: GuidanceEntry | undefined) => { setProbeEntry(e); }, []);
  // #4394: the one guidance open state of the wizard (tui-kit guidance-open.ts).
  const guidance = useGuidanceOpen();

  useEffect(() => {
    try { logPortfolio('info', 'setup.health-check.start', 'Setup Wizard: invoking health-check probe runner', scope ? { context: { scope } } : undefined); } catch { /* best-effort */ }
    // #1234 / #2576-family / #4241: the central self-spawn helper passes no
    // script path inside a pkg binary (Commander sees 'health-check' as the
    // first positional) and sets PKG_EXECPATH to ''.
    const selfCmd = selfSpawnCommand(healthCheckArgs(scope));
    return runWizardHealthCheck({
      spawnChild: () => spawn(selfCmd.command, selfCmd.args, { stdio: ['ignore', 'pipe', 'pipe'], env: selfCmd.env }),
      scope,
      onLines: (more) => setLines((prev) => [...prev, ...more]),
      onDone: (result) => { if (result) setSummary(result); setDone(true); },
    });
  }, []);

  useInput((_input, key) => {
    if (done && key.return) onNext(summary); // #1412: one-press advance when guidance is open
  });

  // #4342: the frame draws the title and the hint line (Enter next once the
  // probes finished) instead of a hand-written hint line.
  return (
    <SetupStepFrame
      title={title ?? 'Health Check'}
      keys={done ? [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'next' }, { key: 'Esc', verb: 'abort' }] : [{ key: 'Esc', verb: 'abort' }]}
      guidance={probeEntry ?? HEALTH_CHECK_RUNNING_GUIDANCE}
    >
      {/* #4213 (Design 126 section 8 rule 5): a progress line without an ellipsis. */}
      {!done && <Text {...tone('progressRunning')}>Running the health check; each row fills in when its probe finishes.</Text>}
      {/* #4410: a run the watchdog stopped is not a clean result. */}
      {done && summary?.incomplete && <Text {...tone('error')}>{summary.incomplete.charAt(0).toUpperCase() + summary.incomplete.slice(1)}.</Text>}
      <HealthCheckProbeList
        lines={lines}
        done={done}
        active
        guidance="none"
        onCursorEntry={onCursorEntry}
        canPage={() => !guidance.isOpen()}
      />
    </SetupStepFrame>
  );
}
