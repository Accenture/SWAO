// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, gate G-06: pickers are bounded (#4245, #4239)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 126 section 13.2 G-06 and section 4.2: every SelectInput or
// MultiSelect call site whose options come from data (apps, landing zones,
// connectors, frameworks, targets) passes visibleCount; a static list (an
// inline array or an UPPER_CASE constant) needs none. Render check: a picker
// of 235 apps with PICKER_VISIBLE_COUNT fits 24 rows (#4239).
// Allowlist: allowlists/tui-picker-bounded.json (may only shrink).

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { SelectInput, PICKER_VISIBLE_COUNT } from '@swao/tui-kit';
import { compareWithAllowlist, loadAllowlist, scan, tuiFiles } from '../../__tests__/helpers/tui-gate.js';
import { unboundedPicker } from '../../__tests__/helpers/tui-gate-rules.js';

describe('G-06 pickers with data options are bounded (#4245, Design 126 section 13.2)', () => {
  it('flags a data-driven picker without visibleCount; passes bounded and static pickers', () => {
    expect(unboundedPicker('<Box>\n  <SelectInput\n    options={apps.map((a) => ({ label: a, value: a }))}\n    onSelect={(v) => go(v)}\n  />\n</Box>')).toEqual([2]);
    expect(unboundedPicker('<SelectInput options={apps} visibleCount={PICKER_VISIBLE_COUNT} onSelect={go} />')).toEqual([]);
    expect(unboundedPicker("<SelectInput options={[{ label: 'Yes', value: 'y' }]} onSelect={go} />")).toEqual([]);
    expect(unboundedPicker('<MultiSelect options={SCOPE_KINDS} onConfirm={go} />')).toEqual([]);
    expect(unboundedPicker('<MultiSelect options={targets} onConfirm={(v) => { if (v.length > 0) go(v); }} />')).toEqual([1]);
  });

  it('a new offender fails and an allowlist entry whose file no longer offends is stale', () => {
    const allow = { gate: 'G-06', rule: 'x', entries: { 'a.tsx': { count: 1, issue: '#4255' } } };
    expect(compareWithAllowlist({ 'a.tsx': [1, 2] }, allow).newOffenders).toHaveLength(1);
    expect(compareWithAllowlist({}, allow).stale).toHaveLength(1);
  });

  it('no picker call site is unbounded beyond the allowlist', () => {
    const verdict = compareWithAllowlist(scan(tuiFiles({ includeTuiKit: true }), unboundedPicker), loadAllowlist('tui-picker-bounded.json'));
    expect(verdict).toEqual({ newOffenders: [], stale: [] });
  });

  it('a picker of 235 apps with PICKER_VISIBLE_COUNT fits 24 rows (#4239)', () => {
    const options = Array.from({ length: 235 }, (_, i) => ({ label: `app${String(i + 1).padStart(4, '0')}`, value: `app${i + 1}` }));
    const { lastFrame, unmount } = render(
      <SelectInput label="Select application to assess" options={options} visibleCount={PICKER_VISIBLE_COUNT} onSelect={() => undefined} />,
    );
    const lines = (lastFrame() ?? '').split('\n');
    unmount();
    expect(lines.length).toBeLessThanOrEqual(24);
    expect(lines.join('\n')).toContain('app0001');
    expect(lines.join('\n')).not.toContain('app0235');
  });
});
