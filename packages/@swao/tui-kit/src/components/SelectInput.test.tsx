// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, SelectInput and MultiSelect (#4249)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4249 (TUI-05, Design 126 sections 4.1, 4.2, 5.1, 7.8, mockups M-04, M-05):
// PI-01 one cursor marker (U+276F) in both pickers; no "> " prefix
// PI-02 one over-wide label: the other rows carry no ellipsis at 100 and 80 columns (#4220)
// PI-03 one label colon (A-23)
// PI-04 M-04 menu: numbers and number keys only when `numbered` (Q-06)
// PI-05 M-04 picker of 235 apps: bounded by the terminal height without visibleCount, fits 24 rows (#4239)
// PI-06 M-04 filter: "n of m", Backspace, Ctrl+G is never typed into the filter
// PI-07 M-04 group headers
// PI-08 M-05 multi select: marker, [x], [ ], [-] on the "all" row
// PI-09 onCursorChange passes the option with its guidance entry; MultiSelect fires once per move
// PI-10 #4230: with the guidance box open, arrows move the selection and the box follows,
//       PgDn pages the box without moving the cursor, Esc closes the box and never selects
// PI-11 the picker's own hint line goes through KeyHints and can be switched off

import { describe, it, expect, vi } from 'vitest';
import { Box } from 'ink';
import { SelectInput, type SelectOption } from './SelectInput.js';
import { MultiSelect } from './MultiSelect.js';
import { GuidanceBox } from './GuidanceBox.js';
import { useOptionGuidance, type GuidanceEntry } from './guidance-entry.js';
import { headerRuleWidth } from './header-width.js';
import { renderAt, widest } from '../testing/render-at.js';
import {
  withLabelColon, resolveVisibleCount, labelColumnWidth, rowLabelWidth, fitDetail, detailLines, nextFilterQuery, windowEnd, scrollTopFor,
  PICKER_VISIBLE_COUNT,
} from './picker.js';

const MARKER = String.fromCodePoint(0x276f);
const DOWN = '\u001B[B';
const UP = '\u001B[A';
const PGDN = '\u001B[6~';
const ESC = '\u001B';
const CTRL_G = '\u0007';
const BACKSPACE = '\u007F';

const settle = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function press(stdin: { write(d: string): void }, ...keys: string[]): Promise<void> {
  await settle();
  for (const k of keys) {
    stdin.write(k);
    await settle();
  }
}

const APPS: SelectOption[] = Array.from({ length: 235 }, (_, i) => ({
  label: `app${String(i + 1).padStart(4, '0')}`,
  value: `app${i + 1}`,
}));

