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

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildCmdbProbe } from '../context/cmdb-probe.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-cmdb-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeSwaoYml(contextInputs: string): void {
  writeFileSync(
    join(tmp, '.swao.yml'),
    `wsp_version: "0.9"\napp_id: cmdb-test\n${contextInputs}\n`,
    'utf-8',
  );
}

function writeCsv(filename: string, header: string, rows: string[] = []): void {
  mkdirSync(join(tmp, 'imports'), { recursive: true });
  const body = [header, ...rows].join('\n') + '\n';
  writeFileSync(join(tmp, 'imports', filename), body, 'utf-8');
}

describe('buildCmdbProbe (#0042)', () => {
  it('returns absent when .swao.yml has no context_inputs', () => {
    writeFileSync(join(tmp, '.swao.yml'), 'wsp_version: "0.9"\n', 'utf-8');
    const result = buildCmdbProbe(tmp);
    expect(result.status).toBe('absent');
    expect(result.files).toEqual([]);
  });

  it('returns absent when context_inputs has no cmdb_export entry', () => {
    writeSwaoYml(`context_inputs:
  - { id: workshop, type: meeting_transcript, path: imports/workshop.md }`);
    const result = buildCmdbProbe(tmp);
    expect(result.status).toBe('absent');
  });

  it('returns ok when all required + recommended columns are present', () => {
    writeSwaoYml(`context_inputs:
  - { id: cmdb, type: cmdb_export, path: imports/cmdb.csv }`);
    writeCsv(
      'cmdb.csv',
      'app_id,sla_tier,rto_hours,rpo_hours,pii_classification,compliance_regimes,data_residency_requirement',
    );
    const result = buildCmdbProbe(tmp);
    expect(result.status).toBe('ok');
    expect(result.files[0]?.status).toBe('ok');
    expect(result.files[0]?.missing_required).toEqual([]);
    expect(result.files[0]?.missing_recommended).toEqual([]);
  });

  it('returns degraded when only recommended columns are missing', () => {
    writeSwaoYml(`context_inputs:
  - { id: cmdb, type: cmdb_export, path: imports/cmdb.csv }`);
    writeCsv('cmdb.csv', 'app_id,sla_tier,rto_hours');
    const result = buildCmdbProbe(tmp);
    expect(result.status).toBe('degraded');
    const f = result.files[0]!;
    expect(f.missing_required).toEqual([]);
    expect(f.missing_recommended).toContain('rpo_hours');
    expect(f.missing_recommended).toContain('pii_classification');
  });

  it('returns blocked when a required column is missing', () => {
    writeSwaoYml(`context_inputs:
  - { id: cmdb, type: cmdb_export, path: imports/cmdb.csv }`);
    writeCsv(
      'cmdb.csv',
      'app_id,rto_hours,rpo_hours,pii_classification,compliance_regimes,data_residency_requirement',
    );
    const result = buildCmdbProbe(tmp);
    expect(result.status).toBe('blocked');
    expect(result.files[0]?.missing_required).toEqual(['sla_tier']);
  });

  it('reports fail when the file declared in context_inputs is missing', () => {
    writeSwaoYml(`context_inputs:
  - { id: cmdb, type: cmdb_export, path: imports/missing.csv }`);
    const result = buildCmdbProbe(tmp);
    expect(result.status).toBe('fail');
    expect(result.files[0]?.error).toMatch(/file not found/);
  });

  it('handles multiple cmdb_export entries with mixed status', () => {
    writeSwaoYml(`context_inputs:
  - { id: cmdb_a, type: cmdb_export, path: imports/cmdb_a.csv }
  - { id: cmdb_b, type: cmdb_export, path: imports/cmdb_b.csv }
  - { id: ws, type: meeting_transcript, path: imports/ws.md }`);
    writeCsv(
      'cmdb_a.csv',
      'app_id,sla_tier,rto_hours,rpo_hours,pii_classification,compliance_regimes,data_residency_requirement',
    );
    writeCsv('cmdb_b.csv', 'app_id,sla_tier,rto_hours');
    const result = buildCmdbProbe(tmp);
    expect(result.status).toBe('degraded');
    expect(result.files).toHaveLength(2);
    expect(result.files.find((f) => f.path.includes('cmdb_a'))?.status).toBe('ok');
    expect(result.files.find((f) => f.path.includes('cmdb_b'))?.status).toBe('degraded');
  });

  it('blocked status wins over degraded in the aggregate', () => {
    writeSwaoYml(`context_inputs:
  - { id: cmdb_good, type: cmdb_export, path: imports/cmdb_good.csv }
  - { id: cmdb_bad,  type: cmdb_export, path: imports/cmdb_bad.csv }`);
    writeCsv(
      'cmdb_good.csv',
      'app_id,sla_tier,rto_hours,rpo_hours,pii_classification,compliance_regimes,data_residency_requirement',
    );
    writeCsv('cmdb_bad.csv', 'app_id,rto_hours');
    const result = buildCmdbProbe(tmp);
    expect(result.status).toBe('blocked');
  });

  it('column matching is case-insensitive and tolerant of quoting', () => {
    writeSwaoYml(`context_inputs:
  - { id: cmdb, type: cmdb_export, path: imports/cmdb.csv }`);
    writeCsv(
      'cmdb.csv',
      '"App_ID","Sla_Tier","Rto_Hours","Rpo_Hours","PII_Classification","Compliance_Regimes","Data_Residency_Requirement"',
    );
    const result = buildCmdbProbe(tmp);
    expect(result.status).toBe('ok');
  });

  it('skips entries whose path is missing from the context_inputs entry', () => {
    writeSwaoYml(`context_inputs:
  - { id: cmdb_no_path, type: cmdb_export }
  - { id: cmdb_a, type: cmdb_export, path: imports/cmdb.csv }`);
    writeCsv(
      'cmdb.csv',
      'app_id,sla_tier,rto_hours,rpo_hours,pii_classification,compliance_regimes,data_residency_requirement',
    );
    const result = buildCmdbProbe(tmp);
    expect(result.status).toBe('ok');
    expect(result.files).toHaveLength(1);
  });
});
