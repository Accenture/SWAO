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

// #4197 SET-08 (Design 125 sections 8 and 11): `swao setup --type <type>
// [--non-interactive]` and its parity with the TUI branch: both parse the
// same `health-check --type` output into the same branch result.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { load } from 'js-yaml';

vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  return { ...actual, logPortfolio: vi.fn() };
});

import { registerSetup } from './setup.js';
import { checkBranch, completeBranchSetup, healthResultFromLines, formatBranchCheck, branchStateFromCheck } from '../setup/branch-check.js';
import { logPortfolio } from '@swao/core';
import { branchStateNotes } from '../setup/workspace-state.js';
import { defaultSetupRegistry } from '../setup/index.js';
import { logSetupHealthCheckResult } from '../tui/screens/wizard/steps/HealthCheckStep.js';
import { summariseHealthCheckOutput } from '@swao/module-health-check';
import type { SetupScope } from '@swao/core';

const LZ_LIVE_OUTPUT = [
  'Running swao health-check...',
  '  [1/7] License...............  ok    Enterprise',
  '  [2/7] SWAO-MCP..............  WARN  stale entry',
  '  [3/7] Credential vault......  FAIL  vault not decryptable',
  '  [4/7] LZ connections........  INFO  no live landing zone registered',
  '1 probe(s) failed: credential-vault.',
];

const dirs: string[] = [];
function ws(): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-setup-cmd-'));
  dirs.push(d);
  writeFileSync(join(d, '.swao.yml'), 'engagement:\n  name: Demo\n', 'utf-8');
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

async function run(args: string[], deps: Parameters<typeof registerSetup>[1]): Promise<{ out: string[]; code: number | undefined }> {
  const out: string[] = [];
  let code: number | undefined;
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.map(String).join(' ')); });
  const err = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { out.push(a.map(String).join(' ')); });
  const exit = vi.spyOn(process, 'exit').mockImplementation(((c?: number) => { code ??= c; throw new Error(`exit ${c}`); }) as typeof process.exit);
  try {
    const program = new Command('swao').exitOverride();
    registerSetup(program, deps);
    await program.parseAsync(['setup', ...args], { from: 'user' }).catch((e: Error) => { if (!e.message.startsWith('exit')) throw e; });
  } finally {
    log.mockRestore(); err.mockRestore(); exit.mockRestore();
  }
  return { out, code };
}

