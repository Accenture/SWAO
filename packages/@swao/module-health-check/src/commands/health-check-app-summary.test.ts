// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health-check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4261: the application-branch health-check summary agrees with its probes:
// the app count instead of "no apps to assess", the ingestion message count
// equal to file_count, no advice to configure source.vcs.url when it is set,
// and a source accessibility warning counted as a warned check.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkSourceAccessibility,
  computeWarnedProbes,
  countConfiguredApps,
  formatHealthCheckCompleteMessage,
  SOURCE_ACCESS_WARNING_NAME,
} from './health-check.js';
import type { BuildHealthCheckContext } from './health-check.js';
import { buildIngestionProbe } from '../probes/ingestion-probe.js';

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

function workspace(apps: Record<string, string>): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-hc-4261-'));
  roots.push(ws);
  writeFileSync(join(ws, '.swao.yml'), 'engagement:\n  name: t\n');
  for (const [id, yml] of Object.entries(apps)) {
    mkdirSync(join(ws, 'apps', id, 'wsp', 'inputs', 'source'), { recursive: true });
    writeFileSync(join(ws, 'apps', id, '.swao.yml'), yml);
    writeFileSync(join(ws, 'apps', id, 'wsp', 'inputs', 'source', 'README.md'), '# placeholder\n');
  }
  return ws;
}

const GIT_APP = 'app_id: sovereign-health\nsource:\n  path: wsp/inputs/source/\n  vcs:\n    type: github\n    url: https://github.com/example-org/brickos.git\n';
const LOCAL_APP = 'app_id: local-app\nsource:\n  path: wsp/inputs/source/\n';

describe('#4261 complete message with one app configured and no runs', () => {
  it('names the app count and never says "no apps to assess"', () => {
    const ws = workspace({ 'sovereign-health': GIT_APP });
    expect(countConfiguredApps(ws)).toBe(1);
    const msg = formatHealthCheckCompleteMessage({ failedProbes: [], warnedProbes: [], absentProbes: ['traceability'], appCount: countConfiguredApps(ws) });
    expect(msg).toBe('Health-check passed, 1 app(s) configured, none assessed yet (traceability skipped)');
    expect(msg).not.toContain('no apps to assess');
    expect(formatHealthCheckCompleteMessage({ failedProbes: [], warnedProbes: [], absentProbes: ['scope', 'traceability'], appCount: 0 }))
      .toBe('Health-check passed, workspace only, no apps yet (scope, traceability skipped)');
  });
});

describe('#4261 ingestion message and file_count agree', () => {
  it('the processed state names the drop-zone count that file_count carries', () => {
    const ws = workspace({ 'sovereign-health': GIT_APP });
    mkdirSync(join(ws, 'apps', 'sovereign-health', 'ingestion'), { recursive: true });
    writeFileSync(join(ws, 'apps', 'sovereign-health', 'ingestion', 'a.ndjson'), '{}');
    writeFileSync(join(ws, 'apps', 'sovereign-health', 'ingestion', 'b.ndjson'), '{}');
    const probe = buildIngestionProbe(ws);
    expect(probe.status).toBe('processed');
    const waiting = /(\d+) file\(s\) waiting/.exec(probe.message);
    expect(waiting).not.toBeNull();
    expect(Number(waiting![1])).toBe(probe.file_count);
    expect(probe.message).toContain('sovereign-health (2 ingested file(s))');
  });
});

describe('#4261 source accessibility advice', () => {
  it('with source.vcs.url set and an empty source directory, no advice to configure source.vcs.url and no warning', () => {
    const ws = workspace({ 'sovereign-health': GIT_APP });
    const lines = checkSourceAccessibility(ws);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[INFO\] apps\/sovereign-health: /);
    expect(lines[0]).toContain('swao assess clones the repository');
    expect(lines.join(' ')).not.toMatch(/Configure source\.vcs\.url|Set source\.vcs\.url/);
  });

  it('without source.vcs.url an empty source directory stays a warning', () => {
    const ws = workspace({ 'local-app': LOCAL_APP });
    const lines = checkSourceAccessibility(ws);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[WARN\] apps\/local-app: /);
  });

  it('a [WARN] source accessibility entry is a warned check named "Source access"; [INFO] is not', () => {
    const ctx = { probeLines: ['  [1/1] License.................  ok    Community'] } as unknown as BuildHealthCheckContext;
    expect(computeWarnedProbes(ctx, { source_accessibility_warnings: ['[WARN] apps/x: missing'] })).toEqual([SOURCE_ACCESS_WARNING_NAME]);
    expect(computeWarnedProbes(ctx, { source_accessibility_warnings: ['[INFO] apps/x: cloned at assess'] })).toEqual([]);
    // Out of scope (an LZ catalogue check does not run the source check).
    expect(computeWarnedProbes(ctx, { source_accessibility_warnings: ['[WARN] apps/x: missing'] }, 'lz-catalog')).toEqual([]);
  });
});
