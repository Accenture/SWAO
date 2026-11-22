// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- LLM Assessment result/saving/error stage (#2374)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { FinishPanel, ErrorPanel, FINISH_PANEL_KEYS, ERROR_BACK, scoreText, tone, guidanceOwnsKey, type FinishItem, type KeyHint, type Token } from '@swao/tui-kit';
import { LlmStageFrame } from '../stage-frame.js';
import { candidateLabels, CANDIDATE_LABEL_MAX } from '@swao/core';
import { didNotFinishText, type OrchestrationResult, type ResolvedLeg, type LlmRunStatus } from '@swao/module-llm-assessment';
import { LlmResultTable, runCostLine } from '../LlmResultTable.js';

/** #4243: finish title per run status; only a run with every leg complete says "complete". */
export function finishTitle(status: LlmRunStatus, complete: number, total: number): { text: string; tone: Token } {
  switch (status) {
    case 'complete': return { text: 'Assessment complete.', tone: 'ok' };
    case 'partial': return { text: `Assessment partial: ${complete} of ${total} LLM Providers completed, the comparison is incomplete.`, tone: 'warning' };
    case 'failed': return { text: 'Assessment failed: no LLM Provider completed, the comparison is incomplete.', tone: 'error' };
    case 'cancelled': return { text: `Assessment cancelled: ${complete} of ${total} LLM Providers completed, the comparison is incomplete.`, tone: 'warning' };
  }
}

export interface ResultStageProps {
  stage: 'saving' | 'done' | 'error';
  result: OrchestrationResult | null;
  legs: ResolvedLeg[];
  errorMsg: string;
  guidanceOpen: boolean;
  onGuidanceOpenChange: (open: boolean) => void;
  /** #4256: a What next or What now entry: `FINISH_MAIN_MENU`, `ERROR_BACK` or `LLM_RUN_AGAIN`. */
  onNext?: (value: string) => void;
  /** #4256: the score table is open (it owns Enter and Esc until it closes). */
  onDetailsChange?: (open: boolean) => void;
}

/** #4256: the What next entry that runs the assessment again with the same LLM Providers. */
export const LLM_RUN_AGAIN = 'again';
const LLM_SHOW_TABLE = 'table';
/** #4398 (Design 126): one key per action; Esc also closes the table, as everywhere. */
export const TABLE_KEYS: readonly KeyHint[] = [{ key: 'Enter', verb: 'back' }];
/** #4398: scores are relative to the legs of the run (Design 092 section 5.8). */
export const RELATIVE_SCORES_SENTENCE = 'Scores are relative to the LLM Providers of this run (best 100, worst 0); absolute problems appear as findings.';
/** #4255: the short save after the run (Esc leaves; the run folder is already written). */
const SAVING_KEYS: readonly KeyHint[] = [{ key: 'Esc', verb: 'abort' }];
const SAVING_GUIDANCE = { title: 'Saving the results', what: 'SWAO writes the scores and the findings of the run to its run folder.' };

export interface LlmFinishView {
  title: string;
  level: 'ok' | 'warn' | 'fail';
  rows: Array<{ label: string; value: string }>;
  items: FinishItem[];
  next: Array<{ label: string; value: string }>;
}

/**
 * #4256 (TUI-12, #4243): the finish view of an LLM Assessment for FinishPanel:
 * the title in the colour of the run status (a run in which every leg failed is
 * red), one row per LLM Provider with its final score or "not measured", the
 * findings and the run folder, the per-leg reason of every leg that did not
 * complete, and What next (score table, run again; FinishPanel adds the main menu).
 */
export function llmFinishView(status: LlmRunStatus, result: OrchestrationResult | null, legs: readonly ResolvedLeg[]): LlmFinishView {
  const outcomes = result?.legs ?? [];
  const completeCount = outcomes.filter((l) => l.status === 'complete').length;
  const labels = candidateLabels([...legs], CANDIDATE_LABEL_MAX);
  const title = `LLM ${finishTitle(status, completeCount, legs.length).text.replace(/\.$/, '')}`;
  const level: LlmFinishView['level'] = status === 'complete' ? 'ok' : status === 'failed' ? 'fail' : 'warn';
  const rows = legs.map((l) => {
    // #4474: a leg that did not finish has no score and no rank (its reason is in the items below).
    const outcome = outcomes.find((o) => o.id === l.id);
    if (outcome && outcome.status !== 'complete') {
      return { label: labels[l.id] ?? l.id, value: didNotFinishText({ status: outcome.status, calls: outcome.calls }) };
    }
    const score = result?.final.score[l.id];
    const rank = result?.final.rank[l.id];
    return { label: labels[l.id] ?? l.id, value: `${scoreText(score)}${typeof score === 'number' && typeof rank === 'number' ? `, rank ${rank}` : ''}` };
  });
  if (result) {
    // #4372 follow-up: the run cost with the calls that have no price.
    if (result.totals) rows.push({ label: 'Cost', value: runCostLine(result.totals) });
    rows.push({ label: 'Findings', value: `${result.findingsCount} finding(s) recorded in findings.yaml` });
    rows.push({ label: 'Run folder', value: result.runDir });
  }
  const items: FinishItem[] = outcomes.filter((l) => l.status !== 'complete').map((l) => ({
    level: l.status === 'failed' ? 'fail' : 'cancelled',
    label: labels[l.id] ?? l.id,
    reason: `${l.status}${l.reason ? `: ${l.reason}` : ''}`,
  }));
  const next = [
    ...(result && completeCount > 0 ? [{ label: 'Show the score table', value: LLM_SHOW_TABLE }] : []),
    { label: 'Run again with the same LLM Providers', value: LLM_RUN_AGAIN },
  ];
  return { title, level, rows, items, next };
}

