// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3428: central source scope unit tests (synthetic fixtures only).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  listSourceFiles,
  findShallowestSourceFile,
  getSourceScope,
  beginSourceScopeRun,
  endSourceScopeRun,
  sourceScopeWalkCount,
  sourceTreeHasFiles,
  listInputFiles,
  isTestPath,
  isGeneratedPath,
  SOURCE_SCOPE_SKIP_DIRS,
} from './source-scope.js';

let tmp: string;

function put(rel: string, content = 'x'): void {
  const p = join(tmp, ...rel.split('/'));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

function rels(root: string, opts: Parameters<typeof listSourceFiles>[1] = { purpose: 'code' }): string[] {
  return listSourceFiles(root, opts).map((f) => f.rel).sort();
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-source-scope-'));
  endSourceScopeRun();
});

afterEach(() => {
  endSourceScopeRun();
  rmSync(tmp, { recursive: true, force: true });
});

describe('canonical skip set', () => {
  it('excludes VCS, dependency, build output, IDE, coverage and fixtures directories', () => {
    put('src/app.ts');
    put('.git/config');
    put('.git/objects/hook.js');
    put('.idea/workspace.xml');
    put('node_modules/left/index.js');
    put('service/target/classes/App.class');
    put('service/target/bom.json');
    put('dist/bundle.js');
    put('build/out.js');
    put('coverage/lcov/prettify.js');
    put('fixtures/egress.ts');
    put('vendor/lib.go');
    put('obj/Debug/app.dll');
    expect(rels(tmp)).toEqual(['src/app.ts']);
    const s = getSourceScope(tmp).summary();
    expect(s.excluded_dir_names['.git']).toBe(1);
    expect(s.excluded_dir_names['target']).toBe(1);
    expect(s.excluded_dir_names['node_modules']).toBe(1);
    expect(s.dirs_excluded).toBe(10);
  });

  it('keeps a Node bin/ but skips .NET / Eclipse build-output bin/', () => {
    put('web/bin/www.js');
    put('web/package.json');
    put('net/bin/Debug/app.dll');
    put('net/app.csproj');
    put('eclipse/bin/App.class');
    put('eclipse/.classpath');
    expect(rels(tmp)).toEqual(['net/app.csproj', 'web/bin/www.js', 'web/package.json']);
    expect(getSourceScope(tmp).summary().excluded_dir_names['bin']).toBe(2);
  });

  it('every pre-#3428 skip name is in the canonical set (or is a dot-directory)', () => {
    for (const n of ['node_modules', 'dist', 'build', 'target', 'vendor', 'venv', '__pycache__', 'obj', 'out', 'fixtures']) {
      expect(SOURCE_SCOPE_SKIP_DIRS.has(n)).toBe(true);
    }
  });
});

