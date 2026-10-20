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

// `swao service` command tree (#3075). The scaffold itself is covered end-to-end in
// @swao/module-service-assessment/src/__tests__/scaffold-e2e.test.ts.
import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import type { ServiceInitResult } from '@swao/module-service-assessment';
import type { ServiceResearchResult } from '@swao/module-service-assessment';
import { runPortfolioExport } from '@swao/module-service-export';
import { ensureServiceWorkspace, formatServiceInitSummary, formatServiceRank, formatServiceResearchSummary, registerService, resolveResearchLlm, runServiceExportCli, runServiceInitCli, runServiceRankCli, runServiceResearchCli, serviceExportUnavailable } from './service.js';
import { _paths, buildLicenseKey, LicenseGuard, LicenseTierError } from '../license/license-guard.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function program(): Command {
  const p = new Command();
  p.exitOverride();
  p.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerService(p);
  return p;
}

describe('swao service command tree (#3075)', () => {
  it('registers service with init and research subcommands', () => {
    const service = program().commands.find((c) => c.name() === 'service')!;
    expect(service).toBeDefined();
    expect(service.commands.map((c) => c.name())).toEqual(['init', 'research', 'export', 'rank']);
    const init = service.commands.find((c) => c.name() === 'init')!;
    expect(init.options.map((o) => o.long)).toEqual(['--from', '--mapping', '--workspace', '--refresh', '--cluster-threshold', '--json']);
    const research = service.commands.find((c) => c.name() === 'research')!;
    expect(research.options.map((o) => o.long)).toEqual(['--app', '--workspace', '--refresh', '--dry-run', '--skip-llm', '--json']);
  });

  it('init without --from looks in wsp/inputs/service-intake/ and fails without a prompt when it is empty (#3211)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-svc-nofrom-'));
    dirs.push(dir);
    await expect(runServiceInitCli({ workspace: dir })).rejects.toThrow(/no intake workbook found: put one \.xlsx file into .*service-intake/);
    // Nothing is created when the intake is missing.
    expect(existsSync(join(dir, '.swao.yml'))).toBe(false);
  });

  it('init without --from uses the workbook in wsp/inputs/service-intake/ (#3211)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-svc-intake-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'wsp', 'inputs', 'service-intake'), { recursive: true });
    writeFileSync(join(dir, 'wsp', 'inputs', 'service-intake', 'inventory.xlsx'), 'not a real workbook');
    // The file is found (no location error); it then fails as an unreadable workbook.
    await expect(runServiceInitCli({ workspace: dir })).rejects.not.toThrow(/no intake workbook found|intake file not found/);
  });
});

describe('swao service rank (#3165)', () => {
  it('rejects a bad --top and a missing workspace, and formats the ranking', () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-svc-rank-'));
    dirs.push(dir);
    expect(() => runServiceRankCli({ workspace: dir })).toThrow(/no SWAO workspace found/);
    writeFileSync(join(dir, '.swao.yml'), 'wsp_version: "0.9"\n');
    expect(() => runServiceRankCli({ workspace: dir, top: '0' })).toThrow(/positive integer/);
    expect(runServiceRankCli({ workspace: dir, top: '5' }).apps).toEqual([]);
    expect(formatServiceRank([])).toMatch(/No service apps to assess/);
    const text = formatServiceRank([{ id: 'hosapp001', name: 'X', risk_score: 70, fan_in: 2, time_quadrant: 'Migrate', operational_status: 'active', evidence: 'sufficient' }]);
    expect(text).toContain('  1. hosapp001  risk 70  fan-in 2  TIME Migrate');
    expect(text).not.toContain('not assessed');
    expect(text).toContain('swao assess --app <id> --type service');
  });

  it('marks apps without a service assessment run and keeps their rank (#3290, Design 110 D-24)', () => {
    const text = formatServiceRank([
      { id: 'hosapp001', name: 'X', risk_score: 70, fan_in: 2, time_quadrant: 'Migrate', operational_status: 'active', evidence: 'not_assessed' },
      { id: 'hosapp002', name: 'Y', risk_score: 40, fan_in: 0, time_quadrant: 'Tolerate', operational_status: 'active', evidence: 'sufficient' },
    ]);
    expect(text).toContain('  1. hosapp001  risk 70  fan-in 2  TIME Migrate  [not assessed]');
    expect(text).toMatch(/ {2}2\. hosapp002 {2}risk 40 {2}fan-in 0 {2}TIME Tolerate$/m);
    expect(text).toContain('1 app(s) marked [not assessed]: no service assessment run yet');
  });
});

