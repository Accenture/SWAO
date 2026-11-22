// #4285 (Design 125 sections 5.7 and 8): an app run records where its LZ
// targets came from. The TUI passes the accepted preselection as
// --lz-cat-targets; when it equals the set-up targets after geography
// resolution, run-context.yaml names the set-up key and the requested value next
// to the resolved region, and run-status.json carries resolved_targets, as for
// a flag-free run. A changed pick is recorded as the run-time choice.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { runAssessInProcess, sandboxLicence, type LicenceSandbox } from '../__tests__/helpers/in-process-assess.js';

const tmp: string[] = [];
let sandbox: LicenceSandbox | undefined;
afterEach(() => {
  sandbox?.restore(); sandbox = undefined;
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

function workspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-lz-origin-'));
  tmp.push(ws);
  writeFileSync(join(ws, '.swao.yml'), ['name: demo', 'assessment:', '  landing_zone:', '    targets: [azure:germany, otc:germany]', ''].join('\n'));
  mkdirSync(join(ws, 'apps', 'payments', 'src'), { recursive: true });
  writeFileSync(join(ws, 'apps', 'payments', 'src', 'main.py'), 'print(1)\n');
  writeFileSync(join(ws, 'apps', 'payments', '.swao.yml'), 'source:\n  path: ./src\n');
  return ws;
}

function latest(ws: string): { ctx: Record<string, unknown>; status: Record<string, unknown> } {
  const wsp = join(ws, 'apps', 'payments', 'wsp');
  const run = join(wsp, readFileSync(join(wsp, 'latest.txt'), 'utf-8').trim());
  return {
    ctx: load(readFileSync(join(run, 'run-context.yaml'), 'utf-8')) as Record<string, unknown>,
    status: JSON.parse(readFileSync(join(run, 'run-status.json'), 'utf-8')) as Record<string, unknown>,
  };
}

const RESOLVED = [
  { requested: 'azure:germany', resolved: 'azure:germanywestcentral', geography: 'germany' },
  { requested: 'otc:germany', resolved: 'otc:eu-de', geography: 'germany' },
];

describe('run-context.yaml lz_targets_source (#4285)', () => {
  it('the accepted TUI preselection is attributed to the set-up targets with the geography resolution', async () => {
    sandbox = sandboxLicence('community');
    const ws = workspace();
    const r = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--passes', 'inv', '--lz-cat-targets', 'otc:eu-de,azure:germanywestcentral']);
    expect(r.code, r.out.slice(-3000)).toBe(0);
    const { ctx, status } = latest(ws);
    expect(ctx['lz_targets_source']).toBe('workspace:assessment.landing_zone.targets');
    expect(ctx['lz_targets_resolved']).toEqual(RESOLVED);
    expect(status['resolved_targets']).toEqual(RESOLVED);
  }, 200_000);

  it('a flag-free run names the set-up key; a changed pick is the run-time choice', async () => {
    sandbox = sandboxLicence('community');
    const ws = workspace();
    const a = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--passes', 'inv']);
    expect(a.code, a.out.slice(-3000)).toBe(0);
    expect(latest(ws).ctx['lz_targets_source']).toBe('workspace:assessment.landing_zone.targets');
    expect(latest(ws).ctx['lz_targets']).toEqual(['azure/germanywestcentral', 'otc/eu-de']);
    const b = await runAssessInProcess(['--workspace', ws, '--app', 'payments', '--skip-llm', '--passes', 'inv', '--lz-cat-targets', 'otc:eu-nl']);
    expect(b.code, b.out.slice(-3000)).toBe(0);
    expect(latest(ws).ctx['lz_targets_source']).toBe('cli:--lz-cat-targets');
    expect(latest(ws).ctx['lz_targets_resolved']).toBeUndefined();
  }, 300_000);
});
