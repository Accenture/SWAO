// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Phase 1 integration suite (#3085, Design 103 §19.3, G-02..G-06): real .xlsx -> workspace.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { ScaffoldSignalsFileSchema } from '@swao/core';
import { runServiceInit } from '../scaffold/init.js';
import { tier2Dir } from '../catalog/infra-cat.js';
import { ServiceAppConfigSchema } from '../schema/service-app.schema.js';
import {
  DEFAULT_HEADERS,
  DEFAULT_TEMPLATE_ROWS,
  MAPPED_COLUMN_MAP_YAML,
  MAPPED_HEADERS,
  MAPPED_ROWS,
  PLANTED_PII,
  TIER2_YAML,
  writeWorkbook,
} from './fixtures/scaffold-fixture.js';

const tmp: string[] = [];
afterAll(() => { for (const d of tmp) rmSync(d, { recursive: true, force: true }); });

function newWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-service-e2e-'));
  tmp.push(ws);
  writeFileSync(join(ws, '.swao.yml'), '# .swao.yml -- SWAO workspace configuration\nwsp_version: "0.9"\n\nengagement:\n  name: "fixture"\n');
  mkdirSync(tier2Dir(ws), { recursive: true });
  writeFileSync(join(tier2Dir(ws), 'custom.yaml'), TIER2_YAML);
  return ws;
}

function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? allFiles(p) : [p];
  });
}

const appYml = (ws: string, id: string) => load(readFileSync(join(ws, 'apps', id, '.swao.yml'), 'utf-8')) as Record<string, any>;

describe('swao service init: default template workbook (20 rows)', () => {
  let ws: string;
  let result: Awaited<ReturnType<typeof runServiceInit>>;

  beforeAll(async () => {
    ws = newWorkspace();
    const xlsx = join(ws, 'intake.xlsx');
    await writeWorkbook(xlsx, [{ name: 'Sheet1', headers: DEFAULT_HEADERS, rows: DEFAULT_TEMPLATE_ROWS }]);
    result = await runServiceInit({ workspacePath: ws, intakePath: xlsx });
  });

  it('creates one folder per app with a cluster folder for the 5 VDI rows', () => {
    expect(result.ok).toBe(true);
    const folders = readdirSync(join(ws, 'apps')).sort();
    expect(folders).toHaveLength(16);
    expect(folders).toContain('hoscix-cluster');
    expect(folders.some((f) => /^hoscix00\d$/.test(f))).toBe(false);
    expect(appYml(ws, 'hoscix-cluster')).toMatchObject({ cluster: true, cluster_member_count: 5 });
  });

  it('writes valid per-app .swao.yml files with assessment.type service', () => {
    for (const id of readdirSync(join(ws, 'apps'))) {
      const doc = appYml(ws, id);
      expect(doc['assessment']).toEqual({ type: 'service', regimes_active: ['SWAO_APM'] });
      expect(() => ServiceAppConfigSchema.parse(doc)).not.toThrow();
      // #3212: only the drop folder is created; no empty hint or input folders
      expect(existsSync(join(ws, 'apps', id, 'ingestion'))).toBe(true);
      expect(readdirSync(join(ws, 'apps', id, 'ingestion'))).toEqual([]);
      expect(existsSync(join(ws, 'apps', id, 'wsp', 'inputs'))).toBe(false);
    }
  });

  it('classifies the FUJIFILM rows as INFRA_MEDIZIN_PACS and keeps the compound identity', () => {
    expect(appYml(ws, 'hosapp200')['infra_category']).toBe('INFRA_MEDIZIN_PACS');
    expect(appYml(ws, 'hospacs004')['infra_category']).toBe('INFRA_MEDIZIN_PACS');
    expect(appYml(ws, 'hosapp133')).toMatchObject({ app_id: 'hosapp133', app_name: 'Radimetrics', site: 'Main site' });
  });

  it('records SCAFFOLD.CATEGORY_UNKNOWN for unmatched rows and lists them for the analyst (G-05)', () => {
    const file = ScaffoldSignalsFileSchema.parse(JSON.parse(readFileSync(join(ws, 'wsp', 'signals', 'scaffold-signals.json'), 'utf-8')));
    const unknown = file.signals.filter((s) => s.code === 'SCAFFOLD.CATEGORY_UNKNOWN').map((s) => s.app_id).sort();
    expect(unknown).toEqual(['hosapp045', 'hosapp098']);
    expect(result.ok && result.unknownAppIds.sort()).toEqual(['hosapp045', 'hosapp098']);
    expect(file.counts['SCAFFOLD.CLUSTER_DETECTED']).toBe(1);
  });

  it('writes no phone, email, or contact value to ANY file in the workspace (G-06)', () => {
    for (const f of allFiles(ws).filter((p) => !p.endsWith('.xlsx'))) {
      const text = readFileSync(f, 'utf-8');
      for (const v of PLANTED_PII) expect(text, `${f} contains planted PII`).not.toContain(v);
    }
    expect(appYml(ws, 'hosapp133')['vendor']).toMatchObject({ support_contact_present: true, support_phone_present: true, support_email_present: true });
    expect(appYml(ws, 'hosapp300')['vendor']['name']).toBe('[contact-name-redacted]');
  });

  it('records intake metadata (header names, not values) in the workspace .swao.yml', () => {
    const doc = load(readFileSync(join(ws, '.swao.yml'), 'utf-8')) as Record<string, any>;
    expect(doc['engagement']).toEqual({ name: 'fixture' });
    expect(doc['service_portfolio']).toMatchObject({ source: 'intake.xlsx', mapping: null, app_count: 16, row_count: 20, sheets: ['Sheet1'], pii_columns: ['L', 'M', 'N'], cluster_threshold: 3 });
    expect(doc['service_portfolio']['headers']['Sheet1']['M']).toBe('Phone');
  });

  it('leaves existing service apps unchanged without --refresh and refreshes only generated_fields with it', async () => {
    const p = join(ws, 'apps', 'hosapp098', '.swao.yml');
    const doc = appYml(ws, 'hosapp098');
    doc['infra_category'] = 'INFRA_WORKPLACE_PRINT';
    doc['generated_fields'] = (doc['generated_fields'] as string[]).filter((k) => k !== 'infra_category');
    doc['analyst_notes'] = 'kept';
    const { dump } = await import('js-yaml');
    writeFileSync(p, dump(doc));

    const again = await runServiceInit({ workspacePath: ws, intakePath: join(ws, 'intake.xlsx') });
    expect(again.ok && again.write.skippedExisting).toHaveLength(16);
    const refreshed = await runServiceInit({ workspacePath: ws, intakePath: join(ws, 'intake.xlsx'), refresh: true });
    expect(refreshed.ok && refreshed.write.refreshed).toHaveLength(16);
    expect(appYml(ws, 'hosapp098')).toMatchObject({ infra_category: 'INFRA_WORKPLACE_PRINT', analyst_notes: 'kept', app_name: 'Room Booking' });
  });
});

