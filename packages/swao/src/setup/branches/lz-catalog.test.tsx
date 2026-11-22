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

// #4194 SET-05 (Design 125 sections 5.4, 5.7, 9, 11): the Landing Zone
// Catalog branch. Step order and the engine entries after it, the catalogue
// origins and findings, the target check, the targets written to the field
// the assessment preselects (section 5.7), the keep entry keeps, and the layout rules.

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { render as inkRender } from 'ink';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ListBudgetScope, headerRuleWidth } from '@swao/tui-kit';
import type { LzCatalogueListing, LzCatalogueQualityFinding, LzGeographyRegion } from '@swao/module-landing-zone';
import { buildSetupPlan, defaultSetupRegistry, readLzCatalogDefaults, type SetupStepProps, type SetupStepResult } from '../index.js';
import {
  checkLzCatalogues,
  checkLzFreshness,
  checkLzTargetItems,
  checkLzTargets,
  listLzCatalogueRows,
  type LzCatalogSources,
} from './lz-catalog-checks.js';
import { LzCatalogCataloguesStep, LzCatalogRefreshStep, LzCatalogTargetsStep, lzCatalogReadySummary } from './lz-catalog.js';

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const DOWN = '\u001B[B';
const ESC = '\u001B';
const UP = String.fromCharCode(27) + '[A';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function ws(yml = 'engagement:\n  name: fixture\n'): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-4194-'));
  dirs.push(d);
  writeFileSync(join(d, '.swao.yml'), yml, 'utf-8');
  return d;
}

const NOW = new Date('2026-11-08T00:00:00Z');

function entry(provider: string, provenance: LzCatalogueListing['provenance'], lastUpdated: string, confidence = 'high'): LzCatalogueListing {
  return {
    provider, file: `${provider}.json`, path: `/x/${provider}.json`, provenance,
    name: `${provider.toUpperCase()} service catalogue`, short_description: provider.toUpperCase(),
    last_updated: lastUpdated, source: 'api', confidence, regions_count: 2,
  };
}

const finding = (rule: LzCatalogueQualityFinding['rule'], severity: LzCatalogueQualityFinding['severity'], provider: string): LzCatalogueQualityFinding =>
  ({ rule, severity, file: `${provider}.json`, provider, message: `${rule} in ${provider}` });

const SOURCES: LzCatalogSources = {
  now: NOW,
  list: () => [
    entry('aws', 'bundled', '2026-10-20'),
    entry('azure', 'workspace', '2026-06-01'),
    entry('acme', 'workspace', '2026-11-01'),
    entry('otc', 'workspace', '2026-11-01', 'operator-declared'),
    { provider: 'gcp', file: 'gcp.json', path: '/x/gcp.json', provenance: 'bundled', error: 'meta block: name: Required' },
  ],
  bundledProviders: () => ['aws', 'azure', 'gcp', 'otc'],
  quality: () => new Map([
    ['bundled:aws', [finding('facts-unsourced', 'warn', 'aws'), finding('target-geography', 'info', 'aws')]],
    ['workspace:azure', [finding('stale', 'warn', 'azure'), finding('catalogue-schema', 'error', 'azure')]],
    ['bundled:azure', [finding('pin-drift', 'error', 'azure')]],
  ]),
};

const REGIONS: Record<string, LzGeographyRegion[]> = {
  otc: [{ id: 'eu-de', sovereignty: { residency_country: 'DE' } }, { id: 'eu-nl', sovereignty: { residency_country: 'NL' } }],
  aws: [{ id: 'eu-central-1', sovereignty: { residency_country: 'DE' } }],
};
const loadRegions = (p: string): LzGeographyRegion[] => {
  const r = REGIONS[p];
  if (!r) throw new Error(`no catalogue ${p}`);
  return r;
};

