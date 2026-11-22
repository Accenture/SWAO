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

// #4192 SET-03 (Design 125 sections 5.2 and 5.7): the App step adds an app as
// the CLI init with an app name does, and the Application defaults reader
// (section 5.7 preselection) sees it.

import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { SwaoYmlSchema } from '@swao/core';
import {
  appIdProblem,
  appSourceProblem,
  checkApplicationApps,
  classifyAppSource,
  createApplicationApp,
  INIT_APP_DEFAULT_REGIMES,
  readAppSources,
  splitTreeUrl,
  urlHasCredentials,
  vcsTypeFromUrl,
} from './application-app.js';
import { readApplicationDefaults } from './defaults.js';

let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

function ws(): string {
  dir = mkdtempSync(join(tmpdir(), 'swao-4192-app-'));
  writeFileSync(join(dir, '.swao.yml'), 'wsp_version: "0.9"\nengagement:\n  name: "Demo"\n  partnership_lead: "lead@example.com"\n', 'utf-8');
  return dir;
}

// Test-local view of the app .swao.yml fields the assertions read.
interface AppYml { app_id: string; assessor: string | null; assessment: { regimes_active: string[] }; source: { path?: string; vcs?: Record<string, string> } }
function appYml(root: string, id: string): AppYml {
  return load(readFileSync(join(root, 'apps', id, '.swao.yml'), 'utf-8')) as AppYml;
}

describe('app id and source validation (#4192)', () => {
  it('accepts folder-safe ids and refuses others and existing apps', () => {
    const root = ws();
    expect(appIdProblem(root, 'my-app_2')).toBeNull();
    expect(appIdProblem(root, '')).toMatch(/Enter an app id/);
    expect(appIdProblem(root, 'My App')).toMatch(/lower-case/);
    expect(appIdProblem(root, '../x')).toMatch(/lower-case/);
    createApplicationApp(root, { appId: 'demo', source: { kind: 'later' } });
    expect(appIdProblem(root, 'demo')).toMatch(/already exists/);
  });

  it('classifies repository addresses and paths like the Application Assessment new-app flow', () => {
    expect(classifyAppSource('https://github.com/org/repo')).toBe('git-url');
    expect(classifyAppSource('git@github.com:org/repo.git')).toBe('git-url');
    expect(classifyAppSource('C:\\src\\app')).toBe('local-path');
    expect(classifyAppSource('/srv/app')).toBe('local-path');
    expect(classifyAppSource('relative/path')).toBe('ambiguous');
  });

  it('splits a tree URL and detects the VCS type by exact host', () => {
    expect(splitTreeUrl('https://github.com/org/repo/tree/dev/apps/x/')).toEqual({ cloneUrl: 'https://github.com/org/repo.git', ref: 'dev', subdir: 'apps/x' });
    expect(splitTreeUrl('https://github.com/org/repo')).toBeNull();
    expect(vcsTypeFromUrl('https://gitlab.com/a/b')).toBe('gitlab');
    expect(vcsTypeFromUrl('https://dev.azure.com/o/p/_git/r')).toBe('azure-devops');
    expect(vcsTypeFromUrl('https://gitlab.com.attacker.example/a/b')).toBe('github');
  });

  it('refuses a repository address with an embedded token and a missing folder', () => {
    expect(urlHasCredentials('https://user:ghp_secret@github.com/org/repo')).toBe(true);
    expect(appSourceProblem('repository', 'https://user:ghp_secret@github.com/org/repo')).toMatch(/vault/);
    expect(appSourceProblem('repository', 'not a url')).toMatch(/repository address/);
    expect(appSourceProblem('repository', 'https://github.com/org/repo')).toBeNull();
    const root = ws();
    expect(appSourceProblem('folder', join(root, 'nope'))).toMatch(/does not exist/);
    expect(appSourceProblem('folder', root)).toBeNull();
    expect(appSourceProblem('later', '')).toBeNull();
  });
});