describe('swao service init: custom 18-column mapping', () => {
  let ws: string;
  beforeAll(async () => {
    ws = newWorkspace();
    const xlsx = join(ws, 'inventory.xlsx');
    const map = join(ws, 'column-map.yaml');
    await writeWorkbook(xlsx, [{ name: 'Inventory', headers: MAPPED_HEADERS, rows: MAPPED_ROWS }]);
    writeFileSync(map, MAPPED_COLUMN_MAP_YAML);
    const res = await runServiceInit({ workspacePath: ws, intakePath: xlsx, mappingPath: map });
    expect(res.ok).toBe(true);
  });

  it('parses compound identity, MiB disk, and operational status per row (G-03, G-04)', () => {
    expect(appYml(ws, 'hosapp133')).toMatchObject({ app_name: 'Radimetrics', integrations: ['hosapp141'] });
    expect(appYml(ws, 'hospacs004')['hardware']).toMatchObject({ total_disk_mib: 1048576, total_disk_gb: 1024 });
    const status = (id: string) => appYml(ws, id)['disposition']['operational_status'];
    expect([status('hosapp045'), status('hosapp050'), status('hosapp051'), status('hosapp060'), status('hosapp133')])
      .toEqual(['restricted', 'decommissioned', 'unused', 'inactive', 'active']);
    expect(appYml(ws, 'hosapp153-macmon')).toMatchObject({ app_name: null, integrations_notes: 'Anbindung ans PACS' });
  });

  it('records the mapping path and declared PII columns, and writes no PII anywhere', () => {
    const doc = load(readFileSync(join(ws, '.swao.yml'), 'utf-8')) as Record<string, any>;
    expect(doc['service_portfolio']).toMatchObject({ mapping: 'column-map.yaml', pii_columns: ['K', 'L', 'N'] });
    for (const f of allFiles(ws).filter((p) => !p.endsWith('.xlsx') && !p.endsWith('column-map.yaml'))) {
      const text = readFileSync(f, 'utf-8');
      for (const v of PLANTED_PII) expect(text, `${f} contains planted PII`).not.toContain(v);
    }
  });
});

