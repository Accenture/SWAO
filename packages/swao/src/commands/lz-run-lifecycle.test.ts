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

// #3223 / #3245: every exit path of an LZ Catalog Assessment closes the event
// sequence and leaves a run-status.json marker in the run dir.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { join } from 'path';
import { createLzRunLifecycle, runLzProviderFits, regionHint, LZ_RUN_STATUS_FILE, LZ_VALID_REGION_HINT_CAP, type LzTarget, type LzRunStatusMarker } from './lz-run-lifecycle.js';

interface Ev { scope: 'app' | 'portfolio'; level: string; code: string; context: Record<string, unknown> }

const TARGETS: LzTarget[] = [
  { provider: 'aws', region: 'eu-central-1' },
  { provider: 'azure', region: 'Europe' },
  { provider: 'stackit', region: 'eu01' },
];

describe('LZ run lifecycle (#3223, #3245)', () => {
  let root: string;
  let runDir: string;
  let events: Ev[];
  let logApp: (app: string, level: string, code: string, msg: string, o?: { context?: Record<string, unknown> }) => void;
  let logPortfolio: (level: string, code: string, msg: string, o?: { context?: Record<string, unknown> }) => void;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'swao-lz-lifecycle-'));
    runDir = join(root, 'wsp', 'runs', '2026-10-17T10-00-00');
    mkdirSync(join(runDir, 'passes'), { recursive: true });
    events = [];
    logApp = (_app, level, code, _msg, o) => { events.push({ scope: 'app', level, code, context: o?.context ?? {} }); };
    logPortfolio = (level, code, _msg, o) => { events.push({ scope: 'portfolio', level, code, context: o?.context ?? {} }); };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  const make = () => createLzRunLifecycle({
    app: 'sovereign-health', runDir, startedAt: new Date('2026-10-17T10:00:00.000Z'), targets: TARGETS, swaoVersion: '1.4.0',
    logApp: logApp as never, logPortfolio: logPortfolio as never,
  });
  const marker = (): LzRunStatusMarker => JSON.parse(readFileSync(join(runDir, LZ_RUN_STATUS_FILE), 'utf-8')) as LzRunStatusMarker;
  const codes = (scope: 'app' | 'portfolio') => events.filter(e => e.scope === scope).map(e => e.code);

  it('markStarted writes run-status.json with status started', () => {
    make().markStarted();
    const m = marker();
    expect(m.status).toBe('started');
    expect(m.assessment_type).toBe('landing-zone-catalog');
    expect(m.targets).toEqual(['aws:eu-central-1', 'azure:Europe', 'stackit:eu01']);
    expect(m.finished_at).toBeUndefined();
  });

  it('one throwing target is logged and skipped; the loop continues with the remaining targets (owner decision 2026-10-17)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = runLzProviderFits({
      app: 'sovereign-health', targets: TARGETS,
      logApp: logApp as never, logPortfolio: logPortfolio as never,
      fit: (t) => {
        if (t.provider === 'azure') throw new Error('injected provider failure');
        return { ok: true, value: t.provider, overall: 'BLOCKED' };
      },
    });
    expect(res.results.map(r => r.value)).toEqual(['aws', 'stackit']);
    expect(res.failures).toEqual([{ provider: 'azure', region: 'Europe', reason: 'injected provider failure' }]);

    // aws completed, azure started then errored, stackit still ran; the loop never closes the run.
    const seq = [
      'lz.assessment.provider.start', 'lz.assessment.provider.complete',
      'lz.assessment.provider.start', 'lz.assessment.provider.error',
      'lz.assessment.provider.start', 'lz.assessment.provider.complete',
    ];
    expect(codes('portfolio')).toEqual(seq);
    expect(codes('app')).toEqual(seq);
    const provErr = events.find(e => e.scope === 'portfolio' && e.code === 'lz.assessment.provider.error')!;
    expect(provErr.level).toBe('error');
    expect(provErr.context).toMatchObject({ provider: 'azure', region: 'Europe', error: 'injected provider failure' });
    expect(warn.mock.calls.some(c => String(c[0]).startsWith('[warning] LZ target azure:Europe failed'))).toBe(true);
  });

  it('unknown region: provider.error carries a capped valid-region hint, similar ids first', () => {
    const valid = ['attatlanta1', 'eastus', 'germanywestcentral', 'northeurope', 'westeurope', 'uksouth',
      'eastus2', 'westus', 'westus2', 'westus3', 'centralus', 'japaneast', 'koreacentral'];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = runLzProviderFits({
      app: 'sovereign-health', targets: TARGETS,
      logApp: logApp as never, logPortfolio: logPortfolio as never,
      fit: (t) => t.region === 'Europe'
        ? { ok: false, error: `Region "Europe" not found in the azure catalogue. Available: ${valid.join(', ')}.`, validRegions: valid }
        : { ok: true, value: 1, overall: 'READY' },
    });
    expect(res.results).toHaveLength(2);
    expect(res.failures[0]!.reason).toBe('Region "Europe" not found in the azure catalogue.');
    const provErr = events.find(e => e.scope === 'app' && e.code === 'lz.assessment.provider.error')!;
    const hint = provErr.context['valid_regions'] as string[];
    expect(hint).toHaveLength(LZ_VALID_REGION_HINT_CAP);
    expect(hint.slice(0, 2)).toEqual(['northeurope', 'westeurope']);
    expect(provErr.context['valid_region_count']).toBe(valid.length);
    const line = String(warn.mock.calls.find(c => String(c[0]).startsWith('[warning]'))![0]);
    expect(line).toContain('Valid regions include: northeurope, westeurope');
    expect(line).not.toContain('Available:');
    expect(regionHint('x', ['a', 'b'], 1)).toEqual(['a']);
  });

  it('one bad + one good target: complete(failedTargets) writes a partial marker with failed_targets', () => {
    const lc = make();
    lc.markStarted();
    const res = runLzProviderFits({
      app: 'sovereign-health', targets: TARGETS.slice(0, 2),
      logApp: logApp as never, logPortfolio: logPortfolio as never,
      fit: (t) => t.provider === 'azure' ? { ok: false, error: 'bad region' } : { ok: true, value: 1, overall: 'READY' },
    });
    expect(res.results).toHaveLength(1);
    lc.complete(res.failures);
    const m = marker();
    expect(m.status).toBe('partial');
    expect(m.exit_code).toBe(0);
    expect(m.failed_targets).toEqual([{ provider: 'azure', region: 'Europe', reason: 'bad region' }]);
    expect(codes('portfolio')).not.toContain('lz.assessment.error');
  });

  it('all targets failing: fail() with failedTargets closes the run as failed (exit 1) without re-emitting provider.error', () => {
    const lc = make();
    lc.markStarted();
    const res = runLzProviderFits({
      app: 'sovereign-health', targets: TARGETS,
      logApp: logApp as never, logPortfolio: logPortfolio as never,
      fit: (t) => { throw new Error(`boom ${t.provider}`); },
    });
    expect(res.results).toHaveLength(0);
    expect(res.failures).toHaveLength(3);
    lc.fail({ status: 'failed', reason: 'All 3 LZ target(s) failed', exitCode: 1, failedTargets: res.failures });

    expect(codes('portfolio').filter(c => c === 'lz.assessment.provider.error')).toHaveLength(3);
    expect(codes('portfolio').slice(-3)).toEqual(['lz.assessment.error', 'lz.assessment.complete', 'swao.run.complete']);
    expect(codes('app').slice(-2)).toEqual(['lz.assessment.error', 'lz.assessment.complete']);
    const runComplete = events.find(e => e.code === 'swao.run.complete')!;
    expect(runComplete.level).toBe('error');
    expect(runComplete.context).toMatchObject({ type: 'lz-catalog', status: 'error', exit_code: 1 });
    expect((runComplete.context['failed_targets'] as unknown[])).toHaveLength(3);

    const m = marker();
    expect(m.status).toBe('failed');
    expect(m.exit_code).toBe(1);
    expect(m.failed_targets!.map(f => f.provider)).toEqual(['aws', 'azure', 'stackit']);
    expect(m.finished_at).toBeDefined();
    // Completion-only artefacts are never written for a failed run (#1023).
    expect(existsSync(join(runDir, 'run-manifest.json'))).toBe(false);
    expect(existsSync(join(root, 'wsp', 'latest-landing-zone-catalog.txt'))).toBe(false);
  });

  it('a post-fit failure with target (schema validation path) emits provider.error and lists it in failed_targets', () => {
    const lc = make();
    lc.fail({ status: 'failed', reason: 'LZ fit output failed schema validation', exitCode: 1, target: TARGETS[0] });
    expect(codes('portfolio')[0]).toBe('lz.assessment.provider.error');
    expect(marker().failed_targets).toEqual([{ provider: 'aws', region: 'eu-central-1', reason: 'LZ fit output failed schema validation' }]);
  });

  it('a clean loop emits start/complete per target and complete() marks the run complete', () => {
    const lc = make();
    lc.markStarted();
    const res = runLzProviderFits({
      app: 'sovereign-health', targets: TARGETS,
      logApp: logApp as never, logPortfolio: logPortfolio as never,
      fit: (t) => ({ ok: true, value: t.region, overall: 'READY' }),
    });
    expect(res.results.map(r => r.value)).toEqual(['eu-central-1', 'Europe', 'eu01']);
    expect(res.failures).toEqual([]);
    expect(codes('portfolio').filter(c => c === 'lz.assessment.provider.complete')).toHaveLength(3);
    expect(codes('portfolio')).not.toContain('lz.assessment.error');
    lc.complete(res.failures);
    const m = marker();
    expect(m).toMatchObject({ status: 'complete', exit_code: 0 });
    expect(m.failed_targets).toBeUndefined();
  });

  it('closing is idempotent: a second fail() or complete() emits nothing and keeps the first marker', () => {
    const lc = make();
    lc.fail({ status: 'failed', reason: 'first', exitCode: 1 });
    const n = events.length;
    lc.fail({ status: 'aborted', reason: 'second', exitCode: 130 });
    lc.complete();
    expect(events.length).toBe(n);
    expect(lc.closed).toBe(true);
    expect(marker()).toMatchObject({ status: 'failed', reason: 'first' });
  });

  it('process guards: SIGINT aborts with exit 130; uncaughtException fails with exit 1; dispose removes listeners', () => {
    const handlers = new Map<string, (arg?: unknown) => void>();
    const proc = {
      once: vi.fn((ev: string, fn: (arg?: unknown) => void) => { handlers.set(ev, fn); return proc; }),
      on: vi.fn((ev: string, fn: (arg?: unknown) => void) => { handlers.set(ev, fn); return proc; }),
      prependOnceListener: vi.fn((ev: string, fn: (arg?: unknown) => void) => { handlers.set(ev, fn); return proc; }),
      removeListener: vi.fn((ev: string) => { handlers.delete(ev); return proc; }),
      exit: vi.fn(),
    };
    const lc = createLzRunLifecycle({
      app: 'sovereign-health', runDir, startedAt: new Date(), targets: TARGETS, swaoVersion: '1.4.0',
      logApp: logApp as never, logPortfolio: logPortfolio as never, proc: proc as never,
    });
    lc.installProcessGuards();
    expect(proc.prependOnceListener).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
    handlers.get('SIGINT')!();
    expect(proc.exit).toHaveBeenCalledWith(130);
    expect(marker()).toMatchObject({ status: 'aborted', exit_code: 130, reason: 'SIGINT' });
    const runComplete = events.find(e => e.code === 'swao.run.complete')!;
    expect(runComplete.context).toMatchObject({ status: 'aborted', exit_code: 130 });
    // fail() disposed the guards.
    expect(handlers.size).toBe(0);

    // Fresh lifecycle: uncaught exception path.
    events.length = 0;
    const lc2 = createLzRunLifecycle({
      app: 'sovereign-health', runDir, startedAt: new Date(), targets: TARGETS, swaoVersion: '1.4.0',
      logApp: logApp as never, logPortfolio: logPortfolio as never, proc: proc as never,
    });
    lc2.installProcessGuards();
    handlers.get('uncaughtException')!(new Error('boom'));
    expect(proc.exit).toHaveBeenLastCalledWith(1);
    expect(marker()).toMatchObject({ status: 'failed', exit_code: 1, reason: 'uncaught: boom' });
    expect(events.map(e => e.code)).toContain('swao.run.complete');
  });
});

