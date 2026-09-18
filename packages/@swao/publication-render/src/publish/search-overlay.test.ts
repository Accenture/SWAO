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

// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Rationale: swao-pub.js is a non-module browser script loaded via eval()
// (same pattern as swao-table.test.ts).
//
// #1384 regression: search docs of type lzr-region / lzr-check matched the
// query but were dropped at the grouping stage (GROUP_ORDER did not contain
// their type and the 'other' fallback only fired for a MISSING type), so the
// overlay reported a result count with zero rendered rows.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect, beforeEach } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SWAO_PUB_JS = join(__dirname, 'assets/swao-pub.js');

interface SearchDoc {
  id: string;
  type: string;
  label: string;
  body: string;
}

function bootWithDocs(docs: SearchDoc[], extraHtml = ''): void {
  document.body.innerHTML = `
    <input id="swao-global-search" />
    <div id="swao-search-overlay" style="display:none">
      <button id="swao-search-close"></button>
      <span id="swao-search-query-label"></span>
      <span id="swao-search-count"></span>
      <div id="swao-search-results"></div>
    </div>
    <script type="application/json" id="swao-search-index">${JSON.stringify(docs)}</script>
    ${extraHtml}
  `;
  const code = readFileSync(SWAO_PUB_JS, 'utf-8');
  (0, eval)(code);
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

function search(query: string): HTMLElement {
  const input = document.getElementById('swao-global-search') as HTMLInputElement;
  input.value = query;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return document.getElementById('swao-search-results') as HTMLElement;
}

const LZR_DOCS: SearchDoc[] = [
  {
    id: 'lzr-region-stackit-eu01',
    type: 'lzr-region',
    label: 'stackit eu01',
    body: 'stackit eu01 READY Region eu01 satisfies the sovereignty requirements derived from BSI_C5, GDPR.',
  },
  {
    id: 'lzr-check-001',
    type: 'lzr-check',
    label: 'postgresql',
    body: 'LZC-001 postgresql pass INV-10 stackit eu01 postgresql is offered in eu01',
  },
  {
    id: 'signal-INV-10',
    type: 'signal',
    label: 'INV-10',
    body: 'INV-10 high inventory postgres dependency detected',
  },
];

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('search overlay lzr result groups (#1384)', () => {
  it('renders rows for lzr-region and lzr-check matches (case-insensitive)', () => {
    bootWithDocs(LZR_DOCS, '<section id="lzr-summary"></section>');
    const results = search('STACKIT');
    const rows = results.querySelectorAll('.search-result');
    expect(rows.length).toBe(2);
    expect(results.innerHTML).toContain('Landing Zone Regions');
    expect(results.innerHTML).toContain('Landing Zone Checks');
    const count = document.getElementById('swao-search-count')!;
    expect(count.textContent).toContain('2');
  });

  it('lzr results link to the LZ section the publication actually rendered', () => {
    bootWithDocs(LZR_DOCS, '<section id="lzr-summary"></section>');
    const results = search('stackit');
    const link = results.querySelector('.search-result a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('#lzr-summary');
  });

  it('lzr results prefer lzr-catalog-header when present', () => {
    bootWithDocs(LZR_DOCS, '<section id="lzr-catalog-header"></section><section id="lzr-summary"></section>');
    const results = search('stackit');
    const link = results.querySelector('.search-result a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('#lzr-catalog-header');
  });

  it('unknown doc types fall into a rendered Other group instead of vanishing', () => {
    bootWithDocs([
      { id: 'future-1', type: 'future-block', label: 'future doc', body: 'searchable future content' },
    ]);
    const results = search('future');
    const rows = results.querySelectorAll('.search-result');
    expect(rows.length).toBe(1);
    expect(results.innerHTML).toContain('Other');
  });

  it('signal docs still render in their own group (no regression)', () => {
    bootWithDocs(LZR_DOCS);
    const results = search('INV-10');
    expect(results.innerHTML).toContain('Signals');
    expect(results.querySelectorAll('.search-result').length).toBeGreaterThanOrEqual(1);
  });

  it('section docs render under Page Content and link to their real anchor (#1388)', () => {
    bootWithDocs([
      {
        id: 'section-exec-summary',
        type: 'section',
        label: 'Executive Summary',
        body: 'The sovereign migration narrative mentions Brandenburg data centres.',
        anchor: 'exec-summary',
      } as never,
    ], '<section id="exec-summary"></section>');
    const results = search('Brandenburg');
    expect(results.querySelectorAll('.search-result').length).toBe(1);
    expect(results.innerHTML).toContain('Page Content');
    const link = results.querySelector('.search-result a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('#exec-summary');
  });
});
