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

// #4193 SET-04 (Design 125 sections 5.3, 5.7, 9, 11): the Service Portfolio
// branch. Step order and the engine entries after it, the service_portfolio
// writer (compatible with the `service init` block upsert), the intake folder
// inspection (counts and header names only, never a cell value), the scoring
// inputs, re-entry and Esc, and the layout rules.

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { load } from 'js-yaml';
import { CURSOR_MARKER, headerRuleWidth } from '@swao/tui-kit';
import { parseIntakeSheets, upsertServicePortfolioBlock, type IntakeParseResult, type SheetLike } from '@swao/module-service-assessment';
import { buildSetupPlan, defaultSetupRegistry, readServiceDefaults, type SetupStepProps, type SetupStepResult } from '../index.js';
import {
  checkScoringInputs,
  checkServiceFrameworks,
  checkServiceIntake,
  checkServiceWorkspace,
  inspectIntakeFolder,
  isServiceWorkspaceYml,
  readScoringInputs,
  summariseIntake,
  writeServiceIntake,
  writeServicePortfolioBlock,
  type IntakeParser,
} from './service-checks.js';
import { branchStateFromCheck } from '../branch-check.js';
import { ServiceIntakeStep, ServiceScoringStep, ServiceWorkspaceStep, serviceReadySummary } from './service.js';
import { INTAKE_TEMPLATE_FILE } from '@swao/module-service-assessment';
import { INIT_TEMPLATE, keepsAllLinesInOrder } from '../../__tests__/fixtures/init-workspace-yml.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const DOWN = '\u001B[B';
const ESC = '\u001B';
const CELL_VALUE = 'ROW-VALUE-MUST-NOT-SHOW';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function ws(yml = '# workspace comment\nengagement:\n  name: fixture\n'): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-4193-'));
  dirs.push(d);
  writeFileSync(join(d, '.swao.yml'), yml, 'utf-8');
  return d;
}
const intakeDir = (d: string): string => join(d, 'wsp', 'inputs', 'service-intake');
function dropFile(d: string, name: string, body = 'x'): void {
  mkdirSync(intakeDir(d), { recursive: true });
  writeFileSync(join(intakeDir(d), name), body, 'utf-8');
}
const yml = (d: string): Record<string, unknown> => load(readFileSync(join(d, '.swao.yml'), 'utf-8')) as Record<string, unknown>;

/** A parse result shaped like parseIntakeWorkbook's, with a row value that must never be shown. */
function fakeResult(rows: number, sheet = 'Inventory'): IntakeParseResult {
  return {
    rows: Array.from({ length: rows }, (_, i) => ({
      sheet, row: i + 2, appId: `APP00${i}`, appName: CELL_VALUE, values: { vendor_name: CELL_VALUE }, domains: [], integrations: [],
      integrationsNotes: null, pii: {} as IntakeParseResult['rows'][number]['pii'], vendorRedacted: false, mappedFields: ['id', 'name'],
    })),
    sheets: [{ name: sheet, headers: { A: 'App ID', B: 'App Name', C: 'Vendor', D: 'Colour' }, mapping: 'default', rows, fields: { id: 'A', name: 'B', vendor_name: 'C' } }],
    signals: [], warnings: [CELL_VALUE], duplicateIds: [],
  };
}
const fakeParse: IntakeParser = async (file) => {
  if (file.endsWith('broken.xlsx')) throw new Error('cannot read intake workbook: End of data reached');
  return fakeResult(file.endsWith('big.xlsx') ? 12 : 3);
};

function props(workspaceRoot: string, results: Array<SetupStepResult | undefined>): SetupStepProps {
  return {
    ctx: { workspaceRoot, tier: 'community', scope: 'service', scopeLabel: 'Service Portfolio Assessment', session: {} as SetupStepProps['ctx']['session'] },
    stepNumber: 1,
    stepCount: 5,
    onNext: (r) => results.push(r),
    updateSession: () => {},
    setEscapeCaptured: () => {},
    setGuidanceOpen: () => {},
  };
}

function expectLayout(frame: string | undefined): void {
  const width = headerRuleWidth(100);
  for (const line of (frame ?? '').split('\n')) {
    expect(line).not.toContain('--');
    expect(line).not.toMatch(/\bswao\s/);
    expect(line.trimEnd().length).toBeLessThanOrEqual(width);
  }
  expect(frame ?? '').not.toContain(CELL_VALUE);
}

