// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, gate: framework URLs name existing folders
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4340: every "copy from GitHub" hint in TUI and CLI source that links the
// community frameworks (https://github.com/Accenture/SWAO/tree/main/community-frameworks
// or a framework folder under it) must name a folder that exists in this
// repository's community frameworks (swao/community-frameworks/, the folder the
// public sync copies to the public repository root, kept in sync with the
// @swao/community-frameworks package that this gate reads). Whether the folder is already public at the
// release tag is the go-live dry run's check, out of scope here. The URL is
// found with indexOf (no regular expression on file content).

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { communityFrameworksDir } from '@swao/community-frameworks';
import { PACKAGES_DIR, REPO_ROOT } from './helpers/tui-gate.js';

const PREFIX = 'https://github.com/Accenture/SWAO/tree/main/community-frameworks';
const SHORT = 'github.com/Accenture/SWAO/tree/main/community-frameworks';
// The shipped framework folders (the community-frameworks package, kept in sync with
// swao/community-frameworks by its sync gate); resolves in the private and the public layout.
const FRAMEWORKS_DIR = communityFrameworksDir;

/** The framework folders a text links after the community-frameworks URL ('' for the parent folder). */
export function linkedFrameworkFolders(text: string): string[] {
  const out: string[] = [];
  let at = text.indexOf(SHORT);
  while (at >= 0) {
    let i = at + SHORT.length;
    let folder = '';
    if (text[i] === '/') {
      i++;
      while (i < text.length) {
        const ch = text[i]!;
        const ok = (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === '-' || ch === '_' || ch === '.';
        if (!ok) break;
        folder += ch;
        i++;
      }
      while (folder.endsWith('.')) folder = folder.slice(0, -1);
    }
    out.push(folder);
    at = text.indexOf(SHORT, i);
  }
  return out;
}

/** TUI and CLI source files (ts and tsx, no tests, no build output) of every package. */
function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name === '__tests__' || name === '__fixtures__') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if ((name.endsWith('.ts') || name.endsWith('.tsx')) && !name.includes('.test.') && !name.endsWith('.d.ts')) files.push(p);
    }
  };
  const roots = [join(PACKAGES_DIR, 'swao', 'src')];
  const scoped = join(PACKAGES_DIR, '@swao');
  for (const pkg of readdirSync(scoped)) {
    const src = join(scoped, pkg, 'src');
    if (existsSync(src)) roots.push(src);
  }
  for (const r of roots) walk(r);
  return files;
}

describe('framework URLs name folders that exist (#4340)', () => {
  it('reads the folder after the URL, the parent folder as empty', () => {
    expect(linkedFrameworkFolders(`see ${PREFIX}/client-lz-policy-baseline.`)).toEqual(['client-lz-policy-baseline']);
    expect(linkedFrameworkFolders(`copy from ${PREFIX} into`)).toEqual(['']);
    expect(linkedFrameworkFolders(`${SHORT}/dora and ${PREFIX}/nis2\``)).toEqual(['dora', 'nis2']);
  });

  it('the Policy Baseline step names the exact template folder', () => {
    const text = readFileSync(join(PACKAGES_DIR, 'swao', 'src', 'setup', 'branches', 'lz-live-logic.ts'), 'utf-8');
    expect(text).toContain('export const BASELINE_URL = `${COMMUNITY_FRAMEWORKS_URL}/${BASELINE_FOLDER}`;');
    expect(existsSync(join(FRAMEWORKS_DIR, 'client-lz-policy-baseline', 'policy-baseline.yaml'))).toBe(true);
  });

  it('every linked framework folder exists in swao/community-frameworks', () => {
    const missing: string[] = [];
    let links = 0;
    for (const f of sourceFiles()) {
      const text = readFileSync(f, 'utf-8');
      for (const folder of linkedFrameworkFolders(text)) {
        links++;
        const dir = folder === '' ? FRAMEWORKS_DIR : join(FRAMEWORKS_DIR, folder);
        if (!existsSync(dir) || !statSync(dir).isDirectory()) missing.push(`${relative(REPO_ROOT, f).split(sep).join('/')}: ${folder || '(parent)'}`);
      }
    }
    expect(links).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});
