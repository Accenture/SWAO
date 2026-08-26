// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  HTML portal module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Tests for portal-builder.ts -- Sprint 064 #0582, Design 058 D-PORTAL-4
 *
 * Principle 9: the fixture workspace uses PLACEHOLDER app ids/names only
 * (alpha-svc / beta-app / gamma-portal). No reference-app data is required;
 * minimal synthetic WSPs are generated into a temp dir (nothing committed).
 *
 * The load-bearing assertions:
 *   - portfolio index lists every app;
 *   - per-app pages exist with the expected grouped blocks; empty collections
 *     are skipped gracefully;
 *   - every page inlines the publication CSS (id="swao-pub-css") and uses the
 *     publication shell markers (proving shell reuse, not custom markup);
 *   - two builds are byte-identical (determinism, D-PORTAL-3);
 *   - PARITY: a portal Overview page rendered from the SAME app model produces
 *     the byte-identical <style id="swao-pub-css"> element AND the byte-identical
 *     <section id="cover"> block that renderModeA produces -- i.e. the portal did
 *     not re-implement the block markup or the stylesheet.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';

import { buildPortalSite } from './portal-builder.js';
import type { BuildPortalSiteResult } from './portal-builder.js';
// PARITY REFERENCE: the byte-identical-parity test below compares the portal's
// Overview against a Mode A render of the same app. This Consultant module must
// not import renderModeA from its Community sibling (@swao/module-html-report),
// so the reference is assembled DIRECTLY through the shared
// @swao/publication-render leaf -- the same pipeline renderModeA itself wraps
// (extract -> sanitise -> assemblePublicationPage over the bundled shell). Since
// renderModeA is a thin wrapper over assemblePublicationPage, the inlined
// <style id="swao-pub-css"> element and the <section id="cover"> block are
// pipeline outputs independent of the shell, so this reference is byte-identical
// to renderModeA's for those two elements (the assertions are unchanged).
import {
  extractPublicationModel,
  sanitisePII,
  assemblePublicationPage,
  BUNDLED_TEMPLATE_CONTENT,
} from '@swao/publication-render';

// ---------------------------------------------------------------------------
// Placeholder fixture workspace (Principle 9)
// ---------------------------------------------------------------------------

const RUN_TS = '2026-01-01T00-00-00';
const FIXED_TS = '2026-01-01T00:00:00.000Z';

interface AppSpec {
  id: string;
  name: string;
  withSignals?: boolean;
  /** overall.coverage_score written into wsp.yaml (drives the readiness band). */
  coverage?: string;
  /** Highest signal severity emitted (a critical/high signal -> blocker -> Blocked band). */
  topSeverity?: 'critical' | 'high' | 'medium' | 'low';
  /** Compliance regimes -> framework coverage aggregation (id -> {pass, partial, fail}). */
  frameworks?: Array<{ id: string; name: string; pass: number; partial: number; fail: number }>;
  /** Risk triggers -> cross-app risk grouping (shared trigger across apps = one pattern). */
  riskTriggers?: string[];
}