describe('ensureServiceWorkspace', () => {
  it('creates a workspace .swao.yml when the target has none, and reuses it afterwards', () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-svc-ws-'));
    dirs.push(dir);
    expect(ensureServiceWorkspace(dir)).toEqual({ path: dir, created: true });
    expect(readFileSync(join(dir, '.swao.yml'), 'utf-8')).toMatch(/SWAO workspace configuration/);
    expect(ensureServiceWorkspace(dir)).toEqual({ path: dir, created: false });
  });
});

describe('runServiceInitCli input validation', () => {
  it('rejects a missing intake file and a bad cluster threshold before touching the workspace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-svc-val-'));
    dirs.push(dir);
    await expect(runServiceInitCli({ from: join(dir, 'missing.xlsx'), workspace: dir })).rejects.toThrow(/intake file not found/);
    expect(existsSync(join(dir, '.swao.yml'))).toBe(false);
    await expect(runServiceInitCli({ from: fileURLToPath(import.meta.url), workspace: dir, clusterThreshold: '1' })).rejects.toThrow(/at least 2/);
  });
});

describe('swao service research (#3086)', () => {
  it('fails clearly outside a workspace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-svc-res-'));
    dirs.push(dir);
    await expect(runServiceResearchCli({ workspace: dir }, () => {})).rejects.toThrow(/no SWAO workspace found/);
  });

  it('summarises the confidence distribution and the dry-run plan', () => {
    const apps = [
      { appId: 'hospacs004', composite: 'medium', topicConfidence: {}, topics: { 'cve-summary': 'created', 'eol-status': 'unchanged', virustotal: 'refreshed' } },
      { appId: 'hosapp001', composite: null, topicConfidence: {}, topics: { 'cve-summary': 'unchanged' } },
    ];
    const done = {
      apps, distribution: { high: 0, medium: 1, low: 0, none: 1 }, dryRun: false,
      topicDistribution: { 'cve-summary': { high: 0, medium: 0, low: 1, none: 1 }, 'eol-status': { high: 2, medium: 0, low: 0, none: 0 } },
    } as unknown as ServiceResearchResult;
    // #3168: the composite plus one line per topic, so a weak CVE match does not hide a strong EoL result
    expect(formatServiceResearchSummary(done).split('\n')).toEqual([
      'Research complete: 2 app(s)',
      '  Confidence (composite, weakest topic per app): high: 0, medium: 1, low: 0, nothing to look up: 1',
      '    cve-summary  high: 0, medium: 0, low: 1, nothing to look up: 1',
      '    eol-status   high: 2, medium: 0, low: 0',
    ]);
    const plan = formatServiceResearchSummary({ ...done, dryRun: true });
    expect(plan).toContain('hospacs004: cve-summary create, virustotal refresh');
    expect(plan).toContain('hosapp001: up to date');
  });

  it('names the LLM topics skipped without an LLM, with the stub count and how to enable them in any tier (#3289)', () => {
    const done = {
      apps: [{ appId: 'a', composite: null, topicConfidence: {}, topics: {} }, { appId: 'b', composite: null, topicConfidence: {}, topics: {} }],
      distribution: { high: 0, medium: 0, low: 0, none: 2 }, topicDistribution: {}, dryRun: false,
      llmTopics: ['vendor-profile', 'certifications', 'data-residency', 'breach-history'], llm: null, llmSkipReason: 'no_llm_configured',
    } as unknown as ServiceResearchResult;
    const line = formatServiceResearchSummary(done).split('\n').find((l) => l.includes('Not researched'));
    expect(line).toBe('  Not researched: 4 LLM topic(s) per app (vendor-profile, certifications, data-residency, breach-history), 8 stub(s) in total, because no LLM provider is configured. LLM-augmented research is available in every licence tier: configure providers.llm.primary in .swao.yml (or run swao setup) and run swao service research again.');
    const unavailable = formatServiceResearchSummary({ ...done, llmSkipReason: 'llm_unavailable' } as ServiceResearchResult);
    expect(unavailable).toContain('because the configured LLM provider could not be used');
  });

  it('names the LLM that researched the four topics and aligns the longer topic names (#3289)', () => {
    const done = {
      apps: [{ appId: 'a', composite: 'low', topicConfidence: {}, topics: {} }],
      distribution: { high: 0, medium: 0, low: 1, none: 0 }, dryRun: false,
      topicDistribution: { 'cve-summary': { high: 0, medium: 0, low: 1, none: 0 }, 'vendor-profile': { high: 0, medium: 1, low: 0, none: 0 } },
      llmTopics: ['vendor-profile', 'certifications', 'data-residency', 'breach-history'], llm: { provider: 'anthropic', model: 'm1' }, llmSkipReason: null,
    } as unknown as ServiceResearchResult;
    const lines = formatServiceResearchSummary(done).split('\n');
    expect(lines).toContain('    cve-summary    high: 0, medium: 0, low: 1');
    expect(lines).toContain('    vendor-profile high: 0, medium: 1, low: 0');
    expect(lines.find((l) => l.startsWith('  LLM research:'))).toBe('  LLM research: vendor-profile, certifications, data-residency, breach-history via anthropic / m1. Findings and sources are model-cited and unverified until an analyst reviews them (reviewed_by).');
    expect(lines.some((l) => l.includes('Not researched'))).toBe(false);
  });

  it('reports the RESEARCH signal total when research wrote signals (#3154)', () => {
    const apps = [
      { appId: 'hospacs004', composite: 'medium', topicConfidence: {}, topics: {}, signalCount: 5 },
      { appId: 'hosapp001', composite: null, topicConfidence: {}, topics: {}, signalCount: 0 },
    ];
    const done = { apps, distribution: { high: 0, medium: 1, low: 0, none: 1 }, dryRun: false } as unknown as ServiceResearchResult;
    expect(formatServiceResearchSummary(done)).toContain('RESEARCH signals: 5 across 1 app(s)');
  });

  it('names --skip-llm as the reason the LLM topics were not researched (#3304)', () => {
    const done = {
      apps: [{ appId: 'a', composite: null, topicConfidence: {}, topics: {} }],
      distribution: { high: 0, medium: 0, low: 0, none: 1 }, topicDistribution: {}, dryRun: false,
      llmTopics: ['vendor-profile', 'certifications', 'data-residency', 'breach-history'], llm: null, llmSkipReason: 'skipped_by_user',
    } as unknown as ServiceResearchResult;
    const lines = formatServiceResearchSummary(done).split('\n').filter((l) => l.includes('Not researched'));
    expect(lines).toEqual(['  Not researched: 4 LLM topic(s) per app (vendor-profile, certifications, data-residency, breach-history), skipped by --skip-llm. Earlier LLM findings were kept; run swao service research without --skip-llm to research them.']);
  });

  it('--skip-llm does not build the configured LLM provider, so a broken provider prints no warning (#3304)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-svc-skipllm-'));
    dirs.push(dir);
    writeFileSync(join(dir, '.swao.yml'), 'wsp_version: "0.9"\nproviders:\n  llm:\n    primary:\n      connector: missing-gw-3304\n');
    const withLlm: string[] = [];
    await expect(runServiceResearchCli({ workspace: dir }, (l) => withLlm.push(l))).rejects.toThrow(/no service apps/);
    expect(withLlm.some((l) => l.startsWith('[warn] LLM research skipped'))).toBe(true);
    const skipped: string[] = [];
    await expect(runServiceResearchCli({ workspace: dir, skipLlm: true }, (l) => skipped.push(l))).rejects.toThrow(/no service apps/);
    expect(skipped.some((l) => l.includes('LLM research skipped'))).toBe(false);
  });
});

