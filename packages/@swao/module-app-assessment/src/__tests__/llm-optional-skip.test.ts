// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { PassContext } from '@swao/core';
import { runDataPass } from '../passes/pass-03-data.js';
import { runCtxPass } from '../passes/pass-04-ctx.js';
import { runSynthPass } from '../passes/pass-09-synth.js';
// COMP (Pass 11) moved to @swao/module-framework (#0570); its LLM-optional
// behaviour is covered by that module's compliance-evaluator.test.ts.
import { runBlocksPass } from '../passes/pass-12-blocks.js';
import { NO_LLM_REASON } from '../passes/llm-skip.js';

/** A PassContext with no `llm` (the LLM-optional condition, #0550). */
function noLlmCtx(): PassContext {
  const dir = mkdtempSync(join(tmpdir(), 'swao-llmopt-'));
  return {
    appId: 'fixture',
    sourcePath: dir,
    workspacePath: dir,
    iter: 1,
    assessedAt: '2026-06-23',
  };
}

describe('LLM-optional graceful skip (#0550)', () => {
  it('DATA, CTX and SYNTH emit a PREFIX-00 skip signal and not_applicable status without an LLM', async () => {
    const cases = [
      { run: runDataPass, prefix: 'DATA' },
      { run: runCtxPass, prefix: 'CTX' },
      { run: runSynthPass, prefix: 'SYNTH' },
    ];
    for (const { run, prefix } of cases) {
      const result = await run(noLlmCtx());
      expect(result.pass.status).toBe('not_applicable');
      expect(result.assessment['skipped']).toBe(true);
      expect(result.assessment['skipped_reason']).toBe(NO_LLM_REASON);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0]?.id).toBe(`${prefix}-00`);
      expect(result.signals[0]?.severity).toBe('informational');
      expect(result.signals[0]?.derivation.length).toBeGreaterThanOrEqual(20);
    }
  });

  it('BLOCKS completes and marks no_llm_provider without an LLM', async () => {
    const result = await runBlocksPass(noLlmCtx());
    expect(result.pass.status).toBe('complete');
    expect(result.assessment['skipped_reason']).toBe(NO_LLM_REASON);
    // Blocks still emitted, all degraded to UNKNOWN.
    expect(result.assessment['blocks_evaluated']).toBeGreaterThan(0);
  });
});
