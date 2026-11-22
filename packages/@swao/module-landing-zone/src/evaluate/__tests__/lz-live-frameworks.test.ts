// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module -- live framework selection and provenance tests (#3579)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { createHash } from 'crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LzLiveManifestFrameworkSchema,
  resolveLzLiveFrameworkIds,
  selectLzLiveFrameworks,
} from '../lz-live-frameworks.js';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

describe('resolveLzLiveFrameworkIds (same resolution as assess.ts lzFwIds)', () => {
  it('prefers the CLI list, trimmed and without empties', () => {
    expect(resolveLzLiveFrameworkIds(' BSI_C5, ,GDPR ', { frameworks: ['DORA'] })).toEqual(['BSI_C5', 'GDPR']);
  });
  it('falls back to assessment.frameworks, then regimes_active', () => {
    expect(resolveLzLiveFrameworkIds(undefined, { frameworks: ['DORA'], regimes_active: ['GDPR'] })).toEqual(['DORA']);
    expect(resolveLzLiveFrameworkIds(undefined, { regimes_active: ['GDPR'] })).toEqual(['GDPR']);
    expect(resolveLzLiveFrameworkIds(undefined, undefined)).toEqual([]);
  });
  it('an explicit empty frameworks list does not fall back to regimes_active (??)', () => {
    expect(resolveLzLiveFrameworkIds(undefined, { frameworks: [], regimes_active: ['GDPR'] })).toEqual([]);
  });
});

describe('selectLzLiveFrameworks (workspace community catalogue only)', () => {
  let root: string;
  const META = 'framework:\n  id: BSI_C5\n  name: "BSI C5 test"\n  version: "2020"\n  sovereignty_requirements:\n    forbid_exposure: [us_cloud_act]\n';
  const CONTROLS = 'regime_meta:\n  id: BSI_C5\n  version: "2020"\ncontrols: []\n';
  const MAPPING = 'schema_version: "0.1"\nframework: BSI_C5\nmappings:\n  - capability: object_storage\n    controls: [CRY-02]\n    relevance: configure\n    confidence: curated\n';

  const writeFw = (folder: string, files: Record<string, string>): void => {
    const dir = join(root, 'community', folder);
    mkdirSync(dir, { recursive: true });
    for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, f), c);
  };

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'swao-lz-live-fw-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('records id, version and the sha256 of the three files in the manifest', () => {
    writeFw('bsi-c5', { 'framework-meta.yaml': META, 'controls.yaml': CONTROLS, 'service-controls.yaml': MAPPING });
    const sel = selectLzLiveFrameworks(['BSI_C5'], root);
    expect(sel.not_installed).toEqual([]);
    const m = sel.manifest[0]!;
    expect(() => LzLiveManifestFrameworkSchema.parse(m)).not.toThrow();
    expect(m.id).toBe('BSI_C5');
    expect(m.version).toBe('2020');
    expect(m.files).toEqual({ 'framework-meta.yaml': sha(META), 'controls.yaml': sha(CONTROLS), 'service-controls.yaml': sha(MAPPING) });
    expect(m.sha256).toBe(sha(`framework-meta.yaml:${sha(META)}\ncontrols.yaml:${sha(CONTROLS)}\nservice-controls.yaml:${sha(MAPPING)}\n`));
    const f = sel.frameworks[0]!;
    expect(f.sha256).toBe(m.sha256);
    expect(f.mapping?.mappings[0]?.capability).toBe('object_storage');
    expect(f.sovereignty_requirements?.forbid_exposure).toEqual(['us_cloud_act']);
  });

  it('a change to service-controls.yaml changes the combined hash', () => {
    writeFw('bsi-c5', { 'framework-meta.yaml': META, 'controls.yaml': CONTROLS, 'service-controls.yaml': MAPPING });
    const a = selectLzLiveFrameworks(['BSI_C5'], root).manifest[0]!.sha256;
    writeFileSync(join(root, 'community', 'bsi-c5', 'service-controls.yaml'), MAPPING.replace('CRY-02', 'CRY-03'));
    expect(selectLzLiveFrameworks(['BSI_C5'], root).manifest[0]!.sha256).not.toBe(a);
  });

  it('a framework without service-controls.yaml has a null hash and no mapping', () => {
    writeFw('bsi-c5', { 'framework-meta.yaml': META, 'controls.yaml': CONTROLS });
    const sel = selectLzLiveFrameworks(['BSI_C5'], root);
    expect(sel.manifest[0]!.files['service-controls.yaml']).toBeNull();
    expect(sel.frameworks[0]!.mapping).toBeNull();
  });

  it('falls back to regime_meta.version of controls.yaml when the meta has no version', () => {
    writeFw('bsi-c5', { 'framework-meta.yaml': 'framework:\n  id: BSI_C5\n', 'controls.yaml': CONTROLS.replace('"2020"', '"2021"') });
    expect(selectLzLiveFrameworks(['BSI_C5'], root).manifest[0]!.version).toBe('2021');
  });

  it('reports ids that are not installed and never reads bundled frameworks', () => {
    writeFw('bsi-c5', { 'framework-meta.yaml': META, 'controls.yaml': CONTROLS });
    const sel = selectLzLiveFrameworks(['BSI_C5', 'GDPR'], root);
    expect(sel.frameworks.map((f) => f.id)).toEqual(['BSI_C5']);
    expect(sel.not_installed).toEqual(['GDPR']);
  });

  it('a missing community folder installs nothing', () => {
    expect(selectLzLiveFrameworks(['BSI_C5'], join(root, 'nowhere')).not_installed).toEqual(['BSI_C5']);
  });

  it('matches by folder name or case-insensitive id and lists each framework once', () => {
    writeFw('bsi-c5', { 'framework-meta.yaml': META, 'controls.yaml': CONTROLS });
    expect(selectLzLiveFrameworks(['bsi-c5', 'bsi_c5'], root).frameworks.map((f) => f.id)).toEqual(['BSI_C5']);
  });

  it('an invalid service mapping is reported and evaluated as no mapping', () => {
    writeFw('bsi-c5', { 'framework-meta.yaml': META, 'controls.yaml': CONTROLS, 'service-controls.yaml': MAPPING.replace('framework: BSI_C5', 'framework: GDPR') });
    const sel = selectLzLiveFrameworks(['BSI_C5'], root);
    expect(sel.invalid_mappings.map((i) => i.id)).toEqual(['BSI_C5']);
    expect(sel.frameworks[0]!.mapping).toBeNull();
  });
});

