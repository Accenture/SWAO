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

// #4192 SET-03 (Design 125 section 5.2): the Tools step lists the scanners
// of the prerequisites probe and the IaC tools of the iac_toolchain probe,
// each with what it enables and what is lost without it. PATH lookup only.

import { describe, expect, it } from 'vitest';
import {
  APPLICATION_TOOLS,
  checkApplicationTools,
  detectApplicationTools,
  findOnPath,
  toolState,
  toolsSummary,
} from './application-tools.js';

const present = (files: string[]) => (p: string): boolean => files.includes(p);

describe('APPLICATION_TOOLS (#4192)', () => {
  it('names the probe tools of Design 125 section 5.2 with enables and without texts free of CLI syntax', () => {
    expect(APPLICATION_TOOLS.filter((t) => t.probe === 'prerequisites').map((t) => t.name)).toEqual(['gitleaks', 'osv-scanner', 'clamav', 'yara', 'lizard', 'jscpd']);
    expect(APPLICATION_TOOLS.filter((t) => t.probe === 'iac_toolchain').map((t) => t.name)).toEqual(['terraform', 'opentofu', 'pulumi', 'checkov', 'kics']);
    for (const t of APPLICATION_TOOLS) {
      expect(t.enables.length).toBeGreaterThan(0);
      expect(t.without.length).toBeGreaterThan(0);
      for (const s of [t.enables, t.without]) expect(s).not.toMatch(/--|\bswao\s|`/);
    }
    // Only gitleaks affects every run (the default secret scan, prerequisites-probe.ts gitleaks rule).
    expect(APPLICATION_TOOLS.filter((t) => t.affectsDefaultRun).map((t) => t.name)).toEqual(['gitleaks']);
  });
});

describe('findOnPath (#4192)', () => {
  it('uses PATHEXT on Windows', () => {
    const env = { PATH: 'C:\\tools;C:\\bin\\', PATHEXT: '.EXE;.CMD' };
    expect(findOnPath('checkov', { env, platform: 'win32', isFile: present(['C:\\bin\\checkov.CMD']) })).toBe('C:\\bin\\checkov.CMD');
    expect(findOnPath('kics', { env, platform: 'win32', isFile: present([]) })).toBeNull();
  });

  it('uses the colon separator and bare names on POSIX', () => {
    const env = { PATH: '/usr/local/bin:/usr/bin/' };
    expect(findOnPath('gitleaks', { env, platform: 'linux', isFile: present(['/usr/bin/gitleaks']) })).toBe('/usr/bin/gitleaks');
    expect(findOnPath('yara', { env, platform: 'linux', isFile: present([]) })).toBeNull();
  });
});

describe('checkApplicationTools (#4192)', () => {
  it('reports found tools ok, missing gitleaks as a warning, other missing tools as information', () => {
    const lookup = { env: { PATH: '/bin' }, platform: 'linux' as const, isFile: present(['/bin/clamscan', '/bin/tofu']) };
    const items = checkApplicationTools('.', lookup);
    const byName = Object.fromEntries(items.map((i) => [i.label, i]));
    expect(byName['clamav']).toMatchObject({ state: 'ok' });
    expect(byName['opentofu']).toMatchObject({ state: 'ok' });
    expect(byName['gitleaks']).toMatchObject({ state: 'warn' });
    expect(byName['gitleaks']!.detail).toMatch(/MAL-00/);
    expect(byName['checkov']).toMatchObject({ state: 'info' });
    const statuses = detectApplicationTools(lookup);
    expect(statuses.map(toolState).filter((s) => s === 'ok')).toHaveLength(2);
    expect(toolsSummary(statuses)).toBe('2 of 11 tools found; gitleaks missing');
  });
});
