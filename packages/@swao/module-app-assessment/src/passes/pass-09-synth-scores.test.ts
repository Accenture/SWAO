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

// #3431: SYNTH no longer asks the LLM for portability_score. The deterministic
// scores are shown as context, stamped over anything the model returns, and
// carried by every outcome of the pass (complete, no LLM, degraded).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { dump } from 'js-yaml';
import type { PassContext, LlmProvider } from '@swao/core';
import { buildSynthPrompt, runSynthPass } from './pass-09-synth.js';
import { computeMigrationScores } from '../scoring/migration-scores.js';

let dir: string;
let passesDir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'swao-3431-synth-'));
  passesDir = join(dir, 'wsp', 'runs', 'now', 'passes');
  mkdirSync(passesDir, { recursive: true });
  writeFileSync(join(passesDir, '01-inv.yaml'), dump({
    signals: [],
    assessment: { runtime_type: 'kubernetes', k8s_manifests: true, dockerfile: true, reference_catalogue_checks: { vendor_sdk: 'no_match' } },
  }));
  writeFileSync(join(passesDir, '06-tf.yaml'), dump({
    signals: [],
    assessment: { factor_scores: [{ factor: 'III (Config)', status: 'pass' }, { factor: 'IX (Disposability)', status: 'fail' }], iac_roots: 1 },
  }));
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function ctx(overrides: Partial<PassContext> = {}): PassContext {
  return { appId: 'score-app', sourcePath: dir, workspacePath: dir, iter: 1, assessedAt: '2026-10-24', passesDir, ...overrides };
}

describe('SYNTH prompt (#3431)', () => {
  it('does not ask for portability_score and shows the computed scores', () => {
    const scores = computeMigrationScores(passesDir);
    const prompt = buildSynthPrompt([], 'score-app', undefined, scores);
    expect(prompt).not.toContain('"portability_score": number');
    expect(prompt).not.toContain('portability_score is a decimal');
    expect(prompt).toContain('"portability_comment": "string"');
    expect(prompt).toContain('Do not emit portability_score or cloud_native_score');
    expect(prompt).toContain('--- DETERMINISTIC SCORES (computed by SWAO, not to be re-estimated) ---');
    expect(prompt).toContain('cloud_native_score: 0.50 (2 of 2 twelve-factor checks determinate, confidence high)');
    expect(prompt).toMatch(/portability_score: 1\.00 from vendor_lock, container, iac/);
  });

  it('omits the score section when no scores are passed', () => {
    expect(buildSynthPrompt([], 'score-app')).not.toContain('--- DETERMINISTIC SCORES');
  });
});

describe('runSynthPass deterministic scores (#3431)', () => {
  it('stamps the code values over an LLM portability_score and keeps a comment', async () => {
    const raw = JSON.stringify({
      signals: [],
      assessment: {
        seven_r_label: 'Replatform', modernization_position: 'migrate_stabilize', confidence: 'medium',
        portability_score: 0.6, cloud_native_score: 0.9, portability_comment: 'Kubernetes manifests make the workload portable.',
      },
    });
    const llm: LlmProvider = { complete: async () => raw };
    const result = await runSynthPass(ctx({ llm }));
    expect(result.pass.status).toBe('complete');
    expect(result.assessment['portability_score']).toBe(1);
    expect(result.assessment['cloud_native_score']).toBe(0.5);
    expect(result.assessment['portability_comment']).toBe('Kubernetes manifests make the workload portable.');
    expect(result.assessment['confidence']).toBe('medium'); // the 7R confidence is untouched
    expect((result.assessment['cloud_native'] as { factors_checked: number }).factors_checked).toBe(2);
    expect((result.assessment['portability'] as { components_used: string[] }).components_used).toEqual(['vendor_lock', 'container', 'iac']);
  });

  it('accepts an answer without portability_score (no longer a degrade reason)', async () => {
    const raw = JSON.stringify({ signals: [], assessment: { seven_r_label: 'Rehost', modernization_position: 'migrate_stabilize' } });
    const result = await runSynthPass(ctx({ llm: { complete: async () => raw } }));
    expect(result.pass.status).toBe('complete');
    expect(result.assessment['portability_score']).toBe(1);
  });

  it('carries the scores when no LLM is configured', async () => {
    const result = await runSynthPass(ctx());
    expect(result.pass.status).toBe('not_applicable');
    expect(result.assessment['cloud_native_score']).toBe(0.5);
    expect(result.assessment['portability_score']).toBe(1);
  });

  it('carries the scores when the LLM answer is unusable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await runSynthPass(ctx({ llm: { complete: async () => 'not json' } }));
    warn.mockRestore();
    expect(result.pass.status).toBe('not_applicable');
    expect(result.assessment['portability_score']).toBe(1);
  });
});
