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

// #4197 (Design 125 sections 8 and 11): parity on a fixture workspace. The
// TUI branch runs `health-check --type <type>` and parses its text output
// (HealthCheckStep, healthResultFromLines); `swao setup --type <type>
// --non-interactive` must report the same health result. Spawns the
// compiled CLI (dist/index.js, as health-check-json.test.ts does).

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { healthResultFromLines } from '../setup/branch-check.js';
import { healthCheckArgs } from '../tui/screens/wizard/steps/HealthCheckStep.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', '..', 'dist', 'index.js');
const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

function run(args: string[], ws: string): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf-8', cwd: ws, timeout: 240_000 });
  return { code: r.status, out: r.stdout ?? '' };
}

describe.skipIf(!existsSync(cli))('swao setup --type and the TUI branch give the same health result (#4197)', () => {
  it('llm and service on one fixture workspace', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-setup-parity-'));
    tmp.push(ws);
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\nengagement:\n  name: parity\n  client_code: parity\nservice_portfolio:\n  source: intake.xlsx\n  mapping: null\n');
    for (const type of ['llm', 'service'] as const) {
      const tui = healthResultFromLines(run([...healthCheckArgs(type), '--workspace', ws], ws).out.replace(/\r/g, '').split('\n'), type);
      const cli = run(['setup', '--type', type, '--non-interactive', '--json', '--workspace', ws], ws);
      const json = JSON.parse(cli.out) as { state: string; health: unknown };
      expect(json.health, type).toEqual(tui);
      expect(cli.code, type).toBe(json.state === 'needs-attention' ? 1 : 0);
      expect(tui.probeCount, type).toBeGreaterThan(0);
    }
    const yml = readFileSync(join(ws, '.swao.yml'), 'utf-8');
    expect(yml).toContain('assessment_types: [service, llm]');
    expect(yml).toMatch(/setup_state: \{ ?service: \{ ?state: [a-z-]+, .*\}, llm: \{ ?state: /);
  }, 600_000);
});
