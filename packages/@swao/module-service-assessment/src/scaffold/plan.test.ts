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

// Scaffold planning: cluster detection (#3080, G-02), UNKNOWN (G-05), config shape (#3078).
import { describe, it, expect } from 'vitest';
import { loadInfraCatalogue } from '../catalog/infra-cat.js';
import { parseIntakeSheets, type SheetLike } from '../intake/parser.js';
import { ServiceAppConfigSchema } from '../schema/service-app.schema.js';
import { planScaffold } from './plan.js';

const headers = ['App ID', 'App Name', 'Vendor', 'OS'];
function rowsOf(rows: Array<[string, string, string | null, string]>) {
  const grid: unknown[][] = [headers, ...rows];
  const sheet: SheetLike = { name: 'Sheet1', rowCount: grid.length, cell: (r, c) => grid[r - 1]?.[c - 1] ?? null };
  return parseIntakeSheets([sheet]).rows;
}
const cat = loadInfraCatalogue();
const vdi = (n: number, prefix = 'HOSCIX') =>
  Array.from({ length: n }, (_, i) => [`${prefix}00${i + 1}`, 'Citrix Worker', 'Citrix', 'Windows Server 2019'] as [string, string, string, string]);

describe('cluster detection (#3080, G-02)', () => {
  it('consolidates 5 rows sharing a cluster_hint category and id prefix into ONE cluster app', () => {
    const plan = planScaffold(rowsOf(vdi(5)), cat);
    expect(plan.apps).toHaveLength(1);
    const c = plan.apps[0]!;
    expect(c.appId).toBe('hoscix-cluster');
    expect(c.config).toMatchObject({ cluster: true, cluster_id: 'hoscix', cluster_member_count: 5, infra_category: 'INFRA_WORKPLACE_VDI' });
    expect(c.members).toEqual(['hoscix001', 'hoscix002', 'hoscix003', 'hoscix004', 'hoscix005']);
    const sig = plan.signals.find((s) => s.code === 'SCAFFOLD.CLUSTER_DETECTED')!;
    expect(sig.evidence).toEqual(c.members);
  });

  it('keeps 2 rows below the default threshold as 2 individual apps', () => {
    const plan = planScaffold(rowsOf(vdi(2)), cat);
    expect(plan.apps.map((a) => a.appId)).toEqual(['hoscix001', 'hoscix002']);
    expect(plan.signals.some((s) => s.code === 'SCAFFOLD.CLUSTER_DETECTED')).toBe(false);
  });

  it('honours a configurable threshold', () => {
    expect(planScaffold(rowsOf(vdi(2)), cat, { clusterThreshold: 2 }).apps).toHaveLength(1);
    expect(planScaffold(rowsOf(vdi(5)), cat, { clusterThreshold: 6 }).apps).toHaveLength(5);
  });

  it('never clusters entries without cluster_hint (PACS) or UNKNOWN rows', () => {
    const pacs = planScaffold(rowsOf([
      ['HOSPACS001', 'Archive', 'FUJIFILM', 'x'], ['HOSPACS002', 'Archive', 'FUJIFILM', 'x'], ['HOSPACS003', 'Archive', 'FUJIFILM', 'x'],
    ]), cat);
    expect(pacs.apps).toHaveLength(3);
    const unknown = planScaffold(rowsOf([
      ['HOSAPP001', 'Thing', null, 'x'], ['HOSAPP002', 'Thing', null, 'x'], ['HOSAPP003', 'Thing', null, 'x'],
    ]), cat);
    expect(unknown.apps).toHaveLength(3);
    expect(unknown.unknownAppIds).toEqual(['hosapp001', 'hosapp002', 'hosapp003']);
  });
});

describe('app config (#3078)', () => {
  it('builds a valid service app config with inferred health data and an UNKNOWN signal list (G-05)', () => {
    const plan = planScaffold(rowsOf([
      ['HOSPACS004', 'PACS Storage', 'FUJIFILM', 'Windows Server 2016'],
      ['HOSAPP045', 'Payroll Suite', null, 'Windows Server 2012'],
    ]), cat, { generatedAt: '2026-10-10' });
    for (const app of plan.apps) expect(() => ServiceAppConfigSchema.parse(app.config)).not.toThrow();
    const pacs = plan.apps[0]!.config;
    expect(pacs).toMatchObject({
      app_id: 'hospacs004',
      assessment: { type: 'service' },
      infra_category: 'INFRA_MEDIZIN_PACS',
      os_class: 'INFRA_PLATFORM_OS_WINDOWS_SERVER',
      data: { health_data: true, gdpr_art9: true },
      disposition: { operational_status: 'active' },
      generated_at: '2026-10-10',
    });
    expect(plan.unknownAppIds).toEqual(['hosapp045']);
    expect(plan.signals.filter((s) => s.code === 'SCAFFOLD.CATEGORY_UNKNOWN').map((s) => s.app_id)).toEqual(['hosapp045']);
  });

  it('rejects a raw phone value where a presence boolean is required', () => {
    const plan = planScaffold(rowsOf([['HOSAPP001', 'X', null, 'y']]), cat);
    const tampered = { ...plan.apps[0]!.config, vendor: { ...plan.apps[0]!.config.vendor, support_phone_present: '+49-123-456789' } };
    expect(() => ServiceAppConfigSchema.parse(tampered)).toThrow();
    const rawPhone = { ...plan.apps[0]!.config, vendor: { ...plan.apps[0]!.config.vendor, support_phone: '+49-123-456789' } };
    expect(() => ServiceAppConfigSchema.parse(rawPhone)).toThrow();
  });
});
