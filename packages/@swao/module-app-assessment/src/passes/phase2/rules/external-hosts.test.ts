// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  DYN-02 external hosts rule tests (#1264)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { detectExternalHosts } from './external-hosts.js';

const makeExtracted = (hosts: Array<{ hostname: string; request_count: number; resource_types: string[] }>) => ({
  externalHosts: hosts,
});

describe('detectExternalHosts (#1264)', () => {
  it('returns null when no external hosts', () => {
    expect(detectExternalHosts(makeExtracted([]))).toBeNull();
  });

  it('returns MEDIUM when only static assets (no fetch)', () => {
    const signal = detectExternalHosts(makeExtracted([
      { hostname: 'cdn.example.com', request_count: 5, resource_types: ['image', 'stylesheet'] },
    ]));
    expect(signal).not.toBeNull();
    expect(signal!.id).toBe('DYN-02');
    expect(signal!.severity).toBe('medium');
    expect(signal!.confidence).toBe('high');
  });

  it('returns HIGH when any external fetch call exists', () => {
    const signal = detectExternalHosts(makeExtracted([
      { hostname: 'api.external.io', request_count: 3, resource_types: ['fetch'] },
    ]));
    expect(signal).not.toBeNull();
    expect(signal!.severity).toBe('high');
  });

  it('returns HIGH for mixed fetch + static (fetch wins)', () => {
    const signal = detectExternalHosts(makeExtracted([
      { hostname: 'cdn.example.com', request_count: 2, resource_types: ['image'] },
      { hostname: 'api.tracker.io', request_count: 1, resource_types: ['fetch'] },
    ]));
    expect(signal!.severity).toBe('high');
    expect(signal!.evidence).toHaveLength(2);
  });

  it('evidence lists all external hostnames with request counts', () => {
    const signal = detectExternalHosts(makeExtracted([
      { hostname: 'cdn.example.com', request_count: 4, resource_types: ['stylesheet'] },
    ]));
    expect(signal!.evidence[0]).toContain('cdn.example.com');
    expect(signal!.evidence[0]).toContain('4 request(s)');
  });
});
