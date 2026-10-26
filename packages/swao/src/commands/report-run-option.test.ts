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

// #3343: `swao report --type landing-zone-catalog --run <id>` honours --run
// (data, challenge pairing, output file name); an unknown run exits 1.
// #3343 follow-up: the FinOps and Migration views read every LZ catalogue fit
// of the run (single-target and multi-target file names).
// #3345: the challenge header note depends on the licence.
// #3346: `swao report --app <id> --run <id>` reports that application run; the
// challenge note names the required tier (Community and Consultant alike) and
// no Enterprise-only hint is shown below Enterprise.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Command } from 'commander';
import { generateLzReport, formatLzText, resolveLzRunDirById, LzRunNotFoundError } from './report-lz.js';
import {
  generateReport, formatText, formatViewFinops, formatViewMigrationManager,
  lzReportFilePrefix, applyChallengeLicence, registerReport, type ReportDeps,
  resolveAppRunDirById, formatViewAuditor, formatViewCompliance, CHALLENGE_NOT_LICENSED_NOTE,
} from './report.js';
import { RunNotFoundError } from './report-lz.js';
import { buildAuditorReport } from './auditor-report-schema.js';

const R1 = '2026-10-18T21-36-25';
const R2 = '2026-10-18T21-38-42';
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
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
    status: 'complete', started_at: '2026-10-18T00:00:00Z', swao_version: 'test',
  }));
  writeFileSync(join(appDir, 'wsp', 'latest-landing-zone-catalog.txt'), `runs/${id}`);
}

function lzChallenge(appDir: string, ts: string, concern: string, runId: string): void {
  const dir = join(appDir, 'wsp', 'challenge-lz', ts);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'LZCA_lzca-ciso-security.yaml'), [
    'agent_id: lzca-ciso-security',
    'agent_role: CISO / Security',
    'challenged_run:',
    `  run_id: ${runId}`,
    '  assessment_type: landing-zone-catalog',
    'findings:',
    '  - id: LZCA-CISO-01',
    '    severity: HIGH',
    `    concern: ${concern}`,
    '',
  ].join('\n'));
}

/** Two LZ runs; the challenge is paired with the older one (R1); R2 is latest. */
function twoRunsChallengeOnOlder(appDir: string): void {
  lzRun(appDir, R1, 'otc');
  lzChallenge(appDir, '2026-10-18T21-36-57', 'older run concern', R1);
  lzRun(appDir, R2, 'aws');
}

describe('generateLzReport honours a run id (#3343)', () => {
  it('--run <older> includes the paired challenge; the latest run omits it', () => {
    const appDir = tmp('swao-lz-run-');
    twoRunsChallengeOnOlder(appDir);

    const older = formatLzText(generateLzReport(appDir, 'demo', R1));
    expect(older).toContain('older run concern');
    expect(older).toContain(`Source: challenge 2026-10-18T21-36-57 of run ${R1}`);

    const latest = formatLzText(generateLzReport(appDir, 'demo'));
    expect(latest).not.toContain('older run concern');
    expect(latest).toContain('none for this run (challenge from another run not shown)');
  });

  it('accepts runs/<id> as well as <id>', () => {
    const appDir = tmp('swao-lz-run-');
    twoRunsChallengeOnOlder(appDir);
    expect(generateLzReport(appDir, 'demo', `runs/${R1}`).targets[0]?.provider).toBe('otc');
  });

  it.each([
    ['2026-01-01T00-00-00', 'not found'],
    ['../../etc', 'Invalid --run'],
    ['latest', 'Invalid --run'],
  ])('rejects %s with LzRunNotFoundError (%s)', (id, msg) => {
    const appDir = tmp('swao-lz-run-');
    twoRunsChallengeOnOlder(appDir);
    expect(() => resolveLzRunDirById(join(appDir, 'wsp'), id)).toThrow(LzRunNotFoundError);
    expect(() => resolveLzRunDirById(join(appDir, 'wsp'), id)).toThrow(msg);
  });

  it('rejects an application run id', () => {
    const appDir = tmp('swao-lz-run-');
    const run = join(appDir, 'wsp', 'runs', R1);
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, 'run-status.json'), JSON.stringify({
      schema_version: '1.0', assessment_type: 'application', app: 'demo', run_id: R1,
      status: 'complete', started_at: '2026-10-18T00:00:00Z', swao_version: 'test',
    }));
    expect(() => resolveLzRunDirById(join(appDir, 'wsp'), R1)).toThrow('not a landing-zone-catalog run');
  });

  it('the output file prefix follows --run, else the latest pointer', () => {
    const appDir = tmp('swao-lz-run-');
    twoRunsChallengeOnOlder(appDir);
    const wspDir = join(appDir, 'wsp');
    expect(lzReportFilePrefix(wspDir, R1)).toBe(`${R1}-`);
    expect(lzReportFilePrefix(wspDir)).toBe(`${R2}-`);
    expect(lzReportFilePrefix(join(appDir, 'nowhere'))).toBe('');
  });
});

