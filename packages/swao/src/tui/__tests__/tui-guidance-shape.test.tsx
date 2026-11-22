// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, gate G-12: the guidance box shape (#4250)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 126 section 13.2 G-12, section 9 and mockup M-10. At 100 and 80
// columns the expanded box has: the title; an explanation of at most three
// lines at 100 columns and four at 80 (Q-02), the CLI line included; inline
// sections ("Label: text", no heading line, no blank line between them);
// exactly one blank line, directly before the keys section; the keys in
// words; the rule; "Ctrl+G close guidance". Its height (borders included)
// never exceeds `maxRows`; when even the fixed part does not fit, it stays
// collapsed; ScreenLayout bounds it by the rows left in a 24-row terminal.
// ink-testing-library renders at 100 columns only, so this gate gives Ink a
// fake terminal of the chosen size (as tui-kit's render harness does).

import { describe, it, expect } from 'vitest';
import React from 'react';
import { EventEmitter } from 'node:events';
import { render, Text } from 'ink';
import {
  GuidanceBox, ScreenLayout, KEY_HINTS, formatKeyHints, headerRuleWidth, type GuidanceEntry, type GuidanceBoxProps,
} from '@swao/tui-kit';

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

// eslint-disable-next-line no-control-regex
const plain = (t: string): string => t.replace(/\x1b\[[0-9;]*m/g, '');

async function frameAt(el: React.ReactElement, columns: number, rows = 60, keys: string[] = []): Promise<string[]> {
  const stdout = new FakeStdout(columns, rows);
  const stdin = new FakeStdin();
  const inst = render(el, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new FakeStdout(columns, rows) as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  await settle();
  for (const k of keys) { stdin.write(k); await settle(); }
  const out = plain(stdout.frames[stdout.frames.length - 1] ?? '').split('\n');
  inst.unmount();
  return out;
}

/** The box rows (borders included) and its content lines (borders and padding removed). */
function box(lines: string[]): { rows: string[]; content: string[] } {
  const top = lines.findIndex((l) => l.trimStart().startsWith('┌'));
  const bottom = lines.findIndex((l, i) => i > top && l.trimStart().startsWith('└'));
  const rows = lines.slice(top, bottom + 1);
  const content = rows.slice(1, -1).map((l) => l.trim().replace(/^│ ?/, '').replace(/ ?│$/, '').trimEnd());
  return { rows, content };
}

const LZ: GuidanceEntry = {
  title: '1 Select landing zone',
  what: 'Landing zones registered in this workspace, each with its scopes and read-only login. Add or change one with the entry Manage landing zones. The assessment reads only; it never writes.',
  cli: 'swao assess --type landing-zone-live --lz <lz-id>',
  sections: [
    { label: 'Requirement', text: 'at least one landing zone with a probed scope.' },
    { label: 'Next', text: 'you choose the scopes of this landing zone to assess.' },
  ],
};

const LONG: GuidanceEntry = {
  title: 'Scope kind',
  what: `${'Platform: the platform landing zone (PLZ) that hosts shared services. Application: one application landing zone (ALZ) inside it. '.repeat(3)}SWAO reads different settings for each.`,
  cli: 'swao lz connect --scope-kind platform',
  sections: Array.from({ length: 4 }, (_, i) => ({ label: `Part ${i + 1}`, text: `Section ${i + 1} of the scope kind guidance; ${'it explains what SWAO reads in this scope. '.repeat(2)}` })),
};

const KEYS = KEY_HINTS.picker;
const KEYS_FULL = formatKeyHints(KEYS, 'full');

function expanded(entry: GuidanceEntry, over: Partial<GuidanceBoxProps> = {}): React.ReactElement {
  return <GuidanceBox entry={entry} keys={KEYS} initiallyCollapsed={false} {...over} />;
}

describe('G-12 guidance box shape (#4250, Design 126 section 13.2)', () => {
  for (const columns of [100, 80]) {
    const limit = columns === 100 ? 3 : 4;

    it(`M-10 structure at ${columns} columns`, async () => {
      const { content } = box(await frameAt(expanded(LZ), columns));
      expect(content[0]).toBe('1 Select landing zone');
      const req = content.findIndex((l) => l.startsWith('Requirement: '));
      const explanation = content.slice(1, req);
      expect(explanation.length).toBeLessThanOrEqual(limit);
      expect(explanation[explanation.length - 1]).toBe('CLI: swao assess --type landing-zone-live --lz <lz-id>');
      expect(explanation.slice(0, -1).join(' ')).toBe(LZ.what);
      expect(content.slice(req)).toEqual([
        'Requirement: at least one landing zone with a probed scope.',
        'Next: you choose the scopes of this landing zone to assess.',
        '',
        KEYS_FULL,
        '─'.repeat(headerRuleWidth(columns) - 6),
        'Ctrl+G close guidance',
      ]);
    });

    it(`explanation at most ${limit} lines, one blank line only, before the keys, at ${columns} columns`, async () => {
      const { content } = box(await frameAt(expanded(LONG), columns));
      const firstSection = content.findIndex((l) => /^(More|Part \d): /.test(l));
      expect(firstSection).toBeGreaterThan(0);
      expect(firstSection - 1).toBeLessThanOrEqual(limit);
      expect(content[firstSection]).toMatch(/^More: /); // the rest of the explanation is paged, never cut
      const blanks = content.map((l, i) => (l === '' ? i : -1)).filter((i) => i >= 0);
      expect(blanks).toHaveLength(1);
      expect(content[blanks[0]! + 1]).toBe(KEYS_FULL.slice(0, content[blanks[0]! + 1]!.length));
      expect(content.join('\n')).not.toMatch(/…|\.\.\.$/m);
    });

    it(`sections are inline with a hanging indent at ${columns} columns`, async () => {
      const { content } = box(await frameAt(expanded(LONG), columns));
      const part = content.findIndex((l) => l.startsWith('Part 1: '));
      expect(part).toBeGreaterThan(0);
      expect(content[part + 1]).toMatch(/^ {8}\S/); // "Part 1: " is 8 wide; the text wraps under itself
    });

    for (const maxRows of [14, 18, 30]) {
      it(`height at most maxRows=${maxRows} at ${columns} columns; PgDn reaches every section`, async () => {
        const first = box(await frameAt(expanded(LONG, { maxRows }), columns));
        expect(first.rows.length).toBeLessThanOrEqual(maxRows);
        const seen = new Set<string>();
        for (let p = 0; p < 12; p++) {
          const { rows, content } = box(await frameAt(expanded(LONG, { maxRows }), columns, 60, Array.from({ length: p }, () => '\u001B[6~')));
          expect(rows.length).toBeLessThanOrEqual(maxRows);
          for (const l of content) { const m = /^(More|Part \d): /.exec(l); if (m) seen.add(m[1]!); }
        }
        expect([...seen].sort()).toEqual(['More', 'Part 1', 'Part 2', 'Part 3', 'Part 4']);
      });
    }

    it(`a maxRows below the fixed part keeps the box collapsed at ${columns} columns`, async () => {
      const { rows } = box(await frameAt(expanded(LZ, { maxRows: 6 }), columns));
      expect(rows.length).toBe(4);
      expect(rows.join('\n')).toContain('(Ctrl+G for guidance)');
    });

    for (const rows of [24, 32]) {
      it(`ScreenLayout bounds the box by the rows left in a ${rows}-row terminal at ${columns} columns`, async () => {
        const lines = await frameAt(
          <ScreenLayout
            header={{ subtitle: 'Setup: Landing Zone Live Assessment', stepInfo: 'Step 2 of 6', version: '1.6.1' }}
            steps={{ labels: ['Landing zones', 'Probe', 'Policy baseline', 'Org evidence', 'Health check', 'Ready'], current: 1 }}
            title={{ title: 'Scope kind', subtitle: 'Platform or application landing zone.' }}
            keys={KEYS}
            guidance={{ entry: LONG, initiallyCollapsed: false }}
          >
            <Text>CONTENT ROW 1</Text>
            <Text>CONTENT ROW 2</Text>
          </ScreenLayout>,
          columns, rows,
        );
        const used = lines.length - (lines[lines.length - 1] === '' ? 1 : 0);
        expect(used).toBeLessThanOrEqual(rows - 1); // the frame is rows - 1 (TerminalFrame)
        const text = lines.join('\n');
        if (rows === 32) {
          // Room for the fixed part: expanded and paged, never cut.
          expect(text).toContain('Ctrl+G close guidance');
          expect(text).toMatch(/Sections 1 to \d of 5\./);
        } else {
          // Not even the fixed part fits under the content: collapsed, never cut.
          expect(text).toContain('(Ctrl+G for guidance)');
        }
      });
    }
  }
});
