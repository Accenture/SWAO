// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, LLM Assessment running stage (#2374)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import React, { useState, useEffect, useRef } from 'react';
import { Box } from 'ink';
import { RunPanel, RUN_PANEL_KEYS, type GuidanceEntry } from '@swao/tui-kit';
import { LlmStageFrame } from '../stage-frame.js';
import { candidateLabels } from '@swao/core';
import { CHALLENGES_FINISHED, type ResolvedLeg } from '@swao/module-llm-assessment';
import { modelLabel } from '../../../model-label.js';

/**
 * #4372: a progress line with each leg id replaced by its short candidate
 * label (display only; the raw line is kept for the status checks).
 */
export function labelProgressLine(line: string, labels: Record<string, string>): string {
  // Longest id first and with the colon, so an id that is a prefix of
  // another (claude-sonnet-4 and claude-sonnet-4-5) never rewrites it.
  let out = line;
  const entries = Object.entries(labels).sort((a, b) => b[0].length - a[0].length);
  for (const [id, label] of entries) out = out.split(`leg ${id}:`).join(`${label}:`);
  return out;
}

/**
 * #2548 / #4243: the progress line that ends a leg. 'leg X: complete (N calls)',
 * 'leg X: failed: <reason>' or 'leg X: cancelled'; NOT 'leg X: challenge complete'.
 */
