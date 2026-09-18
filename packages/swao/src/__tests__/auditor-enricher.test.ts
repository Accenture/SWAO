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
import {
  enrichSignal,
  enrichSignals,
  inferOutcomeFromSeverity,
} from '../passes/auditor-enricher.js';
import type { Signal } from '../schema/index.js';

const ASSESSED_AT = '2026-05-09T13:00:00Z';

const baseSignal: Signal = {
  id: 'INV-01',
  source: 'static_analysis',
  category: 'application',
  derivation: 'IBM MQ JMS dependency detected via pom.xml line 42; tier-1 blocker',
  evidence: ['pom.xml:42'],
  confidence: 'high',
};

describe('inferOutcomeFromSeverity (#0172)', () => {
  it('positive severity infers outcome=positive', () => {
    expect(inferOutcomeFromSeverity('positive')).toBe('positive');
  });

  it('informational severity infers outcome=neutral', () => {
    expect(inferOutcomeFromSeverity('informational')).toBe('neutral');
  });

  it('critical/high/medium/low severity infer outcome=negative', () => {
    expect(inferOutcomeFromSeverity('critical')).toBe('negative');
    expect(inferOutcomeFromSeverity('high')).toBe('negative');
    expect(inferOutcomeFromSeverity('medium')).toBe('negative');
    expect(inferOutcomeFromSeverity('low')).toBe('negative');
  });

  it('missing severity infers outcome=indeterminate', () => {
    expect(inferOutcomeFromSeverity(undefined)).toBe('indeterminate');
  });
});

describe('enrichSignal (#0172)', () => {
  it('adds rule_engine assessor and timestamp when missing', () => {
    const enriched = enrichSignal(baseSignal, { assessor: 'rule_engine', assessedAt: ASSESSED_AT });
    expect(enriched.assessor).toBe('rule_engine');
    expect(enriched.assessed_at).toBe(ASSESSED_AT);
  });

  it('infers outcome from severity', () => {
    const enriched = enrichSignal({ ...baseSignal, severity: 'high' }, { assessor: 'rule_engine', assessedAt: ASSESSED_AT });
    expect(enriched.outcome).toBe('negative');
  });

  it('does not overwrite an explicit outcome', () => {
    const enriched = enrichSignal(
      { ...baseSignal, severity: 'high', outcome: 'positive' },
      { assessor: 'rule_engine', assessedAt: ASSESSED_AT },
    );
    expect(enriched.outcome).toBe('positive');
  });

  it('does not overwrite an explicit assessor', () => {
    const enriched = enrichSignal(
      { ...baseSignal, assessor: 'human_override' },
      { assessor: 'rule_engine', assessedAt: ASSESSED_AT },
    );
    expect(enriched.assessor).toBe('human_override');
  });

  it('does not overwrite an explicit assessed_at', () => {
    const explicitTs = '2026-04-01T00:00:00Z';
    const enriched = enrichSignal(
      { ...baseSignal, assessed_at: explicitTs },
      { assessor: 'rule_engine', assessedAt: ASSESSED_AT },
    );
    expect(enriched.assessed_at).toBe(explicitTs);
  });

  it('does NOT default false_positive_* fields (the doctor probe warns when missing)', () => {
    const enriched = enrichSignal(
      { ...baseSignal, severity: 'high' },
      { assessor: 'rule_engine', assessedAt: ASSESSED_AT },
    );
    expect(enriched.false_positive_considered).toBeUndefined();
    expect(enriched.false_positive_ruled_out).toBeUndefined();
  });

  it('does NOT default derivation_chain', () => {
    const enriched = enrichSignal(baseSignal, { assessor: 'rule_engine', assessedAt: ASSESSED_AT });
    expect(enriched.derivation_chain).toBeUndefined();
  });

  it('llm assessor is applied for LLM-backed passes', () => {
    const enriched = enrichSignal(baseSignal, { assessor: 'llm', assessedAt: ASSESSED_AT });
    expect(enriched.assessor).toBe('llm');
  });
});

describe('enrichSignals (#0172)', () => {
  it('enriches an array of signals in order', () => {
    const signals: Signal[] = [
      { ...baseSignal, id: 'INV-01', severity: 'high' },
      { ...baseSignal, id: 'INV-02', severity: 'positive' },
      { ...baseSignal, id: 'INV-03', severity: 'informational' },
      { ...baseSignal, id: 'INV-04' },
    ];
    const enriched = enrichSignals(signals, { assessor: 'rule_engine', assessedAt: ASSESSED_AT });
    expect(enriched.map((s) => s.outcome)).toEqual(['negative', 'positive', 'neutral', 'indeterminate']);
    for (const s of enriched) {
      expect(s.assessor).toBe('rule_engine');
      expect(s.assessed_at).toBe(ASSESSED_AT);
    }
  });

  it('returns a new array (does not mutate input)', () => {
    const signals: Signal[] = [{ ...baseSignal, severity: 'high' }];
    const enriched = enrichSignals(signals, { assessor: 'rule_engine', assessedAt: ASSESSED_AT });
    expect(enriched).not.toBe(signals);
    expect(signals[0]?.outcome).toBeUndefined();
    expect(enriched[0]?.outcome).toBe('negative');
  });
});
