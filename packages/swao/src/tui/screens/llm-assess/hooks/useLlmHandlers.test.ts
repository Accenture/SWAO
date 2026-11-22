// #4198 (Design 125 section 5.7, owner decision 2026-11-09): the LLM leg
// builder writes the run-time legs to llm_assessment.legs only after the
// explicit "Save these legs as the new default?" answer; the setup value
// assessment.llm.candidates is never written by a run.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { load } from 'js-yaml';
import type { ResolvedLeg } from '@swao/module-llm-assessment';
import type { LoadedConnector } from '@swao/module-llm-providers';
import type { PendingLeg } from '../types.js';
import { useLlmHandlers } from './useLlmHandlers.js';

const SEED = [
  '# workspace',
  'assessment:',
  '  llm:',
  '    candidates:',
  '      - connector: openrouter',
  '        model: a/setup-model',
  '      - connector: ollama',
  '        model: llama3',
  '',
].join('\n');

const leg = (connectorId: string, model: string): PendingLeg =>
  ({ connectorId, model, connector: {} as LoadedConnector });

interface Harness {
  ws: string;
  stage: () => string;
  resolved: () => ResolvedLeg[];
  handlers: (pending: PendingLeg[]) => ReturnType<typeof useLlmHandlers>;
}

const dirs: string[] = [];

function harness(): Harness {
  const ws = mkdtempSync(join(tmpdir(), 'swao-4198-legs-'));
  dirs.push(ws);
  writeFileSync(join(ws, '.swao.yml'), SEED, 'utf-8');
  let stage = 'build-legs';
  let resolved: ResolvedLeg[] = [];
  const noop = (): void => undefined;
  const handlers = (pending: PendingLeg[]): ReturnType<typeof useLlmHandlers> => useLlmHandlers({
    eligibleApps: [], loadedConnectors: [], configuredCredKeys: new Set(), pendingLegs: pending,
    crawlAvailable: false, resolvedLegs: resolved, workspacePath: ws, healthStatus: 'ok',
    healthPermanent: false, nextLegRef: { current: null },
    setSelectedApp: noop, setCrawlAvailable: noop, setIncludeCrawl: noop, setPendingLegs: noop,
    setNextLeg: noop, setBuildError: noop, setStage: (s) => { stage = s; },
    setResolvedLegs: (r) => { resolved = r; }, setErrorMsg: noop, setLlmCfg: noop,
    setHealthStatus: noop, setHealthMessage: noop, setHealthPermanent: noop,
  });
  return { ws, stage: () => stage, resolved: () => resolved, handlers };
}

interface SavedYml {
  llm_assessment?: { legs?: unknown };
  assessment?: { llm?: { candidates?: unknown } };
}

const RUN_LEGS = [leg('openrouter', 'b/run-model'), leg('ollama', 'qwen')];

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('LLM leg builder save-as-default (#4198)', () => {
  it('confirming the legs asks the question and writes nothing', () => {
    const h = harness();
    h.handlers(RUN_LEGS).handleConnectorSelect('__done__');
    expect(h.stage()).toBe('save-default');
    expect(h.resolved().map((l) => l.model)).toEqual(['b/run-model', 'qwen']);
    expect(readFileSync(join(h.ws, '.swao.yml'), 'utf-8')).toBe(SEED);
  });

  it('answering No goes to the review and leaves .swao.yml byte for byte unchanged', () => {
    const h = harness();
    h.handlers(RUN_LEGS).handleConnectorSelect('__done__');
    h.handlers(RUN_LEGS).handleSaveDefault(false);
    expect(h.stage()).toBe('review-config');
    expect(readFileSync(join(h.ws, '.swao.yml'), 'utf-8')).toBe(SEED);
  });

  it('answering Yes writes llm_assessment.legs and keeps assessment.llm.candidates', () => {
    const h = harness();
    h.handlers(RUN_LEGS).handleConnectorSelect('__done__');
    h.handlers(RUN_LEGS).handleSaveDefault(true);
    expect(h.stage()).toBe('review-config');
    const yml = load(readFileSync(join(h.ws, '.swao.yml'), 'utf-8')) as SavedYml;
    expect(yml.llm_assessment?.legs).toEqual([
      { connector: 'openrouter', model: 'b/run-model', primary: true },
      { connector: 'ollama', model: 'qwen' },
    ]);
    expect(yml.assessment?.llm?.candidates).toEqual([
      { connector: 'openrouter', model: 'a/setup-model' },
      { connector: 'ollama', model: 'llama3' },
    ]);
  });
});
