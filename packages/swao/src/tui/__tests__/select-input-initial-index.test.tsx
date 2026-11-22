// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4198 SET-10 (Design 125 section 5.7): SelectInput (@swao/tui-kit) starts
// on `initialIndex`, so an assessment picker can preselect a stored default.

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { SelectInput } from '@swao/tui-kit';

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('SelectInput initialIndex (#4198)', () => {
  it('starts on initialIndex: Enter selects it and the cursor callback reports it', async () => {
    const picked: string[] = [];
    const cursor: string[] = [];
    const r = render(<SelectInput label="Pick" options={[{ label: '+ New app...', value: '__new__' }, { label: 'apps/web', value: 'web' }]} initialIndex={1} onSelect={(v) => picked.push(v)} onCursorChange={(v) => cursor.push(v)} />);
    await tick();
    expect(cursor[0]).toBe('web');
    r.stdin.write('\r');
    await tick();
    r.unmount();
    expect(picked).toEqual(['web']);
  });

  it('an out-of-range initialIndex is clamped; the default stays the first option', async () => {
    const picked: string[] = [];
    const r = render(<SelectInput label="Pick" options={[{ label: 'a', value: 'a' }, { label: 'b', value: 'b' }]} initialIndex={9} onSelect={(v) => picked.push(v)} />);
    await tick();
    r.stdin.write('\r');
    await tick();
    r.unmount();
    const d = render(<SelectInput label="Pick" options={[{ label: 'a', value: 'a' }, { label: 'b', value: 'b' }]} onSelect={(v) => picked.push(v)} />);
    await tick();
    d.stdin.write('\r');
    await tick();
    d.unmount();
    expect(picked).toEqual(['b', 'a']);
  });
});
