// #4256 (TUI-12, Design 126 sections 4.6 and 7.6): the run screens of the
// Application and LZ Catalog flows on RunPanel in the flow frame, at 100 and
// 80 columns: header, licence line and step bar on Run, the run title with
// "Stage n of m", the stage name, the titled output, one key hint line
// (`Esc cancel`) directly above the guidance box; nothing wider than the
// frame, no double dash. Esc asks first; Enter on the dialog cancels once.
import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { render as inkRender, type Instance } from 'ink';
import type { ReactElement } from 'react';
import { RUN_PANEL_KEYS, formatKeyHints } from '@swao/tui-kit';
import { RunningPhase } from './shared/RunningPhase.js';
import { APP_PHASE_STEP, APP_STEPS } from './app-flow.js';
import { LZ_CATALOG_PHASE_STEP, LZ_CATALOG_STEPS } from './lz-catalog-flow.js';

class FakeStdout extends EventEmitter {
  constructor(public columns: number) { super(); }
  rows = 50;
  last = '';
  write = (frame: string): boolean => { this.last = frame; return true; };
}
class FakeStdin extends EventEmitter {
  isTTY = true;
  private data: string | null = null;
  write = (d: string): void => { this.data = d; this.emit('readable'); this.emit('data', d); };
  read = (): string | null => { const d = this.data; this.data = null; return d; };
  setEncoding(): void { /* no-op */ }
  setRawMode(): void { /* no-op */ }
  resume(): void { /* no-op */ }
  pause(): void { /* no-op */ }
  ref(): void { /* no-op */ }
  unref(): void { /* no-op */ }
}

const instances: Instance[] = [];
afterEach(() => { for (const i of instances.splice(0)) i.unmount(); });

// eslint-disable-next-line no-control-regex
const plain = (t: string): string => t.replace(/\x1b\[[0-9;]*m/g, '');
const wait = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

function mount(tree: ReactElement, columns: number): { lines: () => string[]; stdin: FakeStdin } {
  const stdout = new FakeStdout(columns);
  const stdin = new FakeStdin();
  instances.push(inkRender(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new FakeStdout(columns) as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  }));
  return { lines: () => plain(stdout.last).split('\n').map((l) => l.trimEnd()), stdin };
}

const HEADER = { subtitle: 'Application Assessment', version: '1.6.1', licenseState: { tier: 'enterprise' as const, assessmentCount: 3, firstRun: '2026-01-01' } };
const OUTPUT = [
  '[info]  Running Pass 04 -- context_ingestion -- reading C:\\swao\\ws\\apps\\sovereign-health\\wsp\\inputs\\cmdb-export-with-a-long-name.csv',
  '[ok]  Pass 03 -- data_classification finished, 12 signals emitted',
];

