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

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '../../dist/index.js');

function run(args: string): string {
  try {
    return execSync(`node "${CLI}" ${args}`, {
      encoding: 'utf-8',
      env: { ...process.env },
    });
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    return (e.stdout ?? '') + (e.stderr ?? '');
  }
}

describe('CLI polish -- version banner (#0127)', () => {
  let versionOut = '';
  beforeAll(() => { versionOut = run('--version'); }, 45_000);

  it('--version output starts with "SWAO"', () => {
    expect(versionOut.trim()).toMatch(/^SWAO/);
  });

  it('--version output contains the semver from package.json', () => {
    expect(versionOut).toMatch(/v\d+\.\d+\.\d+/);
  });

  it('--version output contains edition label in parentheses', () => {
    expect(versionOut).toMatch(/\((Community|Consultant|Enterprise)\)/);
  });

  it('--version output contains full product name', () => {
    expect(versionOut).toContain('Sovereign Workload Assessment');
  });
});

describe('CLI polish -- help banner (#0127)', () => {
  let helpOut = '';
  beforeAll(() => { helpOut = run('--help'); }, 45_000);

  it('--help prints a one-line SWAO banner before usage text', () => {
    expect(helpOut).toContain('S W A O');
    const bannerLine = helpOut.split('\n').find(l => l.includes('S W A O'));
    expect(bannerLine).toBeDefined();
  });

  it('banner appears before the Usage: line', () => {
    const bannerIdx = helpOut.indexOf('S W A O');
    const usageIdx  = helpOut.indexOf('Usage:');
    expect(bannerIdx).toBeGreaterThanOrEqual(0);
    expect(bannerIdx).toBeLessThan(usageIdx);
  });
});

describe('CLI polish -- subcommand descriptions (#0127)', () => {
  let assessHelp = '', reportHelp = '', doctorHelp = '', credHelp = '', licHelp = '';
  beforeAll(() => {
    assessHelp  = run('assess --help');
    reportHelp  = run('report --help');
    doctorHelp  = run('doctor --help');
    credHelp    = run('credential --help');
    licHelp     = run('license --help');
  }, 120_000);  // Sprint-060 #0567: raised 60s -> 120s. assess.ts now eagerly
  // imports three guest modules (app/audit/landing-zone), so a cold `--help`
  // spawn is ~7s (was ~3s); 5 spawns under full-suite CPU contention exceeded
  // the old 60s beforeAll budget. (Making the guest imports dynamic would cut
  // this back, like the #0350 playwright fix -- tracked as a follow-up.)
  // Sprint-038 #0350: dropped 90s -> 60s after lazy-loading the playwright
  // driver. 5 spawns x ~5-8s each on cold-cache CI.
  //
  // History: sprint-037 #0345 Part C profiled a 9.3s first-spawn cost
  // dominated by playwright-core module init (50MB JS bundle eagerly
  // loaded via static imports in commands/assess.ts:9 and commands/
  // doctor.ts:5). Sprint-038 #0350 converted both to dynamic `await
  // import(...)` inside the handlers; cold-spawn time dropped from
  // ~9.3s to ~3s on the dev machine, and the cli-polish.test.ts
  // beforeAll budget came down with it.

  it('assess --help mentions pass names', () => {
    expect(assessHelp).toMatch(/inv|state|data|sbom|synth/i);
  });

  it('report --help mentions portfolio', () => {
    expect(reportHelp).toMatch(/portfolio/i);
  });

  it('doctor --help mentions what is checked', () => {
    expect(doctorHelp).toMatch(/licence|license|credential|playwright/i);
  });

  it('credential --help mentions LZR adapter keys', () => {
    expect(credHelp).toMatch(/AWS|Azure|meshStack|LZR/i);
  });

  it('license --help mentions Community/Consultant/Enterprise tiers', () => {
    expect(licHelp).toMatch(/Community|Consultant|Enterprise/i);
  });
});
