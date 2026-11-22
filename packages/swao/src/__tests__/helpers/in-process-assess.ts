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
 * In-process `swao assess` with a sandboxed, test-signed licence (#3887, #3888
 * follow-up). The spawned CLI (`node dist/index.js`) forces NODE_ENV=production
 * and refuses test-signed licences (injected-licence.ts), so licensed cases
 * that spawn it skip in CI. Here the same action (registerAssess, assess.ts)
 * runs through Commander in the vitest process, where licence-guard verifies
 * against the per-process test key of src/__tests__/setup.ts. The licence and
 * state paths are redirected into a temp home (`_paths`), as in
 * baseline-tier-gates.test.ts, so the machine licence is never read.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { Command } from 'commander';
import { _paths, buildLicenseKey, LicenseGuard } from '@swao/core';
import type { LicensePayload } from '@swao/core';
import { registerAssess } from '../../commands/assess.js';

export type SandboxTier = 'community' | 'consultant' | 'enterprise';

export interface LicenceSandbox {
  home: string;
  restore: () => void;
}

/** Redirect every licence / state lookup into a temp home and install a signed licence of `tier` (none for community). */
export function sandboxLicence(tier: SandboxTier): LicenceSandbox {
  const saved = { statePath: _paths.statePath, licensePath: _paths.licensePath, legacyLicencePath: _paths.legacyLicencePath };
  const savedBinaryTier = process.env['SWAO_BINARY_TIER'];
  delete process.env['SWAO_BINARY_TIER'];
  const home = mkdtempSync(join(tmpdir(), 'swao-inproc-licence-'));
  _paths.statePath = join(home, '.swao-state.json');
  _paths.licensePath = join(home, 'licence.json');
  _paths.legacyLicencePath = join(home, '.swao-license-legacy.json');
  writeFileSync(_paths.statePath, JSON.stringify({ first_run: '2026-11-06', assessment_count: 0, fingerprint: 'abc123de' }), 'utf-8');
  if (tier !== 'community') {
    const fp = LicenseGuard.load().state.fingerprint.substring(0, 8);
    const payload: LicensePayload = { v: 1, tier, licensee: 'TestOrg', email: 'test@example.com', exp: '2099-12-31', assessment_limit: null, fp, iat: '2026-11-06' };
    writeFileSync(_paths.licensePath, JSON.stringify({ key: buildLicenseKey(payload), activated_at: '2026-11-06', tier, exp: payload.exp, licensee: payload.licensee }), 'utf-8');
  }
  const actual = LicenseGuard.load().state.tier;
  if (actual !== tier) throw new Error(`sandboxed licence resolved to ${actual}, expected ${tier}`);
  return {
    home,
    restore: () => {
      Object.assign(_paths, saved);
      if (savedBinaryTier === undefined) delete process.env['SWAO_BINARY_TIER'];
      else process.env['SWAO_BINARY_TIER'] = savedBinaryTier;
      rmSync(home, { recursive: true, force: true });
    },
  };
}

export interface InProcessResult {
  /** First process.exit code; 0 when the action returned without exiting. */
  code: number;
  out: string;
  threw?: Error;
}

/**
 * Run `swao assess <args>` in-process. process.exit is intercepted (first code
 * wins: the action's own catch blocks may exit again on the thrown sentinel);
 * console and std streams are captured; `env` is applied for the call only.
 */
export async function runAssessInProcess(args: string[], env: Record<string, string> = {}): Promise<InProcessResult> {
  const lines: string[] = [];
  let code: number | undefined;
  let threw: Error | undefined;
  const savedEnv = new Map(Object.keys(env).map((k) => [k, process.env[k]] as const));
  Object.assign(process.env, env);
  const push = (...a: unknown[]): void => { lines.push(a.map(String).join(' ')); };
  vi.spyOn(console, 'log').mockImplementation(push);
  vi.spyOn(console, 'info').mockImplementation(push);
  vi.spyOn(console, 'warn').mockImplementation(push);
  vi.spyOn(console, 'error').mockImplementation(push);
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => { lines.push(String(s)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => { lines.push(String(s)); return true; });
  vi.spyOn(process, 'exit').mockImplementation(((c?: number) => { if (code === undefined) code = c ?? 0; throw new Error('__exit__'); }) as typeof process.exit);
  const program = new Command('swao').exitOverride();
  registerAssess(program, { runForApp: async () => { throw new Error('runForApp is not used by a single-app assessment'); } });
  try {
    await program.parseAsync(['assess', ...args], { from: 'user' });
  } catch (e) {
    if ((e as Error).message !== '__exit__') threw = e as Error;
  } finally {
    vi.restoreAllMocks();
    for (const [k, v] of savedEnv) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return { code: code ?? (threw ? 1 : 0), out: lines.join('\n'), ...(threw ? { threw } : {}) };
}
