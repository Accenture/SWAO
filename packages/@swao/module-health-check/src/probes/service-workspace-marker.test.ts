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

// #4262: the service probes recognise a service workspace by either marker:
// the service_portfolio block (intake recorded) or workspace.assessment_types
// listing `service` (the Setup Wizard's type selection). A declared workspace
// without the intake block makes service_workspace and intake_mapping warn,
// naming the missing block, instead of skipping as "not a service workspace";
// a service-scoped check whose service probes all skip is a warned check.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildServiceProbes,
  buildServiceWorkspaceProbe,
  isServiceWorkspace,
  serviceWorkspaceState,
  SERVICE_INTAKE_MISSING,
} from './service-probes.js';
import { buildIntakeMappingProbe } from './intake-mapping-probe.js';
import { buildApmWeightsProbe } from './apm-weights-probe.js';
import { allServiceProbesSkipped, computeWarnedProbes, SERVICE_PROBES_SKIPPED_NAME } from '../commands/health-check.js';
import type { BuildHealthCheckContext } from '../commands/health-check.js';

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

function ws(yml: string): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-svc-marker-'));
  roots.push(d);
  writeFileSync(join(d, '.swao.yml'), yml);
  return d;
}

// The workspace .swao.yml the Setup Wizard writes after the type selection (UAT 2026-11-09).
const DECLARED = 'engagement:\n  name: t\nworkspace:\n  assessment_types: [application, service]\n  setup_state:\n    service:\n      state: needs-attention\n';
const PORTFOLIO = 'engagement:\n  name: t\nservice_portfolio:\n  intake: wsp/inputs/service-intake/inv.xlsx\n';
const NONE = 'engagement:\n  name: t\nworkspace:\n  assessment_types: [application]\n';

describe('#4262 service workspace marker', () => {
  it('either marker is a service workspace; neither is not', () => {
    expect(serviceWorkspaceState(ws(PORTFOLIO))).toBe('portfolio');
    expect(serviceWorkspaceState(ws(DECLARED))).toBe('declared');
    expect(serviceWorkspaceState(ws(NONE))).toBe('none');
    expect(isServiceWorkspace(ws(DECLARED))).toBe(true);
    expect(isServiceWorkspace(ws(NONE))).toBe(false);
  });

  it('a declared workspace without the intake block: service_workspace and intake_mapping warn and name the block', () => {
    const d = ws(DECLARED);
    const sw = buildServiceWorkspaceProbe(d);
    expect(sw.status).toBe('warn');
    expect(sw.message).toBe(SERVICE_INTAKE_MISSING);
    expect(sw.message).toContain('service_portfolio');
    const im = buildIntakeMappingProbe(d);
    expect(im.status).toBe('warn');
    expect(im.message).toBe(SERVICE_INTAKE_MISSING);
    // The probes that need the intake skip with the reason, not "not a service workspace".
    for (const p of buildServiceProbes(d).slice(1)) {
      expect(p.status, p.key).toBe('skip');
      expect(p.message, p.key).toMatch(/waits for the service intake/);
    }
  });

  it('the SWAO_APM weights probe uses the same detector (no "not a service workspace" skip when declared)', () => {
    expect(buildApmWeightsProbe(ws(DECLARED)).message).not.toBe('not a service workspace');
    expect(buildApmWeightsProbe(ws(NONE))).toMatchObject({ status: 'skip', message: 'not a service workspace' });
  });

  it('with the block recorded the probes run their checks (no skip for service_workspace)', () => {
    expect(buildServiceWorkspaceProbe(ws(PORTFOLIO)).status).not.toBe('skip');
  });

  it('a workspace with neither marker keeps the skip', () => {
    const d = ws(NONE);
    expect(buildServiceWorkspaceProbe(d)).toMatchObject({ status: 'skip', message: 'not a service workspace' });
    expect(buildIntakeMappingProbe(d)).toMatchObject({ status: 'skip', message: 'not a service workspace' });
  });
});

describe('#4262 all-skip service-scoped check is a warned check', () => {
  function ctxFor(d: string): BuildHealthCheckContext {
    return {
      probeLines: [],
      serviceProbes: buildServiceProbes(d),
      intakeMappingProbe: buildIntakeMappingProbe(d),
      apmWeightsProbe: buildApmWeightsProbe(d),
    } as unknown as BuildHealthCheckContext;
  }

  it('scope service with every service probe skipped names the reason; other scopes do not', () => {
    const ctx = ctxFor(ws(NONE));
    expect(allServiceProbesSkipped(ctx)).toBe(true);
    expect(computeWarnedProbes(ctx, {}, 'service')).toEqual([SERVICE_PROBES_SKIPPED_NAME]);
    expect(computeWarnedProbes(ctx, {}, 'application')).toEqual([]);
    expect(SERVICE_PROBES_SKIPPED_NAME).not.toContain(',');
  });

  it('a declared workspace is not all-skip (service_workspace warns)', () => {
    expect(allServiceProbesSkipped(ctxFor(ws(DECLARED)))).toBe(false);
  });
});
