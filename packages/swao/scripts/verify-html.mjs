import { chromium } from 'playwright';

const url = 'file:///C:/swao-uat/apps/sovereign-health/wsp/publications/2026-06-03T09-57-37-sovereign-health.html';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push('PAGEERROR: ' + e.message));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2500);

// Deep-dive: why is search not working?
const diagnosis = await page.evaluate(() => {
  const d = document;
  const input = d.getElementById('swao-global-search');
  const overlay = d.getElementById('swao-search-overlay');
  const searchIndexEl = d.getElementById('swao-search-index');

  // How many docs in search index?
  let searchDocs = [];
  let parseError = null;
  if (searchIndexEl) {
    try { searchDocs = JSON.parse(searchIndexEl.textContent || '[]'); }
    catch(e) { parseError = e.message; }
  }

  // Check if swaoNavigateToSignal is defined
  const hasNavigate = typeof window.swaoNavigateToSignal === 'function';
  const hasScrollTo = typeof window.swaoScrollTo === 'function';

  // Try firing the input event manually and check overlay after
  if (input) {
    input.value = 'gdpr';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const overlayAfter = {
    display: overlay?.style.display,
    hidden: overlay?.hasAttribute('hidden'),
  };

  return {
    searchIndexElFound: !!searchIndexEl,
    searchIndexTextLength: searchIndexEl?.textContent?.length,
    searchDocsCount: searchDocs.length,
    sampleDoc: searchDocs[0],
    parseError,
    overlayAfterManualFire: overlayAfter,
    hasNavigateToSignal: hasNavigate,
    hasScrollTo,
    initSwaoTableDefined: typeof window.initSwaoTable === 'function',
  };
});

console.log('\n=== SEARCH DEEP DIAGNOSIS ===');
console.log('search index element found:', diagnosis.searchIndexElFound);
console.log('search index text length:', diagnosis.searchIndexTextLength);
console.log('search docs count:', diagnosis.searchDocsCount);
console.log('sample doc:', JSON.stringify(diagnosis.sampleDoc)?.slice(0, 120));
console.log('parse error:', diagnosis.parseError);
console.log('overlay after manual input event:', JSON.stringify(diagnosis.overlayAfterManualFire));
console.log('swaoNavigateToSignal defined:', diagnosis.hasNavigateToSignal);
console.log('swaoScrollTo defined:', diagnosis.hasScrollTo);
console.log('initSwaoTable defined:', diagnosis.initSwaoTableDefined);
console.log('JS errors:', jsErrors);

// Check Assessment History row expand content more carefully
const histExpand = await page.evaluate(() => {
  const histSection = document.getElementById('run-history');
  if (!histSection) return 'run-history section NOT FOUND';
  const btn = histSection.querySelector('.expand-btn');
  if (!btn) return 'no expand-btn in run-history';
  btn.click();
  const detail = histSection.querySelector('.row-detail:not([hidden])');
  return detail ? detail.innerHTML.slice(0, 400) : 'no visible detail row';
});
console.log('\n=== ASSESSMENT HISTORY EXPAND ===');
console.log(histExpand);

// Check if the run-history table has signal_counts data
const histData = await page.evaluate(() => {
  const scripts = document.querySelectorAll('script:not([type])');
  for (const s of scripts) {
    if (s.textContent.includes('run-history') && s.textContent.includes('rows')) {
      const m = s.textContent.match(/"rows":\[([^\]]*)\]/);
      return m ? m[0].slice(0, 300) : 'rows key found but no match';
    }
  }
  return 'run-history table script not found';
});
console.log('\n=== RUN HISTORY TABLE DATA ===');
console.log(histData);

await browser.close();
