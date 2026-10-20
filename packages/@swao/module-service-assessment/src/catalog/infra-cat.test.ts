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

// SWAO-INFRA-CAT loader + classifier (#3079, Design 103 §17, G-01).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { TIER2_YAML } from '../__tests__/fixtures/scaffold-fixture.js';
import {
  InfraCatError, classify, discoverBuiltinCatalogueFiles, hasBuiltinCatalogueFiles, idPrefix, loadInfraCatalogue,
  resolveBuiltinCatalogueDir, tier2Dir,
} from './infra-cat.js';

let ws: string;
beforeAll(() => {
  ws = mkdtempSync(join(tmpdir(), 'swao-infracat-'));
  mkdirSync(tier2Dir(ws), { recursive: true });
  writeFileSync(join(tier2Dir(ws), 'custom.yaml'), TIER2_YAML);
});
afterAll(() => rmSync(ws, { recursive: true, force: true }));

/**
 * Merged Tier 1 catalogue as loaded from _registry.yaml before #3299 (files
 * platform, infrastructure, workplace, security, medizin): ordered service ids
 * with the file whose entry wins. classify() takes the first match in this
 * order, so the order is behaviour, not presentation.
 */
const PINNED_TIER1: Array<[string, string]> = [
  ['INFRA_PLATFORM_OS_WINDOWS_SERVER', 'platform.yaml'],
  ['INFRA_PLATFORM_OS_LINUX_DEBIAN', 'platform.yaml'],
  ['INFRA_PLATFORM_OS_LINUX_UBUNTU', 'platform.yaml'],
  ['INFRA_PLATFORM_OS_LINUX_SUSE', 'platform.yaml'],
  ['INFRA_PLATFORM_OS_LINUX_RHEL', 'platform.yaml'],
  ['INFRA_PLATFORM_OS_SOLARIS', 'platform.yaml'],
  ['INFRA_PLATFORM_DATABASE', 'platform.yaml'],
  ['INFRA_INFRASTRUCTURE_DIRECTORY', 'infrastructure.yaml'],
  ['INFRA_INFRASTRUCTURE_DHCP_DNS', 'infrastructure.yaml'],
  ['INFRA_INFRASTRUCTURE_FILE', 'infrastructure.yaml'],
  ['INFRA_INFRASTRUCTURE_BACKUP', 'infrastructure.yaml'],
  ['INFRA_INFRASTRUCTURE_MAIL', 'infrastructure.yaml'],
  ['INFRA_INFRASTRUCTURE_PKI', 'infrastructure.yaml'],
  ['INFRA_WORKPLACE_VDI', 'workplace.yaml'],
  ['INFRA_WORKPLACE_PRINT', 'workplace.yaml'],
  ['INFRA_WORKPLACE_THIN_CLIENT', 'workplace.yaml'],
  ['INFRA_SECURITY_ENDPOINT', 'security.yaml'],
  ['INFRA_SECURITY_NAC', 'security.yaml'],
  ['INFRA_SECURITY_SIEM', 'security.yaml'],
  ['INFRA_MEDIZIN_KIS', 'medizin.yaml'],
  ['INFRA_MEDIZIN_PACS', 'medizin.yaml'],
  ['INFRA_MEDIZIN_LIS', 'medizin.yaml'],
  ['INFRA_MEDIZIN_PDMS', 'medizin.yaml'],
  ['INFRA_MEDIZIN_DOSE', 'medizin.yaml'],
  ['INFRA_MEDIZIN_TELEMATIK', 'medizin.yaml'],
];

