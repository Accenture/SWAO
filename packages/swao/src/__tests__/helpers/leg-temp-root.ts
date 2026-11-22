// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, test helper
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4473: a test file that runs orchestrateLegs gets its own temp root, so
// the leg workspaces (swao-leg-<id>-* under os.tmpdir()) never land in the
// system temp folder; failed and cancelled legs keep their workspace on
// purpose (Design 092 s7.2). Call at the top level of the test file (before
// the tests run). The root is removed after the file; the file fails when the
// root cannot be removed (a leg process may still hold it) or when a test
// moved os.tmpdir() away from it. Same rule as the setup file of
// @swao/module-llm-assessment (vitest.leg-temp-root.setup.ts).

import { afterAll } from 'vitest';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const KEYS = ['TEMP', 'TMP', 'TMPDIR'] as const;

export function useLegTempRoot(): string {
  const saved: Record<string, string | undefined> = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const root = mkdtempSync(join(tmpdir(), 'swao-test-legs-'));
  for (const k of KEYS) process.env[k] = root;
  afterAll(async () => {
    const stillRedirected = resolve(tmpdir()) === resolve(root);
    const legFolders = existsSync(root) ? readdirSync(root).filter((n) => n.startsWith('swao-leg-')).length : 0;
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    if (!stillRedirected) throw new Error(`#4473: a test changed os.tmpdir() away from the temp root ${root}; leg workspaces would leak into the system temp folder`);
    if (existsSync(root)) throw new Error(`#4473: the temp root ${root} (${legFolders} swao-leg-* folder(s)) could not be removed; a leg process may still hold it`);
  });
  return root;
}
