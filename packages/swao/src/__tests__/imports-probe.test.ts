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
import { buildImportsProbe } from '../context/imports-probe.js';
import { scaffoldImports } from '../commands/init.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-imports-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeSwaoYml(contextInputs: string): void {
  writeFileSync(
    join(tmp, '.swao.yml'),
    `wsp_version: "0.9"\napp_id: imp-test\n${contextInputs}\n`,
    'utf-8',
  );
}

function writeFile(rel: string, body: string): void {
  const full = join(tmp, rel);
  mkdirSync(join(tmp, rel.split('/').slice(0, -1).join('/')), { recursive: true });
  writeFileSync(full, body, 'utf-8');
}

// #1064: scaffoldImports no longer creates cmdb-sample.csv. Tests that
// reference the file must create it explicitly.
const CMDB_STUB_CSV =
  'app_id,sla_tier,rto_hours,rpo_hours,pii_classification,compliance_regimes,data_residency_requirement\n' +
  'test,tier_2,4,1,unknown,GDPR,EU\n';

function writeCmdbStub(dir: string = tmp): void {
  const d = join(dir, 'wsp', 'inputs', 'cmdb');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'cmdb-sample.csv'), CMDB_STUB_CSV, 'utf-8');
}

describe('buildImportsProbe (#0189)', () => {
  it('returns absent when context_inputs[] is empty or missing', () => {
    expect(buildImportsProbe(tmp).status).toBe('absent');
    writeFileSync(join(tmp, '.swao.yml'), 'wsp_version: "0.9"\n', 'utf-8');
    expect(buildImportsProbe(tmp).status).toBe('absent');
  });

  it('returns ok when only the cmdb stub is registered and present', () => {
    scaffoldImports(tmp);
    writeCmdbStub();
    writeSwaoYml(`context_inputs:
  - { id: cmdb, type: cmdb_export, path: wsp/inputs/cmdb/cmdb-sample.csv }`);
    const r = buildImportsProbe(tmp);
    expect(r.status).toBe('ok');
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.type).toBe('cmdb_export');
  });

  it('returns ok when cmdb + finops + incidents are all registered and present', () => {
    scaffoldImports(tmp);
    writeCmdbStub();
    // Files below simulate what Pass 00 (INGEST) routes from ingestion/ -- not scaffold files.
    writeFile('wsp/inputs/finops/finops.csv', 'app_id,month,cost_usd\nx,2026-04,100\n');
    writeFile('wsp/inputs/incidents/incidents.csv', 'incident_id,app_id,severity\nINC001,x,P2\n');
    writeSwaoYml(`context_inputs:
  - { id: cmdb,      type: cmdb_export,        path: wsp/inputs/cmdb/cmdb-sample.csv }
  - { id: finops,    type: finops_costing,     path: wsp/inputs/finops/finops.csv }
  - { id: incidents, type: servicenow_tickets, path: wsp/inputs/incidents/incidents.csv }`);
    const r = buildImportsProbe(tmp);
    expect(r.status).toBe('ok');
    expect(r.findings).toHaveLength(3);
    expect(r.message).toMatch(/3 template\(s\) registered, all OK/);
  });

  it('finops/incidents/architecture/workshops/ops are presence-only (no column check)', () => {
    scaffoldImports(tmp);
    // Write a finops file with a deliberately unusual / non-CMDB header (no CMDB needed here)
    writeFile('wsp/inputs/finops/custom.csv', 'a,b,c\n1,2,3\n');
    writeSwaoYml(`context_inputs:
  - { id: finops, type: finops_costing, path: wsp/inputs/finops/custom.csv }`);
    const r = buildImportsProbe(tmp);
    expect(r.status).toBe('ok');
    expect(r.findings[0]?.missing_required).toEqual([]);
    expect(r.findings[0]?.missing_recommended).toEqual([]);
  });

  it('reports fail when a registered file is missing', () => {
    writeSwaoYml(`context_inputs:
  - { id: workshop, type: meeting_transcript, path: wsp/inputs/workshops/notes.md }`);
    const r = buildImportsProbe(tmp);
    expect(r.status).toBe('fail');
    expect(r.findings[0]?.error).toMatch(/file not found/);
  });

  it('reports degraded when cmdb_export is missing recommended columns', () => {
    writeFile('wsp/inputs/cmdb/cmdb.csv', 'app_id,sla_tier\nx,tier_2\n');
    writeSwaoYml(`context_inputs:
  - { id: cmdb, type: cmdb_export, path: wsp/inputs/cmdb/cmdb.csv }`);
    const r = buildImportsProbe(tmp);
    expect(r.status).toBe('degraded');
    expect(r.findings[0]?.missing_recommended.length).toBeGreaterThan(0);
  });

  it('reports blocked when cmdb_export is missing required columns', () => {
    writeFile(
      'wsp/inputs/cmdb/cmdb.csv',
      'rto_hours,rpo_hours,pii_classification,compliance_regimes,data_residency_requirement\n4,1,unknown,GDPR,EU\n',
    );
    writeSwaoYml(`context_inputs:
  - { id: cmdb, type: cmdb_export, path: wsp/inputs/cmdb/cmdb.csv }`);
    const r = buildImportsProbe(tmp);
    expect(r.status).toBe('blocked');
    // app_id and sla_tier missing
    expect(r.findings[0]?.missing_required).toEqual(expect.arrayContaining(['app_id', 'sla_tier']));
  });

  it('mixed: cmdb ok + finops missing -> aggregate fail', () => {
    scaffoldImports(tmp);
    writeCmdbStub();
    writeSwaoYml(`context_inputs:
  - { id: cmdb,   type: cmdb_export,    path: wsp/inputs/cmdb/cmdb-sample.csv }
  - { id: finops, type: finops_costing, path: imports/finops/notreal.csv }`);
    const r = buildImportsProbe(tmp);
    expect(r.status).toBe('fail');
    expect(r.findings.find((f) => f.id === 'cmdb')?.status).toBe('ok');
    expect(r.findings.find((f) => f.id === 'finops')?.status).toBe('fail');
  });

  it('mixed: cmdb degraded + finops ok -> aggregate degraded', () => {
    writeFile('wsp/inputs/cmdb/cmdb.csv', 'app_id,sla_tier\nx,tier_2\n');
    writeFile('wsp/inputs/finops/finops.csv', 'app_id,month,cost_usd\nx,2026-04,100\n');
    writeSwaoYml(`context_inputs:
  - { id: cmdb,   type: cmdb_export,    path: wsp/inputs/cmdb/cmdb.csv }
  - { id: finops, type: finops_costing, path: wsp/inputs/finops/finops.csv }`);
    const r = buildImportsProbe(tmp);
    expect(r.status).toBe('degraded');
  });

  // Deleted: 'full happy path: scaffolded workspace with all 6 templates registered reports ok'
  // Reason: #1064 -- scaffold no longer writes sample files into wsp/inputs/. All input
  // files arrive via Pass 00 (INGEST) from the operator's ingestion/ folder. The 6-template
  // scaffold pattern is removed.

  describe('portfolio-shape awareness (apps/<id>/)', () => {
    function makeApp(appId: string, contextInputsBlock: string): string {
      const appDir = join(tmp, 'apps', appId);
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        join(appDir, '.swao.yml'),
        `wsp_version: "0.9"\napp_id: ${appId}\n${contextInputsBlock}\n`,
        'utf-8',
      );
      return appDir;
    }

    it('walks apps/<id>/.swao.yml and aggregates findings across apps', () => {
      // Two apps, each with its own cmdb file -- both are scaffolded so
      // doctor sees a healthy portfolio.
      const appA = makeApp('app-a', `context_inputs:
  - { id: cmdb, type: cmdb_export, path: wsp/inputs/cmdb/cmdb-sample.csv }`);
      const appB = makeApp('app-b', `context_inputs:
  - { id: cmdb, type: cmdb_export, path: wsp/inputs/cmdb/cmdb-sample.csv }`);
      scaffoldImports(appA);
      writeCmdbStub(appA);
      scaffoldImports(appB);
      writeCmdbStub(appB);

      const r = buildImportsProbe(tmp);
      expect(r.status).toBe('ok');
      expect(r.findings).toHaveLength(2);
      expect(r.message).toMatch(/2 template\(s\) registered, all OK/);
    });

    it('resolves context_inputs paths relative to each app dir, not the workspace root', () => {
      // Sanity check: if the probe resolved relative to workspace root the
      // file would not exist and the aggregate would flip to 'fail'.
      const appA = makeApp('app-a', `context_inputs:
  - { id: cmdb, type: cmdb_export, path: wsp/inputs/cmdb/cmdb-sample.csv }`);
      scaffoldImports(appA);
      writeCmdbStub(appA);

      const r = buildImportsProbe(tmp);
      expect(r.status).toBe('ok');
      expect(r.findings[0]?.error).toBeNull();
    });

    it('absent when apps/ exists but no app has registered context_inputs', () => {
      makeApp('app-a', '');
      const r = buildImportsProbe(tmp);
      expect(r.status).toBe('absent');
      expect(r.message).toMatch(/1 app\(s\) configured; none have context_inputs/);
    });

    it('absent with helpful message when apps/ is missing entirely', () => {
      const r = buildImportsProbe(tmp);
      expect(r.status).toBe('absent');
      expect(r.message).toMatch(/no context_inputs entries registered/);
    });
  });

  it('back-compat: buildCmdbProbe still returns CMDB-only findings', async () => {
    const { buildCmdbProbe } = await import('../context/cmdb-probe.js');
    scaffoldImports(tmp);
    writeCmdbStub();
    writeSwaoYml(`context_inputs:
  - { id: cmdb, type: cmdb_export, path: wsp/inputs/cmdb/cmdb-sample.csv }`);
    const r = buildCmdbProbe(tmp);
    expect(r.status).toBe('ok');
    expect(r.files).toHaveLength(1);
    expect(r.files[0]?.path).toBe('wsp/inputs/cmdb/cmdb-sample.csv');
  });
});
