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

// #4262: the service probes of the health check and the Setup Wizard read the
// same service workspace markers. The wizard's type selection writes
// workspace.assessment_types (writeAssessmentTypes) and the intake writer
// writes the service_portfolio block (writeServiceIntake); the probe detector
// (serviceWorkspaceState, @swao/module-health-check) recognises both, and the
// wizard check (isServiceWorkspaceYml) agrees on the block.

import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  return { ...actual, logPortfolio: vi.fn() };
});

import {
  buildApmWeightsProbe,
  buildIntakeMappingProbe,
  buildServiceProbes,
  serviceWorkspaceState,
  formatHealthCheckSummaryLine,
  SERVICE_PROBES_SKIPPED_NAME,
} from '@swao/module-health-check';
import { writeAssessmentTypes } from './workspace-state.js';
import { isServiceWorkspaceYml, setUpServiceWorkspace, writeServiceIntake } from './branches/service-checks.js';
import { checkBranch } from './branch-check.js';
import { defaultSetupRegistry } from './index.js';

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

function workspace(): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-svc-parity-'));
  roots.push(d);
  writeFileSync(join(d, '.swao.yml'), 'engagement:\n  name: t\n');
  return d;
}

describe('#4262 service workspace marker parity (wizard writers, probe detector)', () => {
  it('the type selection marks a declared service workspace for the probes', () => {
    const d = workspace();
    expect(serviceWorkspaceState(d)).toBe('none');
    expect(writeAssessmentTypes(d, ['application', 'service'])).toBe(true);
    expect(serviceWorkspaceState(d)).toBe('declared');
  });

  it('the intake writer marks the service portfolio for the probes and the wizard check alike', () => {
    const d = workspace();
    writeAssessmentTypes(d, ['service']);
    expect(writeServiceIntake(d, { intake: 'wsp/inputs/service-intake/inv.xlsx' })).toBe(true);
    expect(serviceWorkspaceState(d)).toBe('portfolio');
    expect(isServiceWorkspaceYml(d)).toBe(true);
  });
});

describe('#4262 a service check whose service probes all skipped', () => {
  it('reports needs-attention with the warned check naming the reason', async () => {
    const d = workspace();
    const out = [
      'Running swao health-check...',
      '  [1/3] License...............  ok    Enterprise',
      '  [2/3] Intake mapping........  INFO  not a service workspace',
      '  [3/3] Service workspace.....  INFO  not a service workspace',
      '',
      ...formatHealthCheckSummaryLine([], [SERVICE_PROBES_SKIPPED_NAME]).split('\n'),
    ];
    const r = await checkBranch(defaultSetupRegistry(), d, 'service', async () => out);
    expect(r.health.warnedProbes).toEqual([SERVICE_PROBES_SKIPPED_NAME]);
    expect(r.state).toBe('needs-attention');
  });
});

describe('#4262 the Service branch on a fresh workspace: the service probes run', () => {
  // The nine probes of the Service health check (Design 125 section 4, row "Health check (Service)").
  function serviceScope(d: string): Record<string, { status: string; message: string }> {
    const out: Record<string, { status: string; message: string }> = {
      intake_mapping: buildIntakeMappingProbe(d),
      apm_weights: buildApmWeightsProbe(d),
    };
    for (const p of buildServiceProbes(d)) out[p.key] = p;
    return out;
  }

  it('type selection plus the Service workspace step with one workbook: service_workspace and intake_mapping run', () => {
    const d = workspace();
    writeAssessmentTypes(d, ['application', 'service']);
    mkdirSync(join(d, 'wsp', 'inputs', 'service-intake'), { recursive: true });
    writeFileSync(join(d, 'wsp', 'inputs', 'service-intake', 'Application-Portfolio-Demo.xlsx'), 'x');
    const r = setUpServiceWorkspace(d);
    expect(r).toMatchObject({ block: true, recorded: 'wsp/inputs/service-intake/Application-Portfolio-Demo.xlsx' });
    // The step log names what was created (paths relative to the workspace, keys, no values).
    expect(r.created).toEqual([
      '.swao.yml#service_portfolio.intake_folder',
      '.swao.yml#service_portfolio.intake',
    ]);
    const probes = serviceScope(d);
    expect(Object.keys(probes)).toHaveLength(9);
    expect(probes['service_workspace']!.status).toBe('info');
    expect(probes['service_workspace']!.message).toContain('intake recorded');
    expect(probes['intake_mapping']!.status).toBe('ok');
    for (const [key, p] of Object.entries(probes)) expect(p.message, key).not.toBe('not a service workspace');
  });

  it('the Service workspace step without a workbook: the probes still run and name the missing intake', () => {
    const d = workspace();
    writeAssessmentTypes(d, ['service']);
    const r = setUpServiceWorkspace(d);
    expect(r).toMatchObject({ block: true, recorded: null, folder: 'wsp/inputs/service-intake' });
    expect(r.created).toEqual(['wsp/inputs/service-intake/', '.swao.yml#service_portfolio.intake_folder']);
    const probes = serviceScope(d);
    expect(probes['service_workspace']).toMatchObject({ status: 'error', message: expect.stringContaining('no intake recorded') });
    expect(probes['intake_mapping']!.status).toBe('ok');
    for (const [key, p] of Object.entries(probes)) expect(p.message, key).not.toBe('not a service workspace');
    // A second set-up creates nothing new.
    expect(setUpServiceWorkspace(d).created).toEqual([]);
  });
});
