// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module -- Landing Zone screen tests
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3281 TUI/CLI parity: the LZ assessment screen writes and reads the same
// key the CLI reads (assessment.landing_zone.targets).

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { load } from 'js-yaml';
import { SwaoYmlSchema, resolveLzTargets } from '@swao/core';
import { persistLzCatTargets, readConfiguredLzTargets } from './LzAssessmentScreen.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function workspace(appYml: string, wsYml = 'wsp_version: "0.9"\n'): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-tui-lz-'));
  dirs.push(ws);
  writeFileSync(join(ws, '.swao.yml'), wsYml);
  mkdirSync(join(ws, 'apps', 'demo'), { recursive: true });
  writeFileSync(join(ws, 'apps', 'demo', '.swao.yml'), appYml);
  return ws;
}

describe('LZ assessment screen persistence (#3281)', () => {
  it('writes assessment.landing_zone.targets, drops lz_cat_targets, and the CLI resolver reads it back', () => {
    const ws = workspace('app_id: demo\nassessment:\n  regimes_active: [GDPR]\n  lz_cat_targets: aws:eu-central-1\n  landing_zone:\n    provider: stackit\n');
    persistLzCatTargets(ws, 'demo', ['azure:germanywestcentral', 'stackit:eu01']);
    const raw = load(readFileSync(join(ws, 'apps', 'demo', '.swao.yml'), 'utf-8'));
    const parsed = SwaoYmlSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    const a = (parsed.data as { assessment: Record<string, unknown> }).assessment;
    expect(a['lz_cat_targets']).toBeUndefined();
    expect(a['landing_zone']).toEqual({ provider: 'stackit', targets: ['azure:germanywestcentral', 'stackit:eu01'] });
    expect(resolveLzTargets({ appAssessment: a }).source).toBe('app:assessment.landing_zone.targets');
    expect(readConfiguredLzTargets(ws, 'demo')).toEqual(['azure:germanywestcentral', 'stackit:eu01']);
  });

  it('pre-selection falls back to the workspace .swao.yml', () => {
    const ws = workspace('app_id: demo\n', 'assessment:\n  landing_zone:\n    targets: [otc:eu-de]\n');
    expect(readConfiguredLzTargets(ws, 'demo')).toEqual(['otc:eu-de']);
    expect(readConfiguredLzTargets(null, 'demo')).toEqual([]);
  });
});
