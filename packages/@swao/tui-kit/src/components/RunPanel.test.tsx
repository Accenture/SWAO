// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, RunPanel and StageProgress tests (#4252)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// RP-01 M-12 at 100 and 80 columns: title, stage line, bars with the percentage on one line, timer and ETA on their own line, Output section
// RP-02 the stage percentage includes the item share and moves with the apps done; no bar line wraps, also with a long ETA
// RP-03 output lines: dash normalisation, %LOCALAPPDATA% paths, hanging indent under the item text, never cut
// RP-04 Esc on a long run asks; Esc stays; Enter cancels once: abort signal fired, onCancel called once
// RP-05 Esc on a short run (probe) cancels at once; an open guidance box takes Esc first
// RP-06 helpers: normalizeRunDashes, shortenUserPaths, hangingPrefix, stagePercent, formatElapsed, formatEta

import { describe, it, expect, vi } from 'vitest';
import { Box, Text } from 'ink';
import { RunPanel, StageProgress, RUN_PANEL_KEYS, type StageProgressProps } from './RunPanel.js';
import { KeyHints, formatKeyHints } from './KeyHints.js';
import { normalizeRunDashes, shortenUserPaths, hangingPrefix, stagePercent, formatElapsed, formatEta, wrapWords } from './run-output.js';
import { renderAt, widest, type RenderedAt } from '../testing/render-at.js';

const EM = '\u2014';
const EN = '\u2013';
const DD = '-'.repeat(2);
const KEY = { enter: '\r', esc: '\u001B' } as const;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));
async function press(r: RenderedAt, ...keys: string[]): Promise<void> {
  for (const k of keys) { r.stdin.write(k); await tick(); }
}

const ENV = { LOCALAPPDATA: 'C:\\Users\\jdoe\\AppData\\Local', APPDATA: 'C:\\Users\\jdoe\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\jdoe' };
const PROGRESS: StageProgressProps = {
  stage: 2, stages: 4, label: 'Research', itemsDone: 188, itemsTotal: 234, itemsLabel: 'Apps', itemsNoun: 'apps',
  elapsedMs: (12 * 60 + 40) * 1000, etaMs: 21 * 60 * 1000,
};
const M12_LINES = [
  '[188/234] app0188  cve ok, eol high, virustotal ok, vendor ok, certificate ok',
  '[189/234] app0189  cve ok, eol ok, virustotal nothing to look up, vendor ok, certificate warn',
  `Pass 04 ${DD} context_ingestion: 3 sources read`,
  'Chromium at C:\\Users\\jdoe\\AppData\\Local\\ms-playwright',
];

function m12(columns: number): string[] {
  const r = renderAt((
    <Box flexDirection="column">
      <RunPanel title="Researching all 234 apps to rank the top 10" progress={PROGRESS} lines={M12_LINES} onCancel={() => {}} env={ENV} />
      <Text> </Text>
      <KeyHints hints={RUN_PANEL_KEYS} />
    </Box>
  ), columns);
  const lines = r.lines().map((l) => l.trimEnd());
  r.unmount();
  return lines;
}

