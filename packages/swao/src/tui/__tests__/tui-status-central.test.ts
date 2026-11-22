// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, gate G-03: status words are central (#4245)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 126 section 13.2 G-03 and section 6: no status literal ([ok],
// [warn], [miss], [fail], [info] and the other levels, or OK, WARN, FAIL,
// INFO as row text) outside tui-kit, where StatusLabel and STATUS_MAP are the
// only source. Allowlist: allowlists/tui-status-central.json (may only shrink).
// #4343 (audit B-5, U-2): a local status word table counts too, and tui-kit is
// scanned apart from StatusLabel, theme.ts and the colour legend.

import { describe, it, expect } from 'vitest';
import { compareWithAllowlist, loadAllowlist, scan, tuiFiles } from '../../__tests__/helpers/tui-gate.js';
import { anyOf, localStatusTable, ownsConstruct, statusLiteral } from '../../__tests__/helpers/tui-gate-rules.js';

describe('G-03 status words only through StatusLabel (#4245, Design 126 section 13.2)', () => {
  it('flags bracketed status words and upper case row text; passes comparisons and type unions', () => {
    expect(statusLiteral('<Text color="green">[ok] gitleaks</Text>')).toEqual([1]);
    expect(statusLiteral("missing: { mark: '[miss]', color: 'red' },")).toEqual([1]);
    expect(statusLiteral("WARN: 'WARN',")).toEqual([1]);
    expect(statusLiteral("if (r.status === 'OK') return;")).toEqual([]);
    expect(statusLiteral("type S = 'OK' | 'WARN' | 'FAIL';")).toEqual([]);
  });

  it('#4343 B-5: flags a local table of padded or upper case status words; passes token and level maps', () => {
    expect(localStatusTable("const STATE_MARK = { ok: 'ok     ', warn: 'warn   ' } as const;")).toEqual([1]);
    expect(localStatusTable("const M = { fail: 'FAIL' };")).toEqual([1]);
    expect(localStatusTable("const LEVEL_TOKEN = { ok: 'ok', warn: 'warning', fail: 'error' } as const;")).toEqual([]);
    expect(localStatusTable("const L = { ok: 'ok', INFO: 'info', WARN: 'warn' };")).toEqual([]);
  });

  it('a new offender fails and an allowlist entry whose file no longer offends is stale', () => {
    const allow = { gate: 'G-03', rule: 'x', entries: { 'a.tsx': { count: 2, issue: '#4254' } } };
    expect(compareWithAllowlist({ 'a.tsx': [1, 2, 3] }, allow).newOffenders).toHaveLength(1);
    expect(compareWithAllowlist({ 'a.tsx': [1] }, allow).stale).toHaveLength(1);
  });

  it('no TUI source writes a status word beyond the allowlist (tui-kit apart from StatusLabel)', () => {
    const files = tuiFiles({ includeTuiKit: true }).filter((f) => !ownsConstruct(f, 'status'));
    const verdict = compareWithAllowlist(scan(files, anyOf(statusLiteral, localStatusTable)), loadAllowlist('tui-status-central.json'));
    expect(verdict).toEqual({ newOffenders: [], stale: [] });
  });
});
