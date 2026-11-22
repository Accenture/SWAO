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

// #4294 (Design 126 section 6): the state word of each assessment type takes
// its status colour: ready green, needs attention and not set up yellow, a
// type of a higher tier dim. Colours are forced for this file only.

import { afterAll, describe, it, expect, vi } from 'vitest';

const savedForceColor = vi.hoisted(() => { const s = process.env['FORCE_COLOR']; process.env['FORCE_COLOR'] = '1'; return s; });
afterAll(() => {
  if (savedForceColor === undefined) delete process.env['FORCE_COLOR'];
  else process.env['FORCE_COLOR'] = savedForceColor;
});

import React from 'react';
import { render } from 'ink-testing-library';
import { TypeSelectionStep, typeSelectionParts } from './TypeSelectionStep.js';

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
/** True when `word` is drawn alone in the SGR colour `code` (32 green, 33 yellow). */
const coloured = (frame: string, code: number, word: string): boolean => frame.includes(`\u001b[${code}m${word}\u001b[`);

describe('assessment type list state colours (#4294)', () => {
  it('state word and level per state; the cause stays outside the coloured word', () => {
    expect(typeSelectionParts('application', 'community', false, 'ready', true)).toEqual({ head: 'Application Assessment', word: 'ready', level: 'ok', rest: '' });
    expect(typeSelectionParts('service', 'community', true, 'needs-attention', false, 'needs attention: waiting for Intake workbook'))
      .toEqual({ head: '[x] Service Portfolio Assessment', word: 'needs attention', level: 'warn', rest: ': waiting for Intake workbook' });
    expect(typeSelectionParts('llm', 'community', false, undefined, true)).toMatchObject({ word: 'not set up', level: 'waiting' });
    expect(typeSelectionParts('lz-live', 'community', false, 'ready', false)).toMatchObject({ word: 'needs Consultant', level: 'info' });
  });

  for (const single of [true, false]) {
    it(`renders green around "ready" and yellow around "not set up" (${single ? 'Setup menu picker' : 'first-run multi-select'})`, async () => {
      const r = render(<TypeSelectionStep single={single} tier="community" initial={[]} states={{ application: 'ready', service: 'needs-attention' }} onNext={() => {}} />);
      await tick();
      const frame = r.lastFrame() ?? '';
      r.unmount();
      expect(coloured(frame, 32, 'ready')).toBe(true);
      expect(coloured(frame, 33, 'not set up')).toBe(true);
      expect(coloured(frame, 33, 'needs attention')).toBe(true);
      // The type name is not inside the state colour.
      expect(coloured(frame, 32, 'Application Assessment')).toBe(false);
    });
  }
});
