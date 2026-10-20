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

// #3330: LZ and application reports embed only the challenge of the reported
// run (two runs, two challenges), labelled with challenge timestamp and run.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateLzReport, formatLzText, formatLzYaml, buildLzReportDataStub } from './report-lz.js';
import { generateReport, formatText } from './report.js';

const R1 = '2026-10-11T17-43-36';
const R2 = '2026-10-18T12-37-09';
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function appDirTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-report-challenge-'));
  dirs.push(d);
  return d;
}

function lzRun(appDir: string, id: string, provider: string): void {
  const run = join(appDir, 'wsp', 'runs', id);
  mkdirSync(join(run, 'passes'), { recursive: true });
  writeFileSync(join(run, 'passes', 'lz-fit.yaml'), [
    `pass: { assessed_at: "${id.slice(0, 10)}" }`,
    'assessment:',
    `  provider: ${provider}`,
    '  region: eu-central-1',
    '  overall: SOVEREIGNTY_BLOCKED',
    '  sovereignty_statement: ok',
    '  items: []',
    '',
  ].join('\n'));
  writeFileSync(join(run, 'run-status.json'), JSON.stringify({
    schema_version: '1.0', assessment_type: 'landing-zone-catalog', app: 'demo', run_id: id,
    status: 'complete', started_at: '2026-10-11T00:00:00Z', swao_version: 'test',
  }));
  writeFileSync(join(appDir, 'wsp', 'latest-landing-zone-catalog.txt'), `runs/${id}`);
}

function lzChallenge(appDir: string, ts: string, concern: string, runId?: string): void {
  const dir = join(appDir, 'wsp', 'challenge-lz', ts);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'LZCA_lzca-ciso-security.yaml'), [
    'agent_id: lzca-ciso-security',
    'agent_role: CISO / Security',
    ...(runId ? ['challenged_run:', `  run_id: ${runId}`, '  assessment_type: landing-zone-catalog'] : []),
    'findings:',
    '  - id: LZCA-CISO-01',
    '    severity: HIGH',
    `    concern: ${concern}`,
    '',
  ].join('\n'));
}

describe('LZ report: challenge of the reported run only (#3330)', () => {
  it('a new LZ run after an older challenge does not show the older findings', () => {
    const appDir = appDirTmp();
    lzRun(appDir, R1, 'otc');
    lzChallenge(appDir, '2026-10-11T17-43-39', 'DEMO mode five targets');
    lzRun(appDir, R2, 'aws');
    const data = generateLzReport(appDir, 'demo');
    expect(data.challengeFindings).toEqual([]);
    expect(data.challengeOtherRunOmitted).toBe(true);
    const text = formatLzText(data);
    expect(text).not.toContain('DEMO mode five targets');
    expect(text).toContain('Stakeholder Challenge Findings: none for this run (challenge from another run not shown).');
    expect(formatLzYaml(data)).toContain('challenge_note: challenge from another run not shown');
    expect(buildLzReportDataStub(data).challengeFindings).toEqual([]);
  });

  it('two runs, two challenges: each report shows its own challenge, labelled', () => {
    const appDir = appDirTmp();
    lzRun(appDir, R1, 'otc');
    lzChallenge(appDir, '2026-10-11T17-43-39', 'old run concern', R1);
    lzRun(appDir, R2, 'aws');
    lzChallenge(appDir, '2026-10-18T13-00-00', 'new run concern', R2);
    // Reported run R2 (pointer): the R2 challenge.
    const d2 = generateLzReport(appDir, 'demo');
    const t2 = formatLzText(d2);
    expect(t2).toContain('new run concern');
    expect(t2).not.toContain('old run concern');
    expect(t2).toContain(`Source: challenge 2026-10-18T13-00-00 of run ${R2}`);
    expect(buildLzReportDataStub(d2).challengeSource).toBe(`challenge 2026-10-18T13-00-00 of run ${R2}`);
    // Point back at R1: the R1 challenge, even though a newer one exists.
    writeFileSync(join(appDir, 'wsp', 'latest-landing-zone-catalog.txt'), `runs/${R1}`);
    const t1 = formatLzText(generateLzReport(appDir, 'demo'));
    expect(t1).toContain('old run concern');
    expect(t1).not.toContain('new run concern');
    expect(t1).toContain(`Source: challenge 2026-10-11T17-43-39 of run ${R1}`);
  });

  it('a legacy challenge (no run id) made after the reported run is paired by timestamp', () => {
    const appDir = appDirTmp();
    lzRun(appDir, R2, 'aws');
    lzChallenge(appDir, '2026-10-18T13-00-00', 'legacy concern');
    const text = formatLzText(generateLzReport(appDir, 'demo'));
    expect(text).toContain('legacy concern');
    expect(text).toContain(`Source: challenge 2026-10-18T13-00-00 of run ${R2} (paired by timestamp)`);
  });

  it('no challenge at all keeps the original "none" line', () => {
    const appDir = appDirTmp();
    lzRun(appDir, R2, 'aws');
    expect(formatLzText(generateLzReport(appDir, 'demo')))
      .toContain('Stakeholder Challenge Findings: none. Run the LZ Sovereignty Challenge to generate.');
  });
});

function appRun(appDir: string, id: string): void {
  const run = join(appDir, 'wsp', 'runs', id);
  mkdirSync(join(run, 'passes'), { recursive: true });
  writeFileSync(join(run, 'wsp.yaml'), `assessed_at: "${id.slice(0, 10)}"\noverall: { seven_r_label: Rehost }\n`);
  writeFileSync(join(run, 'run-manifest.json'), JSON.stringify({ run_id: id }));
  writeFileSync(join(appDir, 'wsp', 'latest-application.txt'), `runs/${id}`);
}

function appChallenge(appDir: string, ts: string, concern: string, runId?: string): void {
  const dir = join(appDir, 'wsp', 'challenge-app', ts);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'AA_application-architect.yaml'), [
    'agent_id: application-architect',
    ...(runId ? ['challenged_run:', `  run_id: ${runId}`, '  assessment_type: application'] : []),
    'findings:',
    '  - id: AA-01',
    `    concern: ${concern}`,
    '',
  ].join('\n'));
}

describe('application report: challenge of the reported run only (#3330)', () => {
  it('two runs, two challenges: the report of R2 shows the R2 challenge, labelled', () => {
    const appDir = appDirTmp();
    appRun(appDir, R1);
    appChallenge(appDir, '2026-10-11T18-00-00', 'old app concern', R1);
    appRun(appDir, R2);
    appChallenge(appDir, '2026-10-18T13-00-00', 'new app concern', R2);
    const data = generateReport(appDir, 'demo');
    expect(data.challengeFindings?.[0]?.findings[0]?.concern).toBe('new app concern');
    expect(data.challengeSource).toBe(`challenge 2026-10-18T13-00-00 of run ${R2}`);
    expect(formatText(data)).toContain(`Challenge:     included (challenge 2026-10-18T13-00-00 of run ${R2})`);
  });

  it('a newer run without its own challenge does not reuse the older challenge', () => {
    const appDir = appDirTmp();
    appRun(appDir, R1);
    appChallenge(appDir, '2026-10-11T18-00-00', 'old app concern');
    appRun(appDir, R2);
    const data = generateReport(appDir, 'demo');
    expect(data.challengeFindings).toBeUndefined();
    expect(data.challengeStatus).toBe('not-run');
    expect(formatText(data)).toContain('Challenge:     not included (challenge from another run not shown)');
  });
});