describe('swao report --type landing-zone-catalog --run (#3343, command level)', () => {
  async function runReport(args: string[]): Promise<{ exitCode: number | undefined; err: string }> {
    const program = new Command('swao').exitOverride();
    registerReport(program, {} as ReportDeps);
    let exitCode: number | undefined;
    const err: string[] = [];
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { exitCode = code; throw new Error('exit'); }) as typeof process.exit);
    const cerr = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { err.push(a.join(' ')); });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await program.parseAsync(['report', ...args], { from: 'user' });
    } catch { /* exit sentinel */ } finally {
      exit.mockRestore(); cerr.mockRestore(); log.mockRestore();
    }
    return { exitCode, err: err.join('\n') };
  }

  function workspace(): { ws: string; appDir: string } {
    const ws = tmp('swao-lz-run-ws-');
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\n');
    const appDir = join(ws, 'apps', 'demo');
    mkdirSync(appDir, { recursive: true });
    twoRunsChallengeOnOlder(appDir);
    return { ws, appDir };
  }

  it('an unknown --run exits 1 with a clear message and writes no report', async () => {
    const { ws, appDir } = workspace();
    const r = await runReport(['--workspace', ws, '--app', 'demo', '--type', 'landing-zone-catalog', '--run', '2026-01-01T00-00-00']);
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain("[error] Run '2026-01-01T00-00-00' not found");
    expect(existsSync(join(appDir, 'wsp', 'reports-lz'))).toBe(false);
  });

  it('--run <older> writes the older run report, with its challenge, under the older run file name', async () => {
    const { ws, appDir } = workspace();
    const r = await runReport(['--workspace', ws, '--app', 'demo', '--type', 'landing-zone-catalog', '--run', R1]);
    expect(r.exitCode ?? 0).toBe(0);
    const out = join(appDir, 'wsp', 'reports-lz', `${R1}-lz-report.txt`);
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out, 'utf-8')).toContain('older run concern');
  });
});

describe('FinOps and Migration views read every LZ catalogue fit (#3343 follow-up, #3342 helper)', () => {
  function appRunWithFits(files: Record<string, string>): string {
    const appDir = tmp('swao-lz-catfit-');
    const run = join(appDir, 'wsp', 'runs', R1);
    mkdirSync(join(run, 'passes'), { recursive: true });
    writeFileSync(join(run, 'wsp.yaml'), `assessed_at: "${R1.slice(0, 10)}"\noverall: { seven_r_label: Rehost }\n`);
    writeFileSync(join(run, 'run-manifest.json'), JSON.stringify({ run_id: R1 }));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(run, name), body);
    writeFileSync(join(appDir, 'wsp', 'latest-application.txt'), `runs/${R1}`);
    return appDir;
  }

  it('multi-target: one target line per lz-catalogue-fit-<p>-<r>.yaml', () => {
    const appDir = appRunWithFits({
      'lz-catalogue-fit-aws-eu-central-1.yaml': 'provider: aws\nregion: eu-central-1\noverall: SOVEREIGNTY_BLOCKED\n',
      'lz-catalogue-fit-stackit-eu01.yaml': 'provider: stackit\nregion: eu01\noverall: FIT\n',
    });
    const data = generateReport(appDir, 'demo');
    const wspDir = join(appDir, 'wsp');
    const finops = formatViewFinops(data, wspDir);
    expect(finops).toContain('Target landing zone: aws / eu-central-1');
    expect(finops).toContain('Target landing zone: stackit / eu01');
    expect(finops).toContain('Verdict:           FIT');
    const pm = formatViewMigrationManager(data, wspDir);
    expect(pm).toContain('aws / eu-central-1 (SOVEREIGNTY_BLOCKED)');
    expect(pm).toContain('stackit / eu01 (FIT)');
  });

  it('single-target lz-catalogue-fit.yaml still shows', () => {
    const appDir = appRunWithFits({ 'lz-catalogue-fit.yaml': 'provider: otc\nregion: eu-de\noverall: FIT\n' });
    const finops = formatViewFinops(generateReport(appDir, 'demo'), join(appDir, 'wsp'));
    expect(finops).toContain('Target landing zone: otc / eu-de');
  });
});

