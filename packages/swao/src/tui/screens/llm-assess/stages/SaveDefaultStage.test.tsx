// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, LLM Assessment "Save as the new default" flow
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4403 (#4198, Design 092 section 4): the save question of the LLM leg
// builder, rendered and driven by keys with the real handlers on a temporary
// workspace. No (the default, Enter) leaves the workspace .swao.yml byte for
// byte as it was; Yes writes llm_assessment.legs. Both answers log
// llm_assess.default.saved with the keys written.
// #4394 (criterion 3, assessment flow): with the guidance box open (Ctrl+G)
// the Down arrow still moves the cursor and the box follows the option.

import { describe, it, expect, afterEach } from 'vitest';
import React, { useState } from 'react';
import { render } from 'ink-testing-library';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { load } from 'js-yaml';
import type { ResolvedLeg } from '@swao/module-llm-assessment';
import type { LoadedConnector } from '@swao/module-llm-providers';
import type { PendingLeg } from '../types.js';
import { useLlmHandlers } from '../hooks/useLlmHandlers.js';
import { SaveDefaultStage } from './SaveDefaultStage.js';

const CTRL_G = String.fromCharCode(7);
const DOWN = `${String.fromCharCode(27)}[B`;
const ENTER = '\r';

const SEED = [
  '# workspace, comment kept',
  'assessment:',
  '  llm:',
  '    candidates:',
  '      - connector: openrouter',
  '        model: a/setup-model',
  '      - { connector: ollama, model: llama3 }',
  '',
].join('\r\n');

const tick = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await tick(20);
}

const dirs: string[] = [];
afterEach(() => { while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function workspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-4403-save-'));
  dirs.push(ws);
  writeFileSync(join(ws, '.swao.yml'), SEED, 'utf-8');
  return ws;
}

/** Every NDJSON event the run wrote under the workspace (the portfolio log). */
function events(ws: string): Array<{ code: string; level: string; context?: Record<string, unknown> }> {
  const out: Array<{ code: string; level: string; context?: Record<string, unknown> }> = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith('.ndjson')) {
        for (const line of readFileSync(p, 'utf-8').split('\n')) if (line.trim()) out.push(JSON.parse(line));
      }
    }
  };
  walk(ws);
  return out;
}

const PENDING: PendingLeg[] = [
  { connectorId: 'openrouter', model: 'b/run-model', connector: {} as LoadedConnector },
  { connectorId: 'ollama', model: 'qwen', connector: {} as LoadedConnector },
];

/** The save-default stage of LlmAssessmentScreen with the real handlers (useLlmHandlers). */
function Flow({ ws, onStage }: { ws: string; onStage: (s: string) => void }): JSX.Element | null {
  const [stage, setStage] = useState('build-legs');
  const [resolved, setResolved] = useState<ResolvedLeg[]>([]);
  const noop = (): void => undefined;
  const handlers = useLlmHandlers({
    eligibleApps: [], loadedConnectors: [], configuredCredKeys: new Set(), pendingLegs: PENDING,
    crawlAvailable: false, resolvedLegs: resolved, workspacePath: ws, healthStatus: 'ok',
    healthPermanent: false, nextLegRef: { current: null },
    setSelectedApp: noop, setCrawlAvailable: noop, setIncludeCrawl: noop, setPendingLegs: noop,
    setNextLeg: noop, setBuildError: noop, setStage: (s) => { setStage(s); onStage(s); },
    setResolvedLegs: setResolved, setErrorMsg: noop, setLlmCfg: noop,
    setHealthStatus: noop, setHealthMessage: noop, setHealthPermanent: noop,
  });
  // Once on mount: the leg builder confirms the pending legs and asks the question.
  React.useEffect(() => { handlers.handleConnectorSelect('__done__'); }, []);
  if (stage !== 'save-default' || resolved.length === 0) return null;
  return (
    <SaveDefaultStage resolvedLegs={resolved} setupCandidates guidanceOpen={false}
      onGuidanceOpenChange={noop} onAnswer={handlers.handleSaveDefault} />
  );
}

async function start(ws: string): Promise<{ r: ReturnType<typeof render>; stages: string[] }> {
  const stages: string[] = [];
  const r = render(<Flow ws={ws} onStage={(s) => stages.push(s)} />);
  await until(() => (r.lastFrame() ?? '').includes('Save these legs as the new default?'));
  await tick();
  return { r, stages };
}

describe('LLM Assessment save as default, TUI flow (#4403, #4198)', () => {
  it('Enter on the default answer No goes to the review and leaves .swao.yml byte-identical; the answer is logged', async () => {
    const ws = workspace();
    const before = readFileSync(join(ws, '.swao.yml'));
    const { r, stages } = await start(ws);
    r.stdin.write(ENTER);
    await until(() => stages.includes('review-config'));
    r.unmount();
    expect(stages).toContain('review-config');
    expect(readFileSync(join(ws, '.swao.yml')).equals(before)).toBe(true);
    const saved = events(ws).filter((e) => e.code === 'llm_assess.default.saved');
    expect(saved).toHaveLength(1);
    expect(saved[0]!.context).toMatchObject({ answer: 'no', saved: false, keys_written: [] });
  });

  it('Down then Enter answers Yes: llm_assessment.legs is written, the candidates stay, the keys are logged', async () => {
    const ws = workspace();
    const { r, stages } = await start(ws);
    r.stdin.write(DOWN);
    await tick();
    r.stdin.write(ENTER);
    await until(() => stages.includes('review-config'));
    r.unmount();
    const text = readFileSync(join(ws, '.swao.yml'), 'utf-8');
    expect(text).toContain('# workspace, comment kept');
    const yml = load(text) as { llm_assessment?: { legs?: unknown }; assessment?: { llm?: { candidates?: unknown } } };
    expect(yml.llm_assessment?.legs).toEqual([
      { connector: 'openrouter', model: 'b/run-model', primary: true },
      { connector: 'ollama', model: 'qwen' },
    ]);
    expect(yml.assessment?.llm?.candidates).toEqual([
      { connector: 'openrouter', model: 'a/setup-model' },
      { connector: 'ollama', model: 'llama3' },
    ]);
    const saved = events(ws).filter((e) => e.code === 'llm_assess.default.saved');
    expect(saved).toHaveLength(1);
    expect(saved[0]!.context).toMatchObject({ answer: 'yes', saved: true, keys_written: ['llm_assessment.legs'] });
  });

  it('#4394: with the guidance box open, Down moves the cursor, the box stays open and shows the entry of the new option', async () => {
    const ws = workspace();
    const before = readFileSync(join(ws, '.swao.yml'));
    const { r } = await start(ws);
    r.stdin.write(CTRL_G);
    await until(() => (r.lastFrame() ?? '').includes('close guidance'));
    expect(r.lastFrame()).toContain('Use them for this run only');
    r.stdin.write(DOWN);
    await until(() => (r.lastFrame() ?? '').includes('Save them as the new default'));
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain('Save them as the new default');
    expect(frame).toContain('close guidance');
    r.unmount();
    expect(readFileSync(join(ws, '.swao.yml')).equals(before)).toBe(true);
  });
});
