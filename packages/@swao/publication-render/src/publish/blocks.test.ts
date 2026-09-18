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

/**
 * blocks.test.ts -- Publication block library tests
 * Design 041 §8.2 + issue #0430
 */

import { describe, it, expect } from 'vitest';
import { renderBlock, renderComplianceTileGrid, renderChartDonut, renderChartSeverityBar, swaoRagBadge, swaoProgressBar, swaoTooltip } from './blocks.js';
import type { FrameworkResult } from './model.js';
import type { PublicationModel } from './model.js';

// ---------------------------------------------------------------------------
// Minimal valid fixture
// ---------------------------------------------------------------------------

const FIXTURE: PublicationModel = {
  contract_version: '1.0',
  meta: {
    app_id: 'sovereign-health',
    app_name: 'Sovereign Health Platform',
    assessed_at: '2026-05-13T18:42:00Z',
    run_id: '2026-05-13T18-42-00',
    swao_version: '0.1.9',
    engagement: {
      engagement_name: 'ACME Cloud Transformation',
      partnership_lead: 'Engagement Lead',
    },
    licensee: 'Accenture',
    tier: 'community',
    publication_config: {
      classification_band: 'Accenture Internal, Confidential',
      logo_name: 'SWAO',
      logo_sub: 'Publication',
      footer_note: '',
      engagement_lead_label: 'Engagement Lead',
      primary_contact_label: 'Primary Contact',
      secondary_contact_label: 'Secondary Contact',
    },
  },
  summary: {
    seven_r_label: 'Re-platform',
    coverage_score: 0.62,
    signal_counts: { critical: 2, high: 2, medium: 2, low: 1, positive: 1 },
    blocker_count: 3,
    top_findings: [
      {
        id: 'DATA-01',
        pass: '3',
        severity: 'critical',
        outcome: 'negative',
        derivation: 'NHS PII without encryption.',
        evidence_refs: ['ev-prisma'],
        implies: ['LZR blocker'],
        tags: ['gdpr', 'pii'],
        anchor: 'signal-DATA-01',
      },
    ],
  },
  signals: [
    {
      id: 'DATA-01',
      pass: '3',
      severity: 'critical',
      outcome: 'negative',
      derivation: 'NHS PII without encryption.',
      evidence_refs: ['ev-prisma'],
      implies: ['LZR blocker'],
      tags: ['gdpr', 'pii'],
      anchor: 'signal-DATA-01',
    },
  ],
  compliance: [
    {
      framework_id: 'GDPR',
      framework_name: 'General Data Protection Regulation',
      fail_count: 1,
      partial_count: 0,
      pass_count: 0,
      controls: [
        {
          id: 'GDPR_Art_9',
          title: 'Special category data',
          rag_status: 'fail',
          worst_severity: 'critical',
          signals: ['DATA-01'],
          rationale: 'NHS health data.',
          article_text: 'Art.9 prohibition.',
          evidence: [],
          anchor: 'control-gdpr-gdpr-art-9',
        },
      ],
    },
  ],
  risk_register: [
    {
      risk_id: 'RR-001',
      trigger: 'NHS PII risk',
      category: 'GDPR',
      likelihood: 'high',
      impact: 'high',
      mitigation: 'Encrypt fields.',
      owner: 'DPO',
      evidence_refs: [],
      status: 'open',
      anchor: 'rr-rr-001',
    },
  ],
  runbook: [],
  evidence: [
    {
      id: 'ev-prisma',
      title: 'prisma/schema.prisma',
      type: 'derived',
      file: 'prisma/schema.prisma',
      date: '2026-05-13',
      pii_scrubbed: false,
      used_by: ['DATA-01'],
    },
  ],
  input_files: [],
  tags: {
    gdpr: [{ anchor: 'signal-DATA-01', type: 'signal', label: 'DATA-01' }],
  },
  lzr: { overall: 'Conditionally Ready', blockers: 2, checks: [] },
  run_history: [],
};

// ---------------------------------------------------------------------------
// All 22 block names
// ---------------------------------------------------------------------------

