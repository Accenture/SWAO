// #4267: per-line pass attribution and assess.app.pass.* events of the Assess screen.

import { describe, it, expect } from 'vitest';
import { formatPassMarker } from '@swao/core';
import { createPassLineTracker, cleanPassName } from './pass-line-tracker.js';

const RUN = '2026-11-09T14:08:36.531Z';
const pid = (num: string, key: string) => `2026-11-09T14-08-36-p${num}-${key}`;
const start = (num: string, key: string, name: string) =>
  formatPassMarker({ kind: 'start', num, key, name, pass_id: pid(num, key), run_id: RUN });
const done = (num: string, key: string, name: string, duration_ms: number, signals: number, status = 'ok') =>
  formatPassMarker({ kind: 'done', num, key, name, pass_id: pid(num, key), run_id: RUN, status, duration_ms, signals });

describe('createPassLineTracker with markers (#4267)', () => {
  // The child's stdout of a two-pass run, in the order swao assess writes it.
  const stdout = [
    '[info] Frameworks for this run: BSI_C5 (default)',
    start('01', 'inv', 'inventory'),
    '[info] Running Pass 01, inventory...',
    '[ok]  Pass 01, inventory  7 signals emitted  ->  wsp/runs/x/passes/01-inv.yaml  [2m 1s]',
    done('01', 'inv', 'inventory', 121010, 7),
    start('02', 'state', 'state_analysis'),
    '[info] Running Pass 02, state_analysis...',
    '[skip]  Pass 02, state_analysis  0 items emitted',
    done('02', 'state', 'state_analysis', 900, 0, 'skip'),
  ];

  it('start and complete share the canonical key and the engine pass_id; complete carries duration_ms', () => {
    const t = createPassLineTracker();
    const events = stdout.flatMap((l) => t.consume(l).events);
    expect(events.map((e) => e.code)).toEqual([
      'assess.app.pass.start', 'assess.app.pass.complete', 'assess.app.pass.start', 'assess.app.pass.complete',
    ]);
    expect(events[0]!.context).toEqual({ pass: 'inv', name: 'inventory', num: '01', pass_id: pid('01', 'inv'), run_id: RUN });
    expect(events[1]!.context).toMatchObject({ pass: 'inv', name: 'inventory', pass_id: pid('01', 'inv'), duration_ms: 121010, signals: 7, status: 'ok' });
    expect(events[3]!.context).toMatchObject({ pass: 'state', status: 'skip', duration_ms: 900 });
    for (let i = 0; i < events.length; i += 2) {
      expect(events[i]!.context['pass']).toBe(events[i + 1]!.context['pass']);
      expect(events[i]!.context['pass_id']).toBe(events[i + 1]!.context['pass_id']);
    }
    expect(events[0]!.message).toBe('Pass 01 inventory start');
  });

  it('attributes "Running Pass 02" to pass 02, hides markers, and keeps lines before the first pass unattributed', () => {
    const t = createPassLineTracker();
    const results = stdout.map((l) => ({ l, r: t.consume(l) }));
    expect(results[0]!.r.pass).toBeUndefined();
    const running02 = results.find(({ l }) => l.startsWith('[info] Running Pass 02'))!;
    expect(running02.r.pass).toBe('state');
    expect(running02.r.events).toEqual([]);
    expect(results.filter(({ r }) => r.marker).map(({ l }) => l)).toEqual([stdout[1], stdout[4], stdout[5], stdout[8]]);
    expect(results.find(({ l }) => l.startsWith('[ok]  Pass 01'))!.r.pass).toBe('inv');
  });
});

describe('createPassLineTracker without markers (older child)', () => {
  it('derives a clean name (no trailing dots), equal on start and complete, with a measured duration', () => {
    let clock = 1000;
    const t = createPassLineTracker(() => clock);
    const s = t.consume('[info] Running Pass 01 -- inventory...');
    clock = 4000;
    const c = t.consume('[ok]  Pass 01 -- inventory  7 signals emitted');
    expect(s.events[0]!.context).toEqual({ pass: 'inventory', name: 'inventory', num: '01' });
    expect(c.events[0]!.context).toMatchObject({ pass: 'inventory', num: '01', status: 'ok', duration_ms: 3000 });
    expect(t.consume('[info] Running Pass 02 -- state_analysis...').pass).toBe('state_analysis');
  });

  it('cleanPassName strips trailing punctuation only', () => {
    expect(cleanPassName('inventory...')).toBe('inventory');
    expect(cleanPassName('state_analysis')).toBe('state_analysis');
    expect(cleanPassName('lzr,')).toBe('lzr');
  });
});

describe('createPassLineTracker on the comma form without markers (#4402)', () => {
  it('derives the same events from "Pass NN, name" lines', () => {
    let clock = 0;
    const t = createPassLineTracker(() => clock);
    const s = t.consume('[info] Running Pass 04, context_ingestion...');
    clock = 22_000;
    const c = t.consume('[ok]  Pass 04, context_ingestion  5 signals  ->  wsp/runs/x/passes/04-ctx.yaml  [22s]');
    expect(s.events[0]!.context).toEqual({ pass: 'context_ingestion', name: 'context_ingestion', num: '04' });
    expect(c.events[0]!.context).toMatchObject({ pass: 'context_ingestion', num: '04', status: 'ok', duration_ms: 22_000 });
    expect(t.consume('[fail] Pass 09, synthesis  LLM endpoint unreachable').events).toEqual([]);
  });
});
