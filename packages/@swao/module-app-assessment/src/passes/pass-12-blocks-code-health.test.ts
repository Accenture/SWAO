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

// #3487: the blocks pass reads Pass 26 `assessment.code_health` as evidence
// for architecture_assessment and testing_maturity.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump } from 'js-yaml';
import type { LlmProvider, PassContext, PassResult } from '@swao/core';
import { runBlocksPass } from './pass-12-blocks.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'swao-blocks-ch-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function ctx(overrides: Partial<PassContext> = {}): PassContext {
  return { appId: 'demo', sourcePath: dir, workspacePath: dir, iter: 1, assessedAt: '2026-10-25', passesDir: dir, ...overrides };
}

function capturingLlm(): { llm: LlmProvider; prompts: string[] } {
  const prompts: string[] = [];
  return { prompts, llm: { complete: async (p: string) => { prompts.push(p); return '{"blocks":{}}'; } } };
}

const QUAL_SIGNAL = { id: 'QUAL-01', source: 'static_analysis', category: 'application', severity: 'informational', derivation: 'Code health KPIs', evidence: [], confidence: 'high' };

function writeQuality(codeHealth: Record<string, unknown>): void {
  writeFileSync(join(dir, '26-quality.yaml'), dump({
    pass: { id: 26, name: 'code_health', signal_prefix: 'QUAL', status: codeHealth['status'] === 'complete' ? 'complete' : 'not_applicable', iter: 1, assessed_at: 'x' },
    // Signals of the not_applicable case are left out so the prompts compare byte for byte.
    signals: codeHealth['status'] === 'complete' ? [QUAL_SIGNAL] : [],
    assessment: { code_health: codeHealth },
  }));
}

const COMPLETE = {
  status: 'complete',
  kpis: { complexity: 80, maintainability: 74, duplication: 90, configuration_hygiene: 70, overall: 79 },
  totals: { files_measured: 120, nloc: 10000, duplication_pct: 5, hardcoded_ips: 5, hardcoded_urls: 20, test_files_not_measured: 30 },
  worklist: [{ file: 'src/Big.java', score: 71 }, { file: 'src/Other.java', score: 40 }, { file: 'a.ts', score: 20 }, { file: 'b.ts', score: 10 }],
  tools: { requested: ['lizard'], lizard: { status: 'complete', functions_over_threshold: 4 } },
};

type Blocks = Record<string, Record<string, unknown>>;
const blocks = (r: PassResult): Blocks => r.assessment['blocks'] as Blocks;

describe('Pass 12 blocks: Pass 26 evidence (#3487)', () => {
  it('without a Pass 26 result the prompt has no code health section and no block carries evidence', async () => {
    const a = capturingLlm();
    const r = await runBlocksPass(ctx({ llm: a.llm }));
    expect(a.prompts[0]).not.toContain('CODE_HEALTH_CONTEXT');
    for (const b of Object.values(blocks(r))) expect(b['code_health_evidence']).toBeUndefined();

    // A not_applicable Pass 26 result gives the very same prompt as no result.
    writeQuality({ status: 'not_applicable', reason: 'no source tree for this app.' });
    const b = capturingLlm();
    const r2 = await runBlocksPass(ctx({ llm: b.llm }));
    const withoutQualSignal = (p: string): string => p.split('\n').filter((l) => !l.includes('QUAL-01')).join('\n');
    expect(withoutQualSignal(b.prompts[0] ?? '')).toBe(a.prompts[0]);
    for (const blk of Object.values(blocks(r2))) expect(blk['code_health_evidence']).toBeUndefined();
  });

  it('with a complete Pass 26 result the prompt carries KPIs, totals, hotspots and the tool result', async () => {
    writeQuality(COMPLETE);
    const c = capturingLlm();
    await runBlocksPass(ctx({ llm: c.llm }));
    const p = c.prompts[0] ?? '';
    expect(p).toContain('CODE_HEALTH_CONTEXT (Pass 26');
    expect(p).toContain('evidence for architecture_assessment and testing_maturity');
    expect(p).toContain('overall 79, complexity 80, maintainability 74, duplication 90, configuration hygiene 70');
    expect(p).toContain('Test files found (counted, not measured): 30, next to 120 production code file(s).');
    expect(p).toContain('Top worklist files: src/Big.java (71), src/Other.java (40), a.ts (20).');
    expect(p).toContain('lizard: 4 function(s) above CCN 15');
    expect(p.indexOf('CODE_HEALTH_CONTEXT')).toBeLessThan(p.indexOf('BLOCK_SPECS:'));
  });

  it('writes deterministic evidence on architecture_assessment and testing_maturity only, also without an LLM', async () => {
    writeQuality(COMPLETE);
    const r = await runBlocksPass(ctx());
    const b = blocks(r);
    expect(b['architecture_assessment']?.['code_health_evidence']).toEqual({
      source: 'assessment.code_health (Pass 26)',
      kpis: COMPLETE.kpis,
      duplication_pct: 5,
      hotspots: ['src/Big.java (71)', 'src/Other.java (40)', 'a.ts (20)'],
      functions_over_ccn_threshold: 4,
    });
    expect(b['testing_maturity']?.['code_health_evidence']).toEqual({
      source: 'assessment.code_health (Pass 26)',
      production_files_measured: 120,
      test_files_found: 30,
      test_code_mode: 'include',
    });
    for (const name of ['observability', 'licence_compliance', 'database_assessment', 'integration_assessment', 'iam_assessment', 'dr_assessment']) {
      expect(b[name]?.['code_health_evidence']).toBeUndefined();
    }
    expect(b['testing_maturity']?.['overall_outcome']).toBe('UNKNOWN');
  });

  it('test-code exclude mode: the zero test-file count is not presented as missing tests', async () => {
    writeQuality({ ...COMPLETE, totals: { ...COMPLETE.totals, test_files_not_measured: 0 } });
    const c = capturingLlm();
    const r = await runBlocksPass(ctx({ llm: c.llm, testCode: 'exclude' }));
    expect(c.prompts[0]).toContain('do not read the count as missing tests');
    expect(c.prompts[0]).not.toContain('Test files found');
    expect(blocks(r)['testing_maturity']?.['code_health_evidence']).toMatchObject({ test_files_found: null, test_code_mode: 'exclude' });
  });
});
