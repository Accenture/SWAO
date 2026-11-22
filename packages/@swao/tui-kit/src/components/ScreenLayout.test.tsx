// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, StepTitle and ScreenLayout tests (#4248)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// ST-01 M-03 at 100 and 80 columns: title, subtitle, level 2 section title
// ST-02 a long title and subtitle wrap within the header rule and are never cut
// SL-01 M-01 header with the licence line (commas, no bar, no double hyphen) at 100 and 80 columns
// SL-02 M-02 step bar: wide at the 100-column rule, first words at 78, bullets only at 63; no ellipsis
// SL-03 F-01 order: header, licence, step bar, title, content, key hints, guidance, footer
// SL-04 the key hints sit directly above the guidance box border; the box keys section repeats them in words
// SL-05 Q-07: the licence line shows on every screen; only chat hides it
// SL-06 Help: guidance null renders no box and keeps the hints

import { describe, it, expect } from 'vitest';
import { Box, Text } from 'ink';
import { StepTitle } from './StepTitle.js';
import { StepBar, fitStepBar } from './StepBar.js';
import { ScreenLayout, type ScreenLayoutProps } from './ScreenLayout.js';
import { KEY_HINTS, formatKeyHints } from './KeyHints.js';
import { renderAt, widest } from '../testing/render-at.js';

const LICENCE = { tier: 'enterprise' as const, assessmentCount: 12, firstRun: '2026-01-01', exp: '2099-03-31' };
const WIZARD_STEPS = ['Landing zones', 'Probe', 'Policy baseline', 'Org evidence', 'Health check', 'Ready'];

function frame(columns: number, el: JSX.Element): string[] {
  const r = renderAt(el, columns, 60);
  const lines = r.lines().map((l) => l.trimEnd());
  r.unmount();
  return lines;
}

function layout(over: Partial<ScreenLayoutProps> = {}): JSX.Element {
  return (
    <ScreenLayout
      header={{ subtitle: 'Setup: Landing Zone Live Assessment', stepInfo: 'Step 2 of 6', version: '1.6.1', licenseState: LICENCE }}
      steps={{ labels: WIZARD_STEPS, current: 1 }}
      title={{ title: 'Probe', subtitle: 'Checks the login, the read-only state and the coverage of each scope.' }}
      keys={KEY_HINTS.picker}
      guidance={{ title: 'Probe', what: 'The probe checks each scope with its login: identity, read-only state and readable routes.' }}
      footer="Footer line"
      {...over}
    >
      <Text>CONTENT ROW</Text>
    </ScreenLayout>
  );
}

describe('StepTitle (#4248, mockup M-03)', () => {
  for (const columns of [100, 80]) {
    it(`ST-01 M-03 at ${columns} columns`, () => {
      const lines = frame(columns, (
        <Box flexDirection="column">
          <StepTitle title="Tools" subtitle="Scanners and IaC tools on this machine, and what each one adds to the assessment." />
          <Text> </Text>
          <StepTitle title="Output" level={2} />
        </Box>
      ));
      const subtitle = 'Scanners and IaC tools on this machine, and what each one adds to the assessment.';
      expect(lines[0]).toBe('Tools');
      expect(lines.slice(-2)).toEqual(['', 'Output']);
      // Drawn at 100 columns (one line); at 80 the subtitle wraps, never cut.
      expect(lines.slice(1, -2)).toEqual(columns === 100 ? [subtitle] : expect.arrayContaining([expect.any(String)]));
      expect(lines.slice(1, -2).join(' ')).toBe(subtitle);
    });

    it(`ST-02 a long title and subtitle wrap within the rule at ${columns} columns, never cut`, () => {
      const title = 'LLM candidates for the comparison of connectors and models in the LLM Assessment of this workspace';
      const subtitle = 'The 2 to 4 connector and model pairs the LLM Assessment compares; each pair runs the same passes on the same app so the results can be compared side by side.';
      const lines = frame(columns, <StepTitle title={title} subtitle={subtitle} />);
      expect(lines.join(' ').replace(/\s+/g, ' ')).toBe(`${title} ${subtitle}`);
      expect(lines.join('\n')).not.toContain('...');
      expect(widest(lines)).toBeLessThanOrEqual(columns - 2);
      expect(lines.length).toBeGreaterThan(2);
    });
  }
});

const SETUP_STEPS = ['Init', 'LLM', 'Source access', 'Tools', 'Health check', 'MCP', 'Test code', 'Ready'];

function bar(width: number, columns: number): string {
  const fit = fitStepBar(SETUP_STEPS, 3, width);
  const lines = frame(columns, <StepBar steps={fit.labels} currentIndex={3} gap={fit.gap} bulletGap={fit.bulletGap} />);
  return lines.filter((l) => l.length > 0).join('|');
}

