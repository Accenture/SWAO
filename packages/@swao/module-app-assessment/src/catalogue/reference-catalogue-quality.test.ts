// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3296: reference catalogue quality rules (shared with
// tests/audit-gates/reference-catalogue-quality.gate.mjs).

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  loadSovereignServiceCatalogue,
  loadDbCompatibilityCatalogue,
  loadLicenceRiskCatalogue,
  loadLegacyIndicatorsCatalogue,
  loadVendorSdkCatalogue,
  resolveControlsFile,
  SOVEREIGN_SERVICE_CATALOGUE_FILE,
  DB_COMPATIBILITY_CATALOGUE_FILE,
  LICENCE_RISK_CATALOGUE_FILE,
  LEGACY_INDICATORS_CATALOGUE_FILE,
  VENDOR_SDK_CATALOGUE_FILE,
} from './reference-catalogues.js';
import { checkReferenceCatalogues, formatRefCatalogueFindings, type RefCatalogueInput } from './reference-catalogue-quality.js';

// #3302: legacy-indicators and vendor-sdk were reviewed on 2026-10-18.
const TODAY = new Date('2026-10-18T12:00:00Z');

function shipped(): RefCatalogueInput[] {
  const pairs: Array<[string, (p?: string) => RefCatalogueInput['load']]> = [
    [SOVEREIGN_SERVICE_CATALOGUE_FILE, loadSovereignServiceCatalogue],
    [DB_COMPATIBILITY_CATALOGUE_FILE, loadDbCompatibilityCatalogue],
    [LICENCE_RISK_CATALOGUE_FILE, loadLicenceRiskCatalogue],
    [LEGACY_INDICATORS_CATALOGUE_FILE, loadLegacyIndicatorsCatalogue],
    [VENDOR_SDK_CATALOGUE_FILE, loadVendorSdkCatalogue],
  ];
  return pairs.map(([file, load]) => {
    const path = resolveControlsFile(file)!;
    return { file, text: readFileSync(path, 'utf-8'), load: load(path) };
  });
}

function sovereignYaml(entry: string): string {
  return `services:\n${entry}`;
}

const ENTRY = (over: Record<string, string> = {}): string => {
  const f = {
    verdict: 'partial', confidence: 'verified', blocks: 'false', reviewed: '2026-10-01',
    sources: "\n      - url: https://example.org/docs\n        reviewed: '2026-10-01'",
    details: 'EU region documented.',
    ...over,
  };
  return [
    '  - id: x',
    '    name: "X"',
    '    category: c',
    '    vendor: "X Inc. (US)"',
    '    parent_jurisdiction: US',
    `    portability_verdict: ${f.verdict}`,
    '    sovereign_evidence: eu_region_confirmed',
    `    verdict_confidence: ${f.confidence}`,
    `    sources:${f.sources}`,
    `    eu_details: "${f.details}"`,
    `    blocks_migration: ${f.blocks}`,
    `    last_reviewed: '${f.reviewed}'`,
    '',
  ].join('\n');
};