describe('picker rules (#4249)', () => {
  it('one label colon', () => {
    expect(withLabelColon('Select application')).toBe('Select application:');
    expect(withLabelColon('Select application to assess:')).toBe('Select application to assess:');
    expect(withLabelColon('')).toBe('');
  });

  it('window size: explicit wins; unknown height unbounded; known height bounds long lists only', () => {
    expect(resolveVisibleCount(5, 40, 235)).toBe(5);
    expect(resolveVisibleCount(undefined, undefined, 235)).toBe(235);
    expect(resolveVisibleCount(undefined, 24, 235)).toBe(PICKER_VISIBLE_COUNT);
    expect(resolveVisibleCount(undefined, 50, 235)).toBe(36);
    expect(resolveVisibleCount(undefined, 24, 4)).toBe(4);
  });

  it('padding is capped at the row width; the detail is cut only when it does not fit', () => {
    // #4220 day 2: the longest fitting label, not the row width (DetailRow pattern).
    expect(labelColumnWidth(['a', 'x'.repeat(150)], 96, 2)).toBe(1);
    expect(labelColumnWidth(['abc', 'ab'], 96, 2)).toBe(3);
    // With a detail column a label fits only when the gap and MIN_DETAIL_WIDTH still fit.
    expect(labelColumnWidth(['abc', 'y'.repeat(90)], 96, 2, true)).toBe(3);
    expect(labelColumnWidth(['abc', 'y'.repeat(84)], 96, 2, true)).toBe(84);
    // No label leaves room for a detail: the longest that fits the row.
    expect(labelColumnWidth(['y'.repeat(90)], 96, 2, true)).toBe(90);
    expect(rowLabelWidth('abcdef', 3)).toBe(6);
    expect(rowLabelWidth('ab', 3)).toBe(3);
    expect(fitDetail('workspace', 96, 40)).toBe('workspace');
    expect(fitDetail('workspace', 44, 40)).toBe('');
  });

  it('#4213: the detail wraps under its column or under the label, never cut with an ellipsis', () => {
    expect(detailLines('workspace', 96, 40, 2)).toEqual({ first: 'workspace', rest: [], restIndent: 0 });
    // Room 18 after a 40-column label and the gap: a hanging indent under the detail column (42).
    expect(detailLines('one two three four five six seven', 60, 40, 2)).toEqual({ first: 'one two three four', rest: ['five six seven'], restIndent: 42 });
    // Fewer than MIN_DETAIL_WIDTH columns beside the label: the detail moves under the label.
    expect(detailLines('the detail text', 44, 40, 2)).toEqual({ first: '', rest: ['the detail text'], restIndent: 2 });
    for (const d of [detailLines('x'.repeat(50), 60, 40, 2), detailLines('a b '.repeat(30), 50, 44, 6)]) {
      const text = [d.first, ...d.rest].join(' ');
      expect(text.includes('...') || text.includes('…')).toBe(false);
      for (const l of d.rest) expect(d.restIndent + l.length).toBeLessThanOrEqual(60);
    }
    // A wrapped row counts with its height in the window (#4348): 2 + 2 lines fill 4 rows.
    expect(windowEnd([undefined, undefined, undefined], 0, 4, [2, 2, 1])).toBe(2);
    expect(windowEnd([undefined, undefined, undefined], 0, 4)).toBe(3);
    expect(scrollTopFor([undefined, undefined, undefined], 0, 2, 3, [2, 2, 1])).toBe(1);
  });

  it('filter keys: printable characters and Backspace; chords and navigation never', () => {
    const k = (over: Record<string, boolean> = {}) => ({ upArrow: false, downArrow: false, leftArrow: false, rightArrow: false, pageDown: false, pageUp: false, return: false, escape: false, ctrl: false, shift: false, tab: false, backspace: false, delete: false, meta: false, ...over });
    expect(nextFilterQuery('he', 'a', k(), { space: true })).toBe('hea');
    expect(nextFilterQuery('he', 'g', k({ ctrl: true }), { space: true })).toBeNull();
    expect(nextFilterQuery('he', '', k({ backspace: true }), { space: true })).toBe('h');
    expect(nextFilterQuery('he', '', k({ delete: true }), { space: true })).toBe('h');
    expect(nextFilterQuery('he', ' ', k(), { space: false })).toBeNull();
    expect(nextFilterQuery('he', '', k({ pageDown: true }), { space: true })).toBeNull();
  });

  it('the window counts group headers and keeps the cursor inside', () => {
    const groups = ['A', 'B', 'B', 'B', 'B', 'B'];
    expect(windowEnd(groups, 0, 4)).toBe(2); // A header, a, B header, b1
    expect(scrollTopFor(groups, 0, 4, 4)).toBe(2); // B header, b2, b3, b4
    expect(scrollTopFor(groups, 3, 1, 4)).toBe(1);
  });
});

