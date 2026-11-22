// #4506: `swao assess --type landing-zone` prints the LZ markers the LZ Catalog
// run screen reads (Stage bar per target fit, verdicts of the Done screen) only
// when the parent opted in with SWAO_PASS_MARKERS=1, and the post-run step
// lines ([post] Portfolio summary) in every case. In-process (registerAssess)
// with a sandboxed licence; a synthetic workspace, the bundled catalogues, no LLM.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseLzRunMarker, parsePostStepLine, type LzRunMarker } from '@swao/core';
import { runAssessInProcess, sandboxLicence, type LicenceSandbox } from '../__tests__/helpers/in-process-assess.js';

const tmp: string[] = [];
let sandbox: LicenceSandbox | undefined;
afterEach(() => {
  sandbox?.restore(); sandbox = undefined;
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

function workspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-lz-markers-'));
  tmp.push(ws);
  writeFileSync(join(ws, '.swao.yml'), 'workspace:\n  name: lz-markers\n');
  mkdirSync(join(ws, 'apps', 'demo', 'src'), { recursive: true });
  writeFileSync(join(ws, 'apps', 'demo', '.swao.yml'), 'app_name: Demo\nsource:\n  path: ./src\n');
  return ws;
}

const ARGS = (ws: string): string[] => ['--workspace', ws, '--type', 'landing-zone', '--app', 'demo', '--lz-cat-targets', 'stackit:eu01,otc:eu-de', '--no-crawl', '--skip-llm'];
const markers = (out: string): LzRunMarker[] => out.split('\n').map(parseLzRunMarker).filter((m): m is LzRunMarker => m !== null);

describe('swao assess --type landing-zone: run screen markers (#4506)', () => {
  it('with SWAO_PASS_MARKERS=1: a start and an end per target fit, one verdict per target and the overall verdict; the post-run step by name', async () => {
    sandbox = sandboxLicence('enterprise');
    const ws = workspace();
    const r = await runAssessInProcess(ARGS(ws), { SWAO_PASS_MARKERS: '1', SWAO_NO_UPDATE_CHECK: '1' });
    expect(r.threw, r.out.slice(-3000)).toBeUndefined();
    expect(r.code, r.out.slice(-3000)).toBe(0);
    const m = markers(r.out);
    expect(m.filter((x) => x.kind === 'pass').map((x) => (x as { label: string }).label)).toEqual(['stackit:eu01', 'otc:eu-de']);
    expect(m.filter((x) => x.kind === 'pass-done')).toHaveLength(2);
    const verdicts = m.filter((x): x is Extract<LzRunMarker, { kind: 'target-verdict' }> => x.kind === 'target-verdict');
    expect(verdicts.map((v) => v.target)).toEqual(['stackit/eu01', 'otc/eu-de']);
    for (const v of verdicts) expect(v.verdict).toBe(v.verdict.toLowerCase());
    expect(m.filter((x) => x.kind === 'verdict')).toHaveLength(1);
    // the post-run portfolio summary names itself on the screen (as #4498 for the application run)
    expect(r.out.split('\n').map(parsePostStepLine).some((p) => p?.label === 'Portfolio summary')).toBe(true);
  }, 120_000);

  it('a terminal (no SWAO_PASS_MARKERS) never sees the markers', async () => {
    sandbox = sandboxLicence('enterprise');
    const ws = workspace();
    const r = await runAssessInProcess(ARGS(ws), { SWAO_NO_UPDATE_CHECK: '1' });
    expect(r.code, r.out.slice(-3000)).toBe(0);
    expect(markers(r.out)).toEqual([]);
    expect(r.out).toContain('Landing-zone fit complete');
  }, 120_000);
});