function writeApp(workspace: string, spec: AppSpec): void {
  const appWsp = join(workspace, 'apps', spec.id, 'wsp');
  const run = join(appWsp, 'runs', RUN_TS);
  mkdirSync(run, { recursive: true });
  writeFileSync(join(appWsp, 'latest.txt'), `runs/${RUN_TS}`, 'utf-8');

  writeFileSync(
    join(run, 'wsp.yaml'),
    [
      "schema_version: '0.10'",
      `app_id: ${spec.id}`,
      "run_id: 'r-fixed'",
      "assessed_at: '2026-01-01'",
      'workload:',
      `  name: ${spec.name}`,
      'overall:',
      '  seven_r_label: Replatform',
      `  coverage_score: '${spec.coverage ?? '0.5'}'`,
      '',
    ].join('\n'),
    'utf-8',
  );

  if (spec.withSignals) {
    const sev = spec.topSeverity ?? 'medium';
    mkdirSync(join(run, 'passes'), { recursive: true });
    writeFileSync(
      join(run, 'passes', '08-crypto.yaml'),
      [
        'pass:',
        '  id: 8',
        '  name: crypto_posture',
        '  signal_prefix: CRYPTO',
        '  status: complete',
        '  iter: 1',
        'signals:',
        '  - id: CRYPTO-01',
        '    source: static_analysis',
        '    category: infrastructure_platform',
        `    severity: ${sev}`,
        '    derivation: Placeholder signal text long enough to clear the twenty character minimum.',
        '    evidence: []',
        '    confidence: high',
        '    implies: []',
        '    outcome: negative',
        "    assessed_at: '2026-01-01'",
        'assessment:',
        '  overall_posture: unknown',
        '',
      ].join('\n'),
      'utf-8',
    );
  }

  // wsp-plan.yaml drives compliance regimes + risk register (extractor §4/§10).
  if (spec.frameworks || spec.riskTriggers) {
    const lines: string[] = [];
    if (spec.riskTriggers && spec.riskTriggers.length > 0) {
      lines.push('risk_register:');
      spec.riskTriggers.forEach((trigger, i) => {
        lines.push(`  - risk_id: RR-00${i + 1}`);
        lines.push(`    trigger: ${trigger}`);
        lines.push('    category: security');
        lines.push('    likelihood: high');
        lines.push('    impact: high');
        lines.push('    mitigation: Placeholder mitigation text.');
        lines.push('    owner: Platform Lead');
      });
    }
    if (spec.frameworks && spec.frameworks.length > 0) {
      lines.push('compliance:');
      lines.push('  regimes:');
      for (const fw of spec.frameworks) {
        lines.push(`    - id: ${fw.id}`);
        lines.push(`      name: ${fw.name}`);
        lines.push('      controls:');
        let n = 0;
        const ctrl = (status: string) => {
          n++;
          lines.push(`        - id: ${fw.id}-C${n}`);
          lines.push(`          title: Control ${n}`);
          lines.push(`          status: ${status}`);
          lines.push('          rationale: Placeholder rationale.');
        };
        for (let i = 0; i < fw.pass; i++) ctrl('SATISFIED');
        for (let i = 0; i < fw.partial; i++) ctrl('PARTIAL');
        for (let i = 0; i < fw.fail; i++) ctrl('FAIL');
      }
    }
    writeFileSync(join(run, 'wsp-plan.yaml'), lines.join('\n') + '\n', 'utf-8');
  }
}

function makeWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-portal-fix-'));
  // alpha-svc: high coverage, a HIGH signal (blocker -> Blocked band), GDPR + shared risk.
  writeApp(ws, {
    id: 'alpha-svc', name: 'Alpha Service', withSignals: true,
    coverage: '0.9', topSeverity: 'high',
    frameworks: [{ id: 'GDPR', name: 'GDPR', pass: 2, partial: 1, fail: 1 }],
    riskTriggers: ['Shared crypto weakness', 'Alpha-only risk'],
  });
  // beta-app: no signals (no blocker), low coverage -> Ready with changes band. No frameworks.
  writeApp(ws, { id: 'beta-app', name: 'Beta App', coverage: '0.4' });
  // gamma-portal: high coverage, a MEDIUM signal (no blocker) -> Ready band; GDPR + NIS2; shared risk.
  writeApp(ws, {
    id: 'gamma-portal', name: 'Gamma Portal', withSignals: true,
    coverage: '0.95', topSeverity: 'medium',
    frameworks: [
      { id: 'GDPR', name: 'GDPR', pass: 3, partial: 0, fail: 0 },
      { id: 'NIS2', name: 'NIS2', pass: 1, partial: 1, fail: 0 },
    ],
    riskTriggers: ['Shared crypto weakness'],
  });
  return ws;
}

// ---------------------------------------------------------------------------
// Shared build
// ---------------------------------------------------------------------------

let workspace: string;
let outDir: string;
let result: BuildPortalSiteResult;

beforeAll(async () => {
  workspace = makeWorkspace();
  outDir = mkdtempSync(join(tmpdir(), 'swao-portal-out-'));
  result = await buildPortalSite({
    workspace,
    outDir,
    timestamp: FIXED_TS,
    swaoVersion: '0.0.0-test',
  });
}, 60_000);

