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

// #3336: the support bundle challenge inventory keeps "newest folder"
// (inventory, not a run report) and records the run combined.yaml challenged.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildChallengeAgentInventory, buildChallengeIterationStats } from './support-bundle.js';

let ws: string | undefined;
afterEach(() => { if (ws) rmSync(ws, { recursive: true, force: true }); ws = undefined; });

describe('buildChallengeAgentInventory (#3336)', () => {
  it('lists the newest challenge folder and the run combined.yaml names', () => {
    ws = mkdtempSync(join(tmpdir(), 'swao-bundle-challenge-'));
    const app = join(ws, 'apps', 'demo');
    mkdirSync(join(app, 'wsp', 'challenge-app', '2026-10-11T08-00-00'), { recursive: true });
    mkdirSync(join(app, 'wsp', 'challenge-app', '2026-10-18T13-00-00'), { recursive: true });
    writeFileSync(join(app, '.swao.yml'), 'app_id: demo\n');
    writeFileSync(join(app, 'wsp', 'challenge-app', 'combined.yaml'),
      'challenged_run:\n  run_id: 2026-10-18T12-37-09\nreports:\n  - agent_id: business-owner\n    agent_role: Business Owner\n');
    const inv = buildChallengeAgentInventory(ws) as Record<string, Record<string, unknown>>;
    expect(inv['demo']).toMatchObject({
      combined_yaml_exists: true,
      combined_challenged_run_id: '2026-10-18T12-37-09',
      last_run_ts: '2026-10-18T13-00-00',
      agents_from_combined: [{ agent_id: 'business-owner', agent_role: 'Business Owner' }],
    });
  });

  it('combined.yaml written before #3330 (no challenged_run): run id null', () => {
    ws = mkdtempSync(join(tmpdir(), 'swao-bundle-challenge-'));
    const app = join(ws, 'apps', 'demo');
    mkdirSync(join(app, 'wsp', 'challenge-app'), { recursive: true });
    writeFileSync(join(app, '.swao.yml'), 'app_id: demo\n');
    writeFileSync(join(app, 'wsp', 'challenge-app', 'combined.yaml'), 'reports: []\n');
    const inv = buildChallengeAgentInventory(ws) as Record<string, Record<string, unknown>>;
    expect(inv['demo']).toMatchObject({ combined_challenged_run_id: null, last_run_ts: null });
  });
});

// #3339: lz_challenge counts challenge-lz/<ts>/ (it used to count challenge-app/);
// app_challenge keeps the challenge-app/<ts>/ statistic under its own name.
describe('buildChallengeIterationStats (#3339)', () => {
  function workspace(): string {
    ws = mkdtempSync(join(tmpdir(), 'swao-bundle-iter-'));
    const wsp = join(ws, 'apps', 'demo', 'wsp');
    for (const ts of ['2026-10-01T09-00-00', '2026-10-18T13-00-00', '2026-10-10T10-00-00']) {
      mkdirSync(join(wsp, 'challenge-lz', ts), { recursive: true });
    }
    mkdirSync(join(wsp, 'challenge-app', '20261011T080000Z'), { recursive: true });
    writeFileSync(join(wsp, 'challenge-app', 'combined.yaml'), 'reports: []\n');
    writeFileSync(join(wsp, 'challenge-lz', '2026-not-a-folder.yaml'), 'x: 1\n');
    mkdirSync(join(ws, 'apps', 'other', 'wsp'), { recursive: true });
    return ws;
  }

  it('lz counts the challenge-lz run folders, not challenge-app', () => {
    const stats = buildChallengeIterationStats(workspace(), 'lz');
    expect(stats).toEqual({
      demo: { total_iterations: 3, first_run: '2026-10-01T09-00-00', last_run: '2026-10-18T13-00-00' },
    });
  });

  it('app counts the challenge-app run folders; compact timestamps become ISO 8601', () => {
    const stats = buildChallengeIterationStats(workspace(), 'app');
    expect(stats).toEqual({
      demo: { total_iterations: 1, first_run: '2026-10-11T08:00:00Z', last_run: '2026-10-11T08:00:00Z' },
    });
  });

  it('a workspace without apps/ yields an empty record', () => {
    ws = mkdtempSync(join(tmpdir(), 'swao-bundle-iter-'));
    expect(buildChallengeIterationStats(ws, 'lz')).toEqual({});
  });
});