function props(workspaceRoot: string, results: Array<SetupStepResult | undefined>, tier: SetupStepProps['ctx']['tier'] = 'consultant'): SetupStepProps {
  return {
    ctx: { workspaceRoot, tier, scope: 'lz-catalog', scopeLabel: 'Landing Zone Catalog Assessment', session: {} as SetupStepProps['ctx']['session'] },
    stepNumber: 1,
    stepCount: 5,
    onNext: (r) => results.push(r),
    updateSession: () => {},
    setEscapeCaptured: () => {},
    setGuidanceOpen: () => {},
  };
}

/** Design 125 section 9: no "--", no CLI syntax, no line wider than the header rule. */
function expectLayout(frame: string | undefined): void {
  const width = headerRuleWidth(100);
  for (const line of (frame ?? '').split('\n')) {
    expect(line).not.toContain('--');
    expect(line).not.toMatch(/\bswao\s/);
    expect(line.trimEnd().length).toBeLessThanOrEqual(width);
  }
}

describe('LZ Catalog branch plan (#4194, section 5.4)', () => {
  it('runs Catalogues, Targets, Refresh, then the health check and Ready', () => {
    const plan = buildSetupPlan(defaultSetupRegistry(), { kind: 'branch', type: 'lz-catalog' });
    expect(plan.map((e) => (e.kind === 'step' ? e.step.id : e.kind))).toEqual([
      'lz-catalog.catalogues', 'lz-catalog.targets', 'lz-catalog.refresh', 'health-check', 'ready',
    ]);
    for (const s of defaultSetupRegistry().steps('lz-catalog')) expect(s.check).toBeTypeOf('function');
  });

  it('uses no engine label (Workspace, Health Check, Assessments, Ready) and unique labels', () => {
    const labels = defaultSetupRegistry().steps('lz-catalog').map((s) => s.label);
    for (const l of labels) expect(['Workspace', 'Health Check', 'Assessments', 'Ready']).not.toContain(l);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('catalogue rows (#4194, #1012, #4113)', () => {
  it('names the origin: bundled, workspace copy, user-defined (unknown provider or operator-declared)', () => {
    const rows = listLzCatalogueRows('/ws', SOURCES);
    const byProvider = Object.fromEntries(rows.map((r) => [r.provider, r]));
    expect(byProvider['aws']!.origin).toBe('bundled');
    expect(byProvider['azure']!.origin).toBe('workspace copy');
    expect(byProvider['acme']!.origin).toBe('user-defined');
    expect(byProvider['otc']!.origin).toBe('user-defined');
    expect(byProvider['gcp']!.error).toContain('meta block');
  });

  it('takes the quality findings of the layer the catalogue resolves from, info findings left out', () => {
    const rows = listLzCatalogueRows('/ws', SOURCES);
    const aws = rows.find((r) => r.provider === 'aws')!;
    const azure = rows.find((r) => r.provider === 'azure')!;
    expect([aws.qualityErrors, aws.qualityWarnings, aws.qualityRules]).toEqual([0, 1, ['facts-unsourced']]);
    expect([azure.qualityErrors, azure.qualityWarnings, azure.qualityRules]).toEqual([1, 1, ['catalogue-schema', 'stale']]);
  });

  it('computes the age and flags catalogues older than the threshold', () => {
    const rows = listLzCatalogueRows('/ws', SOURCES);
    expect(rows.find((r) => r.provider === 'aws')).toMatchObject({ ageDays: 19, stale: false });
    expect(rows.find((r) => r.provider === 'azure')).toMatchObject({ ageDays: 160, stale: true });
    expect(checkLzFreshness('/ws', SOURCES)).toEqual([{ label: 'Catalogue age', state: 'warn', detail: 'older than 90 days: azure (160 days)' }]);
  });

  it('check lines: errors are missing, warnings warn, an unreadable meta block is missing', () => {
    const items = Object.fromEntries(checkLzCatalogues('/ws', SOURCES).map((i) => [i.label, i]));
    expect(items['Catalogue aws']!.state).toBe('warn');
    expect(items['Catalogue azure']!.state).toBe('missing');
    expect(items['Catalogue acme']!.state).toBe('ok');
    expect(items['Catalogue gcp']!.state).toBe('missing');
    expect(checkLzCatalogues('/ws', { ...SOURCES, list: () => [] })[0]!.state).toBe('missing');
  });

  it('lists the real catalogues of a fresh workspace as bundled', () => {
    const rows = listLzCatalogueRows(ws(), { now: NOW, quality: () => new Map() });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.origin === 'bundled')).toBe(true);
  });
});

describe('targets check (#4194, #3281)', () => {
  it('accepts regions and geographies, names unknown providers and regions', () => {
    const d = ws('assessment:\n  landing_zone:\n    targets:\n      - otc:eu-de\n      - otc:germany\n      - otc:eu-xx\n      - nope:r1\n');
    expect(checkLzTargets(d, ['otc', 'aws'], loadRegions)).toEqual([
      { label: 'otc:eu-de', valid: true },
      { label: 'otc:germany', valid: true },
      { label: 'otc:eu-xx', valid: false, problem: 'unknown region' },
      { label: 'nope:r1', valid: false, problem: 'unknown provider' },
    ]);
  });

  it('check: missing without targets, ok with valid ones', () => {
    const src = { ...SOURCES, list: () => [entry('otc', 'bundled', '2026-11-01')], loadRegions };
    expect(checkLzTargetItems(ws(), src)[0]!.state).toBe('missing');
    expect(checkLzTargetItems(ws('assessment:\n  landing_zone:\n    targets: [otc:eu-de]\n'), src)).toEqual([{ label: 'LZ targets', state: 'ok', detail: 'otc:eu-de' }]);
  });
});

describe('Targets step (#4194, section 5.7)', () => {
  it('writes the chosen targets to assessment.landing_zone.targets, the field the assessment preselects', async () => {
    const d = ws();
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<LzCatalogTargetsStep {...props(d, results)} listProviders={() => ['aws', 'otc']} loadRegions={loadRegions} />);
    await tick();
    expectLayout(r.lastFrame());
    r.stdin.write(DOWN); await tick();
    r.stdin.write(' '); await tick(); // tick otc
    r.stdin.write('\r'); await tick(); // regions of otc
    expect(r.lastFrame()).toContain('Provider 1 of 1: OTC, T Cloud Public');
    expectLayout(r.lastFrame());
    // #4494: Europe, Germany (DE), eu-de, Netherlands (NL), eu-nl; no geography rows.
    expect(r.lastFrame()).not.toContain('geography');
    for (let i = 0; i < 4; i++) { r.stdin.write(DOWN); await tick(); }
    r.stdin.write(' '); await tick(); // tick eu-nl
    r.stdin.write('\r'); await tick();
    expect(r.lastFrame()).toContain('Targets saved');
    r.stdin.write('\r'); await tick();
    expect(results).toEqual([{ status: 'done', summary: 'LZ targets: otc:eu-nl' }]);
    expect(readLzCatalogDefaults(d).targets).toEqual(['otc:eu-nl']);
    r.unmount();
  });

  it('re-entry preselects the stored targets; the keep entry keeps them and writes nothing; Esc is not a keep (#4341)', async () => {
    const yml = '# keep this comment\nassessment:\n  landing_zone:\n    targets:\n      - otc:eu-de\n';
    const d = ws(yml);
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<LzCatalogTargetsStep {...props(d, results)} listProviders={() => ['aws', 'otc']} loadRegions={loadRegions} />);
    await tick();
    expect(r.lastFrame()).toContain('[x] OTC');
    expect(r.lastFrame()).toContain('[ ] AWS');
    expect(r.lastFrame()).toContain('Keep the current targets and continue');
    r.stdin.write(ESC); await tick();
    expect(results).toEqual([]);
    // #4494 (Design 126 section 4): the cursor starts on the keep entry.
    expect(r.lastFrame().split('\n').find((l) => l.includes('Keep the current targets'))).toContain('❯');
    r.stdin.write('\r'); await tick();
    expect(results).toEqual([{ status: 'kept', summary: 'LZ targets: otc:eu-de' }]);
    expect(readFileSync(join(d, '.swao.yml'), 'utf-8')).toBe(yml);
    r.unmount();
  });
});

