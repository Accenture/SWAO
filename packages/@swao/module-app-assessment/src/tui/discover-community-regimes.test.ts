// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { discoverCommunityRegimes, filterRegimesAgainstInstalled } from './AssessScreen.js';

// #0621: the assess framework picker is folder-driven. discoverCommunityRegimes
// is the unit-testable core of the empty-state detection: it returns [] when no
// frameworks are installed (which the TUI must surface, not silently skip).

function communityDir(ws: string): string {
  return join(ws, 'wsp', 'inputs', 'catalogs', 'community');
}

function addFramework(ws: string, slug: string, meta: string, controls?: string): void {
  const dir = join(communityDir(ws), slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'framework-meta.yaml'), meta);
  if (controls !== undefined) writeFileSync(join(dir, 'controls.yaml'), controls);
}

describe('discoverCommunityRegimes -- empty-state detection (#0621)', () => {
  let ws: string;
  beforeEach(() => { ws = mkdtempSync(join(tmpdir(), 'swao-regimes-')); });
  afterEach(() => { rmSync(ws, { recursive: true, force: true }); });

  it('returns [] for an undefined workspace', () => {
    expect(discoverCommunityRegimes(undefined)).toEqual([]);
  });

  it('returns [] when the community dir does not exist', () => {
    expect(discoverCommunityRegimes(ws)).toEqual([]);
  });

  it('returns [] when the community dir exists but holds no framework folders (the user\'s case: only index.yaml + README)', () => {
    const dir = communityDir(ws);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.yaml'), 'schema_version: "1"\nscope: community\nregimes: []\n');
    writeFileSync(join(dir, 'README.md'), '# community catalogues\n');
    expect(discoverCommunityRegimes(ws)).toEqual([]);
  });

  it('discovers a framework with a framework-meta.yaml and counts its controls', () => {
    addFramework(
      ws, 'gdpr',
      'framework:\n  id: GDPR\n  name: General Data Protection Regulation\n  authority: EU\n  description: "EU data protection."\n  contributor:\n    name: Accenture\n',
      'controls:\n  - { id: GDPR_Art_5 }\n  - { id: GDPR_Art_32 }\n',
    );
    const out = discoverCommunityRegimes(ws);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'GDPR', name: 'General Data Protection Regulation', slug: 'gdpr', authority: 'EU', controlsCount: 2, contributorName: 'Accenture' });
  });

  it('skips dot-folders (e.g. .bundled) and folders without framework-meta.yaml', () => {
    addFramework(ws, 'gdpr', 'framework:\n  id: GDPR\n  name: GDPR\n');
    mkdirSync(join(communityDir(ws), '.bundled', 'hidden'), { recursive: true });
    writeFileSync(join(communityDir(ws), '.bundled', 'hidden', 'framework-meta.yaml'), 'framework:\n  id: HIDDEN\n');
    mkdirSync(join(communityDir(ws), 'no-meta'), { recursive: true });
    const out = discoverCommunityRegimes(ws);
    expect(out.map(r => r.id)).toEqual(['GDPR']);
  });

  it('returns frameworks sorted by id', () => {
    addFramework(ws, 'soc-2', 'framework:\n  id: SOC_2\n  name: SOC 2\n');
    addFramework(ws, 'bsi-c5', 'framework:\n  id: BSI_C5\n  name: BSI C5\n');
    expect(discoverCommunityRegimes(ws).map(r => r.id)).toEqual(['BSI_C5', 'SOC_2']);
  });

  it('skips a folder whose meta has no framework.id', () => {
    addFramework(ws, 'broken', 'framework:\n  name: No Id Here\n');
    expect(discoverCommunityRegimes(ws)).toEqual([]);
  });
});