describe('formatServiceInitSummary', () => {
  it('lists the SCAFFOLD signal count and the apps that need manual classification (G-05)', () => {
    const result = {
      ok: true,
      apps: [{ appId: 'hoscix-cluster', members: ['a', 'b', 'c'] }, { appId: 'hosapp045', members: [] }],
      write: { created: ['hoscix-cluster', 'hosapp045'], refreshed: [], skippedExisting: [], conflicts: [], signalsFile: 'wsp/signals/scaffold-signals.json' },
      signals: [{}, {}, {}],
      warnings: [],
      unknownAppIds: ['hosapp045'],
      rowCount: 4,
    } as unknown as ServiceInitResult;
    const text = formatServiceInitSummary(result, '/ws');
    expect(text).toMatch(/SCAFFOLD signals : 3/);
    expect(text).toMatch(/Clusters\s+: hoscix-cluster \(3 members\)/);
    expect(text).toMatch(/1 app\(s\) could not be auto-classified\. Review and assign infra_category manually/);
    expect(text).toMatch(/apps\/hosapp045\/\.swao\.yml/);
  });

  it('reports the recognised columns and warns about missing research inputs (#3168)', () => {
    const result = {
      ok: true, rowCount: 1, apps: [], signals: [], unknownAppIds: [], warnings: [],
      write: { created: [], refreshed: [], skippedExisting: [], conflicts: [], notInIntake: [], signalsFile: 's.json' },
      columns: [{ sheet: 'Tabelle1', mapping: 'default', fields: { id_name_combined: 'A', os: 'I', cpu_cores: 'B' } }],
    } as unknown as ServiceInitResult;
    const text = formatServiceInitSummary(result, '/ws');
    expect(text).toContain('Columns (Tabelle1, header detection): 3 recognised: id_name_combined A, cpu_cores B, os I');
    expect(text).toContain('[warn] Not in the intake: vendor name (CVE research).');
    expect(text).not.toMatch(/Not in the intake:.*os \(end-of-life/);
  });

  it('warns about existing service apps that this intake no longer produces (#3167)', () => {
    const result = {
      ok: true, rowCount: 1, apps: [], signals: [], unknownAppIds: [], warnings: [],
      write: { created: ['hosapp145'], refreshed: [], skippedExisting: [], conflicts: [], notInIntake: ['hosapp145-econ4-note', 'a', 'b', 'c', 'd', 'e'], signalsFile: 's.json' },
    } as unknown as ServiceInitResult;
    const text = formatServiceInitSummary(result, '/ws');
    expect(text).toContain('[warn] 6 existing service app(s) are not in this intake');
    expect(text).toContain('hosapp145-econ4-note, a, b, c, d, +1 more');
    expect(text).toContain('scaffold into a fresh workspace');
  });

  it('explains a duplicate-ID halt', () => {
    const text = formatServiceInitSummary({ ok: false, reason: 'duplicate_ids', duplicateIds: ['hosapp001'], signals: [], warnings: [] }, '/ws');
    expect(text).toMatch(/\[error\] Scaffold halted: 1 duplicate app ID\(s\); no folders were written/);
  });
});

describe('swao service export tier gate (#3117, #3119)', () => {
  let home = '';
  const saved = { ..._paths };
  const savedTier = process.env['SWAO_BINARY_TIER'];
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'swao-service-export-lic-'));
    dirs.push(home);
    _paths.statePath = join(home, '.swao-state.json');
    _paths.licensePath = join(home, '.swao-license.json');
    _paths.legacyLicencePath = join(home, '.swao-license-legacy.json');
    delete process.env['SWAO_BINARY_TIER'];
  });
  afterEach(() => {
    Object.assign(_paths, saved);
    if (savedTier === undefined) delete process.env['SWAO_BINARY_TIER'];
    else process.env['SWAO_BINARY_TIER'] = savedTier;
  });
  const enterprise = () => {
    const fp = LicenseGuard.load().state.fingerprint.substring(0, 8);
    const key = buildLicenseKey({ v: 1, tier: 'enterprise', licensee: 'TestOrg', email: 'test@example.com', exp: '2099-12-31', assessment_limit: null, fp, iat: '2026-10-10' });
    writeFileSync(_paths.licensePath, JSON.stringify({ key, activated_at: '2026-10-10', tier: 'enterprise', exp: '2099-12-31', licensee: 'TestOrg' }), 'utf-8');
  };
  const workspace = () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-service-export-'));
    dirs.push(ws);
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\n');
    mkdirSync(join(ws, 'apps', 'hosapp001'), { recursive: true });
    writeFileSync(join(ws, 'apps', 'hosapp001', '.swao.yml'), 'app_id: hosapp001\nassessment:\n  type: service\ndisposition:\n  operational_status: active\nintegrations: []\n');
    return ws;
  };

  it('rejects a Community licence before writing anything', async () => {
    const ws = workspace();
    await expect(runServiceExportCli({ workspace: ws })).rejects.toBeInstanceOf(LicenseTierError);
    expect(existsSync(join(ws, 'wsp', 'reports'))).toBe(false);
  });

  it('SWAO_BINARY_TIER=community caps an Enterprise licence', async () => {
    enterprise();
    process.env['SWAO_BINARY_TIER'] = 'community';
    await expect(runServiceExportCli({ workspace: workspace() })).rejects.toBeInstanceOf(LicenseTierError);
  });

  it('writes the workbook and 9 star-schema tables for an Enterprise licence', async () => {
    enterprise();
    const r = await runServiceExportCli({ workspace: workspace() }, runPortfolioExport);
    expect(r.appCount).toBe(1);
    expect(existsSync(r.workbook)).toBe(true);
    expect(r.starSchema).toHaveLength(9);
  });

  it('rejects a Community licence before the injected export runs (#3353)', async () => {
    let called = false;
    const ws = workspace();
    await expect(runServiceExportCli({ workspace: ws }, async () => { called = true; return { workbook: '', starSchema: [], appCount: 1 }; })).rejects.toBeInstanceOf(LicenseTierError);
    expect(called).toBe(false);
  });

  it('the Community / Consultant slot refuses with LicenseTierError and writes nothing, even past the gate (#3353)', async () => {
    enterprise();
    const ws = workspace();
    await expect(runServiceExportCli({ workspace: ws })).rejects.toBeInstanceOf(LicenseTierError);
    await expect(serviceExportUnavailable(ws)).rejects.toMatchObject({ required: 'enterprise', feature: 'service-excel' });
    expect(existsSync(join(ws, 'wsp', 'reports'))).toBe(false);
  });
});

