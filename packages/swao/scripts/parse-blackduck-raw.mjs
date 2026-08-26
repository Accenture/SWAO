/**
 * Parse already-captured blackduck-api-raw.json into the structured detail files.
 * Run this after a successful scrape to re-process without opening a browser.
 *
 * Usage: node swao/packages/swao/scripts/parse-blackduck-raw.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', '..', '..', '..', 'docs', 'vulnerability-scan-acn');

const BASE_URL   = 'https://accenture.app.blackduck.com';
const VERSION_ID = 'd4ec9765-bf93-4bbf-b3be-0d08f54a8994';

function getLinkHref(links, rel) {
  return links?.find(l => l.rel === rel)?.href || '';
}

function deriveUiLink(id, links) {
  // Construct Black Duck UI deep link from the vulnerabilities-components href.
  // That href looks like: .../vulnerabilities/{vulnId}[/related/{relId}]/components?
  const compLink = getLinkHref(links, 'vulnerabilities-components');
  if (compLink) {
    const m = compLink.match(/\/vulnerabilities\/([^/?]+)/);
    if (m) {
      return `${BASE_URL}/#/versions/id:${VERSION_ID}/view:vulnerabilities/id:${m[1]}`;
    }
  }
  // Fallback to the API vulnerability href.
  const apiLink = getLinkHref(links, 'vulnerability');
  return apiLink || `${BASE_URL}/#/versions/id:${VERSION_ID}/view:vulnerabilities/id:${id}`;
}

function toCSV(items) {
  if (!items.length) return '';
  const keys = Object.keys(items[0]);
  return [
    keys.join(','),
    ...items.map(item =>
      keys.map(k => `"${String(item[k] ?? '').replace(/"/g, '""')}"`).join(',')
    ),
  ].join('\n');
}

const raw = JSON.parse(readFileSync(join(OUT_DIR, 'blackduck-api-raw.json'), 'utf-8'));

const allItems = [];
for (const capture of raw) {
  // raw is an array of { url, items: { totalCount, items: [...] } }
  const items = capture.items?.items || capture.items?.vulnerabilities || [];
  for (const v of items) {
    const links = v._meta?.links || [];
    allItems.push({
      id:                   v.id || '',
      source:               v.source || '',
      severity:             v.severity || '',
      overallScore:         v.overallScore   ?? '',
      baseScore:            v.baseScore      ?? '',
      vector:               v.vector         || '',
      status:               (v.remediationStatus || []).join(', '),
      exploitAvailable:     v.exploitAvailable     ? 'Yes' : 'No',
      solutionAvailable:    v.solutionAvailable     ? 'Yes' : 'No',
      workaroundAvailable:  v.workaroundAvailable   ? 'Yes' : 'No',
      affectedComponentCount: v.affectedComponentCount ?? '',
      cweIds:               (v.cweIds   || []).join(', '),
      bdsaTags:             (v.bdsaTags || []).join(', '),
      description:          (v.description || '').replace(/\n/g, ' '),
      publishedDate:        v.publishedDate  || '',
      lastModified:         v.lastModified   || '',
      apiLink:              getLinkHref(links, 'vulnerability') || getLinkHref(links, 'related-vulnerability'),
      componentsApiLink:    getLinkHref(links, 'vulnerabilities-components'),
      uiLink:               deriveUiLink(v.id, links),
    });
  }
}

// De-duplicate by id.
const seen = new Set();
const finalData = allItems.filter(v => {
  if (seen.has(v.id)) return false;
  seen.add(v.id);
  return true;
});

writeFileSync(join(OUT_DIR, 'blackduck-vulns-detail.json'), JSON.stringify(finalData, null, 2), 'utf-8');
writeFileSync(join(OUT_DIR, 'blackduck-vulns-detail.csv'), toCSV(finalData), 'utf-8');

console.log(`\nProcessed ${finalData.length} vulnerabilities:\n`);
for (const v of finalData) {
  const sol = v.solutionAvailable === 'Yes' ? 'SOLUTION' : v.workaroundAvailable === 'Yes' ? 'WORKAROUND' : 'no-fix';
  console.log(`  ${v.id.padEnd(22)} ${v.severity.padEnd(9)} ${String(v.overallScore).padEnd(5)} ${v.status.padEnd(10)} ${sol}`);
}
console.log(`\nJSON -> ${join(OUT_DIR, 'blackduck-vulns-detail.json')}`);
console.log(`CSV  -> ${join(OUT_DIR, 'blackduck-vulns-detail.csv')}`);