export function isLegEndLine(line: string): boolean {
  return /^leg \S+: (complete \(|failed\b|cancelled\b)/.test(line);
}

/**
 * #4453: the legs whose challenge phase runs now: a "running ... challenge"
 * line of the leg and no "challenges finished" line after it (more than one
 * only in parallel execution).
 */
export function legsInChallenge(legs: readonly ResolvedLeg[], progressLines: readonly string[]): ResolvedLeg[] {
  const out: ResolvedLeg[] = [];
  for (const leg of legs) {
    const prefix = `leg ${leg.id}: `;
    let running = false;
    for (const l of progressLines) {
      if (!l.startsWith(prefix)) continue;
      const rest = l.slice(prefix.length);
      if (/^running .*challenge/.test(rest)) running = true;
      else if (rest.startsWith(CHALLENGES_FINISHED)) running = false;
    }
    if (running) out.push(leg);
  }
  return out;
}

/** #4453: the elapsed time of a status line ("leg x: challenge running, 1m 5s"), or undefined. */
function statusElapsedOf(statusLine: string | null | undefined, prefix: string): string | undefined {
  if (!statusLine || !statusLine.startsWith(prefix)) return undefined;
  const m = /, (\d+(?:m \d+)?s)$/.exec(statusLine);
  return m ? m[1] : undefined;
}

/** #4472: the two stages of an LLM Assessment run, named in the subtitle. */
export const LLM_STAGE_NAMES = ['LLM Providers', 'synthesis'] as const;

/** #4472: challenge phases per leg (stakeholder challenge, LZ challenge) after the pass suite. */
const CHALLENGE_UNITS = 2;

/**
 * #4472: share of stage 1 done, summed over the legs: a finished leg counts 1;
 * a leg in (or after) its challenges counts the whole pass suite plus its
 * challenges done; the leg the passes belong to (`passesLeg`, the leg whose
 * log is polled) counts its passes done. The passes of a finished leg never
 * count for the next one. Without `passesLeg` the passes belong to the first
 * unfinished leg while no leg is in its challenge (older callers). Without a
 * pass total only finished legs count. The screen keeps the value monotonic
 * (RunningStage).
 */
export function llmStageShare(
  legs: readonly ResolvedLeg[], progressLines: readonly string[], passesDone: number, passTotal: number | undefined, passesLeg?: string,
): number {
  const total = Math.max(1, legs.length);
  const state = llmRunState(legs, progressLines);
  if (state.synthesising) return 1;
  if (!passTotal || passTotal <= 0) return Math.min(1, state.completed / total);
  const inChallenge = new Set(legsInChallenge(legs, progressLines).map((l) => l.id));
  const ended = (id: string): boolean => progressLines.some((l) => l.startsWith(`leg ${id}: `) && isLegEndLine(l) && !inChallenge.has(id));
  const target = passesLeg ?? (inChallenge.size === 0 ? legs.find((l) => !ended(l.id))?.id : undefined);
  let sum = 0;
  for (const leg of legs) {
    if (ended(leg.id)) { sum += 1; continue; }
    const prefix = `leg ${leg.id}: `;
    const challengesDone = progressLines.filter((l) => l.startsWith(prefix)
      && /^(challenge (complete|ended|failed)|stakeholder challenge not run|LZ challenge (complete|ended|failed|not run))/.test(l.slice(prefix.length))).length;
    const passes = inChallenge.has(leg.id) || challengesDone > 0 ? passTotal
      : leg.id === target ? Math.min(passTotal, Math.max(0, passesDone)) : 0;
    sum += Math.min(1, (passes + Math.min(CHALLENGE_UNITS, challengesDone)) / (passTotal + CHALLENGE_UNITS));
  }
  return Math.min(1, sum / total);
}

/** #4472: the Stage bar never moves back within one run (the highest share so far). */
export function useMonotonicShare(share: number, runKey: string): number {
  const ref = useRef<{ key: string; max: number }>({ key: runKey, max: 0 });
  if (ref.current.key !== runKey) ref.current = { key: runKey, max: 0 };
  ref.current.max = Math.max(ref.current.max, share);
  return ref.current.max;
}

/** #4243: a failed leg or a failed challenge line (shown in red). */
export function isFailedLine(line: string): boolean {
  return /^leg \S+: (failed\b|challenge failed|LZ challenge failed)/.test(line);
}

export interface RunningStageProps {
  resolvedLegs: ResolvedLeg[];
  progressLines: string[];
  legCallLines: string[];
  selectedAppId: string;
  /** #4243: transient preparation progress (copy, hash). */
  statusLine?: string | null;
  /** #4256: the orchestrator's AbortController (the run folder is marked cancelled on abort). */
  abort?: AbortController | null;
  /** #4256: called once after the operator confirmed the cancel; return to the review. */
  onCancel(): void;
  guidanceOpen: boolean;
  onGuidanceOpenChange: (open: boolean) => void;
  /** Start of the run (epoch ms); default the mount time. */
  startedAt?: number;
  /** #4472: passes the running leg has completed (from its event log). */
  legPassesDone?: number;
  /** #4472: the leg the passes done belong to (the leg whose log is polled). */
  legPassesLeg?: string;
  /** #4472: passes of the pass suite (the suite run of the comparison). */
  passTotal?: number;
}

/** #4256: the run state of an LLM Assessment, from the progress lines. */
export function llmRunState(legs: readonly ResolvedLeg[], progressLines: readonly string[], statusLine?: string | null): {
  completed: number; total: number; synthesising: boolean; label: string; guidance: GuidanceEntry;
} {
  const total = Math.max(1, legs.length);
  // #4453: a leg whose challenge still runs is not finished yet.
  const inChallenge = legsInChallenge(legs, progressLines);
  const challenging = inChallenge[0];
  // #2548 / #4243: a complete, failed or cancelled leg is finished ('challenge complete' is not).
  const ended = progressLines.filter((l) => isLegEndLine(l)).length - inChallenge.length;
  const completed = Math.max(0, Math.min(total, ended));
  const synthesising = completed >= legs.length && legs.length > 0;
  const labels = candidateLabels([...legs]);
  const current = legs[completed];
  const nameOf = (l: ResolvedLeg): string => `${labels[l.id] ?? l.id}, ${l.connector} ${modelLabel(l.model)}`;
  // #4453: the synthesis step from the orchestrator status ("Synthesising: <step>, <elapsed>").
  const synthDetail = statusLine?.startsWith('Synthesising: ')
    ? statusLine.slice('Synthesising: '.length)
    : statusLine ? labelProgressLine(statusLine, labels) : undefined;
  const challengeElapsed = challenging ? statusElapsedOf(statusLine, `leg ${challenging.id}: challenge running`) : undefined;
  const label = synthesising
    ? (synthDetail ? `Synthesising the results: ${synthDetail}` : 'Synthesising the results')
    : challenging
      ? `Challenge of ${nameOf(challenging)}${challengeElapsed ? `, ${challengeElapsed}` : ''}`
    : progressLines.length === 0
      ? (statusLine ? `Preparing: ${statusLine}` : 'Preparing: copying the app and the pass suite')
      : `LLM Provider ${completed + 1} of ${total}: ${current ? nameOf(current) : ''}`;
  const legend = legs.map((l) => `${labels[l.id] ?? l.id}: ${l.connector} ${modelLabel(l.model)}`).join('; ');
  const guidance: GuidanceEntry = synthesising
    ? { title: 'Synthesising the results', what: 'Every LLM Provider has finished. SWAO compares the results with the weighted dimension scores and writes the score table to the run folder.', sections: [{ label: 'Providers', text: legend }] }
    : challenging
      ? { title: `Challenge of LLM Provider ${completed + 1} of ${total}`, what: 'The stakeholder challenge and the LZ Sovereignty Challenge of this LLM Provider run on its own application run. The provider counts as finished after its challenges.', sections: [{ label: 'Providers', text: legend }] }
    : progressLines.length === 0
      ? { title: 'Preparing the run', what: 'SWAO copies the app and the pass suite into a work folder per LLM Provider. The first provider starts after the copy.', sections: [{ label: 'Providers', text: legend }] }
      : { title: `LLM Provider ${completed + 1} of ${total}`, what: 'Each LLM Provider runs the full pass suite on its own, one after the other. Finished providers stay in the run folder when the run is cancelled.', sections: [{ label: 'Providers', text: legend }, { label: 'Duration', text: `about ${legs.length * 5} to ${legs.length * 10} min in total, depending on the model` }] };
  return { completed, total, synthesising, label, guidance };
}


// #4256 (Design 126 sections 4.6 and 7.6): RunPanel with the stage name and
// the LLM Provider that runs now; Esc asks with the AbortDialog, then aborts
// the orchestrator (the run folder is marked cancelled, finished legs are
// kept) and returns to the review of the run. The key hint line `Esc cancel`
// sits directly above the guidance box, which follows the run state.
export function RunningStage({
  resolvedLegs,
  progressLines,
  legCallLines,
  selectedAppId,
  statusLine,
  abort,
  onCancel,
  guidanceOpen,
  onGuidanceOpenChange,
  startedAt,
  legPassesDone = 0,
  legPassesLeg,
  passTotal,
}: RunningStageProps): React.JSX.Element {
  const [start] = useState(() => startedAt ?? Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const state = llmRunState(resolvedLegs, progressLines, statusLine);
  // #4472: the Stage bar is monotonic within a run (one key per leg set and start time).
  const stageShare = useMonotonicShare(
    state.synthesising ? 1 : llmStageShare(resolvedLegs, progressLines, legPassesDone, passTotal, legPassesLeg),
    `${start}:${resolvedLegs.map((l) => l.id).join(',')}`,
  );
  // #4372: short candidate labels (the legend is in the guidance).
  const labels = candidateLabels(resolvedLegs);
  const lines = [...progressLines.map((l) => labelProgressLine(l, labels)), ...legCallLines];

  return (
    <LlmStageFrame keys={RUN_PANEL_KEYS} guidance={state.guidance} onGuidanceOpenChange={onGuidanceOpenChange}>
    <Box flexDirection="column">
      <RunPanel
        title={`Comparing ${resolvedLegs.length} LLM Providers on ${selectedAppId}`}
        progress={{
          stage: state.synthesising ? 2 : 1,
          stages: 2,
          // #4472: the subtitle names the stage; the Stage bar moves with the passes of the running leg.
          stageName: LLM_STAGE_NAMES[state.synthesising ? 1 : 0],
          stageShare: state.synthesising ? 0 : stageShare,
          label: state.label,
          itemsDone: state.completed,
          itemsTotal: state.total,
          itemsLabel: 'Legs',
          itemsNoun: 'LLM Providers finished',
          elapsedMs: Math.max(0, now - start),
        }}
        lines={lines}
        maxLines={6}
        {...(abort ? { abort } : {})}
        onCancel={onCancel}
        guidanceOpen={guidanceOpen}
      />
    </Box>
    </LlmStageFrame>
  );
}