describe('run screens at 100 and 80 columns (#4256)', () => {
  const cases = [
    { name: 'Application', steps: APP_STEPS, current: APP_PHASE_STEP.running, run: { kind: 'application' as const, app: 'sovereign-health', passName: 'context_ingestion', passSubLabel: '', completed: 3, total: 14 }, title: 'Assessing sovereign-health', stage: 'Pass context ingestion' },
    { name: 'LZ Catalog', steps: LZ_CATALOG_STEPS, current: LZ_CATALOG_PHASE_STEP.running, run: { kind: 'landing-zone' as const, app: 'sovereign-health', passName: 'lz_fit', passSubLabel: 'otc:eu-de', completed: 1, total: 2 }, title: 'Fitting sovereign-health to the landing zone catalogue', stage: 'lz fit, otc:eu-de' },
  ];
  for (const c of cases) {
    for (const columns of [100, 80]) {
      it(`${c.name} run at ${columns} columns`, () => {
        const { lines } = mount(<RunningPhase header={HEADER} steps={c.steps} current={c.current} run={c.run} lines={OUTPUT} onCancel={() => undefined} />, columns);
        const ls = lines();
        const text = ls.join('\n');
        expect(text).toContain('S W A O');
        expect(text).toContain('Enterprise Edition');
        // The step bar is on Run (at 80 columns the bar names the current step only).
        expect(ls.some((l) => l.includes(String.fromCodePoint(0x25cf)) && l.includes('Run'))).toBe(true);
        expect(text).toContain(c.title);
        expect(text).toContain(`Stage ${c.run.completed + 1} of ${c.run.total}.`);
        expect(text).toContain(c.stage);
        expect(ls).toContain('Output');
        const hints = ls.indexOf(formatKeyHints(RUN_PANEL_KEYS));
        expect(hints).toBeGreaterThan(ls.indexOf('Output'));
        expect(ls[hints + 1]!.startsWith(String.fromCodePoint(0x250c))).toBe(true);
        expect(ls.filter((l) => l.includes('Esc'))).toHaveLength(1);
        expect(text).not.toMatch(/ -- |Cloning|Escape to cancel/);
        expect(Math.max(...ls.map((l) => [...l].length))).toBeLessThanOrEqual(columns);
      });
    }
  }

  it('the guidance box follows the run state: preparing, then the pass', () => {
    const run = { kind: 'application' as const, app: 'sovereign-health', passName: '', passSubLabel: '', completed: 0, total: 14 };
    const a = mount(<RunningPhase header={HEADER} steps={APP_STEPS} current={7} run={run} lines={[]} onCancel={() => undefined} />, 100);
    expect(a.lines().join('\n')).toContain('Preparing the run');
    const b = mount(<RunningPhase header={HEADER} steps={APP_STEPS} current={7} run={{ ...run, passName: 'sbom_cve', completed: 4 }} lines={[]} onCancel={() => undefined} />, 100);
    const text = b.lines().join('\n');
    expect(text).toContain('Running: Pass sbom cve');
    expect(text).not.toContain('Preparing the run');
  });

  it('Esc asks first (AbortDialog); Enter cancels once; Esc with the guidance open only closes the box', async () => {
    let cancelled = 0;
    const run = { kind: 'application' as const, app: 'sovereign-health', passName: 'egress', passSubLabel: '', completed: 6, total: 14 };
    const { lines, stdin } = mount(<RunningPhase header={HEADER} steps={APP_STEPS} current={7} run={run} lines={OUTPUT} onCancel={() => { cancelled++; }} />, 100);
    await wait();
    stdin.write('\u0007'); // Ctrl+G opens the box
    await wait();
    stdin.write('\u001b'); // Esc closes the box only
    await wait();
    expect(lines().join('\n')).not.toContain('Cancel the run?');
    stdin.write('\u001b'); // Esc asks
    await wait();
    expect(lines().join('\n')).toContain('Cancel the run?');
    expect(cancelled).toBe(0);
    stdin.write('\r');
    await wait();
    expect(cancelled).toBe(1);
  });
});

describe('run screen after the last pass (#4498)', () => {
  it('names the post-pass step with its progress and an Apps bar; one key hint row', () => {
    const run = { kind: 'application' as const, app: 'sovereign-health', passName: 'block_assessments', passSubLabel: '', completed: 14, total: 14, postStep: { label: 'Portfolio summary', done: 106, total: 235, noun: 'apps' } };
    const { lines } = mount(<RunningPhase header={HEADER} steps={APP_STEPS} current={APP_PHASE_STEP.running} run={run} lines={[...OUTPUT, '[post] Portfolio summary: 106 of 235 apps']} onCancel={() => undefined} />, 100);
    const ls = lines();
    const text = ls.join('\n');
    expect(text).toContain('Finishing, Portfolio summary: 106 of 235 apps');
    expect(text).not.toContain('Pass block assessments');
    expect(text).toContain('Apps');
    expect(text).toContain('Finishing: Portfolio summary');
    expect(ls.filter((l) => l === formatKeyHints(RUN_PANEL_KEYS))).toHaveLength(1);
  });
});
