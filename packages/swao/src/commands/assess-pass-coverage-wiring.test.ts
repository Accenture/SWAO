// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Pass coverage wiring in swao assess (#3419 / #3436)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// The decisions are unit-tested in @swao/module-app-assessment
// (pass-coverage.test.ts); this pins that `swao assess` wires them into the
// run manifest, run-status, the log and --malware-fail-on-detection.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';

const src = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'assess.ts'), 'utf-8');

describe('swao assess pass coverage wiring (#3419 / #3436)', () => {
  it('computes passes not scheduled from the request before --skip-llm', () => {
    expect(src).toContain('const passesBeforeSkipLlm = opts.passes;');
    expect(src).toMatch(/passesNotScheduled\(\{\s*requested: normaliseRequestedPasses\(passesBeforeSkipLlm\.split/);
  });

  it('classifies every pass result that ran', () => {
    expect(src).toContain('classifyPassOutcome(passKey, result, { skipLlm: !!opts.skipLlm })');
    expect(src).toContain('if (passOutcome.notRun) passesNotRun.push(passOutcome.notRun);');
    expect(src).toContain('if (passOutcome.degraded) passesDegraded.push(passOutcome.degraded);');
  });

  it('writes run-manifest v1.6 with passes_not_run and passes_degraded', () => {
    expect(src).toMatch(/schema_version: '1\.6'/);
    expect(src).toContain('{ passes_not_run: [...passesNotRun] }');
    expect(src).toContain('{ passes_degraded: [...passesDegraded] }');
  });

  it('#3436: closes run-status with degraded_passes and emits assessment.pass.degraded', () => {
    expect(src).toContain('degradedPasses: passesDegraded');
    expect(src).toContain('passDegradedLogEvent(passOutcome.degraded, passId)');
    expect(src).toMatch(/logApp\(opts\.app!, ev\.level, ev\.event/);
    expect(src).toMatch(/logPortfolio\(ev\.level, ev\.event/);
    expect(src).toContain('...(passOutcome.degraded ? { degraded: true } : {})');
  });

  it('#3419: the default secret scan feeds --malware-fail-on-detection', () => {
    expect(src).toContain("if (passKey === 'malware' || passKey === 'secrets') malwarePassResult = result;");
  });
});
