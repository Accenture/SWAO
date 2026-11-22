// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- TUI frame tests: TerminalFrame + GuidanceBox (#4123, #4111)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Root cause (#4123): Ink 4.4.1 paints frames of height >= stdout.rows with
// clearTerminal and bypasses log-update (ink/build/ink.js:157-160); the next
// shorter frame then erases the wrong line count. TerminalFrame keeps every
// frame at exactly rows - 1 lines. These tests pin that invariant across
// Ctrl+G toggles: without TerminalFrame the expanded frame is taller than the
// collapsed one and the height assertions fail.
//
// TF-01: every frame across expand / collapse / expand / collapse is rows - 1 lines
// TF-02: header, title and every menu item are identical to the first frame after two toggles
// TF-03: content taller than the frame is clipped at the bottom; the header stays
// TF-04: unknown height (non-TTY) renders children unwrapped
// GB-P-01..03: expanded box shows every section via paging, never "(N more sections)"
// GB-T-01: expanded box shows a long description in full (no truncation)

import { describe, it, expect } from 'vitest';
import React from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import { GuidanceBox, TerminalFrame, terminalFrameHeight, terminalFrameWidth, GUIDANCE_CLOSE_HINT, paginateDetails } from '@swao/tui-kit';

const ROWS = 40;
const CTRL_G = '\x07';
const PG_DOWN = '\x1b[6~';
const PG_UP = '\x1b[5~';

async function settle(ms = 60): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, ms));
}

const HEADER = [
  '='.repeat(80),
  '  SWAO  workspace: C:\\swao\\demo',
  '='.repeat(80),
];
const ITEMS = ['[1] Generate HTML report', '[2] HTML Editor', '[3] Export PDF', '[4] Export BI bundle'];

function PublishLike({ extraRows = 0 }: { extraRows?: number }): JSX.Element {
  return (
    <Box flexDirection="column">
      {HEADER.map((h) => <Text key={h}>{h}</Text>)}
      <Text bold>Publish</Text>
      {ITEMS.map((i) => <Text key={i}>{i}</Text>)}
      {Array.from({ length: extraRows }, (_, i) => <Text key={`x${i}`}>{`filler row ${i}`}</Text>)}
      <GuidanceBox
        title="Publish"
        what="Renders the latest assessment run into a shareable publication."
        details={[
          { label: 'Output', value: 'apps/<id>/wsp/publications/' },
          { label: 'Keys', value: 'Arrows to move, Enter to select, Esc to go back.' },
        ]}
        maxRows={30}
      />
    </Box>
  );
}

function lines(frame: string | undefined): string[] {
  return (frame ?? '').split('\n');
}

describe('TerminalFrame (#4123)', () => {
  it('TF-01: every frame across two Ctrl+G toggles is exactly rows - 1 lines', async () => {
    const { lastFrame, stdin } = render(<TerminalFrame rows={ROWS}><PublishLike /></TerminalFrame>);
    const heights: number[] = [lines(lastFrame()).length];
    for (let i = 0; i < 4; i++) {
      await settle();
      stdin.write(CTRL_G);
      await settle();
      heights.push(lines(lastFrame()).length);
    }
    expect(heights).toEqual(Array(5).fill(ROWS - 1));
  });

  it('TF-02: header, title and every item are intact after expand and collapse', async () => {
    const { lastFrame, stdin } = render(<TerminalFrame rows={ROWS}><PublishLike /></TerminalFrame>);
    const first = lines(lastFrame());
    await settle();
    stdin.write(CTRL_G);
    await settle();
    const expanded = lines(lastFrame());
    expect(expanded.join('\n')).toContain(GUIDANCE_CLOSE_HINT);
    stdin.write(CTRL_G);
    await settle();
    const after = lines(lastFrame());
    // The collapsed frame after two toggles matches the first frame line by line.
    expect(after).toEqual(first);
    for (const text of [...HEADER, 'Publish', ...ITEMS]) {
      expect(after.some((l) => l.includes(text))).toBe(true);
      expect(expanded.some((l) => l.includes(text))).toBe(true);
    }
  });

  it('TF-03: content taller than the frame is clipped at the bottom, the header stays', () => {
    const { lastFrame } = render(<TerminalFrame rows={20}><PublishLike extraRows={40} /></TerminalFrame>);
    const out = lines(lastFrame());
    expect(out).toHaveLength(19);
    expect(out[0]).toContain('====');
    expect(out[1]).toContain('workspace:');
    expect(out[3]).toContain('Publish');
    expect(out.join('\n')).not.toContain('filler row 39');
  });

  it('TF-08: on a wide terminal the frame is the header rule plus one column each side (#4110)', () => {
    // Ink wraps text at the frame edge; without the cap a 200-column terminal
    // lets lines run 100 columns past the rule.
    expect(terminalFrameWidth(200)).toBe(102);
    expect(terminalFrameWidth(102)).toBe(102);
    expect(terminalFrameWidth(100)).toBe(100);
    expect(terminalFrameWidth(80)).toBe(80);
    expect(terminalFrameWidth(undefined)).toBeUndefined();
    const { lastFrame } = render(<TerminalFrame rows={10} columns={60}><Text>{'word '.repeat(40)}</Text></TerminalFrame>);
    for (const l of lines(lastFrame())) expect(l.trimEnd().length).toBeLessThanOrEqual(60);
  });

  it('TF-04: unknown or tiny terminal height renders children unwrapped', () => {
    expect(terminalFrameHeight(undefined)).toBeUndefined();
    expect(terminalFrameHeight(1)).toBeUndefined();
    expect(terminalFrameHeight(30)).toBe(29);
    const { lastFrame } = render(<TerminalFrame rows={undefined}><Text>only line</Text></TerminalFrame>);
    // ink-testing-library stdout has no rows, so no padding lines are added.
    expect(lines(lastFrame())).toEqual(['only line']);
  });
});