describe('StepBar fitted to the rule (#4248, mockup M-02)', () => {
  it('SL-02 wide at the 100-column rule, as drawn', () => {
    expect(bar(100, 102)).toBe('●  Init   ●  LLM   ●  Source access   ●  Tools   ○  Health check   ○  MCP   ○  Test code   ○  Ready');
  });
  it('SL-02 compact with full labels at the 98-column rule (100-column terminal)', () => {
    expect(bar(98, 100)).toBe('● Init  ● LLM  ● Source access  ● Tools  ○ Health check  ○ MCP  ○ Test code  ○ Ready');
  });
  it('SL-02 first words at the 78-column rule, as drawn', () => {
    expect(bar(78, 80)).toBe('● Init  ● LLM  ● Source  ● Tools  ○ Health  ○ MCP  ○ Test  ○ Ready');
  });
  it('SL-02 never an ellipsis; bullets only when nothing else fits', () => {
    const fit = fitStepBar(['Landing zones', 'Probe', 'Policy baseline', 'Org evidence', 'Health check', 'Ready', 'Extra one', 'Extra two', 'Extra three'], 1, 63);
    expect(fit.labels.join(' ')).not.toContain('...');
    const tight = fitStepBar(SETUP_STEPS, 3, 20);
    expect(tight.labels).toEqual(['', '', '', 'Tools', '', '', '', '']);
  });
});

describe('ScreenLayout (#4248, Design 126 section 3)', () => {
  for (const columns of [100, 80]) {
    const rule = columns - 2;
    it(`SL-01 M-01 header and licence line at ${columns} columns`, () => {
      const lines = frame(columns, layout());
      expect(lines[0]).toBe('='.repeat(rule));
      expect(lines[1]!.startsWith('S W A O  -  Sovereign Workload Assessment and Onboarding')).toBe(true);
      expect(lines[1]!.endsWith('v1.6.1')).toBe(true);
      expect(lines[1]).toHaveLength(rule);
      expect(lines[2]!.startsWith('Setup: Landing Zone Live Assessment')).toBe(true);
      expect(lines[2]!.endsWith('Step 2 of 6')).toBe(true);
      expect(lines[3]).toBe('='.repeat(rule));
      expect(lines[4]!.startsWith('Enterprise Edition v1.6.1, 12 assessments performed, expires 2099-03-31')).toBe(true);
      expect(lines[4]).not.toMatch(/\||--/);
    });

    it(`SL-02 and SL-03 F-01 block order at ${columns} columns`, () => {
      const lines = frame(columns, layout());
      const at = (pred: (l: string) => boolean): number => lines.findIndex(pred);
      const order = [
        at((l) => l.startsWith('S W A O')),
        at((l) => l.startsWith('Enterprise Edition')),
        at((l) => l.includes('Policy') && l.includes('Ready')),
        at((l) => l === 'Probe'),
        at((l) => l.startsWith('Checks the login')),
        at((l) => l === 'CONTENT ROW'),
        at((l) => l === formatKeyHints(KEY_HINTS.picker)),
        at((l) => l.startsWith('┌')),
        at((l) => l === 'Footer line'),
      ];
      for (const i of order) expect(i).toBeGreaterThanOrEqual(0);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(widest(lines)).toBeLessThanOrEqual(rule);
      // One left margin: every block starts in column 0 (no outer indent, #4235 row 3).
      for (const i of order) expect(lines[i]!.startsWith(' ')).toBe(false);
    });

    it(`SL-04 the key hints sit directly above the guidance box at ${columns} columns`, () => {
      const lines = frame(columns, layout());
      const hints = lines.indexOf(formatKeyHints(KEY_HINTS.picker));
      expect(lines[hints + 1]!.startsWith('┌')).toBe(true);
      expect(lines[hints + 2]).toContain('Probe   (Ctrl+G for guidance)');
    });
  }

  it('SL-04 the expanded box keys section repeats the hints in words', () => {
    const r = renderAt(layout({ guidance: { title: 'Probe', what: 'The probe checks each scope.', initiallyCollapsed: false } }), 100, 60);
    const text = r.lastFrame();
    r.unmount();
    expect(text).toContain('Up and Down arrows select   Enter next   Left arrow back   Esc abort');
  });

  it('SL-05 Q-07: the licence line shows unless the screen is Chat', () => {
    expect(frame(100, layout()).some((l) => l.startsWith('Enterprise Edition'))).toBe(true);
    expect(frame(100, layout({ chat: true })).some((l) => l.startsWith('Enterprise Edition'))).toBe(false);
  });

  it('SL-06 Help: no guidance box, the hints stay', () => {
    const lines = frame(100, layout({ guidance: null, keys: KEY_HINTS.menu, footer: undefined }));
    expect(lines.some((l) => l.startsWith('┌'))).toBe(false);
    expect(lines[lines.length - 1]).toBe(formatKeyHints(KEY_HINTS.menu));
  });

  it('SL-02 a flow with one step renders no step bar', () => {
    const lines = frame(100, layout({ steps: { labels: ['Only'], current: 0 } }));
    expect(lines.some((l) => l.includes('Only'))).toBe(false);
  });
});
