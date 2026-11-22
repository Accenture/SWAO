// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- LLM Assessment result table component (#2374)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { tone, terminalFrameWidth, type Token } from '@swao/tui-kit';
import { candidateLabels, CANDIDATE_LABEL_MAX, formatCostTotal, COST_NOT_MEASURED } from '@swao/core';
import { trafficLight, didNotFinishText } from '@swao/module-llm-assessment';
import type { ResolvedLeg, OrchestrationResult, CallTotals, CallRecord } from '@swao/module-llm-assessment';
import { modelLabel } from '../../model-label.js';

/** Row label column: the longest shown group name (performance, reliability) plus a gap. */
const LABEL_W = 12;
/** #4372: compact row label column when the candidate columns would be cut. */
const LABEL_W_COMPACT = 10;

/** #4372: shown names of the metric groups (fit the row label column). */
const GROUP_NAMES: Record<string, string> = {
  'quality-content': 'content',
  'quality-structural': 'structure',
};
/** #4372: compact names (at most 9 characters) for narrow terminals. */
const GROUP_NAMES_COMPACT: Record<string, string> = {
  ...GROUP_NAMES,
  performance: 'perform.',
  reliability: 'reliab.',
};

export interface ResultTableLayout {
  labelW: number;
  colW: number;
  /** Max candidate label length in the header (one space to the next column). */
  labelMax: number;
  /** True when the compact row labels are used. */
  compact: boolean;
}

/**
 * #4372: column widths from the terminal width, so five candidates fit at
 * 80 and 100 columns; labels are at most 14 characters and never wider than
 * their column.
 */
export function resultTableLayout(columns: number, legCount: number): ResultTableLayout {
  const n = Math.max(1, legCount);
  const fit = (labelW: number): number => Math.max(8, Math.min(CANDIDATE_LABEL_MAX + 2, Math.floor(Math.max(0, columns - labelW) / n)));
  const compact = fit(LABEL_W) < CANDIDATE_LABEL_MAX + 1;
  const labelW = compact ? LABEL_W_COMPACT : LABEL_W;
  const colW = fit(labelW);
  return { labelW, colW, labelMax: Math.min(CANDIDATE_LABEL_MAX, colW - 1), compact };
}

/** #4398: row labels of the raw performance values (fit the compact label column). */
export const PERF_TOTAL_LABEL = 'call time';
export const PERF_SLOWEST_LABEL = 'slowest';

const usdText = (usd: number): string => `${usd.toFixed(usd < 1 ? 4 : 2)} USD`;

/**
 * #4372: measured USD of a leg for the cost row. A leg with calls without a
 * price shows `+N` after the priced sum (the cell is narrow; the full "plus N
 * unpriced calls" line is below the table); a leg with no priced call is
 * "not measured", never 0 USD.
 */
export function costUsdCell(usd: number | null | undefined, unpricedCalls = 0, calls?: number): string {
  const text = legCostLine(usd, unpricedCalls, calls);
  if (text === COST_NOT_MEASURED) return text;
  return unpricedCalls > 0 ? `${usdText(usd as number)} +${unpricedCalls}` : text;
}

/** #4372: the run total of every paid call: `1.2000 USD plus 3 unpriced calls` or `not measured`. */
export function runCostLine(t: Pick<CallTotals, 'cost_usd' | 'call_count' | 'unpriced_calls'>): string {
  return formatCostTotal({ usd: t.cost_usd, calls: t.call_count, unpricedCalls: t.unpriced_calls, format: usdText });
}

/** #4372: the full cost wording of a leg: `0.2000 USD plus 2 unpriced calls` or `not measured`. */
export function legCostLine(usd: number | null | undefined, unpricedCalls: number, calls?: number): string {
  return formatCostTotal({ usd, calls: calls ?? null, unpricedCalls, format: usdText });
}

/** #4398: the measured call time of a leg: the sum over its assessment calls and the slowest one. */
export interface LegCallTime {
  totalMs: number;
  slowestMs: number;
  calls: number;
}

/**
 * #4398 (Design 092 section 5.8): the raw values under the relative
 * performance score. Assessment calls only (a leg challenge, pass_id
 * challenge-..., does not feed the comparison); a leg without a recorded
 * call has no entry.
 */
