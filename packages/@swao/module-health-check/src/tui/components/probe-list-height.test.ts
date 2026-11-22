// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Doctor module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4348 (Design 126 sections 3 and 10): the Health Check screen composition
// (header, title, engagement block, 26 probes with one fail and one warn row
// whose reasons wrap, summary line, key hints, guidance box) never grows past
// the terminal at 30, 40 and 50 rows, and the guidance box is always the last
// block on screen. The list window comes from the shared tui-kit height rule.

import { describe, it, expect } from 'vitest';
import React from 'react';
import { EventEmitter } from 'node:events';
import { render, Text } from 'ink';
import { DetailRow, KEY_HINTS, ScreenLayout } from '@swao/tui-kit';
import { HealthCheckProbeList, PROBE_LIST_SCROLL_TEXT } from './HealthCheckProbeList.js';

class FakeStdout extends EventEmitter {
  frames: string[] = [];
  constructor(readonly columns: number, readonly rows: number) { super(); }
  write = (frame: string): boolean => { this.frames.push(frame); return true; };
}
class FakeStdin extends EventEmitter {
  isTTY = true;
  private queue: string[] = [];
  write = (data: string): void => { this.queue.push(data); this.emit('readable'); };
  read = (): string | null => this.queue.shift() ?? null;
  setEncoding(): void { /* not needed */ }
  setRawMode(): void { /* not needed */ }
  resume(): void { /* not needed */ }
  pause(): void { /* not needed */ }
  ref(): void { /* not needed */ }
  unref(): void { /* not needed */ }
}

