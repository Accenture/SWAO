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

// #4190 SET-01 (Design 125 sections 4, 6, 7): setup vocabulary and the
// additive workspace fields workspace.assessment_types / workspace.setup_state.

import { describe, it, expect } from 'vitest';
import {
  SETUP_ASSESSMENT_TYPES,
  SETUP_SCOPES,
  SETUP_ASSESSMENT_TYPE_LABELS,
  isSetupTypeAvailable,
  setupTypeToAssessmentType,
  parseSetupAssessmentType,
  branchStateFromHealth,
  setupBranchStateNote,
  SetupBranchRecordSchema,
} from './setup-types.js';
import { SwaoYmlSchema } from './swao-yml.js';

describe('setup vocabulary (#4190)', () => {
  it('lists the five branch types in the Design 125 section 5 order, plus generic as a scope', () => {
    expect([...SETUP_ASSESSMENT_TYPES]).toEqual(['application', 'service', 'lz-catalog', 'lz-live', 'llm']);
    expect(SETUP_SCOPES[0]).toBe('generic');
    expect(SETUP_SCOPES).toHaveLength(6);
    for (const t of SETUP_ASSESSMENT_TYPES) expect(SETUP_ASSESSMENT_TYPE_LABELS[t]).toMatch(/Assessment$/);
  });

  it('maps every branch to an assess type and parses both id forms', () => {
    expect(SETUP_ASSESSMENT_TYPES.map(setupTypeToAssessmentType)).toEqual(['application', 'service', 'landing-zone-catalog', 'landing-zone-live', 'llm']);
    for (const t of SETUP_ASSESSMENT_TYPES) {
      expect(parseSetupAssessmentType(t)).toBe(t);
      expect(parseSetupAssessmentType(setupTypeToAssessmentType(t))).toBe(t);
    }
    expect(parseSetupAssessmentType(' LZ-Live ')).toBe('lz-live');
    expect(parseSetupAssessmentType('audit')).toBeUndefined();
  });

  it('gates the LZ live branch to Consultant (012 F-136) and leaves the rest on Community', () => {
    expect(isSetupTypeAvailable('lz-live', 'community')).toBe(false);
    expect(isSetupTypeAvailable('lz-live', 'consultant')).toBe(true);
    expect(isSetupTypeAvailable('lz-live', 'enterprise')).toBe(true);
    for (const t of ['application', 'service', 'lz-catalog', 'llm'] as const) expect(isSetupTypeAvailable(t, 'community')).toBe(true);
  });

  it('derives the branch state from the scoped health result', () => {
    expect(branchStateFromHealth(undefined)).toBe('not-set-up');
    expect(branchStateFromHealth({ probeCount: 0, failCount: 0, warnCount: 0 })).toBe('not-set-up');
    expect(branchStateFromHealth({ probeCount: 8, failCount: 0, warnCount: 2 })).toBe('ready');
    expect(branchStateFromHealth({ probeCount: 8, failCount: 1, warnCount: 0 })).toBe('needs-attention');
  });
});

describe('workspace.assessment_types and workspace.setup_state in .swao.yml (#4190, #4191)', () => {
  it('accepts the new fields next to run_retention', () => {
    const r = SwaoYmlSchema.safeParse({
      workspace: {
        run_retention: { keep_latest: 5 },
        assessment_types: ['application', 'lz-live'],
        setup_state: { application: { state: 'ready', checked_at: '2026-11-08T20:00:00Z', fail_count: 0, warn_count: 1 } },
      },
    });
    expect(r.success).toBe(true);
  });

  it('refuses an unknown type and an unknown state', () => {
    expect(SwaoYmlSchema.safeParse({ workspace: { assessment_types: ['audit'] } }).success).toBe(false);
    expect(SwaoYmlSchema.safeParse({ workspace: { setup_state: { llm: { state: 'done' } } } }).success).toBe(false);
  });

  it('accepts the section 5.7 default fields: assessment.llm, service_portfolio, landing_zones[].frameworks', () => {
    const r = SwaoYmlSchema.safeParse({
      assessment: { llm: { candidates: [{ connector: 'anthropic' }, { connector: 'ollama', model: 'llama3' }], subject_app: 'sovereign-health' } },
      service_portfolio: { source: 'intake.xlsx', intake: 'wsp/inputs/portfolio/intake.xlsx', mapping: 'mapping.yml', cluster_threshold: 0.8 },
      landing_zones: [{ id: 'otc-prod', provider: 'otc', scopes: [{ id: 'platform', kind: 'platform', auth: 'iam-password-token' }], frameworks: ['CLIENT_LZ_POLICY_BASELINE'] }],
    });
    expect(r.success, JSON.stringify(r.success ? '' : r.error.issues)).toBe(true);
    // A half-finished setup (one candidate) keeps the file valid; more than five is refused.
    expect(SwaoYmlSchema.safeParse({ assessment: { llm: { candidates: [{ connector: 'anthropic' }] } } }).success).toBe(true);
    expect(SwaoYmlSchema.safeParse({ assessment: { llm: { candidates: Array.from({ length: 6 }, () => ({ connector: 'a' })) } } }).success).toBe(false);
  });

  it('a service workspace written by swao service init (mapping: null) still parses', () => {
    const r = SwaoYmlSchema.safeParse({ service_portfolio: { source: 'intake.xlsx', mapping: null, workbook_sha256: 'abc' } });
    expect(r.success, JSON.stringify(r.success ? '' : r.error.issues)).toBe(true);
    expect(SwaoYmlSchema.safeParse({ service_portfolio: { source: null, intake: null } }).success).toBe(true);
  });

  it('a workspace without the fields still parses (additive)', () => {
    expect(SwaoYmlSchema.safeParse({ workspace: { run_retention: { keep_latest: 3 } } }).success).toBe(true);
    expect(SwaoYmlSchema.safeParse({}).success).toBe(true);
  });
});

describe('setup_state cause (#4282, D-8)', () => {
  it('the record carries the missing and waiting Ready items', () => {
    const r = SetupBranchRecordSchema.parse({ state: 'needs-attention', fail_count: 0, warn_count: 1, missing: ['Source app-a'], waiting: ['Intake workbook'] });
    expect(r.missing).toEqual(['Source app-a']);
    expect(r.waiting).toEqual(['Intake workbook']);
  });

  it('the state note names the cause; ready and not set up stay one word', () => {
    expect(setupBranchStateNote(undefined)).toBe('not set up');
    expect(setupBranchStateNote({ state: 'ready', fail_count: 0 })).toBe('ready');
    expect(setupBranchStateNote({ state: 'needs-attention', fail_count: 0, waiting: ['Intake workbook'] })).toBe('needs attention: waiting for Intake workbook');
    expect(setupBranchStateNote({ state: 'needs-attention', fail_count: 2, missing: ['LZ targets'] })).toBe('needs attention: 2 failed check(s); missing LZ targets');
    expect(setupBranchStateNote({ state: 'needs-attention' })).toBe('needs attention');
  });
});