describe('built-in Tier 1 catalogue', () => {
  it('pins the merged catalogue: file load order, service order and winning file (#3299)', () => {
    const cat = loadInfraCatalogue();
    expect(cat.sources.map((p) => basename(p))).toEqual(['platform.yaml', 'infrastructure.yaml', 'workplace.yaml', 'security.yaml', 'medizin.yaml']);
    expect(cat.services.map((s) => [s.id, basename(cat.origins![s.id]!)])).toEqual(PINNED_TIER1);
  });
  it('resolves controls/infra-catalogue and loads every catalogue file', () => {
    expect(resolveBuiltinCatalogueDir()).toMatch(/controls[\\/]infra-catalogue$/);
    const cat = loadInfraCatalogue();
    expect(cat.sources).toHaveLength(5);
    expect(cat.services.map((s) => s.id)).toContain('INFRA_MEDIZIN_PACS');
    expect(cat.sites).toEqual([]);
  });

  it('needs no _registry.yaml: the shipped directory has none and every file declares its own metadata', () => {
    const dir = resolveBuiltinCatalogueDir()!;
    expect(existsSync(join(dir, '_registry.yaml'))).toBe(false);
    const warnings: string[] = [];
    const files = discoverBuiltinCatalogueFiles(dir, { warn: (m) => warnings.push(m) });
    expect(warnings).toEqual([]);
    expect(files.map((f) => [f.file, f.id, f.load_order])).toEqual([
      ['platform.yaml', 'INFRA_PLATFORM', 10],
      ['infrastructure.yaml', 'INFRA_INFRASTRUCTURE', 20],
      ['workplace.yaml', 'INFRA_WORKPLACE', 30],
      ['security.yaml', 'INFRA_SECURITY', 40],
      ['medizin.yaml', 'INFRA_MEDIZIN', 50],
    ]);
  });

  it('honours SWAO_INFRA_CATALOGUE_DIR and fails loudly when no Tier 1 catalogue exists', () => {
    const real = resolveBuiltinCatalogueDir()!;
    process.env['SWAO_INFRA_CATALOGUE_DIR'] = real;
    try {
      expect(resolveBuiltinCatalogueDir()).toBe(real);
    } finally {
      delete process.env['SWAO_INFRA_CATALOGUE_DIR'];
    }
    expect(loadInfraCatalogue({ builtinDir: null }).services).toEqual([]);
  });

  it('raises InfraCatError for an invalid catalogue file', () => {
    const bad = mkdtempSync(join(tmpdir(), 'swao-infracat-bad-'));
    mkdirSync(tier2Dir(bad), { recursive: true });
    writeFileSync(join(tier2Dir(bad), 'bad.yaml'), ['services:', '  - id: not-an-infra-id', '    name: x', ''].join('\n'));
    expect(() => loadInfraCatalogue({ workspacePath: bad })).toThrow(InfraCatError);
    rmSync(bad, { recursive: true, force: true });
  });

  it('contains no engagement-specific id prefixes (only generic role tokens)', () => {
    const hints = loadInfraCatalogue().services.flatMap((s) => s.id_prefix_hints ?? []);
    for (const h of hints) expect(h).toMatch(/^(kis|pacs|lab|pdms|icu)$/);
  });
});

describe('Tier 1 discovery from catalogue metadata (#3299)', () => {
  let dir: string;
  const svc = (id: string, name: string) => ['services:', `  - id: ${id}`, `    name: "${name}"`, ''].join('\n');
  const meta = (id: string, order: number | string) => [`id: ${id}`, `name: "${id}"`, `load_order: ${order}`, ''].join('\n');
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'swao-infracat-t1-'));
    // File names sort opposite to load_order, so precedence must come from the field.
    writeFileSync(join(dir, 'a-late.yaml'), meta('INFRA_LATE', 20) + svc('INFRA_SHARED', 'from late'));
    writeFileSync(join(dir, 'z-early.yaml'), meta('INFRA_EARLY', 10) + svc('INFRA_SHARED', 'from early') + '  - id: INFRA_EARLY_ONLY\n    name: "early only"\n');
    writeFileSync(join(dir, 'no-meta.yaml'), svc('INFRA_NO_META', 'no metadata'));
    writeFileSync(join(dir, 'bad-order.yaml'), meta('INFRA_BAD', '"first"') + svc('INFRA_BAD_ORDER', 'bad'));
    writeFileSync(join(dir, 'dup-id.yaml'), meta('INFRA_EARLY', 30) + svc('INFRA_DUP', 'duplicate catalogue id'));
    writeFileSync(join(dir, 'broken.yaml'), 'id: [unclosed\n');
    writeFileSync(join(dir, '_registry.yaml'), 'files: [no-meta.yaml]\n');
    writeFileSync(join(dir, 'notes.txt'), 'ignored');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('loads files in ascending load_order, later file wins on a duplicate service id, first position kept', () => {
    const warnings: string[] = [];
    const cat = loadInfraCatalogue({ builtinDir: dir, warn: (m) => warnings.push(m) });
    expect(cat.sources.map((p) => basename(p))).toEqual(['z-early.yaml', 'a-late.yaml']);
    expect(cat.services.map((s) => [s.id, s.name])).toEqual([['INFRA_SHARED', 'from late'], ['INFRA_EARLY_ONLY', 'early only']]);
    expect(basename(cat.origins!['INFRA_SHARED']!)).toBe('a-late.yaml');
    expect(warnings).toHaveLength(4);
  });

  it('skips missing or invalid metadata, invalid YAML and a duplicate catalogue id with a warning, never throws', () => {
    const warnings: string[] = [];
    expect(() => discoverBuiltinCatalogueFiles(dir, { warn: (m) => warnings.push(m) })).not.toThrow();
    expect(warnings.find((w) => w.includes('no-meta.yaml'))).toMatch(/metadata missing or invalid/);
    expect(warnings.find((w) => w.includes('bad-order.yaml'))).toMatch(/load_order/);
    expect(warnings.find((w) => w.includes('broken.yaml'))).toMatch(/not valid YAML/);
    expect(warnings.find((w) => w.includes('dup-id.yaml'))).toMatch(/INFRA_EARLY is already declared by z-early\.yaml/);
    expect(warnings.join('\n')).not.toMatch(/_registry|notes\.txt/);
  });

  it('breaks a load_order tie by file name', () => {
    const tie = mkdtempSync(join(tmpdir(), 'swao-infracat-tie-'));
    writeFileSync(join(tie, 'b.yaml'), meta('INFRA_B', 10) + svc('INFRA_X', 'from b'));
    writeFileSync(join(tie, 'a.yaml'), meta('INFRA_A', 10) + svc('INFRA_X', 'from a'));
    const cat = loadInfraCatalogue({ builtinDir: tie, warn: () => undefined });
    expect(cat.sources.map((p) => basename(p))).toEqual(['a.yaml', 'b.yaml']);
    expect(cat.services[0]!.name).toBe('from b');
    rmSync(tie, { recursive: true, force: true });
  });

  it('directory probe accepts a directory only when it holds a valid catalogue file', () => {
    expect(hasBuiltinCatalogueFiles(dir)).toBe(true);
    const onlyRegistry = mkdtempSync(join(tmpdir(), 'swao-infracat-reg-'));
    writeFileSync(join(onlyRegistry, '_registry.yaml'), 'files: [platform.yaml]\n');
    expect(hasBuiltinCatalogueFiles(onlyRegistry)).toBe(false);
    expect(hasBuiltinCatalogueFiles(join(onlyRegistry, 'missing'))).toBe(false);
    const real = resolveBuiltinCatalogueDir()!;
    process.env['SWAO_INFRA_CATALOGUE_DIR'] = onlyRegistry;
    try {
      // An override without valid catalogue files falls through to the walk-up.
      expect(resolveBuiltinCatalogueDir()).toBe(real);
      process.env['SWAO_INFRA_CATALOGUE_DIR'] = dir;
      expect(resolveBuiltinCatalogueDir()).toBe(dir);
    } finally {
      delete process.env['SWAO_INFRA_CATALOGUE_DIR'];
      rmSync(onlyRegistry, { recursive: true, force: true });
    }
  });

  it('Tier 2 files need no metadata and still load after Tier 1 in file-name order', () => {
    const cat = loadInfraCatalogue({ workspacePath: ws });
    expect(basename(cat.sources.at(-1)!)).toBe('custom.yaml');
    expect(cat.origins!['INFRA_MEDIZIN_PACS']).toMatch(/custom\.yaml$/);
  });
});