const ALL_BLOCKS = [
  'cover',
  'exec-summary',
  'signal-list',
  'compliance-regime',
  'risk-register',
  'evidence-gallery',
  'lzr-summary',
  'coverage-bar',
  'seven-r-card',
  'footer',
  'toc',
  'run-history',
  'tag-taxonomy',
  'glossary',
  'pass-explainer',
  'framework-explainer',
  'methodology',
  'persona-portal',
  'runbook',
  'delta-view',
  'portfolio-grid',
  'appendix-raw-wsp',
  'compliance-requirements',
  'assessment-scope',
  'lz-catalog-services',
  'lzr-catalog-header',
  'lzr-catalog-verdict',
  'lzr-catalog-findings',
  'lzr-catalog-remediation',
  'lzr-catalog-finops',
  'hub.header',
  'hub.app_list',
  'hub.cross_links',
  'hub.workspace_summary',
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderBlock', () => {
  it('cover contains the app name', () => {
    const html = renderBlock('cover', {}, FIXTURE);
    expect(html).toContain('Sovereign Health Platform');
  });

  it('signal-list uses initSwaoTable', () => {
    const html = renderBlock('signal-list', {}, FIXTURE);
    expect(html).toContain('initSwaoTable');
  });

  it('compliance-regime contains GDPR', () => {
    const html = renderBlock('compliance-regime', {}, FIXTURE);
    expect(html).toContain('GDPR');
  });

  it('risk-register contains the anchor rr-rr-001', () => {
    const html = renderBlock('risk-register', {}, FIXTURE);
    expect(html).toContain('rr-rr-001');
  });

  it('coverage-bar contains an svg element', () => {
    const html = renderBlock('coverage-bar', {}, FIXTURE);
    expect(html).toContain('<svg');
  });

  it('exec-summary contains DATA-01', () => {
    const html = renderBlock('exec-summary', {}, FIXTURE);
    expect(html).toContain('DATA-01');
  });

  it('all block names dispatch without throwing', () => {
    for (const name of ALL_BLOCKS) {
      expect(() => renderBlock(name, {}, FIXTURE)).not.toThrow();
    }
  });

  it('unknown block name returns a swao-block--skipped section and emits a warn (E2)', () => {
    const warns: string[] = [];
    const html = renderBlock('unknown-block', {}, FIXTURE, { warn: (m) => warns.push(m) });
    expect(html).toContain('swao-block--skipped');
    expect(warns[0]).toContain('Unknown block');
    expect(warns[0]).toContain('unknown-block');
  });

  describe('hub.* blocks (#0794)', () => {
    it('hub.header renders app name', () => {
      const html = renderBlock('hub.header', {}, FIXTURE);
      expect(html).toContain('Sovereign Health Platform');
      expect(html).toContain('Engagement Hub');
    });

    it('hub.app_list renders empty-state when no hub entries', () => {
      const html = renderBlock('hub.app_list', {}, FIXTURE);
      expect(html).toContain('Applications');
    });

    it('hub.cross_links is suppressed (removed from hub layout)', () => {
      const html = renderBlock('hub.cross_links', {}, FIXTURE);
      expect(html).toBe('');
    });

    it('hub.workspace_summary renders totals', () => {
      const html = renderBlock('hub.workspace_summary', {}, FIXTURE);
      expect(html).toContain('Workspace Summary');
      expect(html).toContain('Applications');
    });
  });

  describe('lzr-catalog-* blocks (#0790)', () => {
    const LZ_MODEL: PublicationModel = {
      ...FIXTURE,
      assessment_type: 'landing-zone-catalog',
      block_profile: 'lz-catalog',
      lzr: {
        overall: 'Conditionally Ready',
        blockers: 1,
        checks: [
          { id: 'LZ-01', label: 's3: available and provisioned.', result: 'pass', signal_ref: 's3' },
          { id: 'LZ-02', label: 'rds: not offered in eu-central-1.', result: 'fail', signal_ref: 'rds' },
          { id: 'LZ-03', label: 'lambda: available but not enabled.', result: 'not_applicable', signal_ref: 'lambda' },
        ],
        catalog: { provider: 'aws', region: 'eu-central-1', overall_verdict: 'READY_WITH_CHANGES', assessed_regions: ['eu-central-1'], service_count: 3 },
      },
    };

    it('lzr-catalog-header renders provider and region', () => {
      const html = renderBlock('lzr-catalog-header', {}, LZ_MODEL);
      expect(html).toContain('AWS');
      expect(html).toContain('eu-central-1');
    });

    it('lzr-catalog-header renders assessment date', () => {
      const html = renderBlock('lzr-catalog-header', {}, LZ_MODEL);
      expect(html).toContain('2026-05-13');
    });

    it('lzr-catalog-verdict renders score counts', () => {
      const html = renderBlock('lzr-catalog-verdict', {}, LZ_MODEL);
      expect(html).toContain('Sovereign');
      expect(html).toContain('Non-Sovereign');
      expect(html).toContain('Conditional');
    });

    it('lzr-catalog-findings renders non-pass services', () => {
      const html = renderBlock('lzr-catalog-findings', {}, LZ_MODEL);
      expect(html).toContain('rds');
      expect(html).toContain('lambda');
    });

    it('lzr-catalog-findings shows all checks including passing ones', () => {
      const allPass: PublicationModel = {
        ...LZ_MODEL,
        lzr: { ...LZ_MODEL.lzr, checks: [{ id: 'LZ-01', label: 's3: ok', result: 'pass', signal_ref: 's3' }] },
      };
      const html = renderBlock('lzr-catalog-findings', {}, allPass);
      // Shows total count, not a "no findings" message -- all checks are proof of assessment
      expect(html).toContain('1 service check(s)');
      expect(html).toContain('1 sovereign');
    });

    it('lzr-catalog-remediation renders actions for failing services', () => {
      const html = renderBlock('lzr-catalog-remediation', {}, LZ_MODEL);
      expect(html).toContain('rds');
    });

    it('lzr-catalog-finops renders Service Intelligence Matrix heading', () => {
      const html = renderBlock('lzr-catalog-finops', {}, LZ_MODEL);
      expect(html).toContain('Service Intelligence');
    });
  });

  describe('LZ Phase 3 audit-coverage rendering (#1380)', () => {
    // Multi-region model shaped like a real multi-target LZ-catalog run,
    // with the #1361-#1363 region qualifiers and #1360/#1372/#1373/#1375
    // service metadata sourced from the real bundled stackit seed.
    const MULTI_REGION_MODEL = {
      ...FIXTURE,
      assessment_type: 'landing-zone-catalog',
      block_profile: 'lz-catalog',
      lzr: {
        overall: 'Sovereignty Blocked',
        blockers: 1,
        checks: [
          {
            id: 'LZ-01', label: 'postgresql: offered in eu01.', result: 'pass',
            signal_ref: 'postgresql', provider: 'stackit', region: 'eu01',
            raw_verdict: 'SUPPORTED', signal_source: 'INV-10',
          },
          {
            id: 'LZ-02', label: 'postgresql: region blocked.', result: 'fail',
            signal_ref: 'postgresql', provider: 'aws', region: 'eu-central-1',
            raw_verdict: 'SOVEREIGNTY_GAP',
          },
        ],
        catalog: {
          provider: 'stackit', region: 'eu01', overall_verdict: 'READY',
          assessed_regions: ['eu01', 'eu-central-1'], service_count: 2,
        },
        regions: [
          {
            provider: 'stackit', region: 'eu01', overall_verdict: 'READY',
            sovereignty_statement: 'Region eu01 satisfies the sovereignty requirements derived from BSI_C5, GDPR.',
            service_count: 1, blockers: 0, service_labels: ['postgresql'],
            coverage_warning: 'service footprint incomplete -- 1 service(s) assessed, baseline requires compute/network/kms/storage',
            assessment_mode: 'full', sovereignty_active: true,
          },
          {
            provider: 'aws', region: 'eu-central-1', overall_verdict: 'SOVEREIGNTY_BLOCKED',
            sovereignty_statement: 'Region eu-central-1 FAILS sovereignty requirements.',
            service_count: 1, blockers: 1, service_labels: ['postgresql'],
            blocker_category: 'structural', assessment_mode: 'full', sovereignty_active: true,
          },
        ],
      },
    } as unknown as PublicationModel;

    it('header renders blocker_category badge, coverage_warning callout, and assessment_mode note', () => {
      const html = renderBlock('lzr-catalog-header', {}, MULTI_REGION_MODEL);
      expect(html).toContain('title="Blocker category"');
      expect(html).toContain('structural');
      expect(html).toContain('lz-coverage-warning');
      expect(html).toContain('service footprint incomplete');
      expect(html).toContain('Mode: full');
    });

    it('header appends provider catalogue details from controls/cloud-provider-catalogue.yaml', () => {
      const html = renderBlock('lzr-catalog-header', {}, MULTI_REGION_MODEL);
      expect(html).toContain('Provider Catalogue Details');
      expect(html).toContain('Certifications');
    });

    it('services matrix renders key custody, status, last_verified, and signal chips from the stackit seed', () => {
      const html = renderBlock('lz-catalog-services', {}, MULTI_REGION_MODEL);
      expect(html).toContain('title="Key custody model"');
      expect(html).toContain('provider-managed, byok');
      expect(html).toContain('title="Service availability status"');
      expect(html).toContain('title="Last catalogue verification date"');
      expect(html).toContain('title="WSP signal that required this service"');
      expect(html).toContain('INV-10');
    });
  });

  describe('lz-catalog-services block (#0789)', () => {
    const LZ_FIXTURE: PublicationModel = {
      ...FIXTURE,
      lzr: {
        overall: 'Conditionally Ready',
        blockers: 2,
        checks: [
          { id: 'LZ-01', label: 'S3: S3 is available and provisioned.', result: 'pass', signal_ref: 's3' },
          { id: 'LZ-02', label: 'EC2: EC2 is available and provisioned.', result: 'pass', signal_ref: 'ec2' },
          { id: 'LZ-03', label: 'RDS: RDS is not offered in eu-central-1.', result: 'fail', signal_ref: 'rds' },
          { id: 'LZ-04', label: 'Lambda: available but not enabled.', result: 'not_applicable', signal_ref: 'lambda' },
          { id: 'LZ-05', label: 'KMS: KMS is available and provisioned.', result: 'pass', signal_ref: 'kms' },
        ],
        catalog: {
          provider: 'aws',
          region: 'eu-central-1',
          overall_verdict: 'READY_WITH_CHANGES',
          assessed_regions: ['eu-central-1'],
          service_count: 5,
        },
      },
    };

    it('renders service coverage matrix with capability column and CSP+region header', () => {
      const html = renderBlock('lz-catalog-services', {}, LZ_FIXTURE);
      expect(html).toContain('Capability');
      expect(html).toContain('AWS / eu-central-1');
      expect(html).toContain('lz-matrix-table');
    });

    it('renders 5 service rows from lzr.checks', () => {
      const html = renderBlock('lz-catalog-services', {}, LZ_FIXTURE);
      expect(html).toContain('s3');
      expect(html).toContain('ec2');
      expect(html).toContain('rds');
      expect(html).toContain('lambda');
      expect(html).toContain('kms');
    });

    it('shows coverage status chips: Sovereign, Conditional, Non-Sovereign', () => {
      const html = renderBlock('lz-catalog-services', {}, LZ_FIXTURE);
      expect(html).toContain('Sovereign');
      expect(html).toContain('Non-Sovereign');
      expect(html).toContain('Conditional');
    });

    it('shows provider and region in catalog header', () => {
      const html = renderBlock('lz-catalog-services', {}, LZ_FIXTURE);
      expect(html).toContain('AWS');
      expect(html).toContain('eu-central-1');
    });

    it('shows empty-state message when no checks present', () => {
      const noChecksFix: PublicationModel = {
        ...FIXTURE,
        lzr: { overall: 'Unknown', blockers: 0, checks: [] },
      };
      const html = renderBlock('lz-catalog-services', {}, noChecksFix);
      expect(html).toContain('No service coverage data');
    });
  });

  describe('compliance-requirements block (#0509)', () => {
    it('renders section with framework name', () => {
      const html = renderBlock('compliance-requirements', {}, FIXTURE);
      expect(html).toContain('General Data Protection Regulation');
      expect(html).toContain('GDPR');
    });

    it('renders control with stable anchor id', () => {
      const html = renderBlock('compliance-requirements', {}, FIXTURE);
      expect(html).toContain('id="control-gdpr-gdpr-art-9"');
    });

    it('renders control id and title', () => {
      const html = renderBlock('compliance-requirements', {}, FIXTURE);
      expect(html).toContain('GDPR_Art_9');
      expect(html).toContain('Special category data');
    });

    it('renders signal cross-link via swaoNavigateToSignal', () => {
      const html = renderBlock('compliance-requirements', {}, FIXTURE);
      expect(html).toContain('swaoNavigateToSignal');
      expect(html).toContain('DATA-01');
    });

    it('renders article_text as requirement text', () => {
      const html = renderBlock('compliance-requirements', {}, FIXTURE);
      expect(html).toContain('Art.9 prohibition.');
    });

    it('renders empty-state when no compliance frameworks', () => {
      const noCompliance: PublicationModel = { ...FIXTURE, compliance: [] };
      const html = renderBlock('compliance-requirements', {}, noCompliance);
      expect(html).toContain('No compliance frameworks assessed');
    });

    it('renders RAG chip for failing control', () => {
      const html = renderBlock('compliance-requirements', {}, FIXTURE);
      expect(html).toContain('rag-fail');
    });

    it('renders expandable details element per control', () => {
      const html = renderBlock('compliance-requirements', {}, FIXTURE);
      expect(html).toContain('<details');
      expect(html).toContain('<summary');
    });
  });

  describe('assessment-scope block (#0517)', () => {
    it('renders section with application name', () => {
      const html = renderBlock('assessment-scope', {}, FIXTURE);
      expect(html).toContain('Sovereign Health Platform');
      expect(html).toContain('sovereign-health');
    });

    it('renders run_id and swao_version', () => {
      const html = renderBlock('assessment-scope', {}, FIXTURE);
      expect(html).toContain('2026-05-13T18-42-00');
      expect(html).toContain('0.1.9');
    });

    it('renders assessed_at date', () => {
      const html = renderBlock('assessment-scope', {}, FIXTURE);
      expect(html).toContain('2026-05-13T18:42:00Z');
    });

    it('renders input_files count when present', () => {
      const withFiles: PublicationModel = {
        ...FIXTURE,
        input_files: [
          { path: 'arch.pdf', kind: 'architecture' },
          { path: 'decisions.md', kind: 'adr' },
        ],
      };
      const html = renderBlock('assessment-scope', {}, withFiles);
      expect(html).toContain('2');
    });

    it('renders without throwing when _wspRunDir param is absent', () => {
      expect(() => renderBlock('assessment-scope', {}, FIXTURE)).not.toThrow();
    });

    it('renders without throwing when _wspRunDir points to non-existent path', () => {
      expect(() => renderBlock('assessment-scope', { _wspRunDir: '/nonexistent/path/xyz' }, FIXTURE)).not.toThrow();
    });

    it('renders total signals from model when no manifest', () => {
      const html = renderBlock('assessment-scope', {}, FIXTURE);
      expect(html).toContain('1');
    });
  });

  // ---------------------------------------------------------------------------
  // Component helper unit tests (Steps 2-6: #0946-#0950)
  // ---------------------------------------------------------------------------

  describe('renderComplianceTileGrid (Step 2 -- #0946)', () => {
    const FW: FrameworkResult[] = [
      { framework_id: 'GDPR', framework_name: 'GDPR', overall_status: 'fail', fail_count: 2, partial_count: 1, pass_count: 3, not_assessed_count: 0, controls: [] },
      { framework_id: 'NIST', framework_name: 'NIST 800-53', overall_status: 'partial', fail_count: 0, partial_count: 4, pass_count: 6, not_assessed_count: 2, controls: [] },
    ];

    it('renders tiles for each framework', () => {
      const html = renderComplianceTileGrid(FW);
      expect(html).toContain('GDPR');
      expect(html).toContain('NIST');
      expect(html).toContain('compliance-tile');
    });

    it('default columns produces pub-grid-3col-mb class', () => {
      const html = renderComplianceTileGrid(FW);
      expect(html).toContain('pub-grid-3col-mb');
    });

    it('columns:2 produces pub-grid-2col-mb class', () => {
      const html = renderComplianceTileGrid(FW, { columns: '2' });
      expect(html).toContain('pub-grid-2col-mb');
    });

    it('show_controls:false suppresses control count link', () => {
      const html = renderComplianceTileGrid(FW, { show_controls: 'false' });
      expect(html).not.toContain('controls');
    });

    it('show_controls:true (default) includes control count link', () => {
      const html = renderComplianceTileGrid(FW);
      expect(html).toContain('controls');
    });
  });

  describe('renderChartDonut (Step 3 -- #0947)', () => {
    it('contains correct stroke-dasharray for pct=70', () => {
      const html = renderChartDonut(70, 0.7);
      // dash = 0.7 * 251.33 = 175.93
      expect(html).toContain('175.93');
    });

    it('default size produces 100x100 SVG', () => {
      const html = renderChartDonut(50, 0.5);
      expect(html).toContain('width="100"');
      expect(html).toContain('height="100"');
    });

    it('size:small produces 60x60 SVG', () => {
      const html = renderChartDonut(50, 0.5, { size: 'small' });
      expect(html).toContain('width="60"');
    });

    it('animation:false omits style transition', () => {
      const html = renderChartDonut(80, 0.8, { animation: 'false' });
      expect(html).not.toContain('transition');
    });

    it('animation not set includes transition style', () => {
      const html = renderChartDonut(80, 0.8);
      expect(html).toContain('transition');
    });
  });

  describe('renderChartSeverityBar (Step 4 -- #0948)', () => {
    const counts = { critical: 3, high: 2, low: 1 };

    it('renders severity segments for each present severity', () => {
      const html = renderChartSeverityBar(counts);
      expect(html).toContain('--seg-flex:3');
      expect(html).toContain('--seg-flex:2');
      expect(html).toContain('--seg-flex:1');
    });

    it('show_labels:false omits label spans', () => {
      const html = renderChartSeverityBar(counts, { show_labels: 'false' });
      expect(html).not.toContain('CRITICAL');
    });

    it('default show_labels renders count labels', () => {
      const html = renderChartSeverityBar(counts);
      expect(html).toContain('CRITICAL');
    });

    it('orientation:vertical adds pub-flex-col class', () => {
      const html = renderChartSeverityBar(counts, { orientation: 'vertical' });
      expect(html).toContain('pub-flex-col');
    });

    it('empty counts renders no-signals fallback', () => {
      const html = renderChartSeverityBar({});
      expect(html).toContain('No signals');
    });
  });

  describe('swaoRagBadge (Step 6 -- #0950)', () => {
    it('renders pass badge with label', () => {
      const html = swaoRagBadge('pass');
      expect(html).toContain('rag-pass');
      expect(html).toContain('Pass');
    });

    it('show_text:false suppresses label', () => {
      const html = swaoRagBadge('fail', { show_text: 'false' });
      expect(html).toContain('rag-fail');
      expect(html).not.toContain('Fail');
    });

    it('not-assessed renders correct label', () => {
      const html = swaoRagBadge('not-assessed');
      expect(html).toContain('Not assessed');
    });
  });

  describe('swaoProgressBar (Step 6 -- #0950)', () => {
    it('renders 30% width for value=3 max=10', () => {
      const html = swaoProgressBar(3, 10);
      expect(html).toContain('width:30%');
      expect(html).toContain('aria-valuenow="3"');
      expect(html).toContain('aria-valuemax="10"');
    });

    it('clamps to 100% when value > max', () => {
      const html = swaoProgressBar(15, 10);
      expect(html).toContain('width:100%');
    });

    it('renders 0% when max=0', () => {
      const html = swaoProgressBar(0, 0);
      expect(html).toContain('width:0%');
    });
  });

  describe('swaoTooltip (Step 5 -- #0949)', () => {
    it('renders trigger text and tooltip body', () => {
      const html = swaoTooltip('GDPR', 'General Data Protection Regulation');
      expect(html).toContain('GDPR');
      expect(html).toContain('General Data Protection Regulation');
      expect(html).toContain('swao-tooltip');
      expect(html).toContain('swao-tooltip__body');
    });

    it('includes role=tooltip and tabindex', () => {
      const html = swaoTooltip('term', 'definition');
      expect(html).toContain('role="tooltip"');
      expect(html).toContain('tabindex="0"');
    });
  });

  describe('lzr-summary -- #0732 schema separation', () => {
    it('shows "No landing zone target selected" when overall is Not Assessed', () => {
      const notAssessedFix: PublicationModel = {
        ...FIXTURE,
        lzr: { overall: 'Not Assessed', blockers: 0, checks: [] },
      };
      const html = renderBlock('lzr-summary', {}, notAssessedFix);
      expect(html).toContain('No landing zone target selected');
      expect(html).toContain('Re-run and select a target LZ');
    });

    it('shows LZR-tag message when checks are empty but overall is not Not Assessed', () => {
      const lzrTagFix: PublicationModel = {
        ...FIXTURE,
        lzr: { overall: 'Conditionally Ready', blockers: 2, checks: [] },
      };
      const html = renderBlock('lzr-summary', {}, lzrTagFix);
      expect(html).toContain('LZR tag indicates');
      expect(html).toContain('2 blocker');
    });

    it('uses callout-info class for Not Assessed overall', () => {
      const notAssessedFix: PublicationModel = {
        ...FIXTURE,
        lzr: { overall: 'Not Assessed', blockers: 0, checks: [] },
      };
      const html = renderBlock('lzr-summary', {}, notAssessedFix);
      expect(html).toContain('callout-info');
    });
  });

  // ---------------------------------------------------------------------------
  // Sprint-109 QA regression tests (#1287 #1292 #1293 #1295 #1296 #1297 #1298
  // #1299 #1300)
  // ---------------------------------------------------------------------------

  describe('sprint-109 QA regression (#1287-#1300)', () => {
    // #1287: compliance tile must not have two separate class attributes
    it('#1287: compliance-regime tile has merged class attribute', () => {
      const html = renderBlock('compliance-regime', {}, FIXTURE);
      expect(html).toContain('compliance-tile pub-compliance-tile-inner');
      // Two separate class= on the same element would leave a literal second class attr
      expect(html).not.toMatch(/class="compliance-tile"[^>]*class=/);
    });

    // #1292: challenge panel rendered with id and no open attribute
    it('#1292: stakeholder-challenge panel has id and is not open by default', () => {
      const challengeModel: PublicationModel = {
        ...FIXTURE,
        challenge: [
          {
            agent_id: 'business-owner',
            severity_overall: 'HIGH',
            opening_statement: 'This workload is high risk.',
            findings: [],
            next_step: 'Follow up on encryption.',
            reviewed_at: '2026-07-28T10:00:00Z',
          },
        ],
      } as PublicationModel;
      const html = renderBlock('stakeholder-challenge', {}, challengeModel);
      expect(html).toContain('id="challenge-business-owner"');
      expect(html).not.toMatch(/<details[^>]+open/);
    });

    // #1293: LZR blockers column shows Sovereignty pill for SOVEREIGNTY_BLOCKED with 0 blockers
    it('#1293: lzr-summary shows Sovereignty pill for SOVEREIGNTY_BLOCKED region with zero service blockers', () => {
      const multiRegion: PublicationModel = {
        ...FIXTURE,
        lzr: {
          overall: 'Sovereignty Blocked',
          blockers: 0,
          checks: [],
          regions: [
            {
              provider: 'aws', region: 'eu-central-1',
              overall_verdict: 'SOVEREIGNTY_BLOCKED',
              service_count: 0, blockers: 0,
              sovereignty_statement: 'Fails US Cloud Act.',
            },
            {
              provider: 'stackit', region: 'eu02',
              overall_verdict: 'READY',
              service_count: 5, blockers: 0,
            },
          ],
        } as PublicationModel['lzr'],
      };
      const html = renderBlock('lzr-summary', {}, multiRegion);
      expect(html).toContain('rag-fail');
      expect(html).toContain('Sovereignty');
      // READY region should show None
      expect(html).toContain('pub-text-secondary-sm');
    });

    // #1295: compliance-requirements framework details is not open by default
    it('#1295: compliance-requirements outer framework details is not open by default', () => {
      const html = renderBlock('compliance-requirements', {}, FIXTURE);
      // No <details ... open> should appear for the outer framework panel
      const detailMatches = html.match(/<details[^>]*>/g) ?? [];
      const openDetails = detailMatches.filter(d => /\bopen\b/.test(d));
      expect(openDetails).toHaveLength(0);
    });

    // #1296: signal-list table config uses signal-id-cell renderer for ID column
    it('#1296: signal-list ID column config uses signal-id-cell renderer', () => {
      const html = renderBlock('signal-list', {}, FIXTURE);
      expect(html).toContain('signal-id-cell');
    });

    // #1297: risk-register override template uses {{{override_block}}} not nested {{#if}}
    it('#1297: risk-register expandTemplate uses pre-computed override_block field', () => {
      const html = renderBlock('risk-register', {}, FIXTURE);
      // The serialised table config should reference override_block
      expect(html).toContain('override_block');
      // The old nested pattern must not appear
      expect(html).not.toContain('{{#if override_author}}');
    });

    // #1298: compliance signal pills include data-signal-derivation + data-signal-outcome
    it('#1298: compliance-requirements signal pills carry data-signal-derivation and data-signal-outcome', () => {
      const html = renderBlock('compliance-requirements', {}, FIXTURE);
      expect(html).toContain('data-signal-derivation');
      expect(html).toContain('data-signal-outcome');
    });

    // #1299: lzr-summary shows mixed-region aggregate label
    it('#1299: lzr-summary shows "N of M regions ready" for mixed READY/BLOCKED regions', () => {
      const mixedLzr: PublicationModel = {
        ...FIXTURE,
        lzr: {
          overall: 'Sovereignty Blocked',
          blockers: 0,
          checks: [],
          regions: [
            { provider: 'aws', region: 'eu-central-1', overall_verdict: 'SOVEREIGNTY_BLOCKED', service_count: 0, blockers: 0, sovereignty_statement: 'Blocked.' },
            { provider: 'aws', region: 'eu-west-1', overall_verdict: 'SOVEREIGNTY_BLOCKED', service_count: 0, blockers: 0, sovereignty_statement: 'Blocked.' },
            { provider: 'stackit', region: 'eu02', overall_verdict: 'READY', service_count: 3, blockers: 0 },
          ],
        } as PublicationModel['lzr'],
      };
      const html = renderBlock('lzr-summary', {}, mixedLzr);
      expect(html).toContain('1 of 3 regions ready');
      expect(html).toContain('callout-warning');
    });

    it('#1299: lzr-summary shows callout-info for all-READY regions', () => {
      const allReadyLzr: PublicationModel = {
        ...FIXTURE,
        lzr: {
          overall: 'Ready',
          blockers: 0,
          checks: [],
          regions: [
            { provider: 'stackit', region: 'eu02', overall_verdict: 'READY', service_count: 3, blockers: 0 },
            { provider: 'aws', region: 'eu-central-1', overall_verdict: 'READY', service_count: 5, blockers: 0 },
          ],
        } as PublicationModel['lzr'],
      };
      const html = renderBlock('lzr-summary', {}, allReadyLzr);
      expect(html).toContain('callout-info');
      expect(html).not.toMatch(/\d+ of \d+ regions ready/);
    });

    it('#1299: cover badge shows mixed-region label', () => {
      const mixedLzr: PublicationModel = {
        ...FIXTURE,
        lzr: {
          overall: 'Sovereignty Blocked',
          blockers: 0,
          checks: [],
          regions: [
            { provider: 'aws', region: 'eu-central-1', overall_verdict: 'SOVEREIGNTY_BLOCKED', service_count: 0, blockers: 0 },
            { provider: 'stackit', region: 'eu02', overall_verdict: 'READY', service_count: 3, blockers: 0 },
          ],
        } as PublicationModel['lzr'],
      };
      const html = renderBlock('cover', {}, mixedLzr);
      expect(html).toContain('1 of 2 regions ready');
    });

    // #1300: cover uses engagement_lead field when set; falls back to partnership_lead
    it('#1300: cover shows engagement_lead value when set', () => {
      const leadModel: PublicationModel = {
        ...FIXTURE,
        meta: {
          ...FIXTURE.meta,
          engagement: {
            engagement_name: 'ACME Cloud Transformation',
            partnership_lead: '',
            engagement_lead: 'Helmut Schindlwick',
          } as PublicationModel['meta']['engagement'],
        },
      };
      const html = renderBlock('cover', {}, leadModel);
      expect(html).toContain('Helmut Schindlwick');
      // partnership_lead (empty string) must NOT appear as the shown name
      expect(html).not.toMatch(/Engagement Lead:\s*&nbsp/);
    });

    it('#1300: cover falls back to partnership_lead when engagement_lead absent', () => {
      // FIXTURE has partnership_lead: 'Engagement Lead', no engagement_lead
      const html = renderBlock('cover', {}, FIXTURE);
      expect(html).toContain('Engagement Lead');
    });

    // #1294: runbook renders signal pill links when step.signals set
    it('#1294: runbook renders signal pill links for steps with signals', () => {
      const runbookModel: PublicationModel = {
        ...FIXTURE,
        runbook: [
          {
            title: 'Encrypt PII fields',
            description: 'Apply AES-256 encryption to all PII fields.',
            signals: ['DATA-01'],
          },
        ] as PublicationModel['runbook'],
      };
      const html = renderBlock('runbook', {}, runbookModel);
      expect(html).toContain('DATA-01');
      expect(html).toContain('data-signal-id');
      expect(html).toContain('Addresses:');
    });

    // Sprint-109 QA batch fixes

    // Issue #7: quick-nav must carry data-sidebar-exclude so it is omitted from sidebar
    it('quick-nav section carries data-sidebar-exclude="true"', () => {
      const html = renderBlock('quick-nav', {}, FIXTURE);
      expect(html).toContain('data-sidebar-exclude="true"');
    });

    // Issue #8: compliance-framework-detail wraps rationale in <details> toggle, never open by default
    it('compliance-framework-detail wraps assessment rationale in collapsible details', () => {
      const html = renderBlock('compliance-framework-detail', {}, FIXTURE);
      expect(html).toContain('fw-ctrl-assessment-details');
      expect(html).toContain('fw-ctrl-assessment-summary');
      const detailMatches = html.match(/<details[^>]*>/g) ?? [];
      const openDetails = detailMatches.filter(d => /\bopen\b/.test(d));
      expect(openDetails).toHaveLength(0);
    });

    // Issue #3: controls table Signals column uses signals_html (inline-ref spans) not plain text
    it('controls table signals column emits inline-ref-signal spans', () => {
      const html = renderBlock('controls', {}, FIXTURE);
      expect(html).toContain('inline-ref-signal');
      expect(html).toContain('"signals_html"');
    });

    // Issue #4: risk-register expand template uses "Risk Title:" not "Description:" to avoid redundancy
    it('risk-register expand template labels trigger field as "Risk Title" not "Description"', () => {
      const html = renderBlock('risk-register', {}, FIXTURE);
      expect(html).toContain('Risk Title:');
      expect(html).not.toContain('Description:</span> {{trigger}}');
    });

    // Issue #5: lzr-summary renders service pills when services[] populated
    it('lzr-summary renders service labels as pills when services[] is populated', () => {
      const lzrWithServices: PublicationModel = {
        ...FIXTURE,
        lzr: {
          overall: 'Ready',
          blockers: 0,
          checks: [],
          regions: [
            {
              provider: 'stackit', region: 'eu02', overall_verdict: 'READY',
              service_count: 2, blockers: 0,
              services: ['postgresql', 'objectstorage'],
              service_labels: ['PostgreSQL', 'Object Storage'],
            },
            {
              provider: 'aws', region: 'eu-central-1', overall_verdict: 'READY',
              service_count: 0, blockers: 0,
              services: [], service_labels: [],
            },
          ],
        } as PublicationModel['lzr'],
      };
      const html = renderBlock('lzr-summary', {}, lzrWithServices);
      expect(html).toContain('PostgreSQL');
      expect(html).toContain('Object Storage');
      expect(html).toContain('lz-service-pill');
      // Region with no services falls back to '--'
      expect(html).toContain('--');
    });
  });

  describe('llm.* blocks (#1483)', () => {
    const LLM_FIXTURE = {
      ...FIXTURE,
      block_profile: 'llm-assessment',
      llm_assessment: {
        app_id: 'demo-app', created: '2026-08-06T10:00:00Z', analysis_mode: 'serial',
        legs: [
          { id: 'or--a', connector: 'openrouter', model: 'gpt-4o', primary: true },
          { id: 'or--b', connector: 'openrouter', model: 'claude-3', primary: false },
        ],
        weights: { quality: 0.5, reliability: 0.5 },
        final: {
          score: { 'or--a': 72.5, 'or--b': 81.0 },
          rank: { 'or--a': 2, 'or--b': 1 },
          weights: { quality: 0.5, reliability: 0.5 },
        },
        groups: [
          {
            group: 'quality-content',
            score: { 'or--a': 72.5, 'or--b': 81.0 },
            rank: { 'or--a': 2, 'or--b': 1 },
            light: { 'or--a': 'ok', 'or--b': 'ok' },
          },
        ],
        passGroups: [], bucketViews: [], findings: [],
        verdicts: { 'or--a': 'Refactor', 'or--b': 'Rehost' },
      },
    } as unknown as PublicationModel;

    it('7R Verdict row renders inside quality section when verdicts present', () => {
      const html = renderBlock('llm.group-breakdown', {}, LLM_FIXTURE);
      expect(html).toContain('7R Verdict');
      expect(html).toContain('Refactor');
      expect(html).toContain('Rehost');
    });

    it('llm.group-breakdown renders no verdict row when verdicts absent', () => {
      const noVerdicts = {
        ...LLM_FIXTURE,
        llm_assessment: { ...(LLM_FIXTURE as unknown as Record<string, unknown>)['llm_assessment'] as Record<string, unknown>, verdicts: undefined },
      } as unknown as PublicationModel;
      const html = renderBlock('llm.group-breakdown', {}, noVerdicts);
      expect(html).not.toContain('7R Verdict');
    });

    // #1587: challenge-results block tests
    it('llm.challenge-results returns empty string when no challengePassGroups present', () => {
      const html = renderBlock('llm.challenge-results', {}, LLM_FIXTURE);
      // LLM_FIXTURE has no challengePassGroups -- block must be empty (silently skipped)
      expect(html).toBe('');
    });

    it('llm.challenge-results renders resilience score and agent table when challengePassGroups present', () => {
      const withChallenge = {
        ...LLM_FIXTURE,
        llm_assessment: {
          ...(LLM_FIXTURE as unknown as Record<string, unknown>)['llm_assessment'],
          challengePassGroups: [
            {
              pass_id: 'C1-app-architect',
              legs: {
                'or--a': { calls: 1, dnf: 0, latency_p50_ms: null, prompt_tokens_median: null, completion_tokens_median: null, cost_usd: null, parse_valid_rate: null, schema_conform_rate: null, size_bucket: null, refusal_count: null, redaction_marker_altered_count: null, pii_reproduction_count: null, prompt_injection_count: null },
                'or--b': { calls: 1, dnf: 0, latency_p50_ms: null, prompt_tokens_median: null, completion_tokens_median: null, cost_usd: null, parse_valid_rate: null, schema_conform_rate: null, size_bucket: null, refusal_count: null, redaction_marker_altered_count: null, pii_reproduction_count: null, prompt_injection_count: null },
              },
              rank: {},
            },
            {
              pass_id: 'C1-grc-officer',
              legs: {
                'or--a': { calls: 1, dnf: 1, latency_p50_ms: null, prompt_tokens_median: null, completion_tokens_median: null, cost_usd: null, parse_valid_rate: null, schema_conform_rate: null, size_bucket: null, refusal_count: null, redaction_marker_altered_count: null, pii_reproduction_count: null, prompt_injection_count: null },
                'or--b': { calls: 1, dnf: 0, latency_p50_ms: null, prompt_tokens_median: null, completion_tokens_median: null, cost_usd: null, parse_valid_rate: null, schema_conform_rate: null, size_bucket: null, refusal_count: null, redaction_marker_altered_count: null, pii_reproduction_count: null, prompt_injection_count: null },
              },
              rank: {},
            },
          ],
          challengeResilienceScore: 0.75,
        },
      } as unknown as PublicationModel;
      const html = renderBlock('llm.challenge-results', {}, withChallenge);
      // Section heading
      expect(html).toContain('Challenge Results');
      // Score rendered as percentage
      expect(html).toContain('75%');
      // Agent rows (pass_id C1- prefix stripped)
      expect(html).toContain('app architect');
      expect(html).toContain('grc officer');
      // id attribute for nav anchor
      expect(html).toContain('id="llm-challenge-results"');
    });

    it('llm.challenge-results renders C2 LZ challenge agents when lzChallengePassGroups present (#1994)', () => {
      const withC2 = {
        ...LLM_FIXTURE,
        llm_assessment: {
          ...(LLM_FIXTURE as unknown as Record<string, unknown>)['llm_assessment'],
          lzChallengePassGroups: [
            {
              pass_id: 'C2-lzca-ciso-security',
              legs: {
                'or--a': { calls: 1, dnf: 0, latency_p50_ms: 55000, prompt_tokens_median: null, completion_tokens_median: null, cost_usd: null, parse_valid_rate: null, schema_conform_rate: null, size_bucket: null, refusal_count: null, redaction_marker_altered_count: null, pii_reproduction_count: null, prompt_injection_count: null },
              },
              rank: {},
            },
          ],
        },
      } as unknown as PublicationModel;
      const html = renderBlock('llm.challenge-results', {}, withC2);
      expect(html).toContain('LZ Challenge Agents (C2)');
      expect(html).toContain('lzca ciso security');
    });

    it('llm.pass-table renders C2 rows after C1 rows when lzChallengePassGroups present (#1994)', () => {
      const withC2 = {
        ...LLM_FIXTURE,
        llm_assessment: {
          ...(LLM_FIXTURE as unknown as Record<string, unknown>)['llm_assessment'],
          // Need at least one passGroup so the function does not return early
          passGroups: [
            {
              pass_id: '03-data',
              legs: {
                'or--a': { calls: 1, dnf: 0, latency_p50_ms: 5000, prompt_tokens_median: null, completion_tokens_median: null, cost_usd: null, parse_valid_rate: null, schema_conform_rate: null, size_bucket: null, refusal_count: null, redaction_marker_altered_count: null, pii_reproduction_count: null, prompt_injection_count: null },
              },
              rank: {},
            },
          ],
          lzChallengePassGroups: [
            {
              pass_id: 'C2-lzca-lz-architect',
              legs: {
                'or--a': { calls: 1, dnf: 0, latency_p50_ms: 42000, prompt_tokens_median: null, completion_tokens_median: null, cost_usd: null, parse_valid_rate: null, schema_conform_rate: null, size_bucket: null, refusal_count: null, redaction_marker_altered_count: null, pii_reproduction_count: null, prompt_injection_count: null },
              },
              rank: {},
            },
          ],
        },
      } as unknown as PublicationModel;
      const html = renderBlock('llm.pass-table', {}, withC2);
      expect(html).toContain('C2-lzca-lz-architect');
      expect(html).toContain('LZ Challenge (C2)');
    });
  });
});