describe('hidden files, extensions, caps', () => {
  it('lists dot-files only on request, and always for purpose secrets', () => {
    put('.env.example', 'A=1');
    put('src/a.ts');
    expect(rels(tmp)).toEqual(['src/a.ts']);
    expect(rels(tmp, { purpose: 'config', includeHidden: true })).toEqual(['.env.example', 'src/a.ts']);
    expect(rels(tmp, { purpose: 'secrets' })).toEqual(['.env.example', 'src/a.ts']);
  });

  it('filters by extension (lower-cased)', () => {
    put('A.TS');
    put('b.java');
    put('c.md');
    expect(rels(tmp, { purpose: 'code', extensions: ['.ts', '.java'] })).toEqual(['A.TS', 'b.java']);
  });

  it('maxDepth counts directory segments like the old walk(root, 0) guards', () => {
    put('root.ts');
    put('a/one.ts');
    put('a/b/two.ts');
    put('a/b/c/three.ts');
    expect(rels(tmp, { purpose: 'code', maxDepth: 0 })).toEqual(['root.ts']);
    expect(rels(tmp, { purpose: 'code', maxDepth: 2 })).toEqual(['a/b/two.ts', 'a/one.ts', 'root.ts']);
    const depths = Object.fromEntries(listSourceFiles(tmp, { purpose: 'code' }).map((f) => [f.rel, f.depth]));
    expect(depths).toEqual({ 'root.ts': 0, 'a/one.ts': 1, 'a/b/two.ts': 2, 'a/b/c/three.ts': 3 });
  });

  it('maxFiles caps the returned list in walk order', () => {
    for (let i = 0; i < 10; i++) put(`f${i}.ts`);
    const all = listSourceFiles(tmp, { purpose: 'code' }).map((f) => f.rel);
    expect(listSourceFiles(tmp, { purpose: 'code', maxFiles: 3 }).map((f) => f.rel)).toEqual(all.slice(0, 3));
  });

  it('walks depth-first pre-order in native readdir order (a directory is recursed when met)', () => {
    put('a/inner.ts');
    put('b.ts');
    put('c/inner.ts');
    // Expected order derived from the platform's own readdir order (NTFS sorts,
    // ext4 does not), so the test pins the traversal, not a sort.
    const expected = readdirSync(tmp).map((n) => (n.endsWith('.ts') ? n : `${n}/inner.ts`));
    expect(listSourceFiles(tmp, { purpose: 'code' }).map((f) => f.rel)).toEqual(expected);
  });

  it('findShallowest returns the shallowest match (breadth-first semantics)', () => {
    put('a/b/docker-compose.yml');
    put('z/docker-compose.yml');
    const hit = findShallowestSourceFile(tmp, { purpose: 'config' }, (f) => f.name === 'docker-compose.yml');
    expect(hit?.rel).toBe('z/docker-compose.yml');
    expect(hit?.abs).toBe(join(tmp, 'z', 'docker-compose.yml'));
  });
});

describe('test-code classification', () => {
  it('classifies Maven layout', () => {
    expect(isTestPath('service/src/test/java/com/x/AppITest.java')).toBe(true);
    expect(isTestPath('service/src/test/resources/massendaten.sql')).toBe(true);
    expect(isTestPath('service/src/main/java/com/x/App.java')).toBe(false);
    expect(isTestPath('service/src/main/java/com/x/UserServiceTest.java')).toBe(true);
    expect(isTestPath('service/src/main/java/com/x/OrderIT.java')).toBe(true);
    expect(isTestPath('service/src/main/java/com/x/Testament.java')).toBe(false);
  });

  it('classifies npm layout', () => {
    expect(isTestPath('src/__tests__/server.ts')).toBe(true);
    expect(isTestPath('src/server.test.ts')).toBe(true);
    expect(isTestPath('src/server.spec.js')).toBe(true);
    expect(isTestPath('ui/src/composables/test/useStatus.ts')).toBe(true);
    expect(isTestPath('systemtest/framework/totp.helper.ts')).toBe(true);
    expect(isTestPath('src/__mocks__/fs.ts')).toBe(true);
    expect(isTestPath('src/latest.ts')).toBe(false);
    expect(isTestPath('src/contest/entry.ts')).toBe(false);
  });

  it('classifies Python and Go conventions', () => {
    expect(isTestPath('pkg/test_user.py')).toBe(true);
    expect(isTestPath('pkg/user_test.go')).toBe(true);
    expect(isTestPath('pkg/user.go')).toBe(false);
  });

  it('tags test files by default and drops them only on exclude (never for secrets)', () => {
    put('src/app.ts');
    put('src/app.test.ts');
    put('service/src/test/java/AppTest.java');
    const tagged = listSourceFiles(tmp, { purpose: 'code' });
    expect(tagged.filter((f) => f.isTest).map((f) => f.rel).sort()).toEqual(['service/src/test/java/AppTest.java', 'src/app.test.ts']);
    expect(rels(tmp, { purpose: 'code', testCode: 'exclude' })).toEqual(['src/app.ts']);
    expect(rels(tmp, { purpose: 'secrets', testCode: 'exclude' })).toHaveLength(3);
    const s = getSourceScope(tmp).summary();
    expect(s.files_scanned).toBe(3);
    expect(s.files_test).toBe(2);
  });

  it('tags generated artefacts without dropping them', () => {
    expect(isGeneratedPath('web/app.min.js')).toBe(true);
    expect(isGeneratedPath('api/generated/client.ts')).toBe(true);
    expect(isGeneratedPath('api/client.ts')).toBe(false);
    put('web/app.min.js');
    expect(listSourceFiles(tmp, { purpose: 'code' })[0]?.isGenerated).toBe(true);
  });
});