describe('Targets step regions grouped by country (#4494)', () => {
  it('a stored geography (otc:germany) shows as its region ticked under Germany; Space on Europe ticks all; confirm writes regions only', async () => {
    const d = ws('assessment:\n  landing_zone:\n    targets:\n      - otc:germany\n');
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<LzCatalogTargetsStep {...props(d, results)} listProviders={() => ['aws', 'otc']} loadRegions={loadRegions} />);
    await tick();
    r.stdin.write(UP); await tick(); // from the keep entry to OTC (ticked: the stored provider)
    r.stdin.write('\r'); await tick();
    const row = (label: string): string => r.lastFrame().split('\n').find((l) => l.includes(label)) ?? 'missing';
    expect(row('Europe')).toContain('[-]');
    expect(row('Germany (DE)')).toContain('[x]');
    expect(row(' eu-de')).toContain('[x]');
    expect(row(' eu-nl')).toContain('[ ]');
    expect(r.lastFrame()).not.toContain('geography');
    // The cursor starts on the ticked region; Up twice reaches the Europe heading.
    expect(row(' eu-de')).toContain('❯');
    r.stdin.write(UP); await tick();
    r.stdin.write(UP); await tick();
    r.stdin.write(' '); await tick(); // Europe ticks all its regions
    expect(row(' eu-nl')).toContain('[x]');
    r.stdin.write('\r'); await tick();
    r.stdin.write('\r'); await tick();
    expect(results).toEqual([{ status: 'done', summary: 'LZ targets: otc:eu-de, otc:eu-nl' }]);
    expect(readLzCatalogDefaults(d).targets).toEqual(['otc:eu-de', 'otc:eu-nl']);
    r.unmount();
  });
});

