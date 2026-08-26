/**
 * Black Duck vulnerability scraper -- swao v0.3.9
 * Intercepts the API calls the Black Duck UI makes once you log in.
 * No CORS issue because we capture responses at the network level.
 *
 * Usage:
 *   node swao/packages/swao/scripts/scrape-blackduck-vulns.mjs
 *
 * Steps:
 *   1. Edge opens and navigates to the vulnerabilities page.
 *   2. You complete Accenture SSO + MFA in the browser window.
 *   3. Once the vulnerability table loads, the script captures the API responses.
 *   4. Results saved to docs/vulnerability-scan-acn/blackduck-vulns-detail.json
 *
 * Each output row includes:
 *   - apiLink    : direct REST API URL for that vulnerability on that component
 *   - uiLink     : Black Duck UI deep link (project/version/component tab)
 *   - componentApiLink : REST API URL of the affected component version
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR   = join(__dirname, '..', '..', '..', '..', 'docs', 'vulnerability-scan-acn');

const BASE_URL    = 'https://accenture.app.blackduck.com';
const PROJECT_ID  = 'e05a2075-b45c-49f7-a832-d57e8731bdbb';
const VERSION_ID  = 'd4ec9765-bf93-4bbf-b3be-0d08f54a8994';

const VULN_PATH =
  `/api/projects/${PROJECT_ID}/versions/${VERSION_ID}` +
  '/vulnerabilities?filter=securityRisk%3Ahigh&filter=securityRisk%3Acritical&limit=100&offset=0';

const MFA_WAIT_MS = 8 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive a clickable Black Duck UI deep link from an API href.
 *
 * Black Duck API hrefs look like:
 *   /api/components/{cId}/versions/{cvId}/vulnerabilities/{vulnId}
 *   /api/projects/{pId}/versions/{vId}/components/{cvId}
 *
 * The modern Black Duck UI uses Angular hash routing:
 *   /#/versions/id:{vId}/view:components/id:{cvId}/tab-vulnerabilities/vulnerability:{vulnId}
 */
function deriveUiLink(apiHref) {
  if (!apiHref) return '';
  try {
    // Extract IDs from an href like:
    // .../projects/{pId}/versions/{vId}/components/{cvId}/vulnerabilities/{vulnId}
    const compVulnMatch = apiHref.match(
      /projects\/([^/]+)\/versions\/([^/]+)\/components\/([^/]+)\/vulnerabilities\/([^/?]+)/
    );
    if (compVulnMatch) {
      const [, , vId, cvId, vulnId] = compVulnMatch;
      return `${BASE_URL}/#/versions/id:${vId}/view:components/id:${cvId}/tab-vulnerabilities/vulnerability:${vulnId}`;
    }

    // Fallback: .../components/{cId}/versions/{cvId}/vulnerabilities/{vulnId}
    const coreVulnMatch = apiHref.match(
      /components\/([^/]+)\/versions\/([^/]+)\/vulnerabilities\/([^/?]+)/
    );
    if (coreVulnMatch) {
      const [, , cvId, vulnId] = coreVulnMatch;
      return `${BASE_URL}/#/versions/id:${VERSION_ID}/view:components/id:${cvId}/tab-vulnerabilities/vulnerability:${vulnId}`;
    }

    // Fallback: project-level vulnerability href
    const projectVulnMatch = apiHref.match(
      /projects\/([^/]+)\/versions\/([^/]+)\/vulnerabilities\/([^/?]+)/
    );
    if (projectVulnMatch) {
      const [, , vId, vulnId] = projectVulnMatch;
      return `${BASE_URL}/#/versions/id:${vId}/vulnerabilities/${vulnId}`;
    }
  } catch { /* ignore */ }
  return '';
}

/**
 * Extract the component-version API href from the vulnerability item's _meta.links.
 * Black Duck typically includes a 'component-version' or 'component' rel link.
 */
function extractComponentApiLink(v) {
  const links = v._meta?.links || [];
  for (const link of links) {
    if (link.rel === 'component-version' || link.rel === 'component') {
      return link.href || '';
    }
  }
  // Also try the component href embedded in remediationStatus link.
  for (const link of links) {
    if (link.href && link.href.includes('/components/')) {
      return link.href;
    }
  }
  return '';
}