// End-to-end through the CLI (dist-backed, skipped when dist is not built):
// the real assess.ts LZ block with an unknown region next to a valid one.
// #3281: `azure:Europe` is now a known geography (it resolves to the default
// region of the shared geography model), so the failing target is `azure:Atlantis`.
const CLI = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'dist', 'index.js');

describe.skipIf(!existsSync(CLI))('swao assess --type landing-zone-catalog with a failing target (#3223, #3245)', () => {
  let ws: string;
  const appDir = () => join(ws, 'apps', 'demo');
  const assessLz = (targets?: string) => spawnSync(process.execPath, [
    CLI, 'assess', '--app', 'demo', '--workspace', ws, '--type', 'landing-zone-catalog', ...(targets ? ['--lz-cat-targets', targets] : []),
  ], { cwd: ws, encoding: 'utf-8', timeout: 120_000, env: { ...process.env, SWAO_LICENSE_TIER_OVERRIDE: 'community' } });
  const newestRun = () => {
    const runs = join(appDir(), 'wsp', 'runs');
    return join(runs, readdirSync(runs).sort().reverse()[0]!);
  };
  const appEvents = () => {
    const logs = join(appDir(), 'wsp', 'logs');
    return readdirSync(logs).filter(f => f.startsWith('app-events-'))
      .flatMap(f => readFileSync(join(logs, f), 'utf-8').split('\n').filter(Boolean))
      .map(l => JSON.parse(l) as { level: string; code: string; context?: Record<string, unknown> });
  };

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'swao-lz-partial-'));
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\n');
    mkdirSync(appDir(), { recursive: true });
    writeFileSync(join(appDir(), '.swao.yml'), 'wsp_version: "0.9"\napp_id: demo\n');
  });
  afterEach(() => { rmSync(ws, { recursive: true, force: true }); });

  it('one bad + one good target: exit 0, artefacts for the good target, partial marker and events', () => {
    const r = assessLz('aws:eu-central-1,azure:Atlantis');
    expect(r.status).toBe(0);
    expect(r.stderr + r.stdout).toContain('[warning] LZ target azure:Atlantis failed');
    const run = newestRun();
    expect(existsSync(join(run, 'lz-catalogue-fit-aws-eu-central-1.yaml'))).toBe(true);
    expect(existsSync(join(run, 'passes', 'lz-fit-aws-eu-central-1.yaml'))).toBe(true);
    expect(readdirSync(run).some(f => f.includes('azure'))).toBe(false);
    expect(existsSync(join(run, 'run-manifest.json'))).toBe(true);
    const m = JSON.parse(readFileSync(join(run, LZ_RUN_STATUS_FILE), 'utf-8')) as LzRunStatusMarker;
    expect(m.status).toBe('partial');
    expect(m.failed_targets!.map(f => `${f.provider}:${f.region}`)).toEqual(['azure:Atlantis']);
    const ev = appEvents();
    const provErr = ev.find(e => e.code === 'lz.assessment.provider.error')!;
    expect(provErr.level).toBe('error');
    expect((provErr.context!['valid_regions'] as string[]).length).toBeGreaterThan(0);
    const done = ev.filter(e => e.code === 'lz.assessment.complete').pop()!;
    expect(done.context).toMatchObject({ status: 'partial', exit_code: 0 });
  }, 130_000);

  it('all targets bad: exit 1, failed marker, no manifest', () => {
    const r = assessLz('azure:Atlantis');
    expect(r.status).toBe(1);
    const run = newestRun();
    expect(existsSync(join(run, 'run-manifest.json'))).toBe(false);
    const m = JSON.parse(readFileSync(join(run, LZ_RUN_STATUS_FILE), 'utf-8')) as LzRunStatusMarker;
    expect(m).toMatchObject({ status: 'failed', exit_code: 1 });
    expect(m.failed_targets).toHaveLength(1);
    const done = appEvents().filter(e => e.code === 'lz.assessment.complete').pop()!;
    expect(done.context).toMatchObject({ status: 'error', exit_code: 1 });
  }, 130_000);

  it('#3281: azure:Europe resolves to the default region, logged as info and recorded in the marker', () => {
    const r = assessLz('azure:Europe');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[info] LZ target azure:Europe names a geography; using the default region azure:germanywestcentral');
    const run = newestRun();
    expect(existsSync(join(run, 'passes', 'lz-fit.yaml'))).toBe(true);
    const m = JSON.parse(readFileSync(join(run, LZ_RUN_STATUS_FILE), 'utf-8')) as LzRunStatusMarker;
    expect(m).toMatchObject({ status: 'complete', targets: ['azure:germanywestcentral'] });
    expect(m.resolved_targets).toEqual([{ requested: 'azure:Europe', resolved: 'azure:germanywestcentral', geography: 'europe' }]);
    const info = appEvents().find(e => e.code === 'lz.assessment.target.resolved')!;
    expect(info.level).toBe('info');
    expect(info.context).toMatchObject({ provider: 'azure', requested_region: 'Europe', resolved_region: 'germanywestcentral' });
  }, 130_000);

  it('#3281: targets from assessment.landing_zone.targets (app .swao.yml, then workspace) without a CLI flag', () => {
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\nassessment:\n  landing_zone:\n    targets: [stackit:eu01]\n');
    assessLz();
    let m = JSON.parse(readFileSync(join(newestRun(), LZ_RUN_STATUS_FILE), 'utf-8')) as LzRunStatusMarker;
    expect(m.targets).toEqual(['stackit:eu01']);
    writeFileSync(join(appDir(), '.swao.yml'), 'wsp_version: "0.9"\napp_id: demo\nassessment:\n  landing_zone:\n    targets:\n      - aws:eu-central-1\n      - otc:eu-de\n');
    // A second run in the same second would reuse the run dir name; wait for the next second.
    const t0 = Date.now(); while (Date.now() - t0 < 1100) { /* spin */ }
    const r = assessLz();
    expect(r.status).toBe(0);
    m = JSON.parse(readFileSync(join(newestRun(), LZ_RUN_STATUS_FILE), 'utf-8')) as LzRunStatusMarker;
    expect(m.targets).toEqual(['aws:eu-central-1', 'otc:eu-de']);
    // --lz-cat-targets winning over the config is pinned by @swao/core lz-targets.test.ts.
  }, 300_000);
});
