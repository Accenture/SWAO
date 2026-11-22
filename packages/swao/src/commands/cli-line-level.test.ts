// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, tests of the CLI output line level
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { cliLineLevel, cliLineWarns } from './cli-line-level.js';

describe('cliLineLevel and cliLineWarns (#4257, Design 126 section 6)', () => {
  it('CL-01 reads the error and warning prefixes, also after leading blanks', () => {
    expect(cliLineLevel('[error] Scaffold halted')).toBe('error');
    expect(cliLineLevel('  [warn] 2 rows skipped')).toBe('warn');
    expect(cliLineLevel('Ingested 12 files')).toBe('info');
    expect(cliLineLevel('')).toBe('info');
  });

  it('CL-02 a warning mark inside the line warns; the level stays info', () => {
    expect(cliLineWarns('  app-a: [warn] no owner')).toBe(true);
    expect(cliLineLevel('  app-a: [warn] no owner')).toBe('info');
    expect(cliLineWarns('all good')).toBe(false);
  });
});
