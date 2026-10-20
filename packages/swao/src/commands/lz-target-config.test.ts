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

// #3281: run targets = config resolution + the shared geography model.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveRunLzTargets, readWorkspaceAssessment } from './lz-target-config.js';

const REGIONS: Record<string, Array<{ id: string; sovereignty: { residency_country: string }; services: unknown[] }>> = {
  azure: [
    { id: 'westeurope', sovereignty: { residency_country: 'NL' }, services: [1, 2, 3] },
    { id: 'germanywestcentral', sovereignty: { residency_country: 'DE' }, services: [1] },
  ],
  aws: [{ id: 'eu-central-1', sovereignty: { residency_country: 'DE' }, services: [1] }],
};

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function run(input: Partial<Parameters<typeof resolveRunLzTargets>[0]>) {
  const logApp = vi.fn();
  const logPortfolio = vi.fn();
  const info = vi.fn();
  const r = resolveRunLzTargets({
    app: 'demo', workspaceRoot: '.', regions: (p) => REGIONS[p] ?? [], logApp, logPortfolio, info, ...input,
  });
  return { r, logApp, logPortfolio, info };
}

describe('resolveRunLzTargets (#3281)', () => {
  it('resolves a geography to its default region, logs info in both scopes and records it', () => {
    const { r, logApp, logPortfolio, info } = run({ appAssessment: { landing_zone: { targets: ['azure:Europe', 'aws:eu-central-1'] } } });
    expect(r.targets).toEqual([{ provider: 'azure', region: 'germanywestcentral' }, { provider: 'aws', region: 'eu-central-1' }]);
    expect(r.source).toBe('app:assessment.landing_zone.targets');
    expect(r.resolved).toEqual([{ requested: 'azure:Europe', resolved: 'azure:germanywestcentral', geography: 'europe' }]);
    expect(logApp).toHaveBeenCalledWith('demo', 'info', 'lz.assessment.target.resolved', expect.stringContaining('azure:germanywestcentral'), expect.anything());
    expect(logPortfolio).toHaveBeenCalledWith('info', 'lz.assessment.target.resolved', expect.any(String), expect.anything());
    expect(info.mock.calls[0]![0]).toMatch(/^\[info\] LZ target azure:Europe names a geography; using the default region azure:germanywestcentral/);
  });

  it('leaves an unknown value unchanged (the fit skips it with the hint) and logs nothing', () => {
    const { r, logApp } = run({ cliTargets: 'azure:Atlantis,nosuch:x' });
    expect(r.targets).toEqual([{ provider: 'azure', region: 'Atlantis' }, { provider: 'nosuch', region: 'x' }]);
    expect(r.resolved).toEqual([]);
    expect(logApp).not.toHaveBeenCalled();
  });

  it('dedupes a geography that resolves to an explicitly listed region', () => {
    const { r } = run({ cliTargets: 'azure:germanywestcentral,azure:Germany' });
    expect(r.targets).toEqual([{ provider: 'azure', region: 'germanywestcentral' }]);
  });

  it('readWorkspaceAssessment reads the workspace block and ignores an invalid file', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-lz-ws-'));
    dirs.push(ws);
    expect(readWorkspaceAssessment(ws)).toBeUndefined();
    writeFileSync(join(ws, '.swao.yml'), 'assessment:\n  landing_zone:\n    targets: [aws:eu-central-1]\n');
    expect(readWorkspaceAssessment(ws)).toEqual({ landing_zone: { targets: ['aws:eu-central-1'] } });
    writeFileSync(join(ws, '.swao.yml'), 'assessment:\n  landing_zone:\n    targets: [nocolon]\n');
    expect(readWorkspaceAssessment(ws)).toBeUndefined();
  });
});
