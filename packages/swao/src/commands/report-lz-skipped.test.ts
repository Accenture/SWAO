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

// #3281: the LZ text report shows the targets a partial run skipped, with the reason.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateLzReport, formatLzText, formatLzYaml } from './report-lz.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function lzRun(marker: Record<string, unknown> | null): string {
  const appDir = mkdtempSync(join(tmpdir(), 'swao-report-lz-'));
  dirs.push(appDir);
  const run = join(appDir, 'wsp', 'runs', '2026-10-17T10-00-00');
  mkdirSync(join(run, 'passes'), { recursive: true });
  writeFileSync(join(appDir, 'wsp', 'latest-landing-zone-catalog.txt'), 'runs/2026-10-17T10-00-00');
  writeFileSync(join(run, 'passes', 'lz-fit.yaml'), [
    'pass: { assessed_at: "2026-10-17" }',
    'assessment:',
    '  provider: aws',
    '  region: eu-central-1',
    '  overall: READY',
    '  sovereignty_statement: ok',
    '  items: []',
    '',
  ].join('\n'));
  if (marker) writeFileSync(join(run, 'run-status.json'), JSON.stringify(marker));
  return appDir;
}

const base = {
  schema_version: '1.0', assessment_type: 'landing-zone-catalog', app: 'demo', run_id: '2026-10-17T10:00:00.000Z',
  started_at: '2026-10-17T10:00:00.000Z', finished_at: '2026-10-17T10:00:09.000Z', exit_code: 0, swao_version: '1.4.0',
};

describe('LZ text report: skipped targets of a partial run (#3281)', () => {
  it('lists each skipped target with its reason, dashes normalised', () => {
    const appDir = lzRun({
      ...base, status: 'partial', targets: ['aws:eu-central-1', 'azure:germanywestcentral', 'azure:Atlantis'],
      failed_targets: [{ provider: 'azure', region: 'Atlantis', reason: 'Region "Atlantis" not found in the azure catalogue -- check the id' }],
      resolved_targets: [{ requested: 'azure:Europe', resolved: 'azure:germanywestcentral', geography: 'europe' }],
    });
    const data = generateLzReport(appDir, 'demo');
    expect(data.skippedTargets).toHaveLength(1);
    const text = formatLzText(data);
    expect(text).toContain('Skipped Targets (partial run)');
    expect(text).toMatch(/\[SKIPPED\] {2}azure \/ Atlantis: Region "Atlantis" not found in the azure catalogue, check the id/);
    expect(text).not.toMatch(/catalogue --/);
    expect(text).toContain('azure:Europe (geography europe) assessed as azure:germanywestcentral');
    expect(formatLzYaml(data)).toMatch(/skipped_targets:\n {2}- provider: azure\n {4}region: Atlantis/);
  });

  it('shows nothing extra for a complete run or a run without a marker', () => {
    expect(formatLzText(generateLzReport(lzRun({ ...base, status: 'complete' }), 'demo'))).not.toContain('Skipped Targets');
    expect(formatLzText(generateLzReport(lzRun(null), 'demo'))).not.toContain('Skipped Targets');
  });
});
