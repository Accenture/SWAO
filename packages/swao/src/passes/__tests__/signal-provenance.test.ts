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

import { describe, it, expect } from 'vitest';
import { SignalSchema } from '../../schema/signals.js';

// #0478 (C-22) -- signal-level provenance block tests.

describe('Signal provenance schema (C-22)', () => {
  it('accepts a signal with provenance block', () => {
    const signal = {
      id: 'DATA-01',
      source: 'llm_inference',
      category: 'application',
      severity: 'medium',
      derivation: 'Data classification analysis via LLM inference on source imports.',
      evidence: ['src/index.ts'],
      confidence: 'high',
      assessor: 'llm',
      assessed_at: '2026-06-03T10:00:00Z',
      provenance: {
        source: 'anthropic/claude-sonnet-4-6',
        run_id: 'run-2026-06-03T10-00-00',
        cassette_hit: false,
        assessed_at: '2026-06-03T10:00:00Z',
      },
    };
    expect(() => SignalSchema.parse(signal)).not.toThrow();
    const parsed = SignalSchema.parse(signal);
    expect(parsed.provenance?.source).toBe('anthropic/claude-sonnet-4-6');
    expect(parsed.provenance?.cassette_hit).toBe(false);
  });

  it('accepts a signal without provenance block (back-compat)', () => {
    const signal = {
      id: 'INV-01',
      source: 'static_analysis',
      category: 'application',
      derivation: 'Inventory scan detected Node.js package dependency tree.',
      evidence: ['package.json'],
      confidence: 'high',
    };
    expect(() => SignalSchema.parse(signal)).not.toThrow();
    expect(SignalSchema.parse(signal).provenance).toBeUndefined();
  });

  it('accepts a cache-hit signal with cassette_hit: true', () => {
    const signal = {
      id: 'CTX-01',
      source: 'llm_inference',
      category: 'business_processes',
      derivation: 'Context ingestion from workshop import file identified key stakeholder.',
      evidence: ['wsp/inputs/workshops/session.md'],
      confidence: 'medium',
      provenance: {
        source: 'openai/gpt-5',
        run_id: 'run-2026-06-03T10-00-00',
        cassette_hit: true,
        assessed_at: '2026-06-03T10:00:00Z',
      },
    };
    const parsed = SignalSchema.parse(signal);
    expect(parsed.provenance?.cassette_hit).toBe(true);
    expect(parsed.provenance?.source).toBe('openai/gpt-5');
  });

  it('accepts rule_engine provenance for static passes', () => {
    const signal = {
      id: 'SCOPE-01',
      source: 'static_analysis',
      category: 'application',
      derivation: 'Scope coverage analysis detected open blind spot with no input file.',
      evidence: [],
      confidence: 'high',
      provenance: {
        source: 'rule_engine',
        run_id: 'run-2026-06-03T10-00-00',
        cassette_hit: false,
        assessed_at: '2026-06-03T10:00:00Z',
      },
    };
    const parsed = SignalSchema.parse(signal);
    expect(parsed.provenance?.source).toBe('rule_engine');
  });
});