describe('classify (#3079)', () => {
  const cat = () => loadInfraCatalogue({ workspacePath: ws });

  it('matches by id_prefix_hints (role token after the site prefix)', () => {
    expect(idPrefix('hospacs004')).toBe('hospacs');
    const c = classify(cat(), { appId: 'hospacs004', appName: 'Storage' });
    expect(c).toMatchObject({ infra_category: 'INFRA_MEDIZIN_PACS', matched_by: 'id_prefix_hints' });
  });

  it('matches FUJIFILM by vendor_patterns', () => {
    const c = classify(cat(), { appId: 'hosapp200', vendorName: 'FUJIFILM', appName: 'Viewer' });
    expect(c).toMatchObject({ infra_category: 'INFRA_MEDIZIN_PACS', matched_by: 'vendor_patterns' });
  });

  it('matches by product_name_patterns when prefix and vendor do not match', () => {
    const c = classify(cat(), { appId: 'hosapp133', vendorName: 'Example Dose Vendor GmbH', appName: 'Radimetrics' });
    expect(c).toMatchObject({ infra_category: 'INFRA_MEDIZIN_DOSE', matched_by: 'product_name_patterns' });
  });

  it('applies priority id_prefix_hints > vendor_patterns > product_name_patterns', () => {
    const c = classify(cat(), { appId: 'hospacs010', vendorName: 'Veeam', appName: 'Citrix' });
    expect(c.matched_by).toBe('id_prefix_hints');
    expect(classify(cat(), { appId: 'hosapp010', vendorName: 'Veeam', appName: 'Citrix' }).infra_category).toBe('INFRA_INFRASTRUCTURE_BACKUP');
  });

  it('returns UNKNOWN when nothing matches, but still sets os_class', () => {
    const c = classify(cat(), { appId: 'hosapp045', appName: 'Payroll Suite', os: 'Microsoft Windows Server 2012 R2' });
    expect(c.infra_category).toBe('UNKNOWN');
    expect(c.os_class).toBe('INFRA_PLATFORM_OS_WINDOWS_SERVER');
  });

  it('lets a Tier 2 entry replace the Tier 1 entry with the same id', () => {
    const pacs = cat().services.find((s) => s.id === 'INFRA_MEDIZIN_PACS')!;
    expect(pacs.name).toBe('PACS (engagement override)');
    expect(pacs.sovereign_alternatives?.[0]?.name).toBe('Orthanc (engagement default)');
    expect(cat().services.filter((s) => s.id === 'INFRA_MEDIZIN_PACS')).toHaveLength(1);
  });

  it('derives four distinct sites from the Tier 2 prefix map (G-01)', () => {
    const sites = ['hosapp001', 'anxapp010', 'oldsrv001', 'remsrv002', 'zzzapp001'].map((id) => classify(cat(), { appId: id }).site);
    expect(sites).toEqual(['Main site', 'Annex', 'Legacy site', 'Remote site', null]);
    expect(new Set(sites.filter(Boolean)).size).toBe(4);
  });
});
