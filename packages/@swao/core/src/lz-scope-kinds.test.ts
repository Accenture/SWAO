// #4299 (Design 120 section 5.2): one name per scope kind.
import { describe, it, expect } from 'vitest';
import { LZ_SCOPE_KIND_DEFINITIONS, LZ_SCOPE_KIND_LABELS, lzScopeKindLabel } from './lz-scope-kinds.js';

describe('landing zone scope kind labels (#4299)', () => {
  it('names PLZ and ALZ and keeps an unknown kind as it is', () => {
    expect(lzScopeKindLabel('platform')).toBe('Platform landing zone (PLZ)');
    expect(lzScopeKindLabel('application')).toBe('Application landing zone (ALZ)');
    expect(lzScopeKindLabel('log-archive')).toBe('log-archive');
    expect(Object.keys(LZ_SCOPE_KIND_DEFINITIONS)).toEqual(Object.keys(LZ_SCOPE_KIND_LABELS));
  });
});
