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

import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { load } from 'js-yaml';
import {
  loadAvailableRegimes,
  applicabilityHits,
  readRegimesActive,
  writeRegimesActive,
  regimePickerRow,
} from '../compliance/regime-picker.js';
import { scaffoldCatalogs } from '../commands/init.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-picker-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('loadAvailableRegimes (#0164)', () => {
  it('returns empty array when catalogs/ does not exist', () => {
    expect(loadAvailableRegimes(tmp)).toEqual([]);
  });

  // Deleted: 'returns the seven flagship regimes plus bundled community frameworks after swao init'
  // Reason: "seven flagship regimes" and "standard regimes" are pre-retirement concepts.
  // Community-only shape is exercised by active tests in this file and compliance-registry.test.ts.

  // Deleted: 'returns standard regimes before community regimes'
  // Reason: no scope distinction exists post-retirement; ordering by scope=standard first
  // is a meaningless assertion in a community-only world.
});

describe('applicabilityHits and regimePickerRow (#0164)', () => {
  it('returns true when any regime hint matches a context hint', () => {
    const r = {
      scope: 'standard' as const,
      entry: {
        id: 'GDPR',
        name: 'GDPR',
        version: '2018-05',
        file: 'gdpr-controls.yaml',
        controls_count: 5,
        applicability_hints: ['eu_data', 'personal_data'],
      },
    };
    expect(applicabilityHits(r, ['health_data', 'eu_data'])).toBe(true);
  });

  it('returns false when no hints overlap', () => {
    const r = {
      scope: 'standard' as const,
      entry: {
        id: 'PCI_DSS',
        name: 'PCI DSS',
        version: '4.0',
        file: 'pci-dss-controls.yaml',
        controls_count: 5,
        applicability_hints: ['payments'],
      },
    };
    expect(applicabilityHits(r, ['eu_data'])).toBe(false);
  });

  it('row label embeds id, name, control count, and community tag for community regimes', () => {
    const standard = regimePickerRow({
      scope: 'standard',
      entry: {
        id: 'GDPR',
        name: 'General Data Protection Regulation',
        version: '2018-05',
        file: 'gdpr-controls.yaml',
        controls_count: 5,
        applicability_hints: [],
      },
    });
    expect(standard.label).toMatch(/GDPR/);
    expect(standard.label).toMatch(/General Data Protection Regulation/);
    expect(standard.label).toMatch(/5 controls/);
    expect(standard.label).not.toMatch(/community/);

    const community = regimePickerRow({
      scope: 'community',
      entry: {
        id: 'TISAX',
        name: 'TISAX',
        version: '5.1',
        file: 'tisax-controls.yaml',
        controls_count: 1,
        applicability_hints: [],
      },
    });
    expect(community.label).toMatch(/\[community\]/);
  });

  it('hinted=true when context hints match', () => {
    const row = regimePickerRow(
      {
        scope: 'standard',
        entry: {
          id: 'GDPR',
          name: 'GDPR',
          version: '2018-05',
          file: 'gdpr-controls.yaml',
          controls_count: 5,
          applicability_hints: ['eu_data', 'personal_data'],
        },
      },
      ['eu_data'],
    );
    expect(row.hinted).toBe(true);
  });
});

describe('readRegimesActive (#0164)', () => {
  it('returns empty array when .swao.yml is missing', () => {
    expect(readRegimesActive(join(tmp, '.swao.yml'))).toEqual([]);
  });

  it('returns empty array when assessment block is absent', () => {
    writeFileSync(join(tmp, '.swao.yml'), 'wsp_version: "0.9"\n', 'utf-8');
    expect(readRegimesActive(join(tmp, '.swao.yml'))).toEqual([]);
  });

  it('returns the active regime list when present', () => {
    writeFileSync(
      join(tmp, '.swao.yml'),
      `wsp_version: "0.9"
assessment:
  regimes_active:
    - GDPR
    - PCI_DSS
`,
      'utf-8',
    );
    expect(readRegimesActive(join(tmp, '.swao.yml'))).toEqual(['GDPR', 'PCI_DSS']);
  });
});

describe('writeRegimesActive (#0164)', () => {
  it('creates the file and writes assessment.regimes_active when .swao.yml is missing', () => {
    const path = join(tmp, '.swao.yml');
    writeRegimesActive(path, ['GDPR', 'DORA']);
    const parsed = load(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    const assessment = parsed.assessment as { regimes_active: string[] };
    expect(assessment.regimes_active).toEqual(['GDPR', 'DORA']);
  });

  it('preserves existing top-level keys when writing', () => {
    const path = join(tmp, '.swao.yml');
    writeFileSync(
      path,
      `wsp_version: "0.9"
app_id: example
imports_dir: imports/
`,
      'utf-8',
    );
    writeRegimesActive(path, ['GDPR']);
    const parsed = load(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    expect(parsed.wsp_version).toBe('0.9');
    expect(parsed.app_id).toBe('example');
    expect(parsed.imports_dir).toBe('imports/');
  });

  it('wires providers.regime_catalogs[] standard + community paths idempotently', () => {
    const path = join(tmp, '.swao.yml');
    writeRegimesActive(path, ['GDPR']);
    const first = load(readFileSync(path, 'utf-8')) as { providers: { regime_catalogs: Array<{ id: string; path: string }> } };
    expect(first.providers.regime_catalogs).toEqual([
      { id: 'standard', path: 'catalogs/standard' },
      { id: 'community', path: 'catalogs/community' },
    ]);
    writeRegimesActive(path, ['GDPR', 'PCI_DSS']);
    const second = load(readFileSync(path, 'utf-8')) as { providers: { regime_catalogs: Array<{ id: string; path: string }> } };
    expect(second.providers.regime_catalogs).toHaveLength(2);
  });

  it('overwrites the previous regimes_active value on rewrite', () => {
    const path = join(tmp, '.swao.yml');
    writeRegimesActive(path, ['GDPR', 'DORA']);
    writeRegimesActive(path, ['ISO_27001']);
    const parsed = load(readFileSync(path, 'utf-8')) as { assessment: { regimes_active: string[] } };
    expect(parsed.assessment.regimes_active).toEqual(['ISO_27001']);
  });

  it('round-trips: write then read returns the same list', () => {
    const path = join(tmp, '.swao.yml');
    const want = ['GDPR', 'PCI_DSS', 'ISO_27001'];
    writeRegimesActive(path, want);
    expect(readRegimesActive(path)).toEqual(want);
  });
});

describe('Reconfigure flow (#0164)', () => {
  it('reading then re-writing preserves order and is suitable for pre-checking the picker', () => {
    scaffoldCatalogs(tmp);
    const path = join(tmp, '.swao.yml');
    writeFileSync(path, 'wsp_version: "0.9"\napp_id: demo\n', 'utf-8');

    // Initial pick
    writeRegimesActive(path, ['GDPR']);
    expect(readRegimesActive(path)).toEqual(['GDPR']);

    // User reconfigures and adds DORA + PCI_DSS
    writeRegimesActive(path, ['GDPR', 'DORA', 'PCI_DSS']);
    expect(readRegimesActive(path)).toEqual(['GDPR', 'DORA', 'PCI_DSS']);

    // User removes DORA
    writeRegimesActive(path, ['GDPR', 'PCI_DSS']);
    expect(readRegimesActive(path)).toEqual(['GDPR', 'PCI_DSS']);
  });
});
