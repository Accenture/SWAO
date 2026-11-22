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

// #4443: run-manifest provenance.crawl_type comes from the crawl Pass 10 ran.

import { describe, it, expect } from 'vitest';
import { provenanceCrawlType } from './assess.js';

describe('provenanceCrawlType (#4443)', () => {
  it('a completed Playwright crawl is playwright', () => {
    expect(provenanceCrawlType({ engineVersion: '0.0.1' })).toBe('playwright');
  });

  it('no crawl is none', () => {
    expect(provenanceCrawlType(undefined)).toBe('none');
  });

  it('vision on parity-baseline screenshots only is no crawl', () => {
    expect(provenanceCrawlType({ engineVersion: 'parity-baseline' })).toBe('none');
  });

  it('the CI crawl stub is stub', () => {
    expect(provenanceCrawlType({ engineVersion: 'stub' })).toBe('stub');
  });
});