export function ResultStage({
  stage,
  result,
  legs,
  errorMsg,
  guidanceOpen,
  onGuidanceOpenChange,
  onNext,
  onDetailsChange,
}: ResultStageProps): React.JSX.Element {
  const [showTable, setShowTable] = useState(false);
  useInput((_input, key) => {
    // #4398 / #4230: an open guidance box takes Esc (it closes the box, not the table).
    if (guidanceOwnsKey(key, guidanceOpen)) return;
    if (key.return || key.escape) { setShowTable(false); onDetailsChange?.(false); }
  }, { isActive: showTable && stage === 'done' });

  if (stage === 'error') {
    // #2575: show error-specific guidance rather than a hardcoded licence message.
    const isFilesystemErr = /EBUSY|EPERM|EACCES|rmdir|unlink/i.test(errorMsg);
    const isLicenceErr = /licence|license|tier/i.test(errorMsg);
    const isNetworkErr = /ECONNREFUSED|ENOTFOUND|fetch|timeout|http_status|404|503/i.test(errorMsg);
    const errorWhat = isFilesystemErr
      ? 'A temp directory is locked from a previous run. Restart SWAO and try again. If the error persists, delete temp dirs matching "swao-leg-*" in %TEMP%.'
      : isLicenceErr
        ? 'A licence check failed. LLM Assessment itself is available on all tiers (#3161); open Tools, Licence to check that your licence file is valid and not expired.'
        : isNetworkErr
          ? 'Check LLM provider connectivity (run Health Check). Verify the connector base_url and API key are correct.'
          : 'Check the error message on the screen. Common causes: missing connector credentials, a leg that returned no parseable responses, or a filesystem error.';
    // #4256 (Design 126 section 4.9): ErrorPanel with a What now menu, so Enter is never dead.
    return (
      <LlmStageFrame keys={FINISH_PANEL_KEYS} guidance={{ title: 'LLM Assessment failed', what: errorWhat }} onGuidanceOpenChange={onGuidanceOpenChange}>
      <Box flexDirection="column">
        <ErrorPanel
          title="LLM Assessment failed"
          cause={errorMsg}
          recovery={[{ label: 'Run again with the same LLM Providers', value: LLM_RUN_AGAIN }, { label: 'Back to main menu', value: ERROR_BACK }]}
          onSelect={(v) => onNext?.(v)}
        />
      </Box>
      </LlmStageFrame>
    );
  }

  if (stage === 'saving') {
    return (
      <LlmStageFrame keys={SAVING_KEYS} guidance={SAVING_GUIDANCE} onGuidanceOpenChange={onGuidanceOpenChange}>
        <Box flexDirection="column"><Text {...tone('muted')}>Saving results...</Text></Box>
      </LlmStageFrame>
    );
  }

  const status: LlmRunStatus = result?.status ?? 'complete';
  const view = llmFinishView(status, result, legs);
  const unpriced = result?.unpriced ?? [];
  // #4256: the finish guidance explains each What next entry; the run folder holds the log and the leg output.
  const what = (status === 'complete'
    ? `Assessment complete. ${RELATIVE_SCORES_SENTENCE} Show the score table: score and rank per dimension group; the cost row shows the measured USD, and +N after it counts the calls without a price that the sum leaves out; the call time rows show the total and the slowest assessment call. Publish in the main menu writes the HTML report to share with stakeholders.`
    : `The comparison is incomplete: at least one LLM Provider did not finish. ${RELATIVE_SCORES_SENTENCE} Fix the reason shown on the screen, then run again. The run folder holds the log (log.ndjson), the findings and, per failed leg, its output (calls/<leg>.stderr.log).`)
    + ' Run again: the same LLM Providers, starting from the review of the run.'
    // #4372: name the candidates whose cost could not be measured.
    + (unpriced.length > 0 ? ` Cost not measured: ${unpriced.map((u) => u.message).join('; ')}. Add a cost block for the model in the connector file to price it.` : '');
  return (
    <LlmStageFrame keys={showTable ? TABLE_KEYS : FINISH_PANEL_KEYS} guidance={{ title: `LLM Assessment ${status}`, what }} onGuidanceOpenChange={onGuidanceOpenChange}>
    <Box flexDirection="column">
      {showTable && result ? (
        <Box flexDirection="column">
          <Text bold>Score table</Text>
          <LlmResultTable result={result} legs={legs} />
        </Box>
      ) : (
        <FinishPanel
          title={view.title}
          level={view.level}
          rows={view.rows}
          items={view.items}
          next={view.next}
          onSelect={(v) => {
            if (v === LLM_SHOW_TABLE) { setShowTable(true); onDetailsChange?.(true); return; }
            onNext?.(v);
          }}
        />
      )}
    </Box>
    </LlmStageFrame>
  );
}
