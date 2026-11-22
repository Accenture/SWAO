// #4256 (TUI-12): the Application Assessment finish screen on FinishPanel:
// the real run folder (never <ts>), the pass count, the block and LZ fit
// verdicts, What next as menu entries, no letter keys and no double dash.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appFinishGuidance, appFinishView, blockVerdictSummary, failedRunGuidance, failedRunView, readAppRunFolder, readLzFitVerdicts, type AppFinishInput } from './app-finish.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function ws(): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-app-finish-'));
  dirs.push(d);
  return d;
}

const BASE: AppFinishInput = {
  app: 'sovereign-health', typeLabel: 'Application Assessment', totalPasses: 14, passesLabel: 'all', passFiles: 14,
  llm: 'ollama', skipLlm: false, runFolder: 'apps/sovereign-health/wsp/runs/2026-11-10T08-53-21/',
  lzFit: [{ target: 'otc/eu-de', verdict: 'NEEDS_VERIFICATION' }], blockVerdicts: { iam: 'PARTIAL', dr: 'SATISFACTORY' },
  degradedPasses: [], skippedPassGroups: [], detailLines: [], logAvailable: true, challenge: 'offer',
};

describe('readAppRunFolder (#4256)', () => {
  it('reads latest-application.txt, then latest.txt, then the newest run folder', () => {
    const d = ws();
    const wsp = join(d, 'apps', 'sovereign-health', 'wsp');
    mkdirSync(join(wsp, 'runs', '2026-11-10T08-53-21'), { recursive: true });
    mkdirSync(join(wsp, 'runs', '2026-11-11T09-00-00'), { recursive: true });
    expect(readAppRunFolder(d, 'sovereign-health')).toBe('apps/sovereign-health/wsp/runs/2026-11-11T09-00-00/');
    writeFileSync(join(wsp, 'latest.txt'), 'runs/2026-11-10T08-53-21\n');
    expect(readAppRunFolder(d, 'sovereign-health')).toBe('apps/sovereign-health/wsp/runs/2026-11-10T08-53-21/');
    writeFileSync(join(wsp, 'latest-application.txt'), 'runs/2026-11-11T09-00-00');
    expect(readAppRunFolder(d, 'sovereign-health')).toBe('apps/sovereign-health/wsp/runs/2026-11-11T09-00-00/');
    expect(readAppRunFolder(d, 'missing')).toBeNull();
    expect(readAppRunFolder(null, 'sovereign-health')).toBeNull();
  });
});

describe('readLzFitVerdicts (#4256)', () => {
  it('reads provider, region and overall of every lz-catalogue-fit file of the run', () => {
    const d = ws();
    const run = 'apps/a/wsp/runs/r1/';
    mkdirSync(join(d, run), { recursive: true });
    writeFileSync(join(d, run, 'lz-catalogue-fit-otc-eu-de.yaml'), 'provider: otc\nregion: eu-de\noverall: NEEDS_VERIFICATION\n');
    writeFileSync(join(d, run, 'lz-catalogue-fit-stackit-eu01.yaml'), 'provider: stackit\nregion: eu01\noverall: READY\n');
    writeFileSync(join(d, run, 'lz-catalogue-fit-broken.yaml'), 'items: []\n');
    expect(readLzFitVerdicts(d, run)).toEqual([
      { target: 'otc/eu-de', verdict: 'NEEDS_VERIFICATION' },
      { target: 'stackit/eu01', verdict: 'READY' },
    ]);
    expect(readLzFitVerdicts(d, null)).toEqual([]);
  });
});

