// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// The run screen of the Application and LZ Catalog flows (#2371), shared by
// AppAssessmentScreen and LzAssessmentScreen. All subprocess management stays
// in the parent screen's state machine; this view only draws.
//
// #4256 (TUI-12, Design 126 sections 4.6 and 7.6, A-20): FlowFrame (header,
// licence line, step bar on Run) with RunPanel as the content: the title says
// what the run does, the stage line names the pass or target that runs now,
// the output is titled and wrapped, and the guidance box follows the run state
// (runGuidance). Keys: `Esc cancel` only; RunPanel asks with the AbortDialog
// first and then calls onCancel, where the screen stops the child process and
// returns to the step that started the run. An open guidance box takes Esc
// first, so the panel gets the box state as React state.

import { useEffect, useState } from 'react';
import { RunPanel, RUN_PANEL_KEYS } from '@swao/tui-kit';
import { FlowFrame, type FlowHeader } from './flow-frame.js';
import { runGuidance, runStage, runTitle, type RunState } from './run-view.js';

export interface RunningPhaseProps {
  header: FlowHeader;
  steps: readonly string[];
  /** The Run step of the step bar. */
  current: number;
  run: RunState;
  /** Run output, oldest first. */
  lines: readonly string[];
  /** Called once after the operator confirmed the cancel. */
  onCancel(): void;
  /** Keeps the screen's guidance ref in step with the box. */
  onGuidanceOpenChange?(open: boolean): void;
  /** Output lines shown (default 5, so the guidance box stays on screen). */
  maxLines?: number;
  /** Start of the run (epoch ms); default the mount time. */
  startedAt?: number;
  env?: Readonly<Record<string, string | undefined>>;
}

export function RunningPhase({ header, steps, current, run, lines, onCancel, onGuidanceOpenChange, maxLines = 5, startedAt, env }: RunningPhaseProps): JSX.Element {
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const [start] = useState(() => startedAt ?? Date.now());
  const [now, setNow] = useState(() => Date.now());
  // Heartbeat: the child is silent for minutes during LLM passes (#3169).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <FlowFrame
      header={header}
      steps={steps}
      current={current}
      keys={RUN_PANEL_KEYS}
      guidance={{ entry: runGuidance(run), initiallyCollapsed: true }}
      onGuidanceOpenChange={(open) => { setGuidanceOpen(open); onGuidanceOpenChange?.(open); }}
      dialog={null}
    >
      <RunPanel
        title={runTitle(run)}
        progress={runStage(run, Math.max(0, now - start))}
        lines={lines}
        maxLines={maxLines}
        onCancel={onCancel}
        guidanceOpen={guidanceOpen}
        {...(env ? { env } : {})}
      />
    </FlowFrame>
  );
}
