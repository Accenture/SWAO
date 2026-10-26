// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module -- country-header grouping (#3380, decision 1b)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { insertCountryHeaders } from './AssessScreen.js';

describe('insertCountryHeaders (#3380)', () => {
  it('inserts one header per country, grouped and sorted', () => {
    const out = insertCountryHeaders([
      { label: 'otc / eu-nl', value: 'otc:eu-nl', country: 'Netherlands' },
      { label: 'otc / eu-de', value: 'otc:eu-de', country: 'Germany' },
      { label: 'stackit / eu01', value: 'stackit:eu01', country: 'Germany' },
    ]);
    expect(out).toEqual([
      { label: 'Germany', value: '__hdr:Germany', header: true },
      { label: 'otc / eu-de', value: 'otc:eu-de' },
      { label: 'stackit / eu01', value: 'stackit:eu01' },
      { label: 'Netherlands', value: '__hdr:Netherlands', header: true },
      { label: 'otc / eu-nl', value: 'otc:eu-nl' },
    ]);
  });

  it('files regions with no country under "Other"', () => {
    const out = insertCountryHeaders([{ label: 'azure / eastus2', value: 'azure:eastus2' }]);
    expect(out[0]).toEqual({ label: 'Other', value: '__hdr:Other', header: true });
    expect(out[1]).toEqual({ label: 'azure / eastus2', value: 'azure:eastus2' });
  });

  it('is empty for no options', () => {
    expect(insertCountryHeaders([])).toEqual([]);
  });
});
