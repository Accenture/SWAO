// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library -- CommunityFrameworkPicker unit tests (#1660)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { buildFrameworkPickerOptions, expandFrameworkSelection } from './CommunityFrameworkPicker.js';
import type { CommunityFrameworkOption } from './CommunityFrameworkPicker.js';

const GDPR: CommunityFrameworkOption = { id: 'GDPR', name: 'GDPR', controlsCount: 42 };
const BSI: CommunityFrameworkOption  = { id: 'BSI_C5', name: 'BSI C5', controlsCount: 100 };
const DEMO: CommunityFrameworkOption = { id: 'GDPR_DEMO', name: 'GDPR (Demo)', controlsCount: 5 };
const PLAIN: CommunityFrameworkOption = { id: 'DORA', name: 'DORA' };

describe('buildFrameworkPickerOptions', () => {
  it('prepends the All-frameworks sentinel', () => {
    const opts = buildFrameworkPickerOptions([GDPR]);
    expect(opts[0]).toEqual({ label: 'All frameworks (recommended)', value: 'all' });
  });

  it('includes all provided frameworks after the sentinel', () => {
    const opts = buildFrameworkPickerOptions([GDPR, BSI]);
    expect(opts.map(o => o.value)).toEqual(['all', 'GDPR', 'BSI_C5']);
  });

  it('appends controls count when present', () => {
    const opts = buildFrameworkPickerOptions([GDPR]);
    expect(opts[1].label).toContain('(42 controls)');
  });

  it('omits controls count when not provided', () => {
    const opts = buildFrameworkPickerOptions([PLAIN]);
    expect(opts[1].label).not.toContain('controls');
  });

  it('strips _DEMO suffix and shows (Demo) label', () => {
    const opts = buildFrameworkPickerOptions([DEMO]);
    expect(opts[1].label).toContain('(Demo)');
    expect(opts[1].label).not.toContain('_DEMO');
    expect(opts[1].value).toBe('GDPR_DEMO');
  });

  it('returns only sentinel for empty options', () => {
    const opts = buildFrameworkPickerOptions([]);
    expect(opts).toHaveLength(1);
    expect(opts[0].value).toBe('all');
  });
});

describe('expandFrameworkSelection', () => {
  const ids = ['GDPR', 'BSI_C5', 'DORA'];

  it('expands "all" to all available IDs', () => {
    expect(expandFrameworkSelection(['all'], ids)).toEqual(ids);
  });

  it('keeps an explicit selection as-is', () => {
    expect(expandFrameworkSelection(['GDPR', 'DORA'], ids)).toEqual(['GDPR', 'DORA']);
  });

  it('defaults to all IDs when selection is empty', () => {
    expect(expandFrameworkSelection([], ids)).toEqual(ids);
  });

  it('defaults to all IDs when no selection matches available', () => {
    expect(expandFrameworkSelection(['UNKNOWN_FW'], ids)).toEqual(ids);
  });

  it('filters case-insensitively against available IDs', () => {
    expect(expandFrameworkSelection(['gdpr'], ids)).toEqual(['GDPR']);
  });

  it('handles empty availableIds gracefully', () => {
    expect(expandFrameworkSelection(['GDPR'], [])).toEqual([]);
  });
});
