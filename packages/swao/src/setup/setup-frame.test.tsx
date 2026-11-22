// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4254 TUI-10 / #4223: the Ready rows are two-line StatusRows (the detail
// wraps under the label, nothing is cut) and every block stays within the
// header rule at 100 and 80 columns; a step outside the wizard draws its
// title, key hints and guidance box through SetupStepFrame.

import { describe, it, expect } from 'vitest';
import React, { useState } from 'react';
import { EventEmitter } from 'node:events';
import { render, Text } from 'ink';
import { headerRuleWidth, KEY_HINTS, formatKeyHints, ScreenLayout, SelectInput, useOptionGuidance, GuidanceOpenContext, createGuidanceOpenState, type SelectOption } from '@swao/tui-kit';
import { SETUP_ASSESSMENT_TYPES, SETUP_ASSESSMENT_TYPE_LABELS, SETUP_ASSESSMENT_TYPE_MIN_TIER } from '@swao/core';
import { createSetupRegistry } from './registry.js';
import { BranchReadyStep } from './BranchReadyStep.js';
import { SetupChromeContext, SetupStepFrame, type SetupChrome } from './setup-frame.js';
import { StatusRows } from './steps/step-ui.js';
import type { SetupCheckItem } from './types.js';
import { formatBranchCheck } from './branch-check.js';
import { defaultSetupRegistry } from './index.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

class FakeStdout extends EventEmitter {
  frames: string[] = [];
  constructor(readonly columns: number, readonly rows: number) { super(); }
  write = (frame: string): boolean => { this.frames.push(frame); return true; };
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  private data: string | null = null;
  write = (data: string): void => { this.data = data; this.emit('readable'); this.emit('data', data); };
  read = (): string | null => { const d = this.data; this.data = null; return d; };
  setEncoding(): void { /* not needed */ }
  setRawMode(): void { /* not needed */ }
  resume(): void { /* not needed */ }
  pause(): void { /* not needed */ }
  ref(): void { /* not needed */ }
  unref(): void { /* not needed */ }
}

