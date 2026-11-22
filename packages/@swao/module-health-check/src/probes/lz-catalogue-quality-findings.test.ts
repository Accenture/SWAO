// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health Check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4113: the LZ catalogue probe reported its quality warnings as a count only;
// neither the NDJSON log nor the TUI named them. The probe result now carries the
// findings by name (catalogue, rule, short text, capped with a count of the rest),
// the log entry and the text detail list them, and the TUI shows the result line
// and every detail line without the 200-character cut.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildLzCatalogueCoverageProbe,
  summariseLzQualityFindings,
  LZ_QUALITY_SUMMARY_MAX,
} from './lz-catalogue-coverage-probe.js';
import type { LzCatalogueQualityFinding } from '@swao/module-landing-zone';
import { formatLzCatalogueCoverageProbeLine, lzQualityFindingsLogFields } from '../commands/health-check.js';
import { parseHealthCheckOutput, probeDetailRows, wrapDetailLine, DETAIL_ROW_MAX_CHARS } from '../tui/components/health-check-parse.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const NOW = new Date('2026-10-17T00:00:00Z');

function catalogueDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'swao-lz-4113-'));
  dirs.push(dir);
  writeFileSync(join(dir, '_lz-catalogue-template.json'), JSON.stringify({
    meta: { schema_version: '0.1', name: 't', provider: 't', last_updated: '2026-10-01', source: { mode: 'curated' }, confidence: 'medium', regions_count: 0 },
    regions: [],
  }));
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c);
  return dir;
}
const emptyWorkspace = (): string => { const ws = mkdtempSync(join(tmpdir(), 'swao-lz-ws-4113-')); dirs.push(ws); return ws; };

const region = (id: string) => ({
  id, sovereignty: { residency_country: 'DE', operator_jurisdiction: 'EU-entity', extraterritorial_exposure: [], certifications: [] }, services: [{ code: 'vm' }],
});
/** regions_count disagrees with the region list: rule regions-count. */
const acme = JSON.stringify({
  meta: { schema_version: '0.1', name: 'Acme', provider: 'acme', last_updated: '2026-10-01', source: { mode: 'curated', source_note: 'docs' }, confidence: 'medium', regions_count: 5 },
  regions: [region('de-1')],
});
/** last_updated far in the past: rule stale. */
const beta = JSON.stringify({
  meta: { schema_version: '0.1', name: 'Beta', provider: 'beta', last_updated: '2025-01-01', source: { mode: 'curated', source_note: 'docs' }, confidence: 'medium', regions_count: 1 },
  regions: [region('eu-1')],
});

