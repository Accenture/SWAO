// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Phase 2 post-crawl extraction harness tests (#1263)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { runPhase2, runDomChecks } from './extractor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURE_DIR = join(__dirname, '__fixtures__');

describe('runPhase2 (#1263)', () => {
  it('processes screen-001 fixture and detects external hosts', async () => {
    const result = await runPhase2(FIXTURE_DIR, { appDomain: 'app.example.io' });

    expect(result.screens_processed).toBe(3);
    expect(result.extraction_duration_ms).toBeGreaterThanOrEqual(0);

    const externalHostnames = result.extracted.externalHosts.map((h) => h.hostname);
    expect(externalHostnames).toContain('cdn.external.io');
    expect(externalHostnames).toContain('analytics.tracker.com');
    // app.example.io is the app domain -- must not appear as external
    expect(externalHostnames).not.toContain('app.example.io');
  });

  it('detects live API endpoints (fetch calls only)', async () => {
    const result = await runPhase2(FIXTURE_DIR, { appDomain: 'app.example.io' });

    // fetch calls to app.example.io should be in apiEndpoints
    expect(result.extracted.apiEndpoints).toContain('/api/user/me');
    expect(result.extracted.apiEndpoints).toContain('/api/records');
    // analytics fetch (external domain) should also be captured as an endpoint
    expect(result.extracted.apiEndpoints.some((e) => e.includes('/collect'))).toBe(true);
  });

  it('detects HTTP errors (status >= 400)', async () => {
    const result = await runPhase2(FIXTURE_DIR, { appDomain: 'app.example.io' });

    expect(result.extracted.httpErrors.length).toBeGreaterThan(0);
    const err = result.extracted.httpErrors.find((e) => e.status === 503);
    expect(err).toBeDefined();
    expect(err?.screen_slug).toBe('001-dashboard');
  });

  it('detects auth endpoints from /api/user/me', async () => {
    const result = await runPhase2(FIXTURE_DIR, { appDomain: 'app.example.io' });

    const authPaths = result.extracted.authEndpoints.map((a) => a.path);
    expect(authPaths.some((p) => p.includes('/user/me'))).toBe(true);
  });

  it('returns 0 screens when baseline directory does not exist', async () => {
    const result = await runPhase2('/nonexistent-path', { appDomain: 'app.example.io' });

    expect(result.screens_processed).toBe(0);
    expect(result.extraction_duration_ms).toBe(0);
    expect(result.extracted.externalHosts).toHaveLength(0);
  });

  it('skips directories that do not match NNN- pattern', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'swao-phase2-'));
    try {
      mkdirSync(join(tmp, 'not-a-screen'), { recursive: true });
      mkdirSync(join(tmp, '001-valid-screen'), { recursive: true });
      writeFileSync(
        join(tmp, '001-valid-screen', 'meta.json'),
        JSON.stringify({
          index: 1, url: 'https://app.test/page', title: 'Page', timestamp: '2026-07-26T00:00:00.000Z',
          slug: '001-valid-screen', network_entries: 0, console_entries: 0, a11y_violations: 0,
          network_log: [], console_log: [],
        }),
        'utf-8',
      );

      const result = await runPhase2(tmp, { appDomain: 'app.test' });
      expect(result.screens_processed).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('runDomChecks: empty DOM returns empty results', () => {
    const result = runDomChecks('001-screen', '<html><body></body></html>', { appDomain: 'app.example.io' });
    expect(result.piiForms).toHaveLength(0);
    expect(result.thirdPartyScripts).toHaveLength(0);
    expect(result.cookieConsentPresent).toBe(false);
  });

  it('runDomChecks: detects password field without autocomplete (DYN-05)', () => {
    const html = '<input type="password" name="pass">';
    const result = runDomChecks('001', html, { appDomain: 'app.example.io' });
    expect(result.piiForms).toHaveLength(1);
    expect(result.piiForms[0]!.issue).toContain('autocomplete');
  });

  it('runDomChecks: compliant password field not flagged', () => {
    const html = '<input type="password" name="pass" autocomplete="current-password">';
    const result = runDomChecks('001', html, { appDomain: 'app.example.io' });
    expect(result.piiForms).toHaveLength(0);
  });

  it('runDomChecks: detects external script src (DYN-06)', () => {
    const html = '<script src="https://cdn.external.io/analytics.js"></script>';
    const result = runDomChecks('001', html, { appDomain: 'app.example.io' });
    expect(result.thirdPartyScripts).toHaveLength(1);
    expect(result.thirdPartyScripts[0]!.src).toContain('cdn.external.io');
  });

  it('runDomChecks: same-domain script not flagged', () => {
    const html = '<script src="https://app.example.io/bundle.js"></script>';
    const result = runDomChecks('001', html, { appDomain: 'app.example.io' });
    expect(result.thirdPartyScripts).toHaveLength(0);
  });

  it('runDomChecks: detects OneTrust consent banner (DYN-08)', () => {
    const html = '<div id="onetrust-accept-btn-handler">Accept</div>';
    const result = runDomChecks('001', html, { appDomain: 'app.example.io' });
    expect(result.cookieConsentPresent).toBe(true);
  });

  it('runDomChecks: detects generic cookie class (DYN-08)', () => {
    const html = '<div class="cookie-banner">We use cookies</div>';
    const result = runDomChecks('001', html, { appDomain: 'app.example.io' });
    expect(result.cookieConsentPresent).toBe(true);
  });

  it('runPhase2: fixture dom.html produces piiForms and thirdPartyScripts', async () => {
    const result = await runPhase2(FIXTURE_DIR, { appDomain: 'app.example.io' });
    // fixture dom.html has an external script and input fields without autocomplete
    expect(result.extracted.thirdPartyScripts.length).toBeGreaterThan(0);
    expect(result.extracted.piiForms.length).toBeGreaterThan(0);
  });
});
