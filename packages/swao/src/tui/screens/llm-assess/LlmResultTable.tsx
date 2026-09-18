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
import { Box, Text } from 'ink';
import { trafficLight } from '@swao/module-llm-assessment';
import type { ResolvedLeg, OrchestrationResult } from '@swao/module-llm-assessment';

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
