// #3888 (Design 123 section 8.4, CP-4): end to end, `swao assess --app` hands
// the Client LZ Policy Baseline decisions to Pass 11 on the comp pass context
// (assess.ts), and no baseline control reaches the LLM. #4244 (owner decision
// 2026-11-09): an app run uses the static LZ catalogue only, also for an app
// linked to a landing zone with a live run (the live run is not read).
// Spawns the compiled CLI with an LLM provider pointed at a local fake Ollama
// that records every prompt. Synthetic workspace, the shipped baseline copied in.
import { describe, it, expect, afterEach } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { dump as yamlDump, load as yamlLoad } from 'js-yaml';
import { deriveLzScanBaseFields, parseLzLiveScan, POLICY_KIND_CATEGORY, type PolicyKind } from '@swao/core';
import { mergeLzLiveScopes } from '@swao/module-landing-zone';
import { runAssessInProcess, sandboxLicence, type LicenceSandbox } from '../__tests__/helpers/in-process-assess.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', '..', 'dist', 'index.js');
const SHIPPED = join(here, '..', '..', '..', '@swao', 'community-frameworks', 'frameworks', 'client-lz-policy-baseline');
const FW = 'CLIENT_LZ_POLICY_BASELINE';
const tmp: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Fake Ollama /api/generate: records the prompt and answers GAP for every `- id:` control it names. */
async function fakeOllama(prompts: string[]): Promise<string> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let prompt = '';
      try { prompt = String((JSON.parse(body) as { prompt?: string }).prompt ?? ''); } catch { /* not JSON */ }
      prompts.push(prompt);
      const ids = [...prompt.matchAll(/- id: (\S+)/g)].map((m) => m[1]!);
      const response = JSON.stringify({ controls: ids.map((id) => ({ id, outcome: 'GAP', rationale: `Probe ${id}.`, signal_refs: [], remediation: 'Fix it.' })) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'fake', response, done: true, prompt_eval_count: 1, eval_count: 1 }));
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const baselineSha = (ws: string): string =>
  createHash('sha256').update(readFileSync(join(ws, 'wsp', 'inputs', 'catalogs', 'community', 'client-lz-policy-baseline', 'policy-baseline.yaml'))).digest('hex');

function workspace(source: 'catalogue' | 'live'): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-assess-baseline-'));
  tmp.push(ws);
  cpSync(SHIPPED, join(ws, 'wsp', 'inputs', 'catalogs', 'community', 'client-lz-policy-baseline'), { recursive: true });
  const lz = source === 'live'
    ? ['landing_zones:', '  - id: otc-prod', '    provider: otc', '    scopes:', '      - id: app-pay', '        kind: application', '        auth: iam-password-token', '        regions: [eu-de]', '        app: payments']
    : [];
  writeFileSync(join(ws, '.swao.yml'), ['name: demo', ...lz, ''].join('\n'));
  const app = join(ws, 'apps', 'payments');
  mkdirSync(join(app, 'src'), { recursive: true });
  writeFileSync(join(app, '.swao.yml'), [
    'source:', '  path: ./src',
    'assessment:', '  regimes_active:', `    - ${FW}`,
    ...(source === 'catalogue' ? ['  landing_zone:', '    targets:', '      - otc:eu-de'] : []),
    '',
  ].join('\n'));
  writeFileSync(join(app, 'src', 'requirements.txt'), 'psycopg2==2.9.9\nflask==3.0.0\n');
  writeFileSync(join(app, 'src', 'app.py'), 'import psycopg2\nfrom flask import Flask\napp = Flask(__name__)\n');
  if (source === 'live') liveRun(ws);
  return ws;
}

