// #4284 (Design 125 section 5.7): the frameworks and the LLM provider chosen
// for a run reach `swao assess --app` as flags (--regimes, --llm-provider),
// apply to that run only, and never change apps/<id>/.swao.yml.
import { describe, it, expect, afterEach } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { runAssessInProcess, sandboxLicence, type LicenceSandbox } from '../__tests__/helpers/in-process-assess.js';

const here = dirname(fileURLToPath(import.meta.url));
const FRAMEWORKS = join(here, '..', '..', '..', '@swao', 'community-frameworks', 'frameworks');
const tmp: string[] = [];
let sandbox: LicenceSandbox | undefined;
afterEach(() => {
  sandbox?.restore(); sandbox = undefined;
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

const APP_YML = [
  '# app config written by the Setup Wizard',
  'source:',
  '  path: ./src',
  'assessment:',
  '  regimes_active:',
  '    - CLIENT_LZ_POLICY_BASELINE # the baseline',
  '    - GDPR_DEMO',
  '',
].join('\n');

function workspace(): { ws: string; yml: string } {
  const ws = mkdtempSync(join(tmpdir(), 'swao-assess-choices-'));
  tmp.push(ws);
  writeFileSync(join(ws, '.swao.yml'), 'name: demo\n');
  for (const f of ['client-lz-policy-baseline', 'gdpr-demo']) cpSync(join(FRAMEWORKS, f), join(ws, 'wsp', 'inputs', 'catalogs', 'community', f), { recursive: true });
  const app = join(ws, 'apps', 'payments');
  mkdirSync(join(app, 'src'), { recursive: true });
  writeFileSync(join(app, 'src', 'main.py'), 'print(1)\n');
  const yml = join(app, '.swao.yml');
  writeFileSync(yml, APP_YML);
  return { ws, yml };
}

function latestRun(ws: string): string {
  const wsp = join(ws, 'apps', 'payments', 'wsp');
  return join(wsp, readFileSync(join(wsp, 'latest.txt'), 'utf-8').trim());
}

describe('swao assess --app --regimes and --llm-provider (#4284)', () => {
  it('--regimes narrows the frameworks of this run: run-context.yaml and Pass 11 use them; the app file stays byte-identical', async () => {
    sandbox = sandboxLicence('community');
    const { ws, yml } = workspace();
    const llmEnv = process.env['SWAO_LLM_PROVIDER'];
    delete process.env['SWAO_LLM_PROVIDER'];
    const r = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--passes', 'inv,comp', '--no-lz-fit', '--regimes', 'CLIENT_LZ_POLICY_BASELINE'])
      .finally(() => { if (llmEnv !== undefined) process.env['SWAO_LLM_PROVIDER'] = llmEnv; });
    expect(r.code, r.out.slice(-3000)).toBe(0);
    expect(readFileSync(yml, 'utf-8')).toBe(APP_YML);
    const run = latestRun(ws);
    const ctx = load(readFileSync(join(run, 'run-context.yaml'), 'utf-8')) as { active_frameworks?: string[] };
    expect(ctx.active_frameworks).toEqual(['CLIENT_LZ_POLICY_BASELINE']);
    // #4269: the selection is logged and recorded with the app default and the source.
    expect((ctx as { frameworks_selection?: unknown }).frameworks_selection).toEqual({ default: ['CLIENT_LZ_POLICY_BASELINE', 'GDPR_DEMO'], chosen: ['CLIENT_LZ_POLICY_BASELINE'], source: 'run-selection' });
    expect(r.out).toContain('[info] Frameworks for this run: CLIENT_LZ_POLICY_BASELINE (1 of 2 app frameworks chosen for this run');
    const logs = join(ws, 'apps', 'payments', 'wsp', 'logs');
    const events = readdirSync(logs).filter((f) => f.endsWith('.ndjson')).flatMap((f) => readFileSync(join(logs, f), 'utf-8').split(String.fromCharCode(10)).filter(Boolean).map((l) => JSON.parse(l) as { code: string; context?: { source?: string } }));
    expect(events.filter((e) => e.code === 'assess.frameworks.selected').map((e) => e.context?.source)).toEqual(['run-selection']);
    const p11 = readdirSync(join(run, 'passes')).find((f) => f.startsWith('11-'));
    expect(p11).toBeDefined();
    const regimes = ((load(readFileSync(join(run, 'passes', p11!), 'utf-8')) as { assessment?: { regimes?: { id: string }[] } }).assessment?.regimes ?? []).map((x) => x.id);
    expect(regimes).toEqual(['CLIENT_LZ_POLICY_BASELINE']);
  }, 300_000);

  it('#4269: without --regimes the run records the app default as source app-default', async () => {
    sandbox = sandboxLicence('community');
    const { ws } = workspace();
    const r = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--passes', 'inv', '--no-lz-fit']);
    expect(r.code, r.out.slice(-3000)).toBe(0);
    const ctx = load(readFileSync(join(latestRun(ws), 'run-context.yaml'), 'utf-8')) as { frameworks_selection?: unknown };
    expect(ctx.frameworks_selection).toEqual({ default: ['CLIENT_LZ_POLICY_BASELINE', 'GDPR_DEMO'], chosen: ['CLIENT_LZ_POLICY_BASELINE', 'GDPR_DEMO'], source: 'app-default' });
    expect(r.out).not.toContain('Frameworks for this run:');
  }, 200_000);

  it('#4284: --passes of this run is not narrowed by a saved assessment.pass_profile; the file stays unchanged', async () => {
    sandbox = sandboxLicence('community');
    const { ws, yml } = workspace();
    const saved = APP_YML + '  pass_profile: [inv]' + String.fromCharCode(10);
    writeFileSync(yml, saved);
    const r = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--no-lz-fit', '--passes', 'inv,state']);
    expect(r.code, r.out.slice(-3000)).toBe(0);
    expect(r.out).toContain('--passes given: assessment.pass_profile (the saved default) does not narrow this run');
    const passes = readdirSync(join(latestRun(ws), 'passes'));
    expect(passes.some((f) => f.startsWith('02-'))).toBe(true);
    expect(readFileSync(yml, 'utf-8')).toBe(saved);
  }, 200_000);

  it('refuses an empty --regimes and an invalid --llm-provider with exit 1 before any pass', async () => {
    sandbox = sandboxLicence('community');
    const { ws, yml } = workspace();
    const a = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--passes', 'inv', '--regimes', ',']);
    expect(a.code).toBe(1);
    expect(a.out).toContain('--regimes needs comma-separated framework ids');
    const b = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--passes', 'inv', '--llm-provider', 'Not A Provider']);
    expect(b.code).toBe(1);
    expect(b.out).toContain('--llm-provider must be a provider type');
    expect(existsSync(join(ws, 'apps', 'payments', 'wsp', 'runs'))).toBe(false);
    expect(readFileSync(yml, 'utf-8')).toBe(APP_YML);
  }, 200_000);
});
