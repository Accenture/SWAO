// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Framework module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { PassContext } from '@swao/core';
import {
  runCompliancePass,
  evaluate,
  complianceEvaluator,
  frameworkModuleManifest,
  validateCitedRefs,
} from './compliance-evaluator.js';

/** A PassContext with no `llm` and an empty workspace (the LLM-optional + no-regimes condition). */
function noLlmCtx(): PassContext {
  const dir = mkdtempSync(join(tmpdir(), 'swao-framework-'));
  return {
    appId: 'fixture',
    sourcePath: dir,
    workspacePath: dir,
    iter: 1,
    assessedAt: '2026-06-24',
  };
}

describe('runCompliancePass (rich host path) -- #0570 move preserved behaviour', () => {
  it('returns not_applicable with a skipped_reason when no regimes are configured', async () => {
    const result = await runCompliancePass(noLlmCtx());
    expect(result.pass.id).toBe(11);
    expect(result.pass.name).toBe('compliance_evaluation');
    expect(result.pass.signal_prefix).toBe('COMP');
    expect(result.pass.status).toBe('not_applicable');
    expect(result.signals).toHaveLength(0);
    expect(typeof result.assessment['skipped_reason']).toBe('string');
    expect(result.assessment['regimes']).toEqual([]);
    expect(result.assessment['regimes_evaluated']).toBe(0);
  });

  // Regression #0748: loadSelectedRegimes was reading yml?.regimes (top-level,
  // never populated) instead of yml?.assessment?.regimes_active (the actual field
  // written by regime-picker.ts). This caused only GDPR to appear in HTML reports
  // even when all 4 bundled frameworks were selected.
  it('reads ALL regimes from assessment.regimes_active in .swao.yml', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-framework-'));
    writeFileSync(join(dir, '.swao.yml'), [
      'assessment:',
      '  regimes_active:',
      '    - GDPR',
      '    - AI_10_PILLARS',
    ].join('\n') + '\n', 'utf-8');
    const ctx = {
      appId: 'fixture',
      sourcePath: dir,
      workspacePath: dir,
      iter: 1,
      assessedAt: '2026-06-24',
    };
    const result = await runCompliancePass(ctx as Parameters<typeof runCompliancePass>[0]);
    // With the old bug (reading yml?.regimes which is always undefined):
    //   result.pass.status === 'not_applicable' + signals === []
    // With the fix (reading yml?.assessment?.regimes_active):
    //   result.pass.status === 'complete' + one signal per missing catalog
    //   skipped_reason is 'no_llm_provider' (not 'No regimes configured')
    expect(result.pass.status).toBe('complete');
    expect(result.signals.length).toBe(2); // one missing-catalog signal per regime
    // Each missing-catalog signal includes the regime ID in its derivation.
    const derivations = result.signals.map(s => s.derivation);
    expect(derivations.some(d => d.includes('GDPR'))).toBe(true);
    expect(derivations.some(d => d.includes('AI_10_PILLARS'))).toBe(true);
  });
});

// Minimal fake controls.yaml body for the PROBE_1282 test regime.
function minimalControlsYaml(id: string): string {
  return [
    'regime_meta:',
    `  id: ${id}`,
    `  name: Test regime for ${id}`,
    '  version: "1.0"',
    '  authority: SWAO Test Suite',
    '  catalogue_version: 1.0.0',
    'controls:',
    `  - id: ${id}-01`,
    `    title: Test control for ${id}`,
    '    description: Probe control verifying signal loading in runCompliancePass.',
    '    severity_default: medium',
  ].join('\n') + '\n';
}

// Workspace structure expected by resolveWorkspaceRoot: <root>/apps/<app>.
// workspaceRoot = join(workspacePath, '..', '..').
// Catalogs live at <root>/wsp/inputs/catalogs/community/<REGIME_ID>/controls.yaml.
function buildTestWorkspace(regimeId: string, signalDerivation: string): {
  workspacePath: string;
  passesDir: string;
} {
  const wsRoot = mkdtempSync(join(tmpdir(), 'swao-comp-1282-'));
  const workspacePath = join(wsRoot, 'apps', 'test-app');
  const passesDir = join(workspacePath, 'wsp', 'runs', '2026-07-27T00-00-00', 'passes');
  const catalogDir = join(wsRoot, 'wsp', 'inputs', 'catalogs', 'community', regimeId);

  mkdirSync(passesDir, { recursive: true });
  mkdirSync(catalogDir, { recursive: true });

  writeFileSync(join(workspacePath, '.swao.yml'), [
    'assessment:',
    '  regimes_active:',
    `    - ${regimeId}`,
  ].join('\n') + '\n', 'utf-8');

  // Signal YAML in passesDir -- the marker we assert appears in the LLM prompt.
  writeFileSync(join(passesDir, '01-inv.yaml'), [
    'pass:',
    '  id: 1',
    '  name: inventory',
    'signals:',
    '  - id: INV-01',
    '    severity: informational',
    `    derivation: "${signalDerivation}"`,
  ].join('\n') + '\n', 'utf-8');

  // Minimal community catalog so loadRegimeCatalog returns a result and the LLM is called.
  writeFileSync(join(catalogDir, 'controls.yaml'), minimalControlsYaml(regimeId));

  return { workspacePath, passesDir };
}

