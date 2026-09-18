// writeLlmLegsToSwaoYml + buildResolvedLegs -- extracted from LlmAssessmentScreen.tsx (#2376).
// Pure file-system helpers; no React state.

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { load, dump as yamlDump } from 'js-yaml';
import type { ResolvedLeg } from '@swao/module-llm-assessment';
import type { PendingLeg } from './types.js';

interface LegDef {
  connector: string;
  model: string;
  primary?: true;
}

export function writeLlmLegsToSwaoYml(
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
    costSource: (l.connectorId === 'ollama' ? 'local' : 'billed') as 'local' | 'billed',
  }));
  return { legDefs, resolved };
}
