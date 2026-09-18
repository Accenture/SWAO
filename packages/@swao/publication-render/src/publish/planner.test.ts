// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Publication renderer
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
  derivePlanForLzRun,
  derivePlanForHubRun,
  resolvePublicationTitle,
  PUBLICATION_TITLE_MAP,
} from './planner.js';
import type { PublicationModel } from './model.js';

// ---------------------------------------------------------------------------
// Minimal LZ-catalog PublicationModel fixture
// ---------------------------------------------------------------------------

const BASE_META = {
  app_id: 'test-lz',
  app_name: 'Test LZ',
  assessed_at: '2026-07-04T10:00:00Z',
  run_id: '2026-07-04T10-00-00',
  swao_version: '0.5.9',
  engagement: { engagement_name: 'Test Engagement', partnership_lead: 'Lead' },
  licensee: 'Accenture',
  tier: 'community' as const,
  publication_config: {
    classification_band: 'Internal',
    logo_name: 'SWAO',
    logo_sub: 'LZ',
    footer_note: '',
    engagement_lead_label: 'Lead',
    primary_contact_label: 'Primary',
    secondary_contact_label: 'Secondary',
  },
};

const LZ_FIXTURE: PublicationModel = {
  contract_version: '1.1',
  meta: BASE_META,
  summary: { seven_r_label: 'Assess', coverage_score: 0.6, signal_counts: {}, blocker_count: 1, top_findings: [] },
  signals: [],
  compliance: [],
  risk_register: [],
  runbook: [],
  evidence: [],
  input_files: [],
  tags: {},
  lzr: {
    overall: 'Conditionally Ready',
    blockers: 1,
    checks: [
      { id: 'LZ-01', label: 's3: available', result: 'pass', signal_ref: 's3' },
      { id: 'LZ-02', label: 'rds: not offered', result: 'fail', signal_ref: 'rds' },
    ],
    catalog: { provider: 'aws', region: 'eu-central-1', overall_verdict: 'READY_WITH_CHANGES' },
  },
  run_history: [],
  assessment_type: 'landing-zone-catalog',
  block_profile: 'lz-catalog',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('derivePlanForLzRun (#0790)', () => {
  it('returns the canonical 4 mandatory blocks', () => {
    const plan = derivePlanForLzRun(LZ_FIXTURE);
    const names = plan.map(b => b.name);
    expect(names).toContain('lzr-catalog-header');
    expect(names).toContain('lzr-catalog-verdict');
    expect(names).toContain('lz-catalog-services');
    expect(names).toContain('lzr-catalog-findings');
  });

  it('includes remediation block when findings are present', () => {
    const plan = derivePlanForLzRun(LZ_FIXTURE);
    expect(plan.map(b => b.name)).toContain('lzr-catalog-remediation');
  });

  it('omits remediation block when all checks pass', () => {
    const allPass: PublicationModel = {
      ...LZ_FIXTURE,
      lzr: {
        ...LZ_FIXTURE.lzr,
        checks: [{ id: 'LZ-01', label: 's3: ok', result: 'pass', signal_ref: 's3' }],
      },
    };
    const plan = derivePlanForLzRun(allPass);
    expect(plan.map(b => b.name)).not.toContain('lzr-catalog-remediation');
  });

  it('omits finops block when no cost data present', () => {
    const plan = derivePlanForLzRun(LZ_FIXTURE);
    expect(plan.map(b => b.name)).not.toContain('lzr-catalog-finops');
  });

  it('canonical block order matches Design 068 §6', () => {
    const plan = derivePlanForLzRun(LZ_FIXTURE);
    const names = plan.map(b => b.name);
    expect(names[0]).toBe('lzr-catalog-header');
    expect(names[1]).toBe('lzr-catalog-verdict');
    expect(names[2]).toBe('lz-catalog-services');
    expect(names[3]).toBe('lzr-catalog-findings');
  });
});

describe('derivePlanForHubRun (#0794)', () => {
  it('returns the 4 canonical hub blocks', () => {
    const plan = derivePlanForHubRun(LZ_FIXTURE);
    const names = plan.map(b => b.name);
    expect(names).toContain('hub.header');
    expect(names).toContain('hub.app_list');
    expect(names).toContain('hub.cross_links');
    expect(names).toContain('hub.workspace_summary');
  });

  it('returns hub blocks in canonical order (Design 068 §9)', () => {
    const plan = derivePlanForHubRun(LZ_FIXTURE);
    const names = plan.map(b => b.name);
    expect(names[0]).toBe('hub.header');
    expect(names[1]).toBe('hub.app_list');
    expect(names[2]).toBe('hub.cross_links');
    expect(names[3]).toBe('hub.workspace_summary');
  });

  it('returns exactly 4 blocks (no conditional extras)', () => {
    const plan = derivePlanForHubRun(LZ_FIXTURE);
    expect(plan).toHaveLength(4);
  });
});

describe('resolvePublicationTitle (#0790)', () => {
  it('returns correct title for landing-zone-catalog', () => {
    expect(resolvePublicationTitle('landing-zone-catalog')).toBe('Landing Zone Assessment Report');
  });

  it('returns correct title for application', () => {
    expect(resolvePublicationTitle('application')).toBe('Application Assessment Report');
  });

  it('returns default for unknown types', () => {
    expect(resolvePublicationTitle('unknown-type')).toBe('SWAO Assessment');
  });

  it('returns default for undefined', () => {
    expect(resolvePublicationTitle(undefined)).toBe('SWAO Assessment');
  });

  it('PUBLICATION_TITLE_MAP includes all expected assessment types', () => {
    expect(PUBLICATION_TITLE_MAP['application']).toBeDefined();
    expect(PUBLICATION_TITLE_MAP['landing-zone-catalog']).toBeDefined();
    expect(PUBLICATION_TITLE_MAP['audit']).toBeDefined();
    expect(PUBLICATION_TITLE_MAP['llm']).toBeDefined();
  });
});