describe('SelectInput (#4249, mockup M-04)', () => {
  it('PI-01 the only cursor marker is U+276F', () => {
    const r = renderAt(<SelectInput label="Pick" options={[{ label: 'One', value: '1' }, { label: 'Two', value: '2' }]} onSelect={() => undefined} />, 100);
    const lines = r.lines();
    r.unmount();
    expect(lines.find((l) => l.includes('One'))).toContain(`${MARKER} One`);
    expect(lines.find((l) => l.includes('Two'))).not.toContain(MARKER);
    expect(lines.join('\n')).not.toMatch(/(^|\s)> /m);
  });

  for (const columns of [100, 80]) {
    it(`PI-02 one over-wide label leaves the other rows without an ellipsis at ${columns} columns (#4220)`, () => {
      const options = [
        { label: 'Anthropic Claude', value: 'a' },
        { label: `Remote OpenAI-compatible endpoint ${'x'.repeat(150)}`, value: 'r' },
        { label: 'Ollama (local)', value: 'o' },
      ];
      const r = renderAt(<SelectInput label="Select LLM connector" options={options} onSelect={() => undefined} />, columns);
      const lines = r.lines().map((l) => l.trimEnd());
      r.unmount();
      for (const short of ['Anthropic Claude', 'Ollama (local)']) {
        const line = lines.find((l) => l.includes(short))!;
        expect(line).not.toMatch(/…|\.\.\./);
      }
      expect(widest(lines)).toBeLessThanOrEqual(headerRuleWidth(columns));
    });
  }

  for (const columns of [100, 80]) {
    it(`PI-02b one over-wide label: the short rows keep their padding and their detail at ${columns} columns (#4220)`, () => {
      const options = [
        { label: 'Anthropic Claude', value: 'a', detail: 'workspace' },
        { label: `Remote OpenAI-compatible endpoint ${'x'.repeat(150)}`, value: 'r', detail: 'workspace' },
        { label: 'Ollama (local)', value: 'o', detail: 'local server' },
      ];
      const r = renderAt(<SelectInput label="Select LLM connector" options={options} onSelect={() => undefined} showKeyHints={false} />, columns);
      const lines = r.lines().map((l) => l.trimEnd());
      r.unmount();
      // Padded to the longest fitting label (16), then the gap and the detail.
      expect(lines.find((l) => l.includes('Anthropic Claude'))).toBe(`  ${MARKER} Anthropic Claude  workspace`);
      expect(lines.find((l) => l.includes('Ollama'))).toBe('    Ollama (local)    local server');
      // Only the over-wide row is cut, and it stays inside the rule.
      const wide = lines.find((l) => l.includes('Remote OpenAI'))!;
      expect(wide.length).toBeLessThanOrEqual(headerRuleWidth(columns));
      expect(widest(lines)).toBeLessThanOrEqual(headerRuleWidth(columns));
    });
  }

  it('PI-02 M-04 narrow LLM connectors with a detail column, no ellipsis, inside 78 columns', () => {
    const options = [
      { label: 'Anthropic Claude', value: 'a', detail: 'workspace' },
      { label: 'Amazon Bedrock', value: 'b', detail: 'workspace' },
      { label: 'Ollama (local)', value: 'o', detail: 'workspace' },
      { label: 'GenAI Hub / vLLM (OpenAI-compatible)', value: 'g', detail: 'workspace' },
    ];
    const r = renderAt(<SelectInput label="Select LLM connector" options={options} onSelect={() => undefined} showKeyHints={false} />, 80);
    const lines = r.lines().map((l) => l.trimEnd()).filter((l) => l !== '');
    r.unmount();
    expect(lines).toEqual([
      'Select LLM connector:',
      `  ${MARKER} Anthropic Claude                      workspace`,
      '    Amazon Bedrock                        workspace',
      '    Ollama (local)                        workspace',
      '    GenAI Hub / vLLM (OpenAI-compatible)  workspace',
    ]);
  });

  it('PI-03 a label with a trailing colon gets no second colon (A-23)', () => {
    const r = renderAt(<SelectInput label="Select application to assess:" options={[{ label: 'a', value: 'a' }]} onSelect={() => undefined} />, 100);
    const f = r.lastFrame();
    r.unmount();
    expect(f).toContain('Select application to assess:');
    expect(f).not.toContain('::');
  });

  it('PI-04 M-04 menu: numbers in one column and number keys select (Q-06)', async () => {
    const onSelect = vi.fn();
    const menu: SelectOption[] = [
      { label: 'Workspace Setup', value: 'setup', detail: 'set up the workspace and each assessment type' },
      { label: 'Health Check', value: 'health', detail: 'licence, LLM, tools and inputs ready' },
      { label: 'Tools', value: 'tools', detail: 'lenses, licence, credentials, help', number: '9' },
      { label: 'Exit', value: 'exit', number: '0' },
    ];
    const r = renderAt(<SelectInput label="Main menu" options={menu} numbered onSelect={onSelect} showKeyHints={false} />, 100);
    const lines = r.lines().map((l) => l.trimEnd()).filter((l) => l !== '');
    expect(lines).toEqual([
      'Main menu:',
      `  ${MARKER} 1  Workspace Setup  set up the workspace and each assessment type`,
      '    2  Health Check     licence, LLM, tools and inputs ready',
      '    9  Tools            lenses, licence, credentials, help',
      '    0  Exit',
    ]);
    await press(r.stdin, '9');
    r.unmount();
    expect(onSelect).toHaveBeenCalledWith('tools');
  });

  it('PI-04 a picker shows no numbers and ignores number keys', async () => {
    const onSelect = vi.fn();
    const r = renderAt(<SelectInput label="Pick" options={[{ label: 'One', value: '1' }, { label: 'Two', value: '2' }]} onSelect={onSelect} />, 100);
    expect(r.lastFrame()).not.toMatch(/\b1 {2}One/);
    await press(r.stdin, '2');
    r.unmount();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('PI-05 235 apps without visibleCount fit 24 rows with the more lines (#4239)', async () => {
    const r = renderAt(<SelectInput label="Select application to assess" options={APPS} onSelect={() => undefined} />, 100, 24);
    let lines = r.lines();
    expect(lines.length).toBeLessThanOrEqual(24);
    expect(lines.join('\n')).toContain('app0001');
    expect(lines.join('\n')).not.toContain('app0235');
    expect(lines.join('\n')).toContain(`↓ ${235 - PICKER_VISIBLE_COUNT} more`);
    await press(r.stdin, ...Array.from({ length: PICKER_VISIBLE_COUNT }, () => DOWN));
    lines = r.lines();
    r.unmount();
    expect(lines.join('\n')).toContain('↑ 1 more');
    expect(lines.find((l) => l.includes(MARKER))).toContain('app0011');
  });

  it('PI-06 M-04 filter: "n of m", Backspace widens, Ctrl+G is not typed', async () => {
    const onCursor = vi.fn();
    const r = renderAt(<SelectInput label="Select application to assess" options={APPS} filter itemNoun="apps" visibleCount={PICKER_VISIBLE_COUNT} onSelect={() => undefined} onCursorChange={onCursor} />, 100);
    // #4492: the filter field shows its cursor and the invitation with the total.
    expect(r.lastFrame()).toContain('Filter: ▏ type to narrow 235 apps');
    await press(r.stdin, '0', '2', '3');
    expect(r.lastFrame()).toMatch(/Filter: 023▏\s+7 of 235 apps/);
    expect(onCursor).toHaveBeenLastCalledWith('app23', expect.objectContaining({ label: 'app0023' }));
    await press(r.stdin, CTRL_G);
    expect(r.lastFrame()).toMatch(/Filter: 023▏\s+7 of 235 apps/);
    await press(r.stdin, BACKSPACE);
    const f = r.lastFrame();
    r.unmount();
    expect(f).toMatch(/Filter: 02▏\s+\d+ of 235 apps/);
    const line = f.split('\n').find((l) => l.startsWith('  Filter'))!;
    expect(line.trimEnd().length).toBeLessThanOrEqual(headerRuleWidth(100));
  });

  it('PI-07 M-04 group headers above each group', () => {
    const options: SelectOption[] = [
      { label: 'sovereign-health', value: 'sh', detail: 'set up in the Setup Wizard', group: 'Applications' },
      { label: 'app0101', value: 'a1', detail: 'service app', group: 'Service apps' },
      { label: 'app0102', value: 'a2', detail: 'service app', group: 'Service apps' },
    ];
    const r = renderAt(<SelectInput label="Select application to assess" options={options} onSelect={() => undefined} showKeyHints={false} />, 100);
    const lines = r.lines().map((l) => l.trimEnd()).filter((l) => l !== '');
    r.unmount();
    expect(lines).toEqual([
      'Select application to assess:',
      '  Applications',
      `  ${MARKER} sovereign-health  set up in the Setup Wizard`,
      '  Service apps',
      '    app0101           service app',
      '    app0102           service app',
    ]);
  });

  it('PI-09 onCursorChange passes the option with its guidance entry', async () => {
    const onCursor = vi.fn();
    const g: GuidanceEntry = { title: 'Two', what: 'The second option.' };
    const r = renderAt(<SelectInput label="Pick" options={[{ label: 'One', value: '1' }, { label: 'Two', value: '2', guidance: g }]} onSelect={() => undefined} onCursorChange={onCursor} />, 100);
    await press(r.stdin, DOWN);
    r.unmount();
    expect(onCursor).toHaveBeenNthCalledWith(1, '1', expect.objectContaining({ value: '1' }));
    expect(onCursor).toHaveBeenLastCalledWith('2', expect.objectContaining({ guidance: g }));
  });

  it('PI-11 the hint line uses the KeyHints verbs and can be switched off', () => {
    const on = renderAt(<SelectInput label="Pick" options={[{ label: 'One', value: '1' }]} onSelect={() => undefined} />, 100);
    expect(on.lastFrame()).toContain('↑↓ select   Enter confirm');
    on.unmount();
    const off = renderAt(<SelectInput label="Pick" options={[{ label: 'One', value: '1' }]} onSelect={() => undefined} showKeyHints={false} />, 100);
    expect(off.lastFrame()).not.toContain('Enter');
    off.unmount();
  });
});

describe('MultiSelect (#4249, mockup M-05)', () => {
  const FW = [
    { label: 'All frameworks', value: 'all' },
    { label: 'BSI C5', value: 'c5', detail: 'German cloud controls catalogue' },
    { label: 'ISO 27001', value: 'iso', detail: 'information security management' },
    { label: 'NIS2', value: 'nis2', detail: 'EU network and information security directive' },
  ];

  it('PI-08 M-05 marker, [x], [ ] and [-] on the "all" row', () => {
    const r = renderAt(<MultiSelect label="Select community frameworks" options={FW} allValue="all" initialSelected={['c5', 'nis2']} onConfirm={() => undefined} showKeyHints={false} />, 100);
    const lines = r.lines().map((l) => l.trimEnd()).filter((l) => l !== '');
    r.unmount();
    expect(lines).toEqual([
      'Select community frameworks:',
      '    [-] All frameworks',
      `  ${MARKER} [x] BSI C5          German cloud controls catalogue`,
      '    [ ] ISO 27001       information security management',
      '    [x] NIS2            EU network and information security directive',
    ]);
  });

  for (const columns of [100, 80]) {
    it(`PI-02 one over-wide label leaves the other rows without an ellipsis at ${columns} columns`, () => {
      const options = [{ label: 'Short', value: 's' }, { label: 'y'.repeat(160), value: 'y' }, { label: 'Tiny', value: 't' }];
      const r = renderAt(<MultiSelect label="Pick" options={options} onConfirm={() => undefined} />, columns);
      const lines = r.lines().map((l) => l.trimEnd());
      r.unmount();
      expect(lines.find((l) => l.includes('Short'))).not.toMatch(/…|\.\.\./);
      expect(lines.find((l) => l.includes('Tiny'))).not.toMatch(/…|\.\.\./);
      expect(widest(lines)).toBeLessThanOrEqual(headerRuleWidth(columns));
    });
  }

  it('PI-03 one label colon', () => {
    const r = renderAt(<MultiSelect label="Select scopes:" options={FW} onConfirm={() => undefined} />, 100);
    const f = r.lastFrame();
    r.unmount();
    expect(f).toContain('Select scopes:');
    expect(f).not.toContain('::');
  });

  it('PI-09 onCursorChange fires once per move, with the option', async () => {
    const onCursor = vi.fn();
    const r = renderAt(<MultiSelect label="Pick" options={FW} onConfirm={() => undefined} onCursorChange={onCursor} />, 100);
    await press(r.stdin, DOWN, DOWN, UP);
    r.unmount();
    expect(onCursor.mock.calls.map((c) => c[0])).toEqual(['all', 'c5', 'iso', 'c5']);
    expect(onCursor).toHaveBeenLastCalledWith('c5', expect.objectContaining({ detail: 'German cloud controls catalogue' }));
  });

  it('PI-06 filter: letters filter and Space still toggles', async () => {
    const onConfirm = vi.fn();
    const r = renderAt(<MultiSelect label="Pick" options={FW} filter itemNoun="frameworks" onConfirm={onConfirm} />, 100);
    await press(r.stdin, 'i', 's', 'o');
    expect(r.lastFrame()).toMatch(/Filter: iso▏\s+1 of 4 frameworks/);
    expect(r.lastFrame()).not.toContain('A toggle all');
    await press(r.stdin, ' ', '\r');
    r.unmount();
    expect(onConfirm).toHaveBeenCalledWith(['iso']);
  });

  it('PI-11 the hint line uses KeyHints verbs ("select", not "move")', () => {
    const r = renderAt(<MultiSelect label="Pick" options={FW} onConfirm={() => undefined} />, 100);
    const f = r.lastFrame();
    r.unmount();
    expect(f).toContain('↑↓ select   Space toggle   A toggle all   Enter confirm');
  });
});

// #4230 component part: a screen feeds the highlighted option's guidance into
// the box; the picker keeps working while the box is open.
const STEP: GuidanceEntry = { title: 'Scope kind', what: 'Choose the kind of scope.' };
const KINDS: SelectOption[] = [
  {
    label: 'Platform', value: 'platform',
    guidance: {
      title: 'Platform scope',
      what: 'The platform landing zone (PLZ) that hosts shared services.',
      sections: Array.from({ length: 6 }, (_, i) => ({ label: `Part ${i + 1}`, text: `Platform part ${i + 1} of the guidance. ${'This sentence makes the section long enough to wrap. '.repeat(2)}` })),
    },
  },
  { label: 'Application', value: 'application', guidance: { title: 'Application scope', what: 'One application landing zone (ALZ) inside the platform.' } },
];

function Host({ onSelect }: { onSelect: (v: string) => void }): JSX.Element {
  const { entry, onCursorChange } = useOptionGuidance(STEP);
  return (
    <Box flexDirection="column">
      <SelectInput label="Scope kind" options={KINDS} onSelect={onSelect} onCursorChange={onCursorChange} />
      <GuidanceBox entry={entry} initiallyCollapsed={false} maxRows={13} />
    </Box>
  );
}

describe('navigation with the guidance open (#4230 component part, section 7.8)', () => {
  it('PI-10 arrows move the selection and the box follows; PgDn pages; Esc closes and never selects', async () => {
    const onSelect = vi.fn();
    const r = renderAt(<Host onSelect={onSelect} />, 100, 40);
    await settle();
    expect(r.lastFrame()).toContain('Platform scope');
    expect(r.lastFrame()).toMatch(/Part 1:/);
    await press(r.stdin, PGDN);
    let f = r.lastFrame();
    expect(f).not.toMatch(/Part 1:/);
    expect(f.split('\n').find((l) => l.includes(MARKER))).toContain('Platform');
    await press(r.stdin, DOWN);
    f = r.lastFrame();
    expect(f).toContain('Application scope');
    expect(f).toContain('One application landing zone (ALZ)');
    expect(f.split('\n').find((l) => l.includes(MARKER))).toContain('Application');
    await press(r.stdin, ESC);
    f = r.lastFrame();
    r.unmount();
    expect(f).toContain('(Ctrl+G for guidance)');
    expect(f.split('\n').find((l) => l.includes(MARKER))).toContain('Application');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