export function legCallTimes(records: readonly Pick<CallRecord, 'leg' | 'pass_id' | 'timing'>[], legIds: readonly string[]): Record<string, LegCallTime> {
  const out: Record<string, LegCallTime> = {};
  for (const id of legIds) {
    const own = records.filter((r) => r.leg.id === id && !r.pass_id.startsWith('challenge-'));
    if (own.length === 0) continue;
    out[id] = {
      totalMs: own.reduce((a, r) => a + r.timing.total_ms, 0),
      slowestMs: own.reduce((a, r) => Math.max(a, r.timing.total_ms), 0),
      calls: own.length,
    };
  }
  return out;
}

/** #4398: seconds for a narrow cell: one decimal under 10 s, whole seconds above. */
export function secondsCell(ms: number | undefined): string {
  if (ms === undefined) return 'not measured';
  const s = ms / 1000;
  return `${s < 10 ? s.toFixed(1) : String(Math.round(s))} s`;
}

/** #4474: the score cell of a leg that did not finish (no score, no rank). */
export const DID_NOT_FINISH_CELL = 'did not finish';

// #4243 (Design 126 rule 9a): an empty score reads "not measured", never "--".
function scoreCell(score: number | null | undefined, rank: number | null | undefined): string {
  if (score === null || score === undefined) return 'not measured';
  const r = rank !== null && rank !== undefined ? ` (#${rank})` : '';
  return `${Math.round(score)}${r}`;
}

/** Traffic light to theme token; #4372: a low cost score is a warning, red stays for errors. */
function lightToken(score: number | null | undefined, group: string): Token {
  const tl = trafficLight(score ?? null);
  if (tl === 'ok') return 'ok';
  if (tl === 'warn') return 'warning';
  if (tl === 'red') return group === 'cost' ? 'warning' : 'error';
  return 'text';
}

