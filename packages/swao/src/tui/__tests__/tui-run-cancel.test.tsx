// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, gate G-10: Esc cancel on a run screen (#4252)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 126 section 13.2 G-10 and section 7.6 (Q-09 decided): Esc on a run
// screen asks (long runs), cancels, marks the run `cancelled` and returns to
// the step that started the run. The sample run screen drives the real LLM
// Assessment orchestrator (#4243 abort signal) through RunPanel's
// AbortController, with a leg that only ends when it is aborted, in a
// temporary workspace. The run screens join this file as they move to
// RunPanel (#4255, #4256). Also: tui-kit's normalizeRunDashes() gives the
// same text as @swao/core normalizeDashes() (tui-kit cannot import core).

import { describe, it, expect, vi } from 'vitest';
import React, { useEffect, useRef, useState } from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunPanel, ScreenLayout, RUN_PANEL_KEYS, KEY_HINTS, normalizeRunDashes, useFlowNavigation } from '@swao/tui-kit';
import { normalizeDashes } from '@swao/core';
import { orchestrateLegs, type OrchestrationResult, type ResolvedLeg } from '@swao/module-llm-assessment';
import { useLegTempRoot } from '../../__tests__/helpers/leg-temp-root.js';

// #4473: the cancelled legs keep their workspace; it goes with this file's temp root.
useLegTempRoot();

const KEY = { enter: '\r', esc: '\u001B' } as const;
const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));
type Rendered = ReturnType<typeof render>;
async function press(r: Rendered, ...keys: string[]): Promise<void> {
  for (const k of keys) { r.stdin.write(k); await tick(); }
}
async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await tick(25);
}

const LICENCE = { tier: 'enterprise' as const, assessmentCount: 12, firstRun: '2026-01-01', exp: '2099-03-31' };
const STEPS = ['Scope', 'Confirm', 'Run', 'Finish'];
const LEGS: ResolvedLeg[] = [
  { id: 'lc-a', connector: 'anthropic', model: 'model-a', primary: true, costSource: 'billed' },
  { id: 'lc-b', connector: 'openrouter', model: 'model-b', primary: false, costSource: 'billed' },
];

function makeWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-g10-'));
  writeFileSync(join(ws, '.swao.yml'), 'workspace: {}\n', 'utf-8');
  const app = join(ws, 'apps', 'g10-app');
  mkdirSync(join(app, 'wsp', 'inputs', 'source', 'src'), { recursive: true });
  writeFileSync(join(app, '.swao.yml'), 'app:\n  id: g10-app\nsource:\n  path: wsp/inputs/source\n', 'utf-8');
  writeFileSync(join(app, 'wsp', 'inputs', 'source', 'src', 'index.ts'), 'export const app = 1;\n', 'utf-8');
  return ws;
}

/** A flow whose Confirm step starts the run; cancel returns to Confirm. */
function SampleRunFlow({ ws, onResult, confirmCancel = true }: { ws: string; onResult(r: OrchestrationResult): void; confirmCancel?: boolean }): JSX.Element {
  const [running, setRunning] = useState(false);
  const nav = useFlowNavigation({ steps: STEPS, dirty: true, onExit: () => {}, running, initialStep: 0 });
  const abortRef = useRef<AbortController | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const startStep = useRef(1);
  // Scope and Confirm advance on mount for the sample; the run starts on the Run step.
  useEffect(() => {
    if (nav.current < 2 && nav.reached < 2) nav.next();
    if (nav.current === 2 && !running && abortRef.current === null) {
      const ac = new AbortController();
      abortRef.current = ac;
      setRunning(true);
      void orchestrateLegs({
        workspaceRoot: ws, appId: 'g10-app', legs: LEGS, execution: 'serial', repeat: 1, weights: { quality: 1 },
        keepLegWsp: false, passSuiteVersion: 'g10', signal: ac.signal, timestamp: () => '2026-11-10T01:00:00.000Z',
        onProgress: (m) => setLines((l) => [...l, m]),
        spawnLeg: (_leg, _legWs, _env, signal) => new Promise((resolve) => {
          signal?.addEventListener('abort', () => resolve({ exitCode: null, durationMs: 1 }));
        }),
      }).then(onResult);
    }
  });
  return (
    <ScreenLayout
      header={{ subtitle: 'LLM Assessment', stepInfo: STEPS[nav.current]!, version: '1.6.1', licenseState: LICENCE }}
      steps={{ labels: STEPS, current: nav.current }}
      keys={nav.current === 2 ? RUN_PANEL_KEYS : KEY_HINTS.confirm}
      guidance={{ title: STEPS[nav.current]!, what: `Guidance of the ${STEPS[nav.current]} step.` }}
    >
      {nav.current === 2
        ? (
          <RunPanel
            title="Comparing two connectors on one app"
            progress={{ stage: 2, stages: 3, label: 'Legs', itemsDone: 0, itemsTotal: 2, itemsLabel: 'Legs', itemsNoun: 'legs', elapsedMs: 1000 }}
            lines={lines}
            abort={abortRef.current ?? undefined}
            confirmCancel={confirmCancel}
            onCancel={() => { setRunning(false); nav.goTo(startStep.current); }}
          />
        )
        : <Text>{`AT ${STEPS[nav.current]}`}</Text>}
    </ScreenLayout>
  );
}