describe('challenge header note depends on the licence (#3345)', () => {
  function appWithoutChallenge(): string {
    const appDir = tmp('swao-challenge-note-');
    const run = join(appDir, 'wsp', 'runs', R1);
    mkdirSync(join(run, 'passes'), { recursive: true });
    writeFileSync(join(run, 'wsp.yaml'), `assessed_at: "${R1.slice(0, 10)}"\noverall: { seven_r_label: Rehost }\n`);
    writeFileSync(join(run, 'run-manifest.json'), JSON.stringify({ run_id: R1 }));
    writeFileSync(join(appDir, 'wsp', 'latest-application.txt'), `runs/${R1}`);
    return appDir;
  }

  it('Community and Consultant (challenge not licensed): the note names the required tier, not the edition (#3346)', () => {
    const data = applyChallengeLicence(generateReport(appWithoutChallenge(), 'demo'), false);
    expect(data.challengeStatus).toBe('not-available');
    const text = formatText(data);
    expect(CHALLENGE_NOT_LICENSED_NOTE).toBe('Stakeholder Challenge requires Enterprise');
    expect(text).toContain('Challenge:     not included (Stakeholder Challenge requires Enterprise)');
    expect(text).not.toContain('Community Edition');
    expect(text).not.toContain('swao challenge');
  });

  it('below Enterprise a leftover challenge folder shows no Enterprise-only hint (#3346)', () => {
    const appDir = appWithoutChallenge();
    mkdirSync(join(appDir, 'wsp', 'challenge-app'), { recursive: true });
    const raw = generateReport(appDir, 'demo');
    expect(raw.challengeStatus).toBe('not-run');
    const data = applyChallengeLicence(raw, false);
    expect(data.challengeStatus).toBe('not-available');
    const text = formatText(data);
    expect(text).toContain(`Challenge:     not included (${CHALLENGE_NOT_LICENSED_NOTE})`);
    expect(text).not.toContain('Run the Stakeholder Challenge');
    expect(text).not.toContain('no challenge run found');
  });

  it('below Enterprise a challenge of another run is not offered as an Enterprise action either (#3346)', () => {
    const data = applyChallengeLicence(
      { ...generateReport(appWithoutChallenge(), 'demo'), challengeStatus: 'not-run' as const, challengeOtherRunOmitted: true },
      false,
    );
    expect(data.challengeStatus).toBe('not-available');
    expect(data.challengeOtherRunOmitted).toBeUndefined();
    expect(formatText(data)).not.toContain('swao challenge');
  });

  it('Enterprise (challenge licensed): says no challenge has been run and how to run it', () => {
    const data = applyChallengeLicence(generateReport(appWithoutChallenge(), 'demo'), true);
    expect(data.challengeStatus).toBe('not-run');
    const text = formatText(data);
    expect(text).toContain('Challenge:     not included (no challenge run found for this app)');
    // #3446: the exact command (from @swao/core challengeCommand).
    expect(text).toContain('Run the Stakeholder Challenge (`swao challenge --all-agents --app demo');
    expect(text).not.toContain('Community Edition');
  });

  it('an included challenge is left untouched on either tier', () => {
    const base = { ...generateReport(appWithoutChallenge(), 'demo'), challengeStatus: 'included' as const };
    expect(applyChallengeLicence(base, true).challengeStatus).toBe('included');
    expect(applyChallengeLicence(base, false).challengeStatus).toBe('included');
  });
});