describe('App root uses TerminalFrame (#4123)', () => {
  it('TF-05: App.tsx renders inside TerminalFrame and has no rows-tall root Box', () => {
    // A root Box of height stdout.rows always hits Ink's clear-terminal path and
    // lets yoga compress the screen when it is taller than the terminal.
    const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'App.tsx'), 'utf-8');
    // #4379: the frame may carry the Ctrl+C quit prompt as its status line.
    expect(app).toMatch(/<TerminalFrame[ >]/);
    expect(app).toContain('statusLine={ctrlCArmed ? <CtrlCQuitLine /> : undefined}');
    expect(app).not.toMatch(/height=\{termRows\}/);
  });

  it('TF-07: ChatScreen sizes its message viewport from the frame height, not the full terminal', () => {
    // The frame is rows - 1 lines; a viewport sized from stdout.rows loses its last line to the clip.
    const chat = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'ChatScreen.tsx'), 'utf-8');
    expect(chat).toMatch(/termRows = terminalFrameHeight\(stdout\.rows\)/);
    // #4110: and wraps messages at the frame width, not the terminal width.
    expect(chat).toMatch(/termCols = terminalFrameWidth\(stdout\.columns\)/);
  });

  it('TF-06: a screen taller than the frame is clipped, not compressed: every visible line is intact', () => {
    const { lastFrame } = render(
      <TerminalFrame rows={12}>
        <Box flexDirection="column">
          {HEADER.map((h) => <Text key={h}>{h}</Text>)}
          {ITEMS.map((i) => <Text key={i}>{i}</Text>)}
          {Array.from({ length: 20 }, (_, i) => <Text key={i}>{`row ${i}`}</Text>)}
        </Box>
      </TerminalFrame>,
    );
    const out = lines(lastFrame());
    expect(out.slice(0, 7)).toEqual([...HEADER, ...ITEMS]);
    expect(out.slice(7)).toEqual(['row 0', 'row 1', 'row 2', 'row 3']);
  });
});

const MANY = Array.from({ length: 6 }, (_, i) => ({
  label: `Section ${i + 1}`,
  value: `Value of section ${i + 1}, long enough to need its own line in the box.`,
}));

// #4250: sections render inline (one line each here), so the fixture uses maxRows 11 to keep paging.
describe('GuidanceBox paging (#4123, #4111)', () => {
  it('GB-P-01: never shows "(N more sections)"; shows a page indicator instead', () => {
    const { lastFrame } = render(
      <GuidanceBox title="T" what="W" details={MANY} initiallyCollapsed={false} maxRows={11} />,
    );
    const f = lastFrame() ?? '';
    expect(f).not.toMatch(/more sections/);
    // #4246 (Design 126 Q-01): the pager renders through KeyHints, no colons.
    expect(f).toMatch(/Sections 1 to \d of 6\.\s+PgDn next {3}PgUp previous/);
  });

  it('GB-P-02: PgDn reaches every section, PgUp goes back', async () => {
    const { lastFrame, stdin } = render(
      <GuidanceBox title="T" what="W" details={MANY} initiallyCollapsed={false} maxRows={11} />,
    );
    const seen = new Set<string>();
    const collect = () => { for (const d of MANY) if ((lastFrame() ?? '').includes(`${d.label}:`)) seen.add(d.label); };
    collect();
    for (let i = 0; i < MANY.length; i++) {
      await settle();
      stdin.write(PG_DOWN);
      await settle();
      collect();
    }
    expect([...seen].sort()).toEqual(MANY.map((d) => d.label).sort());
    expect(lastFrame() ?? '').toContain('of 6.');
    stdin.write(PG_UP);
    await settle();
    expect(lastFrame() ?? '').not.toContain('Section 6:');
  });

  it('GB-P-03: paginateDetails puts every section on exactly one page', () => {
    const pages = paginateDetails(MANY, 60, 5);
    expect(pages.flat()).toEqual(MANY);
    expect(pages.every((p) => p.length >= 1)).toBe(true);
    expect(paginateDetails(MANY, 60, 1000)).toHaveLength(1);
  });

  it('GB-T-01: the expanded box shows a long description in full', () => {
    const long = 'word '.repeat(90).trim() + ' END';
    const { lastFrame } = render(<GuidanceBox title="T" what={long} initiallyCollapsed={false} />);
    const f = (lastFrame() ?? '').replace(/[\u2502\s]+/g, ' ');
    expect(f).toContain('END');
    expect(long.length).toBeGreaterThan(280);
  });
});
