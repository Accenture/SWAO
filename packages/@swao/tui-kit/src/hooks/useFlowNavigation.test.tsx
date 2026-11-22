// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, useFlowNavigation, AbortDialog and ConfirmPanel tests (#4251)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// FN-01 Enter next; on the last step Enter finish calls onFinish (or onExit)
// FN-02 left arrow back keeps the values; right arrow only to a completed step; no back on the first step
// FN-03 Shift+Tab goes back in a text input; the arrows stay with the field
// FN-04 Esc on a clean flow exits at once; on a dirty flow the AbortDialog asks; Esc stays, Enter aborts once
// FN-05 Esc with the guidance box open closes the box and does not abort
// FN-06 Enter on the dialog does not reach the step input (contentActive)
// FN-07 running: the arrows and Esc are left to the run panel
// FN-08 hints(): no back on the first step, finish on the last step
// AD-01 M-14 at 100 and 80 columns: setup, run and exit (Q-03) dialogs
// CP-01 M-11 at 100 and 80 columns: title, subtitle, aligned rows, risk line
// CP-02 ConfirmPanel: Enter confirms; left arrow only with onBack; inside a flow one press goes back one step

import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useFlowNavigation, type FlowNavigationOptions } from './useFlowNavigation.js';
import { AbortDialog } from '../components/AbortDialog.js';
import { ConfirmPanel, CONFIRM_PANEL_KEYS } from '../components/ConfirmPanel.js';
import { KeyHints, formatKeyHints } from '../components/KeyHints.js';
import { GuidanceBox } from '../components/GuidanceBox.js';
import { renderAt, widest, type RenderedAt } from '../testing/render-at.js';

const KEY = { enter: '\r', esc: '\u001B', left: '\u001B[D', right: '\u001B[C', shiftTab: '\u001B[Z', ctrlG: '\u0007' } as const;

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));
async function press(r: RenderedAt, ...keys: string[]): Promise<void> {
  for (const k of keys) { r.stdin.write(k); await tick(); }
}

interface SampleProps extends Partial<FlowNavigationOptions> {
  onSelectSeen?: () => void;
  withGuidance?: boolean;
}

/** A three step flow: Name (text), Region (pick), Ready. Values live in the flow state. */
function SampleFlow(props: SampleProps): JSX.Element {
  const [values, setValues] = useState<Record<string, string>>({});
  const steps = ['Name', 'Region', 'Ready'];
  const nav = useFlowNavigation({
    steps, dirty: Object.keys(values).length > 0, onExit: props.onExit ?? (() => {}),
    ...(props.onFinish ? { onFinish: props.onFinish } : {}),
    ...(props.running !== undefined ? { running: props.running } : {}),
    textInput: props.textInput ?? false,
  });
  // The step content owns Enter: it records a value and calls next().
  useInput((input, key) => {
    if (key.return) { props.onSelectSeen?.(); setValues((v) => ({ ...v, [steps[nav.current]!]: `v${nav.current}` })); nav.next(); }
    else if (input === 'x') setValues((v) => ({ ...v, typed: 'x' }));
  }, { isActive: nav.contentActive });
  return (
    <Box flexDirection="column">
      <Text>{`STEP ${steps[nav.current]} reached=${nav.reached}`}</Text>
      <Text>{`VALUES ${JSON.stringify(values)}`}</Text>
      <Text>{`HINTS ${formatKeyHints(nav.hints('picker'))}`}</Text>
      {nav.dialog}
      {props.withGuidance && <GuidanceBox title="Region" what="Where the workload runs." onOpenChange={nav.onGuidanceOpenChange} />}
    </Box>
  );
}

const stepOf = (r: RenderedAt): string => /STEP (\w+)/.exec(r.lastFrame())?.[1] ?? '';