/** A live run of otc-prod (scope app-pay) with a baseline result of the installed baseline. */
function liveRun(ws: string): void {
  const observed = new Date(Date.now() - 3600_000).toISOString();
  const meta = {
    lz_id: 'otc-prod', provider: 'otc', scope_id: 'app-pay', scope_kind: 'application' as const, observed_at: observed,
    driver_version: '0.1.0', read_only: 'verified' as const, read_only_overrides: [], coverage: { readable: [], unreadable: [] }, frameworks: [], sources: [],
  };
  const offering = { regions: [{ id: 'eu-de', country: 'DE', azs: [], status: 'enabled' as const }], services: [{ code: 'ecs', name: 'ecs', capability_tags: ['vm_compute'], regions: { 'eu-de': { status: 'enabled' as const, evidence: [{ source: 'api' as const, ref: 'ecs' }], observed_at: observed } }, frameworks: {} }] };
  const estate = { resources: [], workloads: [], guardrails: [], quotas: [], checks: [] };
  const scan = parseLzLiveScan({ ...deriveLzScanBaseFields({ meta, offering, estate }), collection_mode: 'live', confidence: 'observed', meta, offering, estate });
  const merged = mergeLzLiveScopes({ lzId: 'otc-prod', provider: 'otc', scans: [scan], registeredScopes: [{ id: 'app-pay', kind: 'application' }], now: new Date() });
  const dir = join(ws, 'landing-zones', 'otc-prod', 'wsp', 'runs', '2026-11-05T08-00-00');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'otc-prod.app-pay.lz-live-scan.json'), JSON.stringify(scan));
  writeFileSync(join(dir, 'lz-live-merged.yaml'), yamlDump(merged));
  writeFileSync(join(dir, 'lz-live-catalogue.json'), JSON.stringify({ regions: [{ id: 'eu-de', country: 'DE', sovereignty: { residency_country: 'DE', operator_jurisdiction: 'EU-entity' } }] }));
  const baseline = yamlLoad(readFileSync(join(SHIPPED, 'policy-baseline.yaml'), 'utf-8')) as { catalogue_version: string; policies: { id: string; kind: PolicyKind; control: string; state: string }[] };
  const audit = baseline.policies.find((p) => p.kind === 'audit_trail' && p.state === 'enabled');
  writeFileSync(join(dir, 'otc-prod.app-pay.lz-baseline.json'), JSON.stringify({
    schema: 'lz-baseline-result/1', lz_id: 'otc-prod', scope_id: 'app-pay', provider: 'otc', framework: FW, baseline_of: FW, catalogue_version: baseline.catalogue_version, sha256: baselineSha(ws), overall: 'READY',
    policies: audit ? [{ id: audit.id, kind: 'audit_trail', category: POLICY_KIND_CATEGORY.audit_trail, control: audit.control, severity: 'warning', offering: 'READY', estate: 'pass', observability: 'observed', detail: 'x' }] : [],
    not_reviewed: [], disabled: [],
  }));
}

