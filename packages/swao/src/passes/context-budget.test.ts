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

// Unit tests for computeContextBudget (#2959).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeContextBudget } from './context-budget.js';

const ABSOLUTE_MAX = 400_000;

beforeEach(() => {
  delete process.env['SWAO_CTX_PROMPT_MAX_CHARS'];
});
afterEach(() => {
  delete process.env['SWAO_CTX_PROMPT_MAX_CHARS'];
});

describe('computeContextBudget (#2959)', () => {
  it('respects SWAO_CTX_PROMPT_MAX_CHARS env var regardless of connector window', () => {
    process.env['SWAO_CTX_PROMPT_MAX_CHARS'] = '50000';
    expect(computeContextBudget({ context_window_k: 128 })).toBe(50_000);
  });

  it('caps env var at ABSOLUTE_MAX_CHARS (400000)', () => {
    process.env['SWAO_CTX_PROMPT_MAX_CHARS'] = '999999';
    expect(computeContextBudget({})).toBe(ABSOLUTE_MAX);
  });

  it('context_window_k = 128 computes budget capped at ABSOLUTE_MAX_CHARS', () => {
    // 128*1000*4 - 5000 - 0 - 12000 = 495000 > 400000 -> capped
    expect(computeContextBudget({ context_window_k: 128 })).toBe(ABSOLUTE_MAX);
  });

  it('context_window_k = 4 (small model) hits 10000-char floor', () => {
    // 4*1000*4 - 5000 - 0 - 12000 = -1000 -> Math.max(-1000, 10000) = 10000
    expect(computeContextBudget({ context_window_k: 4 })).toBe(10_000);
  });

  it('missing context_window_k falls back to KNOWN_CONTEXT_WINDOWS_K lookup', () => {
    // Llama 128K -> same formula -> 400000
    expect(computeContextBudget({ model: '/Llama-3.3-70B-Instruct-FP8-Dynamic' })).toBe(ABSOLUTE_MAX);
  });

  it('unknown model falls back to 110000 default', () => {
    expect(computeContextBudget({ model: 'some-unknown-llm-v99' })).toBe(110_000);
  });

  it('connector with no hints falls back to 110000 default', () => {
    expect(computeContextBudget({})).toBe(110_000);
  });

  it('absolute ceiling enforced for hypothetical 2M-token model', () => {
    expect(computeContextBudget({ context_window_k: 2000 })).toBe(ABSOLUTE_MAX);
  });
});