describe('LZ catalogue quality findings by name (#4113)', () => {
  it('two catalogues with known rule violations produce the named findings in the probe result', () => {
    const dir = catalogueDir({ 'acme.json': acme, 'beta.json': beta });
    const r = buildLzCatalogueCoverageProbe(emptyWorkspace(), { bundledDir: dir, now: NOW });
    const named = r.quality_findings ?? [];
    expect(named.find((f) => f.catalogue === 'bundled/acme.json' && f.rule === 'regions-count')).toMatchObject({ count: 1 });
    expect(named.find((f) => f.catalogue === 'bundled/beta.json' && f.rule === 'stale')?.text).toBeTruthy();
    expect(r.quality_findings_more).toBeUndefined();
  });

  it('groups per rule and catalogue and caps with a count of the rest', () => {
    const findings: LzCatalogueQualityFinding[] = [];
    for (let i = 0; i < LZ_QUALITY_SUMMARY_MAX + 3; i++) {
      findings.push({ rule: 'stale', severity: 'warn', file: `bundled/c${i}.json`, message: 'old' });
    }
    findings.push({ rule: 'facts-unsourced', severity: 'warn', file: 'bundled/azure.json', region: 'r1', message: 'UNKNOWN placeholder' });
    findings.push({ rule: 'facts-unsourced', severity: 'warn', file: 'bundled/azure.json', region: 'r2', message: 'UNKNOWN placeholder' });
    findings.push({ rule: 'catalogue-schema', severity: 'error', file: 'bundled/x.json', message: 'fails the catalogue schema' });
    const s = summariseLzQualityFindings(findings);
    expect(s.findings).toHaveLength(LZ_QUALITY_SUMMARY_MAX);
    expect(s.more).toBe(LZ_QUALITY_SUMMARY_MAX + 3 + 1 + 1 - LZ_QUALITY_SUMMARY_MAX);
    expect(s.findings[0]).toMatchObject({ rule: 'catalogue-schema', severity: 'error' }); // errors first
    const all = summariseLzQualityFindings(findings, 100).findings;
    expect(all.find((f) => f.rule === 'facts-unsourced')).toMatchObject({ count: 2, regions: ['r1', 'r2'], catalogue: 'bundled/azure.json' });
  });

  it('the NDJSON log fields name the findings, not only the count', () => {
    const dir = catalogueDir({ 'acme.json': acme, 'beta.json': beta });
    const r = buildLzCatalogueCoverageProbe(emptyWorkspace(), { bundledDir: dir, now: NOW });
    const fields = lzQualityFindingsLogFields(r);
    const list = fields['quality_findings'] as Array<Record<string, unknown>>;
    expect(list.map((f) => `${String(f['catalogue'])} ${String(f['rule'])}`)).toEqual(
      expect.arrayContaining(['bundled/acme.json regions-count', 'bundled/beta.json stale']),
    );
    expect(list.every((f) => typeof f['text'] === 'string' && (f['text'] as string).length > 0)).toBe(true);
    expect(lzQualityFindingsLogFields({ status: 'ok', message: '', detail: '', gaps_count: 0 })).toEqual({});
  });

  it('the CLI text detail lists every detail line (no cap)', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `[WARN] stale bundled/c${i}.json: old`);
    const out = formatLzCatalogueCoverageProbeLine({ status: 'warn', message: 'quality rules: 0 error(s), 30 warning(s)', detail: '', gaps_count: 0, detail_lines: lines });
    for (const l of lines) expect(out).toContain(l);
    expect(out).not.toMatch(/more \(see health-check/);
  });

  it('the TUI shows the result line and every detail line, wrapped below the 200-character cut', () => {
    const regions = Array.from({ length: 10 }, (_, i) => `southcentralregion${i}`).join(', ');
    const long = `[WARN] facts-unsourced wsp/inputs/catalogs/lz-catalogues/azure.json: 10 regions (${regions}): residency_country is the "UNKNOWN" placeholder; facts are refresh defaults`;
    const text = formatLzCatalogueCoverageProbeLine({
      status: 'warn',
      message: '10 LZ catalogue(s) present and structurally valid (10 workspace, 0 bundled); quality rules: 0 error(s), 20 warning(s)',
      detail: '', gaps_count: 0, detail_lines: [long],
    });
    const [probe] = parseHealthCheckOutput(text.split('\n'));
    expect(probe?.name).toBe('LZ catalogue');
    const rows = probeDetailRows(probe!);
    expect(rows.find((r) => r.label === 'Result')?.value).toMatch(/20 warning\(s\)/);
    expect(rows.every((r) => r.value.length <= DETAIL_ROW_MAX_CHARS)).toBe(true);
    const detail = rows.slice(rows.findIndex((r) => r.label === 'Detail')).map((r) => r.value).join(' ');
    expect(detail).toContain('residency_country is the "UNKNOWN" placeholder; facts are refresh defaults');
    expect(rows.find((r) => r.label === 'Action')?.value).toMatch(/Update LZ Catalogue/);
  });

  it('wrapDetailLine keeps short lines and splits long ones at a boundary', () => {
    expect(wrapDetailLine('short')).toEqual(['short']);
    const parts = wrapDetailLine('a, '.repeat(100) + 'end', 50);
    expect(parts.every((p) => p.length <= 50)).toBe(true);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(('a, '.repeat(100) + 'end').replace(/\s+/g, ' ').trim());
  });
});