describe('createApplicationApp (#4192, as the CLI init with an app name)', () => {
  it('writes a schema-valid app with the init demo regimes, the assessor and the clone source', () => {
    const root = ws();
    const res = createApplicationApp(root, { appId: 'shop', source: { kind: 'repository', url: 'https://gitlab.com/org/shop' } });
    expect(res.sourceMode).toBe('git-clone');
    const yml = appYml(root, 'shop');
    expect(SwaoYmlSchema.safeParse(yml).success).toBe(true);
    expect(yml['app_id']).toBe('shop');
    expect(yml['assessor']).toBe('lead@example.com');
    expect(yml['assessment']['regimes_active']).toEqual([...INIT_APP_DEFAULT_REGIMES]);
    expect(yml['source']['vcs']).toMatchObject({ type: 'gitlab', url: 'https://gitlab.com/org/shop', ref: 'main' });
    // Same scaffolds as the CLI init: inputs, ingestion drop folder, source landing area, LZ stubs folder.
    expect(existsSync(join(root, 'apps', 'shop', 'wsp', 'inputs'))).toBe(true);
    expect(existsSync(join(root, 'apps', 'shop', 'ingestion'))).toBe(true);
    expect(existsSync(join(root, 'apps', 'shop', 'wsp', 'inputs', 'source', 'README.md'))).toBe(true);
  });

  it('splits a tree URL into clone URL, ref and subfolder', () => {
    const root = ws();
    createApplicationApp(root, { appId: 'mono', source: { kind: 'repository', url: 'https://github.com/org/repo/tree/release/svc/api' } });
    expect(appYml(root, 'mono')['source']['vcs']).toMatchObject({ url: 'https://github.com/org/repo.git', ref: 'release', subdir: 'svc/api' });
  });

  it('points source.path at a local folder without a clone block or source landing area', () => {
    const root = ws();
    const src = join(root, 'external-src');
    mkdirSync(src);
    const res = createApplicationApp(root, { appId: 'local', source: { kind: 'folder', path: src } });
    expect(res.sourceMode).toBe('local-path');
    const yml = appYml(root, 'local');
    expect(yml['source']['path']).toBe(src);
    expect(yml['source']['vcs']).toBeUndefined();
    expect(existsSync(join(root, 'apps', 'local', 'wsp', 'inputs', 'source'))).toBe(false);
  });

  it('never overwrites an existing app and refuses a token in the address', () => {
    const root = ws();
    createApplicationApp(root, { appId: 'keep', source: { kind: 'later' } });
    const before = readFileSync(join(root, 'apps', 'keep', '.swao.yml'), 'utf-8');
    expect(() => createApplicationApp(root, { appId: 'keep', source: { kind: 'repository', url: 'https://github.com/o/r' } })).toThrow(/already exists/);
    expect(readFileSync(join(root, 'apps', 'keep', '.swao.yml'), 'utf-8')).toBe(before);
    expect(() => createApplicationApp(root, { appId: 'leak', source: { kind: 'repository', url: 'https://x:tok@github.com/o/r' } })).toThrow(/vault/);
    expect(existsSync(join(root, 'apps', 'leak'))).toBe(false);
  });

  it('section 5.7: the Application defaults list the added apps; the check reports them', () => {
    const root = ws();
    expect(checkApplicationApps(root)).toEqual([expect.objectContaining({ state: 'missing' })]);
    createApplicationApp(root, { appId: 'b-app', source: { kind: 'later' } });
    createApplicationApp(root, { appId: 'a-app', source: { kind: 'repository', url: 'https://github.com/o/a' } });
    expect(readApplicationDefaults(root).apps).toEqual(['a-app', 'b-app']);
    expect(checkApplicationApps(root)).toEqual([{ label: 'Apps', state: 'ok', detail: '2 apps: a-app, b-app' }]);
    expect(readAppSources(root)).toEqual([
      { appId: 'a-app', vcsUrl: 'https://github.com/o/a', sourcePath: 'wsp/inputs/source/' },
      { appId: 'b-app', sourcePath: 'wsp/inputs/source/' },
    ]);
  });
});
