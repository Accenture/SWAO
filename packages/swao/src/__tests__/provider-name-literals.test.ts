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

// #4296 gate: a provider reads the same across the SWAO ecosystem because
// every human label comes from the one map in @swao/core
// (`provider-names.ts`, `providerLabel(id, form)`). This gate fails when a
// full provider name ("T Cloud Public", "Google Cloud Platform", ...) is
// written as a literal in TUI or CLI source outside the map. Comment lines
// are not checked (they explain history, for example the former Open Telekom
// Cloud name). Files listed in ALLOWLIST hold data or publication text that
// a later issue moves onto the map; each entry names the issue and the count,
// and a count that drops must be lowered here.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROVIDER_NAMES } from '@swao/core';

const here = dirname(fileURLToPath(import.meta.url));
const packagesDir = resolve(here, '../../..');
const premiumDir = resolve(packagesDir, '../../swao-premium/packages/@swao');

/** TUI and CLI source roots (relative to swao/packages). */
const ROOTS = [
  'swao/src',
  '@swao/tui-kit/src',
  '@swao/core/src',
  '@swao/module-app-assessment/src',
  '@swao/module-landing-zone/src',
  '@swao/module-health-check/src',
  '@swao/publication-render/src',
  '@swao/module-html-report/src',
  '@swao/module-powerbi/src',
];
const PREMIUM_ROOTS = ['module-mcp/src'];

/** The map itself. */
const MAP_FILE = '@swao/core/src/provider-names.ts';

/** File (relative to swao/packages, `/` separated) to the allowed literal count, with the reason. */
const ALLOWLIST: Readonly<Record<string, { count: number; reason: string }>> = {
  // A catalogue meta.name written into a newly created catalogue file (data, not a label);
  // the catalogue meta.name sweep is part of #4364 / the catalogue data.
  '@swao/module-landing-zone/src/commands/lz-premium.ts': { count: 1, reason: 'catalogue meta.name data (#4364)' },
};

/** Full names that differ from their abbreviation (STACKIT and OVHcloud are the same word). */
const FULL_NAMES = [...new Set(Object.values(PROVIDER_NAMES).map((n) => n.full).filter((full) => !Object.values(PROVIDER_NAMES).some((n) => n.abbr === full)))];

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '__fixtures__' || name === 'fixtures') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if ((name.endsWith('.ts') || name.endsWith('.tsx')) && !name.includes('.test.') && !name.endsWith('.d.ts')) out.push(full);
  }
}

function isCommentLine(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('{/*');
}

/** Literal hits per file: `<name>` on a non-comment line. */
function countHits(file: string): number {
  let hits = 0;
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (isCommentLine(line)) continue;
    for (const name of FULL_NAMES) if (line.includes(name)) hits += 1;
  }
  return hits;
}

function sourceFiles(): Array<{ rel: string; abs: string }> {
  const files: string[] = [];
  for (const r of ROOTS) { const d = join(packagesDir, r); if (existsSync(d)) walk(d, files); }
  for (const r of PREMIUM_ROOTS) { const d = join(premiumDir, r); if (existsSync(d)) walk(d, files); }
  return files.map((abs) => ({ abs, rel: relative(packagesDir, abs).split('\\').join('/') }));
}

describe('provider name literals (#4296 gate)', () => {
  it('scans the full names of the map', () => {
    expect(FULL_NAMES).toContain('T Cloud Public');
    expect(FULL_NAMES).toContain('Google Cloud Platform');
    expect(FULL_NAMES).not.toContain('STACKIT');
  });

  it('finds the names in the map file itself (the scan is live)', () => {
    expect(countHits(join(packagesDir, MAP_FILE))).toBeGreaterThanOrEqual(FULL_NAMES.length);
  });

  it('has no full provider name literal outside the map in TUI, CLI, MCP, Power BI and publication source', () => {
    const offenders: string[] = [];
    for (const { rel, abs } of sourceFiles()) {
      if (rel === MAP_FILE) continue;
      const hits = countHits(abs);
      const allowed = ALLOWLIST[rel]?.count ?? 0;
      if (hits > allowed) offenders.push(`${rel}: ${hits} literal(s), allowed ${allowed}; use providerLabel() from @swao/core`);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the allowlist tight (lower a count when a literal goes)', () => {
    const loose: string[] = [];
    for (const [rel, { count }] of Object.entries(ALLOWLIST)) {
      const abs = join(packagesDir, rel);
      const hits = existsSync(abs) ? countHits(abs) : 0;
      if (hits < count) loose.push(`${rel}: ${hits} literal(s), allowlist says ${count}`);
    }
    expect(loose).toEqual([]);
  });
});
