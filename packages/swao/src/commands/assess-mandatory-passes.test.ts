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

// #3449: the mandatory-pass check compares pass header names (passDef.name).
// 'compliance' never matched the real name 'compliance_evaluation', so a
// pass-11 connectivity failure exited 0. Every mandatory name must be a real
// pass header name from the canonical profile.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { DEFAULT_PASS_PROFILE } from '@swao/core';

const src = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'assess.ts'), 'utf-8');

describe('assess mandatory passes (#3449)', () => {
  const m = /const mandatoryPassNames = \[([^\]]*)\]/.exec(src);
  const names = (m?.[1] ?? '').split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);

  it('declares the mandatory list', () => {
    expect(names).toEqual(['compliance_evaluation', 'block_assessments']);
  });

  it('every mandatory name is a real pass header name', () => {
    const real = new Set(DEFAULT_PASS_PROFILE.map((p: { name: string }) => p.name));
    for (const n of names) expect(real.has(n), `${n} is not a pass header name`).toBe(true);
  });

  it('a mandatory failure sets a non-zero exit code; degraded passes do not', () => {
    expect(src).toMatch(/const runCompleteExitCode = mandatoryFailed\.length > 0 \? 1 : 0;/);
    // Degraded passes feed run-status only, never the exit code.
    expect(src).toMatch(/degradedPasses: passesDegraded, exitCode: runCompleteExitCode/);
  });
});
