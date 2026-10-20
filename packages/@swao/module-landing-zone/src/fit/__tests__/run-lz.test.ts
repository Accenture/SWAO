// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3155: the LZ fit reads the same layered catalogue the run manifest records.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleLzCatalogWsp } from '../run-lz.js';
import { resolveProviderCatalogue } from '../../catalogue/loader.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** Workspace laid out like `swao lz catalogue copy/new`: `<ws>/wsp/inputs/catalogs/lz-catalogues/<provider>/index.json`. */
function workspaceWithCopy(provider: string, catalogue: unknown): { ws: string; appDir: string; catDir: string } {
  const ws = mkdtempSync(join(tmpdir(), 'swao-run-lz-'));
  dirs.push(ws);
  const catDir = join(ws, 'wsp', 'inputs', 'catalogs', 'lz-catalogues');
  mkdirSync(join(catDir, provider), { recursive: true });
  writeFileSync(join(catDir, provider, 'index.json'), typeof catalogue === 'string' ? catalogue : JSON.stringify(catalogue, null, 2));
  const appDir = join(ws, 'apps', 'app1');
  mkdirSync(appDir, { recursive: true });
  return { ws, appDir, catDir };
}

const customAws = {
  meta: {
    schema_version: '0.1',
    name: 'aws (workspace-local catalogue)',
    provider: 'aws',
    last_updated: '2026-10-10',
    source: { mode: 'curated', source_note: 'Workspace-local catalogue for the run-lz test.' },
    confidence: 'medium',
  },
  regions: [{ id: 'workspace-only-region', display: 'Workspace-only region', services: [] }],
};

describe('assembleLzCatalogWsp catalogue resolution (#3155)', () => {
  it('uses a workspace copy written by swao lz catalogue copy/new (no top-level index.json)', () => {
    const { appDir, catDir } = workspaceWithCopy('aws', customAws);
    // Same arguments as assess.ts: app dir as workspacePath, workspace catalogue dir as cataloguesDir.
    const res = assembleLzCatalogWsp({ workspacePath: appDir, provider: 'aws', regionId: 'workspace-only-region', requiredServices: [], cataloguesDir: catDir, assessedAt: '2026-10-10' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.catalogueOrigin).toBe('workspace');
    expect(res.catalogueFile).toBe(join(catDir, 'aws', 'index.json'));
    // The run manifest resolves the same file.
    expect(resolveProviderCatalogue('aws', appDir, catDir).filePath).toBe(res.catalogueFile);
  });

  it('the workspace copy shadows the bundled catalogue: a bundled-only region is not found', () => {
    const { appDir, catDir } = workspaceWithCopy('aws', customAws);
    const res = assembleLzCatalogWsp({ workspacePath: appDir, provider: 'aws', regionId: 'eu-central-1', requiredServices: [], cataloguesDir: catDir });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/Region "eu-central-1" not found .*workspace-only-region/);
  });

  it('falls back to the bundled catalogue for providers without a workspace copy', () => {
    const { appDir, catDir } = workspaceWithCopy('aws', customAws);
    const res = assembleLzCatalogWsp({ workspacePath: appDir, provider: 'stackit', regionId: 'eu01', requiredServices: [], cataloguesDir: catDir });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.catalogueOrigin).toBe('bundled');
  });

  it('reports an invalid workspace copy instead of silently using the bundled catalogue', () => {
    const { appDir, catDir } = workspaceWithCopy('aws', '{ "meta": {}, "regions": "nope" }');
    const res = assembleLzCatalogWsp({ workspacePath: appDir, provider: 'aws', regionId: 'eu-central-1', requiredServices: [], cataloguesDir: catDir });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/failed validation/);
  });

  it('reports an unknown provider', () => {
    const { appDir, catDir } = workspaceWithCopy('aws', customAws);
    const res = assembleLzCatalogWsp({ workspacePath: appDir, provider: 'no-such-csp', regionId: 'x', requiredServices: [], cataloguesDir: catDir });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/No catalogue for provider "no-such-csp"/);
  });
});
