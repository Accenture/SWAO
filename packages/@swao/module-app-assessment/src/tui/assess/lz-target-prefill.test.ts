// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module -- LZ Catalog target preselection (#4198)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4198 (Design 125 section 5.7, owner decision 2026-11-09, ADR-0067
// amendment): the LZ Catalog screen preselects the setup targets first and
// offers the last run's targets as a second choice when they differ; the CLI
// resolver (resolveLzTargets) takes the setup targets and never the run record.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { load } from 'js-yaml';
import { resolveLzTargets, lzTargetLabel } from '@swao/core';
import { lzTargetPrefill, lzPhaseAfterCredentials, lzTargetsForChoice } from './lz-target-prefill.js';
import { readConfiguredLzTargets } from './LzAssessmentScreen.js';
import { readLastRunLzTargets } from '../assess-helpers.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function workspace(setupTargets: string[] | null, lastRunTargets: string[] | null): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-4198-lz-'));
  dirs.push(ws);
  const appDir = join(ws, 'apps', 'demo');
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(ws, '.swao.yml'), 'workspace:\n  name: test\n');
  writeFileSync(
    join(appDir, '.swao.yml'),
    setupTargets
      ? `app:\n  id: demo\nassessment:\n  landing_zone:\n    targets:\n${setupTargets.map((t) => `      - ${t}\n`).join('')}`
      : 'app:\n  id: demo\n',
  );
  if (lastRunTargets) {
    const runId = '2026-11-08T08-00-00';
    const runDir = join(appDir, 'wsp', 'runs', runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(appDir, 'wsp', 'latest-landing-zone-catalog.txt'), join('runs', runId));
    writeFileSync(join(runDir, 'run-status.json'), JSON.stringify({
      schema_version: '1.0', assessment_type: 'landing-zone-catalog', app: 'demo', run_id: runId,
      status: 'complete', started_at: '2026-11-08T08:00:00.000Z', swao_version: '1.6.0', targets: lastRunTargets,
    }));
  }
  return ws;
}

const prefillOf = (ws: string) => lzTargetPrefill(readConfiguredLzTargets(ws, 'demo'), readLastRunLzTargets(ws, 'demo'));

describe('LZ Catalog target preselection (#4198)', () => {
  it('preselects the setup targets first and offers the last run as a second choice when they differ', () => {
    const ws = workspace(['stackit:eu01', 'azure:germanywestcentral'], ['otc:eu-de']);
    expect(prefillOf(ws)).toEqual({
      preselected: ['stackit:eu01', 'azure:germanywestcentral'],
      source: 'setup',
      alternative: ['otc:eu-de'],
    });
  });

  it('the screen asks setup or last run only when they differ, and preselects the chosen list', () => {
    const differ = prefillOf(workspace(['stackit:eu01'], ['otc:eu-de']));
    expect(lzPhaseAfterCredentials(differ)).toBe('input-lz-target-source');
    expect(lzTargetsForChoice(differ, 'setup')).toEqual(['stackit:eu01']);
    expect(lzTargetsForChoice(differ, 'last-run')).toEqual(['otc:eu-de']);
    const same = prefillOf(workspace(['stackit:eu01'], ['stackit:eu01']));
    expect(lzPhaseAfterCredentials(same)).toBe('input-lz-provider');
    expect(lzTargetsForChoice(same, 'last-run')).toEqual(['stackit:eu01']);
  });

  it('offers no second choice when the last run used the same targets (order ignored)', () => {
    const ws = workspace(['stackit:eu01', 'azure:germanywestcentral'], ['azure:germanywestcentral', 'stackit:eu01']);
    const p = prefillOf(ws);
    expect(p.source).toBe('setup');
    expect(p.alternative).toBeUndefined();
  });

  it('preselects the last run when no setup targets exist', () => {
    const ws = workspace(null, ['otc:eu-de']);
    expect(prefillOf(ws)).toEqual({ preselected: ['otc:eu-de'], source: 'last-run' });
  });

  it('preselects nothing without setup targets and without a last run', () => {
    expect(lzTargetPrefill([], [])).toEqual({ preselected: [], source: 'none' });
  });

  it('CLI: resolveLzTargets takes the setup targets, never the last run', () => {
    const ws = workspace(['stackit:eu01'], ['otc:eu-de']);
    const appYml = load(readFileSync(join(ws, 'apps', 'demo', '.swao.yml'), 'utf-8')) as { assessment?: Record<string, unknown> };
    const resolved = resolveLzTargets({ appAssessment: appYml.assessment ?? null });
    expect(resolved.source).toBe('app:assessment.landing_zone.targets');
    expect(resolved.targets.map(lzTargetLabel)).toEqual(['stackit:eu01']);
  });

  it('the screen readers leave the app .swao.yml unchanged', () => {
    const ws = workspace(['stackit:eu01'], ['otc:eu-de']);
    const before = readFileSync(join(ws, 'apps', 'demo', '.swao.yml'), 'utf-8');
    prefillOf(ws);
    expect(readFileSync(join(ws, 'apps', 'demo', '.swao.yml'), 'utf-8')).toBe(before);
  });
});