describe('swao service init: safety', () => {
  it('halts on duplicate IDs before writing any app folder', async () => {
    const ws = newWorkspace();
    const xlsx = join(ws, 'dup.xlsx');
    await writeWorkbook(xlsx, [{ name: 'S', headers: ['App ID', 'OS'], rows: [['HOSAPP001', 'x'], ['HOSAPP001', 'y']] }]);
    const res = await runServiceInit({ workspacePath: ws, intakePath: xlsx });
    expect(res).toMatchObject({ ok: false, reason: 'duplicate_ids', duplicateIds: ['hosapp001'] });
    expect(existsSync(join(ws, 'apps'))).toBe(false);
  });

  it('reports existing service apps the intake no longer produces and leaves them untouched (#3167)', async () => {
    const ws = newWorkspace();
    const first = join(ws, 'first.xlsx');
    // An older parser (or an earlier workbook) produced a long ID with note text
    await writeWorkbook(first, [{ name: 'S', headers: ['App ID', 'OS'], rows: [['HOSAPP001', 'x'], ['HOSAPP002', 'y']] }]);
    expect((await runServiceInit({ workspacePath: ws, intakePath: first })).ok).toBe(true);
    mkdirSync(join(ws, 'apps', 'hosapp003-old-long-id'), { recursive: true });
    writeFileSync(join(ws, 'apps', 'hosapp003-old-long-id', '.swao.yml'), 'app_id: hosapp003-old-long-id\nassessment:\n  type: service\n');
    const second = join(ws, 'second.xlsx');
    await writeWorkbook(second, [{ name: 'S', headers: ['App ID', 'OS'], rows: [['HOSAPP001', 'x'], ['HOSAPP003', 'z']] }]);
    // #3521: a second workbook needs an explicit choice; 'keep' is the pre-#3521 behaviour.
    const res = await runServiceInit({ workspacePath: ws, intakePath: second, refresh: true, otherSource: 'keep' });
    expect(res.ok && res.write.notInIntake).toEqual(['hosapp002', 'hosapp003-old-long-id']);
    expect(existsSync(join(ws, 'apps', 'hosapp002', '.swao.yml'))).toBe(true);
  });

  it('never overwrites an existing application app with the same ID', async () => {
    const ws = newWorkspace();
    mkdirSync(join(ws, 'apps', 'hosapp001'), { recursive: true });
    const original = 'app_id: hosapp001\nsource:\n  path: wsp/inputs/source/\n';
    writeFileSync(join(ws, 'apps', 'hosapp001', '.swao.yml'), original);
    const xlsx = join(ws, 'one.xlsx');
    await writeWorkbook(xlsx, [{ name: 'S', headers: ['App ID', 'OS'], rows: [['HOSAPP001', 'x'], ['HOSAPP002', 'y']] }]);
    const res = await runServiceInit({ workspacePath: ws, intakePath: xlsx, refresh: true });
    expect(res.ok && res.write.conflicts).toEqual(['hosapp001']);
    expect(readFileSync(join(ws, 'apps', 'hosapp001', '.swao.yml'), 'utf-8')).toBe(original);
    expect(existsSync(join(ws, 'apps', 'hosapp002', '.swao.yml'))).toBe(true);
  });
});