describe('vcs.subdir root (#3404 proof moved to #3428)', () => {
  it('a scope rooted at <source>/<subdir> yields no file outside the subdir', () => {
    put('apps/billing/src/main.ts');
    put('apps/billing/pom.xml');
    put('apps/crm/src/crm.ts');
    put('shared/lib.ts');
    put('package.json');
    const subRoot = join(tmp, 'apps', 'billing');
    const files = listSourceFiles(subRoot, { purpose: 'code' });
    expect(files.map((f) => f.rel).sort()).toEqual(['pom.xml', 'src/main.ts']);
    for (const f of files) {
      expect(resolve(f.abs).startsWith(resolve(subRoot))).toBe(true);
    }
  });

  it('does not follow a symlink or junction that points outside the root', () => {
    put('app/src/main.ts');
    put('outside/secret.ts');
    let linked = true;
    try {
      symlinkSync(join(tmp, 'outside'), join(tmp, 'app', 'escape'), 'junction');
    } catch {
      linked = false; // platform without symlink permission: nothing to prove
    }
    const root = join(tmp, 'app');
    expect(rels(root)).toEqual(['src/main.ts']);
    if (linked) expect(getSourceScope(root).summary().symlinks_skipped).toBe(1);
  });
});

describe('per-run memoisation', () => {
  it('walks each root once inside a run, afresh outside one', () => {
    put('src/a.ts');
    beginSourceScopeRun();
    const before = sourceScopeWalkCount();
    listSourceFiles(tmp, { purpose: 'code' });
    listSourceFiles(tmp, { purpose: 'manifest', maxDepth: 2 });
    findShallowestSourceFile(tmp, { purpose: 'config' }, () => true);
    getSourceScope(tmp).summary();
    expect(sourceScopeWalkCount() - before).toBe(1);
    put('src/b.ts');
    expect(rels(tmp)).toEqual(['src/a.ts']); // cached for the run
    endSourceScopeRun();
    expect(rels(tmp)).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('sourceTreeHasFiles', () => {
  it('ignores README-only trees and skipped directories', () => {
    put('README.md');
    put('node_modules/x/index.js');
    put('.git/config');
    expect(sourceTreeHasFiles(tmp, new Set(['readme.md']))).toBe(false);
    put('src/app.ts');
    expect(sourceTreeHasFiles(tmp, new Set(['readme.md']))).toBe(true);
  });

  it('respectSkipSet: false sees files in skipped folders (clone guard keeps operator work)', () => {
    put('README.md');
    put('target/classes/App.class');
    expect(sourceTreeHasFiles(tmp, new Set(['readme.md']))).toBe(false);
    expect(sourceTreeHasFiles(tmp, new Set(['readme.md']), { respectSkipSet: false })).toBe(true);
  });
});

describe('listInputFiles', () => {
  it('sorts per directory, skips top-level and any-depth names, keeps dot-files', () => {
    put('source/app.ts');
    put('catalogs/c.yaml');
    put('b.md');
    put('a/.notes.md');
    put('a/research/x.md');
    const files = listInputFiles(tmp, { skipTopLevelDirs: ['source', 'catalogs'], skipDirNames: ['research'] });
    expect(files.map((f) => f.rel)).toEqual(['a/.notes.md', 'b.md']);
  });
});
