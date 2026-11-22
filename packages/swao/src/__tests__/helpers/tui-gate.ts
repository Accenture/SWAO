// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, shared scanner of the Design 126 TUI audit gates
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4245 (Design 126 section 13): every TUI gate scans the same trees (every
// package source tree and swao-premium, tests and build output excluded, as
// guidance-hint-central.test.ts does) and compares its offenders with an
// allowlist of today's offenders. The allowlist is keyed by file with an
// offender count and the issue that removes them: more offenders than listed
// is a new offender, fewer is a stale entry. Both fail, so the list can only
// shrink. Counts instead of line numbers keep the list stable while parallel
// lanes edit the same files (owner rule: the gate fails only on new offenders).
//
// Only erasable TypeScript and node: imports, so the file also runs under
// plain node (type stripping) when an allowlist is seeded once.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// src/__tests__/helpers -> src/__tests__ -> src -> packages/swao -> packages
export const PACKAGES_DIR = join(here, '..', '..', '..', '..');
export const REPO_ROOT = join(PACKAGES_DIR, '..', '..');
export const PREMIUM_DIR = join(REPO_ROOT, 'swao-premium');
export const TUI_KIT_DIR = join(PACKAGES_DIR, '@swao', 'tui-kit');

/** Every .ts and .tsx source below `root`; tests, __tests__, build output and dot folders excluded. */
export function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name === '__tests__' || name.startsWith('.')) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

/** Repo-relative path with forward slashes (allowlist key). */
export function repoPath(file: string): string {
  return relative(REPO_ROOT, file).split(sep).join('/');
}

/** True for a file of tui-kit, the home of the central components. */
export function inTuiKit(file: string): boolean {
  return file.startsWith(TUI_KIT_DIR + sep);
}

/**
 * The TUI trees: every .tsx file, every .ts file below a `tui` or `setup`
 * folder, and all of tui-kit. CLI command code, providers and report
 * renderers are not TUI screen text.
 */
export function tuiFiles(opts: { includeTuiKit: boolean }): string[] {
  const all = [...sourceFiles(PACKAGES_DIR), ...sourceFiles(PREMIUM_DIR)];
  return all.filter((f) => {
    if (inTuiKit(f)) return opts.includeTuiKit;
    if (f.endsWith('.tsx')) return true;
    const parts = relative(REPO_ROOT, f).split(sep);
    return parts.includes('tui') || parts.includes('setup');
  });
}

/**
 * The code part of each line, with comments removed; null for a comment line,
 * a log call or a file write (not screen text; the rule of setup-layout.test.ts).
 */
export function codeLines(text: string): Array<string | null> {
  let inBlock = false;
  return text.split('\n').map((line) => {
    const t = line.trim();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      return null;
    }
    if (t.startsWith('/*') || t.startsWith('{/*')) {
      if (!t.includes('*/')) inBlock = true;
      return null;
    }
    if (t.startsWith('//') || t.startsWith('*')) return null;
    if (/logPortfolio\(|writeFileSync\(|console\.(log|error|warn)\(|logger\.\w+\(/.test(line)) return null;
    return line.replace(/\/\*.*?\*\//g, '').replace(/\{\/\*.*?\*\/\}/g, '').replace(/\s\/\/\s.*$/, '');
  });
}

/** 1-based numbers of the lines whose code part matches `test`. */
export function lineOffenders(text: string, test: (code: string) => boolean): number[] {
  const hits: number[] = [];
  codeLines(text).forEach((code, i) => {
    if (code !== null && test(code)) hits.push(i + 1);
  });
  return hits;
}

export interface AllowEntry { count: number; issue: string }
export interface Allowlist { gate: string; rule: string; entries: Record<string, AllowEntry> }

/** Offender count per repo-relative file (files without offenders left out). */
export function scan(files: string[], offenders: (text: string, file: string) => number[]): Record<string, number[]> {
  const found: Record<string, number[]> = {};
  for (const f of files) {
    const hits = offenders(readFileSync(f, 'utf-8'), f);
    if (hits.length > 0) found[repoPath(f)] = hits;
  }
  return found;
}

export interface AllowlistVerdict { newOffenders: string[]; stale: string[] }

/**
 * Compare found offenders with the allowlist. A file with more offenders than
 * listed reports its lines as new offenders; a listed file with fewer (or
 * none) is stale, because the allowlist may only shrink.
 */
export function compareWithAllowlist(found: Record<string, number[]>, allow: Allowlist): AllowlistVerdict {
  const newOffenders: string[] = [];
  const stale: string[] = [];
  for (const [file, lines] of Object.entries(found)) {
    const listed = allow.entries[file]?.count ?? 0;
    if (lines.length > listed) newOffenders.push(`${file}:${lines.join(',')} (${lines.length} found, ${listed} allowed)`);
  }
  for (const [file, entry] of Object.entries(allow.entries)) {
    const n = found[file]?.length ?? 0;
    if (n < entry.count) stale.push(`${file}: ${n} found, ${entry.count} listed; lower the count or remove the entry (${entry.issue})`);
  }
  return { newOffenders, stale };
}

/**
 * Without the swao-premium tree (the public Community checkout) its files are
 * not scanned, so their allowlist entries are dropped instead of reported
 * as stale.
 */
export function forPremiumPresence(allow: Allowlist, premiumPresent: boolean): Allowlist {
  if (premiumPresent) return allow;
  const entries = Object.fromEntries(Object.entries(allow.entries).filter(([f]) => !f.startsWith('swao-premium/')));
  return { ...allow, entries };
}

/** Read an allowlist JSON next to the gates (src/tui/__tests__/allowlists). */
export function loadAllowlist(name: string): Allowlist {
  const p = join(PACKAGES_DIR, 'swao', 'src', 'tui', '__tests__', 'allowlists', name);
  return forPremiumPresence(JSON.parse(readFileSync(p, 'utf-8')) as Allowlist, existsSync(PREMIUM_DIR));
}

/**
 * The open issue that owns a new allowlist entry (#4343, U-3: an entry names
 * an open issue only; tui-allowlist-owners.test.ts checks it and names this
 * owner in its message): the Setup Wizard migration (#4254) for setup and
 * wizard steps, the strict-gates row (#4213) for everything else. Every
 * allowlist is empty since 2026-11-13 (#4213 criterion 3); the
 * remaining-screens row #4257 is closed, so the screens of swao and
 * swao-premium fall to #4213.
 */
export function owningIssue(file: string): string {
  const f = file.replace(/\\/g, '/');
  if (f.includes('/swao/src/setup/') || f.includes('/tui/screens/wizard/')) return '#4254';
  return '#4213';
}