describe('TUI and CLI parity of the branch result (#4197)', () => {
  it('the CLI result equals what the TUI health-check step hands to the branch Ready', () => {
    const cli = healthResultFromLines(LZ_LIVE_OUTPUT, 'lz-live');
    const parsed = summariseHealthCheckOutput(LZ_LIVE_OUTPUT);
    const tui = { ...logSetupHealthCheckResult(LZ_LIVE_OUTPUT, 'lz-live'), failedProbes: parsed.failedProbes, warnedProbes: parsed.warnedProbes };
    expect(cli).toEqual({ scope: 'lz-live', ...tui });
    expect(cli).toMatchObject({ probeCount: 4, failCount: 1, warnCount: 1, failedProbes: ['credential-vault'] });
  });

  it('checkBranch runs the scoped health check, records the state and adds the type', async () => {
    const d = ws();
    const scopes: SetupScope[] = [];
    const r = await checkBranch(defaultSetupRegistry(), d, 'lz-live', async (_w, s) => { scopes.push(s); return LZ_LIVE_OUTPUT; });
    expect(scopes).toEqual(['lz-live']);
    expect(r.state).toBe('needs-attention');
    const yml = readFileSync(join(d, '.swao.yml'), 'utf-8');
    expect(yml).toContain('assessment_types: [lz-live]');
    expect(yml).toMatch(/setup_state: \{ ?lz-live: \{ ?state: needs-attention/);
    expect(formatBranchCheck(r).slice(0, 3)).toEqual([
      'Landing Zone Live Assessment: needs attention: 1 failed check(s); missing Landing zones, Policy baseline',
      '  Health: 4 probe(s), 1 failure(s), 1 warning(s)',
      '  Failed: credential-vault',
    ]);
  });

  it('a branch with a missing Ready item needs attention even when every probe passed (LLM without candidates)', async () => {
    const d = ws();
    const allPass = ['Running swao health-check...', '  [1/2] License...............  ok    Enterprise', '  [2/2] LLM gateway...........  ok    reachable'];
    const r = await checkBranch(defaultSetupRegistry(), d, 'llm', async () => allPass);
    expect(r.health?.failCount).toBe(0);
    expect(r.items.some((i) => i.state === 'missing')).toBe(true);
    expect(r.state).toBe('needs-attention');
    // #4282: the cause is named in the CLI output and recorded in setup_state.
    expect(formatBranchCheck(r)[0]).toMatch(/^LLM Assessment: needs attention: missing LLM candidates/);
    expect(r.cause.missing).toContain('LLM candidates');
    const text = readFileSync(join(d, '.swao.yml'), 'utf-8');
    expect(text).toMatch(/setup_state: \{ ?llm: \{ ?state: needs-attention/);
    const rec = ((load(text) as Record<string, Record<string, Record<string, Record<string, unknown>>>>)['workspace']!['setup_state']!['llm'])!;
    expect(rec).toMatchObject({ state: 'needs-attention', fail_count: 0, missing: expect.arrayContaining(['LLM candidates']) });
  });

  it('#4282 (D-8): one rule for every branch; the same warned probe never changes the state', () => {
    const types = ['application', 'service', 'lz-catalog', 'lz-live', 'llm'] as const;
    for (const t of types) {
      const h = { scope: t, probeCount: 15, failCount: 0, warnCount: 2, failedProbes: [], warnedProbes: ['SWAO-MCP', 'LZ catalogue'] };
      const warnOnly = [{ label: 'x', state: 'warn' as const }, { label: 'y', state: 'info' as const }, { label: 'z', state: 'ok' as const }];
      expect(branchStateFromCheck(h, warnOnly)).toBe('ready');
      expect(branchStateFromCheck(h, [...warnOnly, { label: 'w', state: 'waiting' }])).toBe('needs-attention');
      expect(branchStateFromCheck(h, [...warnOnly, { label: 'm', state: 'missing' }])).toBe('needs-attention');
      expect(branchStateFromCheck({ ...h, failCount: 1, failedProbes: ['p'] }, warnOnly)).toBe('needs-attention');
    }
  });

  it('#4282: the TUI branch end records the cause, logs the deciding probes and items, and the Setup menu names the cause', () => {
    const d = ws();
    writeFileSync(join(d, '.swao.yml'), 'service_portfolio:\n  intake_folder: wsp/inputs/service-intake\n', 'utf-8');
    const health = { scope: 'service' as const, probeCount: 15, failCount: 0, warnCount: 1, failedProbes: [], warnedProbes: ['SWAO-MCP'] };
    vi.mocked(logPortfolio).mockClear();
    const { record, cause } = completeBranchSetup(defaultSetupRegistry(), d, 'service', health, new Date('2026-11-09T20:00:00Z'));
    expect(cause).toEqual({ missing: [], waiting: ['Intake workbook'] });
    expect(record).toMatchObject({ state: 'needs-attention', fail_count: 0, warn_count: 1, waiting: ['Intake workbook'] });
    const call = vi.mocked(logPortfolio).mock.calls.find((c) => c[1] === 'setup.branch.complete')!;
    expect(call[2]).toBe('Setup of Service Portfolio Assessment: needs-attention');
    expect((call[3] as { context: Record<string, unknown> }).context).toEqual({
      scope: 'service', state: 'needs-attention', fail_count: 0, warn_count: 1,
      failed_probes: [], warned_probes: ['SWAO-MCP'], missing: [], waiting: ['Intake workbook'],
    });
    expect(branchStateNotes(d)).toEqual({ service: 'needs attention: waiting for Intake workbook' });
    expect(readFileSync(join(d, '.swao.yml'), 'utf-8')).toContain('assessment_types: [service]');
  });

  it('#4282: a ready branch with warnings records no cause and says nothing is missing', async () => {
    const d = ws();
    writeFileSync(join(d, '.swao.yml'), 'service_portfolio:\n  intake: wsp/inputs/service-intake/inv.xlsx\n', 'utf-8');
    const lines = ['Running swao health-check...', '  [1/2] SWAO-MCP............  WARN  binary_unreachable', '  [2/2] APM weights.........  ok    valid'];
    const r = await checkBranch(defaultSetupRegistry(), d, 'service', async () => lines);
    // The recorded intake file is not there: missing (not waiting), so the branch needs attention.
    expect(r.cause).toEqual({ missing: ['Intake workbook'], waiting: [] });
    expect(r.state).toBe('needs-attention');
    expect(formatBranchCheck(r)[0]).toBe('Service Portfolio Assessment: needs attention: missing Intake workbook');
    const rec = (load(readFileSync(join(d, '.swao.yml'), 'utf-8')) as { workspace: { setup_state: Record<string, Record<string, unknown>> } }).workspace.setup_state['service']!;
    expect(rec).toMatchObject({ state: 'needs-attention', fail_count: 0, warn_count: 1, missing: ['Intake workbook'] });
    expect(rec['waiting']).toBeUndefined();
    const ok = formatBranchCheck({ type: 'service', state: 'ready', health: r.health, items: [{ label: 'a', state: 'warn' }] });
    expect(ok[0]).toBe('Service Portfolio Assessment: ready');
    expect(ok.at(-1)).toBe('  Nothing missing.');
  });

  it('branchStateFromCheck: missing items turn ready into needs-attention; not-set-up and failures stay', () => {
    const ok = { scope: 'llm' as const, probeCount: 2, failCount: 0, warnCount: 0, failedProbes: [], warnedProbes: [] };
    expect(branchStateFromCheck(ok, [{ label: 'a', state: 'ok' }])).toBe('ready');
    expect(branchStateFromCheck(ok, [{ label: 'a', state: 'missing' }])).toBe('needs-attention');
    expect(branchStateFromCheck(ok, [{ label: 'a', state: 'warn' }])).toBe('ready');
    expect(branchStateFromCheck(undefined, [{ label: 'a', state: 'missing' }])).toBe('not-set-up');
  });
});

describe('swao setup --type (#4197)', () => {
  const ready = { type: 'application' as const, state: 'ready' as const, health: { scope: 'application' as const, probeCount: 15, failCount: 0, warnCount: 0, failedProbes: [], warnedProbes: [] }, items: [] };

  it('--non-interactive prints the branch result and exits 0 when ready, 1 when it needs attention', async () => {
    const d = ws();
    const seen: string[] = [];
    const ok = await run(['--type', 'application', '--non-interactive', '--workspace', d], { tier: () => 'community', check: async (w, t) => { seen.push(`${w === d}:${t}`); return ready; } });
    expect(seen).toEqual(['true:application']);
    expect(ok.code).toBe(0);
    expect(ok.out[0]).toBe('Application Assessment: ready');
    const bad = await run(['--type', 'landing-zone-live', '--non-interactive', '--workspace', d], { tier: () => 'enterprise', check: async () => ({ ...ready, type: 'lz-live', state: 'needs-attention' }) });
    expect(bad.code).toBe(1);
  });

  it('without a terminal, --type alone is non-interactive; with a terminal it opens the branch in the wizard', async () => {
    const d = ws();
    const opened: Array<string | undefined> = [];
    const noTty = await run(['--type', 'llm', '--workspace', d], { tier: () => 'community', isTty: () => false, check: async () => ({ ...ready, type: 'llm' }) });
    expect(noTty.out[0]).toBe('LLM Assessment: ready');
    const cwd = process.cwd();
    try {
      await run(['--type', 'llm', '--workspace', d], { tier: () => 'community', isTty: () => true, openTui: async (t) => { opened.push(`${t}@${process.cwd() === d}`); } });
    } finally {
      process.chdir(cwd);
    }
    await run([], { tier: () => 'community', isTty: () => true, openTui: async (t) => { opened.push(t); } });
    expect(opened).toEqual(['llm@true', undefined]);
  });

  it('the interactive branch setup refuses a missing workspace (its steps would write nowhere)', async () => {
    const opened: Array<string | undefined> = [];
    const r = await run(['--type', 'llm', '--workspace', join(tmpdir(), 'swao-no-such-ws-4197-i')], { tier: () => 'community', isTty: () => true, openTui: async (t) => { opened.push(t); } });
    expect(r.code).toBe(2);
    expect(opened).toEqual([]);
  });

  it('refuses an unknown type, --non-interactive without --type, a gated type and a missing workspace', async () => {
    expect((await run(['--type', 'audit'], { tier: () => 'enterprise' })).code).toBe(2);
    expect((await run(['--non-interactive'], { tier: () => 'enterprise' })).code).toBe(2);
    const gated = await run(['--type', 'lz-live', '--non-interactive'], { tier: () => 'community' });
    expect(gated.code).toBe(2);
    expect(gated.out.join('\n')).toContain('needs the consultant tier');
    const missing = await run(['--type', 'llm', '--non-interactive', '--workspace', join(tmpdir(), 'swao-no-such-ws-4197')], { tier: () => 'enterprise' });
    expect(missing.code).toBe(2);
  });
});
