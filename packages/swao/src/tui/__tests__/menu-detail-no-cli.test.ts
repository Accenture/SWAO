// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- gate: no CLI command as a menu description (#4122)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4122 owner rule for every TUI menu: the grey description of an entry says
// what the option does in plain words; the CLI command goes into the guidance
// box. This gate scans the menu item definitions of every package source tree
// (tests and build output excluded) and fails on a `detail` string that starts
// with the word swao followed by a space.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packagesDir = join(here, '..', '..', '..', '..');
const premiumDir = join(packagesDir, '..', '..', 'swao-premium');

/** A `detail` property whose string value starts with "swao ". */
export const CLI_DETAIL = /\bdetail\s*:\s*['"`]swao\s/;

function sourceFiles(root: string): string[] {
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

describe('menu descriptions carry no CLI command (#4122)', () => {
  it('the pattern flags CLI syntax and passes plain descriptions', () => {
    expect(CLI_DETAIL.test("detail: 'swao publish --portfolio',")).toBe(true);
    expect(CLI_DETAIL.test('detail: `swao assess --type llm`')).toBe(true);
    expect(CLI_DETAIL.test("detail: 'overview of all assessed apps',")).toBe(false);
    expect(CLI_DETAIL.test("cli: 'swao publish --portfolio',")).toBe(false);
  });

  it('no menu item definition has a detail starting with "swao "', () => {
    const offenders: string[] = [];
    for (const f of [...sourceFiles(packagesDir), ...sourceFiles(premiumDir)]) {
      readFileSync(f, 'utf-8').split('\n').forEach((line, i) => {
        if (CLI_DETAIL.test(line)) offenders.push(`${relative(packagesDir, f)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
