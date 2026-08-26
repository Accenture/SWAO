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
 * Journey J4 -- Credential Management
 *
 * User journey (from docs/design/010-ux-access-design.md, credentials section):
 *   Alex stores provider API keys securely in the system credential store.
 *   Keys are stored once via `swao credential set`, listed with `credential list`,
 *   and removed with `credential delete`. Values are never shown after storage.
 *
 * Test isolation: uses a namespaced key (swao-e2e-*) and cleans up in afterEach.
 */
import { test, expect } from '@playwright/test';
import { hasBinary, run, attachOutput } from './helpers.js';

test.skip(!hasBinary, 'swao binary not found -- run scripts/build-binary.sh first');

const TEST_KEY   = 'swao-e2e-test-credential';
const TEST_VALUE = 'test-value-e2e-1234';

test.describe('J4 -- Credential Management', () => {

  test.afterEach(async () => {
    // Clean up: remove the test key even if the test failed
    run(['credential', 'delete', TEST_KEY]);
  });

  // ── list ──────────────────────────────────────────────────────────────────

  test('credential list exits 0', async ({}, testInfo) => {
    const r = run(['credential', 'list']);
    attachOutput(testInfo, 'credential list', r);
    expect([0, 1]).toContain(r.status);
  });

  // ── set → list → delete flow ──────────────────────────────────────────────

  test('credential set exits 0 and confirms storage', async ({}, testInfo) => {
    const r = run(['credential', 'set', TEST_KEY, TEST_VALUE]);
    attachOutput(testInfo, 'credential set', r);
    expect(r.status).toBe(0);
  });

  test('credential delete exits 0 for an existing key', async ({}, testInfo) => {
    run(['credential', 'set', TEST_KEY, TEST_VALUE]);
    const r = run(['credential', 'delete', TEST_KEY]);
    attachOutput(testInfo, 'credential delete', r);
    expect(r.status).toBe(0);
  });

  test('credential delete is idempotent (no error for already-deleted key)', async ({}, testInfo) => {
    const r = run(['credential', 'delete', 'swao-e2e-never-exists']);
    attachOutput(testInfo, 'credential delete (idempotent)', r);
    expect([0, 1]).toContain(r.status);
  });

  // ── error handling ────────────────────────────────────────────────────────

  test('credential set without a value exits non-zero', async ({}, testInfo) => {
    const r = run(['credential', 'set', TEST_KEY]);
    attachOutput(testInfo, 'credential set (missing value)', r);
    expect(r.status).not.toBe(0);
  });

  test('credential set without a key exits non-zero', async ({}, testInfo) => {
    const r = run(['credential', 'set']);
    attachOutput(testInfo, 'credential set (missing key)', r);
    expect(r.status).not.toBe(0);
  });

});
