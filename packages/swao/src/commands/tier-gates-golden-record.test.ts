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

// Per-tier licence gate tests against the SWAO
// licence tier matrix (#3318, #3320, #3321,
// #3323, #3324). Each tier runs with a real signed licence (Community: none)
// in an isolated licence directory; the commands are driven through Commander
// with process.exit intercepted. A licence failure must print the [LICENSE]
// block and exit non-zero, never throw a stack trace or exit 0.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';

vi.mock('../tui/run-app.js', () => ({ runTuiInAltScreen: vi.fn(async () => undefined) }));

import {
  _paths,
  LicenseGuard,
  LicenseInvalidError,
  buildLicenseKey,
  FEATURE_GATES,
} from '../license/license-guard.js';
import type { LicensePayload } from '../license/license-guard.js';
import { registerChat, gateChat } from './chat.js';
import { registerReport, type ReportDeps } from './report.js';
import { registerUnipipe } from './unipipe.js';
import { scaffoldPowerBiTemplates, runWorkspaceScaffolders } from './init.js';
import { registerCommunityTierStubs } from '../tiers/community-stubs.js';
import { runTuiInAltScreen } from '../tui/run-app.js';

type Tier = 'community' | 'consultant' | 'enterprise';
const TIERS: Tier[] = ['community', 'consultant', 'enterprise'];

const TEMP_HOME = join(tmpdir(), `swao-tier-golden-${process.pid}`);
let savedBinaryTier: string | undefined;

beforeEach(() => {
  mkdirSync(TEMP_HOME, { recursive: true });
  _paths.statePath = join(TEMP_HOME, '.swao-state.json');
  _paths.licensePath = join(TEMP_HOME, 'licence.json');
  _paths.legacyLicencePath = join(TEMP_HOME, '.swao-license-legacy.json');
  if (existsSync(_paths.licensePath)) rmSync(_paths.licensePath);
  writeFileSync(_paths.statePath, JSON.stringify({ first_run: '2026-04-28', assessment_count: 0, fingerprint: 'abc123de' }), 'utf-8');
  savedBinaryTier = process.env['SWAO_BINARY_TIER'];
  delete process.env['SWAO_BINARY_TIER'];
});

afterEach(() => {
  if (savedBinaryTier === undefined) delete process.env['SWAO_BINARY_TIER'];
  else process.env['SWAO_BINARY_TIER'] = savedBinaryTier;
  vi.restoreAllMocks();
  rmSync(TEMP_HOME, { recursive: true, force: true });
});

function useTier(tier: Tier): void {
  if (tier === 'community') return;
  const fp = LicenseGuard.load().state.fingerprint.substring(0, 8);
  const payload: LicensePayload = {
    v: 1, tier, licensee: 'TestOrg', email: 'test@example.com',
    exp: '2027-12-31', assessment_limit: null, fp, iat: '2026-04-28',
  };
  writeFileSync(
    _paths.licensePath,
    JSON.stringify({ key: buildLicenseKey(payload), activated_at: '2026-04-28', tier, exp: payload.exp, licensee: payload.licensee }),
    'utf-8',
  );
  expect(LicenseGuard.load().state.tier).toBe(tier);
}

interface RunResult { out: string; err: string; exitCode: number | undefined; threw?: Error }

async function run(register: (p: Command) => void, args: string[]): Promise<RunResult> {
  const out: string[] = [];
  const err: string[] = [];
  let exitCode: number | undefined;
  let threw: Error | undefined;
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.join(' ')); });
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { err.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { err.push(a.join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { exitCode = code ?? 0; throw new Error('__exit__'); }) as typeof process.exit);
  const program = new Command('swao').exitOverride();
  register(program);
  try {
    await program.parseAsync(args, { from: 'user' });
  } catch (e) {
    if ((e as Error).message !== '__exit__') threw = e as Error;
  }
  vi.restoreAllMocks();
  return { out: out.join('\n'), err: err.join('\n'), exitCode, threw };
}

// ---------------------------------------------------------------------------
// #3318 swao chat (F-112, Enterprise)
// ---------------------------------------------------------------------------

