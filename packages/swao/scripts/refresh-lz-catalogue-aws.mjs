#!/usr/bin/env node
// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * refresh-lz-catalogue-aws.mjs -- fetch service metadata from botocore.
 *
 * Builds swao/lz-catalogues/aws-service-meta.json: a lookup table of
 *   "<code>": { name, id, abbreviation }
 * derived from botocore service-2.json files at github.com/boto/botocore.
 *
 * The catalogue files (aws.json, aws-esc.json, aws-iso-e.json) store service
 * codes from botocore/data/endpoints.json but have no friendly names. This
 * script enriches a separate side-file used by the lz-catalog-services
 * publication block to display "Amazon S3" instead of "s3".
 *
 * Strategy:
 *   1. Fetch endpoints.json to collect unique service codes across the aws,
 *      aws-eu-sovereign, and aws-iso-e partitions.
 *   2. Fetch the GitHub repository tree once (1 API call) to map each code
 *      to the path of its latest service-2.json.
 *   3. Batch-fetch the raw service-2.json files (raw.githubusercontent.com,
 *      not rate-limited by the GitHub API quota).
 *   4. Write aws-service-meta.json.
 *
 * GITHUB_TOKEN is required: the repository tree query on a repo this large
 * needs an authenticated request (5000 req/hour). Without it the tree API
 * returns 403 or rate-limits immediately.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_... node scripts/refresh-lz-catalogue-aws.mjs
 *   GITHUB_TOKEN=ghp_... node scripts/refresh-lz-catalogue-aws.mjs --dry-run
 *
 * Output:
 *   swao/lz-catalogues/aws-service-meta.json
 *
 * Requires: Node 18+ (built-in fetch). No npm dependencies.
 */

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOGUES_DIR = join(__dirname, '..', '..', '..', 'lz-catalogues');

const BOTOCORE_RAW  = 'https://raw.githubusercontent.com/boto/botocore/develop';
const BOTOCORE_API  = 'https://api.github.com/repos/boto/botocore';
const TARGET_PARTITIONS = ['aws', 'aws-eu-sovereign', 'aws-iso-e'];
const BATCH_SIZE = 20;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? '';
const dryRun = process.argv.includes('--dry-run');

if (!GITHUB_TOKEN) {
  console.warn('[refresh-lz-catalogue-aws] GITHUB_TOKEN not set -- using anonymous GitHub API (60 req/hour).');
  console.warn('  For faster runs set GITHUB_TOKEN to a PAT with public_repo scope:');
  console.warn('  GITHUB_TOKEN=ghp_... node scripts/refresh-lz-catalogue-aws.mjs');
}

const apiHeaders = {
  'User-Agent': 'swao-lz-catalogue-refresh/0.1',
  'Accept': 'application/vnd.github.v3+json',
  'Authorization': `Bearer ${GITHUB_TOKEN}`,
};
const rawHeaders = { 'User-Agent': 'swao-lz-catalogue-refresh/0.1' };

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

// ------------------------------------------------------------------ //
// Step 1: collect service codes from endpoints.json                   //
// ------------------------------------------------------------------ //

console.log('[refresh-lz-catalogue-aws] fetching botocore/data/endpoints.json...');
const endpoints = await fetchJson(
  `${BOTOCORE_RAW}/botocore/data/endpoints.json`,
  rawHeaders,
);

const codes = new Set();
for (const partition of endpoints.partitions ?? []) {
  if (!TARGET_PARTITIONS.includes(partition.partition)) continue;
  for (const code of Object.keys(partition.services ?? {})) codes.add(code);
}
const sortedCodes = [...codes].sort();
console.log(
  `[refresh-lz-catalogue-aws] found ${sortedCodes.length} unique codes ` +
  `across partitions: ${TARGET_PARTITIONS.join(', ')}`,
);

if (dryRun) {
  console.log('Codes (--dry-run, not writing):\n' + sortedCodes.join('\n'));
  process.exit(0);
}

// ------------------------------------------------------------------ //
// Step 2: resolve code -> latest service-2.json URL via repo tree     //
// ------------------------------------------------------------------ //

console.log('[refresh-lz-catalogue-aws] fetching repository tree (1 API call)...');
const treeData = await fetchJson(
  `${BOTOCORE_API}/git/trees/develop?recursive=1`,
  apiHeaders,
);

const pathMap = new Map(); // code -> raw URL of service-2.json