describe('runCompliancePass ctx.passesDir override -- #1282', () => {
  it('reads signals from ctx.passesDir even when wsp/latest.txt is absent (first-ever run)', async () => {
    const { workspacePath, passesDir } = buildTestWorkspace(
      'PROBE_1282',
      'PROBE_1282_MARKER: inventory detected dummy runtime',
    );

    const capturedPrompts: string[] = [];
    const ctx: PassContext = {
      appId: 'test-app',
      sourcePath: workspacePath,
      workspacePath,
      iter: 1,
      assessedAt: '2026-07-27',
      passesDir,
      llm: {
        complete: async (prompt: string) => {
          capturedPrompts.push(prompt);
          return '{}'; // invalid JSON -- controls fall back to UNKNOWN, but prompt was sent
        },
      },
    };

    const result = await runCompliancePass(ctx);

    // Pass must complete evaluation (regime + catalog found, not skipped for missing regimes).
    expect(result.pass.id).toBe(11);
    expect(result.pass.status).toBe('complete');

    // The LLM must have been called -- proves catalog was found and evaluation proceeded.
    expect(capturedPrompts.length).toBeGreaterThan(0);

    // AC #1282: signals from ctx.passesDir reach the LLM prompt.
    // Before the fix, latest.txt absent -> empty signals -> prompt says "(no signals emitted in this run)".
    // After the fix, ctx.passesDir is used -> INV-01 signal loaded -> prompt contains the marker.
    const fullPrompt = capturedPrompts.join('\n');
    expect(fullPrompt).toContain('PROBE_1282_MARKER');
  });

  it('falls back safely when ctx.passesDir is absent and latest.txt is missing', async () => {
    const { workspacePath } = buildTestWorkspace(
      'PROBE_1282B',
      'PROBE_1282_MARKER: should not appear without passesDir',
    );

    const capturedPrompts: string[] = [];
    const ctx: PassContext = {
      appId: 'test-app',
      sourcePath: workspacePath,
      workspacePath,
      iter: 1,
      assessedAt: '2026-07-27',
      // passesDir intentionally absent: resolvePassesDir reads latest.txt (absent here)
      // so it falls back to empty wsp/passes/ dir -> zero signals loaded.
      llm: {
        complete: async (prompt: string) => {
          capturedPrompts.push(prompt);
          return '{}';
        },
      },
    };

    const result = await runCompliancePass(ctx);
    expect(result.pass.status).toBe('complete');
    expect(capturedPrompts.length).toBeGreaterThan(0);
    // Without passesDir, no signals loaded -> prompt reports "(no signals emitted in this run)".
    const fullPrompt = capturedPrompts.join('\n');
    expect(fullPrompt).not.toContain('PROBE_1282_MARKER');
    expect(fullPrompt).toContain('(no signals emitted in this run)');
  });
});

describe('evaluate (lean ComplianceEvaluatorContribution) -- #0570', () => {
  it('returns empty results for no frameworks', async () => {
    const out = await evaluate([], [], { assessmentType: 'application' });
    expect(out).toEqual({ frameworks: [], results: [] });
  });

  it('returns a framework entry with no controls when its catalogue is absent', async () => {
    const out = await evaluate([], ['GDPR'], { assessmentType: 'application' });
    expect(out.frameworks).toEqual(['GDPR']);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toEqual({ framework: 'GDPR', controls: [] });
  });

  it('does not throw when no llm and no catalogsDir are supplied', async () => {
    await expect(evaluate([], ['GDPR', 'NIST_SP_800_66R2'], { assessmentType: 'audit' })).resolves.toBeTruthy();
  });
});