// #3289: the workspace LLM for the four LLM research topics, built through the provider factory (no tier gate).
describe('resolveResearchLlm (#3289)', () => {
  const envKeys = ['SWAO_LLM_PROVIDER', 'SWAO_LLM_CONNECTOR'] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of envKeys) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of envKeys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  const fake = { name: 'stub', model: 'fake-model', complete: async () => '{}' };
  function ws(yml: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'swao-svc-llm-'));
    dirs.push(dir);
    writeFileSync(join(dir, '.swao.yml'), yml);
    return dir;
  }

  it('returns no LLM and never calls the factory when none is configured', () => {
    const factory = vi.fn();
    expect(resolveResearchLlm(ws('wsp_version: "0.9"\n'), factory as never)).toEqual({ llm: null });
    expect(factory).not.toHaveBeenCalled();
  });

  it('builds the provider from providers.llm.primary with the workspace root, so max_concurrency applies', () => {
    const dir = ws('providers:\n  llm:\n    primary:\n      type: anthropic\n      model: m1\n');
    const factory = vi.fn(() => fake);
    const r = resolveResearchLlm(dir, factory as never);
    expect(r.llm).toBe(fake);
    expect(factory).toHaveBeenCalledWith(undefined, 'service-research', expect.objectContaining({ type: 'anthropic', model: 'm1', workspaceRoot: dir }));
  });

  it('honours SWAO_LLM_PROVIDER without a .swao.yml block', () => {
    process.env['SWAO_LLM_PROVIDER'] = 'ollama';
    const factory = vi.fn(() => fake);
    expect(resolveResearchLlm(ws('wsp_version: "0.9"\n'), factory as never).llm).toBe(fake);
  });

  it('reports llm_unavailable with the reason when the configured provider cannot be built', () => {
    const dir = ws('providers:\n  llm:\n    primary:\n      connector: missing-gw\n');
    const r = resolveResearchLlm(dir, (() => { throw new Error("Unknown LLM connector 'missing-gw'."); }) as never);
    expect(r).toEqual({ llm: null, skipReason: 'llm_unavailable', detail: "Unknown LLM connector 'missing-gw'." });
  });
});