describe('Service branch plan (#4193, section 5.3)', () => {
  it('runs Service Setup, Intake Input, Scoring Inputs, then the health check and Ready', () => {
    const plan = buildSetupPlan(defaultSetupRegistry(), { kind: 'branch', type: 'service' });
    expect(plan.map((e) => (e.kind === 'step' ? e.step.id : e.kind))).toEqual([
      'service.workspace', 'service.intake', 'service.scoring', 'health-check', 'ready',
    ]);
    for (const s of defaultSetupRegistry().steps('service')) expect(s.check).toBeTypeOf('function');
  });

  it('uses no engine label (Workspace, Health Check, Assessments, Ready) and unique labels', () => {
    const labels = defaultSetupRegistry().steps('service').map((s) => s.label);
    for (const l of labels) expect(['Workspace', 'Health Check', 'Assessments', 'Ready']).not.toContain(l);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('service_portfolio writer (#4193, section 5.7)', () => {
  it('appends a block-style block that readServiceDefaults reads back; comments are kept', () => {
    const d = ws();
    expect(isServiceWorkspaceYml(d)).toBe(false);
    expect(writeServiceIntake(d, { intake: 'wsp/inputs/service-intake/inv.xlsx', mapping: 'wsp/inputs/service-intake/x.column-map.yaml' })).toBe(true);
    const text = readFileSync(join(d, '.swao.yml'), 'utf-8');
    expect(text).toContain('# workspace comment');
    expect(text).toMatch(/^service_portfolio:$/m);
    expect(isServiceWorkspaceYml(d)).toBe(true);
    expect(readServiceDefaults(d)).toEqual({ intake: 'wsp/inputs/service-intake/inv.xlsx', mapping: 'wsp/inputs/service-intake/x.column-map.yaml' });
  });

  it('a later service init block upsert rewrites its keys in place and keeps intake (one block, no duplicate key)', () => {
    const d = ws();
    writeServiceIntake(d, { intake: 'wsp/inputs/service-intake/inv.xlsx' });
    const next = upsertServicePortfolioBlock(readFileSync(join(d, '.swao.yml'), 'utf-8'), {
      source: 'wsp/inputs/service-intake/inv.xlsx', mapping: null, imported_at: '2026-11-08T00:00:00Z', app_count: 3,
      row_count: 3, sheets: ['Inventory'], headers: {}, pii_columns: [], cluster_threshold: 3,
    });
    const doc = load(next) as Record<string, unknown>;
    expect(next.match(/^service_portfolio:/gm)).toHaveLength(1);
    expect(doc['service_portfolio']).toMatchObject({ intake: 'wsp/inputs/service-intake/inv.xlsx', app_count: 3 });
  });

  it('replaces intake in an existing block, keeps the other keys and CRLF line endings', () => {
    const d = ws('engagement:\r\n  name: x\r\nservice_portfolio:\r\n  source: old.xlsx\r\n  intake: old.xlsx\r\n  app_count: 4\r\nother: 1\r\n');
    writeServiceIntake(d, { intake: 'wsp/inputs/service-intake/new.xlsx' });
    const raw = readFileSync(join(d, '.swao.yml'), 'utf-8');
    expect(raw).toContain('\r\n');
    expect(yml(d)).toEqual({ engagement: { name: 'x' }, service_portfolio: { source: 'old.xlsx', intake: 'wsp/inputs/service-intake/new.xlsx', app_count: 4 }, other: 1 });
  });
});

describe('intake folder inspection (#4193)', () => {
  it('summarises a real parse: sheets, rows, recognised header names; no cell value', () => {
    const cells: unknown[][] = [
      ['App ID', 'App Name', 'Vendor', 'Colour'],
      ['APPX001', CELL_VALUE, CELL_VALUE, CELL_VALUE],
      ['APPX002', CELL_VALUE, CELL_VALUE, CELL_VALUE],
    ];
    const sheet: SheetLike = { name: 'Inventory', rowCount: cells.length, cell: (r, c) => cells[r - 1]?.[c - 1] ?? null };
    const s = summariseIntake(parseIntakeSheets([sheet]));
    expect(s.rows).toBe(2);
    expect(s.sheets).toEqual([{ name: 'Inventory', rows: expect.any(Number), recognised: ['App ID', 'App Name', 'Vendor'], columns: 4 }]);
    expect(JSON.stringify(s)).not.toContain(CELL_VALUE);
  });

  it('lists workbooks and column maps; unreadable files carry the reason, lock files are ignored', async () => {
    const d = ws();
    dropFile(d, 'inv.xlsx');
    dropFile(d, 'broken.xlsx');
    dropFile(d, '~$inv.xlsx');
    dropFile(d, 'bad.column-map.yaml', 'not: a column map\n');
    const s = await inspectIntakeFolder(d, fakeParse);
    expect(s.folder).toBe('wsp/inputs/service-intake');
    expect(s.workbooks.map((w) => [w.file, w.path, w.rows, !!w.error])).toEqual([
      ['broken.xlsx', 'wsp/inputs/service-intake/broken.xlsx', 0, true],
      ['inv.xlsx', 'wsp/inputs/service-intake/inv.xlsx', 3, false],
    ]);
    expect(s.mappings).toHaveLength(1);
    expect(s.mappings[0]!.error).toBeTruthy();
    expect(JSON.stringify(s)).not.toContain(CELL_VALUE);
  });

  it('the real workbook parser reports a file that is not a workbook as unreadable', async () => {
    const d = ws();
    dropFile(d, 'inv.xlsx', 'this is not a zip file');
    const s = await inspectIntakeFolder(d);
    expect(s.workbooks[0]!.error).toMatch(/cannot read intake workbook/);
  });

  it('check: waiting (none, not chosen), recorded, recorded but gone (#4225: waiting is not missing)', () => {
    const d = ws();
    expect(checkServiceIntake(d)[0]).toEqual({ label: 'Intake workbook', state: 'waiting', detail: 'copy your intake workbook to wsp/inputs/service-intake/ or fill the template', short: 'waiting for the intake workbook' });
    dropFile(d, 'inv.xlsx');
    expect(checkServiceIntake(d)[0]).toMatchObject({ state: 'waiting', detail: '1 workbook in wsp/inputs/service-intake, none recorded; choose one in Intake Input' });
    writeServiceIntake(d, { intake: 'wsp/inputs/service-intake/inv.xlsx' });
    expect(checkServiceIntake(d)).toEqual([
      { label: 'Intake workbook', state: 'ok', detail: 'wsp/inputs/service-intake/inv.xlsx' },
      { label: 'Column map', state: 'info', detail: 'default intake template' },
    ]);
    rmSync(join(intakeDir(d), 'inv.xlsx'));
    expect(checkServiceIntake(d)[0]).toMatchObject({ state: 'missing', detail: 'wsp/inputs/service-intake/inv.xlsx not found; copy it back or record another workbook' });
  });

  it('check: only the blank template in the folder is waiting for the operator to fill it (#4225)', () => {
    const d = ws();
    dropFile(d, INTAKE_TEMPLATE_FILE);
    expect(checkServiceIntake(d)[0]).toEqual({
      label: 'Intake workbook',
      state: 'waiting',
      detail: 'fill the template wsp/inputs/service-intake/service-intake-template.xlsx (or copy your intake workbook there), then record it in Intake Input',
      short: 'fill the intake template',
    });
  });
});

describe('scoring inputs (#4193)', () => {
  it('reads the APM weights (version, review date), the vendor catalogue and the research ages', () => {
    const d = ws('service_portfolio:\n  intake: a.xlsx\n');
    const now = new Date('2026-11-08T00:00:00Z');
    for (const [id, at] of [['svc1', '2026-11-01T00:00:00Z'], ['svc2', '2026-09-01T00:00:00Z']] as const) {
      const r = join(d, 'apps', id, 'wsp', 'inputs', 'research');
      mkdirSync(r, { recursive: true });
      writeFileSync(join(d, 'apps', id, '.swao.yml'), 'assessment:\n  type: service\n');
      for (const t of ['cve-summary', 'eol-status']) writeFileSync(join(r, `${t}.md`), `---\nretrieved_at: ${at}\n---\nbody\n`);
    }
    mkdirSync(join(d, 'apps', 'svc3'), { recursive: true });
    writeFileSync(join(d, 'apps', 'svc3', '.swao.yml'), 'assessment:\n  type: service\n');
    const s = readScoringInputs(d, now);
    expect(s.apm).toMatchObject({ present: true, source: 'bundled', version: '2026.10', valid: true });
    expect(s.vendor.builtinFiles).toBeGreaterThan(0);
    expect(s.research).toEqual({ apps: 3, researched: 2, stale: 1, oldestAgeDays: 68 });
    const items = checkScoringInputs(d, now);
    expect(items.map((i) => [i.label, i.state])).toEqual([['APM weights', 'ok'], ['Vendor catalogue', 'ok'], ['Research cache', 'warn']]);
    expect(items[2]!.detail).toBe('2 of 3 service apps researched, oldest 68 days, 1 older than 30 days');
  });

  it('#4286: lists the frameworks of the service apps; SWAO_APM resolves from the bundled copy, an unknown id is missing', () => {
    const d = ws();
    for (const [id, regimes] of [['svc1', ['SWAO_APM']], ['svc2', ['SWAO_APM', 'NO_SUCH_REGIME']]] as const) {
      mkdirSync(join(d, 'apps', id), { recursive: true });
      writeFileSync(join(d, 'apps', id, '.swao.yml'), `assessment:\n  type: service\n  regimes_active:\n${regimes.map((r) => `    - ${r}`).join('\n')}\n`);
    }
    expect(checkServiceFrameworks(d)).toEqual({ label: 'Frameworks', state: 'missing', detail: 'not found: NO_SUCH_REGIME; copy the framework folder into wsp/inputs/catalogs/community/; found: SWAO_APM (bundled)', short: 'not found: NO_SUCH_REGIME' });
    writeFileSync(join(d, 'apps', 'svc2', '.swao.yml'), 'assessment:\n  type: service\n  regimes_active: [SWAO_APM]\n');
    expect(checkServiceFrameworks(d)).toEqual({ label: 'Frameworks', state: 'ok', detail: 'SWAO_APM (bundled)' });
    expect(checkScoringInputs(d).map((i) => i.label)).toContain('Frameworks');
  });
});

describe('Service Setup step (#4193)', () => {
  it('offers the setup; Enter creates the intake folder and, with one workbook, records it', async () => {
    const d = ws();
    dropFile(d, 'inv.xlsx');
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<ServiceWorkspaceStep {...props(d, results)} />);
    await tick();
    expect(r.lastFrame()).toContain('no service portfolio settings yet');
    expectLayout(r.lastFrame());
    r.stdin.write('\r'); await tick();
    expect(r.lastFrame()).toContain('intake workbook wsp/inputs/service-intake/inv.xlsx recorded');
    r.stdin.write('\r'); await tick();
    expect(results).toEqual([{ status: 'done', summary: 'Service workspace, intake wsp/inputs/service-intake/inv.xlsx' }]);
    expect(checkServiceWorkspace(d)[0]).toMatchObject({ state: 'info' });
    r.unmount();
  });

  it('#4225: on a fresh init workspace Enter writes the service_portfolio block right away (intake folder as the default location)', async () => {
    const d = ws(INIT_TEMPLATE);
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<ServiceWorkspaceStep {...props(d, results)} />);
    await tick();
    r.stdin.write('\r'); await tick();
    expect(existsSync(intakeDir(d))).toBe(true);
    expect(isServiceWorkspaceYml(d)).toBe(true);
    expect(yml(d)['service_portfolio']).toEqual({ intake_folder: 'wsp/inputs/service-intake' });
    const text = readFileSync(join(d, '.swao.yml'), 'utf-8');
    expect(keepsAllLinesInOrder(INIT_TEMPLATE, text)).toBe(true);
    expect(text).toMatch(/^service_portfolio:\n {2}intake_folder: wsp\/inputs\/service-intake$/m);
    expect(r.lastFrame()).toContain('Service workspace set up; intake folder: wsp/inputs/service-intake');
    expectLayout(r.lastFrame());
    r.stdin.write('\r'); await tick();
    expect(results).toEqual([{ status: 'done', summary: 'Service workspace, intake folder wsp/inputs/service-intake' }]);
    expect(checkServiceWorkspace(d)[0]).toMatchObject({ state: 'info' });
    // A later `service init` keeps the key and rewrites its own keys in one block.
    const next = upsertServicePortfolioBlock(text, {
      source: 'wsp/inputs/service-intake/inv.xlsx', mapping: null, imported_at: '2026-11-09T00:00:00Z', app_count: 1,
      row_count: 1, sheets: ['Intake'], headers: {}, pii_columns: [], cluster_threshold: 3,
    });
    expect(next.match(/^service_portfolio:/gm)).toHaveLength(1);
    expect((load(next) as Record<string, Record<string, unknown>>)['service_portfolio']).toMatchObject({ intake_folder: 'wsp/inputs/service-intake', app_count: 1 });
    r.unmount();
  });

  it('#4225: the blank template alone is not recorded as the intake by Set up', async () => {
    const d = ws();
    dropFile(d, INTAKE_TEMPLATE_FILE);
    const r = render(<ServiceWorkspaceStep {...props(d, [])} />);
    await tick();
    r.stdin.write('\r'); await tick();
    expect(isServiceWorkspaceYml(d)).toBe(true);
    expect(readServiceDefaults(d).intake).toBeUndefined();
    r.unmount();
  });

  it('"Skip this step" leaves a workspace untouched; Esc is not a skip (#4341)', async () => {
    const e = ws();
    const results: Array<SetupStepResult | undefined> = [];
    const r2 = render(<ServiceWorkspaceStep {...props(e, results)} />);
    await tick();
    r2.stdin.write(ESC); await tick();
    expect(results).toEqual([]);
    r2.stdin.write(DOWN); await tick();
    r2.stdin.write('\r'); await tick();
    expect(results).toEqual([{ status: 'skipped', summary: 'Not set up as a service workspace' }]);
    expect(existsSync(intakeDir(e))).toBe(false);
    r2.unmount();
  });
});

describe('Intake input step (#4193, section 5.7)', () => {
  it('lists workbooks with counts and recognised columns, records the chosen one', async () => {
    const d = ws('service_portfolio:\n  intake: wsp/inputs/service-intake/a.xlsx\n');
    dropFile(d, 'a.xlsx');
    dropFile(d, 'big.xlsx');
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<ServiceIntakeStep {...props(d, results)} parse={fakeParse} />);
    await tick(80);
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain(`${CURSOR_MARKER}a.xlsx  3 rows in 1 sheet(s), 3 of 4 columns recognised  (recorded)`);
    expect(frame).toContain('Inventory: 3 rows; recognised: App ID, App Name, Vendor');
    expectLayout(frame);
    r.stdin.write(DOWN); await tick();
    r.stdin.write('\r'); await tick();
    expect(r.lastFrame()).toContain('Intake workbook recorded: wsp/inputs/service-intake/big.xlsx');
    r.stdin.write('\r'); await tick();
    expect(results).toEqual([{ status: 'done', summary: 'Intake: wsp/inputs/service-intake/big.xlsx' }]);
    expect(readServiceDefaults(d).intake).toBe('wsp/inputs/service-intake/big.xlsx');
    r.unmount();
  });

  it('re-entry preselects the recorded workbook; Enter keeps it and the keep entry keeps it, nothing is written', async () => {
    const text = 'service_portfolio:\n  intake: wsp/inputs/service-intake/big.xlsx\n';
    const d = ws(text);
    dropFile(d, 'a.xlsx');
    dropFile(d, 'big.xlsx');
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<ServiceIntakeStep {...props(d, results)} parse={fakeParse} />);
    await tick(80);
    expect(r.lastFrame()).toContain(`${CURSOR_MARKER}big.xlsx`);
    r.stdin.write('\r'); await tick();
    r.unmount();
    const r2 = render(<ServiceIntakeStep {...props(d, results)} parse={fakeParse} />);
    await tick(80);
    r2.stdin.write(ESC); await tick();
    expect(results).toHaveLength(1); // Esc belongs to the wizard (#4341)
    expect(r2.lastFrame()).toContain('Keep the current intake and continue');
    expect(r2.lastFrame()).toContain('Read the folder again'); // #4254: replaces the letter key R
    r2.stdin.write(DOWN); await tick();
    r2.stdin.write(DOWN); await tick();
    r2.stdin.write('\r'); await tick();
    expect(results).toEqual([
      { status: 'kept', summary: 'Intake: wsp/inputs/service-intake/big.xlsx (12 rows)' },
      { status: 'kept', summary: 'Intake: wsp/inputs/service-intake/big.xlsx' },
    ]);
    expect(readFileSync(join(d, '.swao.yml'), 'utf-8')).toBe(text);
    r2.unmount();
  });

  it('names the expected template when the folder is empty or a workbook is unreadable', async () => {
    const d = ws();
    const r = render(<ServiceIntakeStep {...props(d, [])} parse={fakeParse} />);
    await tick(80);
    // #4254 (run 9): a central StatusRow, the text wrapped, never cut.
    expect(r.lastFrame()).toMatch(/\[waiting\]\s+Intake\s+No intake workbook in the folder yet\./);
    expect(r.lastFrame()).toContain('Copy the blank intake template to');
    expect(r.lastFrame()).toContain('default intake template');
    expectLayout(r.lastFrame());
    r.unmount();
    dropFile(d, 'broken.xlsx');
    const r2 = render(<ServiceIntakeStep {...props(d, [])} parse={fakeParse} />);
    await tick(80);
    expect(r2.lastFrame()).toContain('broken.xlsx  unreadable');
    expect(r2.lastFrame()).toContain('default intake template');
    r2.stdin.write('\r'); await tick();
    expect(isServiceWorkspaceYml(d)).toBe(false); // an unreadable workbook is not recorded
    r2.unmount();
  });
});

