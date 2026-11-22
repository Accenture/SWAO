// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, gate G-11: no CLI syntax on screen (#4245)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 126 section 13.2 G-11 and section 8 rule 2: no CLI flag after a word,
// no "protocol:" and no "kebab-case" in screen text; the CLI equivalent lives
// only in the guidance (a cli field or a trailing "CLI:" mention). Widens
// menu-detail-no-cli.test.ts (#4122). Allowlist: allowlists/tui-no-cli-on-screen.json.
// #4343 (audit B-4): a `swao <command>` in screen text counts too ("Running
// swao health-check..."), with the same exclusions.

import { describe, it, expect } from 'vitest';
import { compareWithAllowlist, loadAllowlist, scan, tuiFiles } from '../../__tests__/helpers/tui-gate.js';
import { anyOf, cliOnScreen, swaoCommandOnScreen } from '../../__tests__/helpers/tui-gate-rules.js';

describe('G-11 no CLI syntax on screen (#4245, Design 126 section 13.2)', () => {
  it('flags flags in text, protocol ids and developer terms; passes argv and guidance cli', () => {
    expect(cliOnScreen('<Text>Run swao assess --app x first.</Text>')).toEqual([1]);
    expect(cliOnScreen('label: `${name}  (protocol: ${p})`,')).toEqual([1]);
    expect(cliOnScreen('label="Scope id (kebab-case)"')).toEqual([1]);
    expect(cliOnScreen("const args = ['assess', '--app', id];")).toEqual([]);
    expect(cliOnScreen("{ title: 'Run', what: 'Runs the assessment.', cli: 'swao assess --app <id>' }")).toEqual([]);
    expect(cliOnScreen("what: 'Runs the assessment. CLI: swao assess --app <id>'")).toEqual([]);
  });

  it('#4343 B-4: flags a swao command in screen text; passes the cli field, CLI: and argv', () => {
    expect(swaoCommandOnScreen("<Text>Running swao health-check...</Text>")).toEqual([1]);
    expect(swaoCommandOnScreen("what: 'Run swao setup to configure a gateway.'")).toEqual([1]);
    expect(swaoCommandOnScreen("cli: 'swao assess --app <id>'")).toEqual([]);
    expect(swaoCommandOnScreen("what: 'Runs it. CLI: swao assess'")).toEqual([]);
    expect(swaoCommandOnScreen("const child = spawn('swao doctor');")).toEqual([]);
  });

  it('a new offender fails and an allowlist entry whose file no longer offends is stale', () => {
    const allow = { gate: 'G-11', rule: 'x', entries: { 'a.tsx': { count: 1, issue: '#4257' } } };
    expect(compareWithAllowlist({ 'a.tsx': [1], 'c.tsx': [7] }, allow).newOffenders).toHaveLength(1);
    expect(compareWithAllowlist({}, allow).stale).toHaveLength(1);
  });

  it('no TUI source shows CLI syntax beyond the allowlist', () => {
    const verdict = compareWithAllowlist(scan(tuiFiles({ includeTuiKit: true }), anyOf(cliOnScreen, swaoCommandOnScreen)), loadAllowlist('tui-no-cli-on-screen.json'));
    expect(verdict).toEqual({ newOffenders: [], stale: [] });
  });
});
