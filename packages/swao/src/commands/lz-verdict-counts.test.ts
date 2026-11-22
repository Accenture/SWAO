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

// #4274: lz.assessment.complete counts per verdict, identical at app and portfolio scope.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LZ_FIT_VERDICTS, countLzVerdicts, lzCompletionSummary } from './lz-verdict-counts.js';

describe('LZ verdict counts (#4274)', () => {
  it('two NEEDS_VERIFICATION targets: blocked 0, needs_verification 2', () => {
    const s = lzCompletionSummary('NEEDS_VERIFICATION', [
      { provider: 'otc', region: 'eu-de', overall: 'NEEDS_VERIFICATION', signals: 0 },
      { provider: 'stackit', region: 'eu01', overall: 'NEEDS_VERIFICATION', signals: 0 },
    ]);
    expect(s).toEqual({
      overall_verdict: 'NEEDS_VERIFICATION', ready: 0, advisory: 0, needs_verification: 2, blocked: 0, sovereignty_blocked: 0, other: 0,
      targets: [{ target: 'otc:eu-de', verdict: 'NEEDS_VERIFICATION', gaps: 0 }, { target: 'stackit:eu01', verdict: 'NEEDS_VERIFICATION', gaps: 0 }],
    });
  });

  it('counts each verdict value into its own bucket, including SOVEREIGNTY_BLOCKED', () => {
    const keys = { READY: 'ready', ADVISORY: 'advisory', NEEDS_VERIFICATION: 'needs_verification', BLOCKED: 'blocked', SOVEREIGNTY_BLOCKED: 'sovereignty_blocked' } as const;
    for (const v of LZ_FIT_VERDICTS) {
      const c = countLzVerdicts([v]);
      expect(c[keys[v]], v).toBe(1);
      expect(Object.values(c).reduce((a, b) => a + b, 0), v).toBe(1);
    }
    expect(countLzVerdicts(['READY', 'BLOCKED', 'SOVEREIGNTY_BLOCKED', 'BLOCKED'])).toMatchObject({ ready: 1, blocked: 2, sovereignty_blocked: 1 });
  });

  it('an unknown verdict is counted as other, never as blocked', () => {
    expect(countLzVerdicts(['SOMETHING_NEW'])).toMatchObject({ other: 1, blocked: 0 });
  });

  it('assess.ts emits the same summary in the app and portfolio lz.assessment.complete events', () => {
    const src = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'assess.ts'), 'utf-8');
    expect(src.split('...lzCompletionSummary(lzOverallVerdict, lzTargetResults)').length - 1).toBe(2);
    expect(src).not.toContain("blocked: lzTargetResults.filter(r => r.overall !== 'READY').length");
  });
});