function run(ws: string, url: string, args: string[] = []): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, 'assess', '--workspace', ws, '--app', 'payments', '--passes', 'inv,state,comp', '--no-cache', ...args], {
      cwd: ws,
      env: { ...process.env, SWAO_LICENSE_TIER_OVERRIDE: 'enterprise', SWAO_LLM_PROVIDER: 'ollama', SWAO_OLLAMA_URL: url, SWAO_OLLAMA_MODEL: 'fake', SWAO_NO_UPDATE_CHECK: '1' },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill(), 240_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

type Ctl = { id: string; outcome: string; assessor: string; rationale: string };
function compControls(ws: string): Ctl[] {
  const runs = join(ws, 'apps', 'payments', 'wsp', 'runs');
  const run = readdirSync(runs).sort().pop() as string;
  const passes = join(runs, run, 'passes');
  const file = readdirSync(passes).find((f) => f.startsWith('11-'));
  if (!file) throw new Error(`no Pass 11 output in ${readdirSync(passes).join(', ')}`);
  const doc = yamlLoad(readFileSync(join(passes, file), 'utf-8')) as { assessment?: { regimes?: { id: string; controls: Ctl[] }[] } };
  return doc.assessment?.regimes?.find((r) => r.id === FW)?.controls ?? [];
}

describe.skipIf(!existsSync(cli) || !existsSync(SHIPPED))('swao assess --app: Pass 11 decides the baseline by rule (#3888, end to end)', () => {
  it('catalogue source: every baseline control is a rule-engine outcome, no prompt names a CPB- control', async () => {
    const prompts: string[] = [];
    const url = await fakeOllama(prompts);
    const ws = workspace('catalogue');
    const r = await run(ws, url);
    expect(r.code, r.out.slice(-3000)).toBe(0);
    const controls = compControls(ws);
    expect(controls.length).toBeGreaterThan(5);
    expect(controls.every((c) => c.assessor === 'rule_engine')).toBe(true);
    expect(controls.every((c) => /baseline rule engine|decided by rule only/.test(c.rationale))).toBe(true);
    // decisions came from the catalogue source, not the no-source fallback
    expect(controls.some((c) => /static catalogue has no tenant state/.test(c.rationale))).toBe(true);
    for (const p of prompts) expect(p).not.toMatch(/CPB-/);
  }, 300_000);

  it('#4244: a linked app with a live run: the catalogue decides (seeded from the scope regions), the live run is not read; no prompt names a CPB- control', async () => {
    const prompts: string[] = [];
    const url = await fakeOllama(prompts);
    const ws = workspace('live');
    const r = await run(ws, url);
    expect(r.code, r.out.slice(-3000)).toBe(0);
    expect(r.out).not.toContain('LZ source: live');
    expect(r.out).toContain('live landing-zone data is used only by the Landing Zone Live Assessment; assessed against the static LZ catalogue');
    const controls = compControls(ws);
    expect(controls.every((c) => c.assessor === 'rule_engine')).toBe(true);
    expect(controls.some((c) => /live run 2026-11-05T08-00-00/.test(c.rationale))).toBe(false);
    expect(controls.some((c) => /static catalogue has no tenant state/.test(c.rationale))).toBe(true);
    for (const p of prompts) expect(p).not.toMatch(/CPB-/);
  }, 300_000);
});

// The cases above spawn the compiled CLI and skip without a build. The same
// assess action runs here in-process (registerAssess, assess.ts) with a
// sandboxed test-signed Consultant licence and the same recording fake Ollama,
// so the #4244 rule (a linked app with a live run is decided against the static
// catalogue on Consultant too) and the "no CPB- control in any prompt"
// guarantee run on every machine. A
// second, LLM-assessed regime (GDPR_DEMO) makes Pass 11 call the fake LLM, so
// the prompt guarantee is not vacuous (with the baseline alone no prompt is sent).
const GDPR_DEMO = join(SHIPPED, '..', 'gdpr-demo');

describe('swao assess --app: Pass 11 of a linked app, in-process with a sandboxed Consultant licence (#3888, #4244)', () => {
  let sandbox: LicenceSandbox | undefined;
  afterEach(() => { sandbox?.restore(); sandbox = undefined; });

  it('#4244: the catalogue decides, the live run of the linked landing zone is not read; no prompt names a CPB- control', async () => {
    expect(existsSync(SHIPPED), `shipped baseline missing: ${SHIPPED}`).toBe(true);
    expect(existsSync(GDPR_DEMO), `shipped GDPR_DEMO missing: ${GDPR_DEMO}`).toBe(true);
    sandbox = sandboxLicence('consultant');
    const prompts: string[] = [];
    const url = await fakeOllama(prompts);
    const ws = workspace('live');
    cpSync(GDPR_DEMO, join(ws, 'wsp', 'inputs', 'catalogs', 'community', 'gdpr-demo'), { recursive: true });
    writeFileSync(join(ws, 'apps', 'payments', '.swao.yml'), ['source:', '  path: ./src', 'assessment:', '  regimes_active:', `    - ${FW}`, '    - GDPR_DEMO', ''].join('\n'));
    const r = await runAssessInProcess(
      ['--workspace', ws, '--app', 'payments', '--passes', 'inv,state,comp', '--no-cache'],
      { SWAO_LLM_PROVIDER: 'ollama', SWAO_OLLAMA_URL: url, SWAO_OLLAMA_MODEL: 'fake', SWAO_NO_UPDATE_CHECK: '1' },
    );
    expect(r.threw).toBeUndefined();
    expect(r.code, r.out.slice(-3000)).toBe(0);
    expect(r.out).not.toContain('LZ source: live');
    expect(r.out).toContain('live landing-zone data is used only by the Landing Zone Live Assessment; assessed against the static LZ catalogue');
    // the fake LLM was reached, for the GDPR_DEMO controls only
    expect(prompts.length, 'Pass 11 sent no prompt to the fake LLM').toBeGreaterThan(0);
    expect(prompts.some((p) => /GDPR_DEMO\./.test(p))).toBe(true);
    for (const p of prompts) expect(p).not.toMatch(/CPB-/);
    const controls = compControls(ws);
    expect(controls.length).toBeGreaterThan(5);
    expect(controls.every((c) => c.assessor === 'rule_engine')).toBe(true);
    expect(controls.some((c) => /live run 2026-11-05T08-00-00/.test(c.rationale))).toBe(false);
    expect(controls.some((c) => /static catalogue has no tenant state/.test(c.rationale))).toBe(true);
  }, 300_000);
});
