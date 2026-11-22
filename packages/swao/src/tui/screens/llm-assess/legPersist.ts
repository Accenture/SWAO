// writeLlmLegsToSwaoYml + buildResolvedLegs -- extracted from LlmAssessmentScreen.tsx (#2376).
// Pure file-system helpers; no React state. #4198: the writer runs only after
// the explicit "save as the new default" answer (Design 125 section 5.7).

import { join } from 'path';
import { patchSwaoYmlFileOrThrow } from '@swao/core';
import type { ResolvedLeg } from '@swao/module-llm-assessment';
import type { PendingLeg } from './types.js';
import { legCostSource } from '../../../commands/llm-leg-cost.js';

interface LegDef {
  connector: string;
  model: string;
  primary?: true;
}

export function writeLlmLegsToSwaoYml(
  wp: string,
  legs: Array<{ connector: string; model?: string; primary?: boolean }>,
): void {
  // #4283: minimal patch of llm_assessment.legs only; every comment, the key
  // order and the other keys of the workspace file stay (Design 125 section 7).
  patchSwaoYmlFileOrThrow(join(wp, '.swao.yml'), [{ path: ['llm_assessment', 'legs'], value: legs }], { createIfMissing: true });
}

/**
 * #4198: the llm_assessment.legs entries of confirmed legs, for the explicit
 * "save as the new default" answer (Design 125 section 5.7).
 */
export function legDefsOf(resolved: ReadonlyArray<Pick<ResolvedLeg, 'connector' | 'model' | 'primary'>>): LegDef[] {
  return resolved.map((l) => ({
    connector: l.connector,
    model: l.model,
    ...(l.primary ? { primary: true as const } : {}),
  }));
}

export function buildResolvedLegs(pending: PendingLeg[]): { legDefs: LegDef[]; resolved: ResolvedLeg[] } {
  const legDefs: LegDef[] = pending.map((l, i) => ({
    connector: l.connectorId,
    model: l.model,
    primary: i === 0 ? (true as const) : undefined,
  }));
  const resolved: ResolvedLeg[] = pending.map((l, i) => ({
    id: `${l.connectorId}--${l.model.replace(/[^a-zA-Z0-9.-]/g, '_')}`,
    connector: l.connectorId,
    model: l.model,
    primary: i === 0,
    // #4372: same decision as the CLI (commands/llm-leg-cost.ts).
    costSource: legCostSource(l.connectorId),
  }));
  return { legDefs, resolved };
}
