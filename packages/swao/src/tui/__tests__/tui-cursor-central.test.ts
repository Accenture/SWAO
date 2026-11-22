// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, gate G-02: the cursor marker is central (#4245)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 126 section 13.2 G-02 and section 4.2: no cursor marker literal (the
// U+276F marker, or a "> " row prefix) outside tui-kit; SelectInput and
// MultiSelect own the only marker. Allowlist: allowlists/tui-cursor-central.json
// (per file, with the issue that removes the entry; it may only shrink).
// #4343 (audit B-2, U-2): a row drawn with the central CURSOR_MARKER is a local
// cursor row too, and tui-kit is scanned apart from the components that own
// the marker (SelectInput, MultiSelect, picker.ts, the legend and StatusLabel).

import { describe, it, expect } from 'vitest';
import { compareWithAllowlist, loadAllowlist, scan, tuiFiles } from '../../__tests__/helpers/tui-gate.js';
import { anyOf, cursorMarker, localCursorRow, ownsConstruct } from '../../__tests__/helpers/tui-gate-rules.js';

const MARKER = String.fromCodePoint(0x276f);

describe('G-02 cursor marker only in tui-kit (#4245, Design 126 section 13.2)', () => {
  it('flags the marker and "> " row prefixes; passes JSX attributes and breadcrumbs', () => {
    expect(cursorMarker(`{active ? ' ${MARKER} ' : '   '}`)).toEqual([1]);
    expect(cursorMarker("{i === idx ? '> ' : '  '}{i + 1}. {c.label}")).toEqual([1]);
    expect(cursorMarker('{fitToWidth(`> ${label}`, width)}')).toEqual([1]);
    expect(cursorMarker("{cursor ? '>' : ' '}")).toEqual([1]);
    expect(cursorMarker('<Text color="cyan"> hello</Text>')).toEqual([]);
    expect(cursorMarker("<Text>Use Tools {'>'} Ingest Files</Text>")).toEqual([]);
  });

  it('#4343 B-2: flags a row drawn with CURSOR_MARKER; passes its width use and the import', () => {
    expect(localCursorRow("{fitToWidth(`${i === cursor ? CURSOR_MARKER : '  '}${label}`, width)}")).toEqual([1]);
    expect(localCursorRow('const lead = CURSOR_MARKER.length + 2;')).toEqual([]);
    expect(localCursorRow("import { CURSOR_MARKER, tone } from '@swao/tui-kit';")).toEqual([]);
    expect(ownsConstruct('/r/swao/packages/@swao/tui-kit/src/components/SelectInput.tsx', 'cursor')).toBe(true);
    expect(ownsConstruct('/r/swao/packages/@swao/tui-kit/src/components/RunContextPicker.tsx', 'cursor')).toBe(false);
  });

  it('a new offender fails and an allowlist entry whose file no longer offends is stale', () => {
    const allow = { gate: 'G-02', rule: 'x', entries: { 'a.tsx': { count: 1, issue: '#4257' } } };
    expect(compareWithAllowlist({ 'a.tsx': [4], 'b.tsx': [1] }, allow).newOffenders).toHaveLength(1);
    expect(compareWithAllowlist({}, allow).stale).toHaveLength(1);
  });

  it('no TUI source draws a cursor beyond the allowlist (tui-kit apart from the marker owners)', () => {
    const files = tuiFiles({ includeTuiKit: true }).filter((f) => !ownsConstruct(f, 'cursor'));
    const verdict = compareWithAllowlist(scan(files, anyOf(cursorMarker, localCursorRow)), loadAllowlist('tui-cursor-central.json'));
    expect(verdict).toEqual({ newOffenders: [], stale: [] });
  });
});
