// #4244 / #4243 (Design 092 section 7.2a): the LLM Assessment leg preflight.
// The hosts check every leg command with `assess --preflight` in the main
// workspace before the orchestrator copies a leg workspace. No LLM is called:
// the leg spawns are fakes and the CLI preflight stops before any provider.
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { orchestrateLegs, type ResolvedLeg } from '@swao/module-llm-assessment';
import { createLegPreflight, legAssessArgs, preflightVerdict, LEG_PREFLIGHT_OK_MARKER, type PreflightRunner } from './llm-leg-preflight.js';
import { runAssessInProcess, sandboxLicence, type LicenceSandbox } from '../__tests__/helpers/in-process-assess.js';
import { useLegTempRoot } from '../__tests__/helpers/leg-temp-root.js';

// #4473: the failed legs keep their workspace; it goes with this file's temp root.
useLegTempRoot();

const here = dirname(fileURLToPath(import.meta.url));
const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

const LIVE_REFUSAL = '[error] --lz-source live: landing zone otc-prod has no usable live run (no live run); run swao assess --type landing-zone-live --lz otc-prod first';

describe('preflightVerdict (#4244)', () => {
  it('passes only on exit 0 with the marker', () => {
    expect(preflightVerdict({ exitCode: 0, output: `[info] x\n${LEG_PREFLIGHT_OK_MARKER} assess --app a can start` })).toEqual({ ok: true });
    // A coming-soon type also exits 0, without the marker.
    const noMarker = preflightVerdict({ exitCode: 0, output: '[assess] coming soon' });
    expect(noMarker.ok).toBe(false);
    expect(noMarker.reason).toContain('[assess] coming soon');
  });

  it('quotes the [error] lines, else the [warn] lines with the exit code, else the last lines', () => {
    expect(preflightVerdict({ exitCode: 1, output: `[info] Pass 10\n${LIVE_REFUSAL}\n` }).reason)
      .toBe('--lz-source live: landing zone otc-prod has no usable live run (no live run); run swao assess --type landing-zone-live --lz otc-prod first');
    const lock = preflightVerdict({ exitCode: 2, output: "[warn] An accepted run exists for 'a': r1\n       Accepted at: x\n" });
    expect(lock.reason).toBe("An accepted run exists for 'a': r1 (exit 2)");
    expect(preflightVerdict({ exitCode: 3, output: 'boom\n' }).reason).toBe('boom (exit 3)');
    expect(preflightVerdict({ exitCode: null, output: '' }).reason).toBe('the leg command exited null without output');
    expect(preflightVerdict({ exitCode: null, output: '', timedOut: true }).reason).toMatch(/did not finish its checks within 120 s/);
    expect(preflightVerdict({ exitCode: null, output: '', cancelled: true }).reason).toBe('cancelled');
  });

  it('redacts secret shapes in the reason (it goes to log.ndjson as it is)', () => {
    // Built at run time so the source holds no secret shape (secret-detection gate).
    const fakeKey = ['sk', 'ant', 'api03', 'A'.repeat(40)].join('-');
    const r = preflightVerdict({ exitCode: 1, output: `[error] token ${fakeKey} rejected\n` });
    expect(r.reason).not.toContain(fakeKey);
  });
});

describe('createLegPreflight (#4244)', () => {
  const leg: ResolvedLeg = { id: 'anthropic--m1', connector: 'anthropic', model: 'm1', primary: true, costSource: 'billed' };

  it('runs the leg argv plus --workspace and --preflight in the main workspace, bounded by a timeout', async () => {
    const calls: Array<{ argv: string[]; cwd: string; timeoutMs: number }> = [];
    const run: PreflightRunner = async (argv, o) => { calls.push({ argv, cwd: o.cwd, timeoutMs: o.timeoutMs }); return { exitCode: 0, output: `${LEG_PREFLIGHT_OK_MARKER} ok` }; };
    const pf = createLegPreflight({ workspaceRoot: '/ws', appId: 'app1', crawl: false, run });
    expect(await pf(leg)).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.argv).toEqual([...legAssessArgs('app1', leg, { crawl: false }), '--workspace', '/ws', '--preflight']);
    expect(calls[0]!.argv.slice(0, 7)).toEqual(['assess', '--app', 'app1', '--llm', 'anthropic:m1', '--no-cache', '--no-crawl']);
    expect(calls[0]!.cwd).toBe('/ws');
    expect(calls[0]!.timeoutMs).toBeGreaterThan(0);
  });

  it('refuses an unresolved ~alias model without starting a child', async () => {
    let started = 0;
    const pf = createLegPreflight({ workspaceRoot: '/ws', appId: 'app1', crawl: true, run: async () => { started++; return { exitCode: 0, output: LEG_PREFLIGHT_OK_MARKER }; } });
    const r = await pf({ ...leg, model: '~deepseek/deepseek-pro-latest' });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('is not resolved');
    expect(started).toBe(0);
  });
});

function legWorkspaceDirs(legId: string): string[] {
  const prefix = `swao-leg-${legId.replace(/[^a-z0-9-]/gi, '_')}-`;
  return readdirSync(tmpdir()).filter((d) => d.startsWith(prefix));
}

