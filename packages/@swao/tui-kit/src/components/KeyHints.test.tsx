// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library, KeyHints tests (#4246, Design 126 M-09)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// KH-01 the standard lines of section 7.9 render as mockup M-09 (key, one space, verb, three spaces)
// KH-02 no colon, no vertical bar, no double hyphen in any standard line
// KH-03 form="full" names the keys in words (M-10 keys section)
// KH-04 the verb list follows Q-04: next is a verb, continue is not; a non-union verb is a type error
// KH-05 lines at 100 and 80 columns: one line, never wider than the header rule; hints wrap whole
// KH-06 GuidanceBox: keys section via form="full"; close hint and pager through KeyHints (Q-01)

import { describe, it, expect } from 'vitest';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { KeyHints, KEY_HINTS, KEY_VERBS, formatKeyHints, type KeyHint } from './KeyHints.js';
import { GuidanceBox, GUIDANCE_CLOSE_HINT } from './GuidanceBox.js';
import { renderAt, widest } from '../testing/render-at.js';

// Mockup M-09 with the ASCII stand-ins replaced by the rendered glyphs.
const M09: Record<string, string> = {
  menu: '↑↓ select   Enter open   Esc abort',
  picker: '↑↓ select   Enter next   ← back   Esc abort',
  multiSelect: '↑↓ select   Space toggle   Enter next   ← back   Esc abort',
  textInput: 'Enter next   Shift+Tab back   Esc abort',
  confirm: 'Enter confirm   ← back   Esc abort',
  lastStep: '↑↓ select   Enter finish   Esc abort',
  run: 'Esc cancel',
  abortDialog: 'Enter abort   Esc stay',
};

describe('KeyHints (#4246, Design 126 sections 5.2 and 7.9)', () => {
  it('KH-01 renders the standard lines as mockup M-09', () => {
    for (const [name, line] of Object.entries(M09)) {
      expect(formatKeyHints(KEY_HINTS[name as keyof typeof KEY_HINTS]), name).toBe(line);
    }
    expect(formatKeyHints(KEY_HINTS.guidanceClose)).toBe('Ctrl+G close guidance');
    expect(formatKeyHints(KEY_HINTS.guidancePager)).toBe('PgDn next   PgUp previous');
    expect(formatKeyHints(KEY_HINTS.exitDialog)).toBe('Enter exit   Esc stay');
  });

  it('KH-02 no colon, no vertical bar and no double hyphen in any standard line', () => {
    for (const hints of Object.values(KEY_HINTS)) {
      for (const form of ['line', 'full'] as const) {
        const text = formatKeyHints(hints, form);
        expect(text).not.toMatch(/:|\||--/);
      }
    }
  });

  it('KH-03 form="full" names the keys in words (M-10)', () => {
    expect(formatKeyHints(KEY_HINTS.picker, 'full')).toBe('Up and Down arrows select   Enter next   Left arrow back   Esc abort');
  });

  it('KH-04 next is a verb, continue is not', () => {
    expect(KEY_VERBS).toContain('next');
    expect(KEY_VERBS).not.toContain('continue');
  });

  it('KH-04 a verb outside the union is a type error, a union verb compiles', () => {
    // TypeScript names files with forward slashes on every platform.
    const fixture = join(fileURLToPath(new URL('.', import.meta.url)), '__keyhints_type_fixture__.ts').split(sep).join('/');
    const check = (verb: string): number => {
      const source = `import type { KeyHint } from './KeyHints.js';\nexport const h: KeyHint = { key: 'Enter', verb: '${verb}' };\n`;
      const options: ts.CompilerOptions = {
        strict: true, noEmit: true, skipLibCheck: true, jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022,
      };
      const host = ts.createCompilerHost(options);
      const getSourceFile = host.getSourceFile.bind(host);
      host.getSourceFile = (name, lang, ...rest) => (name === fixture ? ts.createSourceFile(name, source, lang) : getSourceFile(name, lang, ...rest));
      const fileExists = host.fileExists.bind(host);
      host.fileExists = (name) => name === fixture || fileExists(name);
      const program = ts.createProgram([fixture], options, host);
      return ts.getPreEmitDiagnostics(program, program.getSourceFile(fixture))
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')).length;
    };
    expect(check('next')).toBe(0);
    expect(check('continue')).toBeGreaterThan(0);
  }, 60_000);

  for (const columns of [100, 80]) {
    it(`KH-05 at ${columns} columns every standard line is one line within the header rule`, () => {
      for (const [name, line] of Object.entries(M09)) {
        const r = renderAt(<KeyHints hints={KEY_HINTS[name as keyof typeof KEY_HINTS]} />, columns);
        const lines = r.lines();
        r.unmount();
        expect(lines, name).toEqual([line]);
        expect(widest(lines)).toBeLessThanOrEqual(columns - 2);
      }
    });
  }

  it('KH-05 a hint line wider than the terminal wraps between hints, never inside one', () => {
    const many: KeyHint[] = [...KEY_HINTS.multiSelect, { key: 'Type', verb: 'filter' }, { key: 'PgDn', verb: 'page' }, { key: 'Ctrl+G', verb: 'open', object: 'guidance' }];
    const r = renderAt(<KeyHints hints={many} form="full" />, 63);
    const lines = r.lines().map((l) => l.trimEnd());
    r.unmount();
    expect(lines.length).toBeGreaterThan(1);
    const words = lines.join(' ').replace(/\s+/g, ' ').trim();
    expect(words).toBe(formatKeyHints(many, 'full').replace(/\s+/g, ' '));
    for (const l of lines) expect(l).not.toMatch(/^\s*(select|toggle|next|back|abort|filter|page|open)\b/);
  });

  for (const columns of [100, 80]) {
    it(`KH-06 GuidanceBox at ${columns} columns: keys section in words, close hint through KeyHints`, () => {
      const r = renderAt(<GuidanceBox title="1 Select landing zone" what="Landing zones registered in this workspace." keys={KEY_HINTS.picker} initiallyCollapsed={false} />, columns);
      const frame = r.lastFrame();
      r.unmount();
      expect(GUIDANCE_CLOSE_HINT).toBe('Ctrl+G close guidance');
      expect(frame).toContain('Up and Down arrows select   Enter next   Left arrow back   Esc abort');
      expect(frame).toContain('Ctrl+G close guidance');
      expect(frame).not.toContain('Ctrl+G:');
      expect(widest(frame.split('\n'))).toBeLessThanOrEqual(columns - 2);
    });
  }

  it('KH-06 the pager line of a paged box reads "Sections 1 to n of m.   PgDn next   PgUp previous"', () => {
    const details = Array.from({ length: 6 }, (_, i) => ({ label: `Section ${i + 1}`, value: 'A detail value that takes a line or two in the box. '.repeat(2) }));
    const r = renderAt(<GuidanceBox title="Scope kind" what="Platform or application." details={details} maxRows={16} initiallyCollapsed={false} />, 100);
    const frame = r.lastFrame();
    r.unmount();
    expect(frame).toMatch(/Sections 1 to \d of 6\.\s+PgDn next   PgUp previous/);
  });
});
