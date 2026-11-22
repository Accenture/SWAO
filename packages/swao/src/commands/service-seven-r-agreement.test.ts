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

// #4287 (D-9): one service run, one 7R verdict across the synthesis pass,
// wsp.yaml, apm-score.json and portfolio-summary.json (the publication hub and
// the per-app publication read the last three). Runs the post-run order of
// `swao assess`: alignServiceRunSevenR, derivePlanForRun, buildPortfolioSummary.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump, load } from 'js-yaml';
import { alignServiceRunSevenR, buildPortfolioSummary } from '@swao/module-service-assessment';
import { derivePlanForRun } from '@swao/module-app-assessment';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const NOW = new Date('2026-11-09T15:16:00Z');
const RUN = '2026-11-09T15-14-37';

/** A service app with a KEV match (TIME Migrate-Critical) and a finished run whose synthesis said `synth`. */
function fixture(synth: string): { ws: string; appDir: string; runDir: string } {
  const ws = mkdtempSync(join(tmpdir(), 'swao-4287-'));
  dirs.push(ws);
  writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\nengagement:\n  name: Fixture Engagement\n');
  const appDir = join(ws, 'apps', 'app0153-macmon');
  const research = join(appDir, 'wsp', 'inputs', 'research');
  mkdirSync(research, { recursive: true });
  writeFileSync(join(appDir, '.swao.yml'), dump({ app_id: 'app0153-macmon', app_name: 'macmon', assessment: { type: 'service', regimes_active: ['SWAO_APM'] }, vendor: { name: 'Example Vendor' }, disposition: { operational_status: 'active' } }));
  writeFileSync(join(research, 'cve-summary.md'), `---\n${dump({ topic: 'cve-summary', cve: { source: 'nvd', critical_count: 2, high_count: 1, kev_match: true } })}---\n`);
  writeFileSync(join(research, 'eol-status.md'), `---\n${dump({ topic: 'eol-status', eol: { source: 'endoflife.date', is_eol: false, months_until_eol: 30 } })}---\n`);
  const runDir = join(appDir, 'wsp', 'runs', RUN);
  mkdirSync(join(runDir, 'passes'), { recursive: true });
  writeFileSync(join(runDir, 'passes', '09-synth.yaml'), dump({
    pass: { id: 9, name: 'synthesis', signal_prefix: 'SYNTH', status: 'complete' },
    signals: [],
    assessment: { seven_r_label: synth, modernization_position: 'migrate_stabilize', migration_rationale: 'Fixture rationale.', coverage_score: 0.5 },
  }));
  writeFileSync(join(runDir, 'run-manifest.json'), JSON.stringify({ assessed_at: NOW.toISOString() }));
  writeFileSync(join(appDir, 'wsp', 'latest-service.txt'), `runs/${RUN}`);
  return { ws, appDir, runDir };
}

function verdicts(ws: string, appDir: string, runDir: string) {
  alignServiceRunSevenR(ws, 'app0153-macmon', runDir, { now: NOW });
  derivePlanForRun(ws, appDir, runDir, 'app0153-macmon', RUN, NOW.toISOString());
  const summary = buildPortfolioSummary(ws, { now: NOW, apmScoreFor: 'app0153-macmon' });
  const entry = summary.apps.find((a) => a.id === 'app0153-macmon')!;
  const apm = JSON.parse(readFileSync(join(runDir, 'apm-score.json'), 'utf-8')) as Record<string, unknown>;
  const spine = load(readFileSync(join(runDir, 'wsp.yaml'), 'utf-8')) as { overall?: Record<string, unknown> };
  const synth = load(readFileSync(join(runDir, 'passes', '09-synth.yaml'), 'utf-8')) as { assessment: Record<string, unknown> };
  const onDisk = JSON.parse(readFileSync(join(ws, 'wsp', 'portfolio-summary.json'), 'utf-8')) as { apps: Array<Record<string, unknown>> };
  return {
    time: entry.time_quadrant,
    labels: {
      synthesis_pass: synth.assessment['seven_r_label'],
      wsp_yaml: spine.overall?.['seven_r_label'],
      apm_score: apm['seven_r_label'],
      portfolio_summary: onDisk.apps.find((a) => a['id'] === 'app0153-macmon')!['seven_r_label'],
    },
    sources: { synthesis_pass: synth.assessment['seven_r_source'], apm_score: apm['seven_r_source'], portfolio_summary: entry.seven_r_source },
    kept: { synthesis_pass: synth.assessment['seven_r_synthesis'], apm_score: apm['seven_r_synthesis'], portfolio_summary: entry.seven_r_synthesis },
  };
}

describe('one 7R verdict per service run across all artefacts (#4287)', () => {
  it('synthesis Replatform with TIME Migrate-Critical: Replatform everywhere, source synthesis', () => {
    const { ws, appDir, runDir } = fixture('Replatform');
    const v = verdicts(ws, appDir, runDir);
    expect(v.time).toBe('Migrate-Critical');
    expect(v.labels).toEqual({ synthesis_pass: 'Replatform', wsp_yaml: 'Replatform', apm_score: 'Replatform', portfolio_summary: 'Replatform' });
    expect(v.sources).toEqual({ synthesis_pass: 'synthesis', apm_score: 'synthesis', portfolio_summary: 'synthesis' });
    expect(v.kept).toEqual({ synthesis_pass: undefined, apm_score: undefined, portfolio_summary: undefined });
  });

  it('synthesis Refactor contradicts TIME Migrate-Critical: Rehost everywhere, the synthesis verdict kept', () => {
    const { ws, appDir, runDir } = fixture('Refactor');
    const v = verdicts(ws, appDir, runDir);
    expect(v.labels).toEqual({ synthesis_pass: 'Rehost', wsp_yaml: 'Rehost', apm_score: 'Rehost', portfolio_summary: 'Rehost' });
    expect(v.sources).toEqual({ synthesis_pass: 'derived_from_time', apm_score: 'derived_from_time', portfolio_summary: 'derived_from_time' });
    expect(v.kept).toEqual({ synthesis_pass: 'Refactor', apm_score: 'Refactor', portfolio_summary: 'Refactor' });
  });

  it('the alignment is idempotent (a second post-run sees the kept model verdict)', () => {
    const { ws, runDir } = fixture('Refactor');
    alignServiceRunSevenR(ws, 'app0153-macmon', runDir, { now: NOW });
    const second = alignServiceRunSevenR(ws, 'app0153-macmon', runDir, { now: NOW });
    expect(second).toMatchObject({ label: 'Rehost', synthesis: 'Refactor', changed: false });
  });
});
