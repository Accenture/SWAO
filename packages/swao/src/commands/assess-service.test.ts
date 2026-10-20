// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// `swao assess` on a mixed workspace (ADR-0064, #3093-#3097): a service app runs the
// service pass profile; an application app in the same workspace is unaffected.
// stdio is ignored (no pipes) to avoid the Windows grandchild-pipe hang.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const CLI = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'dist', 'index.js');
const distBuilt = existsSync(CLI);
let ws: string;

function assess(app: string): number | null {
  const r = spawnSync(process.execPath, [CLI, 'assess', '--app', app, '--workspace', ws, '--skip-llm'], {
    cwd: ws,
    stdio: 'ignore',
    timeout: 240_000,
    env: { ...process.env, SWAO_LICENSE_TIER_OVERRIDE: 'community' },
  });
  return r.status;
}

const latestRun = (app: string, pointer: string) => join(ws, 'apps', app, 'wsp', readFileSync(join(ws, 'apps', app, 'wsp', pointer), 'utf-8').trim());

beforeAll(() => {
  ws = mkdtempSync(join(tmpdir(), 'swao-assess-service-'));
  writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\n');
  const svc = join(ws, 'apps', 'hosapp001');
  mkdirSync(join(svc, 'ingestion', 'binary', 'config'), { recursive: true });
  writeFileSync(join(svc, '.swao.yml'), 'wsp_version: "0.9"\napp_id: hosapp001\nassessment:\n  type: service\nvendor_type: on-premises\ndata:\n  health_data: true\n');
  writeFileSync(join(svc, 'ingestion', 'binary', 'config', 'app.ini'), 'hash=md5\n');
  const app = join(ws, 'apps', 'webapp');
  mkdirSync(join(app, 'wsp', 'inputs', 'source'), { recursive: true });
  writeFileSync(join(app, '.swao.yml'), 'wsp_version: "0.9"\napp_id: webapp\nsource:\n  path: wsp/inputs/source/\n');
  writeFileSync(join(app, 'wsp', 'inputs', 'source', 'index.js'), "const http = require('http');\nhttp.createServer(() => {}).listen(8080);\n");
});
afterAll(() => { if (ws) rmSync(ws, { recursive: true, force: true }); });

describe.skipIf(!distBuilt)('swao assess with a service app (ADR-0064)', () => {
  it('runs the service profile: no source-only pass files, service run context, skipped passes recorded', () => {
    expect(assess('hosapp001')).toBe(0);
    const run = latestRun('hosapp001', 'latest-service.txt');
    expect(existsSync(join(run, 'passes', '01-inv.yaml'))).toBe(false);
    expect(existsSync(join(run, 'passes', '08-crypto.yaml'))).toBe(true);
    expect(existsSync(join(ws, 'apps', 'hosapp001', 'wsp', 'latest-application.txt'))).toBe(false);
    const ctx = load(readFileSync(join(run, 'run-context.yaml'), 'utf-8')) as Record<string, unknown>;
    expect(ctx['assessment_type']).toBe('service');
    expect(ctx['excluded_passes']).toEqual(expect.arrayContaining(['inv', 'state', 'tf', 'egr']));
    const scope = JSON.parse(readFileSync(join(run, 'scope-coverage.json'), 'utf-8')) as { skipped_passes: Array<{ num: string; reason: string }> };
    expect(scope.skipped_passes.map((s) => s.num)).toEqual(expect.arrayContaining(['01', '02', '06', '07']));
    const crypto = load(readFileSync(join(run, 'passes', '08-crypto.yaml'), 'utf-8')) as { signals: Array<{ evidence: string[] }> };
    expect(crypto.signals[0]!.evidence).toEqual(['ingestion/binary/config/app.ini:1']);
  }, 300_000);

  it('leaves the application path unchanged for an application app in the same workspace', () => {
    expect(assess('webapp')).toBe(0);
    const run = latestRun('webapp', 'latest-application.txt');
    expect(existsSync(join(run, 'passes', '01-inv.yaml'))).toBe(true);
    expect(existsSync(join(run, 'scope-coverage.json'))).toBe(false);
    expect((load(readFileSync(join(run, 'run-context.yaml'), 'utf-8')) as Record<string, unknown>)['assessment_type']).toBe('application');
  }, 300_000);
});
