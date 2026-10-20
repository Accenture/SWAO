// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// intake-mapping-probe (#3084, Design 103 §21.1).
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump } from 'js-yaml';
import { buildIntakeMappingProbe } from './intake-mapping-probe.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const HEADERS = { A: 'VM', I: 'OS', K: 'Hersteller Support', L: 'Telefonnummer', N: 'Kontakt' };
const MAP = {
  version: '1.0',
  source: { sheet: 1, header_row: 1, data_start_row: 2 },
  fields: { id_name_combined: { col: 'A' }, os: { col: 'I' }, cpu_cores: { col: 'B', type: 'integer' } },
  pii_columns: [{ col: 'K', reason: 'vendor_support_name' }, { col: 'L', reason: 'support_phone' }, { col: 'N', reason: 'support_email' }],
};

function workspace(opts: {
  service?: boolean;
  mapping?: object | null;
  signals?: Array<{ code: string; app_id?: string; evidence?: string[] }>;
  warnings?: string[];
  rowCount?: number;
}): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-intake-probe-'));
  dirs.push(ws);
  const doc: Record<string, unknown> = { wsp_version: '0.9' };
  if (opts.service !== false) {
    doc['service_portfolio'] = {
      source: 'intake.xlsx',
      mapping: opts.mapping === null ? null : 'column-map.yaml',
      sheets: ['Inventory'],
      headers: { Inventory: HEADERS },
      row_count: opts.rowCount ?? 20,
    };
  }
  writeFileSync(join(ws, '.swao.yml'), dump(doc));
  if (opts.mapping) writeFileSync(join(ws, 'column-map.yaml'), dump(opts.mapping));
  if (opts.signals || opts.warnings) {
    mkdirSync(join(ws, 'wsp', 'signals'), { recursive: true });
    const signals = (opts.signals ?? []).map((s) => ({
      id: 'SCAF-01', code: s.code, source: 'cmdb_export', category: 'infrastructure_platform',
      derivation: 'fixture signal for the probe test', evidence: s.evidence ?? [], confidence: 'high',
      ...(s.app_id ? { app_id: s.app_id } : {}),
    }));
    writeFileSync(join(ws, 'wsp', 'signals', 'scaffold-signals.json'), JSON.stringify({
      generated_at: '2026-10-10T00:00:00Z', source: 'intake.xlsx', counts: {}, signals, warnings: opts.warnings ?? [],
    }));
  }
  return ws;
}

describe('buildIntakeMappingProbe (#3084)', () => {
  it('skips application workspaces and the default template', () => {
    expect(buildIntakeMappingProbe(workspace({ service: false })).status).toBe('skip');
    expect(buildIntakeMappingProbe(workspace({ mapping: null }))).toMatchObject({ status: 'skip', message: expect.stringMatching(/default intake template/) });
  });

  it('passes a valid mapping with all PII columns declared', () => {
    expect(buildIntakeMappingProbe(workspace({ mapping: MAP }))).toMatchObject({ status: 'ok', errors: [], warnings: [] });
  });

  it('errors when the mandatory os field is missing, citing the field', () => {
    const { os: _os, ...fields } = MAP.fields;
    const r = buildIntakeMappingProbe(workspace({ mapping: { ...MAP, fields } }));
    expect(r.status).toBe('error');
    expect(r.errors.join('\n')).toMatch(/mandatory field "os"/);
  });

  it('errors on a column letter outside A-Z / AA-AZ', () => {
    const r = buildIntakeMappingProbe(workspace({ mapping: { ...MAP, fields: { ...MAP.fields, cpu_cores: { col: 'ZZZ' } } } }));
    expect(r.status).toBe('error');
    expect(r.errors.join('\n')).toMatch(/invalid column letter/);
  });

  it('warns when a personal-data column exists in the source but is not declared', () => {
    const r = buildIntakeMappingProbe(workspace({ mapping: { ...MAP, pii_columns: [{ col: 'K', reason: 'vendor_support_name' }] } }));
    expect(r.status).toBe('warn');
    expect(r.warnings).toHaveLength(2);
  });

  it('errors when the mapped sheet does not exist', () => {
    const r = buildIntakeMappingProbe(workspace({ mapping: { ...MAP, source: { ...MAP.source, sheet: 'Missing' } } }));
    expect(r.errors).toContain('sheet not found: "Missing"');
  });

  it('reports duplicate IDs, type mismatches over 10%, blank OS over 5%, and unknown boolean values', () => {
    const r = buildIntakeMappingProbe(workspace({
      mapping: MAP,
      rowCount: 20,
      signals: [
        { code: 'SCAFFOLD.DUPLICATE_ID', app_id: 'hosapp001' },
        { code: 'SCAFFOLD.MANDATORY_FIELD_MISSING', evidence: ['app a: os blank', 'app b: os blank'] },
      ],
      warnings: [
        'field cpu_cores: 3 of 20 value(s) not numeric; stored as null',
        'field memory_mb: 1 of 20 value(s) not numeric; stored as null',
        'field migration_candidate: 2 of 20 value(s) not in true_values / false_values; stored as null',
      ],
    }));
    expect(r.status).toBe('error');
    expect(r.errors).toEqual([
      'duplicate app IDs after parse: hosapp001',
      'type mismatch: field cpu_cores: 3 of 20 value(s) not numeric; stored as null',
    ]);
    expect(r.warnings).toEqual([
      'OS blank in 2 of 20 rows; end-of-life lookup will be partial',
      'field memory_mb: 1 of 20 value(s) not numeric; stored as null',
      'unknown true_values: field migration_candidate: 2 of 20 value(s) not in true_values / false_values; stored as null',
    ]);
  });
});
