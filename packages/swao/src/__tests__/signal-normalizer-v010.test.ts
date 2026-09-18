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
import { normalizeSignal, SIGNAL_SCHEMA_HINT } from '../passes/signal-normalizer.js';

describe('SIGNAL_SCHEMA_HINT v0.10 (#0173)', () => {
  it('mentions outcome with the four-value enum', () => {
    expect(SIGNAL_SCHEMA_HINT).toMatch(/positive/);
    expect(SIGNAL_SCHEMA_HINT).toMatch(/negative/);
    expect(SIGNAL_SCHEMA_HINT).toMatch(/neutral/);
    expect(SIGNAL_SCHEMA_HINT).toMatch(/indeterminate/);
  });

  it('mentions false_positive_considered + false_positive_ruled_out', () => {
    expect(SIGNAL_SCHEMA_HINT).toMatch(/false_positive_considered/);
    expect(SIGNAL_SCHEMA_HINT).toMatch(/false_positive_ruled_out/);
  });

  it('mentions derivation_chain', () => {
    expect(SIGNAL_SCHEMA_HINT).toMatch(/derivation_chain/);
  });

  it('mentions the >= 20 character constraint on derivation', () => {
    expect(SIGNAL_SCHEMA_HINT).toMatch(/>= 20/);
  });

  it('includes at least two example FP-ruled-out narratives', () => {
    expect((SIGNAL_SCHEMA_HINT.match(/considered.*ruled out/gi) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('normalizeSignal v0.10 fields (#0173)', () => {
  const llmRaw = {
    id: 'CRYPTO-04',
    source: 'static_analysis',
    category: 'application',
    severity: 'high',
    confidence: 'high',
    derivation: 'AES-256-GCM encryption verified via crypto.createCipheriv match in src/db/encryption.ts:42',
    evidence: ['src/db/encryption.ts:42'],
  };

  it('passes through outcome when the LLM emits it explicitly', () => {
    const s = normalizeSignal({ ...llmRaw, outcome: 'positive' });
    expect(s.outcome).toBe('positive');
  });

  it('lowercases outcome before mapping', () => {
    const s = normalizeSignal({ ...llmRaw, outcome: 'NEGATIVE' });
    expect(s.outcome).toBe('negative');
  });

  it('maps common synonyms (pass / ok / fail / risk / unknown)', () => {
    expect(normalizeSignal({ ...llmRaw, outcome: 'pass' }).outcome).toBe('positive');
    expect(normalizeSignal({ ...llmRaw, outcome: 'ok' }).outcome).toBe('positive');
    expect(normalizeSignal({ ...llmRaw, outcome: 'fail' }).outcome).toBe('negative');
    expect(normalizeSignal({ ...llmRaw, outcome: 'risk' }).outcome).toBe('negative');
    expect(normalizeSignal({ ...llmRaw, outcome: 'unknown' }).outcome).toBe('indeterminate');
  });

  it('drops outcome when the value is not a recognised synonym', () => {
    const s = normalizeSignal({ ...llmRaw, outcome: 'whatever' });
    expect(s.outcome).toBeUndefined();
  });

  it('does NOT default outcome when the LLM omits it (the assess.ts enricher does that)', () => {
    const s = normalizeSignal(llmRaw);
    expect(s.outcome).toBeUndefined();
  });

  it('passes through false_positive_considered as boolean', () => {
    const s = normalizeSignal({ ...llmRaw, false_positive_considered: true });
    expect(s.false_positive_considered).toBe(true);
  });

  it('passes through false_positive_ruled_out when the string is >= 20 chars', () => {
    const text = 'considered alternative; ruled out for clear factual reason citing PKG-04';
    const s = normalizeSignal({ ...llmRaw, false_positive_considered: true, false_positive_ruled_out: text });
    expect(s.false_positive_ruled_out).toBe(text);
  });

  it('drops false_positive_ruled_out when the string is shorter than 20 chars', () => {
    const s = normalizeSignal({
      ...llmRaw,
      false_positive_considered: true,
      false_positive_ruled_out: 'too short',
    });
    expect(s.false_positive_ruled_out).toBeUndefined();
  });

  it('passes through derivation_chain as an array of strings', () => {
    const s = normalizeSignal({ ...llmRaw, derivation_chain: ['PKG-04', 'STATE-01'] });
    expect(s.derivation_chain).toEqual(['PKG-04', 'STATE-01']);
  });

  it('drops empty derivation_chain', () => {
    const s = normalizeSignal({ ...llmRaw, derivation_chain: [] });
    expect(s.derivation_chain).toBeUndefined();
  });

  it('coerces non-string ids in derivation_chain to strings', () => {
    const s = normalizeSignal({ ...llmRaw, derivation_chain: ['PKG-04', 42] });
    expect(s.derivation_chain).toEqual(['PKG-04', '42']);
  });

  it('preserves the v0.9 field set unchanged when v0.10 fields are absent', () => {
    const s = normalizeSignal(llmRaw);
    expect(s.id).toBe('CRYPTO-04');
    expect(s.severity).toBe('high');
    expect(s.derivation).toMatch(/AES-256-GCM/);
    expect(s.evidence).toEqual(['src/db/encryption.ts:42']);
  });
});

describe('normalizeSignal derivation min(20) padding (#0173)', () => {
  it('pads a too-short derivation with an explicit annotation rather than failing', () => {
    const s = normalizeSignal({
      id: 'X-01',
      source: 'llm_inference',
      category: 'application',
      confidence: 'low',
      derivation: 'short',
      evidence: ['x'],
    });
    expect(s.derivation.length).toBeGreaterThanOrEqual(20);
    expect(s.derivation).toMatch(/normaliser/);
  });

  it('leaves an already-long derivation alone', () => {
    const long = 'AES-256-GCM verified through crypto.createCipheriv match in src/db.ts:42';
    const s = normalizeSignal({
      id: 'X-02',
      source: 'static_analysis',
      category: 'application',
      confidence: 'high',
      derivation: long,
      evidence: ['src/db.ts:42'],
    });
    expect(s.derivation).toBe(long);
  });
});
