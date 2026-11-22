// #3887 (Design 123 section 8.4): `swao assess --app <id>` resolves the LZ
// evidence source before any pass runs. #4244 (owner decision 2026-11-09): live
// landing-zone data is used only by the LZ Live Assessment, so an app run always
// uses the static LZ catalogue; a linked app is warned about, --lz-source live is
// refused. The selection order is pinned in core lz-source.test.ts.
import { describe, it, expect, afterEach } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';
import { sandboxEnv } from '../__tests__/helpers/injected-licence.js';
import { runAssessInProcess, sandboxLicence, type LicenceSandbox } from '../__tests__/helpers/in-process-assess.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', '..', 'dist', 'index.js');
const SHIPPED_BASELINE = join(here, '..', '..', '..', '@swao', 'community-frameworks', 'frameworks', 'client-lz-policy-baseline');
const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

function workspace(o: { regions?: string[]; appTargets?: string[] } = {}): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-assess-lzsrc-'));
  tmp.push(ws);
  writeFileSync(join(ws, '.swao.yml'), ['name: demo', 'landing_zones:', '  - id: otc-prod', '    provider: otc', '    scopes:', '      - id: app-pay', '        kind: application', '        auth: iam-password-token', '        app: payments',
    ...(o.regions ? [`        regions: [${o.regions.join(', ')}]`] : []), ''].join('\n'));
  mkdirSync(join(ws, 'apps', 'payments', 'src'), { recursive: true });
  writeFileSync(join(ws, 'apps', 'payments', '.swao.yml'), ['source:', '  path: ./src',
    ...(o.appTargets ? ['assessment:', '  landing_zone:', '    targets:', ...o.appTargets.map((t) => `      - ${t}`)] : []), ''].join('\n'));
  writeFileSync(join(ws, 'apps', 'payments', 'src', 'main.py'), 'print(1)\n');
  return ws;
}

