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

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, afterEach } from 'vitest';
import { buildLlmLegsSummary, BUNDLE_VERSION } from './support-bundle.js';

describe('buildLlmLegsSummary', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeWorkspace(pubModel: Record<string, unknown>): string {
    tmpDir = mkdtempSync(join(tmpdir(), 'swao-sbt-'));
    const runDir = join(tmpDir, 'llm-assessments', 'swao', '20261007T120000Z', 'comparison');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'publication-model.json'), JSON.stringify(pubModel), 'utf-8');
    return tmpDir;
  }

  it('returns empty object when llm-assessments/swao/ does not exist', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'swao-sbt-'));
    expect(buildLlmLegsSummary(tmpDir)).toEqual({});
  });

  it('surfaces partial:true and missing_fields for a leg with quality-content absent', () => {
    // #2963: gemma leg has quality-content + quality-structural + cost in final.partial
    // because all calls DNF'd and quality-content is unimplemented (follow-on #1421).
    const ws = makeWorkspace({
      schema_version: '1.0', kind: 'swao', app_id: 'test-app',
      legs: [{ id: 'gemma-4-31b-it', connector: 'preme', model: 'gemma-4-31b-it', primary: false }],
      run: { run_ts: '20261007T120000Z', duration_minutes: 2.3, legs: {
        'gemma-4-31b-it': { cost_usd: 0, duration_minutes: 2.3, call_count: 4 },
      } },
      final: {
        score: { 'gemma-4-31b-it': 62.5 },
        rank:  { 'gemma-4-31b-it': 1 },
        weights: { quality: 0.5, reliability: 0.2, performance: 0.15, cost: 0.15, security: 0.1 },
        partial: { 'gemma-4-31b-it': ['quality-content', 'quality-structural', 'cost'] },
      },
    });
    const result = buildLlmLegsSummary(ws) as Record<string, unknown>;
    const app = result['test-app'] as Record<string, unknown>;
    expect(app['last_run_ts']).toBe('20261007T120000Z');
    expect(app['leg_count']).toBe(1);
    const legs = app['legs'] as Array<Record<string, unknown>>;
    expect(legs).toHaveLength(1);
    const leg = legs[0];
    expect(leg['connector']).toBe('preme');
    expect(leg['model']).toBe('gemma-4-31b-it');
    expect(leg['partial']).toBe(true);
    expect(leg['missing_fields']).toEqual(['quality-content', 'quality-structural', 'cost']);
    expect(leg['status']).toBe('complete');
    expect(leg['call_count']).toBe(4);
  });

  it('surfaces partial:false and empty missing_fields for a fully-scored leg', () => {
    const ws = makeWorkspace({
      schema_version: '1.0', kind: 'swao', app_id: 'test-app',
      legs: [{ id: 'gpt-4o', connector: 'azure-oai', model: 'gpt-4o', primary: true }],
      run: { run_ts: '20261007T120000Z', duration_minutes: 1.8, legs: {
        'gpt-4o': { cost_usd: 0.034, duration_minutes: 1.8, call_count: 10 },
      } },
      final: {
        score: { 'gpt-4o': 81.0 },
        rank:  { 'gpt-4o': 1 },
        weights: { quality: 0.5, reliability: 0.2, performance: 0.15, cost: 0.15, security: 0.1 },
        partial: {},
      },
    });
    const result = buildLlmLegsSummary(ws) as Record<string, unknown>;
    const leg = (((result['test-app'] as Record<string, unknown>)['legs']) as Array<Record<string, unknown>>)[0];
    expect(leg['partial']).toBe(false);
    expect(leg['missing_fields']).toEqual([]);
    expect(leg['call_count']).toBe(10);
  });

  it('is at bundle version 2.3', () => {
    expect(BUNDLE_VERSION).toBe('2.3');
  });

  it('marks status no-calls when call_count is 0', () => {
    const ws = makeWorkspace({
      schema_version: '1.0', kind: 'swao', app_id: 'test-app',
      legs: [{ id: 'failed-leg', connector: 'preme', model: 'some-model', primary: false }],
      run: { run_ts: '20261007T120000Z', duration_minutes: 0, legs: {
        'failed-leg': { cost_usd: 0, duration_minutes: 0, call_count: 0 },
      } },
      final: {
        score: {}, rank: {}, weights: {},
        partial: { 'failed-leg': ['quality-content', 'quality-structural', 'reliability', 'performance', 'cost', 'security'] },
      },
    });
    const result = buildLlmLegsSummary(ws) as Record<string, unknown>;
    const leg = (((result['test-app'] as Record<string, unknown>)['legs']) as Array<Record<string, unknown>>)[0];
    expect(leg['status']).toBe('no-calls');
    expect(leg['partial']).toBe(true);
  });

  it('sets score_complete:true when no partial fields and score_complete:false when partial fields exist', () => {
    const ws = makeWorkspace({
      schema_version: '1.0', kind: 'swao', app_id: 'test-app',
      legs: [
        { id: 'full-leg', connector: 'azure', model: 'gpt-4o', primary: true },
        { id: 'partial-leg', connector: 'preme', model: 'gemma', primary: false },
      ],
      run: { run_ts: '20261007T120000Z', duration_minutes: 2, legs: {
        'full-leg': { cost_usd: 0.01, duration_minutes: 1, call_count: 5 },
        'partial-leg': { cost_usd: 0, duration_minutes: 1, call_count: 3 },
      } },
      final: {
        score: { 'full-leg': 80, 'partial-leg': 60 },
        rank: { 'full-leg': 1, 'partial-leg': 2 },
        weights: {},
        partial: { 'partial-leg': ['quality-content', 'cost'] },
      },
    });
    const result = buildLlmLegsSummary(ws) as Record<string, unknown>;
    const legs = ((result['test-app'] as Record<string, unknown>)['legs']) as Array<Record<string, unknown>>;
    const fullLeg = legs.find(l => l['model'] === 'gpt-4o');
    const partialLeg = legs.find(l => l['model'] === 'gemma');
    expect(fullLeg?.['score_complete']).toBe(true);
    expect(fullLeg?.['partial']).toBe(false);
    expect(partialLeg?.['score_complete']).toBe(false);
    expect(partialLeg?.['partial']).toBe(true);
    expect(partialLeg?.['missing_fields']).toEqual(['quality-content', 'cost']);
  });

  it('keeps the most recent run when multiple timestamps exist for the same app', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'swao-sbt-'));
    const older = join(tmpDir, 'llm-assessments', 'swao', '20261006T100000Z', 'comparison');
    const newer = join(tmpDir, 'llm-assessments', 'swao', '20261007T150000Z', 'comparison');
    mkdirSync(older, { recursive: true });
    mkdirSync(newer, { recursive: true });

    const makePub = (model: string, ts: string) => ({
      schema_version: '1.0', kind: 'swao', app_id: 'my-app',
      legs: [{ id: model, connector: 'test', model, primary: true }],
      run: { run_ts: ts, duration_minutes: 1, legs: { [model]: { cost_usd: 0, duration_minutes: 1, call_count: 5 } } },
      final: { score: { [model]: 70 }, rank: { [model]: 1 }, weights: {}, partial: {} },
    });

    writeFileSync(join(older, 'publication-model.json'), JSON.stringify(makePub('model-v1', '20261006T100000Z')), 'utf-8');
    writeFileSync(join(newer, 'publication-model.json'), JSON.stringify(makePub('model-v2', '20261007T150000Z')), 'utf-8');

    const result = buildLlmLegsSummary(tmpDir) as Record<string, unknown>;
    const app = result['my-app'] as Record<string, unknown>;
    expect(app['last_run_ts']).toBe('20261007T150000Z');
    const legs = app['legs'] as Array<Record<string, unknown>>;
    expect(legs[0]['model']).toBe('model-v2');
  });
});
