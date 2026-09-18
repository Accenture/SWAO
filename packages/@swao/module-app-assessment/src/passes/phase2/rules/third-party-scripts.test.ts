// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  DYN-06 third-party script detection rule tests (#1270)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { detectThirdPartyScripts } from './third-party-scripts.js';
import type { AnalyticsDomain } from '../analytics-blocklist.js';

const BLOCKLIST: AnalyticsDomain[] = [
  { domain: 'segment.io', category: 'analytics', severity: 'HIGH' },
  { domain: 'cdnjs.cloudflare.com', category: 'cdn', severity: 'MEDIUM' },
];

describe('detectThirdPartyScripts (#1270)', () => {
  it('returns null when no third-party scripts detected', () => {
    expect(detectThirdPartyScripts({ thirdPartyScripts: [] }, BLOCKLIST)).toBeNull();
  });

  it('returns HIGH for analytics domain in blocklist', () => {
    const signal = detectThirdPartyScripts({
      thirdPartyScripts: [{ src: 'https://cdn.segment.io/analytics.min.js', screen_slug: '001' }],
    }, BLOCKLIST);
    expect(signal!.id).toBe('DYN-06');
    expect(signal!.severity).toBe('high');
    expect(signal!.evidence[0]).toContain('cdn.segment.io');
    expect(signal!.evidence[0]).toContain('analytics');
  });

  it('returns MEDIUM for cdn domain in blocklist', () => {
    const signal = detectThirdPartyScripts({
      thirdPartyScripts: [{ src: 'https://cdnjs.cloudflare.com/jquery.min.js', screen_slug: '001' }],
    }, BLOCKLIST);
    expect(signal!.severity).toBe('medium');
    expect(signal!.evidence[0]).toContain('cdn');
  });

  it('returns HIGH for unknown domain not in blocklist', () => {
    const signal = detectThirdPartyScripts({
      thirdPartyScripts: [{ src: 'https://unknown-vendor.example.com/widget.js', screen_slug: '001' }],
    }, BLOCKLIST);
    expect(signal!.severity).toBe('high');
    expect(signal!.evidence[0]).toContain('unknown');
  });

  it('worst severity wins when multiple scripts present', () => {
    const signal = detectThirdPartyScripts({
      thirdPartyScripts: [
        { src: 'https://cdnjs.cloudflare.com/jquery.min.js', screen_slug: '001' },
        { src: 'https://cdn.segment.io/analytics.min.js', screen_slug: '001' },
      ],
    }, BLOCKLIST);
    expect(signal!.severity).toBe('high');
  });

  it('returns MEDIUM for all when blocklist is absent', () => {
    const signal = detectThirdPartyScripts({
      thirdPartyScripts: [{ src: 'https://unknown-vendor.example.com/widget.js', screen_slug: '001' }],
    }, []);
    expect(signal!.severity).toBe('medium');
    expect(signal!.confidence).toBe('medium');
  });

  it('deduplicates by hostname and lists all screens', () => {
    const signal = detectThirdPartyScripts({
      thirdPartyScripts: [
        { src: 'https://cdn.segment.io/page1.js', screen_slug: '001' },
        { src: 'https://cdn.segment.io/page2.js', screen_slug: '002' },
      ],
    }, BLOCKLIST);
    expect(signal!.evidence).toHaveLength(1);
    expect(signal!.evidence[0]).toContain('001');
    expect(signal!.evidence[0]).toContain('002');
  });
});
