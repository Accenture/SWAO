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

// #3222: assessment.pass.complete (app and portfolio logs) records llm_calls
// so the operator can see a pass's LLM fan-out.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';

describe('assessment.pass.complete llm_calls (#3222)', () => {
  it('both pass.complete events carry llm_calls from the pass usage snapshot', () => {
    const src = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'assess.ts'), 'utf-8');
    const lines = src.split(/\r?\n/).filter((l) => l.includes('pass_id: passId') && l.includes('duration_ms: passMs'));
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l).toContain('...(passUsage?.call_count ? { llm_calls: passUsage.call_count } : {})');
  });
});