/**
 * Extract component name from a component API href.
 * Cached to avoid repeated fetches; used during page.evaluate calls.
 */
function componentVersionUiLink(componentApiHref) {
  if (!componentApiHref) return '';
  try {
    const m = componentApiHref.match(/\/components\/([^/]+)\/versions\/([^/]+)/);
    if (m) {
      const [, , cvId] = m;
      return `${BASE_URL}/#/versions/id:${VERSION_ID}/view:components/id:${cvId}`;
    }
  } catch { /* ignore */ }
  return '';
}

function toCSV(items) {
  if (!items || items.length === 0) return '';
  const keys = Object.keys(items[0]);
  return [
    keys.join(','),
    ...items.map(item =>
      keys.map(k => `"${String(item[k] ?? '').replace(/"/g, '""')}"`).join(',')
    ),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  mkdirSync(OUT_DIR, { recursive: true });

  const edgeUserDataDir = 'C:\\Users\\helmut.schindlwick\\AppData\\Local\\Microsoft\\Edge\\User Data';

  // Close any running Edge instances so we can reuse the real SSO profile.
  console.log('Closing any running Edge instances (will reopen with your profile)...');
  try {
    execSync('taskkill /F /IM msedge.exe', { stdio: 'pipe' });
    console.log('Edge closed. Waiting 3 seconds for clean shutdown...');
  } catch {
    console.log('No running Edge found (or already closed).');
  }
  await new Promise(r => setTimeout(r, 3000));

  let browser;
  let context;
  try {
    context = await chromium.launchPersistentContext(edgeUserDataDir, {
      channel: 'msedge',
      headless: false,
      slowMo: 30,
      viewport: { width: 1400, height: 900 },
      args: ['--profile-directory=Default'],
    });
    browser = context.browser();
    console.log('Microsoft Edge launched with helmut.schindlwick profile (SSO cookies intact).');
  } catch (e) {
    console.warn('Could not launch with persistent profile:', e.message);
    console.log('Falling back to fresh Edge session...');
    browser = await chromium.launch({ channel: 'msedge', headless: false, slowMo: 30 });
    context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  }

  const capturedResponses = [];
  let browserClosed = false;

  const attachResponseListener = (pg) => {
    pg.on('response', async (response) => {
      const url = response.url();
      const isBlackDuck = url.includes('blackduck.com/api');
      const isVuln = url.includes('vulnerabilities') || url.includes('vulnerability');
      const isComp = url.includes('/components') && url.includes(PROJECT_ID);

      if (isBlackDuck && (isVuln || isComp)) {
        try {
          const ct = response.headers()['content-type'] || '';
          if (!ct.includes('json')) return;
          const body = await response.json().catch(() => null);
          if (!body) return;
          const items = body.items || body.vulnerabilities || [];
          if (items.length > 0) {
            console.log(`\n  Captured [${items.length}] from ...${url.slice(-80)}`);
            capturedResponses.push({ url, body, isVuln });
          }
        } catch { /* ignore */ }
      }
    });
  };

  context.on('page', (newPage) => {
    console.log(`  New tab opened: ${newPage.url().slice(0, 80)}`);
    attachResponseListener(newPage);
  });

  if (browser) browser.on('disconnected', () => { browserClosed = true; });
  else context.on('close', () => { browserClosed = true; });

  const page = await context.newPage();
  attachResponseListener(page);

  console.log('\nNavigating to Black Duck vulnerabilities page...');
  await page.goto(BASE_URL + VULN_PATH, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  }).catch(() => {});

  console.log('\n>>> Edge is open. Please complete Accenture SSO + MFA login.');
  console.log('>>> Once you see the vulnerability table, keep the page open.');
  console.log(`>>> Script waits up to ${MFA_WAIT_MS / 60000} minutes...\n`);

  const deadline = Date.now() + MFA_WAIT_MS;
  let dotCount = 0;
  while (Date.now() < deadline && !browserClosed) {
    if (capturedResponses.length > 0) {
      // Wait a few more seconds to catch all paginated responses.
      await new Promise(r => setTimeout(r, 4000));
      if (capturedResponses.length > 0) {
        console.log('\n>>> API data captured! Processing...\n');
        break;
      }
    }

    // Every 30 s check for vulnerability text and reload to trigger API call.
    if (dotCount % 6 === 0) {
      try {
        const pages = context.pages();
        for (const pg of pages) {
          const bodyText = await pg.evaluate(() => document.body?.innerText ?? '').catch(() => '');
          if (bodyText.includes('BDSA-') || bodyText.includes('CVE-20')) {
            console.log('\nVulnerability text found -- reloading to trigger API capture...');
            await pg.reload({ waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 3000));
            break;
          }
        }
      } catch { /* browser may be closing */ }
    }

    process.stdout.write('.');
    dotCount++;
    await new Promise(r => setTimeout(r, 5000));
  }

  if (browserClosed) {
    console.log('\nBrowser closed -- saving whatever was captured before close...');
  }

  // ---- Compile results ----
  let finalData = [];

  if (capturedResponses.length > 0) {
    for (const { url, body } of capturedResponses) {
      const items = body.items || body.vulnerabilities || [];
      if (!items.length) continue;
      // Skip component-list pages (no severity field = not a vulnerability item)
      if (!items[0].severity && !items[0].source) continue;

      for (const v of items) {
        const links = v._meta?.links || [];
        // Correct link rels as returned by the Black Duck vulnerabilities endpoint
        const vulnApiLink  = links.find(l => l.rel === 'vulnerability')?.href       || '';
        const compLink     = links.find(l => l.rel === 'vulnerabilities-components')?.href || '';
        const uiLink       = deriveUiLink(v.id, links);

        finalData.push({
          id:                  v.id                                    || '',
          source:              v.source                                || '',
          severity:            v.severity                              || '',
          overallScore:        v.overallScore                          ?? '',
          baseScore:           v.baseScore                             ?? '',
          vector:              v.vector                                || '',
          status:              (v.remediationStatus || []).join(', '),
          exploitAvailable:    v.exploitAvailable    ? 'Yes' : 'No',
          solutionAvailable:   v.solutionAvailable   ? 'Yes' : 'No',
          workaroundAvailable: v.workaroundAvailable ? 'Yes' : 'No',
          affectedComponentCount: v.affectedComponentCount             ?? '',
          cweIds:              (v.cweIds   || []).join(', '),
          bdsaTags:            (v.bdsaTags || []).join(', '),
          description:         (v.description || '').replace(/\n/g, ' '),
          publishedDate:       v.publishedDate                         || '',
          lastModified:        v.lastModified                          || '',
          affectedComponent:   '',
          affectedVersion:     '',
          apiLink:             vulnApiLink,
          componentsApiLink:   compLink,
          uiLink,
        });
      }
    }

    // De-duplicate by id.
    const seen = new Set();
    finalData = finalData.filter(v => { if (seen.has(v.id)) return false; seen.add(v.id); return true; });

    // Enrich component names from page DOM.
    try {
      const activePage = context.pages().find(p => p.url().includes('blackduck')) || page;
      const uiComponents = await activePage.evaluate(() => {
        const map = {};
        document.querySelectorAll('tr, [role="row"]').forEach(row => {
          const cells = [...row.querySelectorAll('td, [role="cell"]')].map(c => c.innerText?.trim() ?? '');
          if (!cells[0]) return;
          if (/^(CVE-|BDSA-)/i.test(cells[0])) {
            const next = row.nextElementSibling;
            if (next) {
              const link = next.querySelector('a[href*="component"]');
              if (link) map[cells[0]] = link.innerText.trim();
            }
          }
        });
        document.querySelectorAll('[class*="vulnerability"]').forEach(card => {
          const idEl  = card.querySelector('[class*="id"], [class*="name"]');
          const compEl = card.querySelector('a[href*="component"]');
          if (idEl && compEl) map[idEl.innerText.trim()] = compEl.innerText.trim();
        });
        return map;
      }).catch(() => ({}));

      for (const item of finalData) {
        if (uiComponents[item.id]) item.affectedComponent = uiComponents[item.id];
      }
    } catch { /* ignore */ }

    console.log(`Total vulnerabilities extracted: ${finalData.length}`);

    // ---- Follow vulnerabilities-components links to get affected component names ----
    console.log('\nFetching affected component details for each vulnerability...');
    const activePage = context.pages().find(p => p.url().includes('blackduck')) || page;
    for (const item of finalData) {
      if (!item.componentsApiLink) continue;
      try {
        const compUrl = item.componentsApiLink.includes('?')
          ? item.componentsApiLink + 'limit=10'
          : item.componentsApiLink + '?limit=10';
        const compData = await activePage.evaluate(async (url) => {
          // Try several Accept headers in order; Black Duck is picky per sub-endpoint.
          const acceptTypes = [
            'application/vnd.blackducksoftware.component-detail-4+json',
            'application/vnd.blackducksoftware.vulnerability-4+json',
            'application/json',
          ];
          for (const accept of acceptTypes) {
            try {
              const r = await fetch(url, { headers: { 'Accept': accept }, credentials: 'include' });
              if (r.ok) return await r.json();
              if (r.status === 401 || r.status === 403) return { _authError: r.status };
            } catch { /* try next */ }
          }
          return null;
        }, compUrl).catch(() => null);

        if (compData?._authError) {
          console.log(`  ${item.id}: auth error HTTP ${compData._authError} -- session may have expired`);
        } else if (compData?.items?.length) {
          const comp = compData.items[0];
          item.affectedComponent     = comp.componentName     || comp.componentVersion?.component?.name || '';
          item.affectedVersion       = comp.componentVersionName || comp.componentVersion?.versionName || '';
          item.affectedComponentHref = comp._meta?.href || '';
          item.affectedComponentUiLink = comp.componentVersion?.component?._meta?.href
            ? `${BASE_URL}/#/components/id:${comp.componentVersion.component._meta.href.split('/').pop()}`
            : '';
          console.log(`  ${item.id}: ${item.affectedComponent} ${item.affectedVersion}`);
        } else {
          console.log(`  ${item.id}: (no component data returned)`);
        }
      } catch (err) {
        console.log(`  ${item.id}: error fetching component -- ${err.message}`);
      }
    }

    for (const v of finalData) {
      console.log(`  ${v.id}  [${v.severity}/${v.overallScore}]  ${v.affectedComponent || '?'} ${v.affectedVersion || ''}`);
    }

  } else {
    console.log('\nNo API data captured. Saving raw page content for manual review...');
    if (!browserClosed) {
      try {
        const activePage = context.pages().find(p => p.url().includes('blackduck')) || page;
        const bodyText = await activePage.evaluate(() => document.body?.innerText ?? '').catch(() => '');
        writeFileSync(join(OUT_DIR, 'blackduck-page-text.txt'), bodyText, 'utf-8');
        console.log(`Page text -> ${join(OUT_DIR, 'blackduck-page-text.txt')}`);
      } catch { /* ignore */ }
    }
    console.log('TIP: Once Edge is on the vulnerabilities page, press F5 to reload it -- that forces the API call.');
  }

  // ---- Write output ----
  const jsonPath = join(OUT_DIR, 'blackduck-vulns-detail.json');
  writeFileSync(jsonPath, JSON.stringify(finalData, null, 2), 'utf-8');
  console.log(`\nJSON -> ${jsonPath}`);

  const csvPath = join(OUT_DIR, 'blackduck-vulns-detail.csv');
  writeFileSync(csvPath, toCSV(finalData), 'utf-8');
  console.log(`CSV  -> ${csvPath}`);

  writeFileSync(
    join(OUT_DIR, 'blackduck-api-raw.json'),
    JSON.stringify(capturedResponses.map(r => ({ url: r.url, items: r.body })), null, 2),
    'utf-8'
  );

  console.log('\nDone. Edge stays open -- close it manually when finished.');
  // Do not call context.close() so the browser session remains for the user.
})();