describe('validateCitedRefs -- B-02 hallucination guard (#0604)', () => {
  afterEach(() => vi.restoreAllMocks());

  const valid = new Set(['INV-01', 'CTX-02', 'DATA-03']);

  it('keeps refs that name a real signal', () => {
    const out = validateCitedRefs(['INV-01', 'CTX-02'], valid, 'signal_refs', 'GDPR', 'GDPR_Art_5');
    expect(out).toEqual(['INV-01', 'CTX-02']);
  });

  it('drops hallucinated refs that are not in the signal set', () => {
    const out = validateCitedRefs(['INV-01', 'FAKE-99'], valid, 'signal_refs', 'GDPR', 'GDPR_Art_5');
    expect(out).toEqual(['INV-01']);
    expect(out).not.toContain('FAKE-99');
  });

  it('LOGS dropped signal_refs (count + ids + control context) instead of silently stripping', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    validateCitedRefs(['FAKE-1', 'FAKE-2', 'INV-01'], valid, 'signal_refs', 'GDPR', 'GDPR_Art_5');
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0]?.[0] as string;
    expect(msg).toMatch(/GDPR\/GDPR_Art_5/);
    expect(msg).toMatch(/dropped 2 hallucinated signal_refs/);
    expect(msg).toMatch(/FAKE-1/);
    expect(msg).toMatch(/FAKE-2/);
  });

  it('validates evidence_ids against the same signal set (previously unchecked)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = validateCitedRefs(['DATA-03', 'BOGUS-7'], valid, 'evidence_ids', 'NIST', 'AC-2');
    expect(out).toEqual(['DATA-03']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/dropped 1 hallucinated evidence_ids/);
  });

  it('does not warn when every ref is valid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    validateCitedRefs(['INV-01'], valid, 'signal_refs', 'GDPR', 'GDPR_Art_5');
    expect(warn).not.toHaveBeenCalled();
  });

  it('handles an empty ref list without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(validateCitedRefs([], valid, 'evidence_ids', 'GDPR', 'GDPR_Art_5')).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resolveEvidenceIds (via runCompliancePass) -- #1507
// ---------------------------------------------------------------------------

// Workspace variant that writes signals with evidence arrays.
function buildWorkspaceWithEvidenceSignals(regimeId: string, signalYaml: string): {
  workspacePath: string;
  passesDir: string;
} {
  const wsRoot = mkdtempSync(join(tmpdir(), 'swao-comp-1507-'));
  const workspacePath = join(wsRoot, 'apps', 'test-app');
  const passesDir = join(workspacePath, 'wsp', 'runs', '2026-08-09T00-00-00', 'passes');
  const catalogDir = join(wsRoot, 'wsp', 'inputs', 'catalogs', 'community', regimeId);

  mkdirSync(passesDir, { recursive: true });
  mkdirSync(catalogDir, { recursive: true });

  writeFileSync(join(workspacePath, '.swao.yml'), [
    'assessment:',
    '  regimes_active:',
    `    - ${regimeId}`,
  ].join('\n') + '\n', 'utf-8');

  writeFileSync(join(passesDir, '01-inv.yaml'), signalYaml, 'utf-8');
  writeFileSync(join(catalogDir, 'controls.yaml'), minimalControlsYaml(regimeId));

  return { workspacePath, passesDir };
}

describe('resolveEvidenceIds via runCompliancePass -- #1507', () => {
  it('populates evidence_ids from signal.evidence when LLM cites a signal with file evidence', async () => {
    const { workspacePath, passesDir } = buildWorkspaceWithEvidenceSignals('PROBE_1507A', [
      'pass:',
      '  id: 1',
      '  name: inventory',
      'signals:',
      '  - id: INV-14',
      '    severity: informational',
      '    derivation: "block storage detected"',
      '    evidence:',
      '      - terraform-prod.tfstate',
      '      - terraform-staging.tfstate',
    ].join('\n') + '\n');

    const ctx: PassContext = {
      appId: 'test-app',
      sourcePath: workspacePath,
      workspacePath,
      iter: 1,
      assessedAt: '2026-08-09',
      passesDir,
      llm: {
        complete: async () =>
          JSON.stringify({
            controls: [{
              id: 'PROBE_1507A-01',
              outcome: 'SATISFIED',
              rationale: 'Block storage found.',
              signal_refs: ['INV-14'],
              remediation: '',
            }],
          }),
      },
    };

    const result = await runCompliancePass(ctx);
    const control = result.assessment['regimes']?.[0]?.controls?.[0];
    expect(control?.evidence_ids).toEqual(['terraform-prod.tfstate', 'terraform-staging.tfstate']);
  });

  it('uses llm-inference sentinel when cited signal carries no file evidence', async () => {
    const { workspacePath, passesDir } = buildWorkspaceWithEvidenceSignals('PROBE_1507B', [
      'pass:',
      '  id: 1',
      '  name: inventory',
      'signals:',
      '  - id: INV-01',
      '    severity: informational',
      '    derivation: "language detected"',
      '    evidence: []',
    ].join('\n') + '\n');

    const ctx: PassContext = {
      appId: 'test-app',
      sourcePath: workspacePath,
      workspacePath,
      iter: 1,
      assessedAt: '2026-08-09',
      passesDir,
      llm: {
        complete: async () =>
          JSON.stringify({
            controls: [{
              id: 'PROBE_1507B-01',
              outcome: 'SATISFIED',
              rationale: 'Language confirms requirement.',
              signal_refs: ['INV-01'],
              remediation: '',
            }],
          }),
      },
    };

    const result = await runCompliancePass(ctx);
    const control = result.assessment['regimes']?.[0]?.controls?.[0];
    expect(control?.evidence_ids).toEqual(['llm-inference']);
  });

  it('returns empty evidence_ids for UNKNOWN/N_A with no signal_refs', async () => {
    const { workspacePath, passesDir } = buildWorkspaceWithEvidenceSignals('PROBE_1507C', [
      'pass:',
      '  id: 1',
      '  name: inventory',
      'signals:',
      '  - id: INV-01',
      '    severity: informational',
      '    derivation: "placeholder"',
      '    evidence: []',
    ].join('\n') + '\n');

    const ctx: PassContext = {
      appId: 'test-app',
      sourcePath: workspacePath,
      workspacePath,
      iter: 1,
      assessedAt: '2026-08-09',
      passesDir,
      llm: {
        complete: async () =>
          JSON.stringify({
            controls: [{
              id: 'PROBE_1507C-01',
              outcome: 'UNKNOWN',
              rationale: 'No signals address this control.',
              signal_refs: [],
              remediation: '',
            }],
          }),
      },
    };

    const result = await runCompliancePass(ctx);
    const control = result.assessment['regimes']?.[0]?.controls?.[0];
    expect(control?.evidence_ids).toEqual([]);
  });

  it('unions evidence from multiple cited signals', async () => {
    const { workspacePath, passesDir } = buildWorkspaceWithEvidenceSignals('PROBE_1507D', [
      'pass:',
      '  id: 1',
      '  name: inventory',
      'signals:',
      '  - id: INV-14',
      '    severity: informational',
      '    derivation: "block storage"',
      '    evidence:',
      '      - terraform-prod.tfstate',
      '  - id: INV-15',
      '    severity: informational',
      '    derivation: "secrets management"',
      '    evidence:',
      '      - terraform-prod.tfstate',
      '      - terraform-staging.tfstate',
    ].join('\n') + '\n');

    const ctx: PassContext = {
      appId: 'test-app',
      sourcePath: workspacePath,
      workspacePath,
      iter: 1,
      assessedAt: '2026-08-09',
      passesDir,
      llm: {
        complete: async () =>
          JSON.stringify({
            controls: [{
              id: 'PROBE_1507D-01',
              outcome: 'SATISFIED',
              rationale: 'Storage and secrets both present.',
              signal_refs: ['INV-14', 'INV-15'],
              remediation: '',
            }],
          }),
      },
    };

    const result = await runCompliancePass(ctx);
    const control = result.assessment['regimes']?.[0]?.controls?.[0];
    const ids = control?.evidence_ids ?? [];
    expect(ids).toContain('terraform-prod.tfstate');
    expect(ids).toContain('terraform-staging.tfstate');
    // Deduplicated -- prod tfstate appears in both signals but only once in result.
    expect(ids.filter((e: string) => e === 'terraform-prod.tfstate')).toHaveLength(1);
  });
});

describe('frameworkModuleManifest -- #0570', () => {
  it('declares the compliance evaluator contribution', () => {
    expect(frameworkModuleManifest.id).toBe('@swao/module-framework');
    expect(frameworkModuleManifest.tier).toBe('community');
    expect(frameworkModuleManifest.contributions.complianceEvaluators).toHaveLength(1);
    expect(frameworkModuleManifest.contributions.complianceEvaluators?.[0]).toBe(complianceEvaluator);
    expect(typeof complianceEvaluator.evaluate).toBe('function');
  });
});