function read(rel: string): string {
  return readFileSync(join(outDir, rel), 'utf-8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildPortalSite', { timeout: 60_000 }, () => {
  it('discovers all three placeholder apps', () => {
    expect(result.appIds).toEqual(['alpha-svc', 'beta-app', 'gamma-portal']);
  });

  it('portfolio index lists every app with a card link', () => {
    const idx = read('index.html');
    for (const id of ['alpha-svc', 'beta-app', 'gamma-portal']) {
      expect(idx).toContain(`apps/${id}/index.html`);
    }
    // The portfolio-grid section + card markup are reused from the block.
    expect(idx).toContain('id="portfolio-grid"');
    expect(idx).toContain('class="swao-card"');
    // Three cards, one per app.
    expect(idx.match(/class="swao-card"/g)?.length).toBe(3);
  });

  it('per-app Overview pages exist with the grouped Overview blocks', () => {
    for (const id of ['alpha-svc', 'beta-app', 'gamma-portal']) {
      const rel = `apps/${id}/index.html`;
      expect(existsSync(join(outDir, rel))).toBe(true);
      const html = read(rel);
      expect(html).toContain('id="cover"');
      expect(html).toContain('id="exec-summary"');
      expect(html).toContain('id="seven-r-card"');
      expect(html).toContain('id="coverage-bar"');
    }
  });

  it('renders the signals page only for apps with signals (skips empty gracefully)', () => {
    expect(existsSync(join(outDir, 'apps/alpha-svc/signals/index.html'))).toBe(true);
    expect(existsSync(join(outDir, 'apps/gamma-portal/signals/index.html'))).toBe(true);
    // beta-app has no signals -> no signals page.
    expect(existsSync(join(outDir, 'apps/beta-app/signals/index.html'))).toBe(false);
    const sig = read('apps/alpha-svc/signals/index.html');
    expect(sig).toContain('id="signal-list"');
  });

  it('every page inlines the publication CSS and uses the publication shell', () => {
    for (const rel of result.pages) {
      const html = read(rel);
      // Inlined swao-pub.css proves the publication stylesheet, not a link.
      expect(html).toContain('id="swao-pub-css"');
      expect(html).not.toContain('<link rel="stylesheet"');
      // Publication shell markers (same structure as the Mode A bundled template).
      expect(html).toContain('class="band band-top"');
      expect(html).toContain('class="site-header"');
      expect(html).toContain('class="main-content"');
    }
  });

  it('every page carries the portal nav-link set (Portfolio + Programme + Tags + Frameworks + each app)', () => {
    // Increment 2: Programme / Tags / Frameworks are live links now, on EVERY page.
    for (const rel of result.pages) {
      const html = read(rel);
      expect(html).toContain('id="portal-nav"');
      expect(html).toContain('>Portfolio<');
      expect(html).toContain('>Programme<');
      expect(html).toContain('>Tags<');
      expect(html).toContain('>Frameworks<');
      expect(html).toContain('>Alpha Service<');
      expect(html).toContain('>Beta App<');
      expect(html).toContain('>Gamma Portal<');
    }
  });

  it('is deterministic: two builds produce byte-identical HTML', async () => {
    const out2 = mkdtempSync(join(tmpdir(), 'swao-portal-out2-'));
    const r2 = await buildPortalSite({
      workspace,
      outDir: out2,
      timestamp: FIXED_TS,
      swaoVersion: '0.0.0-test',
    });
    expect(r2.pages).toEqual(result.pages);
    for (const rel of result.pages) {
      const a = read(rel);
      const b = readFileSync(join(out2, rel), 'utf-8');
      expect(b).toBe(a);
    }
  }, 60_000);

  it('has no timestamp/run-id strings in the page body (D-PORTAL-3)', () => {
    for (const rel of result.pages) {
      const html = read(rel);
      // RUN_TS would leak a run id; FIXED_TS only ever appears (if at all) inside
      // the machine-readable swao-pub-data JSON, never as visible body text.
      expect(html).not.toContain(RUN_TS);
    }
  });
});

// ---------------------------------------------------------------------------
// Structural parity with renderModeA (the whole point of D-PORTAL-4)
// ---------------------------------------------------------------------------

describe('portal/publication parity', { timeout: 60_000 }, () => {
  function extractElement(html: string, openMarker: string, closeTag: string): string {
    const start = html.indexOf(openMarker);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = html.indexOf(closeTag, start);
    expect(end).toBeGreaterThanOrEqual(0);
    return html.slice(start, end + closeTag.length);
  }

  it('portal Overview reuses the publication CSS + cover block byte-for-byte', async () => {
    // Reference Mode A render of the SAME app (alpha-svc), assembled directly
    // through the shared leaf pipeline (the exact steps renderModeA wraps), so
    // the comparison is meaningful WITHOUT importing the Community sibling.
    const refRun = join(workspace, 'apps', 'alpha-svc', 'wsp', 'runs', RUN_TS);
    const refModel = await extractPublicationModel(refRun, { swaoVersion: '0.0.0-test' });
    sanitisePII(refModel);
    const modeA = assemblePublicationPage({
      template: BUNDLED_TEMPLATE_CONTENT,
      model: refModel,
      wspRunDir: refRun,
      timestamp: FIXED_TS,
    });
    const portal = read('apps/alpha-svc/index.html');

    // (a) Inlined stylesheet element is identical -> CSS parity is structural.
    const cssA = extractElement(modeA, '<style id="swao-pub-css">', '</style>');
    const cssP = extractElement(portal, '<style id="swao-pub-css">', '</style>');
    expect(cssP).toBe(cssA);

    // (b) The cover block section is identical -> the portal renders the same
    //     renderBlock output (post term-wrapping), not its own markup.
    const coverA = extractElement(modeA, '<section id="cover"', '</section>');
    const coverP = extractElement(portal, '<section id="cover"', '</section>');
    expect(coverP).toBe(coverA);
  });
});

// ---------------------------------------------------------------------------
// Increment 2: programme dashboard + cross-app aggregate pages
// ---------------------------------------------------------------------------

describe('programme dashboard + cross-app pages', { timeout: 60_000 }, () => {
  it('emits programme/tags/frameworks index pages alongside the per-app sites', () => {
    for (const rel of ['programme/index.html', 'tags/index.html', 'frameworks/index.html']) {
      expect(result.pages).toContain(rel);
      expect(existsSync(join(outDir, rel))).toBe(true);
    }
  });

  it('every aggregate page inlines swao-pub.css through the shared shell (no portal-only style)', () => {
    for (const rel of ['programme/index.html', 'tags/index.html', 'frameworks/index.html']) {
      const html = read(rel);
      // Exactly one <style> element, and it is the publication's inlined sheet.
      expect(html).toContain('<style id="swao-pub-css">');
      expect(html.match(/<style\b/g)?.length).toBe(1);
      expect(html).not.toContain('<link rel="stylesheet"');
      // Publication shell markers (assemblePublicationPage reuse).
      expect(html).toContain('class="band band-top"');
      expect(html).toContain('class="site-header"');
      expect(html).toContain('class="main-content"');
    }
  });

  it('dashboard aggregate markup uses swao-pub.css classes (stats-strip / swao-card / badge)', () => {
    const dash = read('programme/index.html');
    expect(dash).toContain('class="stats-strip"');
    expect(dash).toContain('class="stat-item');
    expect(dash).toContain('class="badge ');
    const fw = read('frameworks/index.html');
    expect(fw).toContain('class="swao-card"');
    const tags = read('tags/index.html');
    expect(tags).toContain('class="badge badge-tag"');
  });

  it('readiness bands bucket apps correctly (Blocked=1, Ready=1, Ready-with-changes=1)', () => {
    const dash = read('programme/index.html');
    // alpha (high signal -> blocker) = Blocked; gamma (medium, cov 0.95) = Ready;
    // beta (no signals, cov 0.4) = Ready with changes. One app per band.
    const band = (label: string): number => {
      // The band strip renders the count value adjacent to the label.
      const re = new RegExp(`<div class="stat-item__value"[^>]*>(\\d+)</div>\\s*<div class="stat-item__label"[^>]*>${label}</div>`);
      const m = dash.match(re);
      return m ? Number(m[1]) : -1;
    };
    expect(band('Ready')).toBe(1);
    expect(band('Ready with changes')).toBe(1);
    expect(band('Blocked')).toBe(1);
  });

  it('blockers-by-severity sums signal_counts across apps (high=1, medium=1)', () => {
    const dash = read('programme/index.html');
    // alpha emits a HIGH signal, gamma a MEDIUM signal -> high=1, medium=1.
    const sev = (label: string): number => {
      const re = new RegExp(`<div class="stat-item__value"[^>]*>(\\d+)</div>\\s*<div class="stat-item__label"[^>]*><span class="badge [^"]*">${label}</span></div>`);
      const m = dash.match(re);
      return m ? Number(m[1]) : -1;
    };
    expect(sev('High')).toBe(1);
    expect(sev('Medium')).toBe(1);
  });

  it('framework coverage aggregates per framework (GDPR: 2 apps, 5/7 pass; NIS2: 1 app)', () => {
    const dash = read('programme/index.html');
    // GDPR assessed by alpha (2p/1pa/1f) + gamma (3p) = 5 pass / 7 total = 71%.
    expect(dash).toMatch(/GDPR[\s\S]*?<td[^>]*>2<\/td>[\s\S]*?71% <span[^>]*>\(5\/7\)/);
    // NIS2 assessed by gamma only (1p/1pa) = 1 app, 50% (1/2).
    expect(dash).toMatch(/NIS2[\s\S]*?<td[^>]*>1<\/td>[\s\S]*?50% <span[^>]*>\(1\/2\)/);
  });

  it('cross-app risks group a shared trigger and list both affected apps', () => {
    const dash = read('programme/index.html');
    // "Shared crypto weakness" recurs in alpha + gamma -> ONE grouped row listing both.
    expect(dash).toContain('Shared crypto weakness');
    // The shared group's row links to both apps' risk pages.
    const rowStart = dash.indexOf('Shared crypto weakness');
    const rowSlice = dash.slice(rowStart, rowStart + 400);
    expect(rowSlice).toContain('apps/alpha-svc/risk/index.html');
    expect(rowSlice).toContain('apps/gamma-portal/risk/index.html');
    // Grouped, not duplicated: within the rendered dashboard section the trigger
    // appears exactly once. (It also appears inside the inlined swao-pub-data /
    // search-index JSON carried by the shell -- that is the publication's model
    // payload, not the rendered table -- so we scope the count to the section.)
    const sectionStart = dash.indexOf('id="programme-dashboard"');
    const sectionEnd = dash.indexOf('</section>', sectionStart);
    const section = dash.slice(sectionStart, sectionEnd);
    expect(section.match(/Shared crypto weakness/g)?.length).toBe(1);
    // The alpha-only risk stays a separate single-app pattern.
    expect(section).toContain('Alpha-only risk');
  });

  it('per-app table lists every app with verdict + coverage + link', () => {
    const dash = read('programme/index.html');
    for (const id of ['alpha-svc', 'beta-app', 'gamma-portal']) {
      expect(dash).toContain(`apps/${id}/index.html`);
    }
  });

  it('tags index aggregates tags and lists the apps each covers', () => {
    const tags = read('tags/index.html');
    // 'high' tag (from alpha's HIGH signal) lists alpha; 'gdpr' lists alpha + gamma.
    expect(tags).toContain('class="badge badge-tag"');
    // GDPR framework tag covers both apps that assessed it.
    const gdprStart = tags.indexOf('>gdpr<');
    expect(gdprStart).toBeGreaterThanOrEqual(0);
    const gdprSlice = tags.slice(gdprStart, gdprStart + 400);
    expect(gdprSlice).toContain('apps/alpha-svc/index.html');
    expect(gdprSlice).toContain('apps/gamma-portal/index.html');
  });

  it('frameworks index lists each framework with its assessed apps', () => {
    const fw = read('frameworks/index.html');
    expect(fw).toContain('>GDPR<');
    expect(fw).toContain('>NIS2<');
    expect(fw).toContain('apps/alpha-svc/compliance/index.html');
    expect(fw).toContain('apps/gamma-portal/compliance/index.html');
  });
});
