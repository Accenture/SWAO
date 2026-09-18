// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expectTypeOf } from 'vitest';
import type {
  LicenceTier,
  AssessmentType,
  Signal,
  WspResult,
  PassContext,
  PassResult,
  PassRunner,
  WorkspaceContext,
  LicenceState,
  AssessmentRunContext,
  ComplianceEvaluatorContribution,
  ModuleContributions,
  SwaoModuleManifest,
  CoreContext,
} from '../plugin-types.js';

describe('@swao/core plugin-types', () => {
  it('LicenceTier includes the three expected values', () => {
    const community: LicenceTier = 'community';
    const consultant: LicenceTier = 'consultant';
    const enterprise: LicenceTier = 'enterprise';
    expectTypeOf(community).toMatchTypeOf<LicenceTier>();
    expectTypeOf(consultant).toMatchTypeOf<LicenceTier>();
    expectTypeOf(enterprise).toMatchTypeOf<LicenceTier>();
  });

  it('AssessmentType includes all expected values (including ADR-0051 landing-zone-catalog)', () => {
    const types: AssessmentType[] = [
      'application',
      'audit',
      'landing-zone',
      'landing-zone-catalog',
      'landing-zone-customer',
      'hybrid',
      'llm',
    ];
    expectTypeOf(types).toMatchTypeOf<AssessmentType[]>();
  });

  it('Signal has required fields', () => {
    const signal: Signal = {
      id: 'INV-01',
      source: 'static_analysis',
      category: 'application',
      derivation: 'Dependency scan found 3 critical vulnerabilities in the runtime.',
      evidence: ['package.json:12', 'yarn.lock:45'],
      confidence: 'high',
    };
    expectTypeOf(signal).toMatchTypeOf<Signal>();
  });

  it('WspResult has required fields', () => {
    const wsp: WspResult = {
      wsp_version: '0.12',
      generated_at: '2026-06-23T00:00:00Z',
      signals: [],
    };
    expectTypeOf(wsp).toMatchTypeOf<WspResult>();
  });

  it('PassRunner has the correct function signature', () => {
    const runner: PassRunner = async (_ctx: PassContext): Promise<PassResult> => ({
      pass: {
        id: 1,
        name: 'INV',
        signal_prefix: 'INV',
        status: 'complete',
        iter: 1,
        assessed_at: '2026-06-23T00:00:00Z',
      },
      signals: [],
      assessment: {},
    });
    expectTypeOf(runner).toMatchTypeOf<PassRunner>();
  });

  it('SwaoModuleManifest accepts a full module definition', () => {
    const manifest: SwaoModuleManifest = {
      id: '@swao/module-app-assessment',
      version: '0.1.0',
      tier: 'community',
      contributions: {},
    };
    expectTypeOf(manifest).toMatchTypeOf<SwaoModuleManifest>();
  });

  it('CoreContext has workspace, licence, complianceEvaluator, verbose fields', () => {
    expectTypeOf<CoreContext>().toHaveProperty('workspace');
    expectTypeOf<CoreContext>().toHaveProperty('licence');
    expectTypeOf<CoreContext>().toHaveProperty('complianceEvaluator');
    expectTypeOf<CoreContext>().toHaveProperty('verbose');
  });

  it('WorkspaceContext has required workspacePath field', () => {
    const ctx: WorkspaceContext = { workspacePath: '/home/user/.swao/apps/my-app' };
    expectTypeOf(ctx).toMatchTypeOf<WorkspaceContext>();
  });

  it('LicenceState has tier and fingerprint fields', () => {
    const state: LicenceState = {
      tier: 'community',
      fingerprint: 'abc123',
      firstRun: '2026-01-01T00:00:00Z',
      assessmentCount: 0,
      daysElapsed: 0,
    };
    expectTypeOf(state).toMatchTypeOf<LicenceState>();
  });

  it('ModuleContributions allows empty contributions', () => {
    const contributions: ModuleContributions = {};
    expectTypeOf(contributions).toMatchTypeOf<ModuleContributions>();
  });

  it('AssessmentRunContext includes core field', () => {
    expectTypeOf<AssessmentRunContext>().toHaveProperty('core');
  });

  it('ComplianceEvaluatorContribution has evaluate method', () => {
    expectTypeOf<ComplianceEvaluatorContribution>().toHaveProperty('evaluate');
  });
});