describe('#3318 swao chat licence gate (FEATURE_GATES chat = enterprise)', () => {
  it('FEATURE_GATES maps chat to enterprise', () => {
    expect(FEATURE_GATES['chat']).toBe('enterprise');
  });

  it.each(['community', 'consultant'] as const)('%s: prints the [LICENSE] block and exits 1 without opening the TUI', async (tier) => {
    useTier(tier);
    const r = await run(registerChat, ['chat']);
    expect(r.threw).toBeUndefined();
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain('[LICENSE] swao chat requires an Enterprise licence.');
    expect(r.err).toContain(`Your current tier: ${tier}`);
    expect(r.err).not.toContain('LicenseTierError');
    expect(vi.mocked(runTuiInAltScreen)).not.toHaveBeenCalled();
  });

  it('enterprise: the gate passes', () => {
    useTier('enterprise');
    expect(() => gateChat()).not.toThrow();
  });

  it('an invalid licence prints [LICENSE] Invalid licence and exits 3', async () => {
    vi.spyOn(LicenseGuard, 'load').mockImplementation(() => { throw new LicenseInvalidError('licence expired', 'expired'); });
    const r = await run(registerChat, ['chat']);
    expect(r.threw).toBeUndefined();
    expect(r.exitCode).toBe(3);
    expect(r.err).toContain('[LICENSE] Invalid licence: licence expired');
  });
});

// ---------------------------------------------------------------------------
// #3320 report --format html (F-082, Consultant+)
// ---------------------------------------------------------------------------