describe('useFlowNavigation (#4251, Design 126 section 7)', () => {
  it('FN-01 Enter next; Enter on the last step finishes to the main menu', async () => {
    const onFinish = vi.fn();
    const r = renderAt(<SampleFlow onFinish={onFinish} />, 100);
    await tick();
    expect(stepOf(r)).toBe('Name');
    await press(r, KEY.enter, KEY.enter);
    expect(stepOf(r)).toBe('Ready');
    await press(r, KEY.enter);
    expect(onFinish).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it('FN-01 without onFinish the finish calls onExit', async () => {
    const onExit = vi.fn();
    const r = renderAt(<SampleFlow onExit={onExit} />, 100);
    await tick();
    await press(r, KEY.enter, KEY.enter, KEY.enter);
    expect(onExit).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it('FN-02 back keeps the values; forth only to a completed step; no back on the first step', async () => {
    const r = renderAt(<SampleFlow />, 100);
    await tick();
    await press(r, KEY.left);
    expect(stepOf(r)).toBe('Name');
    await press(r, KEY.right);
    expect(stepOf(r)).toBe('Name'); // nothing completed yet
    await press(r, KEY.enter, KEY.enter);
    expect(stepOf(r)).toBe('Ready');
    await press(r, KEY.left, KEY.left);
    expect(stepOf(r)).toBe('Name');
    expect(r.lastFrame()).toContain('"Name":"v0","Region":"v1"');
    await press(r, KEY.right, KEY.right);
    expect(stepOf(r)).toBe('Ready');
    await press(r, KEY.right);
    expect(stepOf(r)).toBe('Ready');
    expect(r.lastFrame()).toContain('reached=2');
    r.unmount();
  });

  it('FN-03 Shift+Tab goes back inside a text input; the arrows stay with the field', async () => {
    const r = renderAt(<SampleFlow textInput />, 100);
    await tick();
    await press(r, KEY.enter);
    expect(stepOf(r)).toBe('Region');
    await press(r, KEY.left);
    expect(stepOf(r)).toBe('Region');
    await press(r, KEY.shiftTab);
    expect(stepOf(r)).toBe('Name');
    r.unmount();
  });

  it('FN-04 Esc on a clean flow returns to the main menu at once', async () => {
    const onExit = vi.fn();
    const r = renderAt(<SampleFlow onExit={onExit} />, 100);
    await tick();
    await press(r, KEY.esc);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(r.lastFrame()).not.toContain('Abort the setup?');
    r.unmount();
  });

  it('FN-04 Esc on a dirty flow asks; Esc stays; Enter aborts once', async () => {
    const onExit = vi.fn();
    const r = renderAt(<SampleFlow onExit={onExit} />, 100);
    await tick();
    await press(r, 'x', KEY.esc);
    expect(onExit).not.toHaveBeenCalled();
    expect(r.lastFrame()).toContain('Abort the setup? Entered values are not saved.');
    expect(r.lastFrame()).toContain('Enter abort   Esc stay');
    await press(r, KEY.esc);
    expect(r.lastFrame()).not.toContain('Abort the setup?');
    expect(onExit).not.toHaveBeenCalled();
    expect(stepOf(r)).toBe('Name');
    await press(r, KEY.esc, KEY.enter);
    expect(onExit).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it('FN-05 Esc with the guidance box open closes the box first and does not abort', async () => {
    const onExit = vi.fn();
    const r = renderAt(<SampleFlow onExit={onExit} withGuidance />, 100);
    await tick();
    await press(r, KEY.ctrlG);
    expect(r.lastFrame()).toContain('Where the workload runs.');
    await press(r, KEY.esc);
    expect(onExit).not.toHaveBeenCalled();
    await press(r, KEY.esc);
    expect(onExit).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it('FN-06 Enter on the dialog aborts and does not reach the step input', async () => {
    const onExit = vi.fn();
    const seen = vi.fn();
    const r = renderAt(<SampleFlow onExit={onExit} onSelectSeen={seen} />, 100);
    await tick();
    await press(r, 'x', KEY.esc, KEY.enter);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(seen).not.toHaveBeenCalled();
    r.unmount();
  });

  it('FN-07 running: the arrows and Esc are left to the run panel', async () => {
    const onExit = vi.fn();
    const r = renderAt(<SampleFlow onExit={onExit} running />, 100);
    await tick();
    await press(r, KEY.esc, KEY.left, KEY.right);
    expect(onExit).not.toHaveBeenCalled();
    expect(r.lastFrame()).not.toContain('Abort');
    r.unmount();
  });

  it('FN-08 hints: no back on the first step, finish on the last step', async () => {
    const r = renderAt(<SampleFlow />, 100);
    await tick();
    expect(r.lastFrame()).toContain('HINTS ↑↓ select   Enter next   Esc abort');
    await press(r, KEY.enter);
    expect(r.lastFrame()).toContain('HINTS ↑↓ select   Enter next   ← back   Esc abort');
    await press(r, KEY.enter);
    expect(r.lastFrame()).toContain('HINTS ↑↓ select   Enter finish   Esc abort');
    r.unmount();
  });
});

describe('AbortDialog (#4251, mockup M-14)', () => {
  for (const columns of [100, 80]) {
    it(`AD-01 M-14 at ${columns} columns: the box has the guidance box width`, () => {
      const cases = [
        ['setup', 'Abort the setup? Entered values are not saved.', 'Enter abort   Esc stay'],
        ['run', 'Cancel the run? Results so far are kept as a cancelled run.', 'Enter cancel   Esc stay'],
        ['exit', 'Exit SWAO?', 'Enter exit   Esc stay'],
      ] as const;
      for (const [what, question, keys] of cases) {
        const r = renderAt(<AbortDialog what={what} onAbort={() => {}} onStay={() => {}} />, columns);
        const lines = r.lines().map((l) => l.trimEnd());
        r.unmount();
        const rule = columns - 2; // the header rule at this terminal width
        expect(lines).toHaveLength(5);
        expect([...lines[0]!]).toHaveLength(rule - 2);
        expect(lines[1]).toBe(`│ ${question}`.padEnd(rule - 3) + '│');
        expect(lines[2]).toBe('│'.padEnd(rule - 3) + '│');
        expect(lines[3]).toBe(`│ ${keys}`.padEnd(rule - 3) + '│');
        expect(widest(lines)).toBe(rule - 2);
      }
    });
  }

  it('AD-02 Enter aborts, Esc stays', async () => {
    const onAbort = vi.fn();
    const onStay = vi.fn();
    const r = renderAt(<AbortDialog what="setup" onAbort={onAbort} onStay={onStay} />, 100);
    await tick();
    await press(r, KEY.esc);
    expect(onStay).toHaveBeenCalledTimes(1);
    await press(r, KEY.enter);
    expect(onAbort).toHaveBeenCalledTimes(1);
    r.unmount();
  });
});

const M11_ROWS = [
  { label: 'Apps', value: '234 service apps (research), top 10 (assessment)' },
  { label: 'Research', value: 'CVE, end-of-life, VirusTotal, vendor profile' },
  { label: 'LLM', value: 'Anthropic Claude (primary), Ollama (local, secondary)' },
  { label: 'Duration', value: 'about 35 min (measured pass times of the last run)' },
];
const M11_RISK = 'the landing zone login can write; SWAO sends read requests only';

describe('ConfirmPanel (#4251, mockup M-11)', () => {
  for (const columns of [100, 80]) {
    it(`CP-01 M-11 at ${columns} columns`, () => {
      const r = renderAt((
        <Box flexDirection="column">
          <ConfirmPanel
            title="Start the Service Portfolio Assessment"
            subtitle="Research all apps, then assess the ten with the highest priority."
            rows={M11_ROWS}
            risk={M11_RISK}
            onConfirm={() => {}}
          />
          <Text> </Text>
          <KeyHints hints={CONFIRM_PANEL_KEYS} />
        </Box>
      ), columns);
      const lines = r.lines().map((l) => l.trimEnd());
      r.unmount();
      expect(lines).toEqual([
        'Start the Service Portfolio Assessment',
        'Research all apps, then assess the ten with the highest priority.',
        '',
        '  Apps        234 service apps (research), top 10 (assessment)',
        '  Research    CVE, end-of-life, VirusTotal, vendor profile',
        '  LLM         Anthropic Claude (primary), Ollama (local, secondary)',
        '  Duration    about 35 min (measured pass times of the last run)',
        '  Risk:       the landing zone login can write; SWAO sends read requests only',
        '',
        'Enter confirm   ← back   Esc abort',
      ]);
      expect(widest(lines)).toBeLessThanOrEqual(columns === 100 ? 100 : 78);
    });
  }

  it('CP-01 a long risk wraps under the value column at 80 columns, never cut', () => {
    const risk = `${M11_RISK}; the assessment asks for your confirmation again at every run of this landing zone`;
    const r = renderAt(<ConfirmPanel title="Start" rows={M11_ROWS.slice(0, 1)} risk={risk} onConfirm={() => {}} />, 80);
    const lines = r.lines().map((l) => l.trimEnd());
    r.unmount();
    const riskAt = lines.findIndex((l) => l.startsWith('  Risk:'));
    const block = lines.slice(riskAt).filter((l) => l !== '');
    expect(block.length).toBeGreaterThan(1);
    // Continuations start exactly at the value column (Ink's own wrap would keep a blank, #4251 fix).
    for (const l of block.slice(1)) { expect(l.startsWith(' '.repeat(14))).toBe(true); expect(l[14]).not.toBe(' '); }
    expect(block.map((l, i) => (i === 0 ? l.slice(14) : l.trim())).join(' ')).toBe(risk);
    expect(widest(lines)).toBeLessThanOrEqual(78);
  });

  it('CP-02 Enter confirms; the left arrow goes back only when onBack is given', async () => {
    const onConfirm = vi.fn();
    const onBack = vi.fn();
    const r = renderAt(<ConfirmPanel title="Start" rows={M11_ROWS} onConfirm={onConfirm} onBack={onBack} />, 100);
    await tick();
    await press(r, KEY.left, KEY.enter);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it('CP-02 inside a flow one left arrow goes back exactly one step', async () => {
    function Flow(): JSX.Element {
      const nav = useFlowNavigation({ steps: ['Scope', 'Options', 'Confirm'], dirty: false, onExit: () => {}, initialStep: 0 });
      return (
        <Box flexDirection="column">
          <Text>{`STEP ${nav.current}`}</Text>
          {nav.current === 2
            ? <ConfirmPanel title="Start" rows={M11_ROWS} onConfirm={nav.next} active={nav.contentActive} />
            : <EnterNext onNext={nav.next} />}
        </Box>
      );
    }
    function EnterNext({ onNext }: { onNext(): void }): JSX.Element {
      useInput((_i, key) => { if (key.return) onNext(); });
      return <Text>step</Text>;
    }
    const r = renderAt(<Flow />, 100);
    await tick();
    await press(r, KEY.enter, KEY.enter);
    expect(r.lastFrame()).toContain('STEP 2');
    await press(r, KEY.left);
    expect(r.lastFrame()).toContain('STEP 1');
    r.unmount();
  });
});
