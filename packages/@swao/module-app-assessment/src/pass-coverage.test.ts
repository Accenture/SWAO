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

// #3419 / #3436: one default pass list, passes not executed and degraded passes.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CANONICAL_DEFAULT_PASS_KEYS, DEFAULT_PASS_NAMES, PassNotRunEntrySchema, type PassResult } from '@swao/core';
import {
  DEFAULT_PASS_KEYS,
  TUI_DEFAULT_PASS_KEYS,
  TUI_OPT_IN_PASS_KEYS,
  INDIVIDUAL_PASS_KEYS,
  OPT_IN_PASS_KEYS,
  sortPassesCanonical,
  expandPassProfile,
  filterByPassProfile,
  applySkipLlm,
  normaliseRequestedPasses,
  assessOrchestrator,
} from './orchestrator.js';
import { passesNotScheduled, classifyPassOutcome, passIdentity, passDegradedLogEvent } from './pass-coverage.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function result(name: string, status: 'complete' | 'not_applicable', assessment: Record<string, unknown>): Pick<PassResult, 'pass' | 'assessment'> {
  return { pass: { id: 11, name, status, iter: 1 }, assessment };
}

describe('one default pass list (#3419)', () => {
  it('the orchestrator default is the core list and runs the secret scan, not the full malware scan', () => {
    expect([...DEFAULT_PASS_KEYS]).toEqual([...CANONICAL_DEFAULT_PASS_KEYS]);
    expect(DEFAULT_PASS_KEYS).toContain('secrets');
    expect(DEFAULT_PASS_KEYS).not.toContain('malware');
    expect(OPT_IN_PASS_KEYS.has('malware')).toBe(true);
  });

  it('every default key resolves to a pass whose header name matches the core name list (MCP)', () => {
    expect(DEFAULT_PASS_KEYS.map((k) => passIdentity(k).name)).toEqual([...DEFAULT_PASS_NAMES]);
    for (const k of DEFAULT_PASS_KEYS) {
      if (k === 'comp' || k === 'dynamic') continue; // host-dispatched
      expect(assessOrchestrator.getPass(k), k).toBeDefined();
    }
    expect(assessOrchestrator.getPass('secrets')?.num).toBe('14');
  });

  it('the TUI pre-selection is the default list without the TUI opt-in passes', () => {
    expect([...TUI_DEFAULT_PASS_KEYS]).toEqual(DEFAULT_PASS_KEYS.filter((k) => !TUI_OPT_IN_PASS_KEYS.has(k)));
    expect(TUI_DEFAULT_PASS_KEYS).toContain('secrets');
    expect(TUI_DEFAULT_PASS_KEYS).not.toContain('dynamic');
  });

  for (const rel of ['tui/AssessScreen.tsx', 'tui/assess/AppAssessmentScreen.tsx']) {
    it(`${rel} derives its defaults from the orchestrator and offers every default pass`, () => {
      const src = readFileSync(join(HERE, rel), 'utf-8');
      expect(src).not.toMatch(/['"]inv,state,data/);
      expect(src).toMatch(/DEFAULT_PASS_KEYS: string\[\] = \[\.\.\.TUI_DEFAULT_PASS_KEYS\]/);
      expect(src).toMatch(/ALL_PASSES = ORCHESTRATOR_DEFAULT_PASS_KEYS\.join/);
      const block = src.slice(src.indexOf('const PASS_OPTIONS'), src.indexOf('];', src.indexOf('const PASS_OPTIONS')));
      const values = [...block.matchAll(/value: '([a-z]+)'/g)].map((m) => m[1]!).filter((v) => v !== 'all');
      for (const v of values) expect(INDIVIDUAL_PASS_KEYS.has(v), v).toBe(true);
      for (const k of DEFAULT_PASS_KEYS) expect(values, k).toContain(k);
    });
  }
});

describe('secret scan supersession (#3419)', () => {
  it('the full malware scan replaces the default secret scan', () => {
    expect(sortPassesCanonical([...DEFAULT_PASS_KEYS, 'malware'])).not.toContain('secrets');
    expect(sortPassesCanonical([...DEFAULT_PASS_KEYS, 'malware'])).toContain('malware');
    expect(sortPassesCanonical(['secrets', 'inv'])).toEqual(['inv', 'secrets']);
  });

  it('the security-focus lens (MAL) runs the full scan once', () => {
    const exp = expandPassProfile(['security-focus'], [{ id: 'security-focus', passes: ['SBOM', 'CRYPTO', 'EGR', 'MAL'] }]);
    const run = filterByPassProfile([...DEFAULT_PASS_KEYS], exp, false);
    expect(run).toEqual(['sbom', 'egr', 'crypto', 'malware']);
    expect(passesNotScheduled({ requested: DEFAULT_PASS_KEYS, scheduled: run, skipLlm: false }).some((e) => e.pass === 'secrets')).toBe(false);
  });
});

describe('passesNotScheduled (#3419)', () => {
  it('Client case: a stored pass_profile without the secret scan reports it as not in the profile', () => {
    const profile = ['inv', 'state', 'data', 'ctx', 'sbom', 'tf', 'egr', 'crypto', 'synth', 'comp', 'blocks'];
    const exp = expandPassProfile(profile, []);
    const scheduled = filterByPassProfile([...DEFAULT_PASS_KEYS], exp, false);
    const notRun = passesNotScheduled({ requested: DEFAULT_PASS_KEYS, scheduled, skipLlm: false });
    // #3405: a stored profile without `quality` leaves Pass 26 out as well.
    expect(notRun.map((e) => e.pass)).toEqual(['quality', 'dynamic', 'scope', 'secrets']);
    const secrets = notRun.find((e) => e.pass === 'secrets')!;
    expect(secrets).toMatchObject({ reason: 'not_in_profile', num: '14', name: 'secret_scan' });
    for (const e of notRun) expect(PassNotRunEntrySchema.safeParse(e).success).toBe(true);
  });

  it('--skip-llm: ctx, comp and blocks are skipped by the flag', () => {
    const scheduled = applySkipLlm(DEFAULT_PASS_KEYS.join(',')).split(',');
    const notRun = passesNotScheduled({ requested: DEFAULT_PASS_KEYS, scheduled, skipLlm: true });
    expect(notRun.map((e) => [e.pass, e.reason])).toEqual([
      ['ctx', 'skipped_by_flag'], ['comp', 'skipped_by_flag'], ['blocks', 'skipped_by_flag'],
    ]);
  });

  it('an explicit --passes list reports the default passes it leaves out', () => {
    const requested = normaliseRequestedPasses(['inv', 'sbom']).passes;
    const notRun = passesNotScheduled({ requested, scheduled: requested, skipLlm: false });
    expect(notRun.map((e) => e.pass)).toEqual(DEFAULT_PASS_KEYS.filter((k) => k !== 'inv' && k !== 'sbom'));
    expect(notRun.every((e) => e.reason === 'not_in_profile')).toBe(true);
  });

  it('service mode: a pass the service plan skipped is not applicable, with the plan reason', () => {
    const notRun = passesNotScheduled({
      requested: DEFAULT_PASS_KEYS,
      scheduled: DEFAULT_PASS_KEYS.filter((k) => k !== 'inv'),
      skipLlm: false,
      serviceSkipped: [{ key: 'inv', reason: 'no source tree to inventory in a service assessment' }],
    });
    expect(notRun).toEqual([{ pass: 'inv', num: '01', name: 'inventory', reason: 'not_applicable', detail: 'no source tree to inventory in a service assessment' }]);
  });

  it('a full default run reports nothing', () => {
    expect(passesNotScheduled({ requested: DEFAULT_PASS_KEYS, scheduled: DEFAULT_PASS_KEYS, skipLlm: false })).toEqual([]);
  });
});

describe('classifyPassOutcome (#3419 / #3436)', () => {
  it('#3436: an exhausted compliance LLM call is degraded (not complete) with the affected frameworks', () => {
    const out = classifyPassOutcome('comp', result('compliance_evaluation', 'complete', {
      degraded: true, degraded_reason: 'llm_unavailable', degraded_regimes: [{ id: 'gdpr', controls_without_verdict: 6 }],
    }), { skipLlm: false });
    expect(out.degraded).toEqual({ pass: 'comp', num: '11', name: 'compliance_evaluation', reason: 'llm_unavailable', regimes: [{ id: 'gdpr', controls_without_verdict: 6 }] });
    expect(out.notRun).toBeUndefined();
  });

  it('#3436: the degraded pass yields an assessment.pass.degraded warn event saying compliance was not fully evaluated', () => {
    const out = classifyPassOutcome('comp', result('compliance_evaluation', 'complete', {
      degraded: true, degraded_reason: 'llm_unavailable', degraded_regimes: [{ id: 'gdpr', controls_without_verdict: 6 }],
    }), { skipLlm: false });
    const ev = passDegradedLogEvent(out.degraded!, 'run-p11-comp');
    expect(ev.event).toBe('assessment.pass.degraded');
    expect(ev.level).toBe('warn');
    expect(ev.message).toBe('Pass 11 compliance_evaluation compliance not fully evaluated (llm_unavailable): gdpr (6)');
    expect(ev.context).toEqual({ pass: 'comp', num: '11', name: 'compliance_evaluation', reason: 'llm_unavailable', regimes: [{ id: 'gdpr', controls_without_verdict: 6 }], pass_id: 'run-p11-comp' });
  });

  it('a complete pass without markers is neither degraded nor not run', () => {
    expect(classifyPassOutcome('comp', result('compliance_evaluation', 'complete', {}), { skipLlm: false })).toEqual({});
  });

  it('no provider: llm_unavailable; with --skip-llm: skipped_by_flag', () => {
    const r = result('data_classification', 'not_applicable', { skipped: true, skipped_reason: 'no_llm_provider' });
    expect(classifyPassOutcome('data', r, { skipLlm: false }).notRun?.reason).toBe('llm_unavailable');
    expect(classifyPassOutcome('data', r, { skipLlm: true }).notRun?.reason).toBe('skipped_by_flag');
  });

  it('connectivity failure, provider error and an unusable answer are llm_failed', () => {
    for (const reason of ['connectivity_failure', 'provider_error', 'invalid_llm_response']) {
      expect(classifyPassOutcome('synth', result('synthesis', 'not_applicable', { skipped_reason: reason }), { skipLlm: false }).notRun)
        .toMatchObject({ reason: 'llm_failed', detail: reason });
    }
  });

  it('Pass 14 without Gitleaks is tool_missing, also when other tools of the full scan ran', () => {
    const missing = classifyPassOutcome('secrets', result('secret_scan', 'not_applicable', { malware_scan_status: 'skipped_tools_missing', missing_tools: ['gitleaks'] }), { skipLlm: false });
    expect(missing.notRun).toMatchObject({ pass: 'secrets', reason: 'tool_missing', detail: 'not installed: gitleaks' });
    const partial = classifyPassOutcome('malware', result('malware_scanning', 'complete', { malware_scan_status: 'complete', missing_tools: ['gitleaks'] }), { skipLlm: false });
    expect(partial.notRun?.reason).toBe('tool_missing');
    const disabled = classifyPassOutcome('secrets', result('secret_scan', 'not_applicable', { malware_scan_status: 'skipped_all_disabled' }), { skipLlm: false });
    expect(disabled.notRun?.reason).toBe('disabled_by_config');
  });
});
