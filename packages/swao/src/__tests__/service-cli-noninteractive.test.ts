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

// #3165: the service CLI must never wait for input (CI/CD pipelines run it
// without a TTY). Each command runs with stdin closed and must exit within the
// timeout with a non-zero exit code and a clear message when it cannot proceed.
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'index.js');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function run(args: string[]): { status: number | null; out: string; timedOut: boolean } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    // Each case only checks an early error path, but a cold CLI start alone can
    // take 10 to 15 s on a loaded or slow machine (release dry run 2026-10-19,
    // #3355); keep the limit well above that so only a real prompt times out.
    timeout: 180_000,
    env: { ...process.env, NODE_OPTIONS: '--no-deprecation', SWAO_NO_UPDATE_CHECK: '1' },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, timedOut: r.error?.message.includes('ETIMEDOUT') ?? false };
}

describe.skipIf(!existsSync(CLI))('service CLI never prompts (#3165)', () => {
  it('service init without --from and without a workbook exits 1 with the intake location', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-cli-noprompt-'));
    dirs.push(ws);
    const r = run(['service', 'init', '--workspace', ws]);
    expect(r.timedOut).toBe(false);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/no intake workbook found: put one \.xlsx file into .*service-intake/);
  }, 400_000);

  it('service research and service rank outside a workspace exit 1 without waiting for input', () => {
    const empty = mkdtempSync(join(tmpdir(), 'swao-cli-noprompt-empty-'));
    dirs.push(empty);
    for (const cmd of [['service', 'research'], ['service', 'rank']]) {
      const r = run([...cmd, '--workspace', empty]);
      expect(r.timedOut).toBe(false);
      expect(r.status).toBe(1);
      expect(r.out).toMatch(/no SWAO workspace found/);
    }
  }, 400_000);

  it('service rank in an empty workspace exits 0 and says there is nothing to assess', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-cli-noprompt-ws-'));
    dirs.push(ws);
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\n');
    const r = run(['service', 'rank', '--workspace', ws]);
    expect(r.timedOut).toBe(false);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/No service apps to assess/);
  }, 400_000);
});
