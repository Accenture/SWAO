// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// apm-weights-probe (#3102, Design 103 Q4).
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump, load } from 'js-yaml';
import { apmFrameworkDir } from '@swao/module-service-assessment';
import { buildApmWeightsProbe } from './apm-weights-probe.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const bundledMeta = load(readFileSync(join(apmFrameworkDir()!.dir, 'framework-meta.yaml'), 'utf-8')) as { framework: Record<string, any> };

function workspace(opts: { service?: boolean; weights?: Record<string, number> | null } = {}): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-apm-probe-'));
  dirs.push(ws);
  writeFileSync(join(ws, '.swao.yml'), opts.service === false ? 'wsp_version: "0.9"\n' : 'wsp_version: "0.9"\nservice_portfolio:\n  source: intake.xlsx\n');
  if (opts.weights !== undefined) {
    const dir = join(ws, 'wsp', 'inputs', 'catalogs', 'community', 'swao-apm');
    mkdirSync(dir, { recursive: true });
    const fw = { ...bundledMeta.framework };
    if (opts.weights === null) delete fw['domain_weights'];
    else fw['domain_weights'] = opts.weights;
    writeFileSync(join(dir, 'framework-meta.yaml'), dump({ framework: fw }));
  }
  return ws;
}

describe('buildApmWeightsProbe (#3102)', () => {
  it('skips application workspaces', () => {
    expect(buildApmWeightsProbe(workspace({ service: false })).status).toBe('skip');
  });

  it('passes on the bundled draft weights (sum 100)', () => {
    expect(buildApmWeightsProbe(workspace())).toMatchObject({ status: 'ok', source: 'bundled' });
  });

  it('fails when a workspace override sums to 99', () => {
    const weights = { ...bundledMeta.framework['domain_weights'], 'APM-TCH': 19 };
    const r = buildApmWeightsProbe(workspace({ weights }));
    expect(r).toMatchObject({ status: 'error', source: 'workspace' });
    expect(r.message).toBe('domain_weights sum to 99, expected 100');
  });

  it('fails when a domain is missing', () => {
    const { 'APM-REG': _reg, ...rest } = bundledMeta.framework['domain_weights'];
    const r = buildApmWeightsProbe(workspace({ weights: { ...rest, 'APM-TCH': 28 } }));
    expect(r.status).toBe('error');
    expect(r.errors).toEqual(['domain_weights missing domain(s): APM-REG']);
  });

  it('warns when domain_weights is absent (defaults assumed)', () => {
    expect(buildApmWeightsProbe(workspace({ weights: null })).status).toBe('warn');
  });
});