function checkSovereign(yaml: string) {
  const dir = mkdtempSync(join(tmpdir(), 'swao-3296-q-'));
  try {
    const path = join(dir, SOVEREIGN_SERVICE_CATALOGUE_FILE);
    writeFileSync(path, yaml, 'utf-8');
    return checkReferenceCatalogues(
      [{ file: SOVEREIGN_SERVICE_CATALOGUE_FILE, text: yaml, load: loadSovereignServiceCatalogue(path) }],
      { today: TODAY },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('checkReferenceCatalogues', () => {
  it('the shipped catalogues have no error findings', () => {
    const report = checkReferenceCatalogues(shipped(), { today: TODAY });
    const errors = report.findings.filter((f) => f.severity === 'error');
    expect(formatRefCatalogueFindings(errors)).toEqual([]);
    expect(report.catalogues_checked).toBe(5);
  });

  it('a clean verified entry passes', () => {
    expect(checkSovereign(sovereignYaml(ENTRY())).errors).toBe(0);
  });

  it('a verified verdict without a source fails the schema', () => {
    const r = checkSovereign(sovereignYaml(ENTRY({ sources: ' []' })));
    expect(r.findings.map((f) => f.rule)).toContain('schema');
  });

  it('blocks_migration on an unverified entry fails', () => {
    const r = checkSovereign(sovereignYaml(ENTRY({ verdict: 'unavailable', confidence: 'unverified', blocks: 'true' })));
    expect(r.errors).toBeGreaterThan(0);
  });

  it('a verified unavailable verdict must block', () => {
    const r = checkSovereign(sovereignYaml(ENTRY({ verdict: 'unavailable', blocks: 'false' })));
    expect(r.errors).toBeGreaterThan(0);
  });

  it('engagement markers fail', () => {
    for (const details of ['Use acn-proxy://anthropic-eu.', 'See incident INC-2025-0815.', 'Volumes from HealthCo.', 'Update app.config.json.']) {
      const r = checkSovereign(sovereignYaml(ENTRY({ details })));
      expect(r.findings.some((f) => f.rule === 'engagement-marker'), details).toBe(true);
    }
  });

  it('an old review warns, a future review fails, unverified warns', () => {
    const old = checkSovereign(sovereignYaml(ENTRY({ reviewed: '2025-01-01' })));
    expect(old.errors).toBe(0);
    expect(old.findings.some((f) => f.rule === 'review-age')).toBe(true);
    const future = checkSovereign(sovereignYaml(ENTRY({ reviewed: '2027-01-01' })));
    expect(future.findings.some((f) => f.rule === 'review-date' && f.severity === 'error')).toBe(true);
    const unverified = checkSovereign(sovereignYaml(ENTRY({ confidence: 'unverified' })));
    expect(unverified.errors).toBe(0);
    expect(unverified.findings.some((f) => f.rule === 'unverified')).toBe(true);
  });

  it('the shipped legacy-indicators and vendor-sdk catalogues have no findings at all (#3302)', () => {
    const report = checkReferenceCatalogues(shipped(), { today: TODAY });
    const own = report.findings.filter((f) => f.file === LEGACY_INDICATORS_CATALOGUE_FILE || f.file === VENDOR_SDK_CATALOGUE_FILE);
    expect(formatRefCatalogueFindings(own)).toEqual([]);
  });

  it('a vendor-sdk or legacy-indicators entry without a source fails (#3302)', () => {
    const sdk = { id: 's', name: 'S', vendor: 'v', lock_in_level: 'low', sovereign_impact: 'none', detection: {}, last_reviewed: '2026-10-01' };
    const vendor = { ok: true as const, path: 'x', data: { sdks: [sdk, { ...sdk, id: 't', sources: [{ url: 'https://example.org', reviewed: '2026-10-01' }] }] } };
    const ind = { id: 'LI-T1-001', name: 'I', detection: {}, last_reviewed: '2026-10-01' };
    const legacy = {
      ok: true as const,
      path: 'y',
      data: { last_reviewed: '2026-10-01', tiers: { tier_1_blockers: [ind], tier_2_complicators: [], tier_3_manageable: [] } },
    };
    const r = checkReferenceCatalogues(
      [
        { file: VENDOR_SDK_CATALOGUE_FILE, text: '', load: vendor },
        { file: LEGACY_INDICATORS_CATALOGUE_FILE, text: '', load: legacy },
      ],
      { today: TODAY },
    );
    const sourceErrors = r.findings.filter((f) => f.rule === 'entry-source').map((f) => f.message);
    expect(sourceErrors).toEqual(['sdk s: no public source', 'indicator LI-T1-001: no public source']);
  });

  it('a licence catalogue whose prefix does not name the consumer fails', () => {
    const load = { ok: true as const, path: 'x', data: { signal_prefix: 'LIC', last_reviewed: '2026-10-01', licences: [] } };
    const r = checkReferenceCatalogues([{ file: LICENCE_RISK_CATALOGUE_FILE, text: '', load }], { today: TODAY });
    expect(r.findings.map((f) => f.rule)).toContain('consumer-header');
  });
});