function run(args: string[], ws: string, env: NodeJS.ProcessEnv = { ...process.env, SWAO_LICENSE_TIER_OVERRIDE: 'enterprise' }): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, [cli, 'assess', '--workspace', ws, '--app', 'payments', '--skip-llm', ...args], {
    encoding: 'utf-8', cwd: ws, env, timeout: 120_000,
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe.skipIf(!existsSync(cli))('swao assess --app --lz-source, compiled CLI (#3887, #4244)', () => {
  it('refuses --lz-source live, an unknown source and --lz with exit 1 before any pass, pointing to the LZ Live Assessment', () => {
    const ws = workspace();
    const a = run(['--lz-source', 'stream'], ws);
    expect(a.code).toBe(1);
    expect(a.out).toContain('--lz-source must be catalogue');
    const b = run(['--lz', 'otc-prod'], ws);
    expect(b.code).toBe(1);
    expect(b.out).toContain('select a live landing zone for swao assess --type landing-zone-live');
    const c = run(['--lz-source', 'live', '--lz', 'otc-prod'], ws);
    expect(c.code).toBe(1);
    expect(c.out).toContain('--lz-source live is retired for app assessments');
    expect(c.out).not.toContain('[LICENSE]');
    expect(existsSync(join(ws, 'apps', 'payments', 'wsp', 'runs'))).toBe(false);
  }, 200_000);

  it('Community: a linked app is assessed against the catalogue with the warning, exit 0', () => {
    const ws = workspace();
    const home = mkdtempSync(join(tmpdir(), 'swao-lzsrc-home-'));
    tmp.push(home);
    const b = run(['--passes', 'inv'], ws, sandboxEnv(home));
    expect(b.out).not.toContain('[LICENSE]');
    expect(b.out).toContain('[warn] live landing-zone data is used only by the Landing Zone Live Assessment; nothing was assessed against the static LZ catalogue');
    expect(b.code, b.out).toBe(0);
  }, 300_000);
});

// #4244 (owner decision 2026-11-09): the reproduction of the issue. An app
// linked to a live landing zone without a live run made every assess --app exit
// 1 (also both LLM Assessment legs); now the app is assessed against the static
// catalogue with a warning on every tier, recorded in run-context.yaml, and an
// explicit --lz-source live is refused with exit 1 (no [LICENSE] block).
describe('swao assess --app, linked app, in-process with a sandboxed licence (#3980, #4244)', () => {
  let sandbox: LicenceSandbox | undefined;
  afterEach(() => { sandbox?.restore(); sandbox = undefined; });

  function runContext(ws: string): string {
    const wsp = join(ws, 'apps', 'payments', 'wsp');
    return readFileSync(join(wsp, readFileSync(join(wsp, 'latest.txt'), 'utf-8').trim(), 'run-context.yaml'), 'utf-8');
  }
  const count = (out: string, needle: string): number => out.split(needle).length - 1;

  for (const tier of ['consultant', 'community'] as const) {
    it(`${tier}: a linked app without a live run is assessed against the catalogue with one warning naming the link and the fix, exit 0; run-context.yaml records lz_source catalogue and the reason; targets seeded from the scope regions`, async () => {
      sandbox = sandboxLicence(tier);
      const ws = workspace({ regions: ['eu-de'] });
      const r = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--passes', 'inv']);
      expect(r.threw).toBeUndefined();
      expect(r.code, r.out.slice(-3000)).toBe(0);
      expect(r.out).not.toContain('[LICENSE]');
      expect(r.out).not.toContain('no usable live run');
      expect(count(r.out, '[warn] live landing-zone data is used only by the Landing Zone Live Assessment; assessed against the static LZ catalogue')).toBe(1);
      expect(r.out).toContain('app payments is linked in .swao.yml: landing zone otc-prod, scope app-pay; targets otc/eu-de seeded from landing_zones[].scopes[].regions in .swao.yml; for live results: swao assess --type landing-zone-live --lz otc-prod');
      const ctx = runContext(ws);
      expect(ctx).toContain('lz_source: catalogue');
      expect(ctx).toContain('reason: lz-live-assessment-only');
      expect(ctx).toContain('lz_id: otc-prod');
      expect(ctx).toContain('linked: landing zone otc-prod, scope app-pay');
      expect(ctx).not.toContain('required_tier');
      expect(ctx).not.toContain('current_tier');
      expect(ctx).toMatch(/lz_targets:\n\s+- otc\/eu-de/);
      expect(ctx).toMatch(/seeded_targets:\n\s+- otc\/eu-de/);
      expect(ctx).toContain('seed_source: swao-yml-scope-regions');
      expect(ctx).not.toContain('lz_live:');
    }, 200_000);

    it(`${tier}: an explicit --lz-source live is refused with exit 1 before any pass, pointing to the LZ Live Assessment`, async () => {
      sandbox = sandboxLicence(tier);
      const ws = workspace();
      const r = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--lz-source', 'live']);
      expect(r.threw).toBeUndefined();
      expect(r.code, r.out.slice(-3000)).toBe(1);
      expect(r.out).toContain('[error] --lz-source live is retired for app assessments: live landing-zone data is used only by the Landing Zone Live Assessment (swao assess --type landing-zone-live --lz <lz-id>)');
      expect(r.out).not.toContain('[LICENSE]');
      expect(r.out).not.toContain('[info] Running Pass');
      expect(existsSync(join(ws, 'apps', 'payments', 'wsp', 'runs'))).toBe(false);
    }, 200_000);
  }

  it('Consultant: a live run of the linked landing zone is not read (no live fit, no seed from its regions in use)', async () => {
    sandbox = sandboxLicence('consultant');
    const ws = workspace();
    const runDir = join(ws, 'landing-zones', 'otc-prod', 'wsp', 'runs', '2026-11-06T08-00-00');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'lz-live-merged.yaml'), JSON.stringify({
      lz_id: 'otc-prod', provider: 'otc', merged_at: '2026-11-06T08:00:00Z', window_days: 7,
      scopes: [{ scope_id: 'app-pay', status: 'merged', observed_at: '2026-11-06T08:00:00Z' }],
      offering: { regions: [{ id: 'eu-nl', status: 'enabled' }], services: [] },
      estate: { resources: [{ id: 'vm-1', type: 'ecs', region: 'eu-nl', seen_by: ['app-pay'] }] },
    }));
    writeFileSync(join(ws, 'landing-zones', 'otc-prod', 'wsp', 'latest-lz-live.txt'), '2026-11-06T08-00-00');
    const r = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--passes', 'inv']);
    expect(r.code, r.out.slice(-3000)).toBe(0);
    expect(r.out).not.toContain('LZ source: live');
    expect(r.out).not.toContain('seeded from the regions in use');
    expect(count(r.out, '[warn] live landing-zone data is used only by the Landing Zone Live Assessment; nothing was assessed against the static LZ catalogue')).toBe(1);
    const ctx = runContext(ws);
    expect(ctx).toContain('no_targets: true');
    expect(ctx).not.toContain('lz_live:');
    expect(ctx).not.toContain('2026-11-06T08-00-00');
  }, 200_000);

  it('#4006: Pass 11 decides the baseline controls against the seeded targets, as the inline fit does', async () => {
    sandbox = sandboxLicence('community');
    const ws = workspace({ regions: ['eu-de', 'eu-nl'] });
    cpSync(SHIPPED_BASELINE, join(ws, 'wsp', 'inputs', 'catalogs', 'community', 'client-lz-policy-baseline'), { recursive: true });
    writeFileSync(join(ws, 'apps', 'payments', '.swao.yml'), ['source:', '  path: ./src', 'assessment:', '  regimes_active: [CLIENT_LZ_POLICY_BASELINE]', ''].join('\n'));
    // --skip-llm removes COMP, so the run has no LLM provider instead: the baseline controls are rule-engine decisions anyway.
    const llmEnv = process.env['SWAO_LLM_PROVIDER'];
    delete process.env['SWAO_LLM_PROVIDER'];
    const r = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--passes', 'inv,comp']).finally(() => { if (llmEnv !== undefined) process.env['SWAO_LLM_PROVIDER'] = llmEnv; });
    expect(r.code, r.out.slice(-3000)).toBe(0);
    expect(r.out).toContain('targets otc/eu-de, otc/eu-nl seeded from landing_zones[].scopes[].regions in .swao.yml');
    const wsp = join(ws, 'apps', 'payments', 'wsp');
    const d = JSON.parse(readFileSync(join(wsp, readFileSync(join(wsp, 'latest.txt'), 'utf-8').trim(), 'baseline-decisions.json'), 'utf-8')) as { source: string; reason?: string; regimes: Record<string, Record<string, { outcome: string; contributions?: { target?: string }[] }>> };
    expect(d.source, d.reason).toBe('catalogue');
    const decisions = Object.values(d.regimes['CLIENT_LZ_POLICY_BASELINE'] ?? {});
    expect(decisions.length).toBeGreaterThan(0);
    // per-target contributions name exactly the seeded targets
    const ranked = decisions.filter((x) => (x.contributions ?? []).length === 2);
    expect(ranked.length).toBeGreaterThan(0);
    expect(new Set(ranked.flatMap((x) => (x.contributions ?? []).map((c) => c.target)))).toEqual(new Set(['otc/eu-de', 'otc/eu-nl']));
    // not every control is UNKNOWN (#4006: 20 of 20 UNKNOWN before)
    expect(decisions.some((x) => x.outcome !== 'UNKNOWN')).toBe(true);
  }, 300_000);

  it('#4007: --lz-cat-targets takes the printed provider/region form; an entry that is no target is refused with exit 1 before any pass', async () => {
    sandbox = sandboxLicence('community');
    const ws = workspace();
    const r = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--passes', 'inv', '--lz-source', 'catalogue', '--lz-cat-targets', 'otc/eu-de,otc/eu-nl']);
    expect(r.code, r.out.slice(-3000)).toBe(0);
    expect(runContext(ws)).toMatch(/lz_targets:\n\s+- otc\/eu-de\n\s+- otc\/eu-nl/);
    const bad = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--passes', 'inv', '--lz-source', 'catalogue', '--lz-cat-targets', 'otc:eu-de,otc-eu-nl']);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('[error] --lz-cat-targets: "otc-eu-nl" is not a target; use provider:region (or provider/region)');
    expect(bad.out).not.toContain('[info] Running Pass');
  }, 300_000);

  it('#4009: --frameworks on an app run is refused with exit 1 before any pass (an app selects frameworks in its .swao.yml), as the MCP tool refuses it', async () => {
    sandbox = sandboxLicence('community');
    const ws = workspace();
    const r = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--passes', 'inv', '--frameworks', 'CLIENT_LZ_POLICY_BASELINE']);
    expect(r.threw).toBeUndefined();
    expect(r.code).toBe(1);
    expect(r.out).toContain('[error] --frameworks is for --type landing-zone-live; an app run selects frameworks in apps/<id>/.swao.yml');
    expect(r.out).not.toContain('[info] Running Pass');
    expect(existsSync(join(ws, 'apps', 'payments', 'wsp', 'runs'))).toBe(false);
  }, 200_000);

  it('configured targets win over seeding', async () => {
    sandbox = sandboxLicence('community');
    const ws = workspace({ regions: ['eu-de'], appTargets: ['otc:eu-nl'] });
    const r = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--passes', 'inv']);
    expect(r.code, r.out.slice(-3000)).toBe(0);
    expect(r.out).toContain('assessed against the static LZ catalogue (app payments is linked in .swao.yml: landing zone otc-prod, scope app-pay; configured targets; for live results: swao assess --type landing-zone-live --lz otc-prod)');
    const ctx = runContext(ws);
    expect(ctx).toMatch(/lz_targets:\n\s+- otc\/eu-nl\n/);
    expect(ctx).not.toContain('seeded_targets');
  }, 200_000);

  it('with nothing to seed the warning says nothing was assessed against the catalogue; run-context.yaml records no_targets', async () => {
    sandbox = sandboxLicence('community');
    const ws = workspace();
    const r = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--passes', 'inv']);
    expect(r.code, r.out.slice(-3000)).toBe(0);
    expect(count(r.out, 'live landing-zone data is used only by the Landing Zone Live Assessment; nothing was assessed against the static LZ catalogue')).toBe(1);
    expect(r.out).not.toContain('; assessed against the static LZ catalogue');
    const ctx = runContext(ws);
    expect(ctx).toContain('lz_source: catalogue');
    expect(ctx).toContain('no_targets: true');
    expect((load(ctx) as { lz_source_reason?: { notice?: string } }).lz_source_reason?.notice).toBe('live landing-zone data is used only by the Landing Zone Live Assessment; nothing was assessed against the static LZ catalogue');
    expect(ctx).not.toContain('lz_targets:');
  }, 200_000);

  it('--no-lz-fit (the TUI Esc) for a linked app says nothing was assessed against the catalogue', async () => {
    sandbox = sandboxLicence('community');
    const ws = workspace({ regions: ['eu-de'] });
    const r = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--passes', 'inv', '--no-lz-fit']);
    expect(r.code, r.out.slice(-3000)).toBe(0);
    expect(r.out).toContain('[warn] live landing-zone data is used only by the Landing Zone Live Assessment; --no-lz-fit: nothing was assessed against the static LZ catalogue (app payments is linked in .swao.yml: landing zone otc-prod, scope app-pay;');
    expect(runContext(ws)).not.toContain('lz_targets:');
  }, 200_000);

  it('#4321: the TUI run of a linked app (confirmed targets as --lz-source catalogue --lz-cat-targets) records lz_source_reason and logs assess.lz_source.fallback', async () => {
    sandbox = sandboxLicence('community');
    const ws = workspace();
    // The flags the TUI target step passes (lzSourceCliArgs), workspace default targets, no scope regions: no seed.
    const r = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--passes', 'inv', '--lz-source', 'catalogue', '--lz-cat-targets', 'otc:eu-de']);
    expect(r.code, r.out.slice(-3000)).toBe(0);
    expect(count(r.out, '[warn] live landing-zone data is used only by the Landing Zone Live Assessment; assessed against the static LZ catalogue (app payments is linked in .swao.yml: landing zone otc-prod, scope app-pay; catalogue targets chosen for this run; for live results: swao assess --type landing-zone-live --lz otc-prod)')).toBe(1);
    const ctx = load(runContext(ws)) as { lz_source?: string; lz_source_reason?: Record<string, unknown> };
    expect(ctx.lz_source).toBe('catalogue');
    expect(ctx.lz_source_reason).toEqual({
      requested: 'live', origin: 'swao-yml', lz_id: 'otc-prod', linked: 'landing zone otc-prod, scope app-pay', reason: 'lz-live-assessment-only',
      notice: 'live landing-zone data is used only by the Landing Zone Live Assessment; assessed against the static LZ catalogue',
    });
    const logs = join(ws, 'apps', 'payments', 'wsp', 'logs');
    const events = readdirSync(logs).filter((f) => f.startsWith('app-events-')).flatMap((f) => readFileSync(join(logs, f), 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { code: string; level: string; context: Record<string, unknown> }));
    const fallback = events.filter((e) => e.code === 'assess.lz_source.fallback');
    expect(fallback).toHaveLength(1);
    expect(fallback[0]).toMatchObject({ level: 'warn', context: { lz_id: 'otc-prod', reason: 'lz-live-assessment-only', via: 'explicit-targets' } });
  }, 200_000);

  it('the unedited TUI pre-fill (--lz-cat-targets plus --lz-cat-targets-seeded) records the seed provenance and the warning', async () => {
    sandbox = sandboxLicence('community');
    const ws = workspace({ regions: ['eu-de', 'eu-nl'] });
    const r = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--passes', 'inv', '--lz-cat-targets', 'otc:eu-nl,otc:eu-de', '--lz-cat-targets-seeded', 'swao-yml-scope-regions']);
    expect(r.code, r.out.slice(-3000)).toBe(0);
    expect(count(r.out, 'live landing-zone data is used only by the Landing Zone Live Assessment; assessed against the static LZ catalogue')).toBe(1);
    expect(r.out).toContain('targets otc/eu-de, otc/eu-nl seeded from landing_zones[].scopes[].regions in .swao.yml, pre-filled in the terminal interface');
    const ctx = runContext(ws);
    expect(ctx).toContain('lz_source: catalogue');
    expect(ctx).toMatch(/seeded_targets:\n\s+- otc\/eu-de\n\s+- otc\/eu-nl/);
    expect(ctx).toContain('seed_source: swao-yml-scope-regions');
    expect(ctx).toContain('origin: swao-yml');
    expect(ctx).toContain('reason: lz-live-assessment-only');
  }, 200_000);

  it('an edited pre-fill, or a marker whose source does not match the seed, is recorded as an explicit catalogue choice (#4321: with the link notice, no seed provenance)', async () => {
    sandbox = sandboxLicence('community');
    const ws = workspace({ regions: ['eu-de', 'eu-nl'] });
    const edited = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--passes', 'inv', '--lz-cat-targets', 'otc:eu-de', '--lz-cat-targets-seeded', 'swao-yml-scope-regions']);
    expect(edited.code, edited.out.slice(-3000)).toBe(0);
    expect(edited.out).toContain('--lz-cat-targets differ from the targets seeded from landing zone otc-prod; recorded as an explicit catalogue choice');
    expect(count(edited.out, 'assessed against the static LZ catalogue (app payments is linked in .swao.yml: landing zone otc-prod, scope app-pay; catalogue targets chosen for this run')).toBe(1);
    const reason = (load(runContext(ws)) as { lz_source_reason?: Record<string, unknown> }).lz_source_reason;
    expect(reason).toMatchObject({ reason: 'lz-live-assessment-only', linked: 'landing zone otc-prod, scope app-pay' });
    expect(reason?.['seed_source']).toBeUndefined();
    const wrongSource = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--passes', 'inv', '--lz-cat-targets', 'otc:eu-de,otc:eu-nl', '--lz-cat-targets-seeded', 'live-run-regions-in-use']);
    expect(wrongSource.out).toContain('recorded as an explicit catalogue choice');
    expect(runContext(ws)).not.toContain('seed_source');
    const bad = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--passes', 'inv', '--lz-cat-targets', 'otc:eu-de', '--lz-cat-targets-seeded', 'guess']);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('--lz-cat-targets-seeded must be swao-yml-scope-regions or live-run-regions-in-use');
  }, 300_000);
});
