// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, gate G-13: colours only from theme.ts (#4258)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 126 section 13.2 G-13 and section 15.6: no Ink colour name or hex
// value given to color, borderColor or backgroundColor, and no direct
// dimColor, outside tui-kit/src/theme.ts; components use tone(token) and
// tokenColor(token). tui-kit itself is clean since TUI-16 (no allowlist
// entry may name a tui-kit file). Allowlist: allowlists/tui-colour-central.json
// (per file, removed by the colour sweep #4259; it may only shrink).

import { describe, it, expect } from 'vitest';
import { join, sep } from 'node:path';
import { compareWithAllowlist, loadAllowlist, scan, tuiFiles, TUI_KIT_DIR } from '../../__tests__/helpers/tui-gate.js';
import { colourLiteral } from '../../__tests__/helpers/tui-gate-rules.js';

const THEME = join(TUI_KIT_DIR, 'src', 'theme.ts');

function colourFiles(): string[] {
  return tuiFiles({ includeTuiKit: true }).filter((f) => f !== THEME);
}

describe('G-13 colours only from the theme tokens (#4258, Design 126 section 15.6)', () => {
  it('flags colour names and hex values in colour props and direct dimColor; passes tokens', () => {
    expect(colourLiteral('<Text color="cyanBright">x</Text>')).toEqual([1]);
    expect(colourLiteral("<Text color={active ? 'cyan' : undefined}>x</Text>")).toEqual([1]);
    expect(colourLiteral("ok: { mark: '[ok]', color: 'green' },")).toEqual([1]);
    expect(colourLiteral('<Box borderStyle="single" borderColor="gray">')).toEqual([1]);
    expect(colourLiteral('<Text color="#ff0000">x</Text>')).toEqual([1]);
    expect(colourLiteral('<Text dimColor>hint</Text>')).toEqual([1]);
    expect(colourLiteral("<Text {...tone('muted')}>hint</Text>")).toEqual([]);
    expect(colourLiteral("<Box borderColor={tokenColor('border')}>")).toEqual([]);
    expect(colourLiteral("return { state: 'red', inkColor: TOKENS.error.color, dim: false };")).toEqual([]);
  });

  it('a new offender fails and an allowlist entry whose file no longer offends is stale', () => {
    const allow = { gate: 'G-13', rule: 'x', entries: { 'a.tsx': { count: 2, issue: '#4259' } } };
    expect(compareWithAllowlist({ 'a.tsx': [1, 2, 3] }, allow).newOffenders).toHaveLength(1);
    expect(compareWithAllowlist({ 'a.tsx': [1] }, allow).stale).toHaveLength(1);
  });

  it('theme.ts is the only tui-kit file with a colour (no tui-kit allowlist entry)', () => {
    const allow = loadAllowlist('tui-colour-central.json');
    expect(Object.keys(allow.entries).filter((f) => f.includes('@swao/tui-kit/'))).toEqual([]);
    const kit = colourFiles().filter((f) => f.startsWith(TUI_KIT_DIR + sep));
    expect(kit.length).toBeGreaterThan(10);
    expect(scan(kit, colourLiteral)).toEqual({});
  });

  it('no TUI source has a colour literal beyond the allowlist', () => {
    const verdict = compareWithAllowlist(scan(colourFiles(), colourLiteral), loadAllowlist('tui-colour-central.json'));
    expect(verdict).toEqual({ newOffenders: [], stale: [] });
  });
});