describe('#3320 report --format html licence gate (FEATURE_GATES html-report = consultant)', () => {
  function registerWithSpy(renderHtml: ReportDeps['renderHtml']) {
    return (p: Command) => registerReport(p, { runForApp: async () => ({ ok: true }) as never, renderHtml });
  }

  it('community: [LICENSE] block, exit 1, renderer never called', async () => {
    const renderHtml = vi.fn(async () => 'x.html');
    const ws = mkdtempSync(join(tmpdir(), 'swao-report-html-'));
    try {
      const r = await run(registerWithSpy(renderHtml), ['report', '--app', 'demo', '--format', 'html', '--workspace', ws]);
      expect(r.threw).toBeUndefined();
      expect(r.exitCode).toBe(1);
      expect(r.err).toContain('[LICENSE] swao report --format html (HTML Report) requires a Consultant licence.');
      expect(renderHtml).not.toHaveBeenCalled();
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it.each(['consultant', 'enterprise'] as const)('%s: passes the licence gate', async (tier) => {
    useTier(tier);
    const ws = mkdtempSync(join(tmpdir(), 'swao-report-html-'));
    try {
      const r = await run(registerWithSpy(vi.fn(async () => 'x.html')), ['report', '--app', 'demo', '--format', 'html', '--workspace', ws]);
      expect(r.err).not.toContain('[LICENSE]');
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('community keeps text output (no licence block for --format text)', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-report-text-'));
    try {
      const r = await run(registerWithSpy(undefined), ['report', '--app', 'demo', '--format', 'text', '--workspace', ws]);
      expect(r.err).not.toContain('[LICENSE]');
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('--format help no longer says html is Community', async () => {
    const program = new Command('swao');
    registerReport(program, { runForApp: async () => ({ ok: true }) as never });
    const help = program.commands.find((c) => c.name() === 'report')!.helpInformation();
    expect(help).not.toContain('html is Community');
    expect(help.replace(/\s+/g, ' ')).toContain('pdf and html require Consultant or Enterprise');
  });
});

// ---------------------------------------------------------------------------
// #3321 / #3323 Community binary stubs
// ---------------------------------------------------------------------------

describe('#3321 / #3323 Community tier stubs (community-stubs.ts)', () => {
  function registerCommunity(p: Command): void {
    p.command('lz').command('catalogue').description('CSP service catalogues');
    registerCommunityTierStubs(p);
  }

  it.each([['generate-tf'], ['tf-gen'], ['generate-tf', '--help']])('`swao %s` prints the Enterprise [LICENSE] block and exits 2', async (...args) => {
    const r = await run(registerCommunity, args);
    expect(r.exitCode).toBe(2);
    expect(r.err).toContain('[LICENSE] swao generate-tf requires an Enterprise licence.');
    expect(r.err).not.toContain('Consultant');
  });

  it('`swao lz catalogue update --provider azure --dry-run ...` prints the Consultant [LICENSE] block and exits 2', async () => {
    const r = await run(registerCommunity, ['lz', 'catalogue', 'update', '--provider', 'azure', '--dry-run', '--skip-prices', '--catalogues-dir', TEMP_HOME]);
    expect(r.threw).toBeUndefined();
    expect(r.exitCode).toBe(2);
    expect(r.err).toContain('[LICENSE] swao lz catalogue update requires a Consultant or Enterprise licence.');
    expect(r.err).not.toContain('unknown command');
  });

  it('help lists generate-tf as (Enterprise) and lz catalogue update as (Consultant+)', () => {
    const program = new Command('swao');
    registerCommunity(program);
    const help = program.helpInformation().replace(/\s+/g, ' ');
    expect(help).toMatch(/generate-tf\|tf-gen Generate Terraform modules for sovereign landing zone \(Enterprise\)/);
    expect(help).not.toMatch(/generate-tf[^(]*\(Consultant/);
    const catalogue = program.commands.find((c) => c.name() === 'lz')!.commands.find((c) => c.name() === 'catalogue')!;
    expect(catalogue.helpInformation().replace(/\s+/g, ' ')).toMatch(/update Refresh the LZ service catalogue[^(]*\(Consultant\+\)/);
  });

  it('unipipe and challenge stubs name the Enterprise licence', async () => {
    for (const cmd of ['unipipe', 'challenge']) {
      const r = await run(registerCommunity, [cmd]);
      expect(r.exitCode).toBe(2);
      expect(r.err).toContain(`[LICENSE] swao ${cmd} requires an Enterprise licence.`);
    }
  });
});

// ---------------------------------------------------------------------------
// #3324 unipipe (Enterprise roadmap, D-04) on the Consultant / Enterprise binaries
// ---------------------------------------------------------------------------

describe('#3324 swao unipipe licence gate (FEATURE_GATES unipipe = enterprise)', () => {
  it.each(['community', 'consultant'] as const)('%s: [LICENSE] block, exit 1', async (tier) => {
    useTier(tier);
    const r = await run(registerUnipipe, ['unipipe']);
    expect(r.threw).toBeUndefined();
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain('[LICENSE] swao unipipe requires an Enterprise licence.');
  });

  it('enterprise: coming-soon notice, exit 0', async () => {
    useTier('enterprise');
    const r = await run(registerUnipipe, ['unipipe']);
    expect(r.exitCode).toBeUndefined();
    expect(r.out).toContain('coming soon');
    expect(r.err).not.toContain('[LICENSE]');
  });
});

// ---------------------------------------------------------------------------
// #3324 Power BI templates at workspace scaffold (F-088, Consultant+)
// ---------------------------------------------------------------------------

describe('#3324 scaffoldPowerBiTemplates follows FEATURE_GATES bi-templates (consultant)', () => {
  it('FEATURE_GATES maps bi-templates to consultant, generate-tf and unipipe to enterprise', () => {
    expect(FEATURE_GATES['bi-templates']).toBe('consultant');
    expect(FEATURE_GATES['generate-tf']).toBe('enterprise');
    expect(FEATURE_GATES['unipipe']).toBe('enterprise');
  });

  it.each(TIERS)('%s', (tier) => {
    useTier(tier);
    const ws = mkdtempSync(join(tmpdir(), 'swao-init-pbit-'));
    try {
      const result = scaffoldPowerBiTemplates(ws);
      const dirExists = existsSync(result.templatesDir);
      if (tier === 'community') {
        expect(dirExists).toBe(false);
        expect(result.copiedFiles).toEqual([]);
      } else {
        expect(dirExists).toBe(true);
        expect(readdirSync(result.templatesDir).length + result.warnings.length).toBeGreaterThan(0);
      }
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});

// #3338: the Setup Wizard (InitStep) and `swao init` both route through
// runWorkspaceScaffolders; Community never gets a .pbit, Consultant+ does.
describe('#3338 runWorkspaceScaffolders (Setup Wizard and swao init) writes .pbit only on Consultant+', () => {
  const pbitFiles = (dir: string): string[] => {
    const out: string[] = [];
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.toLowerCase().endsWith('.pbit')) out.push(e.name);
      }
    };
    walk(dir);
    return out;
  };

  it.each(TIERS)('%s', (tier) => {
    useTier(tier);
    const ws = mkdtempSync(join(tmpdir(), 'swao-wizard-pbit-'));
    try {
      runWorkspaceScaffolders(ws);
      const found = pbitFiles(ws);
      if (tier === 'community') expect(found).toEqual([]);
      else expect(found.sort()).toEqual(['swao-portfolio.pbit', 'swao-report.pbit']);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
