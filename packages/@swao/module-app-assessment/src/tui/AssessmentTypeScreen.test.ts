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

/**
 * Drift guard for AssessmentTypeScreen (#0624, re-cut #1419 sprint-114).
 *
 * Design 092 s2: the menu lists the three REAL assessment surfaces only
 * (Application, Landing Zone Catalog, LLM Assessment for SWAO). The former
 * coming-soon placeholder entries were removed by operator direction; their
 * type values stay canonical in KNOWN_ASSESSMENT_TYPES for the router's
 * coming-soon guard and historical manifests. This guard pins BOTH facts:
 * the menu contract (3 entries, all runnable) and the type-system contract
 * (every menu type is canonical; removed types are still known).
 */
import { describe, it, expect } from 'vitest';
import { KNOWN_ASSESSMENT_TYPES } from '@swao/core';
import { ASSESSMENT_TYPE_ENTRIES } from './AssessmentTypeScreen.js';

describe('AssessmentTypeScreen -- drift guard (#1419)', () => {
  it('lists exactly the three real surfaces, in order', () => {
    expect(ASSESSMENT_TYPE_ENTRIES.map(e => e.type)).toEqual([
      'application',
      'landing-zone-catalog',
      'llm',
    ]);
  });

  it('every menu entry is a canonical assessment type', () => {
    for (const entry of ASSESSMENT_TYPE_ENTRIES) {
      expect(KNOWN_ASSESSMENT_TYPES).toContain(entry.type);
    }
  });

  it('removed placeholder types stay canonical (router + history compat)', () => {
    for (const t of ['audit', 'landing-zone-customer', 'hybrid']) {
      expect(KNOWN_ASSESSMENT_TYPES).toContain(t);
      expect(ASSESSMENT_TYPE_ENTRIES.find(e => e.type === t)).toBeUndefined();
    }
  });

  it('every entry is available (no coming-soon rows in the menu)', () => {
    for (const entry of ASSESSMENT_TYPE_ENTRIES) {
      expect(entry.available, `${entry.type} must be runnable`).toBe(true);
      expect(entry.comingSoonTitle).toBeUndefined();
    }
  });

  it('all entries have unique numeric keys 1..N', () => {
    const keys = ASSESSMENT_TYPE_ENTRIES.map(e => e.key);
    const expected = ASSESSMENT_TYPE_ENTRIES.map((_, i) => String(i + 1));
    expect(keys).toEqual(expected);
  });

  it('the llm entry names its preconditions in the guidance text', () => {
    const entry = ASSESSMENT_TYPE_ENTRIES.find(e => e.type === 'llm');
    expect(entry?.what).toMatch(/completed Application Assessment/);
    expect(entry?.what).toMatch(/Consultant and Enterprise/);
    expect(entry?.detail).toContain('--type llm');
  });
});