// ---------------------------------------------------------------------------
// #3346: --run for application reports
// ---------------------------------------------------------------------------

/** One application run with its own 7R label, one signal and one control. */
function appRun(appDir: string, id: string, label: string, signalId: string): void {
  const run = join(appDir, 'wsp', 'runs', id);
  mkdirSync(join(run, 'passes'), { recursive: true });
  writeFileSync(join(run, 'wsp.yaml'), `assessed_at: "${id.slice(0, 10)}"\noverall: { seven_r_label: ${label} }\n`);
  writeFileSync(join(run, 'run-manifest.json'), JSON.stringify({ run_id: id }));
  writeFileSync(join(run, 'passes', '01-static.yaml'), [
    'signals:',
    `  - id: ${signalId}`,
    '    severity: high',
    '    outcome: negative',
    '    derivation: derivation text long enough to count',
    '',
  ].join('\n'));
  writeFileSync(join(run, 'wsp-plan.yaml'), [
    'compliance:',
    '  regimes:',
    `    - id: REGIME_${label.toUpperCase()}`,
    `      name: REG_${label.toUpperCase()}`,
    '      controls:',
    '        - id: C-1',
    '          outcome: gap',
    '',
  ].join('\n'));
  writeFileSync(join(run, 'run-status.json'), JSON.stringify({
    schema_version: '1.0', assessment_type: 'application', app: 'demo', run_id: id,
    status: 'complete', started_at: '2026-10-18T00:00:00Z', swao_version: 'test',
  }));
  writeFileSync(join(appDir, 'wsp', 'latest-application.txt'), `runs/${id}`);
  writeFileSync(join(appDir, 'wsp', 'latest.txt'), `runs/${id}`);
}

/** R1 (Rehost, SIG-OLD) and R2 (Refactor, SIG-NEW); R2 is the latest run. */
function twoAppRuns(appDir: string): void {
  appRun(appDir, R1, 'Rehost', 'SIG-OLD');
  appRun(appDir, R2, 'Refactor', 'SIG-NEW');
}

describe('generateReport honours a run id (#3346)', () => {
  it('--run <older> reports the older run; without it the latest run', () => {
    const appDir = tmp('swao-app-run-');
    twoAppRuns(appDir);
    expect(generateReport(appDir, 'demo', R1).sevenRLabel).toBe('Rehost');
    expect(generateReport(appDir, 'demo', `runs/${R1}`).sevenRLabel).toBe('Rehost');
    expect(generateReport(appDir, 'demo').sevenRLabel).toBe('Refactor');
  });

  it('the auditor view and the structured auditor payload read the selected run', () => {
    const appDir = tmp('swao-app-run-');
    twoAppRuns(appDir);
    const wspDir = join(appDir, 'wsp');
    const runDir = resolveAppRunDirById(wspDir, R1);
    const data = generateReport(appDir, 'demo', R1);
    const view = formatViewAuditor(data, wspDir, runDir);
    expect(view).toContain('SIG-OLD');
    expect(view).not.toContain('SIG-NEW');
    const payload = JSON.stringify(buildAuditorReport(data, wspDir, runDir));
    expect(payload).toContain('SIG-OLD');
    expect(payload).toContain('REGIME_REHOST');
    expect(payload).not.toContain('SIG-NEW');
  });

  it('the plan-based compliance view reads the selected run', () => {
    const appDir = tmp('swao-app-run-');
    twoAppRuns(appDir);
    const wspDir = join(appDir, 'wsp');
    const runDir = resolveAppRunDirById(wspDir, R1);
    const view = formatViewCompliance(generateReport(appDir, 'demo', R1), wspDir, runDir);
    expect(view).toContain('REG_REHOST');
    expect(view).not.toContain('REG_REFACTOR');
    expect(formatViewCompliance(generateReport(appDir, 'demo'), wspDir)).toContain('REG_REFACTOR');
  });

  it.each([
    ['2026-01-01T00-00-00', 'not found'],
    ['../../etc', 'Invalid --run'],
  ])('rejects %s with RunNotFoundError (%s)', (id, msg) => {
    const appDir = tmp('swao-app-run-');
    twoAppRuns(appDir);
    expect(() => resolveAppRunDirById(join(appDir, 'wsp'), id)).toThrow(RunNotFoundError);
    expect(() => generateReport(appDir, 'demo', id)).toThrow(msg);
  });

  it('rejects a landing-zone-catalog run id', () => {
    const appDir = tmp('swao-app-run-');
    lzRun(appDir, R1, 'otc');
    expect(() => resolveAppRunDirById(join(appDir, 'wsp'), R1)).toThrow('not an application run');
  });
});

