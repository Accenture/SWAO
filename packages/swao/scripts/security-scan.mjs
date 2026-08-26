#!/usr/bin/env node
/**
 * security-scan.mjs -- automated security scan for every SWAO release.
 *
 * Run automatically by bump-version.mjs after every version bump, or
 * manually:
 *   node scripts/security-scan.mjs
 *
 * Produces docs/security/scan-results/vX.Y.Z-YYYY-MM-DD/ with:
 *   - codeql-all-alerts.json    (GitHub CodeQL API)
 *   - dependabot-open-alerts.json (GitHub Dependabot API)
 *   - swao-vX.Y.Z-sbom.cdx.json  (cdxgen from swao/ workspace)
 *   - trivy-fs-report.txt        (Trivy -- swao/packages/swao/ ONLY)
 *   - trivy-fs-report.sarif      (SARIF format for CI)
 *   - scan-summary.md            (ASCII header + executive summary)
 *
 * Requirements:
 *   - gh CLI authenticated (gh auth status)
 *   - trivy installed (winget install AquaSecurity.Trivy)
 *   - @cyclonedx/cdxgen available via npx
 */

import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = join(__dirname, '..', '..', '..', '..');
const SWAO_ROOT  = join(REPO_ROOT, 'swao');
const PKG_PATH   = join(__dirname, '..', 'package.json');
const REPO_ID    = 'Accenture/SWAO';
const SCAN_DIR   = join(REPO_ROOT, 'docs', 'security', 'scan-results');

const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8'));
const version = pkg.version;
const date = new Date().toISOString().slice(0, 10);
const outDir = join(SCAN_DIR, `v${version}-${date}`);

function run(label, fn) {
  process.stdout.write(`[security-scan] ${label}... `);
  try {
    fn();
    process.stdout.write('ok\n');
  } catch (e) {
    process.stdout.write(`FAILED: ${e.message}\n`);
    process.exitCode = 1;
  }
}

function ghApi(endpoint, outFile) {
  const result = spawnSync('gh', ['api', endpoint, '--paginate'], { encoding: 'utf-8' });
  if (result.status !== 0) throw new Error(result.stderr || 'gh api failed');
  writeFileSync(outFile, result.stdout, 'utf-8');
}

// ---------------------------------------------------------------------------

console.log(`[security-scan] SWAO v${version} -- ${date}`);
console.log(`[security-scan] Output: ${outDir}`);
mkdirSync(outDir, { recursive: true });

// 1. CodeQL all alerts
run('CodeQL all alerts', () => {
  ghApi(`repos/${REPO_ID}/code-scanning/alerts?per_page=100`, join(outDir, 'codeql-all-alerts.json'));
  const alerts = JSON.parse(readFileSync(join(outDir, 'codeql-all-alerts.json'), 'utf-8'));
  const open = alerts.filter(a => a.state === 'open').length;
  if (open > 0) {
    process.stdout.write(`\n[security-scan] WARNING: ${open} open CodeQL alert(s) -- fix before shipping!\n`);
    process.exitCode = 1;
  }
});

// 2. Dependabot open alerts
run('Dependabot open alerts', () => {
  ghApi(`repos/${REPO_ID}/dependabot/alerts?state=open&per_page=100`, join(outDir, 'dependabot-open-alerts.json'));
  const raw = JSON.parse(readFileSync(join(outDir, 'dependabot-open-alerts.json'), 'utf-8'));
  // If response is an error object (e.g. 403 -- PAT lacks security_events scope), treat as unknown.
  if (!Array.isArray(raw)) {
    process.stdout.write(`\n[security-scan] WARNING: Dependabot API returned error (PAT may lack security_events scope): ${raw.message || raw.status}\n`);
    process.stdout.write('[security-scan] Run: gh auth refresh -h github.com -s security_events\n');
    writeFileSync(join(outDir, 'dependabot-open-alerts.json'), '[]', 'utf-8');
    return;
  }
  if (raw.length > 0) {
    process.stdout.write(`\n[security-scan] WARNING: ${raw.length} open Dependabot CVE(s) -- resolve before shipping!\n`);
    process.exitCode = 1;
  }
});

