// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, gate G-01: no dash punctuation in TUI text (#4245)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 126 section 13.2 G-01 and section 8 rule 1: no U+2014, no U+2013 and
// no spaced double hyphen in the string literals and JSX text of every TUI
// tree (widens setup-layout.test.ts from the setup sources to all packages).
// Allowlist of today's offenders: allowlists/tui-no-dash-punctuation.json,
// per file with the issue that removes them; it may only shrink.

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { sep } from 'node:path';
import { PREMIUM_DIR, compareWithAllowlist, forPremiumPresence, loadAllowlist, scan, tuiFiles } from '../../__tests__/helpers/tui-gate.js';
import { dashPunctuation } from '../../__tests__/helpers/tui-gate-rules.js';

const EM = '\u2014';
const EN = '\u2013';

describe('G-01 no dash punctuation in TUI text (#4245, Design 126 section 13.2)', () => {
  it('flags em dash, en dash and a spaced double hyphen; skips comments, logs and CLI flags', () => {
    expect(dashPunctuation(`<Text>Step 1 ${EM} Init</Text>`)).toEqual([1]);
    expect(dashPunctuation(`const t = 'pages 1${EN}2';`)).toEqual([1]);
    expect(dashPunctuation("affordances={['Enter -- confirm']}")).toEqual([1]);
    expect(dashPunctuation('// Enter -- confirm\n/* a -- b */\nlogPortfolio(\'info\', \'x\', \'a -- b\');')).toEqual([]);
    expect(dashPunctuation('<Text>swao assess --app x</Text>')).toEqual([]);
  });

  it('a new offender fails and a fixed offender makes its entry stale', () => {
    const allow = { gate: 'G-01', rule: 'x', entries: { 'a.tsx': { count: 1, issue: '#4254' } } };
    expect(compareWithAllowlist({ 'a.tsx': [3] }, allow)).toEqual({ newOffenders: [], stale: [] });
    expect(compareWithAllowlist({ 'a.tsx': [3, 9] }, allow).newOffenders).toHaveLength(1);
    expect(compareWithAllowlist({ 'b.tsx': [2], 'a.tsx': [3] }, allow).newOffenders[0]).toContain('b.tsx:2');
    expect(compareWithAllowlist({}, allow).stale[0]).toContain('a.tsx: 0 found, 1 listed');
  });

  it('every TUI source matches the allowlist (no new offender, no stale entry)', () => {
    const verdict = compareWithAllowlist(scan(tuiFiles({ includeTuiKit: true }), dashPunctuation), loadAllowlist('tui-no-dash-punctuation.json'));
    expect(verdict).toEqual({ newOffenders: [], stale: [] });
  });

  it('scans the TUI trees of swao, the modules, tui-kit and swao-premium (guards against a wrong root)', () => {
    const files = tuiFiles({ includeTuiKit: true }).map((f) => f.replace(/\\/g, '/'));
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith('tui-kit/src/components/GuidanceBox.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('setup/steps/step-ui.tsx'))).toBe(true);
  });

  it.skipIf(!existsSync(PREMIUM_DIR))('scans swao-premium when it is present', () => {
    expect(tuiFiles({ includeTuiKit: true }).some((f) => f.split(sep).join('/').includes('swao-premium/'))).toBe(true);
  });

  it('without swao-premium (public checkout) its allowlist entries are dropped, not stale', () => {
    const allow = { gate: 'G-01', rule: 'x', entries: { 'swao-premium/p/X.tsx': { count: 2, issue: '#4255' }, 'swao/a.tsx': { count: 1, issue: '#4257' } } };
    expect(Object.keys(forPremiumPresence(allow, false).entries)).toEqual(['swao/a.tsx']);
    expect(forPremiumPresence(allow, true)).toBe(allow);
    expect(compareWithAllowlist({ 'swao/a.tsx': [4] }, forPremiumPresence(allow, false))).toEqual({ newOffenders: [], stale: [] });
  });
});
