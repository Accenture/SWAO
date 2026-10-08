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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCtxPass } from './index.js';
import { FixedLlmProvider } from '@swao/module-llm-providers';

// Test coverage for #0468 -- placeholder detection + evidence file verification.

const TEMP_DIR = join(tmpdir(), `pass-04-ctx-${process.pid}`);

function validLlmResponse(signals: object[] = []): string {
  return JSON.stringify({
    signals: signals.length > 0 ? signals : [
      {
        id: 'CTX-01',
        source: 'llm_inference',
        category: 'application',
        severity: 'informational',
        derivation: 'Context ingestion completed with no notable findings from the imported files.',
        evidence: [],
        confidence: 'high',
      },
    ],
    assessment: { context_inputs_found: 1, contradictions_detected: 0 },
    context_overrides: [],
  });
}

beforeEach(() => {
  mkdirSync(join(TEMP_DIR, 'wsp', 'inputs'), { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  try { rmSync(TEMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('pass-04-ctx placeholder detection (#0468)', () => {
  it('(a) placeholder file triggers warn and records in assessment.placeholder_inputs', async () => {
    const inputsDir = join(TEMP_DIR, 'wsp', 'inputs');
    writeFileSync(
      join(inputsDir, 'context.md'),
      '# Project context\nSample / placeholder -- Replace before the assessment\n',
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const llm = new FixedLlmProvider(validLlmResponse());

    const ctx = { workspacePath: TEMP_DIR, iter: 1, assessedAt: '2026-01-01T00:00:00Z', llm };
    const result = await runCtxPass(ctx);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/context\.md.*placeholder text/),
    );
    const assessment = result.assessment as Record<string, unknown>;
    expect(Array.isArray(assessment['placeholder_inputs'])).toBe(true);
    expect((assessment['placeholder_inputs'] as string[]).length).toBeGreaterThan(0);
  });

  it('(b) missing evidence file flags signal.false_positive_flag = true', async () => {
    const inputsDir = join(TEMP_DIR, 'wsp', 'inputs');
    writeFileSync(join(inputsDir, 'context.md'), '# Real context\nThis is real content with no placeholders.\n');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const llmResponse = validLlmResponse([{
      id: 'CTX-01',
      source: 'llm_inference',
      category: 'application',
      severity: 'informational',
      derivation: 'Context ingestion completed; evidence file referenced does not exist.',
      evidence: ['nonexistent-evidence-file.md'],
      confidence: 'high',
    }]);
    const llm = new FixedLlmProvider(llmResponse);
    const ctx = { workspacePath: TEMP_DIR, iter: 1, assessedAt: '2026-01-01T00:00:00Z', llm };
    const result = await runCtxPass(ctx);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/CTX-01.*could not be resolved/),
    );
    expect(result.signals[0].false_positive_flag).toBe(true);
    expect(result.signals[0].false_positive_note).toMatch(/Evidence file not found/);
  });

  it('(c) valid evidence file passes clean (no false_positive_flag)', async () => {
    const inputsDir = join(TEMP_DIR, 'wsp', 'inputs');
    writeFileSync(join(inputsDir, 'context.md'), '# Real context\nThis is real content.\n');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const llmResponse = validLlmResponse([{
      id: 'CTX-01',
      source: 'llm_inference',
      category: 'application',
      severity: 'informational',
      derivation: 'Context ingestion completed; evidence file exists and is valid.',
      evidence: ['context.md'],
      confidence: 'high',
    }]);
    const llm = new FixedLlmProvider(llmResponse);
    const ctx = { workspacePath: TEMP_DIR, iter: 1, assessedAt: '2026-01-01T00:00:00Z', llm };
    const result = await runCtxPass(ctx);

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringMatching(/false_positive|does not exist|escapes/));
    expect(result.signals[0].false_positive_flag).toBeUndefined();
  });

  it('(d) path-traversal evidence reference is flagged without following', async () => {
    const inputsDir = join(TEMP_DIR, 'wsp', 'inputs');
    writeFileSync(join(inputsDir, 'context.md'), '# Real context\nThis is real content.\n');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const llmResponse = validLlmResponse([{
      id: 'CTX-01',
      source: 'llm_inference',
      category: 'application',
      severity: 'informational',
      derivation: 'Context ingestion attempted path traversal via evidence reference.',
      evidence: ['../../etc/passwd'],
      confidence: 'high',
    }]);
    const llm = new FixedLlmProvider(llmResponse);
    const ctx = { workspacePath: TEMP_DIR, iter: 1, assessedAt: '2026-01-01T00:00:00Z', llm };
    const result = await runCtxPass(ctx);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/CTX-01.*escapes workspace bounds/),
    );
    expect(result.signals[0].false_positive_flag).toBe(true);
    expect(result.signals[0].false_positive_note).toMatch(/escapes workspace/);
  });
});

// #2962: budget-excluded files cited by LLM should produce context_gaps, not false_positive_flag.
// Strategy: small-a.md (tier 1) fills the default 55000-char budget; large-b.csv (tier 3) is
// excluded because the budget is exhausted by the time the greedy fill reaches it.
// No vi.resetModules() needed -- the file sizes guarantee exclusion at the default budget.
describe('pass-04-ctx budget-excluded evidence -> context_gaps (#2962)', () => {
  const BUDGET_DIR = join(tmpdir(), `pass-04-budget-${process.pid}`);

  beforeEach(() => {
    mkdirSync(join(BUDGET_DIR, 'wsp', 'inputs'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try { rmSync(BUDGET_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('signal citing a budget-excluded file gets context_gaps, not false_positive_flag (#2962)', async () => {
    const inputsDir = join(BUDGET_DIR, 'wsp', 'inputs');
    // File A (tier 1, large -- fills the 55000-char prompt budget).
    // 2400 repetitions of a 22-char line = ~52800 chars; 18 chunks of 3000 chars.
    // After the header (~2300 chars), ~52700 chars remain for content.
    // The 18 chunks of small-a.md consume almost all of it.
    const bigMdContent = 'Context content line.\n'.repeat(2400);
    writeFileSync(join(inputsDir, 'small-a.md'), bigMdContent, 'utf-8');
    // File B (tier 3) -- excluded because budget is exhausted by small-a.md.
    // Its first chunk (~3010 chars) won't fit in the remaining budget (~70 chars).
    writeFileSync(join(inputsDir, 'large-b.csv'), 'col1,col2\n' + 'x,y\n'.repeat(750), 'utf-8');

    const llmResponse = JSON.stringify({
      signals: [{
        id: 'CTX-01',
        source: 'llm_inference',
        category: 'application',
        severity: 'informational',
        derivation: 'Evidence from budget-excluded file cited by model.',
        evidence: ['large-b.csv'],
        confidence: 'high',
      }],
      assessment: { context_inputs_found: 1, contradictions_detected: 0 },
      context_overrides: [],
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const llm = new FixedLlmProvider(llmResponse);
    const ctx = { workspacePath: BUDGET_DIR, iter: 1, assessedAt: '2026-01-01T00:00:00Z', llm };
    const result = await runCtxPass(ctx);

    const sig = result.signals[0];
    expect(sig.context_gaps).toContain('large-b.csv');
    expect(sig.false_positive_flag).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/budget-excluded.*cited but not verified/));
  });
});
