// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, FinishPanel and ErrorPanel tests (#4253)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// The menus are SelectInput (#4249 in flight): these tests pin the lines the
// panels own (title, rows, menu label and entries in order), not the
// SelectInput internals, so they hold when #4249 lands.
//
// FP-01 M-13 at 100 and 80 columns: green title, aligned rows with the real run path, What next with Back to main menu last
// FP-02 Enter selects; "Back to main menu" calls onSelect(main-menu) and onMainMenu; no letter keys (Q-08)
// FP-03 level fail: red title, per-item reasons as two-line rows, empty scores "not measured"; a <ts> row is left out
// FP-04 F-03: FinishPanel inside ScreenLayout with the finish key hints directly above the guidance box
// EP-01 M-15 at 100 and 80 columns: [fail] title, cause in words, What now entries
// EP-02 a way back always exists; Enter is never dead (#4241); stack frames are not shown
// EP-03 errorGuidance: remedy, log path, CLI last

import { describe, it, expect, vi } from 'vitest';
import { Box, Text } from 'ink';
import {
  FinishPanel, ErrorPanel, FINISH_PANEL_KEYS, ERROR_PANEL_KEYS, FINISH_MAIN_MENU, ERROR_BACK,
  scoreText, finishRows, finishMenu, recoveryMenu, causeText, errorGuidance,
} from './FinishPanel.js';
import { ScreenLayout } from './ScreenLayout.js';
import { KeyHints, formatKeyHints } from './KeyHints.js';
import { renderAt, widest, type RenderedAt } from '../testing/render-at.js';

const KEY = { enter: '\r', down: '\u001B[B', up: '\u001B[A', left: '\u001B[D' } as const;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));
async function press(r: RenderedAt, ...keys: string[]): Promise<void> {
  for (const k of keys) { r.stdin.write(k); await tick(); }
}
const LICENCE = { tier: 'enterprise' as const, assessmentCount: 12, firstRun: '2026-01-01', exp: '2099-03-31' };

const M13_ROWS = [
  { label: 'Apps', value: '10 assessed, 234 researched' },
  { label: 'Attention', value: '3 apps need attention (end-of-life high)' },
  { label: 'Outputs', value: 'wsp/reports/portfolio-2026-11-09.xlsx\napps/<each app>/wsp/runs/2026-11-09T15-14-37/', path: true },
];
const M13_NEXT = [
  { label: 'Publish the HTML report of one app', value: 'publish-one' },
  { label: 'Publish the HTML reports of all ten apps', value: 'publish-all' },
  { label: 'Show the priority list', value: 'priority' },
  { label: 'Open the portfolio workbook', value: 'workbook' },
  { label: 'Re-run the research', value: 'rerun' },
  { label: 'Re-assess the same ten apps', value: 'reassess' },
  { label: 'Show details', value: 'details' },
];

function frame(columns: number, el: JSX.Element): string[] {
  const r = renderAt(el, columns, 60);
  const lines = r.lines().map((l) => l.trimEnd());
  r.unmount();
  return lines;
}

/** Index of the line that ends with `text` after the menu marker or blanks. */
const entryAt = (lines: string[], text: string): number => lines.findIndex((l) => l.trim().replace(/^❯\s*/, '') === text);

