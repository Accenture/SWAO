// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module -- 7R source resolution (Design 113 section 8)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { resolveSevenR, readAppTags } from './score.js';

describe('readAppTags (Design 113 section 6.2)', () => {
  it('returns the string tags from the app .swao.yml', () => {
    expect(readAppTags({ tags: ['tier-1', 'regulated'] })).toEqual(['tier-1', 'regulated']);
  });
  it('drops blanks and non-strings', () => {
    expect(readAppTags({ tags: ['a', '', '  ', 3, null, 'b'] })).toEqual(['a', 'b']);
  });
  it('returns undefined when absent or empty (field stays absent)', () => {
    expect(readAppTags({})).toBeUndefined();
    expect(readAppTags({ tags: [] })).toBeUndefined();
    expect(readAppTags({ tags: 'nope' })).toBeUndefined();
  });
});

describe('resolveSevenR (Design 113 section 8, ADR-0065)', () => {
  it('maps service TIME to 7R per the section 8 table', () => {
    const cases: Array<[Parameters<typeof resolveSevenR>[1], string]> = [
      ['Eliminate', 'Retire'],
      ['Tolerate', 'Retain'],
      ['Invest', 'Retain'],
      ['Migrate', 'Rehost'],
      ['Migrate-Critical', 'Rehost'],
    ];
    for (const [time, label] of cases) {
      const r = resolveSevenR('service', time, {}, null);
      expect(r).toEqual({ label, source: 'derived_from_time' });
    }
  });

  it('uses the synthesis verdict for application apps', () => {
    expect(resolveSevenR('application', 'Migrate', {}, 'Replatform')).toEqual({ label: 'Replatform', source: 'synthesis' });
  });

  it('has no source for an application app without a synthesis verdict', () => {
    expect(resolveSevenR('application', 'Tolerate', {}, null)).toEqual({ label: null, source: undefined });
  });

  it('lets the analyst override win for either type', () => {
    const app = { disposition: { seven_r: 'Repurchase' } };
    expect(resolveSevenR('service', 'Migrate', app, null)).toEqual({ label: 'Repurchase', source: 'analyst' });
    expect(resolveSevenR('application', 'Migrate', app, 'Rehost')).toEqual({ label: 'Repurchase', source: 'analyst' });
  });

  it('ignores a blank override', () => {
    expect(resolveSevenR('service', 'Eliminate', { disposition: { seven_r: '  ' } }, null))
      .toEqual({ label: 'Retire', source: 'derived_from_time' });
  });
});