describe('G-10 Esc cancel on a run screen (#4252, Design 126 section 13.2)', () => {
  it('Esc asks; Esc stays; Enter cancels: run folder cancelled, screen back on the starting step', async () => {
    const ws = makeWorkspace();
    try {
      const onResult = vi.fn();
      const r = render(<SampleRunFlow ws={ws} onResult={onResult} />);
      await until(() => (r.lastFrame() ?? '').includes('Comparing two connectors'));
      expect(r.lastFrame()).toContain('Esc cancel');
      await tick(150);
      await press(r, KEY.esc);
      expect(r.lastFrame()).toContain('Cancel the run? Results so far are kept as a cancelled run.');
      await press(r, KEY.esc);
      expect(r.lastFrame()).not.toContain('Cancel the run?');
      expect(onResult).not.toHaveBeenCalled();
      await press(r, KEY.esc, KEY.enter);
      await until(() => onResult.mock.calls.length > 0);
      expect(onResult).toHaveBeenCalledTimes(1);
      const result = onResult.mock.calls[0]![0] as OrchestrationResult;
      expect(result.status).toBe('cancelled');
      const status = JSON.parse(readFileSync(join(result.runDir, 'status.json'), 'utf-8')) as { status: string };
      expect(status.status).toBe('cancelled');
      expect(r.lastFrame()).toContain('AT Confirm');
      r.unmount();
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  }, 30_000);

  it('a short run (probe, confirmCancel false) cancels at once with one Esc', async () => {
    const ws = makeWorkspace();
    try {
      const onResult = vi.fn();
      const r = render(<SampleRunFlow ws={ws} onResult={onResult} confirmCancel={false} />);
      await until(() => (r.lastFrame() ?? '').includes('Comparing two connectors'));
      await tick(150);
      await press(r, KEY.esc);
      expect(r.lastFrame()).not.toContain('Cancel the run?');
      await until(() => onResult.mock.calls.length > 0);
      const result = onResult.mock.calls[0]![0] as OrchestrationResult;
      expect(result.status).toBe('cancelled');
      expect(existsSync(join(result.runDir, 'status.json'))).toBe(true);
      expect(r.lastFrame()).toContain('AT Confirm');
      r.unmount();
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('run output dash normalisation parity (#4252, Design 126 section 8 rule 1)', () => {
  it('normalizeRunDashes (tui-kit) equals normalizeDashes (@swao/core)', () => {
    const EM = '\u2014';
    const EN = '\u2013';
    const DD = '-'.repeat(2);
    const corpus = [
      `Pass 04 ${DD} context_ingestion`, `a ${EM} b`, `a${EM}b`, `a \t${EM}\t b ${EM} c`, `${EM}lead`, `trail${EM}`,
      `pages 1${EN}2`, `swao assess ${DD}app x`, `x ${DD}y`, `${DD} lead`, 'plain', '', `a  ${DD}  b`, `mix ${EM} 1${EN}2 ${DD} z`,
    ];
    for (const s of corpus) expect(normalizeRunDashes(s), JSON.stringify(s)).toBe(normalizeDashes(s));
  });
});