describe('Catalogues and Refresh steps (#4194)', () => {
  it('Catalogues lists provider names and findings within the layout rules; Enter continues', async () => {
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<LzCatalogCataloguesStep {...props('/ws', results)} sources={SOURCES} />);
    await tick();
    const frame = r.lastFrame() ?? '';
    // #4296: provider names and the quality state; origin and date are in the guidance box.
    // #4254 (run 9): central StatusRows, status column first (Design 126 M-06).
    expect(frame).toMatch(/\[warn\] +AWS +Amazon Web Services +1 warning\(s\): facts-unsourced/);
    expect(frame).toMatch(/\[ok\] +ACME +no quality findings/);
    expect(frame).toMatch(/\[fail\] +GCP +Google Cloud Platform +meta block unreadable/);
    expect(frame).not.toContain('2026-10-20 (19 days)');
    expectLayout(frame);
    r.stdin.write('\r'); await tick();
    expect(results).toEqual([{ status: 'kept', summary: '5 LZ catalogue(s), 3 with findings' }]);
    r.unmount();
  });

  it('Refresh offers the update for stale catalogues, with the tier note on Community', async () => {
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<LzCatalogRefreshStep {...props('/ws', results)} sources={SOURCES} />);
    await tick();
    expect(r.lastFrame()).toContain('Azure, Microsoft Azure  workspace copy  2026-06-01 (160 days)');
    expect(r.lastFrame()).toContain('Tools, Update LZ Catalogue');
    expectLayout(r.lastFrame());
    r.stdin.write('\r'); await tick();
    expect(results).toEqual([{ status: 'skipped', summary: '1 LZ catalogue(s) older than 90 days' }]);
    r.unmount();
    const c = render(<LzCatalogRefreshStep {...props('/ws', [], 'community')} sources={SOURCES} />);
    await tick();
    expect(c.lastFrame()).toContain('Consultant or Enterprise licence');
    c.unmount();
    const fresh = render(<LzCatalogRefreshStep {...props('/ws', [])} sources={{ ...SOURCES, list: () => [entry('aws', 'bundled', '2026-11-01')] }} />);
    await tick();
    expect(fresh.lastFrame()).toContain('within the last 90 days');
    fresh.unmount();
  });
});

