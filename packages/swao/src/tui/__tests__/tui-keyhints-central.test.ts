// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, gate G-04: key hints are central (#4245)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 126 section 13.2 G-04 and section 7.9: no hint wording ("Press
// Enter", "Esc to", "Esc:", "to continue", a literal affordances array)
// outside tui-kit, where KeyHints renders every hint line from the verb union.
// Allowlist: allowlists/tui-keyhints-central.json (may only shrink).
// #4343 (audit B-3, U-2): a sentence that names a key and what it does ("S
// skips this step", "Esc returns to the menu") counts too, and tui-kit is
// scanned apart from KeyHints.

import { describe, it, expect } from 'vitest';
import { compareWithAllowlist, loadAllowlist, scan, tuiFiles } from '../../__tests__/helpers/tui-gate.js';
import { anyOf, keyHintWording, keySentence, ownsConstruct } from '../../__tests__/helpers/tui-gate-rules.js';

describe('G-04 key hints only through KeyHints (#4245, Design 126 section 13.2)', () => {
  it('flags local hint wordings and literal affordances', () => {
    expect(keyHintWording('<Text dimColor>Press Enter to continue</Text>')).toEqual([1]);
    expect(keyHintWording('<Text>Esc to go back</Text>')).toEqual([1]);
    expect(keyHintWording("affordances={['Up/Down: move  |  Enter: choose']}")).toEqual([1]);
    expect(keyHintWording("const affordances = ['Enter confirm'];")).toEqual([1]);
    expect(keyHintWording('<KeyHints hints={FLOW_PICKER_HINTS} />')).toEqual([]);
  });

  it('#4343 B-3: flags key sentences in strings; passes text without a key', () => {
    expect(keySentence("<Text>Enter saves the ticked frameworks; S keeps the current ones.</Text>")).toEqual([1]);
    expect(keySentence("what: 'Space toggles a lens, Enter saves the selection.'")).toEqual([1]);
    expect(keySentence("label=\"Playwright crawl URL (Enter to skip)\"")).toEqual([1]);
    expect(keySentence("what: 'The run starts after the review.'")).toEqual([]);
    expect(keySentence('if (key.return) save();')).toEqual([]);
  });

  it('a new offender fails and an allowlist entry whose file no longer offends is stale', () => {
    const allow = { gate: 'G-04', rule: 'x', entries: { 'a.tsx': { count: 1, issue: '#4255' } } };
    expect(compareWithAllowlist({ 'a.tsx': [1, 5] }, allow).newOffenders).toHaveLength(1);
    expect(compareWithAllowlist({}, allow).stale).toHaveLength(1);
  });

  it('no TUI source words a key hint beyond the allowlist (tui-kit apart from KeyHints)', () => {
    const files = tuiFiles({ includeTuiKit: true }).filter((f) => !ownsConstruct(f, 'keys'));
    const verdict = compareWithAllowlist(scan(files, anyOf(keyHintWording, keySentence)), loadAllowlist('tui-keyhints-central.json'));
    expect(verdict).toEqual({ newOffenders: [], stale: [] });
  });
});