const settle = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Polls until `cond` holds (bounded): under the loaded workspace suite a fixed wait was too short (#4230). */
async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await settle(20);
}
// eslint-disable-next-line no-control-regex
const plain = (t: string): string => t.replace(/\x1b\[[0-9;]*m/g, '');

async function linesAt(el: React.ReactElement, columns: number): Promise<string[]> {
  const stdout = new FakeStdout(columns, 60);
  const inst = render(el, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new FakeStdout(columns, 60) as unknown as NodeJS.WriteStream,
    stdin: new FakeStdin() as unknown as NodeJS.ReadStream,
    debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  await settle();
  const out = plain(stdout.frames[stdout.frames.length - 1] ?? '').split('\n');
  inst.unmount();
  return out;
}

const words = (lines: string[]): string => lines.join(' ').replace(/[│]/g, ' ').replace(/\s+/g, ' ');

// The details of the owner's screenshots of 2026-11-09 and 2026-11-10 (#4223).
const GITLEAKS = 'not found: The default secret scan (Pass 14 secrets) cannot run: every assessment records MAL-00 and lists the secret scan under the passes not executed.';
const OPENTOFU = 'not found: Nothing is lost in the assessment: SWAO reads OpenTofu sources and state files placed in the app inputs without the tool.';
const SEC = { label: 'Security tools', what: 'The scanners of Pass 14.' };
const IAC = { label: 'IaC tools', what: 'The infrastructure-as-code tools.' };
const ITEMS: SetupCheckItem[] = [
  { state: 'ok', label: 'Apps', detail: '1 app: sovereign-health' },
  { state: 'info', label: 'Clone sovereign-health', detail: 'wsp/inputs/source/ is empty; SWAO clones the repository at the first assessment', short: 'cloned at the first assessment' },
  { state: 'warn', label: 'gitleaks', detail: GITLEAKS, short: 'not found', group: SEC },
  { state: 'info', label: 'osv-scanner', detail: 'not found: x', short: 'not found', group: SEC },
  { state: 'ok', label: 'yara', detail: 'found: malware pattern rules', short: 'found', group: SEC },
  { state: 'info', label: 'opentofu', detail: OPENTOFU, short: 'not found', group: IAC },
  { state: 'ok', label: 'Health check', detail: 'passed' },
  { state: 'warn', label: 'Policy baseline CLIENT_LZ_POLICY_BASELINE', detail: 'framework not found in the workspace' },
];
const HEALTH = { scope: 'application' as const, probeCount: 15, failCount: 0, warnCount: 1, failedProbes: [], warnedProbes: ['Prerequisites'] };

const Noop = (): null => null;
const registryWith = (items: SetupCheckItem[]) => createSetupRegistry(
  { steps: [{ id: 'generic.init', label: 'Init', assessmentType: 'generic', order: 10, component: Noop }] },
  SETUP_ASSESSMENT_TYPES.map((t) => ({
    branch: {
      type: t, label: SETUP_ASSESSMENT_TYPE_LABELS[t], description: 'short', minTier: SETUP_ASSESSMENT_TYPE_MIN_TIER[t],
      ...(t === 'application' ? { readySummary: () => items } : {}),
    },
    steps: [],
  })),
);
const registry = registryWith(ITEMS);

function renderReady(el: React.ReactElement, columns: number, rows: number): { stdout: FakeStdout; stdin: FakeStdin; unmount: () => void } {
  const stdout = new FakeStdout(columns, rows);
  const stdin = new FakeStdin();
  const inst = render(el, {
    stdout: stdout as unknown as NodeJS.WriteStream, stderr: new FakeStdout(columns, rows) as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream, debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  return { stdout, stdin, unmount: () => inst.unmount() };
}
const lastLines = (s: FakeStdout): string[] => plain(s.frames[s.frames.length - 1] ?? '').split('\n');

describe('Ready step, one compact row per item (#4223 owner redesign)', () => {
  for (const columns of [100, 80]) {
    it(`one line per item, tools grouped, one Health check row, within the header rule at ${columns} columns`, async () => {
      const lines = await linesAt(
        <BranchReadyStep registry={registry} type="application" workspaceRoot="/ws" health={HEALTH} hasNext={false} onNext={() => {}} />,
        columns,
      );
      const rule = headerRuleWidth(columns);
      for (const line of lines) expect(line.trimEnd().length, line).toBeLessThanOrEqual(rule);
      const text = words(lines);
      expect(text).not.toContain('…');
      expect(text).toContain('Application Assessment: ready');
      // One Health check row with the warned probe on the same line; no duplicate item row, no "Check" row.
      expect(lines.filter((l) => /\[(ok|warn|fail|waiting)\]\s+Health check/.test(l))).toHaveLength(1);
      // The probe names follow the counts on the row (at 80 columns the value wraps under its own column).
      expect(text).toMatch(/\[warn\]\s+Health check\s+15 probes, 0 failures, 1 warning: Prerequisites/);
      expect(text).not.toMatch(/\bCheck\s+Prerequisites/);
      // Tool rows grouped: one row per group, non-ok members first, per-tool text not on screen.
      expect(text).toMatch(/\[warn\]\s+Security tools\s+gitleaks, osv-scanner not found; yara found/);
      expect(text).toMatch(/\[info\]\s+IaC tools\s+opentofu not found/);
      expect(text).not.toContain('Pass 14 secrets');
      expect(lines.some((l) => /\]\s+gitleaks/.test(l))).toBe(false);
      // Short values on the row; the long label stays whole (never broken inside a word).
      expect(text).toMatch(/Clone sovereign-health\s+cloned at the first assessment/);
      expect(lines.some((l) => l.includes('Policy baseline CLIENT_LZ_POLICY_BASELINE'))).toBe(true);
      // Hints and guidance box at the bottom; the box follows the highlighted row (the Health check row).
      const hints = lines.findIndex((l) => l.includes(formatKeyHints([{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'finish' }])));
      expect(hints).toBeGreaterThan(lines.findIndex((l) => l.includes('Security tools')));
      expect(lines[hints + 1]!.startsWith('┌')).toBe(true);
      expect(lines.slice(hints).join(' ')).toContain('Health check');
    });
  }

  it('the guidance follows the highlighted row: the Security tools group lists each tool with its explanation', async () => {
    const r = renderReady(<BranchReadyStep registry={registry} type="application" workspaceRoot="/ws" health={HEALTH} hasNext onNext={() => {}} />, 100, 60);
    await settle();
    for (let i = 0; i < 3; i++) { r.stdin.write('\u001B[B'); await settle(30); }
    const lines = lastLines(r.stdout);
    r.unmount();
    const box = lines.slice(lines.findIndex((l) => l.startsWith('┌')));
    expect(words(box)).toContain('Security tools');
    expect(words(box)).toContain('The scanners of Pass 14.');
  });

  it('pages a list taller than the terminal: the window holds the cursor, a "more" line and PgDn in the hints', async () => {
    const many: SetupCheckItem[] = Array.from({ length: 30 }, (_, i) => ({ state: 'ok', label: `Item ${i + 1}`, detail: 'set up' }));
    const r = renderReady(<BranchReadyStep registry={registryWith(many)} type="application" workspaceRoot="/ws" health={HEALTH} hasNext={false} onNext={() => {}} />, 100, 24);
    await settle();
    const lines = lastLines(r.stdout);
    r.unmount();
    const text = words(lines);
    expect(text).toMatch(/↓ \d+ more, rows 1 to \d+ of 31/);
    expect(text).toContain('PgDn page');
    expect(text).not.toContain('Item 30 ');
  });

  for (const columns of [100, 80]) {
    it(`the real Application branch with one app fits a 30-row terminal without paging at ${columns} columns`, async () => {
      const ws = mkdtempSync(join(tmpdir(), 'swao-4223-ready-'));
      try {
        writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\n', 'utf-8');
        mkdirSync(join(ws, 'apps', 'sovereign-health'), { recursive: true });
        writeFileSync(join(ws, 'apps', 'sovereign-health', '.swao.yml'), 'app_id: sovereign-health\nsource:\n  path: wsp/inputs/source/\n  vcs:\n    type: github\n    url: https://github.com/example/sovereign-health\n', 'utf-8');
        const r = renderReady(<BranchReadyStep registry={defaultSetupRegistry()} type="application" workspaceRoot={ws} health={HEALTH} hasNext={false} onNext={() => {}} />, columns, 30);
        await settle(150);
        const lines = lastLines(r.stdout);
        r.unmount();
        const used = lines.length - [...lines].reverse().findIndex((l) => l.trim() !== '');
        expect(used).toBeLessThanOrEqual(30);
        const text = words(lines);
        expect(text).not.toMatch(/\d+ more, rows/);
        expect(text).toContain('Security tools');
        expect(text).toContain('IaC tools');
        for (const l of lines) expect(l.trimEnd().length, l).toBeLessThanOrEqual(headerRuleWidth(columns));
      } finally {
        rmSync(ws, { recursive: true, force: true });
      }
    });
  }

  it('the CLI summary keeps the full text of every item (CLI parity)', () => {
    const out = formatBranchCheck({ type: 'application', state: 'ready', health: HEALTH, items: ITEMS }).join('\n');
    expect(out).toContain(`[warn] gitleaks: ${GITLEAKS}`);
    expect(out).toContain(`[info] opentofu: ${OPENTOFU}`);
    expect(out).toContain('Check:  Prerequisites');
  });

  it('StatusRows wraps a long text instead of cutting it (80 columns)', async () => {
    const lines = await linesAt(<StatusRows rows={[{ state: 'missing', label: 'source path', text: 'Enter the folder that holds the application source in the Source access step; SWAO reads it and never changes it.' }]} />, 80);
    for (const line of lines) expect(line.trimEnd().length).toBeLessThanOrEqual(headerRuleWidth(80));
    expect(words(lines)).toContain('SWAO reads it and never changes it.');
    expect(words(lines)).toContain('[missing]');
  });
});

describe('SetupStepFrame outside the wizard (#4254)', () => {
  it('draws the title, the standard hints of the kind and the guidance box', async () => {
    const lines = await linesAt(
      <SetupStepFrame title="Probe" subtitle="Checks each scope." kind="picker" guidance={{ title: 'Probe', what: 'The probe checks each scope with its login.' }}>
        <Text>CONTENT</Text>
      </SetupStepFrame>,
      100,
    );
    const at = (s: string): number => lines.findIndex((l) => l.includes(s));
    expect(at('Probe')).toBeLessThan(at('CONTENT'));
    expect(at('CONTENT')).toBeLessThan(at(formatKeyHints(KEY_HINTS.picker)));
    expect(lines[at(formatKeyHints(KEY_HINTS.picker)) + 1]!.startsWith('┌')).toBe(true);
  });
});

describe('SetupStepFrame inside the wizard (#4254)', () => {
  it('an inline back callback does not re-report the chrome on every render (no render loop)', async () => {
    let reports = 0;
    let latest: SetupChrome | null = null;
    let backs = 0;
    function Host(): JSX.Element {
      const [, setChrome] = useState<SetupChrome | null>(null);
      const report = React.useCallback((c: SetupChrome | null) => { reports++; if (c) latest = c; setChrome(c); }, []);
      return (
        <SetupChromeContext.Provider value={report}>
          <SetupStepFrame title="Policy Baseline" kind="multiSelect" back={() => { backs++; }}><Text>CONTENT</Text></SetupStepFrame>
        </SetupChromeContext.Provider>
      );
    }
    await linesAt(<Host />, 100);
    await settle(100);
    expect(reports).toBeLessThanOrEqual(3);
    (latest as SetupChrome | null)?.back?.();
    expect(backs).toBe(1);
  });
});

describe('SetupStepFrame inside the wizard: the open box follows the cursor (#4230)', () => {
  it('Ctrl+G opens the box; Down moves the selection, the box stays open and shows the entry of the new option', async () => {
    const OPTIONS: SelectOption[] = [
      { label: 'Platform scope', value: 'platform', guidance: { title: 'Platform landing zone', what: 'PLZTEXT the shared platform.', sections: [{ label: 'Reads', text: 'PLZSECTION' }] } },
      { label: 'Application scope', value: 'application', guidance: { title: 'Application landing zone', what: 'ALZTEXT one workload.', sections: [{ label: 'Reads', text: 'ALZSECTION' }] } },
    ];
    const picked: string[] = [];
    function Step(): JSX.Element {
      const { entry, onCursorChange } = useOptionGuidance({ title: 'Scope kind', what: 'STEPTEXT' });
      return (
        <SetupStepFrame title="Scope kind" kind="picker" guidance={entry}>
          <SelectInput label="Kind" options={OPTIONS} numbered showKeyHints={false} onCursorChange={onCursorChange} onSelect={(v) => picked.push(v)} />
        </SetupStepFrame>
      );
    }
    // The wizard host as SetupWizard.tsx draws it: block 8 from the reported chrome,
    // the guidance open state provided to the frame and the step (#4394).
    const guidance = createGuidanceOpenState();
    function Host(): JSX.Element {
      const [chrome, setChrome] = useState<SetupChrome | null>(null);
      const report = React.useCallback((c: SetupChrome | null) => setChrome(c), []);
      return (
        <GuidanceOpenContext.Provider value={guidance}>
        <ScreenLayout
          header={{ subtitle: 'Setup: Landing Zone Live Assessment', stepInfo: 'Step 1 of 4', version: '1.6.1' }}
          title={chrome?.title ? { title: chrome.title } : undefined}
          keys={KEY_HINTS.picker}
          guidance={chrome?.guidance ? { entry: chrome.guidance } : null}
        >
          <SetupChromeContext.Provider value={report}><Step /></SetupChromeContext.Provider>
        </ScreenLayout>
        </GuidanceOpenContext.Provider>
      );
    }
    const r = renderReady(<Host />, 100, 60);
    await until(() => words(lastLines(r.stdout)).includes('Platform landing zone'));
    expect(words(lastLines(r.stdout))).toContain('Platform landing zone');
    r.stdin.write('\u0007');
    await until(() => words(lastLines(r.stdout)).includes('PLZSECTION'));
    expect(words(lastLines(r.stdout))).toContain('PLZSECTION');
    // #4394: the box reported its open state to the provided owner.
    await until(() => guidance.isOpen());
    expect(guidance.isOpen()).toBe(true);
    r.stdin.write('\u001B[B');
    await until(() => words(lastLines(r.stdout)).includes('ALZSECTION'));
    const open = words(lastLines(r.stdout));
    expect(open).toContain('Application landing zone');
    expect(open).toContain('ALZSECTION');
    expect(open).not.toContain('PLZSECTION');
    // A number key still selects with the box open.
    r.stdin.write('1');
    await until(() => picked.length > 0);
    expect(picked).toEqual(['platform']);
    expect(guidance.isOpen()).toBe(true);
    r.unmount();
    // #4394: an unmounted box leaves the state closed (no reset by the test).
    await new Promise((res) => setTimeout(res, 40));
    expect(guidance.isOpen()).toBe(false);
  });
});