describe('Ready summary (#4194)', () => {
  it('reports targets, catalogues, age, the health result and whether a run can start', () => {
    const d = ws('assessment:\n  landing_zone:\n    targets: [otc:eu-de]\n');
    const src = { ...SOURCES, loadRegions };
    const ok = lzCatalogReadySummary(d, { scope: 'lz-catalog', probeCount: 3, failCount: 0, warnCount: 0, failedProbes: [], warnedProbes: [] }, src);
    expect(ok[0]).toEqual({ label: 'LZ targets', state: 'ok', detail: 'otc:eu-de' });
    expect(ok.find((i) => i.label === 'LZ catalogues')).toMatchObject({ state: 'warn', detail: '2 of 5 with errors: azure, gcp' });
    expect(ok.at(-1)).toEqual({ label: 'Run', state: 'ok', detail: 'a Landing Zone Catalog Assessment can start' });
    const failed = lzCatalogReadySummary(d, { scope: 'lz-catalog', probeCount: 3, failCount: 1, warnCount: 0, failedProbes: ['lz_catalogue_coverage'], warnedProbes: [] }, src);
    expect(failed.find((i) => i.label === 'Health check')).toEqual({ label: 'Health check', state: 'missing', detail: 'failed: lz_catalogue_coverage' });
    expect(failed.at(-1)!.state).toBe('info');
  });
});

// #4348: the Catalogues list takes its window from the shared height rule.
describe('Catalogues window on the shared height rule (#4348)', () => {
  class FakeOut extends EventEmitter {
    frames: string[] = [];
    constructor(readonly columns: number, readonly rows: number) { super(); }
    write = (f: string): boolean => { this.frames.push(f); return true; };
  }
  class FakeIn extends EventEmitter {
    isTTY = true;
    read = (): null => null;
    setEncoding(): void { /* not needed */ }
    setRawMode(): void { /* not needed */ }
    resume(): void { /* not needed */ }
    pause(): void { /* not needed */ }
    ref(): void { /* not needed */ }
    unref(): void { /* not needed */ }
  }
  const MANY: LzCatalogSources = {
    ...SOURCES,
    list: () => Array.from({ length: 20 }, (_, i) => entry(`cloud${String(i + 1).padStart(2, '0')}`, 'workspace', '2026-11-01')),
    quality: () => new Map(),
  };
  for (const rows of [24, 30]) {
    it(`20 catalogues at ${rows} terminal rows: the frame fits and the guidance box is visible`, async () => {
      const out = new FakeOut(100, rows);
      // The wizard's ScreenLayout provides the frame; here a scope around the whole step does.
      const inst = inkRender(<ListBudgetScope outside={0}><LzCatalogCataloguesStep {...props('/ws', [])} sources={MANY} /></ListBudgetScope>, {
        stdout: out as unknown as NodeJS.WriteStream, stderr: new FakeOut(100, rows) as unknown as NodeJS.WriteStream,
        stdin: new FakeIn() as unknown as NodeJS.ReadStream, debug: true, exitOnCtrlC: false, patchConsole: false,
      });
      await tick(150);
      // eslint-disable-next-line no-control-regex
      const lines = (out.frames[out.frames.length - 1] ?? '').replace(/\x1b\[[0-9;]*m/g, '').split('\n');
      inst.unmount();
      while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
      expect(lines.length).toBeLessThanOrEqual(rows - 1);
      expect(lines.some((l) => l.includes('Ctrl+G for guidance'))).toBe(true);
      expect(lines.some((l) => /\(1 of 20\)/.test(l))).toBe(true);
    });
  }
});
