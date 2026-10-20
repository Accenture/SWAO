// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3290 (Design 110 D-26), HTML publication sink: a German intake, scaffolded
// the way `swao service init` does it, renders through `swao publish` (Mode A)
// with the English canonical values (#3210). This package is the one that
// reaches both the scaffold (@swao/module-service-assessment) and the renderer
// (@swao/module-html-report). The text report, workbook and star schema sinks
// are tested in the private premium module @swao/module-service-export (#3353).
// Synthetic data only.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump } from 'js-yaml';
import { buildPortfolioSummary, loadInfraCatalogue, parseIntakeSheets, planScaffold, writeScaffold, type SheetLike } from '@swao/module-service-assessment';
import { renderModeA } from '@swao/module-html-report';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const TS = '2026-10-17T08:00:00.000Z';
const RUN = '2026-10-17T08-00-00';
const quiet = { warn() {}, info() {}, error() {} };

const HEADERS = ['App-ID', 'Anwendungsname', 'Hersteller', 'Betriebssystem', 'Fachbereich', 'App-Funktion', 'Kritikalität', 'Datenklassifizierung', 'Time-Einstufung'];
const ROW = ['HOSAPP901', 'Viewer One', 'Example Imaging', 'Windows Server 2019', 'Radiologie', 'Befundung', 'Hoch', 'Vertraulich', 'Investieren'];
const GERMAN = ['Radiologie', 'Befundung', 'Hoch', 'Vertraulich', 'Investieren'];

function sheet(name: string, headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string>>): SheetLike {
  const grid = [headers, ...rows];
  return { name, rowCount: grid.length, cell: (r, c) => grid[r - 1]?.[c - 1] ?? null };
}

/**
 * Replace every `open ... close` span left to right, the first `close` after
 * each `open` ending it (what a lazy `open[\s\S]*?close` regex with the g flag
 * replaced). `open` and `close` are lower case; with `ci` the match ignores
 * ASCII case. A scan instead of regex replaces (CodeQL
 * js/incomplete-multi-character-sanitization, js/bad-tag-filter); it removes
 * exactly the same spans as the former regexes, no more.
 */
const replaceSpans = (html: string, open: string, close: string, ci: boolean, by = '') => {
  const hay = ci ? html.replace(/[A-Z]+/g, (m) => m.toLowerCase()) : html;
  let out = '';
  let pos = 0;
  for (;;) {
    const start = hay.indexOf(open, pos);
    if (start < 0) break;
    const end = hay.indexOf(close, start + open.length);
    if (end < 0) break;
    out += html.slice(pos, start) + by;
    pos = end + close.length;
  }
  return out + html.slice(pos);
};

/** Visible text of a page: no script, style or comment blocks, each tag replaced by a space. */
const visibleText = (html: string) => replaceSpans(
  replaceSpans(replaceSpans(replaceSpans(html, '<script', '</script>', true), '<style', '</style>', true), '<!--', '-->', false),
  '<', '>', false, ' ',
);

describe('visibleText test helper', () => {
  it('drops the same blocks the former regexes did and replaces each tag by a space', () => {
    expect(visibleText('<p>Hoch</p><SCRIPT>x</Script><style>.a{}</style><!-- Vertraulich --><b>High</b>')).toBe(' Hoch  High ');
    expect(visibleText('a<b<c>d>e')).toBe('a d>e');
    expect(visibleText('<script>unclosed')).toBe(' unclosed');
    expect(visibleText('')).toBe('');
  });
});

describe('German intake values render in English in the HTML publication (#3290, D-26)', () => {
  let html = '';
  let pubData: { service?: { app?: Record<string, unknown>; apm?: Record<string, unknown> } } = {};

  beforeAll(async () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-3290-pub-'));
    dirs.push(ws);
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\nengagement:\n  name: Fixture Engagement\n');
    // Scaffold exactly as swao service init does: parse, plan (glossary + fixed scales), write.
    const intake = parseIntakeSheets([sheet('Anwendungen', HEADERS, [ROW])]);
    const plan = planScaffold(intake.rows, loadInfraCatalogue(), { generatedAt: '2026-10-17' });
    writeScaffold(ws, plan.apps, plan.signals, {
      source: 'intake.xlsx', mapping: null, imported_at: '2026-10-17', app_count: plan.apps.length, row_count: 1,
      sheets: ['Anwendungen'], headers: {}, pii_columns: [], cluster_threshold: 3,
    });
    const appDir = join(ws, 'apps', 'hosapp901');
    expect(readFileSync(join(appDir, '.swao.yml'), 'utf-8')).toMatch(/function_source: Befundung/);

    // A service run, then the portfolio summary writes its apm-score.json (analyst TIME from the intake).
    const run = join(appDir, 'wsp', 'runs', RUN);
    mkdirSync(join(run, 'passes'), { recursive: true });
    writeFileSync(join(run, 'run-context.yaml'), dump({ assessment_type: 'service' }));
    writeFileSync(join(run, 'wsp.yaml'), dump({
      schema_version: '0.10', app_id: 'hosapp901', run_id: RUN, assessed_at: TS, app: { name: 'Viewer One' },
      overall: { seven_r_label: 'Rehost', coverage_score: 0.5 }, landing_zone: { primary: '' },
      engagement: { name: 'Fixture Engagement', client_code: 'fx', partnership_lead: 'lead@example.com' },
    }));
    writeFileSync(join(appDir, 'wsp', 'latest-service.txt'), `runs/${RUN}`);
    buildPortfolioSummary(ws, { now: new Date(TS) });

    const out = join(ws, 'pub.html');
    await renderModeA({ wspRunDir: run, outputPath: out, lang: 'en', timestamp: TS, swaoVersion: '9.9.9', workspaceDir: ws, logger: quiet });
    html = readFileSync(out, 'utf-8');
    const json = /<script type="application\/json" id="swao-pub-data">([\s\S]*?)<\/script>/.exec(html)?.[1];
    pubData = json ? JSON.parse(json) : {};
  });

  it('the Vendor Profile and SWAO_APM blocks show the English function, criticality and analyst TIME', () => {
    expect(html).toMatch(/Business function<\/th><td>Diagnostic Reporting</);
    expect(html).toMatch(/Criticality<\/th><td>high</);
    expect(html).toMatch(/Analyst TIME \(intake\)<\/th><td>Invest</);
    expect(pubData.service?.app).toMatchObject({ business_function: 'Diagnostic Reporting', criticality: 'high' });
    expect(pubData.service?.apm?.['analyst_time']).toBe('Invest');
  });

  it('no German intake term reaches the visible page or the embedded publication data', () => {
    const text = visibleText(html);
    const data = JSON.stringify(pubData);
    for (const g of GERMAN) {
      expect(text, g).not.toMatch(new RegExp(`\\b${g}\\b`));
      expect(data, g).not.toContain(g);
    }
  });
});