describe('swao report --app <id> --run (#3346, command level)', () => {
  async function runReport(args: string[]): Promise<{ exitCode: number | undefined; err: string }> {
    const program = new Command('swao').exitOverride();
    registerReport(program, {} as ReportDeps);
    let exitCode: number | undefined;
    const err: string[] = [];
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { exitCode = code; throw new Error('exit'); }) as typeof process.exit);
    const cerr = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { err.push(a.join(' ')); });
    const cwarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await program.parseAsync(['report', ...args], { from: 'user' });
    } catch { /* exit sentinel */ } finally {
      exit.mockRestore(); cerr.mockRestore(); cwarn.mockRestore(); log.mockRestore();
    }
    return { exitCode, err: err.join('\n') };
  }

  function workspace(): { ws: string; appDir: string } {
    const ws = tmp('swao-app-run-ws-');
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\n');
    const appDir = join(ws, 'apps', 'demo');
    mkdirSync(appDir, { recursive: true });
    twoAppRuns(appDir);
    // Only latest-application.txt: with --run the report still auto-saves to wsp/reports-app/.
    rmSync(join(appDir, 'wsp', 'latest.txt'));
    return { ws, appDir };
  }

  it('--run <older> writes the older run report under the older run file name', async () => {
    const { ws, appDir } = workspace();
    const r = await runReport(['--workspace', ws, '--app', 'demo', '--run', R1]);
    expect(r.exitCode ?? 0).toBe(0);
    const out = join(appDir, 'wsp', 'reports-app', `${R1}-technical.txt`);
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out, 'utf-8')).toContain('7R Label:      Rehost');
  });

  it('--view auditor --run <older> reads the older run passes', async () => {
    const { ws, appDir } = workspace();
    const r = await runReport(['--workspace', ws, '--app', 'demo', '--view', 'auditor', '--run', R1]);
    expect(r.exitCode ?? 0).toBe(0);
    const out = readFileSync(join(appDir, 'wsp', 'reports-app', `${R1}-auditor.txt`), 'utf-8');
    expect(out).toContain('SIG-OLD');
    expect(out).not.toContain('SIG-NEW');
  });

  it('an unknown --run exits 1 with a clear message and writes no report', async () => {
    const { ws, appDir } = workspace();
    const r = await runReport(['--workspace', ws, '--app', 'demo', '--run', '2026-01-01T00-00-00']);
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain("[error] Run '2026-01-01T00-00-00' not found");
    expect(existsSync(join(appDir, 'wsp', 'reports-app'))).toBe(false);
  });

  it('a landing-zone-catalog run id exits 1 for an application report', async () => {
    const { ws, appDir } = workspace();
    lzRun(appDir, '2026-10-18T22-00-00', 'otc');
    const r = await runReport(['--workspace', ws, '--app', 'demo', '--run', '2026-10-18T22-00-00']);
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain('not an application run');
    expect(existsSync(join(appDir, 'wsp', 'reports-app'))).toBe(false);
  });
});
