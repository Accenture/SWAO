// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Phase 2 integration test -- DYN-02..DYN-08 across 3-screen fixture (#1273)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runPhase2 } from './extractor.js';
import { detectExternalHosts } from './rules/external-hosts.js';
import { inventoryApiEndpoints } from './rules/api-endpoints.js';
import { detectHttpErrors } from './rules/http-errors.js';
import { mapAuthSurface } from './rules/auth-surface.js';
import { detectPiiFormFields } from './rules/pii-form-fields.js';
import { detectThirdPartyScripts } from './rules/third-party-scripts.js';
import { detectCookieConsentAbsence } from './rules/cookie-consent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_DIR = join(__dirname, '__fixtures__');

describe('Phase 2 integration -- 3-screen fixture set (#1273)', () => {
  it('processes all 3 screens from the fixture directory', async () => {
    const result = await runPhase2(FIXTURE_DIR, { appDomain: 'app.example.io' });
    expect(result.screens_processed).toBe(3);
    expect(result.extraction_duration_ms).toBeGreaterThan(0);
  });

  // DYN-02: external hosts -- screen-001 has cdn.external.io and analytics.tracker.com
  it('DYN-02: detectExternalHosts fires for screen-001 external fetch calls', async () => {
    const result = await runPhase2(FIXTURE_DIR, { appDomain: 'app.example.io' });
    const signal = detectExternalHosts(result.extracted);
    expect(signal).not.toBeNull();
    expect(signal!.id).toBe('DYN-02');
    const hostnames = result.extracted.externalHosts.map((h) => h.hostname);
    expect(hostnames).toContain('cdn.external.io');
    expect(hostnames).toContain('analytics.tracker.com');
    // screen-002 and screen-003 are all same-domain -- totals still from screen-001
  });

  // DYN-03: API endpoints -- /api/user/me, /api/records, /api/resource-404, /api/settings
  it('DYN-03: inventoryApiEndpoints captures endpoints from all screens', async () => {
    const result = await runPhase2(FIXTURE_DIR, { appDomain: 'app.example.io' });
    const signal = inventoryApiEndpoints(result.extracted);
    expect(signal).not.toBeNull();
    expect(signal!.id).toBe('DYN-03');
    const endpoints = result.extracted.apiEndpoints;
    expect(endpoints).toContain('/api/user/me');
    expect(endpoints).toContain('/api/settings');
    expect(endpoints.some((e) => e.includes('/collect'))).toBe(true);
  });

  // DYN-04: HTTP errors -- screen-001 has 503, screen-002 has 404
  it('DYN-04: detectHttpErrors fires for 503 (screen-001) and 404 (screen-002)', async () => {
    const result = await runPhase2(FIXTURE_DIR, { appDomain: 'app.example.io' });
    const signal = detectHttpErrors(result.extracted);
    expect(signal).not.toBeNull();
    expect(signal!.id).toBe('DYN-04');
    expect(result.extracted.httpErrors.some((e) => e.status === 503)).toBe(true);
    expect(result.extracted.httpErrors.some((e) => e.status === 404)).toBe(true);
  });

  // DYN-05: PII form fields -- screen-001 has password + email without autocomplete; screen-002 has both compliant
  it('DYN-05: detectPiiFormFields fires for screen-001 non-compliant fields', async () => {
    const result = await runPhase2(FIXTURE_DIR, { appDomain: 'app.example.io' });
    const signal = detectPiiFormFields(result.extracted);
    expect(signal).not.toBeNull();
    expect(signal!.id).toBe('DYN-05');
    // screen-002 compliant fields must not contribute to piiForms count
    const screen001Fields = result.extracted.piiForms.filter((f) => f.screen_slug === '001-dashboard');
    expect(screen001Fields.length).toBeGreaterThan(0);
    const screen002Fields = result.extracted.piiForms.filter((f) => f.screen_slug === '002-auth');
    expect(screen002Fields.length).toBe(0);
  });

  // DYN-06: third-party scripts -- screen-001 has cdn.external.io script; screen-002 has none
  it('DYN-06: detectThirdPartyScripts fires for screen-001 external script', async () => {
    const result = await runPhase2(FIXTURE_DIR, { appDomain: 'app.example.io' });
    const signal = detectThirdPartyScripts(result.extracted);
    expect(signal).not.toBeNull();
    expect(signal!.id).toBe('DYN-06');
    const screen001Scripts = result.extracted.thirdPartyScripts.filter((s) => s.screen_slug === '001-dashboard');
    expect(screen001Scripts.length).toBeGreaterThan(0);
    const screen002Scripts = result.extracted.thirdPartyScripts.filter((s) => s.screen_slug === '002-auth');
    expect(screen002Scripts.length).toBe(0);
  });

  // DYN-07: auth surface -- screen-001 and screen-002 both have /api/user/me
  it('DYN-07: mapAuthSurface detects /api/user/me from screens 001 and 002', async () => {
    const result = await runPhase2(FIXTURE_DIR, { appDomain: 'app.example.io' });
    const signal = mapAuthSurface(result.extracted, result.screens_processed);
    expect(signal).not.toBeNull();
    expect(signal!.id).toBe('DYN-07');
    const authPaths = result.extracted.authEndpoints.map((a) => a.path);
    expect(authPaths.some((p) => p.includes('/user/me'))).toBe(true);
  });

  // DYN-08: cookie consent -- screen-002 has onetrust banner, so consent IS present -> no signal
  it('DYN-08: detectCookieConsentAbsence returns null because screen-002 has OneTrust', async () => {
    const result = await runPhase2(FIXTURE_DIR, { appDomain: 'app.example.io' });
    expect(result.extracted.cookieConsentPresent).toBe(true);
    const signal = detectCookieConsentAbsence(result.extracted, result.screens_processed);
    expect(signal).toBeNull();
  });

  it('screen-003 (clean) contributes no external hosts, no errors, no PII fields', async () => {
    const result = await runPhase2(FIXTURE_DIR, { appDomain: 'app.example.io' });
    const screen003Errors = result.extracted.httpErrors.filter((e) => e.screen_slug === '003-settings');
    expect(screen003Errors).toHaveLength(0);
    const screen003PiiFields = result.extracted.piiForms.filter((f) => f.screen_slug === '003-settings');
    expect(screen003PiiFields).toHaveLength(0);
    const screen003Scripts = result.extracted.thirdPartyScripts.filter((s) => s.screen_slug === '003-settings');
    expect(screen003Scripts).toHaveLength(0);
  });
});
