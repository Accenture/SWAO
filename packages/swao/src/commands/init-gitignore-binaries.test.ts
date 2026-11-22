// #4119: the workspace .gitignore written by `swao init` must ignore every
// released binary (all tiers, all platforms) and the names of earlier
// releases, for new and for existing workspaces.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureGitignore } from './init.js';
import { LEGACY_BINARY_FILE_NAMES, releaseBinaryFileNames } from '../binary-names.js';

const tmp: string[] = [];
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmp.push(d);
  return d;
}

/** Minimal .gitignore matcher for root-level file names (`*` wildcards only). */
function ignoredBy(gitignore: string, fileName: string): boolean {
  return gitignore
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.endsWith('/'))
    .some((pattern) => {
      const re = new RegExp('^' + pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
      return re.test(fileName);
    });
}

const gitAvailable = spawnSync('git', ['--version'], { encoding: 'utf-8' }).status === 0;

describe('swao init .gitignore covers every SWAO binary (#4119)', () => {
  it('the shared list holds the 15 released names, no version suffix', () => {
    const names = releaseBinaryFileNames();
    expect(names).toHaveLength(15);
    expect(names).toContain('swao-enterprise-win-x64.exe');
    expect(names).toContain('swao-community-linux-arm64');
    expect(names).toContain('swao-consultant-macos-x64');
  });

  it('a new workspace .gitignore matches each released binary and each legacy name', () => {
    const ws = tempDir('swao-gi-bin-new-');
    ensureGitignore(ws);
    const gi = readFileSync(join(ws, '.gitignore'), 'utf-8');
    for (const name of [...releaseBinaryFileNames(), ...LEGACY_BINARY_FILE_NAMES, 'swao.bat']) {
      expect(ignoredBy(gi, name), name).toBe(true);
    }
    // Workspace content stays tracked.
    expect(ignoredBy(gi, '.swao.yml')).toBe(false);
    expect(ignoredBy(gi, 'swao-notes.md')).toBe(false);
  });

  it('an existing workspace with the old name list gains the current patterns on re-run', () => {
    const ws = tempDir('swao-gi-bin-old-');
    writeFileSync(join(ws, '.gitignore'), '.swao.secrets.env\nswao-enterprise-win.exe\nswao.bat\n', 'utf-8');
    ensureGitignore(ws);
    const gi = readFileSync(join(ws, '.gitignore'), 'utf-8');
    expect(ignoredBy(gi, 'swao-enterprise-win-x64.exe')).toBe(true);
    for (const name of releaseBinaryFileNames()) expect(ignoredBy(gi, name), name).toBe(true);
    // Idempotent: a second run adds nothing.
    ensureGitignore(ws);
    expect(readFileSync(join(ws, '.gitignore'), 'utf-8')).toBe(gi);
  });

  it.skipIf(!gitAvailable)('git itself ignores every released binary in a fresh workspace', () => {
    const ws = tempDir('swao-gi-bin-git-');
    expect(spawnSync('git', ['init', '-q'], { cwd: ws }).status).toBe(0);
    ensureGitignore(ws);
    const names = releaseBinaryFileNames();
    const r = spawnSync('git', ['check-ignore', '--no-index', ...names], { cwd: ws, encoding: 'utf-8' });
    const ignored = r.stdout.split(/\r?\n/).filter(Boolean);
    expect(ignored.sort()).toEqual([...names].sort());
  });
});
