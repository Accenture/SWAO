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
 * tag-index.test.ts -- Tag index + search index builder tests
 * Design 041 §4.3 + issue #0433
 */

import { describe, it, expect } from 'vitest';
import { buildTagIndex, buildSearchIndex } from './tag-index.js';
import type { PublicationModel } from './model.js';

// ---------------------------------------------------------------------------
// Minimal valid fixture (matches blocks.test.ts fixture shape)
// ---------------------------------------------------------------------------

const FIXTURE: PublicationModel = {
  contract_version: '1.0',
  meta: {
    app_id: 'sovereign-health', app_name: 'Sovereign Health Platform',
    assessed_at: '2026-05-13T18:42:00Z', run_id: '2026-05-13T18-42-00',
    swao_version: '0.1.9',
    engagement: { engagement_name: 'ACME Cloud Transformation', partnership_lead: 'Engagement Lead' },
    licensee: 'Accenture', tier: 'community',
    publication_config: {
      classification_band: 'Accenture Internal, Confidential',
      logo_name: 'SWAO', logo_sub: 'Publication', footer_note: '',
      engagement_lead_label: 'Engagement Lead',
      primary_contact_label: 'Primary Contact',
      secondary_contact_label: 'Secondary Contact',
    },
  },
  summary: {
    seven_r_label: 'Re-platform', coverage_score: 0.62,
    signal_counts: { critical: 2 }, blocker_count: 2,
    top_findings: [],
  },
  signals: [{
    id: 'DATA-01', pass: '3', severity: 'critical', outcome: 'negative',
    derivation: 'NHS PII without encryption.', evidence_refs: ['ev-prisma'],
    implies: ['LZR blocker'], tags: ['gdpr', 'pii'], anchor: 'signal-DATA-01',
  }],
  compliance: [{
    framework_id: 'GDPR', framework_name: 'GDPR',
    fail_count: 1, partial_count: 0, pass_count: 0,
    controls: [{
      id: 'GDPR_Art_9', title: 'Special category data', rag_status: 'fail',
      worst_severity: 'critical', signals: ['DATA-01'], rationale: 'NHS data.',
      article_text: 'Art.9.', evidence: [], anchor: 'control-gdpr-gdpr-art-9',
    }],
  }],
  risk_register: [{
    risk_id: 'RR-001', trigger: 'NHS PII risk', category: 'GDPR',
    likelihood: 'high', impact: 'high', mitigation: 'Encrypt.',
    owner: 'DPO', evidence_refs: [], status: 'open', anchor: 'rr-rr-001',
  }],
  runbook: [], evidence: [], input_files: [],
  tags: {},
  lzr: { overall: 'Conditionally Ready', blockers: 2, checks: [] },
  run_history: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildTagIndex', () => {
  it('returns non-empty index when model has signals', () => {
    const idx = buildTagIndex(FIXTURE);
    expect(Object.keys(idx).length).toBeGreaterThan(0);
  });

  it("signal's severity tag appears in the index", () => {
    const idx = buildTagIndex(FIXTURE);
    expect(idx['critical']).toBeDefined();
    expect(idx['critical'].some(e => e.anchor === 'signal-DATA-01')).toBe(true);
  });

  it('GDPR compliance control appears under gdpr tag', () => {
    const idx = buildTagIndex(FIXTURE);
    // The GDPR framework_id is normalised to lowercase 'gdpr'
    expect(idx['gdpr']).toBeDefined();
    const gdprEntries = idx['gdpr'];
    expect(gdprEntries.some(e => e.type === 'control' && e.anchor === 'control-gdpr-gdpr-art-9')).toBe(true);
  });
});

describe('buildSearchIndex', () => {
  it('returns valid JSON (parse without error)', () => {
    const json = buildSearchIndex(FIXTURE);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('parsed search index is an array of docs (flat format for substring search)', () => {
    // sprint-054 #0483: changed from Lunr serialised object to flat docs array
    // so getSearchDocs() can iterate .length directly without a Lunr client bundle.
    const json = buildSearchIndex(FIXTURE);
    const parsed = JSON.parse(json) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
    const docs = parsed as Array<{ id: string; type: string; label: string; body: string }>;
    expect(docs.length).toBeGreaterThan(0);
    expect(docs[0]).toHaveProperty('id');
    expect(docs[0]).toHaveProperty('type');
    expect(docs[0]).toHaveProperty('label');
  });
});

describe('buildSectionSearchDocs (#1388)', () => {
  const HTML = [
    '<section id="exec-summary" class="swao-block"><h2>Executive Summary</h2>',
    '<p>The workload processes &amp; stores health data in Brandenburg.</p>',
    '<script>var ignored = "SCRIPT-NOISE";</script>',
    '<style>.x { color: red; }</style>',
    '</section>',
    '<section id="tiny"><p>too short</p></section>',
    '<section id="lz-narrative"><h2>Landing Zone Narrative</h2>',
    '<p>STACKIT eu01 satisfies the sovereignty requirements for this workload and is recommended.</p>',
    '</section>',
  ].join('\n');

  it('extracts one doc per substantial section with heading label and real anchor', async () => {
    const { buildSectionSearchDocs } = await import('./tag-index.js');
    const docs = buildSectionSearchDocs(HTML);
    expect(docs.map((d: { anchor?: string }) => d.anchor)).toEqual(['exec-summary', 'lz-narrative']);
    const exec = docs[0]!;
    expect(exec.type).toBe('section');
    expect(exec.label).toBe('Executive Summary');
    expect(exec.body).toContain('health data in Brandenburg');
    expect(exec.body).toContain('processes & stores');
  });

  it('strips script and style content so it can never match a search', async () => {
    const { buildSectionSearchDocs } = await import('./tag-index.js');
    const docs = buildSectionSearchDocs(HTML);
    expect(docs[0]!.body).not.toContain('SCRIPT-NOISE');
    expect(docs[0]!.body).not.toContain('color: red');
  });

  it('strips script end tags with whitespace and never double-unescapes entities (CodeQL)', async () => {
    const { buildSectionSearchDocs } = await import('./tag-index.js');
    const html = '<section id="s1"><h2>Entities</h2>'
      + '<p>Literal entity text: &amp;lt;tag&amp;gt; and ampersand &amp; end. Padding padding padding.</p>'
      + '<script type="text/javascript">var sneaky = "TAG-NOISE";</script\t\n bar>'
      + '</section>';
    const docs = buildSectionSearchDocs(html);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.body).not.toContain('TAG-NOISE');
    // &amp;lt; decodes exactly one level: to the literal string '&lt;', not '<'.
    expect(docs[0]!.body).toContain('&lt;tag&gt;');
    expect(docs[0]!.body).toContain('ampersand & end');
  });

  it('mergeSearchIndexWithSections appends sections to the typed docs', async () => {
    const { mergeSearchIndexWithSections } = await import('./tag-index.js');
    const typed = JSON.stringify([{ id: 'signal-INV-01', type: 'signal', label: 'INV-01', body: 'x' }]);
    const merged = JSON.parse(mergeSearchIndexWithSections(typed, HTML)) as Array<{ type: string }>;
    expect(merged.filter(d => d.type === 'signal')).toHaveLength(1);
    expect(merged.filter(d => d.type === 'section')).toHaveLength(2);
  });

  it('mergeSearchIndexWithSections falls back to typed docs on bad JSON', async () => {
    const { mergeSearchIndexWithSections } = await import('./tag-index.js');
    expect(mergeSearchIndexWithSections('not-json', HTML)).toBe('not-json');
  });
});
