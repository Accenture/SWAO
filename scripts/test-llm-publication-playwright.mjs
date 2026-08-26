// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Playwright smoke test for LLM Assessment HTML publication
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Smoke test: generate an LLM Assessment HTML publication from a fixture,
 * load it in headless Chromium via Playwright, and verify the key sections
 * render correctly (#1428-#1431, Design 092 s8/s9.1).
 *
 * Usage: node --experimental-vm-modules swao/scripts/test-llm-publication-playwright.mjs
 *   (or: node swao/scripts/test-llm-publication-playwright.mjs from repo root)
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import pwPkg from '../packages/swao/node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.js';
const { chromium } = pwPkg;
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Load renderModeALlm from the built dist (must run after pnpm run build)
// ---------------------------------------------------------------------------
const RENDERER_DIST = resolve(
  __dirname,
  '../packages/@swao/module-html-report/dist/publish/renderer.js',
);

if (!existsSync(RENDERER_DIST)) {
  console.error('[FAIL] renderer.js not found at', RENDERER_DIST);
  console.error('       Run: pnpm --filter @swao/module-html-report run build');
  process.exit(1);
}

const { renderModeALlm } = await import(pathToFileURL(RENDERER_DIST).href);

// ---------------------------------------------------------------------------
// Build a minimal fixture run directory
// ---------------------------------------------------------------------------
const tmpRoot = mkdtempSync(join(tmpdir(), 'swao-pw-llm-'));
const RUN_TS = '2026-08-07T04-00-00';
const APP_ID = 'sovereign-health';

const compDir = join(tmpRoot, 'llm-assessments', 'swao', RUN_TS, 'comparison');
mkdirSync(compDir, { recursive: true });

writeFileSync(join(compDir, 'publication-model.json'), JSON.stringify({
  schema_version: '1.0',
  kind: 'swao',
  app_id: APP_ID,
  created: '2026-08-07T04:00:00.000Z',
  analysis_mode: 'head-to-head',
  legs: [
    { id: 'gemini-3.6-flash',     connector: 'openrouter', model: 'google/gemini-flash-1.5-8b', primary: true },
    { id: 'deepseek-v4-flash',    connector: 'openrouter', model: 'deepseek/deepseek-chat',      primary: false },
    { id: 'claude-3-5-haiku',     connector: 'anthropic', model: 'claude-3-5-haiku-20241022',   primary: false },
  ],
  weights: {
    performance:       0.15,
    cost:              0.15,
    reliability:       0.20,
    'quality-structural': 0.10,
    security:          0.10,
    'quality-content': 0.30,
  },
  final: {
    score:   { 'gemini-3.6-flash': 87.4, 'deepseek-v4-flash': 82.1, 'claude-3-5-haiku': 94.2 },
    rank:    { 'gemini-3.6-flash': 2,    'deepseek-v4-flash': 3,    'claude-3-5-haiku': 1 },
    weights: { performance: 0.15, cost: 0.15, reliability: 0.20, 'quality-structural': 0.10, security: 0.10, 'quality-content': 0.30 },
    partial: {},
  },
  groups: [
    { group: 'performance',       score: { 'gemini-3.6-flash': 78.0, 'deepseek-v4-flash': 88.0, 'claude-3-5-haiku': 62.0 }, rank: { 'gemini-3.6-flash': 2, 'deepseek-v4-flash': 1, 'claude-3-5-haiku': 3 }, light: { 'gemini-3.6-flash': 'ok', 'deepseek-v4-flash': 'ok', 'claude-3-5-haiku': 'warn' } },
    { group: 'cost',              score: { 'gemini-3.6-flash': 72.0, 'deepseek-v4-flash': 95.0, 'claude-3-5-haiku': 60.0 }, rank: { 'gemini-3.6-flash': 2, 'deepseek-v4-flash': 1, 'claude-3-5-haiku': 3 }, light: { 'gemini-3.6-flash': 'ok', 'deepseek-v4-flash': 'ok', 'claude-3-5-haiku': 'warn' } },
    { group: 'quality-content',   score: { 'gemini-3.6-flash': 91.0, 'deepseek-v4-flash': 76.0, 'claude-3-5-haiku': 98.0 }, rank: { 'gemini-3.6-flash': 2, 'deepseek-v4-flash': 3, 'claude-3-5-haiku': 1 }, light: { 'gemini-3.6-flash': 'ok', 'deepseek-v4-flash': 'warn', 'claude-3-5-haiku': 'ok' } },
  ],
  passGroups: [
    {
      pass_id: '01-inventory',
      legs: {
        'gemini-3.6-flash':  { calls: 1, dnf: 0, latency_p50_ms: 1200, prompt_tokens_median: 1100, completion_tokens_median: 400, cost_usd: 0.001, parse_valid_rate: 1.0, schema_conform_rate: 1.0, size_bucket: 'S' },
        'deepseek-v4-flash': { calls: 1, dnf: 0, latency_p50_ms:  800, prompt_tokens_median: 1000, completion_tokens_median: 350, cost_usd: 0.0005, parse_valid_rate: 1.0, schema_conform_rate: 1.0, size_bucket: 'S' },
        'claude-3-5-haiku':  { calls: 1, dnf: 0, latency_p50_ms: 2100, prompt_tokens_median: 1050, completion_tokens_median: 420, cost_usd: 0.002, parse_valid_rate: 1.0, schema_conform_rate: 1.0, size_bucket: 'S' },
      },
      rank: { 'gemini-3.6-flash': 2, 'deepseek-v4-flash': 1, 'claude-3-5-haiku': 3 },
    },
    {
      pass_id: '07-ctx',
      legs: {
        'gemini-3.6-flash':  { calls: 1, dnf: 0, latency_p50_ms: 9800,  prompt_tokens_median: 68000, completion_tokens_median: 1200, cost_usd: 0.42, parse_valid_rate: 1.0, schema_conform_rate: 1.0, size_bucket: 'XL' },
        'deepseek-v4-flash': { calls: 1, dnf: 0, latency_p50_ms: 6200,  prompt_tokens_median: 67000, completion_tokens_median: 1100, cost_usd: 0.03, parse_valid_rate: 1.0, schema_conform_rate: 1.0, size_bucket: 'XL' },
        'claude-3-5-haiku':  { calls: 1, dnf: 1, latency_p50_ms: 14200, prompt_tokens_median: 69000, completion_tokens_median: 1300, cost_usd: 0.08, parse_valid_rate: 0.0, schema_conform_rate: 0.0, size_bucket: 'XL' },
      },
      rank: { 'gemini-3.6-flash': 2, 'deepseek-v4-flash': 1, 'claude-3-5-haiku': 3 },
    },
  ],
  bucketViews: [],
  findings: [
    { id: 'F-1', severity: 'warn', leg: 'claude-3-5-haiku', pass_id: '07-ctx', type: 'parse-failure', message: 'claude-3-5-haiku: response could not be parsed as expected JSON on pass 07-ctx', metric_impact: 'qs.parse_valid_rate' },
  ],
  narrative: 'claude-3-5-haiku ranked first overall (94.2/100) driven by quality-content dominance (98.0). deepseek-v4-flash led on cost and performance but lost points on quality. A parse failure on the XL-bucket context pass (07-ctx) was the only structural anomaly. No security findings.',
}, null, 2), 'utf-8');

writeFileSync(
  join(tmpRoot, 'llm-assessments', 'swao', 'latest.txt'),
  RUN_TS + '\n',
  'utf-8',
);

// ---------------------------------------------------------------------------
// Render the HTML publication
// ---------------------------------------------------------------------------
console.log('[playwright-smoke] Rendering LLM Assessment HTML publication...');
let outputPath;
try {
  const result = await renderModeALlm({
    workspace: tmpRoot,
    appId: APP_ID,
    runTs: RUN_TS,
    swaoVersion: '0.10.0-test',
  });
  outputPath = result.outputPath;
  console.log(`[playwright-smoke] Rendered: ${outputPath} (${Math.round(result.bytes / 1024)} KB)`);
} catch (err) {
  console.error('[FAIL] renderModeALlm threw:', err);
  rmSync(tmpRoot, { recursive: true, force: true });
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Playwright smoke test
// ---------------------------------------------------------------------------
console.log('[playwright-smoke] Launching Chromium headless...');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const fileUrl = pathToFileURL(outputPath).href;
await page.goto(fileUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

const failures = [];

// 1. Title
const title = await page.title();
if (!title.includes('LLM Assessment') && !title.includes(APP_ID)) {
  failures.push(`Title "${title}" does not mention LLM Assessment or ${APP_ID}`);
} else {
  console.log(`  [ok] title: "${title}"`);
}

// 2. Key section IDs present
const sections = ['llm-header', 'llm-final-ranking', 'llm-group-breakdown', 'llm-pass-table', 'llm-findings', 'llm-methodology', 'llm-narrative'];
for (const id of sections) {
  const el = await page.$(`#${id}`);
  if (!el) {
    failures.push(`Missing section: #${id}`);
  } else {
    console.log(`  [ok] section #${id} present`);
  }
}

// 3. Leg names visible
for (const legId of ['gemini-3.6-flash', 'deepseek-v4-flash', 'claude-3-5-haiku']) {
  const text = await page.textContent('body');
  if (!text?.includes(legId)) {
    failures.push(`Leg ID "${legId}" not visible in body text`);
  } else {
    console.log(`  [ok] leg "${legId}" visible`);
  }
}

// 4. Narrative block
const narrativeEl = await page.$('#llm-narrative');
if (!narrativeEl) {
  failures.push('Narrative section (#llm-narrative) missing despite narrative being present in fixture');
} else {
  const narrativeText = await narrativeEl.textContent();
  if (!narrativeText?.includes('claude-3-5-haiku ranked first')) {
    failures.push(`Narrative text missing expected content. Got: ${narrativeText?.slice(0, 80)}`);
  } else {
    console.log('  [ok] narrative text matches fixture');
  }
}

// 5. Methodology section has caveat text
const methodText = await page.textContent('#llm-methodology');
if (!methodText?.toLowerCase().includes('relative')) {
  failures.push('Methodology section missing "relative" scoring explanation');
} else {
  console.log('  [ok] methodology section contains relative scoring caveat');
}

// 6. Screenshot
const screenshotDir = resolve(__dirname, '../screenshots');
mkdirSync(screenshotDir, { recursive: true });
const screenshotPath = join(screenshotDir, 'llm-assessment-smoke.png');
await page.screenshot({ path: screenshotPath, fullPage: false });
console.log(`[playwright-smoke] Screenshot saved: ${screenshotPath}`);

await browser.close();
rmSync(tmpRoot, { recursive: true, force: true });

if (failures.length > 0) {
  console.error('\n[FAIL] Playwright smoke test failures:');
  for (const f of failures) console.error('  -', f);
  process.exit(1);
} else {
  console.log('\n[PASS] All Playwright smoke checks passed.');
  process.exit(0);
}
