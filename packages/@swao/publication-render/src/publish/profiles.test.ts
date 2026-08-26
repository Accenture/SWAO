// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Publication renderer
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Tests for the profile YAML reader (Design 068 §20.5, Step 10 -- #0943).
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadProfileOverride, BLOCK_PROFILES } from './profiles.js';

function makeTmpWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'swao-profile-test-'));
}

function writeProfileYaml(workspace: string, profileId: string, content: string): void {
  const dir = join(workspace, 'wsp', 'templates', 'profiles');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${profileId}.yaml`), content, 'utf-8');
}

describe('loadProfileOverride', () => {

  it('returns null when no profile file exists', () => {
    const ws = makeTmpWorkspace();
    expect(loadProfileOverride(ws, 'application')).toBeNull();
  });

  it('returns null for a malformed YAML file', () => {
    const ws = makeTmpWorkspace();
    writeProfileYaml(ws, 'application', ': - invalid: yaml: [unclosed');
    expect(loadProfileOverride(ws, 'application')).toBeNull();
  });

  it('parses blocks with id + enabled + order', () => {
    const ws = makeTmpWorkspace();
    writeProfileYaml(ws, 'application', `
profile: application
blocks:
  - id: cover
    enabled: true
    order: 1
  - id: signal-list
    enabled: false
    order: 2
  - id: exec-summary
    enabled: true
    order: 3
`);
    const result = loadProfileOverride(ws, 'application');
    expect(result).not.toBeNull();
    expect(result!.profileId).toBe('application');
    expect(result!.blocks).toHaveLength(3);
    expect(result!.blocks[0].id).toBe('cover');
    expect(result!.blocks[0].enabled).toBe(true);
    expect(result!.blocks[1].id).toBe('signal-list');
    expect(result!.blocks[1].enabled).toBe(false);
    // sorted by order
    expect(result!.blocks[2].id).toBe('exec-summary');
  });

  it('accepts name as block identifier (spec §20.5 format)', () => {
    const ws = makeTmpWorkspace();
    writeProfileYaml(ws, 'application', `
profile_id: application
blocks:
  - name: tag-taxonomy
    enabled: true
    order: 1
`);
    const result = loadProfileOverride(ws, 'application');
    expect(result!.blocks[0].id).toBe('tag-taxonomy');
    expect(result!.blocks[0].enabled).toBe(true);
  });

  it('parses block-level options from editor "options" field', () => {
    const ws = makeTmpWorkspace();
    writeProfileYaml(ws, 'application', `
profile: application
blocks: []
options:
  signal-list:
    filter: critical,high
  risk-register:
    filter: open
`);
    const result = loadProfileOverride(ws, 'application');
    expect(result!.blockOptions['signal-list']).toEqual({ filter: 'critical,high' });
    expect(result!.blockOptions['risk-register']).toEqual({ filter: 'open' });
  });

  it('parses component-level options from spec "component_options" field', () => {
    const ws = makeTmpWorkspace();
    writeProfileYaml(ws, 'application', `
profile: application
blocks: []
component_options:
  swao-table:
    density: compact
  swao-chart-donut:
    animation: false
`);
    const result = loadProfileOverride(ws, 'application');
    expect(result!.componentOptions['swao-table']).toEqual({ density: 'compact' });
    expect(result!.componentOptions['swao-chart-donut']).toEqual({ animation: 'false' });
  });

  it('parses nav field -- legacy string[] coerced to NavTopConfig/NavSideEntry[]', () => {
    const ws = makeTmpWorkspace();
    writeProfileYaml(ws, 'application', `
profile: application
blocks: []
nav:
  top:
    - signals
    - compliance
  side:
    - risk-register
`);
    const result = loadProfileOverride(ws, 'application');
    // Legacy string[] top is coerced to NavTopConfig with anchors array (#1028)
    expect(result!.nav?.top).toEqual({ anchors: [{ id: 'signals' }, { id: 'compliance' }] });
    // Legacy string[] side is coerced to NavSideEntry[] with order index (#1029)
    expect(result!.nav?.side).toEqual([{ id: 'risk-register', order: 0 }]);
  });

  it('coerces boolean option values to strings', () => {
    const ws = makeTmpWorkspace();
    writeProfileYaml(ws, 'application', `
profile: application
blocks: []
component_options:
  swao-table:
    sortable: true
    density: comfortable
`);
    const result = loadProfileOverride(ws, 'application');
    expect(result!.componentOptions['swao-table']['sortable']).toBe('true');
    expect(result!.componentOptions['swao-table']['density']).toBe('comfortable');
  });

  it('coerces numeric option values to strings', () => {
    const ws = makeTmpWorkspace();
    writeProfileYaml(ws, 'application', `
profile: application
blocks: []
component_options:
  swao-tiles-compliance:
    columns: 3
`);
    const result = loadProfileOverride(ws, 'application');
    expect(result!.componentOptions['swao-tiles-compliance']['columns']).toBe('3');
  });

  it('ignores block entries with invalid id characters', () => {
    const ws = makeTmpWorkspace();
    writeProfileYaml(ws, 'application', `
profile: application
blocks:
  - id: valid-block
    enabled: true
    order: 1
  - id: "Invalid Block!"
    enabled: true
    order: 2
`);
    const result = loadProfileOverride(ws, 'application');
    expect(result!.blocks).toHaveLength(1);
    expect(result!.blocks[0].id).toBe('valid-block');
  });

  it('returns empty blocks/options for an empty profile YAML', () => {
    const ws = makeTmpWorkspace();
    writeProfileYaml(ws, 'application', `profile: application\n`);
    const result = loadProfileOverride(ws, 'application');
    expect(result!.blocks).toHaveLength(0);
    expect(result!.blockOptions).toEqual({});
    expect(result!.componentOptions).toEqual({});
  });

});

describe('BLOCK_PROFILES (#1125)', () => {
  it('exports all three profile keys', () => {
    expect(Object.keys(BLOCK_PROFILES)).toEqual(
      expect.arrayContaining(['application', 'lz-catalog', 'hub']),
    );
  });

  it('application profile contains core app blocks', () => {
    const blocks = BLOCK_PROFILES['application'];
    expect(blocks).toContain('exec-summary');
    expect(blocks).toContain('signal-list');
    expect(blocks).toContain('seven-r-card');
    expect(blocks).toContain('compliance-regime');
    expect(blocks).not.toContain('lzr-catalog-verdict');
  });

  it('lz-catalog profile contains LZ-specific blocks', () => {
    const blocks = BLOCK_PROFILES['lz-catalog'];
    expect(blocks).toContain('lz-catalog-services');
    expect(blocks).toContain('lzr-catalog-verdict');
    expect(blocks).toContain('lzr-catalog-findings');
    expect(blocks).not.toContain('seven-r-card');
    expect(blocks).not.toContain('exec-summary');
  });

  it('hub profile contains hub blocks only', () => {
    const blocks = BLOCK_PROFILES['hub'];
    expect(blocks).toContain('hub.header');
    expect(blocks).toContain('hub.app_list');
    expect(blocks).not.toContain('cover');
  });
});