// #3871 (Design 123 sections 6.1, 7.4, 8.2): a selected Client LZ Policy Baseline.
describe('selectLzLiveFrameworks with a policy baseline (#3871)', () => {
  const SHIPPED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'community-frameworks', 'frameworks', 'client-lz-policy-baseline');
  let root: string;
  let dir: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'swao-lz-live-cpb-'));
    dir = join(root, 'community', 'client-lz-policy-baseline');
    cpSync(SHIPPED, dir, { recursive: true });
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('hashes policy-baseline.yaml as a fourth file and returns the baseline', () => {
    const sel = selectLzLiveFrameworks(['CLIENT_LZ_POLICY_BASELINE'], root);
    const m = sel.manifest[0]!;
    const pb = readFileSync(join(dir, 'policy-baseline.yaml'));
    expect(m.files['policy-baseline.yaml']).toBe(createHash('sha256').update(pb).digest('hex'));
    expect(() => LzLiveManifestFrameworkSchema.parse(m)).not.toThrow();
    expect(m.sha256).toBe(sha(Object.entries(m.files).map(([f, h]) => `${f}:${h ?? 'absent'}\n`).join('')));
    expect(sel.baselines.map((b) => b.id)).toEqual(['CLIENT_LZ_POLICY_BASELINE']);
    expect(sel.baselines[0]!.sha256).toBe(m.files['policy-baseline.yaml']);
    expect(sel.invalid_baselines).toEqual([]);
  });

  it('a changed setting changes the combined hash', () => {
    const a = selectLzLiveFrameworks(['CLIENT_LZ_POLICY_BASELINE'], root).manifest[0]!.sha256;
    const file = join(dir, 'policy-baseline.yaml');
    writeFileSync(file, readFileSync(file, 'utf-8').replace('max_age_days: 90', 'max_age_days: 60'));
    expect(selectLzLiveFrameworks(['CLIENT_LZ_POLICY_BASELINE'], root).manifest[0]!.sha256).not.toBe(a);
  });

  it('the enabled residency policies are the sovereignty declaration (single source)', () => {
    const f = selectLzLiveFrameworks(['CLIENT_LZ_POLICY_BASELINE'], root).frameworks[0]!;
    expect(f.sovereignty_requirements).toEqual({
      require_residency_country: ['DE'],
      require_operator_jurisdiction: ['EU-entity'],
      forbid_exposure: ['us_cloud_act', 'fisa_702'],
      require_certifications: ['BSI_C5'],
    });
    const file = join(dir, 'policy-baseline.yaml');
    writeFileSync(file, readFileSync(file, 'utf-8').replace(/(id: CPB-RES-01[\s\S]*?state: )enabled/, '$1disabled'));
    expect(selectLzLiveFrameworks(['CLIENT_LZ_POLICY_BASELINE'], root).frameworks[0]!.sovereignty_requirements?.require_residency_country).toBeUndefined();
  });

  it('reports an invalid baseline', () => {
    const file = join(dir, 'policy-baseline.yaml');
    writeFileSync(file, readFileSync(file, 'utf-8').replace('min_days: 180', 'min_days: "180"'));
    const sel = selectLzLiveFrameworks(['CLIENT_LZ_POLICY_BASELINE'], root);
    expect(sel.baselines).toEqual([]);
    expect(sel.invalid_baselines.map((b) => b.id)).toEqual(['CLIENT_LZ_POLICY_BASELINE']);
  });
});
