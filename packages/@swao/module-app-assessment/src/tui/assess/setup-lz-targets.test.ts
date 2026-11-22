// #4285 (absorbs #4289): set-up LZ targets for the target pickers.
import { describe, it, expect } from 'vitest';
import { providersWithoutRegion, providersWithoutRegionNotice, setupLzTargetsFor, setupLzTargetsLine, setupTargetsNotOffered } from './setup-lz-targets.js';

const RESOLVED = {
  targets: ['azure:germanywestcentral', 'otc:eu-de', 'stackit:eu01'],
  resolved: [{ requested: 'azure:germany', resolved: 'azure:germanywestcentral', geography: 'germany' }],
  source: 'workspace:assessment.landing_zone.targets',
};

describe('setup LZ targets (#4285)', () => {
  it('uses the host resolver; without one the raw configured labels; nothing without a workspace or app', () => {
    expect(setupLzTargetsFor('/ws', 'app', () => RESOLVED, () => ['x:y']).targets).toEqual(RESOLVED.targets);
    expect(setupLzTargetsFor('/ws', 'app', undefined, () => ['otc:eu-de'])).toEqual({ targets: ['otc:eu-de'], resolved: [], source: 'setup' });
    expect(setupLzTargetsFor(null, 'app', () => RESOLVED, () => []).targets).toEqual([]);
    expect(setupLzTargetsFor('/ws', 'app', () => { throw new Error('boom'); }, () => []).targets).toEqual([]);
  });

  it('names the geography resolution and the storage', () => {
    expect(setupLzTargetsLine(RESOLVED)).toBe('Set-up targets (workspace .swao.yml): azure:germany -> azure:germanywestcentral, otc:eu-de, stackit:eu01');
    expect(setupLzTargetsLine({ targets: [], resolved: [], source: 'none' })).toBeNull();
  });

  it('names set-up targets the picker does not offer, for the selected providers only', () => {
    expect(setupTargetsNotOffered(RESOLVED, ['azure', 'otc'], ['otc:eu-de'])).toEqual(['azure:germanywestcentral']);
    expect(setupTargetsNotOffered(RESOLVED, ['otc'], ['otc:eu-de'])).toEqual([]);
  });

  it('#4289 AC2: a provider selected without a region is named', () => {
    expect(providersWithoutRegion(['azure', 'otc', 'stackit'], ['otc:eu-de', 'stackit:eu01'])).toEqual(['azure']);
    expect(providersWithoutRegionNotice(['azure'])).toBe('azure was selected but no region was chosen; it is not assessed in this run.');
  });
});
