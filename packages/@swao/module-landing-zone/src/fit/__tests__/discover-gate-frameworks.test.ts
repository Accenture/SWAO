// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module -- gate-capable framework discovery tests (#1379, #1535)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverGateCapableFrameworks } from '../run-lz.js';

// A catalogs path with no community/ subdirectory -- no frameworks installed.
const NO_WORKSPACE = join(tmpdir(), 'swao-1379-none');

function makeCatalogs(): string {
  return mkdtempSync(join(tmpdir(), 'swao-1379-'));
}

function addFramework(
  catalogsDir: string,
  id: string,
  opts: { name?: string; sovereigntyRequirements?: string } = {},
): void {
  const fwDir = join(catalogsDir, 'community', id.toLowerCase());
  mkdirSync(fwDir, { recursive: true });
  const lines = [
    'framework:',
    `  id: ${id}`,
    opts.name ? `  name: ${opts.name}` : `  name: ${id}`,
  ];
  if (opts.sovereigntyRequirements) {
    lines.push('  sovereignty_requirements:', ...opts.sovereigntyRequirements.split('\n').map(l => '    ' + l));
  }
  writeFileSync(join(fwDir, 'framework-meta.yaml'), lines.join('\n') + '\n');
}

describe('discoverGateCapableFrameworks (#1379, #1535)', () => {
  it('returns empty list when no community/ folder exists in catalogs dir', () => {
    const found = discoverGateCapableFrameworks(NO_WORKSPACE);
    expect(found).toHaveLength(0);
  });

  it('discovers a workspace-installed framework that declares a sovereignty gate', () => {
    const catalogs = makeCatalogs();
    addFramework(catalogs, 'MY_SOV', {
      name: 'My Sovereignty Framework',
      sovereigntyRequirements: [
        'require_operator_jurisdiction:',
        '  - EU-entity',
      ].join('\n'),
    });
    const found = discoverGateCapableFrameworks(catalogs);
    expect(found).toHaveLength(1);
    const fw = found[0]!;
    expect(fw.id).toBe('MY_SOV');
    expect(fw.name).toBe('My Sovereignty Framework');
    expect(fw.gate_summary).toContain('EU-entity');
  });

  it('includes frameworks that lack sovereignty_requirements with a generic gate_summary (#1678)', () => {
    const catalogs = makeCatalogs();
    addFramework(catalogs, 'SOV_GATE', {
      sovereigntyRequirements: 'require_operator_jurisdiction:\n  - EU-entity',
    });
    addFramework(catalogs, 'NO_GATE', {});
    const found = discoverGateCapableFrameworks(catalogs);
    const ids = found.map(f => f.id);
    expect(ids).toContain('SOV_GATE');
    expect(ids).toContain('NO_GATE');
    const noGate = found.find(f => f.id === 'NO_GATE');
    expect(noGate?.gate_summary).toBe('no sovereignty requirements defined');
  });

  it('returns a sorted, stable list when multiple gate-capable frameworks are installed', () => {
    const catalogs = makeCatalogs();
    const gateDef = 'require_operator_jurisdiction:\n  - EU-entity';
    addFramework(catalogs, 'ZZZ_LAST', { sovereigntyRequirements: gateDef });
    addFramework(catalogs, 'AAA_FIRST', { sovereigntyRequirements: gateDef });
    addFramework(catalogs, 'MMM_MID', { sovereigntyRequirements: gateDef });
    const found = discoverGateCapableFrameworks(catalogs);
    const ids = found.map(f => f.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('picks up a workspace-installed framework with a multi-field gate', () => {
    const catalogs = makeCatalogs();
    addFramework(catalogs, 'CUSTOM_SOV', {
      name: 'Custom Sovereignty Framework',
      sovereigntyRequirements: [
        'require_operator_jurisdiction:',
        '  - EU-entity',
      ].join('\n'),
    });
    const found = discoverGateCapableFrameworks(catalogs);
    const custom = found.find(f => f.id === 'CUSTOM_SOV');
    expect(custom).toBeDefined();
    expect(custom!.name).toBe('Custom Sovereignty Framework');
    expect(custom!.gate_summary).toContain('EU-entity');
  });

  it('bundled-dir frameworks are not surfaced -- workspace is the sole source (#1659)', () => {
    const catalogs = makeCatalogs();
    const bundled = mkdtempSync(join(tmpdir(), 'swao-1584-bundled-'));
    const fwDir = join(bundled, 'bundled_sov');
    mkdirSync(fwDir, { recursive: true });
    writeFileSync(join(fwDir, 'framework-meta.yaml'), [
      'framework:',
      '  id: BUNDLED_SOV',
      '  name: Bundled Sovereignty Framework',
      '  sovereignty_requirements:',
      '    require_operator_jurisdiction:',
      '      - EU-entity',
    ].join('\n') + '\n');
    const found = discoverGateCapableFrameworks(catalogs, bundled);
    // bundled dir is no longer a source; BUNDLED_SOV must not appear (#1659)
    expect(found.find(f => f.id === 'BUNDLED_SOV')).toBeUndefined();
  });

  it('includes _DEMO frameworks installed in the workspace community folder (#1678)', () => {
    // #1678: all installed frameworks are shown; demo seeding on existing workspaces
    // is prevented by #1679 (swao init skips demos when .swao.yml exists).
    const catalogs = makeCatalogs();
    addFramework(catalogs, 'GDPR_DEMO', {
      name: 'GDPR Demo',
      sovereigntyRequirements: 'require_operator_jurisdiction:\n  - EU-entity',
    });
    const found = discoverGateCapableFrameworks(catalogs);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe('GDPR_DEMO');
  });

  it('includes _DEMO frameworks with sovereignty requirements in their gate_summary (#1678)', () => {
    const catalogs = makeCatalogs();
    const gateDef = 'require_operator_jurisdiction:\n  - EU-entity';
    addFramework(catalogs, 'BSI_C5_DEMO', { sovereigntyRequirements: gateDef });
    addFramework(catalogs, 'GDPR_DEMO', { sovereigntyRequirements: gateDef });
    expect(discoverGateCapableFrameworks(catalogs)).toHaveLength(2);
  });

  it('includes both _DEMO and non-_DEMO frameworks from the same workspace (#1678)', () => {
    const catalogs = makeCatalogs();
    const gateDef = 'require_operator_jurisdiction:\n  - EU-entity';
    addFramework(catalogs, 'GDPR_DEMO', { sovereigntyRequirements: gateDef });
    addFramework(catalogs, 'GDPR', { name: 'GDPR', sovereigntyRequirements: gateDef });
    const found = discoverGateCapableFrameworks(catalogs);
    expect(found.map(f => f.id)).toContain('GDPR_DEMO');
    expect(found.map(f => f.id)).toContain('GDPR');
  });

  it('workspace framework overrides bundled framework with same ID (#1584)', () => {
    const catalogs = makeCatalogs();
    const bundled = mkdtempSync(join(tmpdir(), 'swao-1584-override-'));
    const gateDef = 'require_operator_jurisdiction:\n  - EU-entity';
    // Write to bundled dir directly (flat structure like communityFrameworksDir)
    const bFwDir = join(bundled, 'shared_fw');
    mkdirSync(bFwDir, { recursive: true });
    writeFileSync(join(bFwDir, 'framework-meta.yaml'), `framework:\n  id: SHARED_FW\n  name: Bundled Name\n  sovereignty_requirements:\n    ${gateDef.split('\n').join('\n    ')}\n`);
    addFramework(catalogs, 'SHARED_FW', { name: 'Workspace Name', sovereigntyRequirements: gateDef });
    const found = discoverGateCapableFrameworks(catalogs, bundled);
    const fw = found.find(f => f.id === 'SHARED_FW');
    expect(fw?.name).toBe('Workspace Name');
  });
});
