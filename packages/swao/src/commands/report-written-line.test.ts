// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, tests of the report and bundle output line parsers
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4257: the Generate Report and Support Bundle screens read the written
// paths from the CLI lines through these parsers.

import { describe, it, expect } from 'vitest';
import { reportPathFromLine } from './report-written-line.js';
import { BUNDLE_CREATED_PREFIX, bundlePathFromLine } from './support-bundle.js';

describe('reportPathFromLine (#4257)', () => {
  it('returns the path of a "Report written to" line', () => {
    expect(reportPathFromLine('[ok]  Report written to C:\\ws\\apps\\a\\wsp\\reports-app\\exec.txt')).toBe('C:\\ws\\apps\\a\\wsp\\reports-app\\exec.txt');
    expect(reportPathFromLine('  [ok] Report written to /ws/x.json  ')).toBe('/ws/x.json');
  });

  it('returns undefined for any other line', () => {
    expect(reportPathFromLine('[warn] Report written to x')).toBeUndefined();
    expect(reportPathFromLine('[ok]  Report generated')).toBeUndefined();
    expect(reportPathFromLine('[ok]  Report written to   ')).toBeUndefined();
    expect(reportPathFromLine('')).toBeUndefined();
  });
});

describe('bundlePathFromLine (#4257)', () => {
  it('returns the bundle path of the created line and nothing else', () => {
    expect(bundlePathFromLine(`${BUNDLE_CREATED_PREFIX}C:\\ws\\wsp\\support-diag\\b.tar.gz`)).toBe('C:\\ws\\wsp\\support-diag\\b.tar.gz');
    expect(bundlePathFromLine(`${BUNDLE_CREATED_PREFIX}   `)).toBeUndefined();
    expect(bundlePathFromLine('[ok]  17 diagnostic artefacts')).toBeUndefined();
  });
});