describe('Scoring step and Ready (#4193)', () => {
  it('shows the three inputs within the layout rules; Enter continues', async () => {
    const d = ws('service_portfolio:\n  intake: a.xlsx\n');
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<ServiceScoringStep {...props(d, results)} />);
    await tick();
    // #4254 (run 9): the check lines are central StatusRows (label column, then the detail).
    expect(r.lastFrame()).toMatch(/APM weights\s+bundled framework, version 2026\.10/);
    expect(r.lastFrame()).toMatch(/Research cache\s+no service apps yet/);
    expectLayout(r.lastFrame());
    r.stdin.write('\r'); await tick();
    expect(results).toEqual([{ status: 'kept', summary: 'Scoring inputs present' }]);
    r.unmount();
  });

  it('Ready: services and whether a run can start; before the first import the import is the next step', () => {
    const d = ws();
    dropFile(d, 'inv.xlsx');
    writeServiceIntake(d, { intake: 'wsp/inputs/service-intake/inv.xlsx' });
    const health = { scope: 'service' as const, probeCount: 9, failCount: 0, warnCount: 0, failedProbes: [], warnedProbes: [] };
    const items = serviceReadySummary(d, health);
    expect(items.find((i) => i.label === 'Import')).toEqual({ label: 'Import', state: 'info', detail: 'at the first Service Portfolio Assessment (Run Assessment, Service Portfolio Assessment)', short: 'at the first assessment run' });
    expect(items.at(-1)).toEqual({ label: 'Run', state: 'ok', detail: 'a Service Portfolio Assessment can start' });
    // #4295: a failed service workspace probe before the import is a broken intake; it blocks.
    expect(serviceReadySummary(d, { ...health, failCount: 1, failedProbes: ['service-workspace'] }).at(-1)).toMatchObject({ state: 'info', detail: 'fix the failed checks first' });
    const blocked = serviceReadySummary(d, { ...health, failCount: 2, failedProbes: ['service_workspace', 'apm_weights'] });
    expect(blocked.at(-1)).toMatchObject({ state: 'info', detail: 'fix the failed checks first' });
    expect(serviceReadySummary(ws(), undefined).at(-1)).toMatchObject({ detail: 'starts once the intake workbook is recorded' });
  });

  it('#4295: intake recorded, nothing imported yet: rows found, import at the first run, branch state ready', async () => {
    const d = ws();
    dropFile(d, 'Application-Portfolio-Demo.xlsx');
    writeServiceIntake(d, { intake: 'wsp/inputs/service-intake/Application-Portfolio-Demo.xlsx' });
    writeServicePortfolioBlock(d);
    const health = { scope: 'service' as const, probeCount: 15, failCount: 0, warnCount: 0, failedProbes: [], warnedProbes: [] };
    // Without the Intake Input step's read (CLI check), no row count.
    expect(serviceReadySummary(d, health).find((i) => i.label === 'Intake workbook')).toEqual({ label: 'Intake workbook', state: 'ok', detail: 'wsp/inputs/service-intake/Application-Portfolio-Demo.xlsx' });
    await inspectIntakeFolder(d, async () => fakeResult(234));
    const items = serviceReadySummary(d, health);
    expect(items.map((i) => [i.label, i.state, i.detail])).toEqual([
      ['Service workspace', 'info', 'set up; no services imported yet, the assessment imports the intake'],
      ['Intake workbook', 'ok', 'wsp/inputs/service-intake/Application-Portfolio-Demo.xlsx, 234 row(s) found'],
      ['Column map', 'info', 'default intake template'],
      ['Import', 'info', 'at the first Service Portfolio Assessment (Run Assessment, Service Portfolio Assessment)'],
      ['Health check', 'ok', 'passed'],
      ['Run', 'ok', 'a Service Portfolio Assessment can start'],
    ]);
    expect(branchStateFromCheck(health, items)).toBe('ready');
    // A replaced workbook never shows the old count.
    writeFileSync(join(intakeDir(d), 'Application-Portfolio-Demo.xlsx'), 'a longer body', 'utf-8');
    expect(serviceReadySummary(d, health).find((i) => i.label === 'Intake workbook')?.detail).toBe('wsp/inputs/service-intake/Application-Portfolio-Demo.xlsx');
  });

  it('#4225: Ready tells "not set up" (missing) from "waiting for your input"', () => {
    const fresh = ws();
    expect(serviceReadySummary(fresh, undefined).slice(0, 2).map((i) => [i.label, i.state])).toEqual([['Service workspace', 'missing'], ['Intake workbook', 'waiting']]);
    const d = ws('service_portfolio:\n  intake_folder: wsp/inputs/service-intake\n');
    const items = serviceReadySummary(d, undefined);
    expect(items.find((i) => i.label === 'Service workspace')).toMatchObject({ state: 'info' });
    expect(items.find((i) => i.label === 'Intake workbook')).toEqual({ label: 'Intake workbook', state: 'waiting', detail: 'copy your intake workbook to wsp/inputs/service-intake/ or fill the template', short: 'waiting for the intake workbook' });
    expect(items.some((i) => i.state === 'missing')).toBe(false);
  });
});