describe('appFinishView (#4256)', () => {
  it('short rows with the real run folder, the LZ fit and the blocks; What next as entries', () => {
    const v = appFinishView(BASE);
    expect(v.title).toBe('Application Assessment complete');
    expect(v.level).toBe('ok');
    expect(v.rows).toEqual([
      { label: 'App', value: 'sovereign-health' },
      { label: 'Passes', value: '14 (all), 14 pass results written' },
      { label: 'LLM', value: 'ollama' },
      { label: 'Blocks', value: '1 satisfactory, 1 partial' },
      { label: 'LZ fit', value: 'otc/eu-de NEEDS_VERIFICATION' },
      { label: 'Outputs', value: 'apps/sovereign-health/wsp/runs/2026-11-10T08-53-21/ (passes/ inside)' },
    ]);
    expect(v.next.map((n) => n.label)).toEqual(['Stakeholder Challenge', 'Show details', 'View the log']);
    const all = JSON.stringify(v);
    expect(all).not.toMatch(/<ts>|<latest>|wsp\/passes\/ \+| -- /);
  });

  it('degraded and skipped passes are warn items; no challenge entry without an LLM or a licence', () => {
    const v = appFinishView({ ...BASE, skipLlm: true, challenge: 'no-llm', degradedPasses: ['data', 'synth'], skippedPassGroups: [{ passes: 'dynamic (10)', reason: 'Playwright not installed' }], logAvailable: false, blockVerdicts: {} });
    expect(v.level).toBe('warn');
    expect(v.rows.find((r) => r.label === 'LLM')?.value).toBe('deterministic only (no LLM)');
    expect(v.items.map((i) => i.label)).toEqual(['Degraded', 'Skipped']);
    expect(v.next).toEqual([]);
    expect(appFinishView({ ...BASE, challenge: 'not-licensed' }).next.map((n) => n.value)).toEqual(['details', 'log']);
  });

  it('the guidance names the next steps in words, no menu numbers, the CLI last', () => {
    const g = appFinishGuidance({ ...BASE, challenge: 'no-llm' });
    expect(g.what).toContain('needs an LLM');
    expect(g.what).toContain('Publish writes the HTML report');
    expect(g.what).not.toMatch(/\(4\)|\(6\)| -- /);
    expect(g.cli).toBe('swao publish --app sovereign-health');
    expect(blockVerdictSummary({ a: 'NOT_ASSESSED' })).toBe('1 not assessed');
  });
});

describe('failedRunView (#4256)', () => {
  it('level fail with App and exit code; View the log only when a log exists', () => {
    const v = failedRunView('Landing Zone Catalog Assessment', 'sovereign-health', 2, true);
    expect(v).toEqual({
      title: 'Landing Zone Catalog Assessment failed', level: 'fail',
      rows: [{ label: 'App', value: 'sovereign-health' }, { label: 'Exit code', value: '2' }],
      next: [{ label: 'View the log', value: 'log' }],
    });
    expect(failedRunView('Application Assessment', 'a', null, false).next).toEqual([]);
    expect(failedRunView('Application Assessment', 'a', null, false).rows[1]!.value).toBe('unknown');
  });
});

describe('failedRunGuidance (#4256)', () => {
  const base = { typeLabel: 'Application Assessment', app: 'sovereign-health', code: 1, logPath: null as string | null };

  it('a clone failure names the common causes; a GitHub tree URL names the fix', () => {
    const clone = failedRunGuidance({ ...base, lastLines: '[error] git clone failed: repository not found' });
    expect(clone.title).toBe('Application Assessment failed');
    expect(clone.what).toContain('git clone failed before any pass ran');
    const tree = failedRunGuidance({ ...base, lastLines: '[error] git clone failed for https://github.com/x/y/tree/main/app' });
    expect(tree.what).toContain('GitHub tree view URL');
  });

  it('a failed pass shows its advice, else the default text; exit code and log path as sections, the CLI last', () => {
    const advice = failedRunGuidance({ ...base, lastLines: '[error] Pass synthesis failed', failedPassAdvice: 'Run synthesis alone.' });
    expect(advice.what).toBe('Run synthesis alone.');
    const plain = failedRunGuidance({ ...base, code: null, lastLines: '', logPath: 'apps/sovereign-health/wsp/runs/2026-11-12T10-00-00/assess.log' });
    expect(plain.what).toContain('run the failed pass alone from the Passes step');
    expect(plain.sections).toEqual([{ label: 'Exit code', text: 'unknown' }, { label: 'Log', text: 'apps/sovereign-health/wsp/runs/2026-11-12T10-00-00/assess.log' }]);
    expect(plain.cli).toBe('swao log tail --level error');
    expect(JSON.stringify(plain)).not.toMatch(/ -- |<ts>|<app>/);
  });
});