const settle = (ms = 120): Promise<void> => new Promise((r) => setTimeout(r, ms));
// eslint-disable-next-line no-control-regex
const plain = (t: string): string => t.replace(/\x1b\[[0-9;]*m/g, '');

const TOTAL = 26;
function probeLines(): string[] {
  const out: string[] = ['Running swao health-check...'];
  for (let i = 1; i <= TOTAL; i++) {
    const name = `Probe ${String(i).padStart(2, '0')}`.padEnd(24, '.');
    if (i === 19) out.push(`  [${i}/${TOTAL}] ${name}  FAIL  Service workspace: no app folder for the services of the intake yet; the Service Portfolio Assessment imports the intake workbook first and creates one app folder per service`);
    else if (i === 7) out.push(`  [${i}/${TOTAL}] ${name}  WARN  gitleaks not found on PATH; the default secret scan cannot run until it is installed`);
    else out.push(`  [${i}/${TOTAL}] ${name}  ok    fine`);
  }
  return out;
}

const LICENCE = { tier: 'enterprise' as const, assessmentCount: 12, firstRun: '2026-01-01', exp: '2099-03-31' };

function Screen(): JSX.Element {
  return React.createElement(ScreenLayout, {
    header: { subtitle: 'Health Check', version: '1.6.1', licenseState: LICENCE },
    title: { title: 'Health Check', subtitle: 'Licence, LLM, tools and inputs of this workspace, one row per probe.' },
    keys: KEY_HINTS.lastStep,
    guidance: { entry: { title: 'Health Check', what: 'Checks the licence, the LLM gateway, the tools and the inputs of this workspace.' } },
    children: [
      React.createElement(DetailRow, { key: 'e', label: 'Engagement', value: 'Sovereign Health (SH)', labelWidth: 12 }),
      React.createElement(DetailRow, { key: 'l', label: 'Lead', value: 'Demo Lead', labelWidth: 12 }),
      React.createElement(Text, { key: 'b' }, ' '),
      React.createElement(HealthCheckProbeList, { key: 'p', lines: probeLines(), done: true, guidance: 'none' }),
      React.createElement(Text, { key: 's' }, 'One or more probes need attention.'),
    ],
  });
}

async function frameAt(rows: number, keys: string[] = []): Promise<string[]> {
  const stdout = new FakeStdout(100, rows);
  const stdin = new FakeStdin();
  const inst = render(React.createElement(Screen), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new FakeStdout(100, rows) as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  await settle();
  for (const k of keys) { stdin.write(k); await settle(); }
  const lines = plain(stdout.frames[stdout.frames.length - 1] ?? '').split('\n');
  inst.unmount();
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  return lines;
}

describe('Health Check screen height (#4348)', () => {
  for (const rows of [30, 40, 50]) {
    it(`fits ${rows} terminal rows with the guidance box visible at the bottom`, async () => {
      const lines = await frameAt(rows);
      expect(lines.length).toBeLessThanOrEqual(rows - 1);
      expect(lines[lines.length - 1]!.startsWith('└')).toBe(true);
      expect(lines.some((l) => l.includes('Health Check   (Ctrl+G for guidance)'))).toBe(true);
      expect(lines.some((l) => l.includes('One or more probes need attention.'))).toBe(true);
      // At 30 and 40 rows the list does not fit: it pages and names what is hidden.
      if (rows < 50) expect(lines.some((l) => /↓ \d+ more/.test(l))).toBe(true);
      else expect(lines.some((l) => l.includes('Probe 26'))).toBe(true);
    });
  }

  it('keeps fitting while the cursor walks onto the wrapped fail row and pages with PgDn', async () => {
    const down = '\u001B[B';
    const lines = await frameAt(30, Array.from({ length: 18 }, () => down));
    expect(lines.length).toBeLessThanOrEqual(29);
    expect(lines[lines.length - 1]!.startsWith('└')).toBe(true);
    expect(lines.some((l) => l.includes('Probe 19'))).toBe(true);
    expect(lines.some((l) => l.includes('creates one app folder per'))).toBe(true);
    const paged = await frameAt(40, ['\u001B[6~']);
    expect(paged.length).toBeLessThanOrEqual(39);
    expect(paged.some((l) => /↑ \d+ more/.test(l))).toBe(true);
  });

  it('the probe guidance says how the list scrolls', () => {
    expect(PROBE_LIST_SCROLL_TEXT).toContain('PgUp and PgDn');
    expect(PROBE_LIST_SCROLL_TEXT).toContain('Up and Down arrows');
    // #4348: the wheel moves the selection (the terminal sends it as arrow keys); the old text said it scrolled the terminal window.
    expect(PROBE_LIST_SCROLL_TEXT).not.toContain('scrolls the terminal window');
  });
});

// #4295 / #4348: the label column widens to the longest probe name, so
// "Vendor catalogue (Tier 2)" never wraps inside the column ("(Tier" / "2)").
async function listAt(columns: number, lines: string[]): Promise<string[]> {
  const stdout = new FakeStdout(columns, 60);
  const inst = render(React.createElement(HealthCheckProbeList, { lines, done: true, guidance: 'none' }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new FakeStdout(columns, 60) as unknown as NodeJS.WriteStream,
    stdin: new FakeStdin() as unknown as NodeJS.ReadStream,
    debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  await settle();
  const out = plain(stdout.frames[stdout.frames.length - 1] ?? '').split('\n').map((l) => l.trimEnd()).filter((l) => l !== '');
  inst.unmount();
  return out;
}

describe('Health Check label column (#4295, #4348)', () => {
  const LINES = [
    '  [1/26] Licence.....................  ok    fine',
    '  [2/26] LLM gateway.................  ok    fine',
    '  [3/26] Vendor catalogue (Tier 2)...  ok    fine',
    '  [4/26] Service workspace...........  ok    fine',
  ];
  for (const columns of [100, 80]) {
    it(`"Vendor catalogue (Tier 2)" stays on one line and every label starts in one column at ${columns} columns`, async () => {
      const lines = await listAt(columns, LINES);
      expect(lines).toHaveLength(4);
      expect(lines.some((l) => l.includes('Vendor catalogue (Tier 2)'))).toBe(true);
      const starts = ['Licence', 'LLM gateway', 'Vendor catalogue', 'Service workspace'].map((n) => lines.find((l) => l.includes(n))!.indexOf(n));
      expect(new Set(starts).size).toBe(1);
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(columns);
    });
  }
});
