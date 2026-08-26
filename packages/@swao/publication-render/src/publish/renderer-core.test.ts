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
 * renderer-core.test.ts -- wrapTerms ConsString regression tests + assemblePublicationPage unit tests
 * Regression for #0929: protectTag built a V8 ConsString tree of depth N
 * (N = number of HTML tags) by calling toLowerCase() + slice-concat on every
 * iteration. On pages with 5000+ tags the tree exceeded V8's flatten limit and
 * crashed inside the pkg binary. The fix uses a single toLowerCase pass +
 * index-offset accumulator so the tree never grows beyond O(1) depth.
 *
 * T1a/T1c (#0935): assemblePublicationPage unit tests (slot replacement + unknown slot).
 * T1b/T2 (#0935): ci.yaml token injection and CSS warn tests (D1 -- #0930 unblocked).
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { wrapTerms, assemblePublicationPage } from './renderer-core.js';
import type { PublicationModel } from './model.js';

// ---------------------------------------------------------------------------
// Minimal PublicationModel fixture (reuse across test describe blocks)
// ---------------------------------------------------------------------------

function minimalModel(): PublicationModel {
  return {
    contract_version: '1.1',
    meta: {
      app_id: 'test-app',
      app_name: 'Test Application',
      assessed_at: '2026-01-01T00:00:00Z',
      run_id: '2026-01-01T00-00-00',
      swao_version: '0.7.2',
      engagement: { engagement_name: 'Test Engagement', partnership_lead: 'Lead' },
      licensee: 'Accenture',
      tier: 'community',
      publication_config: {
        classification_band: 'Test',
        logo_name: 'SWAO',
        logo_sub: 'Test',
        footer_note: '',
        engagement_lead_label: 'Engagement Lead',
        primary_contact_label: 'Primary Contact',
        secondary_contact_label: 'Secondary Contact',
      },
    },
    summary: {
      seven_r_label: 'Re-platform',
      coverage_score: 0.5,
      signal_counts: { critical: 0, high: 0, medium: 0, low: 0, positive: 0 },
      blocker_count: 0,
      top_findings: [],
    },
    signals: [],
    compliance: [],
    risk_register: [],
    runbook: [],
    evidence: [],
    input_files: [],
    tags: {},
    lzr: { overall: 'Not Assessed', blockers: 0, checks: [] },
    run_history: [],
  };
}

interface GlossaryTerm { term: string; definition: string; }

describe('wrapTerms', () => {
  it('wraps matching text nodes', () => {
    const html = '<p>The compliance framework applies here.</p>';
    const terms: GlossaryTerm[] = [{ term: 'compliance', definition: 'Adherence to rules.' }];
    const result = wrapTerms(html, terms);
    expect(result).toContain('<abbr class="swao-term"');
    expect(result).toContain('compliance');
  });

  it('does not wrap terms inside HTML tag attributes', () => {
    const html = '<a href="#compliance-section">compliance</a>';
    const terms: GlossaryTerm[] = [{ term: 'compliance', definition: 'Adherence to rules.' }];
    const result = wrapTerms(html, terms);
    // href attribute value must not be modified
    expect(result).toContain('href="#compliance-section"');
    // but the text node between tags should be wrapped
    expect(result).toContain('<abbr');
  });

  it('does not wrap terms inside <script> blocks', () => {
    const html = '<script>var compliance = 1;</script>';
    const terms: GlossaryTerm[] = [{ term: 'compliance', definition: 'Adherence to rules.' }];
    const result = wrapTerms(html, terms);
    expect(result).not.toContain('<abbr');
    expect(result).toContain('var compliance = 1;');
  });

  it('restores both style and script when style precedes script (#0929 marker-order)', () => {
    // style before script -- style gets a HIGHER marker number because script
    // protection runs first, so the out-of-order markers must still be restored.
    const html = '<style>body{color:red}</style>\n<script>var x=1;</script>\n<p>assessment</p>';
    const terms: GlossaryTerm[] = [{ term: 'assessment', definition: 'Evaluation.' }];
    const result = wrapTerms(html, terms);
    // Both protected blocks must be restored -- no raw P-markers in output
    expect(result).not.toMatch(/\x00P\d+\x00/);
    expect(result).toContain('<style>body{color:red}</style>');
    expect(result).toContain('<script>var x=1;</script>');
    // Text node between tags must be wrapped
    expect(result).toContain('<abbr class="swao-term"');
  });

  it('handles empty glossary without error', () => {
    const html = '<p>Some text.</p>';
    const result = wrapTerms(html, []);
    expect(result).toBe(html);
  });

  it('survives a large page with thousands of HTML tags (#0929 regression)', () => {
    // Generate ~6000 tags -- exceeds the old V8 ConsString crash threshold
    const rows = Array.from({ length: 1000 }, (_, i) =>
      `<tr id="row-${i}"><td class="col-a">${i % 2 === 0 ? 'assessment' : 'control'} item</td><td>${i}</td><td>pass</td><td>low</td><td>text</td></tr>`,
    );
    const html =
      '<table class="swao-tbl">' +
      '<thead><tr><th>Name</th><th>ID</th><th>Status</th><th>Severity</th><th>Notes</th></tr></thead>' +
      '<tbody>' + rows.join('') + '</tbody>' +
      '</table>';

    const terms: GlossaryTerm[] = [
      { term: 'assessment', definition: 'Evaluation of a workload.' },
      { term: 'control', definition: 'A compliance requirement.' },
    ];

    // Must not throw or crash; must replace the matching text nodes
    let result: string;
    expect(() => { result = wrapTerms(html, terms); }).not.toThrow();
    // Verify term wrapping did occur in text nodes
    expect(result!).toContain('<abbr class="swao-term"');
    // Verify table structure is intact
    expect(result!).toContain('<thead>');
    expect(result!).toContain('</table>');
    // Verify HTML attribute values were not modified
    expect(result!).toContain('class="swao-tbl"');
  });
});

// ---------------------------------------------------------------------------
// assemblePublicationPage unit tests (#0935 T1a, T1c)
// T1b (ci.yaml injection) and T2 (CSS warn via cssPath) are blocked on D1 #0930.
// ---------------------------------------------------------------------------

// A minimal slot-marker template (no css/js inlining markers so inlineAssets is a no-op)
const SLOT_TEMPLATE = `<html><head></head><body>
<!--SWAO:slot name="coverage-bar"-->
<!--SWAO:slot name="exec-summary"-->
</body></html>`;

describe('assemblePublicationPage', () => {
  it('T1a -- replaces all slot markers with block HTML', () => {
    const warns: string[] = [];
    const html = assemblePublicationPage({
      template: SLOT_TEMPLATE,
      model: minimalModel(),
      timestamp: '',
      logger: { warn: (m) => warns.push(m), info: () => {}, error: () => {} },
    });
    // No raw SWAO:slot markers survive
    expect(html).not.toMatch(/<!--\s*SWAO:slot/);
    // Both blocks rendered as swao-block sections
    expect(html).toContain('class="swao-block swao-block--coverage-bar"');
    expect(html).toContain('class="swao-block swao-block--exec-summary"');
  });

  it('T1c -- unknown slot emits warn and does not throw (E2 gate)', () => {
    const template = `<html><body><!--SWAO:slot name="totally-unknown-block"--></body></html>`;
    const warns: string[] = [];
    expect(() =>
      assemblePublicationPage({
        template,
        model: minimalModel(),
        timestamp: '',
        logger: { warn: (m) => warns.push(m), info: () => {}, error: () => {} },
      }),
    ).not.toThrow();
    // E2: unknown block emits warn with block name
    expect(warns.some(m => m.includes('Unknown block') && m.includes('totally-unknown-block'))).toBe(true);
  });

  it('T1b -- ci.yaml Tier 1 tokens injected before swao-pub.css (D1 -- #0930)', () => {
    // Write a minimal workspace with ci.yaml and call assemblePublicationPage.
    const ws = mkdtempSync(join(tmpdir(), 'swao-t1b-'));
    const stylesDir = join(ws, 'wsp', 'templates', 'styles');
    mkdirSync(stylesDir, { recursive: true });
    const ciPath = join(stylesDir, 'ci.yaml');
    // Use YAML key as a quoted string so the leading '--' is not misinterpreted as a block indicator
    writeFileSync(ciPath, '"--brand-accent": "#ff0000"\n', 'utf-8');

    // Template must include <!-- swao:css --> so inlineAssets has a marker to inject into
    const tmplWithCss = `<html><head><!-- swao:css --></head><body>
<!--SWAO:slot name="coverage-bar"-->
</body></html>`;
    const fakeRunDir = join(ws, 'apps', 'test-app', 'wsp', 'runs', '2026-01-01T00-00-00');

    const html = assemblePublicationPage({
      template: tmplWithCss,
      model: minimalModel(),
      timestamp: '',
      wspRunDir: fakeRunDir,
      logger: { warn: () => {}, info: () => {}, error: () => {} },
    });

    // CI token block must appear before swao-pub-css in the output
    expect(html).toContain('swao-ci-tokens');
    expect(html).toContain('--brand-accent: #ff0000');
    const ciIdx  = html.indexOf('swao-ci-tokens');
    const cssIdx = html.indexOf('swao-pub-css');
    expect(ciIdx).toBeGreaterThanOrEqual(0);
    expect(cssIdx).toBeGreaterThanOrEqual(0);
    expect(ciIdx).toBeLessThan(cssIdx);
  });

  it('T2 -- assemblePublicationPage does not throw when ci.yaml is absent', () => {
    // No ci.yaml in temp workspace -- no error, no warn, output still valid HTML.
    const ws = mkdtempSync(join(tmpdir(), 'swao-t2-'));
    const fakeRunDir = join(ws, 'apps', 'test-app', 'wsp', 'runs', '2026-01-01T00-00-00');
    const warns: string[] = [];
    expect(() =>
      assemblePublicationPage({
        template: SLOT_TEMPLATE,
        model: minimalModel(),
        timestamp: '',
        wspRunDir: fakeRunDir,
        logger: { warn: (m) => warns.push(m), info: () => {}, error: () => {} },
      }),
    ).not.toThrow();
    // No ci.yaml warning -- absence is silent
    expect(warns.some(m => m.includes('ci.yaml'))).toBe(false);
  });

  it('Step 7 (#0951) -- profile.nav.top replaces site-header__nav links', () => {
    // Build a minimal workspace with an application.yaml profile containing nav.top
    const ws = mkdtempSync(join(tmpdir(), 'swao-step7-'));
    const profilesDir = join(ws, 'wsp', 'templates', 'profiles');
    mkdirSync(profilesDir, { recursive: true });
    writeFileSync(join(profilesDir, 'application.yaml'), [
      'profile: application',
      'blocks: []',
      'nav:',
      '  top:',
      '    - cover',
      '    - signal-list',
      '    - risk-register',
    ].join('\n'), 'utf-8');

    const fakeRunDir = join(ws, 'apps', 'test-app', 'wsp', 'runs', '2026-01-01T00-00-00');

    // Template that includes the site-header__nav block so the replacement can fire
    const tmplWithNav = `<html><head></head><body>
<nav class="site-header__nav" aria-label="Main navigation">
  <a href="#cover">Overview</a>
  <a href="#compliance-regime">Compliance</a>
</nav>
<!--SWAO:slot name="coverage-bar"-->
</body></html>`;

    const html = assemblePublicationPage({
      template: tmplWithNav,
      model: minimalModel(),
      timestamp: '',
      wspRunDir: fakeRunDir,
      logger: { warn: () => {}, info: () => {}, error: () => {} },
    });

    // Nav must contain only the profile-specified links
    expect(html).toContain('href="#cover"');
    expect(html).toContain('href="#signal-list"');
    expect(html).toContain('href="#risk-register"');
    // compliance-regime was not in nav.top -- must not appear in the nav
    expect(html).not.toContain('href="#compliance-regime"');
  });

  it('#1252 -- em-dashes and en-dashes in model string fields are sanitised from embedded JSON blocks', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-emdash-'));
    const fakeRunDir = join(ws, 'apps', 'test-app', 'wsp', 'runs', '2026-01-01T00-00-00');
    const tmpl = `<html><head></head><body><!--swao:css--><!--swao:js--><!--SWAO:slot name="cover"--></body></html>`;

    const modelWithDashes = {
      ...minimalModel(),
      meta: { ...minimalModel().meta, app_name: 'App with em\u2014dash and en\u2013dash' },
    } as unknown as PublicationModel;

    const html = assemblePublicationPage({
      template: tmpl,
      model: modelWithDashes,
      timestamp: '2026-01-01T00:00:00Z',
      wspRunDir: fakeRunDir,
      logger: { warn: () => {}, info: () => {}, error: () => {} },
    });

    // swao-pub-data JSON block must have no literal em/en-dashes
    const pubDataBlock = html.match(/<script[^>]*id="swao-pub-data">([\s\S]*?)<\/script>/)?.[1] ?? '';
    expect(pubDataBlock.includes('\u2014')).toBe(false);
    expect(pubDataBlock.includes('\u2013')).toBe(false);
    expect(pubDataBlock).toContain(' -- ');
  });

  it('Step 7 -- no nav.top in profile leaves nav unchanged', () => {
    // Profile without nav.top -- template nav must be unchanged
    const ws = mkdtempSync(join(tmpdir(), 'swao-step7-nonav-'));
    const profilesDir = join(ws, 'wsp', 'templates', 'profiles');
    mkdirSync(profilesDir, { recursive: true });
    writeFileSync(join(profilesDir, 'application.yaml'), 'profile: application\nblocks: []\n', 'utf-8');

    const fakeRunDir = join(ws, 'apps', 'test-app', 'wsp', 'runs', '2026-01-01T00-00-00');

    const tmplWithNav = `<html><head></head><body>
<nav class="site-header__nav" aria-label="Main navigation">
  <a href="#cover">Overview</a>
  <a href="#compliance-regime">Compliance</a>
</nav>
<!--SWAO:slot name="coverage-bar"-->
</body></html>`;

    const html = assemblePublicationPage({
      template: tmplWithNav,
      model: minimalModel(),
      timestamp: '',
      wspRunDir: fakeRunDir,
      logger: { warn: () => {}, info: () => {}, error: () => {} },
    });

    // Both original links must still be present
    expect(html).toContain('href="#cover"');
    expect(html).toContain('href="#compliance-regime"');
  });
});
