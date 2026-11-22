// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================


// #4356 (Design 113 section 6.2): the hub LZ fit also reads the in-run fit of
// the application run, not only the landing-zone catalogue run.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLzFit } from './score.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const FIT = (provider: string, region: string, overall: string, items: string[]) => [
  `provider: ${provider}`, `region: ${region}`, `overall: ${overall}`, 'items:', ...items, '',
].join('\n');

function ws(): { ws: string; wsp: string } {
  const root = mkdtempSync(join(tmpdir(), 'swao-lzfit-'));
  dirs.push(root);
  const wsp = join(root, 'apps', 'app-a', 'wsp');
  mkdirSync(join(wsp, 'runs', 'r-app'), { recursive: true });
  return { ws: root, wsp };
}

describe('readLzFit with the in-run fit (#4356)', () => {
  it('an application run with LZ targets and no catalogue run yields its fit', () => {
    const { ws: root, wsp } = ws();
    writeFileSync(join(wsp, 'runs', 'r-app', 'lz-catalogue-fit.yaml'),
      FIT('otc', 'eu-de', 'NEEDS_VERIFICATION', ['  - { capability: key_vault, verdict: SUPPORTED }']));
    expect(readLzFit(root, 'app-a', 'runs/r-app')).toEqual([{ provider: 'otc', region: 'eu-de', verdict: 'NEEDS_VERIFICATION', blockers: 0 }]);
  });

  it('the catalogue run comes first and a target it covers is not repeated', () => {
    const { ws: root, wsp } = ws();
    mkdirSync(join(wsp, 'runs', 'r-lz'), { recursive: true });
    writeFileSync(join(wsp, 'latest-landing-zone-catalog.txt'), 'runs/r-lz');
    writeFileSync(join(wsp, 'runs', 'r-lz', 'lz-catalogue-fit-otc-eu-de.yaml'), FIT('otc', 'eu-de', 'READY', []));
    writeFileSync(join(wsp, 'runs', 'r-app', 'lz-catalogue-fit-otc-eu-de.yaml'), FIT('otc', 'eu-de', 'BLOCKED', []));
    writeFileSync(join(wsp, 'runs', 'r-app', 'lz-catalogue-fit-stackit-eu01.yaml'), FIT('stackit', 'eu01', 'READY_WITH_CHANGES', []));
    expect(readLzFit(root, 'app-a', 'runs/r-app')).toEqual([
      { provider: 'otc', region: 'eu-de', verdict: 'READY', blockers: 0 },
      { provider: 'stackit', region: 'eu01', verdict: 'READY_WITH_CHANGES', blockers: 0 },
    ]);
  });

  it('no fit anywhere, a missing run folder and an unreadable file give undefined', () => {
    const { ws: root, wsp } = ws();
    expect(readLzFit(root, 'app-a', 'runs/r-app')).toBeUndefined();
    expect(readLzFit(root, 'app-a', 'runs/missing')).toBeUndefined();
    expect(readLzFit(root, 'app-a', null)).toBeUndefined();
    writeFileSync(join(wsp, 'runs', 'r-app', 'lz-catalogue-fit.yaml'), 'provider: [unclosed');
    expect(readLzFit(root, 'app-a', 'runs/r-app')).toBeUndefined();
  });
});