describe('RunPanel and StageProgress (#4252, Design 126 section 4.6, mockup M-12)', () => {
  for (const columns of [100, 80]) {
    it(`RP-01 M-12 at ${columns} columns`, () => {
      const rule = columns - 2;
      const lines = m12(columns);
      expect(lines.slice(0, 3)).toEqual(['Researching all 234 apps to rank the top 10', 'Stage 2 of 4.', '']);
      expect(lines[3]).toMatch(/^ {2}Stage {3}\[█+░+\] {2}45%$/);
      expect([...lines[3]!].length).toBeLessThanOrEqual(rule);
      expect(lines[4]).toBe('          Research   elapsed 12m 40s   ETA 21m');
      expect(lines[5]).toMatch(/^ {2}Apps {4}\[█+░+\] {2}80%$/);
      expect([...lines[5]!].length).toBeLessThanOrEqual(rule);
      expect(lines[6]).toBe('          188 of 234 apps');
      expect(lines[7]).toBe('');
      expect(lines[8]).toBe('Output');
      if (columns === 100) expect(lines[9]).toBe('  [188/234] app0188  cve ok, eol high, virustotal ok, vendor ok, certificate ok');
      else expect(lines.slice(9, 11)).toEqual(['  [188/234] app0188  cve ok, eol high, virustotal ok, vendor ok, certificate', '                     ok']);
      expect(lines.at(-1)).toBe('Esc cancel');
      expect(lines).toContain('  Pass 04, context_ingestion: 3 sources read');
      expect(lines).toContain('  Chromium at %LOCALAPPDATA%\\ms-playwright');
      expect(widest(lines)).toBeLessThanOrEqual(rule);
      expect(lines.join('\n')).not.toContain('...');
    });
  }

  it('RP-02 the stage percentage moves with the apps done; no bar line wraps, also with a long ETA', () => {
    expect(stagePercent(2, 4, 0, 234)).toBe(25);
    expect(stagePercent(2, 4, 117, 234)).toBe(37);
    expect(stagePercent(2, 4, 234, 234)).toBe(50);
    expect(stagePercent(4, 4, 10, 10)).toBe(100);
    expect(stagePercent(1, 3)).toBe(0);
    for (const columns of [100, 80]) {
      const r = renderAt(<StageProgress {...PROGRESS} label="Assessment of the ten apps with the highest priority" etaMs={3 * 3600 * 1000 + 5 * 60 * 1000} />, columns);
      const lines = r.lines().map((l) => l.trimEnd());
      r.unmount();
      const bars = lines.filter((l) => l.includes('['));
      expect(bars).toHaveLength(2);
      expect(bars[0]).toMatch(/\] {2}45%$/);
      expect(bars[1]).toMatch(/\] {2}80%$/);
      // The timer line wraps under its own column; the bar lines stay single.
      const appsAt = lines.findIndex((l) => l.startsWith('  Apps'));
      const timer = lines.slice(1, appsAt);
      for (const l of timer) expect(l.startsWith(' '.repeat(10))).toBe(true);
      expect(timer.map((l) => l.trim()).join(' ')).toMatch(/^Assessment of the ten apps .*ETA 3h 05m$/);
      expect(widest(lines)).toBeLessThanOrEqual(columns - 2);
    }
  });

  it('RP-03 at 80 columns a long item line wraps under the item text, never cut', () => {
    const lines = m12(80);
    const at = lines.findIndex((l) => l.startsWith('  [189/234] app0189  '));
    expect(at).toBeGreaterThan(0);
    const next = lines[at + 1]!;
    expect(next.startsWith(' '.repeat(21))).toBe(true);
    expect(next[21]).not.toBe(' ');
    expect(`${lines[at]!.slice(21)} ${next.trim()}`).toBe('cve ok, eol ok, virustotal nothing to look up, vendor ok, certificate warn');
  });

  it('RP-04 Esc on a long run asks; Esc stays; Enter cancels once and aborts the run', async () => {
    const onCancel = vi.fn();
    const abort = new AbortController();
    const r = renderAt(<RunPanel title="Run" progress={PROGRESS} lines={[]} onCancel={onCancel} abort={abort} />, 100);
    await tick();
    await press(r, KEY.esc);
    expect(r.lastFrame()).toContain('Cancel the run? Results so far are kept as a cancelled run.');
    expect(r.lastFrame()).toContain(formatKeyHints([{ key: 'Enter', verb: 'cancel' }, { key: 'Esc', verb: 'stay' }]));
    await press(r, KEY.esc);
    expect(r.lastFrame()).not.toContain('Cancel the run?');
    expect(onCancel).not.toHaveBeenCalled();
    await press(r, KEY.esc, KEY.enter, KEY.esc, KEY.enter);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(abort.signal.aborted).toBe(true);
    r.unmount();
  });

  it('RP-05 Esc on a short run cancels at once; an open guidance box takes Esc first', async () => {
    const onCancel = vi.fn();
    const r1 = renderAt(<RunPanel title="Probe" progress={PROGRESS} lines={[]} onCancel={onCancel} confirmCancel={false} guidanceOpen />, 100);
    await tick();
    await press(r1, KEY.esc);
    expect(onCancel).not.toHaveBeenCalled();
    r1.unmount();
    const r = renderAt(<RunPanel title="Probe" progress={PROGRESS} lines={[]} onCancel={onCancel} confirmCancel={false} />, 100);
    await tick();
    await press(r, KEY.esc, KEY.esc);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(r.lastFrame()).not.toContain('Cancel the run?');
    r.unmount();
  });
});

describe('run output helpers (#4252, Design 126 section 8 rules 1 and 4)', () => {
  it('RP-06 normalizeRunDashes follows the core rules', () => {
    expect(normalizeRunDashes(`Pass 04 ${DD} context_ingestion`)).toBe('Pass 04, context_ingestion');
    expect(normalizeRunDashes(`a ${EM} b`)).toBe('a, b');
    expect(normalizeRunDashes(`a${EM}b`)).toBe('a, b');
    expect(normalizeRunDashes(`pages 1${EN}2`)).toBe('pages 1-2');
    expect(normalizeRunDashes(`swao assess ${DD}app x`)).toBe(`swao assess ${DD}app x`);
  });

  it('RP-06 shortenUserPaths replaces whole profile folders, most specific first, case-insensitive', () => {
    expect(shortenUserPaths('at C:\\Users\\jdoe\\AppData\\Local\\ms-playwright', ENV)).toBe('at %LOCALAPPDATA%\\ms-playwright');
    expect(shortenUserPaths('c:\\users\\jdoe\\appdata\\roaming\\Claude', ENV)).toBe('%APPDATA%\\Claude');
    expect(shortenUserPaths('C:\\Users\\jdoe\\swao and C:\\Users\\jdoe2\\x', ENV)).toBe('%USERPROFILE%\\swao and C:\\Users\\jdoe2\\x');
    expect(shortenUserPaths('wsp/runs/2026-11-09T15-14-37/', ENV)).toBe('wsp/runs/2026-11-09T15-14-37/');
    expect(shortenUserPaths('no env', {})).toBe('no env');
  });

  it('RP-06 hangingPrefix, formatElapsed and formatEta', () => {
    expect(hangingPrefix('[189/234] app0189  cve ok')).toBe('[189/234] app0189  ');
    expect(hangingPrefix('[ 9/15] probe-a  ok')).toBe('[ 9/15] probe-a  ');
    expect(hangingPrefix('Pass 04, context_ingestion')).toBeNull();
    expect(formatElapsed(45_000)).toBe('45s');
    expect(formatElapsed(760_000)).toBe('12m 40s');
    expect(formatElapsed(3_900_000)).toBe('1h 05m');
    expect(formatEta(40_000)).toBe('40s');
    expect(formatEta(21 * 60_000)).toBe('21m');
    expect(formatEta(65 * 60_000)).toBe('1h 05m');
    expect(wrapWords('aa bb cc', 5)).toEqual(['aa bb', 'cc']);
    expect(wrapWords('abcdefgh x', 3)).toEqual(['abc', 'def', 'gh', 'x']);
    expect(wrapWords('', 4)).toEqual(['']);
  });
});
