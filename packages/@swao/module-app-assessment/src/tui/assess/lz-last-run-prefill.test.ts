// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module -- LZ last-run prefill (#3378 Part B, ADR-0067)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3378 Part B: the LZ picker pre-selects the targets of the app's LAST RUN,
// read from the run record (run-status.json), not from a .swao.yml the screen
// used to write. This verifies the reader the picker uses.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readLastRunLzTargets, readLastRunAppLzTargets } from '../AssessScreen.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function writeAppRun(ws: string, runId: string, type: string, targets?: string[]): void {
  const runDir = join(ws, 'apps', 'demo', 'wsp', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  const status: Record<string, unknown> = {
    schema_version: '1.0', assessment_type: type, app: 'demo', run_id: runId,
    status: 'complete', started_at: `${runId.replace(/T.*/, '')}T08:00:00.000Z`, swao_version: '1.4.2',
  };
  if (targets) status['targets'] = targets;
  writeFileSync(join(runDir, 'run-status.json'), JSON.stringify(status));
}

function workspaceWithRun(targets: string[] | null): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-lz-lastrun-'));
  dirs.push(ws);
  const runId = '2026-10-22T08-00-00';
  const runDir = join(ws, 'apps', 'demo', 'wsp', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(ws, 'apps', 'demo', 'wsp', 'latest-landing-zone-catalog.txt'), join('runs', runId));
  const status: Record<string, unknown> = {
    schema_version: '1.0',
    assessment_type: 'landing-zone-catalog',
    app: 'demo',
    run_id: runId,
    status: 'complete',
    started_at: '2026-10-22T08:00:00.000Z',
    swao_version: '1.4.2',
  };
  if (targets) status['targets'] = targets;
  writeFileSync(join(runDir, 'run-status.json'), JSON.stringify(status));
  return ws;
}

describe('readLastRunLzTargets (#3378 Part B)', () => {
  it('returns the targets recorded in the last run', () => {
    const ws = workspaceWithRun(['otc:eu-de', 'stackit:eu01']);
    expect(readLastRunLzTargets(ws, 'demo')).toEqual(['otc:eu-de', 'stackit:eu01']);
  });

  it('is empty when the run recorded no targets', () => {
    const ws = workspaceWithRun(null);
    expect(readLastRunLzTargets(ws, 'demo')).toEqual([]);
  });

  it('is empty when the app never had an LZ run (no pointer)', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-lz-norun-'));
    dirs.push(ws);
    mkdirSync(join(ws, 'apps', 'demo', 'wsp'), { recursive: true });
    expect(readLastRunLzTargets(ws, 'demo')).toEqual([]);
  });

  it('is empty for a null workspace', () => {
    expect(readLastRunLzTargets(null, 'demo')).toEqual([]);
  });
});

describe('readLastRunAppLzTargets (#3378 Part B, App screen)', () => {
  it('returns the newest application run\'s targets', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-app-lastrun-')); dirs.push(ws);
    writeAppRun(ws, '2026-10-20T08-00-00', 'application', ['otc:eu-de']);
    writeAppRun(ws, '2026-10-22T08-00-00', 'application', ['stackit:eu01', 'azure:germanywestcentral']);
    expect(readLastRunAppLzTargets(ws, 'demo')).toEqual(['stackit:eu01', 'azure:germanywestcentral']);
  });

  it('skips non-application runs when finding the last app run', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-app-lastrun2-')); dirs.push(ws);
    writeAppRun(ws, '2026-10-20T08-00-00', 'application', ['otc:eu-de']);
    writeAppRun(ws, '2026-10-23T08-00-00', 'landing-zone-catalog', ['aws-esc:eusc-de-east-1']);
    expect(readLastRunAppLzTargets(ws, 'demo')).toEqual(['otc:eu-de']);
  });

  it('is empty when the app has no application run', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-app-norun-')); dirs.push(ws);
    mkdirSync(join(ws, 'apps', 'demo', 'wsp'), { recursive: true });
    expect(readLastRunAppLzTargets(ws, 'demo')).toEqual([]);
    expect(readLastRunAppLzTargets(null, 'demo')).toEqual([]);
  });
});