// #3521: a second intake workbook next to an earlier import duplicated every service.
describe('swao service init: second intake workbook (#3521)', () => {
  const HEAD = ['App ID', 'OS'];
  const listApps = (ws: string) => readdirSync(join(ws, 'apps')).sort();
  const wsYml = (ws: string) => readFileSync(join(ws, '.swao.yml'), 'utf-8');

  /** Workspace scaffolded from first.xlsx; second.xlsx describes the same rows under other IDs (plus one shared ID). */
  async function twoWorkbooks(): Promise<{ ws: string; first: string; second: string }> {
    const ws = newWorkspace();
    const first = join(ws, 'first.xlsx');
    const second = join(ws, 'second.xlsx');
    await writeWorkbook(first, [{ name: 'S', headers: HEAD, rows: [['VMA001', 'x'], ['VMA002', 'y'], ['SHARED01', 'z']] }]);
    await writeWorkbook(second, [{ name: 'S', headers: HEAD, rows: [['APP0001', 'x'], ['APP0002', 'y'], ['SHARED01', 'z']] }]);
    expect((await runServiceInit({ workspacePath: ws, intakePath: first })).ok).toBe(true);
    return { ws, first, second };
  }

  it('records the workbook name and SHA-256 on every app and in service_portfolio', async () => {
    const { ws } = await twoWorkbooks();
    for (const id of listApps(ws)) {
      const intake = appYml(ws, id)['intake'];
      expect(intake).toMatchObject({ sheet: 'S', source: 'first.xlsx' });
      expect(intake['source_sha256']).toMatch(/^[a-f0-9]{64}$/);
      expect(() => ServiceAppConfigSchema.parse(appYml(ws, id))).not.toThrow();
    }
    const doc = load(wsYml(ws)) as Record<string, any>;
    expect(doc['service_portfolio']['source_sha256']).toBe(appYml(ws, 'vma001')['intake']['source_sha256']);
  });

  it('refuses a second workbook without a flag and writes nothing', async () => {
    const { ws, second } = await twoWorkbooks();
    const before = { apps: listApps(ws), yml: wsYml(ws), signals: readFileSync(join(ws, 'wsp', 'signals', 'scaffold-signals.json'), 'utf-8') };
    const res = await runServiceInit({ workspacePath: ws, intakePath: second });
    expect(res).toMatchObject({ ok: false, reason: 'other_intake_source', plannedAppCount: 3 });
    expect(!res.ok && res.reason === 'other_intake_source' && res.conflict).toEqual({ appIds: ['shared01', 'vma001', 'vma002'], sources: ['first.xlsx'] });
    expect(listApps(ws)).toEqual(before.apps);
    expect(wsYml(ws)).toBe(before.yml);
    expect(readFileSync(join(ws, 'wsp', 'signals', 'scaffold-signals.json'), 'utf-8')).toBe(before.signals);
  });

  it('refuses --refresh with a different workbook than the recorded one', async () => {
    const { ws, second } = await twoWorkbooks();
    const res = await runServiceInit({ workspacePath: ws, intakePath: second, refresh: true });
    expect(res).toMatchObject({ ok: false, reason: 'other_intake_source' });
    expect(listApps(ws)).toEqual(['shared01', 'vma001', 'vma002']);
  });

  it('--replace parks the apps of the old workbook and leaves exactly the new set', async () => {
    const { ws, second } = await twoWorkbooks();
    const res = await runServiceInit({ workspacePath: ws, intakePath: second, otherSource: 'replace' });
    expect(res.ok).toBe(true);
    expect(listApps(ws)).toEqual(['app0001', 'app0002', 'shared01']);
    // The shared ID is re-created from the new workbook, not left with the old source tag.
    for (const id of listApps(ws)) expect(appYml(ws, id)['intake']['source']).toBe('second.xlsx');
    expect(res.ok && res.parked?.appIds).toEqual(['shared01', 'vma001', 'vma002']);
    const parkedDir = join(ws, res.ok && res.parked ? res.parked.dir : 'x');
    expect(readdirSync(parkedDir).sort()).toEqual(['shared01', 'vma001', 'vma002']);
    expect(existsSync(join(parkedDir, 'vma001', '.swao.yml'))).toBe(true);
    expect((load(wsYml(ws)) as Record<string, any>)['service_portfolio']).toMatchObject({ source: 'second.xlsx', app_count: 3 });
  });

  it('--keep adds the new apps next to the old ones', async () => {
    const { ws, second } = await twoWorkbooks();
    const res = await runServiceInit({ workspacePath: ws, intakePath: second, otherSource: 'keep' });
    expect(res.ok && res.keptOtherSource).toEqual(['shared01', 'vma001', 'vma002']);
    expect(listApps(ws)).toEqual(['app0001', 'app0002', 'shared01', 'vma001', 'vma002']);
  });

  it('treats an edited workbook with the same name, and a renamed copy with the same bytes, as the same source', async () => {
    const { ws, first } = await twoWorkbooks();
    await writeWorkbook(first, [{ name: 'S', headers: HEAD, rows: [['VMA001', 'x'], ['VMA002', 'changed'], ['SHARED01', 'z'], ['VMA003', 'new']] }]);
    const edited = await runServiceInit({ workspacePath: ws, intakePath: first, refresh: true });
    expect(edited.ok && edited.write.refreshed).toHaveLength(3);
    const copy = join(ws, 'renamed.xlsx');
    writeFileSync(copy, readFileSync(first));
    expect((await runServiceInit({ workspacePath: ws, intakePath: copy, refresh: true })).ok).toBe(true);
  });

  it('falls back to service_portfolio.source for apps scaffolded before the source was recorded', async () => {
    const { ws, second } = await twoWorkbooks();
    // Strip the per-app record, as on apps written by SWAO 1.5 and earlier.
    for (const id of listApps(ws)) {
      const doc = appYml(ws, id);
      delete doc['intake']['source'];
      delete doc['intake']['source_sha256'];
      const { dump } = await import('js-yaml');
      writeFileSync(join(ws, 'apps', id, '.swao.yml'), dump(doc));
    }
    const res = await runServiceInit({ workspacePath: ws, intakePath: second });
    expect(res).toMatchObject({ ok: false, reason: 'other_intake_source', conflict: { sources: ['first.xlsx'] } });
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\n');
    const unknown = await runServiceInit({ workspacePath: ws, intakePath: second });
    expect(unknown).toMatchObject({ ok: false, reason: 'other_intake_source', conflict: { sources: ['(not recorded)'] } });
  });
});
