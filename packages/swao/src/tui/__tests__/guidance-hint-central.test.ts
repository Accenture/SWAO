// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- gate: guidance toggle text lives only in tui-kit (#4123)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4123 owner rule: screens use the central GuidanceBox as coded. No screen
// re-implements the guidance close hint or the toggle text; the only source is
// @swao/tui-kit GuidanceBox (GUIDANCE_CLOSE_HINT). This gate scans every
// package source tree (tests and build output excluded) for "close guidance"
// outside tui-kit, case-insensitively so it survives a rewording.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// src/tui/__tests__ -> packages/swao -> packages
const packagesDir = join(here, '..', '..', '..', '..');
const premiumDir = join(packagesDir, '..', '..', 'swao-premium');

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name === '__tests__' || name.startsWith('.')) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

describe('guidance close hint is central (#4123)', () => {
  it('no source file outside @swao/tui-kit contains "close guidance"', () => {
    const tuiKit = join(packagesDir, '@swao', 'tui-kit') + sep;
    const offenders: string[] = [];
    for (const f of [...sourceFiles(packagesDir), ...sourceFiles(premiumDir)]) {
      if (f.startsWith(tuiKit)) continue;
      const text = readFileSync(f, 'utf-8');
      text.split('\n').forEach((line, i) => {
        if (/close guidance/i.test(line)) offenders.push(`${relative(packagesDir, f)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('scans a non-trivial number of files (guards against a wrong root)', () => {
    expect(sourceFiles(packagesDir).length).toBeGreaterThan(200);
  });
});