if (!treeData.truncated) {
  // Fast path: tree is complete -- build code -> latest version from tree entries.
  const bestVersion = new Map(); // code -> { version, path }
  for (const item of treeData.tree ?? []) {
    const m = item.path.match(/^botocore\/data\/([^/]+)\/([^/]+)\/service-2\.json$/);
    if (!m) continue;
    const [, code, version] = m;
    if (!sortedCodes.includes(code)) continue;
    const prev = bestVersion.get(code);
    if (!prev || version.localeCompare(prev.version) > 0) {
      bestVersion.set(code, { version, path: item.path });
    }
  }
  for (const [code, { path }] of bestVersion) {
    pathMap.set(code, `${BOTOCORE_RAW}/${path}`);
  }
  console.log(
    `[refresh-lz-catalogue-aws] tree complete -- ${pathMap.size}/${sortedCodes.length} ` +
    `service paths resolved`,
  );
} else {
  // Fallback: tree was truncated; resolve each service directory individually.
  console.warn(
    '[refresh-lz-catalogue-aws] repository tree truncated -- ' +
    'resolving versions per-service via API (slower)',
  );
  async function resolveServicePath(code) {
    const dirs = await fetchJson(
      `${BOTOCORE_API}/contents/botocore/data/${code}`,
      apiHeaders,
    );
    if (!Array.isArray(dirs)) return null;
    dirs.sort((a, b) => b.name.localeCompare(a.name));
    const latest = dirs[0]?.name;
    return latest
      ? `${BOTOCORE_RAW}/botocore/data/${code}/${latest}/service-2.json`
      : null;
  }

  for (let i = 0; i < sortedCodes.length; i += BATCH_SIZE) {
    const batch = sortedCodes.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(async code => {
        const url = await resolveServicePath(code);
        return [code, url];
      }),
    );
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value[1]) pathMap.set(s.value[0], s.value[1]);
    }
    process.stderr.write(
      `  resolved ${Math.min(i + BATCH_SIZE, sortedCodes.length)}/${sortedCodes.length}\r`,
    );
    await new Promise(r => setTimeout(r, 100));
  }
  process.stderr.write('\n');
  console.log(`[refresh-lz-catalogue-aws] ${pathMap.size}/${sortedCodes.length} paths resolved`);
}

// ------------------------------------------------------------------ //
// Step 3: batch-fetch service-2.json and extract metadata             //
// ------------------------------------------------------------------ //

console.log('[refresh-lz-catalogue-aws] fetching service metadata (raw CDN, no quota)...');
const codesToFetch = sortedCodes.filter(c => pathMap.has(c));
const services = {};
let resolved = 0;

for (let i = 0; i < codesToFetch.length; i += BATCH_SIZE) {
  const batch = codesToFetch.slice(i, i + BATCH_SIZE);
  const settled = await Promise.allSettled(
    batch.map(async code => {
      const res = await fetch(pathMap.get(code), { headers: rawHeaders });
      if (!res.ok) return [code, null];
      const data = await res.json();
      return [code, data?.metadata ?? null];
    }),
  );
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    const [code, meta] = s.value;
    services[code] = meta
      ? {
          name:         meta.serviceFullName     ?? null,
          id:           meta.serviceId           ?? null,
          abbreviation: meta.serviceAbbreviation ?? null,
        }
      : { name: null, id: null, abbreviation: null };
    if (services[code].name) resolved++;
  }
  process.stderr.write(
    `  fetched ${Math.min(i + BATCH_SIZE, codesToFetch.length)}/${codesToFetch.length}\r`,
  );
  if (i + BATCH_SIZE < codesToFetch.length) await new Promise(r => setTimeout(r, 50));
}
process.stderr.write('\n');

// Codes with no resolved tree path get null entries.
for (const code of sortedCodes) {
  if (!(code in services)) services[code] = { name: null, id: null, abbreviation: null };
}

// ------------------------------------------------------------------ //
// Step 4: write output                                                 //
// ------------------------------------------------------------------ //

const outPath = join(CATALOGUES_DIR, 'aws-service-meta.json');
writeFileSync(
  outPath,
  JSON.stringify(
    {
      schema_version: '0.1',
      description:
        'AWS, AWS ESC, and AWS ISO-E service display metadata derived from botocore service-2.json files. ' +
        'Each entry: name (serviceFullName), id (serviceId), abbreviation (serviceAbbreviation). ' +
        'Null fields indicate no service-2.json was found for that service code. ' +
        'Used by the lz-catalog-services HTML publication block for friendly display names.',
      generated_at:  new Date().toISOString().slice(0, 10),
      source:        'https://github.com/boto/botocore/tree/develop/botocore/data',
      partitions:    TARGET_PARTITIONS,
      services,
    },
    null,
    2,
  ),
  'utf8',
);

console.log(
  `[refresh-lz-catalogue-aws] done. ` +
  `${resolved}/${sortedCodes.length} names resolved, ` +
  `${sortedCodes.length - resolved} null.`,
);
console.log(`[refresh-lz-catalogue-aws] output -> ${outPath}`);