describe('#4225 intake template offer (D-3)', () => {
  it('Enter on an empty folder copies the blank template, names the path; the empty template is not recorded', async () => {
    const d = ws('service_portfolio:\n  intake_folder: wsp/inputs/service-intake\n');
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<ServiceIntakeStep {...props(d, results)} />);
    await tick(80);
    r.stdin.write('\r');
    await tick(600);
    expect(existsSync(join(intakeDir(d), INTAKE_TEMPLATE_FILE))).toBe(true);
    expect(r.lastFrame()).toContain('Blank intake template copied to wsp/inputs/service-intake/service-intake-template.xlsx');
    expectLayout(r.lastFrame());
    // The real parser reads the template: 0 rows; Enter does not record it.
    expect(r.lastFrame()).toContain(`${CURSOR_MARKER}service-intake-template.xlsx  0 rows in 1 sheet(s)`);
    r.stdin.write('\r'); await tick();
    expect(r.lastFrame()).toContain('has no rows yet');
    expect(readServiceDefaults(d).intake).toBeUndefined();
    expect(results).toEqual([]);
    // #4341: "Skip this step" is the last entry; Esc belongs to the wizard.
    r.stdin.write(ESC); await tick();
    expect(results).toEqual([]);
    r.stdin.write(DOWN); await tick(); // Read the folder again
    r.stdin.write(DOWN); await tick(); // Skip this step
    r.stdin.write('\r'); await tick();
    expect(results).toEqual([{ status: 'skipped', summary: 'No intake workbook recorded' }]);
    r.unmount();
  });

  it('re-running after a workbook was copied in records intake and mapping; the items turn ok', async () => {
    const d = ws('service_portfolio:\n  intake_folder: wsp/inputs/service-intake\n');
    dropFile(d, 'inv.xlsx');
    dropFile(d, 'inv.column-map.yaml', 'version: "1.0"\nsource:\n  header_row: 1\n  data_start_row: 2\nfields:\n  id: { col: A }\n  name: { col: B }\n  os: { col: C }\n');
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<ServiceIntakeStep {...props(d, results)} parse={fakeParse} />);
    await tick(80);
    r.stdin.write('\r'); await tick();
    r.stdin.write('\r'); await tick();
    expect(results).toEqual([{ status: 'done', summary: 'Intake: wsp/inputs/service-intake/inv.xlsx' }]);
    expect(readServiceDefaults(d)).toEqual({ intake: 'wsp/inputs/service-intake/inv.xlsx', mapping: 'wsp/inputs/service-intake/inv.column-map.yaml' });
    expect(yml(d)['service_portfolio']).toMatchObject({ intake_folder: 'wsp/inputs/service-intake' });
    expect(checkServiceIntake(d).map((i) => i.state)).toEqual(['ok', 'ok']);
    r.unmount();
  });
});
