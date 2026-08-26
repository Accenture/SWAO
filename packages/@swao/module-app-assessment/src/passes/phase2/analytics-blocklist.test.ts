// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Analytics domain blocklist loader tests (#1268)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadAnalyticsBlocklist, getAnalyticsDomainSet, AnalyticsBlocklistSchema } from './analytics-blocklist.js';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the canonical YAML path from the repo root
const CONTROLS_PATH = join(__dirname, '..', '..', '..', '..', '..', '..', 'controls', 'dynamic-analysis', 'analytics-domains.yaml');

describe('analytics blocklist loader (#1268)', () => {
  it('loads and validates the canonical analytics-domains.yaml without error', () => {
    const blocklist = loadAnalyticsBlocklist(CONTROLS_PATH);

    expect(blocklist.version).toBeTruthy();
    expect(blocklist.domains.length).toBeGreaterThanOrEqual(15);
    // Verify Zod schema parsing succeeded (no throw above means it passed)
    const result = AnalyticsBlocklistSchema.safeParse(blocklist);
    expect(result.success).toBe(true);
  });

  it('contains at least one entry from each required category (analytics, cdn, error-tracking)', () => {
    const blocklist = loadAnalyticsBlocklist(CONTROLS_PATH);
    const categories = new Set(blocklist.domains.map((d) => d.category));

    expect(categories.has('analytics')).toBe(true);
    expect(categories.has('cdn')).toBe(true);
    expect(categories.has('error-tracking')).toBe(true);
  });

  it('contains segment.io as a known analytics domain', () => {
    const blocklist = loadAnalyticsBlocklist(CONTROLS_PATH);
    const domains = blocklist.domains.map((d) => d.domain);
    expect(domains).toContain('segment.io');
  });

  it('getAnalyticsDomainSet returns a Set of domain strings', () => {
    const domainSet = getAnalyticsDomainSet(CONTROLS_PATH);
    expect(domainSet instanceof Set).toBe(true);
    expect(domainSet.has('segment.io')).toBe(true);
    expect(domainSet.has('google-analytics.com')).toBe(true);
  });

  it('returns empty blocklist gracefully when file does not exist', () => {
    const blocklist = loadAnalyticsBlocklist('/nonexistent/path/analytics-domains.yaml');
    expect(blocklist.domains).toHaveLength(0);
  });

  it('validates a custom blocklist file against the Zod schema', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-blocklist-'));
    try {
      const customYaml = [
        'version: "1.0"',
        'description: "test"',
        'updated: "2026-07-26"',
        'domains:',
        '  - domain: custom-tracker.com',
        '    category: analytics',
        '    severity: HIGH',
      ].join('\n');
      const customPath = join(tmp, 'analytics-domains.yaml');
      writeFileSync(customPath, customYaml, 'utf-8');

      const blocklist = loadAnalyticsBlocklist(customPath);
      expect(blocklist.domains).toHaveLength(1);
      expect(blocklist.domains[0]!.domain).toBe('custom-tracker.com');
      expect(blocklist.domains[0]!.severity).toBe('HIGH');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
