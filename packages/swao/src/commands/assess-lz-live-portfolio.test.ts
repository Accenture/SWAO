// #3584: `swao assess --portfolio --type landing-zone-live [--include-simulated]`
// is dispatched to the live portfolio merge before the --lz check, and the
// host rebuilds portfolio-summary.json through the single aggregator
// (buildPortfolioSummary). Spawns the compiled CLI as assess-lz-live.test.ts
// does; the merge itself is covered in module-landing-zone
// (live/__tests__/portfolio.test.ts). Synthetic merged view only.
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', '..', 'dist', 'index.js');
const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

function run(args: string[], ws: string): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, [cli, 'assess', '--workspace', ws, ...args], {
    encoding: 'utf-8',
    cwd: ws,
    env: { ...process.env, SWAO_LICENSE_TIER_OVERRIDE: 'enterprise' },
    timeout: 120_000,
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const MERGED = [
  'lz_id: otc-prod', 'provider: otc', "merged_at: '2026-11-03T12:00:00.000Z'", 'window_days: 7',
  'scopes:',
  '  - scope_id: platform', '    scope_kind: platform', '    status: merged', "    observed_at: '2026-11-03T08:00:00Z'",
  '    simulated: { scenario: demo, fidelity: spec-derived, evidence: [header] }',
  'offering:', '  regions: [{ id: eu-de, country: DE, azs: [], status: enabled }]', '  services: []',
  'estate:', '  resources: []', '  guardrails: []', '',
].join('\n');

function workspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-assess-lzl-portfolio-'));
  tmp.push(ws);
  writeFileSync(join(ws, '.swao.yml'), ['name: demo', 'landing_zones:', '  - id: otc-prod', '    provider: otc', '    scopes:', '      - id: platform', '        kind: platform', '        auth: iam-password-token', ''].join('\n'));
  const run = join(ws, 'landing-zones', 'otc-prod', 'wsp', 'runs', '2026-11-03T08-00-00');
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'lz-live-merged.yaml'), MERGED);
  return ws;
}

// A source build in CI may run below Enterprise: then the portfolio gate answers.
const GATED = /requires.*(Enterprise|enterprise)|lz-live-portfolio|assess --portfolio/;

describe.skipIf(!existsSync(cli))('swao assess --portfolio --type landing-zone-live (#3584)', () => {
  it('reaches the portfolio merge without --lz; --include-simulated is passed through; the summary gets landing_zones[]', () => {
    const ws = workspace();
    const a = run(['--portfolio', '--type', 'landing-zone-live'], ws);
    expect(a.out).not.toMatch(/requires --lz <lz-id>/);
    expect(a.out).not.toMatch(/--app <appId> is required/);
    if (!a.out.includes('[lz live] portfolio')) {
      expect(a.out).toMatch(GATED);
      return;
    }
    // Every merged scope is simulated: without the flag nothing is merged.
    expect(a.code).toBe(1);
    expect(a.out).toMatch(/every merged scope is simulated \(platform\); pass --include-simulated/);
    expect(existsSync(join(ws, 'wsp', 'portfolio-summary.json'))).toBe(false);
    const b = run(['--portfolio', '--type', 'landing-zone-live', '--include-simulated'], ws);
    expect(b.code).toBe(0);
    expect(b.out).toContain('otc-prod (T Cloud Public) [SIM]');
    const summary = JSON.parse(readFileSync(join(ws, 'wsp', 'portfolio-summary.json'), 'utf-8')) as { landing_zones?: Array<{ lz_id: string; simulated?: boolean }> };
    expect(summary.landing_zones).toEqual([expect.objectContaining({ lz_id: 'otc-prod', simulated: true })]);
  }, 260_000);

  it('--type landing-zone-live without --portfolio still needs --lz', () => {
    const r = run(['--type', 'landing-zone-live'], workspace());
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/requires --lz <lz-id>/);
  }, 260_000);
});