export function LlmResultTable({
  result,
  legs,
  columns,
}: {
  result: OrchestrationResult;
  legs: ResolvedLeg[];
  /** Terminal width; defaults to the frame width of stdout (80 when unknown). */
  columns?: number;
}): React.JSX.Element {
  const { stdout } = useStdout();
  const width = columns ?? terminalFrameWidth(stdout?.columns) ?? 80;
  const { labelW, colW, labelMax, compact } = resultTableLayout(width, legs.length);
  const groupNames = compact ? GROUP_NAMES_COMPACT : GROUP_NAMES;
  const legIds = legs.map((l) => l.id);
  const labels = candidateLabels(legs, labelMax);
  const unpricedIds = new Set((result.unpriced ?? []).map((u) => u.legId));
  const unpricedCount = (id: string): number => result.unpricedCalls?.[id] ?? 0;
  const callsOf = (id: string): number | undefined => result.legs.find((l) => l.id === id)?.calls;
  // #4372 follow-up: every leg whose cost leaves calls out, in full words below the table.
  const costNotes = legIds.flatMap((id) => {
    const message = (result.unpriced ?? []).find((u) => u.legId === id)?.message;
    const n = unpricedCount(id);
    if (!message && n === 0) return [];
    const label = labels[id] ?? id;
    const line = legCostLine(result.costUsd?.[id], n, callsOf(id));
    if (line === COST_NOT_MEASURED) return [{ id, text: `${label}: ${message ? `${message}, ` : ''}the cost is not measured` }];
    // #4372 (owner decision 2026-11-14): a leg with any unpriced call is not ranked on cost.
    return [{ id, text: `${label}: cost ${line}, not ranked on cost${message ? `; ${message}` : ''}` }];
  });
  // #4372 (owner decision 2026-11-14): the cost score of a leg with any unpriced
  // call reads "not measured" (the comparison engine leaves it unscored; this
  // keeps the cell honest for a result built before that rule).
  const groupScore = (g: OrchestrationResult['groups'][number], id: string): { score: number | null | undefined; rank: number | null | undefined } =>
    g.group === 'cost' && unpricedCount(id) > 0 ? { score: null, rank: null } : { score: g.score[id], rank: g.rank[id] };
  // #4474: a leg that did not finish has no score and no rank; its cells say so.
  const dnf = (id: string): boolean => { const o = result.legs.find((l) => l.id === id); return o !== undefined && o.status !== 'complete'; };
  const cell = (id: string, score: number | null | undefined, rank: number | null | undefined): string =>
    dnf(id) ? DID_NOT_FINISH_CELL : scoreCell(score, rank);
  const totals = result.totals;
  const costGroup = result.groups.some((g) => g.group === 'cost');
  // #4372: the measured USD per candidate, directly below the cost score.
  const costRow = (
        <Box flexDirection="row">
          <Box width={labelW}><Text {...tone('muted')}>cost USD</Text></Box>
          {legIds.map((id) => (
            <Box key={id} width={colW}>
              <Text {...tone(unpricedIds.has(id) || unpricedCount(id) > 0 ? 'warning' : 'muted')} wrap="truncate-end">{costUsdCell(result.costUsd?.[id], unpricedCount(id), callsOf(id))}</Text>
            </Box>
          ))}
        </Box>
  );

  // #4398: the raw call time under the relative performance score, so a 0
  // of the slower leg is explained by the numbers (total and slowest call).
  const times = legCallTimes(result.records, legIds);
  const timeRow = (label: string, ms: (t: LegCallTime | undefined) => number | undefined) => (
        <Box flexDirection="row">
          <Box width={labelW}><Text {...tone('muted')}>{label}</Text></Box>
          {legIds.map((id) => (
            <Box key={id} width={colW}>
              <Text {...tone('muted')} wrap="truncate-end">{secondsCell(ms(times[id]))}</Text>
            </Box>
          ))}
        </Box>
  );

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" marginBottom={1}>
        <Box width={labelW}><Text bold>Dimension</Text></Box>
        {legs.map((leg) => (
          <Box key={leg.id} width={colW}>
            <Text bold wrap="truncate-end">{labels[leg.id]}</Text>
          </Box>
        ))}
      </Box>
      {result.groups.map((g) => (
        <React.Fragment key={g.group}>
          <Box flexDirection="row">
            <Box width={labelW}><Text>{groupNames[g.group] ?? g.group}</Text></Box>
            {legIds.map((id) => (
              <Box key={id} width={colW}>
                <Text {...tone(lightToken(groupScore(g, id).score, g.group))} wrap="truncate-end">{cell(id, groupScore(g, id).score, groupScore(g, id).rank)}</Text>
              </Box>
            ))}
          </Box>
          {/* #4372: the measured USD next to the cost score. */}
          {g.group === 'cost' && costRow}
          {g.group === 'performance' && timeRow(PERF_TOTAL_LABEL, (t) => t?.totalMs)}
          {g.group === 'performance' && timeRow(PERF_SLOWEST_LABEL, (t) => t?.slowestMs)}
        </React.Fragment>
      ))}
      {!costGroup && result.costUsd && costRow}
      <Box flexDirection="row" marginTop={1}>
        <Box width={labelW}><Text bold>FINAL</Text></Box>
        {legIds.map((id) => (
          <Box key={id} width={colW}>
            <Text {...tone(lightToken(result.final.score[id], 'final'), { bold: true })} wrap="truncate-end">
              {cell(id, result.final.score[id], result.final.rank[id])}
            </Text>
          </Box>
        ))}
      </Box>
      {/* #4372: legend with the full connector and model ids. */}
      <Box flexDirection="column" marginTop={1}>
        {legs.map((leg) => (
          <Text key={leg.id} {...tone('muted')} wrap="truncate-end">{`${labels[leg.id]}: ${leg.connector} ${modelLabel(leg.model)}`}</Text>
        ))}
      </Box>
      {/* #4474: why a leg has no score: its reason and the calls it completed. */}
      {result.legs.some((l) => l.status !== 'complete') && (
        <Box flexDirection="column" marginTop={1}>
          {result.legs.filter((l) => l.status !== 'complete').map((l) => (
            <Text key={l.id} {...tone('warning')} wrap="wrap">{`${labels[l.id] ?? l.id}: ${didNotFinishText({ status: l.status === 'cancelled' ? 'cancelled' : 'failed', ...(l.reason ? { reason: l.reason } : {}), calls: l.calls })}; not scored and not ranked`}</Text>
          ))}
        </Box>
      )}
      {costNotes.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {costNotes.map((n) => (
            <Text key={n.id} {...tone('warning')} wrap="wrap">{n.text}</Text>
          ))}
        </Box>
      )}
      <Box marginTop={1}>
        <Text {...tone('muted')}>
          {result.records.length} call(s) across {legs.length} LLM Provider(s), {result.findingsCount} finding(s).
        </Text>
      </Box>
      {/* #4372 follow-up: the run total (assessment and challenge calls) with the unpriced calls. */}
      {totals && (
        <Text {...tone(totals.unpriced_calls > 0 ? 'warning' : 'muted')} wrap="wrap">
          {`Run cost: ${runCostLine(totals)} (${totals.call_count} call(s), assessment and challenge).`}
        </Text>
      )}
    </Box>
  );
}