describe('discoverCommunityRegimes -- bundled dir + Demo filter (#1601)', () => {
  let ws: string;
  let bundled: string;
  beforeEach(() => {
    ws      = mkdtempSync(join(tmpdir(), 'swao-regimes-ws-'));
    bundled = mkdtempSync(join(tmpdir(), 'swao-regimes-bd-'));
  });
  afterEach(() => {
    rmSync(ws,      { recursive: true, force: true });
    rmSync(bundled, { recursive: true, force: true });
  });

  function addBundledFramework(slug: string, meta: string, controls?: string): void {
    const dir = join(bundled, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'framework-meta.yaml'), meta);
    if (controls !== undefined) writeFileSync(join(dir, 'controls.yaml'), controls);
  }

  it('bundled frameworks are not surfaced -- workspace directory is the sole source (#1659)', () => {
    addBundledFramework('gdpr', 'framework:\n  id: GDPR\n  name: GDPR Full\n');
    const out = discoverCommunityRegimes(ws, undefined, bundled);
    expect(out.map(r => r.id)).not.toContain('GDPR');
  });

  it('suppresses _DEMO frameworks from bundled source when workspace has no Demo folder', () => {
    addBundledFramework('gdpr-demo', 'framework:\n  id: GDPR_DEMO\n  name: GDPR (Demo)\n');
    const out = discoverCommunityRegimes(ws, undefined, bundled);
    expect(out.map(r => r.id)).not.toContain('GDPR_DEMO');
  });

  it('workspace entry overrides bundled entry of same ID; bundled does not appear twice', () => {
    addBundledFramework('gdpr', 'framework:\n  id: GDPR\n  name: GDPR Bundled\n  authority: EU\n');
    addFramework(ws, 'gdpr', 'framework:\n  id: GDPR\n  name: GDPR Workspace\n  authority: EU\n');
    const out = discoverCommunityRegimes(ws, undefined, bundled);
    expect(out.filter(r => r.id === 'GDPR')).toHaveLength(1);
    expect(out.find(r => r.id === 'GDPR')?.name).toBe('GDPR Workspace');
  });

  it('returns [] when neither workspace nor bundled dir has frameworks', () => {
    expect(discoverCommunityRegimes(ws, undefined, bundled)).toEqual([]);
  });

  it('only workspace-installed frameworks appear -- bundled-only frameworks are excluded (#1659)', () => {
    addFramework(ws, 'nist-sp800', 'framework:\n  id: NIST_SP800\n  name: NIST SP 800\n');
    addBundledFramework('gdpr', 'framework:\n  id: GDPR\n  name: GDPR (bundled-only)\n');
    const out = discoverCommunityRegimes(ws, undefined, bundled);
    expect(out.map(r => r.id)).toContain('NIST_SP800');
    expect(out.map(r => r.id)).not.toContain('GDPR');
  });

  it('_DEMO frameworks physically in the workspace ARE surfaced by the app picker (#1665)', () => {
    // The app framework picker shows all frameworks on disk, including Demo ones.
    // Only the LZ gate picker strips _DEMO -- see discoverGateCapableFrameworks in run-lz.ts.
    addFramework(ws, 'gdpr-demo', 'framework:\n  id: GDPR_DEMO\n  name: GDPR (Demo)\n');
    const out = discoverCommunityRegimes(ws, undefined, bundled);
    expect(out.map(r => r.id)).toContain('GDPR_DEMO');
  });
});

describe('filterRegimesAgainstInstalled -- phantom regime stripping (#0689)', () => {
  it('returns ["all"] for empty stored list', () => {
    expect(filterRegimesAgainstInstalled([], ['GDPR'])).toEqual(['all']);
  });

  it('passes ["all"] sentinel through unchanged', () => {
    expect(filterRegimesAgainstInstalled(['all'], ['GDPR'])).toEqual(['all']);
  });

  it('returns ["all"] when no frameworks are installed', () => {
    expect(filterRegimesAgainstInstalled(['GDPR', 'BSI_C5'], [])).toEqual(['all']);
  });

  it('strips IDs not present in the installed list', () => {
    expect(filterRegimesAgainstInstalled(
      ['AI_10_PILLARS', 'BSI_C5', 'GDPR', 'SOC_2'],
      ['GDPR'],
    )).toEqual(['GDPR']);
  });

  it('is case-insensitive', () => {
    expect(filterRegimesAgainstInstalled(['gdpr'], ['GDPR'])).toEqual(['gdpr']);
    expect(filterRegimesAgainstInstalled(['GDPR'], ['gdpr'])).toEqual(['GDPR']);
  });

  it('returns ["all"] when every stored ID is stale', () => {
    expect(filterRegimesAgainstInstalled(['AI_10_PILLARS', 'BSI_C5'], ['GDPR'])).toEqual(['all']);
  });

  it('keeps all IDs when all are installed', () => {
    expect(filterRegimesAgainstInstalled(['GDPR', 'BSI_C5'], ['GDPR', 'BSI_C5'])).toEqual(['GDPR', 'BSI_C5']);
  });
});
