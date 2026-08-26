// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Manifest, comparability key and identical-input guards (#1423).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeComparabilityKey,
  hashDirectory,
  EMPTY_TREE_HASH,
  buildManifest,
  verifyLegInvariants,
  LlmAssessmentManifestSchema,
} from './llm-run-manifest.js';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-llm-manifest-'));
});

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const comparabilityBase = {
  kind: 'swao' as const,
  appId: 'sovereign-health',
  sourceHash: 'a'.repeat(64),
  inputsHash: 'b'.repeat(64),
  passSuiteVersion: 'v14',
};

describe('comparability key (#1423, 092 s7.1)', () => {
  it('is deterministic and 64 hex chars', () => {
    const k1 = computeComparabilityKey(comparabilityBase);
    const k2 = computeComparabilityKey({ ...comparabilityBase });
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when ANY tuple member changes', () => {
    const base = computeComparabilityKey(comparabilityBase);
    expect(computeComparabilityKey({ ...comparabilityBase, appId: 'other-app' })).not.toBe(base);
    expect(computeComparabilityKey({ ...comparabilityBase, sourceHash: 'c'.repeat(64) })).not.toBe(base);
    expect(computeComparabilityKey({ ...comparabilityBase, inputsHash: 'c'.repeat(64) })).not.toBe(base);
    expect(computeComparabilityKey({ ...comparabilityBase, passSuiteVersion: 'v15' })).not.toBe(base);
    expect(computeComparabilityKey({ ...comparabilityBase, kind: 'use-case' })).not.toBe(base);
    expect(computeComparabilityKey({ ...comparabilityBase, metricCatalogueVersion: '9.9.9' })).not.toBe(base);
  });
});

describe('hashDirectory (#1423)', () => {
  it('is stable, content-sensitive, and order-independent of creation', () => {
    const d1 = join(tmp, 'tree1');
    mkdirSync(join(d1, 'sub'), { recursive: true });
    writeFileSync(join(d1, 'b.txt'), 'bravo');
    writeFileSync(join(d1, 'a.txt'), 'alpha');
    writeFileSync(join(d1, 'sub', 'c.txt'), 'charlie');

    const d2 = join(tmp, 'tree2');
    mkdirSync(join(d2, 'sub'), { recursive: true });
    writeFileSync(join(d2, 'sub', 'c.txt'), 'charlie');
    writeFileSync(join(d2, 'a.txt'), 'alpha');
    writeFileSync(join(d2, 'b.txt'), 'bravo');

    expect(hashDirectory(d1)).toBe(hashDirectory(d2));

    writeFileSync(join(d2, 'b.txt'), 'CHANGED');
    expect(hashDirectory(d1)).not.toBe(hashDirectory(d2));
  });

  it('missing and empty directories hash to the stable empty-tree value', () => {
    expect(hashDirectory(join(tmp, 'does-not-exist'))).toBe(EMPTY_TREE_HASH);
    const empty = join(tmp, 'empty');
    mkdirSync(empty, { recursive: true });
    expect(hashDirectory(empty)).toBe(EMPTY_TREE_HASH);
  });

  it('respects the ignore filter', () => {
    const d = join(tmp, 'tree3');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'keep.txt'), 'keep');
    const before = hashDirectory(d);
    writeFileSync(join(d, 'noise.log'), 'noise');
    expect(hashDirectory(d, (rel) => rel.endsWith('.log'))).toBe(before);
  });
});

describe('buildManifest + guards (#1423)', () => {
  const legs = [
    { id: 'or--claude', connector: 'openrouter', model: 'anthropic/claude-sonnet-4', connector_sha256: 'c1', primary: true },
    { id: 'or--deepseek', connector: 'openrouter', model: 'deepseek/deepseek-v4-flash', connector_sha256: 'c1', primary: false },
  ];

  it('builds a schema-valid manifest with the comparability key embedded', () => {
    const m = buildManifest({
      kind: 'swao', appId: 'sovereign-health', created: '2026-08-06T12:00:00Z',
      execution: 'serial', repeat: 1, analysisMode: 'head-to-head', legs,
      sourceHash: comparabilityBase.sourceHash, inputsHash: comparabilityBase.inputsHash,
      passSuiteVersion: 'v14', weights: { quality: 0.5, reliability: 0.2, performance: 0.15, cost: 0.15 },
      inputsChanged: false,
    });
    expect(() => LlmAssessmentManifestSchema.parse(m)).not.toThrow();
    expect(m.comparability_key).toBe(computeComparabilityKey(comparabilityBase));
    expect(m.metric_catalogue_version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('rejects manifests with fewer than 2 or more than 5 legs', () => {
    expect(() => buildManifest({
      kind: 'swao', appId: 'x', created: 'now', execution: 'serial', repeat: 1,
      analysisMode: 'field', legs: [legs[0]!],
      sourceHash: 's', inputsHash: 'i', passSuiteVersion: 'v', weights: {}, inputsChanged: false,
    })).toThrow();
  });

  it('verifyLegInvariants: clean run has no violations', () => {
    const ref = {
      sourceHash: 'S', inputsHash: 'I', passSuiteVersion: 'v14',
      connectorSha256ByLeg: { 'or--claude': 'c1', 'or--deepseek': 'c1' },
    };
    const v = verifyLegInvariants(ref, [
      { legId: 'or--claude', sourceHash: 'S', inputsHash: 'I', connectorSha256: 'c1', passSuiteVersion: 'v14' },
      { legId: 'or--deepseek', sourceHash: 'S', inputsHash: 'I', connectorSha256: 'c1', passSuiteVersion: 'v14' },
    ]);
    expect(v).toEqual([]);
  });

  it('verifyLegInvariants: each drifting invariant is named per leg', () => {
    const ref = {
      sourceHash: 'S', inputsHash: 'I', passSuiteVersion: 'v14',
      connectorSha256ByLeg: { 'or--claude': 'c1' },
    };
    const v = verifyLegInvariants(ref, [
      { legId: 'or--claude', sourceHash: 'S2', inputsHash: 'I', connectorSha256: 'c2', passSuiteVersion: 'v15' },
    ]);
    expect(v.map((x) => x.guard).sort()).toEqual(['connector', 'pass-suite', 'source']);
    for (const violation of v) expect(violation.message).toContain('or--claude');
  });
});
