// #4243: one helper for the app source root scoped to source.vcs.subdir.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { appSourceRoot, readAppSourceRoot } from './app-source-root.js';

const tmp = mkdtempSync(join(tmpdir(), 'swao-src-root-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('appSourceRoot (#4243)', () => {
  const appDir = join(tmp, 'apps', 'demo');

  it('defaults to <app>/source without a subdir', () => {
    const r = appSourceRoot(appDir, null);
    expect(r.base).toBe(resolve(appDir, 'source'));
    expect(r.root).toBe(r.base);
    expect(r.subdir).toBeNull();
    expect(r.baseRelToApp).toBe('source');
  });

  it('scopes a monorepo clone to source.vcs.subdir', () => {
    const r = appSourceRoot(appDir, {
      source: { path: 'wsp/inputs/source', vcs: { url: 'https://example.invalid/org/monorepo.git', subdir: '/apps/health/demo/' } },
    });
    expect(r.base).toBe(resolve(appDir, 'wsp', 'inputs', 'source'));
    expect(r.root).toBe(join(resolve(appDir, 'wsp', 'inputs', 'source'), 'apps', 'health', 'demo'));
    expect(r.subdir).toBe('apps/health/demo');
    expect(r.baseRelToApp).toBe('wsp/inputs/source');
  });

  it('reports a source outside the app dir as baseRelToApp null', () => {
    const outside = join(tmp, 'elsewhere');
    const r = appSourceRoot(appDir, { source: { path: outside } });
    expect(r.base).toBe(resolve(outside));
    expect(r.baseRelToApp).toBeNull();
  });

  it('readAppSourceRoot parses the app .swao.yml', () => {
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, '.swao.yml'), 'source:\n  path: wsp/inputs/source\n  vcs:\n    subdir: services/api\n', 'utf-8');
    const r = readAppSourceRoot(appDir);
    expect(r.subdir).toBe('services/api');
    expect(r.root).toBe(join(resolve(appDir, 'wsp', 'inputs', 'source'), 'services', 'api'));
  });

  it('readAppSourceRoot falls back to defaults for a malformed .swao.yml', () => {
    const bad = join(tmp, 'apps', 'bad');
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, '.swao.yml'), 'source: [unclosed\n', 'utf-8');
    expect(readAppSourceRoot(bad).root).toBe(resolve(bad, 'source'));
  });
});