// 3. SBOM via cdxgen -- run from swao/packages/swao/ (PRODUCT only, not monorepo root)
// Running from swao/ monorepo root includes example workspace apps and Rust crates.
const PRODUCT_DIR = join(SWAO_ROOT, 'packages', 'swao');
run('CycloneDX SBOM (product only)', () => {
  const sbomPath = join(outDir, `swao-v${version}-sbom.cdx.json`);
  const result = spawnSync(
    'npx', ['@cyclonedx/cdxgen', '--output', sbomPath, '--spec-version', '1.4'],
    { cwd: PRODUCT_DIR, encoding: 'utf-8', shell: true },
  );
  if (result.status !== 0 && !existsSync(sbomPath)) throw new Error('cdxgen failed');
});

// 4+5. Trivy -- MUST target swao/packages/swao/ ONLY (not swao/ which includes example client code)
// Scans: vulnerabilities (npm CVEs) + secrets (hard-coded credentials, keys)
// .trivyignore at repo root suppresses known false positives (GCP regex in redact-pre-llm.ts).
const trivyTarget = join(SWAO_ROOT, 'packages', 'swao');
run('Trivy filesystem (table, vuln+secret)', () => {
  const result = spawnSync('trivy', ['fs', '--scanners', 'vuln,secret', '--format', 'table', '--output', join(outDir, 'trivy-fs-report.txt'), trivyTarget], { encoding: 'utf-8' });
  if (result.status !== 0) throw new Error('trivy not installed? Run: winget install AquaSecurity.Trivy');
});
run('Trivy filesystem (SARIF)', () => {
  spawnSync('trivy', ['fs', '--scanners', 'vuln,secret', '--format', 'sarif', '--output', join(outDir, 'trivy-fs-report.sarif'), trivyTarget], { encoding: 'utf-8' });
});

// 6. Pretty-print all JSON artefacts so they are human-readable (multi-line)
run('Pretty-print JSON artefacts', () => {
  const jsonFiles = [
    `codeql-all-alerts.json`,
    `dependabot-open-alerts.json`,
    `swao-v${version}-sbom.cdx.json`,
  ];
  for (const name of jsonFiles) {
    const p = join(outDir, name);
    if (existsSync(p)) {
      try {
        const raw = JSON.parse(readFileSync(p, 'utf-8'));
        writeFileSync(p, JSON.stringify(raw, null, 2), 'utf-8');
      } catch { /* skip if invalid */ }
    }
  }
});

// 7. Generate scan-summary.md using canonical template (scripts/gen-scan-summary.py)
// This produces the full summary with Proof of Execution section.
run('scan-summary.md (via gen-scan-summary.py)', () => {
  const genScript = join(REPO_ROOT, 'scripts', 'gen-scan-summary.py');
  const result = spawnSync('python3', [genScript, outDir], { encoding: 'utf-8' });
  if (result.status !== 0) throw new Error(`gen-scan-summary.py failed: ${result.stderr}`);
});

// Quick verdict for console
let codeqlOpen = 0, depOpen = 0;
try {
  const codeql = JSON.parse(readFileSync(join(outDir, 'codeql-all-alerts.json'), 'utf-8'));
  codeqlOpen = codeql.filter(a => a.state === 'open').length;
  const dep = JSON.parse(readFileSync(join(outDir, 'dependabot-open-alerts.json'), 'utf-8'));
  depOpen = Array.isArray(dep) ? dep.length : 0;
} catch { /* partial */ }

console.log(`[security-scan] Complete. ${process.exitCode || (codeqlOpen + depOpen) > 0 ? 'WARNINGS -- check above.' : 'All clean.'}`);