function orchestratorWs(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-pf-orch-'));
  tmp.push(ws);
  writeFileSync(join(ws, '.swao.yml'), 'name: demo\n', 'utf-8');
  mkdirSync(join(ws, 'apps', 'pf-app', 'src'), { recursive: true });
  writeFileSync(join(ws, 'apps', 'pf-app', '.swao.yml'), 'source:\n  path: ./src\n', 'utf-8');
  writeFileSync(join(ws, 'apps', 'pf-app', 'src', 'main.py'), 'print(1)\n', 'utf-8');
  return ws;
}

describe('orchestrateLegs with the host preflight (#4243 hook, #4244)', () => {
  const stamp = Date.now().toString(36);
  const legs: ResolvedLeg[] = [
    { id: `pfa${stamp}`, connector: 'anthropic', model: 'model-a', primary: true, costSource: 'billed' },
    { id: `pfb${stamp}`, connector: 'openrouter', model: 'model-b', primary: false, costSource: 'billed' },
  ];
  const base = { appId: 'pf-app', legs, execution: 'serial' as const, repeat: 1, weights: { quality: 1 }, keepLegWsp: false, passSuiteVersion: 'v158' };

  it('a failing preflight copies no leg workspace, spawns no leg and reports the real reason', async () => {
    const ws = orchestratorWs();
    const spawned: string[] = [];
    const progress: string[] = [];
    const result = await orchestrateLegs({
      ...base, workspaceRoot: ws,
      onProgress: (m) => progress.push(m),
      preflightLeg: createLegPreflight({ workspaceRoot: ws, appId: 'pf-app', crawl: true, run: async () => ({ exitCode: 1, output: `[info] Pass 10\n${LIVE_REFUSAL}\n` }) }),
      spawnLeg: async (leg) => { spawned.push(leg.id); return { exitCode: 0, durationMs: 1 }; },
    });
    expect(spawned).toEqual([]);
    for (const l of legs) expect(legWorkspaceDirs(l.id)).toEqual([]);
    expect(result.status).toBe('failed');
    expect(result.legs.map((l) => l.status)).toEqual(['failed', 'failed']);
    expect(result.legs[0]!.reason).toContain('preflight failed: --lz-source live: landing zone otc-prod has no usable live run');
    const log = readFileSync(join(result.runDir, 'log.ndjson'), 'utf-8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as { code: string; message: string });
    const failed = log.filter((l) => l.code === 'leg.preflight.failed');
    expect(failed).toHaveLength(2);
    expect(failed[0]!.message).toContain('no usable live run');
    expect(log.some((l) => l.code === 'leg.prepare.start')).toBe(false);
    expect(progress.join('\n')).toContain('no usable live run');
  });

  it('a passing preflight proceeds to the copy and the leg spawn', async () => {
    const ws = orchestratorWs();
    const spawned: string[] = [];
    const checked: string[] = [];
    const result = await orchestrateLegs({
      ...base, workspaceRoot: ws,
      preflightLeg: createLegPreflight({ workspaceRoot: ws, appId: 'pf-app', crawl: true, run: async (argv) => { checked.push(argv[4]!); return { exitCode: 0, output: `${LEG_PREFLIGHT_OK_MARKER} assess --app pf-app can start` }; } }),
      spawnLeg: async (leg) => { spawned.push(leg.id); return { exitCode: 0, durationMs: 1 }; },
    });
    expect(checked).toEqual(['anthropic:model-a', 'openrouter:model-b']);
    expect(spawned).toEqual(legs.map((l) => l.id));
    const log = readFileSync(join(result.runDir, 'log.ndjson'), 'utf-8');
    expect(log).toContain('leg.prepare.start');
    expect(log).not.toContain('leg.preflight.failed');
  });
});

// The CLI side: `assess --preflight` runs the checks of `assess --app` that come
// before the run folder (lane B2 moved every invalid LZ source setup there) and
// stops without creating wsp/runs, cloning or writing a Pass 10 start event.
describe('swao assess --preflight, in-process with a sandboxed licence (#4244)', () => {
  let sandbox: LicenceSandbox | undefined;
  afterEach(() => { sandbox?.restore(); sandbox = undefined; });

  function workspace(appYml: string[] = ['source:', '  path: ./src']): string {
    const ws = mkdtempSync(join(tmpdir(), 'swao-assess-preflight-'));
    tmp.push(ws);
    writeFileSync(join(ws, '.swao.yml'), ['name: demo', 'landing_zones:', '  - id: otc-prod', '    provider: otc', '    scopes:', '      - id: app-pay', '        kind: application', '        auth: iam-password-token', '        app: payments', ''].join('\n'));
    mkdirSync(join(ws, 'apps', 'payments', 'src'), { recursive: true });
    writeFileSync(join(ws, 'apps', 'payments', '.swao.yml'), [...appYml, ''].join('\n'));
    writeFileSync(join(ws, 'apps', 'payments', 'src', 'main.py'), 'print(1)\n');
    return ws;
  }
  const preflight = (ws: string, extra: string[] = []) => runAssessInProcess(['--workspace', ws, '--app', 'payments', '--llm', 'anthropic:claude-sonnet-4-6', '--no-cache', '--no-crawl', ...extra, '--preflight']);
  const appLog = (ws: string): string => {
    const dir = join(ws, 'apps', 'payments', 'wsp', 'logs');
    return existsSync(dir) ? readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf-8')).join('\n') : '';
  };

  it('a valid leg command passes with the marker; no run folder, no Pass 10 start; the linked app gets the catalogue warning', async () => {
    sandbox = sandboxLicence('enterprise');
    const ws = workspace();
    const r = await preflight(ws);
    expect(r.threw).toBeUndefined();
    expect(r.code, r.out.slice(-3000)).toBe(0);
    expect(r.out).toContain(`${LEG_PREFLIGHT_OK_MARKER} assess --app payments can start`);
    expect(r.out).toContain('[warn] live landing-zone data is used only by the Landing Zone Live Assessment');
    expect(r.out).not.toContain('no usable live run');
    expect(preflightVerdict({ exitCode: r.code, output: r.out })).toEqual({ ok: true });
    expect(existsSync(join(ws, 'apps', 'payments', 'wsp', 'runs'))).toBe(false);
    expect(appLog(ws)).not.toContain('dynamic.start');
  }, 200_000);

  it('an explicit --lz-source live stops with the #4244 refusal as the reason', async () => {
    sandbox = sandboxLicence('enterprise');
    const ws = workspace();
    const r = await preflight(ws, ['--lz-source', 'live']);
    expect(r.code).toBe(1);
    const v = preflightVerdict({ exitCode: r.code, output: r.out });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('--lz-source live is retired for app assessments');
    expect(existsSync(join(ws, 'apps', 'payments', 'wsp', 'runs'))).toBe(false);
  }, 200_000);

  it('an unknown connector, an accepted-run lock and a non-application type fail with their reason', async () => {
    sandbox = sandboxLicence('enterprise');
    const ws = workspace();
    const c = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--llm', 'no-such-connector:m', '--preflight']);
    expect(c.code).toBe(1);
    expect(preflightVerdict({ exitCode: c.code, output: c.out }).reason).toContain('LLM connector "no-such-connector" is not known');

    mkdirSync(join(ws, 'apps', 'payments', 'wsp'), { recursive: true });
    writeFileSync(join(ws, 'apps', 'payments', 'wsp', 'accepted-run.json'), JSON.stringify({ run_id: 'runs/2026-11-01T10-00-00', accepted_at: '2026-11-01T11:00:00Z' }));
    const lock = await preflight(ws);
    expect(lock.code).toBe(2);
    expect(preflightVerdict({ exitCode: lock.code, output: lock.out }).reason).toContain('An accepted run exists');
    rmSync(join(ws, 'apps', 'payments', 'wsp', 'accepted-run.json'));

    const lzWs = workspace(['source:', '  path: ./src', 'assessment:', '  type: landing-zone-catalog']);
    const t = await preflight(lzWs);
    expect(t.code).toBe(1);
    expect(preflightVerdict({ exitCode: t.code, output: t.out }).reason).toContain('would run a landing-zone-catalog assessment');
    expect(existsSync(join(lzWs, 'apps', 'payments', 'wsp', 'runs'))).toBe(false);
  }, 300_000);

  it('does not clone: a missing source with source.vcs.url passes with a note; without a url it fails', async () => {
    sandbox = sandboxLicence('enterprise');
    const withUrl = workspace(['source:', '  path: wsp/inputs/source', '  vcs:', '    url: https://example.invalid/org/repo.git']);
    const a = await preflight(withUrl);
    expect(a.code, a.out.slice(-2000)).toBe(0);
    expect(a.out).toContain('[info] preflight: the source is not present; the leg clones it from source.vcs.url');
    expect(existsSync(join(withUrl, 'apps', 'payments', 'wsp', 'inputs', 'source'))).toBe(false);

    const noUrl = workspace(['source:', '  path: ./missing']);
    const b = await preflight(noUrl);
    expect(b.code).toBe(1);
    expect(preflightVerdict({ exitCode: b.code, output: b.out }).reason).toContain('Source directory has no file to assess');
  }, 300_000);
});

describe('both hosts wire the preflight (#4244)', () => {
  it('the CLI LLM branch and the TUI running hook pass preflightLeg and share the leg argv', () => {
    const cli = readFileSync(join(here, 'assess.ts'), 'utf-8');
    const tui = readFileSync(join(here, '..', 'tui', 'screens', 'llm-assess', 'hooks', 'useLlmRunning.ts'), 'utf-8');
    // #4470: both hosts start the leg through the one shared helper, which builds the leg argv.
    const spawnHelper = readFileSync(join(here, 'llm-leg-spawn.ts'), 'utf-8');
    for (const src of [cli, tui]) {
      expect(src).toMatch(/preflightLeg: createLegPreflight\(/);
      expect(src).toMatch(/spawnLegProcess\(\{/);
    }
    expect(spawnHelper).toMatch(/selfSpawnCommand\(\s*legAssessArgs\(/);
    expect(tui).toContain('signal: abort.signal }');
  });
});
