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

/**
 * Journey J3 -- License Management
 *
 * User journey (from docs/design/010-ux-access-design.md, license section):
 *   Community user Alex wants to request a Premium license.
 *   Alex runs swao license status to find their machine fingerprint,
 *   sends it to the Accenture contact, receives a key, and activates it.
 *
 * These tests cover:
 *   1. Community status shows tier + fingerprint (required for license request)
 *   2. Invalid key activation fails with a clear error
 *   3. (Activation with a valid key is not tested -- would require real key)
 */
import { test, expect } from '@playwright/test';
import { hasBinary, run, attachOutput } from './helpers.js';

test.skip(!hasBinary, 'swao binary not found -- run scripts/build-binary.sh first');

test.describe('J3 -- License Management', () => {

  // ── Community status ──────────────────────────────────────────────────────

  test('license status exits 0 for Community user', async ({}, testInfo) => {
    const r = run(['license', 'status']);
    attachOutput(testInfo, 'license status', r);
    expect(r.status).toBe(0);
  });

  test('license status shows tier (community/consultant/enterprise)', async ({}, testInfo) => {
    const r = run(['license', 'status']);
    attachOutput(testInfo, 'license status (tier check)', r);
    expect(r.combined.toLowerCase()).toMatch(/community|consultant|enterprise/);
  });

  test('license status shows Machine fingerprint so user can request a license', async ({}, testInfo) => {
    const r = run(['license', 'status']);
    attachOutput(testInfo, 'license status (fingerprint)', r);
    expect(r.combined).toContain('Machine fingerprint');
  });

  test('license status fingerprint is 8 hex chars (abbreviated form)', async ({}, testInfo) => {
    const r = run(['license', 'status']);
    attachOutput(testInfo, 'license status (fingerprint format)', r);
    // Example: "Machine fingerprint: 8bd6adf7"
    expect(r.combined).toMatch(/Machine fingerprint[:\s]+[0-9a-f]{8}/i);
  });

  // ── Activation error handling ─────────────────────────────────────────────

  test('license activate with a malformed key exits non-zero', async ({}, testInfo) => {
    const r = run(['license', 'activate', 'not-a-key']);
    attachOutput(testInfo, 'license activate (malformed)', r);
    expect(r.status).not.toBe(0);
  });

  test('license activate with SWAO-prefixed invalid key shows error message', async ({}, testInfo) => {
    const r = run(['license', 'activate', 'SWAO-AAAAAAAA-BBBBBBBB.CCCCCCCC']);
    attachOutput(testInfo, 'license activate (invalid SWAO key)', r);
    expect(r.status).not.toBe(0);
    expect(r.combined.toLowerCase()).toMatch(/invalid|error|malformed|signature/);
  });

  // ── Premium gate ──────────────────────────────────────────────────────────

  test('challenge command exits 2 (Premium gate) on Community tier', async ({}, testInfo) => {
    const r = run(['challenge', '--app', 'sovereign-health', '--agent', 'grc-compliance-officer']);
    attachOutput(testInfo, 'challenge (premium gate)', r);
    expect(r.status).toBe(2);
  });

  // ── Consultant-tier activation (fixture key required) ─────────────────────
  // Set SWAO_FIXTURE_CONSULTANT_KEY to an actual Consultant key issued against
  // the current machine fingerprint to enable these tests.  (#1230, D-01)

  test.skip(
    !process.env['SWAO_FIXTURE_CONSULTANT_KEY'],
    'license activate -- Consultant key accepted and tier shows consultant',
  );

  // ── Enterprise-tier activation (fixture key required) ─────────────────────
  // Set SWAO_FIXTURE_ENTERPRISE_KEY to an actual Enterprise key issued against
  // the current machine fingerprint to enable these tests.  (#1230, D-06)

  test.skip(
    !process.env['SWAO_FIXTURE_ENTERPRISE_KEY'],
    'license activate -- Enterprise key accepted and tier shows enterprise',
  );

  // ── Expiry and fingerprint error paths ────────────────────────────────────

  test('expired key is rejected with a clear error message', async ({}, testInfo) => {
    // A plausible-looking but signature-invalid key; the binary will reject it
    // with LicenseInvalidError(signature_invalid) before expiry is even checked.
    // A real expired-key test would require a legitimately signed key -- deferred
    // until fixture keys are available on CI (see #1230).
    const r = run(['license', 'activate', 'eyJ2IjoxLCJ0aWVyIjoiY29uc3VsdGFudCIsImxpY2Vuc2VlIjoiVGVzdCIsImVtYWlsIjoidGVzdEB0ZXN0LmNvbSIsImV4cCI6IjIwMjAtMDEtMDEiLCJhc3Nlc3NtZW50X2xpbWl0IjpudWxsLCJmcCI6IjAwMDAwMDAwIiwiaWF0IjoiMjAyMC0wMS0wMSJ9.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA']);
    attachOutput(testInfo, 'activate (expired/tampered key)', r);
    expect(r.status).not.toBe(0);
    expect(r.combined.toLowerCase()).toMatch(/invalid|error|signature|expired/);
  });

});