describe('FinishPanel (#4253, Design 126 section 4.7, mockup M-13)', () => {
  for (const columns of [100, 80]) {
    it(`FP-01 M-13 at ${columns} columns`, () => {
      const lines = frame(columns, (
        <Box flexDirection="column">
          <FinishPanel title="Service Portfolio Assessment complete" level="ok" rows={M13_ROWS} next={M13_NEXT} onSelect={() => {}} />
          <KeyHints hints={FINISH_PANEL_KEYS} />
        </Box>
      ));
      expect(lines.slice(0, 6)).toEqual([
        'Service Portfolio Assessment complete',
        '',
        '  Apps        10 assessed, 234 researched',
        '  Attention   3 apps need attention (end-of-life high)',
        '  Outputs     wsp/reports/portfolio-2026-11-09.xlsx',
        '              apps/<each app>/wsp/runs/2026-11-09T15-14-37/',
      ]);
      expect(lines[6]).toBe('');
      expect(lines[7]).toBe('What next:');
      const order = [...M13_NEXT.map((o) => o.label), 'Back to main menu'].map((l) => entryAt(lines, l));
      expect(order.every((i) => i > 7)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(order[1]! - order[0]!).toBe(1);
      expect(lines[order[0]!]).toMatch(/^ {2}❯ Publish the HTML report of one app/);
      expect(lines.at(-1)).toBe('↑↓ select   Enter open   Esc abort');
      expect(widest(lines)).toBeLessThanOrEqual(columns - 2);
      expect(lines.join('\n')).not.toContain('<ts>');
    });
  }

  it('FP-02 Enter selects; Back to main menu calls onSelect and onMainMenu', async () => {
    const onSelect = vi.fn();
    const onMainMenu = vi.fn();
    const r = renderAt(<FinishPanel title="Done" level="ok" rows={M13_ROWS} next={M13_NEXT.slice(0, 2)} onSelect={onSelect} onMainMenu={onMainMenu} />, 100);
    await tick();
    await press(r, KEY.enter);
    expect(onSelect).toHaveBeenLastCalledWith('publish-one');
    await press(r, 'l', 'c', KEY.down, KEY.down, KEY.enter);
    expect(onSelect).toHaveBeenLastCalledWith(FINISH_MAIN_MENU);
    expect(onSelect).toHaveBeenCalledTimes(2); // letter keys do nothing (Q-08)
    expect(onMainMenu).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it('FP-03 level fail: red title, per-item reasons, "not measured" scores, no <ts> row', () => {
    for (const columns of [100, 80]) {
      const lines = frame(columns, (
        <FinishPanel
          title="LLM Assessment failed"
          level="fail"
          rows={[
            { label: 'App', value: 'sovereign-health' },
            { label: 'Score', value: scoreText(null) },
            { label: 'Cost', value: '' },
            { label: 'Run', value: 'llm-assessments/swao/<ts>/' },
          ]}
          items={[
            { level: 'fail', label: 'lc-a', reason: 'landing zone lz-prod has no usable live run; run the LZ Live Assessment first, then compare again' },
            { level: 'cancelled', label: 'lc-b', reason: 'not started: the run was cancelled' },
          ]}
          next={[{ label: 'Show details', value: 'details' }]}
          onSelect={() => {}}
        />
      ));
      expect(lines[0]).toBe('LLM Assessment failed');
      expect(lines).toContain('  Score       not measured');
      expect(lines).toContain('  Cost        not measured');
      expect(lines.some((l) => l.includes('<ts>'))).toBe(false);
      const fail = lines.findIndex((l) => l.startsWith('  [fail]'));
      expect(lines[fail]).toMatch(/^ {2}\[fail\] {4}lc-a$/);
      const reason = lines.slice(fail + 1, lines.findIndex((l) => l.startsWith('  [cancelled]'))).map((l) => l.trim()).join(' ');
      expect(reason).toBe('landing zone lz-prod has no usable live run; run the LZ Live Assessment first, then compare again');
      expect(widest(lines)).toBeLessThanOrEqual(columns - 2);
    }
    expect(scoreText(7.25)).toBe('7.3');
    expect(finishRows([{ label: 'A', value: '-'.repeat(2) }])).toEqual([{ label: 'A', value: 'not measured' }]);
    expect(finishMenu([{ label: 'Back to main menu', value: FINISH_MAIN_MENU }, { label: 'X', value: 'x' }]).map((o) => o.value)).toEqual(['x', FINISH_MAIN_MENU]);
  });

  it('FP-04 F-03: inside ScreenLayout the finish hints sit directly above the guidance box', () => {
    const lines = frame(100, (
      <ScreenLayout
        header={{ subtitle: 'Service Portfolio Assessment', stepInfo: 'Finish', version: '1.6.1', licenseState: LICENCE }}
        steps={{ labels: ['Scope', 'Confirm', 'Run', 'Finish'], current: 3 }}
        keys={FINISH_PANEL_KEYS}
        guidance={{ title: 'Publish the HTML report of one app', what: 'Writes the HTML publication of the selected app from this run. CLI: swao publish --app <id>' }}
      >
        <FinishPanel title="Service Portfolio Assessment complete" level="ok" rows={M13_ROWS} next={M13_NEXT} onSelect={() => {}} />
      </ScreenLayout>
    ));
    const title = lines.indexOf('Service Portfolio Assessment complete');
    const hints = lines.indexOf(formatKeyHints(FINISH_PANEL_KEYS));
    expect(title).toBeGreaterThan(0);
    expect(entryAt(lines, 'Back to main menu')).toBeGreaterThan(title);
    expect(hints).toBeGreaterThan(entryAt(lines, 'Back to main menu'));
    expect(lines[hints + 1]).toMatch(/^┌─+┐$/);
    // #4256 (owner 2026-11-10 15:01): one key hint line per screen; the menus draw none of their own.
    expect(lines.filter((l) => l.includes('Enter confirm') || /select\s+Enter/.test(l))).toEqual([formatKeyHints(FINISH_PANEL_KEYS)]);
  });

  it('FP-05 #4256: the What next and What now menus draw no hint line of their own', () => {
    const finish = frame(100, <FinishPanel title="Done" level="ok" rows={M13_ROWS} next={M13_NEXT} onSelect={() => {}} />);
    const error = frame(100, <ErrorPanel title="Failed" cause="cause" recovery={M15_RECOVERY} onSelect={() => {}} />);
    for (const lines of [finish, error]) {
      expect(lines.some((l) => l.includes('Enter confirm') || l.includes('↑↓'))).toBe(false);
    }
  });
});

const M15_CAUSE = 'No probe result for scope platform of landing zone otc-prod. The login and the connection passed in the Setup Wizard, so the cause is in this run; the log has the details.';
const M15_RECOVERY = [
  { label: 'Probe again', value: 'probe' },
  { label: 'Continue without this scope', value: 'skip-scope' },
  { label: 'Back to the scope selection', value: ERROR_BACK },
];

describe('ErrorPanel (#4253, Design 126 section 4.9, mockup M-15)', () => {
  for (const columns of [100, 80]) {
    it(`EP-01 M-15 at ${columns} columns`, () => {
      const lines = frame(columns, (
        <Box flexDirection="column">
          <ErrorPanel title="Read-only probe failed" cause={M15_CAUSE} recovery={M15_RECOVERY} onSelect={() => {}} />
          <Text> </Text>
          <KeyHints hints={ERROR_PANEL_KEYS} />
        </Box>
      ));
      expect(lines[0]).toBe('[fail] Read-only probe failed');
      const what = lines.indexOf('What now:');
      expect(lines.slice(1, what - 1).join(' ')).toBe(M15_CAUSE);
      expect(lines[what - 1]).toBe('');
      expect(lines.slice(what + 1, what + 4).map((l) => l.trim().replace(/^❯\s*/, ''))).toEqual(M15_RECOVERY.map((o) => o.label));
      expect(lines.at(-1)).toBe('↑↓ select   Enter open   ← back   Esc abort');
      expect(widest(lines)).toBeLessThanOrEqual(columns - 2);
    });
  }

  it('EP-02 a way back always exists; Enter is never dead; no stack frames on screen', async () => {
    const onSelect = vi.fn();
    const onBack = vi.fn();
    const cause = 'Error: probe returned no result\n    at probe (C:/x/probe.js:10:5)\n    at run (C:/x/run.js:3:1)';
    const r = renderAt(<ErrorPanel title="Probe failed" cause={cause} recovery={[]} onSelect={onSelect} onBack={onBack} />, 80);
    await tick();
    expect(r.lastFrame()).toContain('probe returned no result');
    expect(r.lastFrame()).not.toContain('probe.js');
    expect(r.lastFrame()).not.toContain('Error:');
    await press(r, KEY.enter);
    expect(onSelect).toHaveBeenCalledWith(ERROR_BACK);
    await press(r, KEY.left);
    expect(onBack).toHaveBeenCalledTimes(1);
    r.unmount();
    expect(recoveryMenu([{ label: 'Retry', value: 'retry' }]).map((o) => o.value)).toEqual(['retry', ERROR_BACK]);
    expect(recoveryMenu(M15_RECOVERY)).toHaveLength(3);
    expect(causeText('TypeError: x is undefined')).toBe('x is undefined');
  });

  it('EP-03 errorGuidance names the remedy, the log path and the CLI equivalent last', () => {
    expect(errorGuidance({ title: 'Probe', remedy: 'Run the probe again.', logPath: 'wsp/logs/app-events-2026-11.ndjson', cli: 'swao lz probe' })).toEqual({
      title: 'Probe',
      what: 'Run the probe again. The log has the details: wsp/logs/app-events-2026-11.ndjson. CLI: swao lz probe',
    });
  });
});
