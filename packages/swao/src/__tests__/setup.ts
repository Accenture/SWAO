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

// Vitest global setup (referenced from vitest.config.ts).
//
// As of M18 the licence scheme is Ed25519 (asymmetric). For test runs we
// generate a fresh keypair per process, set the private seed in
// SWAO_LICENSE_SECRET (base64url, 43 chars), and expose the public key to
// licence-guard via SWAO_LICENSE_PUBLIC_KEY_HEX_TEST. The licence-guard
// public-key getter honours that env override only when NODE_ENV === 'test'.
//
// Production builds never set NODE_ENV=test and verify against the public
// key baked into branding.ts. This file is excluded from `tsc --project
// tsconfig.json` -> dist/ via the `src/__tests__/` test-include pattern in
// tsconfig.json `exclude`.

import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

// #4278: every test process (and every CLI child it spawns, which inherits the
// environment) gets a fresh, empty home. Without it the tests read and wrote
// the developer's real ~/.swao-state.json (licence usage counter), vault and
// config, and a night of test runs used up the owner's licence budget.
// LOCALAPPDATA stays untouched (Playwright browsers live there). Set before any
// test module loads, because license-guard.ts resolves its paths at import.
// #4392: test runs (and every CLI child they spawn) never start or probe the
// HTTP MCP server on localhost:3737, where the operator's own server may run:
// no TUI auto-start (tui/mcp-server-slot.ts) and no health-check HTTP probe.
// A test that covers these paths injects the spawn, the probe and the port.
process.env['SWAO_MCP_AUTOSTART'] = '0';
process.env['SWAO_MCP_HTTP_PROBE'] = '0';
// #4475: no test reaches an LLM platform for the live model list (model pickers,
// swao llm models); a test that covers discovery mocks refreshConnectorModels or
// runs against a fake endpoint in module-llm-providers.
process.env['SWAO_LLM_DISCOVERY'] = 'off';
// #4500: nor a test call of a chosen model (Setup LLM step, checkConnectorModel).
process.env['SWAO_LLM_MODEL_CHECK'] = 'off';

if (!process.env['SWAO_TEST_KEEP_HOME']) {
  const sandboxHome = mkdtempSync(join(tmpdir(), 'swao-test-home-'));
  process.env['HOME'] = sandboxHome;
  process.env['USERPROFILE'] = sandboxHome;
  // The licence file lives under %APPDATA%\swao (license-guard.ts resolveAppDataDir);
  // a real key in a sandboxed home fails the machine fingerprint, so hide it too.
  process.env['APPDATA'] = join(sandboxHome, 'AppData', 'Roaming');
  process.env['XDG_CONFIG_HOME'] = join(sandboxHome, '.config');
  // The Windows licence file is %LOCALAPPDATA%\swao\licence.json, so LOCALAPPDATA
  // is sandboxed as well; the Playwright browser cache in the real
  // %LOCALAPPDATA%\ms-playwright stays reachable through a junction (no admin
  // rights needed), because playwright-detect.ts looks only there.
  const realLocal = process.env['LOCALAPPDATA'];
  const sandboxLocal = join(sandboxHome, 'AppData', 'Local');
  mkdirSync(sandboxLocal, { recursive: true });
  if (realLocal && existsSync(join(realLocal, 'ms-playwright'))) {
    try { symlinkSync(join(realLocal, 'ms-playwright'), join(sandboxLocal, 'ms-playwright'), 'junction'); } catch { /* browser tests skip without it */ }
  }
  process.env['LOCALAPPDATA'] = sandboxLocal;
  // #4375: remove the profile when the test file is done: the ms-playwright
  // junction is unlinked first (the link, never the real browser cache), then
  // the folder. Only a direct child of the temp folder named swao-test-home-*.
  afterAll(async () => {
    const { removeSandboxProfile } = await import('@swao/core');
    removeSandboxProfile(sandboxHome);
  });
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pubRaw  = publicKey.export({ type: 'spki', format: 'der' });
const privRaw = privateKey.export({ type: 'pkcs8', format: 'der' });

// SPKI public key DER carries a 12-byte header before the 32-byte point.
// PKCS8 private key DER carries a 16-byte header before the 32-byte seed.
const pubBytes = pubRaw.subarray(-32);
const privSeed = privRaw.subarray(-32);

process.env['SWAO_LICENSE_SECRET']                = privSeed.toString('base64url');
process.env['SWAO_LICENSE_PUBLIC_KEY_HEX_TEST']   = pubBytes.toString('hex');
process.env['NODE_ENV']                           = 'test';
