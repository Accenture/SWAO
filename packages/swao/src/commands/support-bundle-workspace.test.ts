import { describe, it, expect } from 'vitest';
import { resolveBundleWorkspace } from './support-bundle.js';

describe('resolveBundleWorkspace (#3374)', () => {
  const deps = (over: Partial<Parameters<typeof resolveBundleWorkspace>[1]>) => ({
    resolveWorkspaceRoot: () => null,
    readDefaultWorkspace: () => null,
    existsSync: () => true,
    cwd: () => '/cwd',
    ...over,
  });

  it('uses the cwd-walk workspace when found', () => {
    const r = resolveBundleWorkspace({}, deps({ resolveWorkspaceRoot: () => '/ws' }));
    expect(r).toMatchObject({ root: '/ws', reduced: false, source: 'cwd-walk' });
  });

  it('falls back to the saved default workspace when cwd is not a workspace', () => {
    const r = resolveBundleWorkspace({}, deps({ readDefaultWorkspace: () => '/saved' }));
    expect(r).toMatchObject({ root: '/saved', reduced: false, source: 'saved' });
  });

  it('ignores a saved workspace path that no longer exists', () => {
    const r = resolveBundleWorkspace({}, deps({ readDefaultWorkspace: () => '/gone', existsSync: () => false }));
    expect(r).toMatchObject({ reduced: true, source: 'reduced', root: '/cwd' });
  });

  it('builds a reduced bundle rooted at cwd when no workspace is found anywhere', () => {
    const r = resolveBundleWorkspace({}, deps({}));
    expect(r).toMatchObject({ root: '/cwd', reduced: true, source: 'reduced' });
  });

  it('honours an explicit --workspace', () => {
    const r = resolveBundleWorkspace({ workspace: '/explicit' }, deps({ resolveWorkspaceRoot: () => '/ws' }));
    expect(r.source).toBe('explicit');
    expect(r.reduced).toBe(false);
  });
});
