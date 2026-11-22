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

// TUI [2] Service Portfolio Assessment intake screen (#3075, Design 103 §3.6).
import { describe, it, expect, afterAll } from 'vitest';
import React from 'react';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { communityFrameworksDir } from '@swao/community-frameworks';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import {
  ServiceInitScreen, ServiceAssessSummary, buildServiceAssessArgs, buildServiceInitArgs, buildServiceExportArgs, buildServiceResearchArgs,
  readServiceAssessOutcome, readServiceRunPointer,
  defaultServiceIntake, estimateAssessment, formatDuration, parsePassProgress, parseResearchProgress,
  serviceFinishMenu, serviceFinishTitle, serviceFinishGuidance, serviceOutputsRow, serviceGuidanceDetails, SERVICE_COLUMN_MAPPING_DOCS_URL,
  previewServiceInit, vendorWarningOf, type ServiceChildRunner, type ServiceInitPreview,
  planScope, scopeConfirmationLines, scopeTag, needsScopeConfirmation, RESEARCH_LLM_CALLS_PER_APP, MIN_ASSESS_LLM_CALLS_PER_APP, serviceConfirmRows, serviceBackPhase,
} from '../ServiceInitScreen.js';

// #4255: the confirmation is a ConfirmPanel; its rows are label and value columns, values wrap.
const CONFIRM_TITLE = 'Start the Service Portfolio Assessment';
const flat = (frame: string | undefined): string => (frame ?? '').replace(/\s+/g, ' ');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** Workspace with one service app and, optionally, a finished run carrying scope-coverage.json. */
function serviceWorkspace(run?: { ts: string; skipped: number }): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-svc-tui-'));
  dirs.push(ws);
  const appDir = join(ws, 'apps', 'hospacs004');
  mkdirSync(join(appDir, 'wsp'), { recursive: true });
  writeFileSync(join(appDir, '.swao.yml'), 'assessment:\n  type: service\n');
  if (run) {
    const runDir = join(appDir, 'wsp', 'runs', run.ts);
    mkdirSync(runDir, { recursive: true });
    const skipped = Array.from({ length: run.skipped }, (_, i) => ({ num: String(i), key: `p${i}`, name: `P${i}`, reason: 'no source tree' }));
    writeFileSync(join(runDir, 'scope-coverage.json'), JSON.stringify({ assessment_type: 'service', run_passes: [], skipped_passes: skipped, external_passes: [] }));
    writeFileSync(join(appDir, 'wsp', 'latest-service.txt'), `runs/${run.ts}`);
  }
  return ws;
}

describe('ServiceInitScreen', () => {
  it('asks for the intake Excel path first (Design 103 §3.6 prompt)', () => {
    const { lastFrame } = render(<ServiceInitScreen onBack={() => {}} />);
    expect(lastFrame() ?? '').toContain('Enter the path to the intake Excel file (or drag and drop)');
    expect(lastFrame() ?? '').toContain('Service Portfolio Assessment');
  });

  it('builds swao service init arguments, stripping drag-and-drop quotes', () => {
    expect(buildServiceInitArgs('"C:\\in\\intake.xlsx"', '', '/ws')).toEqual(['service', 'init', '--from', 'C:\\in\\intake.xlsx', '--workspace', '/ws']);
    expect(buildServiceInitArgs('intake.xlsx', 'map.yaml', '/ws')).toEqual(['service', 'init', '--from', 'intake.xlsx', '--workspace', '/ws', '--mapping', 'map.yaml']);
  });

  it('runs research for the same workspace as the scaffold', () => {
    expect(buildServiceResearchArgs('/ws')).toEqual(['service', 'research', '--workspace', '/ws']);
    // #3304: the TUI equivalent of --skip-llm.
    expect(buildServiceResearchArgs('/ws', { skipLlm: true })).toEqual(['service', 'research', '--workspace', '/ws', '--skip-llm']);
    expect(buildServiceExportArgs('/ws')).toEqual(['service', 'export', '--workspace', '/ws']);
  });

  it('assesses each service app with --type service, one app per run (#3144, Community tier)', () => {
    expect(buildServiceAssessArgs('/ws', 'hospacs004')).toEqual(['assess', '--app', 'hospacs004', '--type', 'service', '--workspace', '/ws']);
    expect(buildServiceAssessArgs('/ws', 'hospacs004')).not.toContain('--portfolio');
  });
});

describe('ServiceInitScreen assessment step (#3144)', () => {
  it('reads the skipped pass count from the new run scope-coverage.json', () => {
    const ws = serviceWorkspace({ ts: '2026-10-10T10-00-00', skipped: 6 });
    expect(readServiceRunPointer(ws, 'hospacs004')).toBe('runs/2026-10-10T10-00-00');
    expect(readServiceAssessOutcome(ws, 'hospacs004', null, 0)).toEqual({ appId: 'hospacs004', exitCode: 0, run: 'runs/2026-10-10T10-00-00', skipped: 6 });
  });

  it('never shows a stale count when the assessment wrote no new run', () => {
    const ws = serviceWorkspace({ ts: '2026-10-10T10-00-00', skipped: 6 });
    // Pointer unchanged since before the spawn: the run failed (even with exit code 0).
    expect(readServiceAssessOutcome(ws, 'hospacs004', 'runs/2026-10-10T10-00-00', 0)).toEqual({ appId: 'hospacs004', exitCode: 0, run: null, skipped: null });
    const empty = serviceWorkspace();
    expect(readServiceRunPointer(empty, 'hospacs004')).toBeNull();
    expect(readServiceAssessOutcome(empty, 'hospacs004', null, 1).run).toBeNull();
  });

  it('shows the per-app skipped pass count in the completion view', () => {
    const { lastFrame } = render(
      <ServiceAssessSummary
        total={2}
        outcomes={[
          { appId: 'hospacs004', exitCode: 0, run: 'runs/2026-10-10T10-00-00', skipped: 6 },
          { appId: 'hosapp133', exitCode: 1, run: null, skipped: null },
        ]}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Service assessments: 1/2 complete');
    expect(frame).toContain('hospacs004: 6 pass(es) skipped (runs/2026-10-10T10-00-00/scope-coverage.json)');
    expect(frame).toContain('hosapp133: no new run (exit code 1)');
  });
});

describe('ServiceInitScreen sprint 151 flow (#3164, #3165, #3166, #3169, #3211)', () => {
  const tick = () => new Promise((r) => setTimeout(r, 60));

  it('leaves --from out when the intake comes from wsp/inputs/service-intake/', () => {
    expect(buildServiceInitArgs('', '', '/ws')).toEqual(['service', 'init', '--workspace', '/ws']);
  });

  it('pre-fills the intake workbook and column map found in wsp/inputs/service-intake/', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-svc-tui-intake-'));
    dirs.push(ws);
    mkdirSync(join(ws, 'wsp', 'inputs', 'service-intake'), { recursive: true });
    writeFileSync(join(ws, 'wsp', 'inputs', 'service-intake', 'inventory.xlsx'), 'x');
    writeFileSync(join(ws, 'wsp', 'inputs', 'service-intake', 'intake-column-map.yaml'), 'x');
    expect(defaultServiceIntake(ws)).toEqual({
      intake: join(ws, 'wsp', 'inputs', 'service-intake', 'inventory.xlsx'),
      mapping: join(ws, 'wsp', 'inputs', 'service-intake', 'intake-column-map.yaml'),
    });
    expect(defaultServiceIntake(mkdtempSync(join(tmpdir(), 'swao-svc-tui-none-')))).toEqual({ intake: '', mapping: '' });
  });

  it('parses research progress and the current pass like the Application Assessment screen', () => {
    expect(parseResearchProgress('[3/234] a: cve created\n[4/234] b: cve created\n')).toEqual({ done: 4, total: 234 });
    expect(parseResearchProgress('Researching 234 app(s)...')).toBeNull();
    expect(parsePassProgress('[ok]  Pass 04 -- context_ingestion  6 signals\n[info] Running Pass 11 -- compliance_evaluation...')).toEqual({ passName: 'compliance_evaluation', completed: 1 });
  });

  it('formats elapsed time and the scope estimate', () => {
    expect(formatDuration(65_000)).toBe('1m 05s');
    expect(formatDuration(9_000)).toBe('9s');
    expect(estimateAssessment(20)).toBe('about 60 min to 80 min');
    expect(estimateAssessment(309)).toMatch(/^about \d+ h to \d+ h$/);
  });

  it('caps the assessment summary and lists failures first so the frame stays inside the terminal', () => {
    const outcomes = Array.from({ length: 10 }, (_, i) => ({ appId: `hosapp${String(i).padStart(3, '0')}`, exitCode: 0, run: `runs/t${i}`, skipped: 4 }));
    outcomes[9] = { appId: 'hosapp009', exitCode: 1, run: null, skipped: null };
    const frame = render(<ServiceAssessSummary outcomes={outcomes} total={10} />).lastFrame() ?? '';
    expect(frame).toContain('Service assessments: 9/10 complete');
    expect(frame.indexOf('hosapp009: no new run')).toBeLessThan(frame.indexOf('hosapp000:'));
    expect(frame).toContain('+2 more');
  });

  it('asks the column-map question without a doubled colon, then one scope question (#3164, #3165)', async () => {
    const r = render(<ServiceInitScreen onBack={() => {}} />);
    await tick();
    r.stdin.write('C:\\in\\intake.xlsx');
    await tick();
    r.stdin.write('\r');
    await tick();
    const mappingFrame = r.lastFrame() ?? '';
    expect(mappingFrame).toContain('Leave it empty to detect the columns from the headers (recommended)');
    expect(mappingFrame).not.toMatch(/: :/);
    r.stdin.write('\r');
    await tick();
    // #3304: LLM research choice, defaulting to run.
    const llmFrame = r.lastFrame() ?? '';
    expect(llmFrame).toContain('LLM research of vendor profile, certifications, data residency and breach history?');
    expect(llmFrame).toContain('Skip LLM research for this run');
    // #4230: the guidance box follows the highlighted option (one entry per option).
    expect(llmFrame).toContain('Run LLM research   (Ctrl+G for guidance)');
    r.stdin.write('\u001B[B');
    await tick();
    expect(r.lastFrame() ?? '').toContain('Skip LLM research   (Ctrl+G for guidance)');
    r.stdin.write('\u001B[A');
    await tick();
    r.stdin.write('\r');
    await tick();
    const scopeFrame = r.lastFrame() ?? '';
    expect(scopeFrame).toContain('Top N by risk   (Ctrl+G for guidance)');
    expect(scopeFrame).toContain('What should SWAO run? (Top N asks for N next; the frameworks follow)');
    expect(scopeFrame).toContain('assess the top N by risk');
    expect(scopeFrame).toContain('default 20');
    expect(scopeFrame).toContain('Scaffold and research only');
    r.unmount();
  });
});

// #3220: re-run keys, docs link in the guidance, and a simulated 300-app run.
describe('ServiceInitScreen follow-ups (#3220)', () => {
  const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
  const DOWN = '\u001B[B';
  const ROWS = 40;

  it('#4238: the What next menu offers only what is available, in plain words with the CLI in the guidance', () => {
    const full = { assessApps: 20, export: true };
    expect(serviceFinishMenu(full).map((o) => o.label)).toEqual([
      'Show the priority list', 'Show details', 'Re-run the research', 'Re-assess the same 20 apps', 'Re-run the portfolio workbook export',
    ]);
    // #4238: Publish first when apps were assessed; Open the portfolio workbook when this run wrote it.
    expect(serviceFinishMenu(full, { publishApps: 2, workbook: true }).map((o) => o.value)).toEqual(['publish', 'rank', 'workbook', 'details', 'research', 'assess', 'export']);
    expect(serviceFinishMenu(full, { publishApps: 1 })[0]!.label).toBe('Publish the HTML report of the assessed app');
    expect(serviceFinishGuidance(full, { publishApps: 2, workbook: true, workspace: 'C:/ws' }).what).toContain('Workspace: C:/ws.');
    expect(serviceOutputsRow([{ appId: 'a1', exitCode: 0, run: 'runs/2026-11-09T15-14-37', skipped: 0 }, { appId: 'a2', exitCode: 1, run: null, skipped: null }], true)).toBe('apps/a1/wsp/runs/2026-11-09T15-14-37/; wsp/reports/ and wsp/star-schema/');
    expect(serviceOutputsRow([], false)).toBeNull();
    const none = { assessApps: 0, export: false };
    expect(serviceFinishMenu(none).map((o) => o.value)).toEqual(['rank', 'details', 'research']);
    expect(serviceFinishGuidance(full).cli).toContain('swao service rank');
    expect(serviceFinishGuidance(full).what).not.toContain('swao');
    expect(serviceFinishGuidance(none).cli).not.toContain('swao service export');
    expect(serviceFinishTitle('Service Portfolio Assessment complete.')).toEqual({ title: 'Service Portfolio Assessment complete', reason: null });
    expect(serviceFinishTitle('Stopped before the assessment: 0 service app(s) after the scaffold, but 2 were confirmed. Nothing was assessed.').title).toBe('Service Portfolio Assessment stopped');
  });

  it('links the Column mapping docs page in the guidance panel and at the column-map question', async () => {
    expect(SERVICE_COLUMN_MAPPING_DOCS_URL).toBe('https://accenture.github.io/SWAO/service-assessment/column-mapping');
    // First detail row, so it is the first one shown when the terminal is short.
    expect(serviceGuidanceDetails()[0]).toEqual({ label: 'Column mapping', value: SERVICE_COLUMN_MAPPING_DOCS_URL });
    const r = render(<ServiceInitScreen onBack={() => {}} workspacePath={mkdtempSync(join(tmpdir(), 'swao-svc-tui-docs-'))} runChild={async () => 0} />);
    await tick();
    r.stdin.write('intake.xlsx');
    await tick();
    r.stdin.write('\r');
    await tick();
    expect(r.lastFrame() ?? '').toContain(`Column mapping guide: ${SERVICE_COLUMN_MAPPING_DOCS_URL}`);
    r.unmount();
  });

  it('renders a simulated 300-app run inside the terminal, with correct progress and an intact header, then re-runs single stages', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-svc-tui-300-'));
    dirs.push(ws);
    const ids = Array.from({ length: 300 }, (_, i) => `hosapp${String(i).padStart(3, '0')}`);
    for (const id of ids) {
      mkdirSync(join(ws, 'apps', id, 'wsp'), { recursive: true });
      writeFileSync(join(ws, 'apps', id, '.swao.yml'), 'assessment:\n  type: service\n');
    }
    const calls: string[][] = [];
    let release: (() => void) | null = null;
    let holdApp: string | null = null;
    let holdResearch = true;
    let runSeq = 0;
    const runChild = (args: string[], onText: (t: string) => void): Promise<number> => {
      calls.push(args);
      if (args[1] === 'research') {
        onText('[150/300] hosapp149: cve created\n');
        if (holdResearch) { holdResearch = false; return new Promise((r) => { release = () => r(0); }); }
        onText('Research complete: 300 app(s)\n');
      }
      if (args[0] === 'assess') {
        const app = args[2]!;
        onText('[info] Running Pass 11 -- compliance_evaluation...\n');
        // Simulate a finished run: a new latest-service.txt pointer.
        runSeq += 1;
        writeFileSync(join(ws, 'apps', app, 'wsp', 'latest-service.txt'), `runs/t${runSeq}`);
        if (app === holdApp) { holdApp = null; return new Promise((r) => { release = () => r(0); }); }
      }
      return Promise.resolve(0);
    };

    // #3518: the in-process plan names the 300 apps before the scope question.
    const previewInit = async (): Promise<ServiceInitPreview> => ({ sourceName: 'intake.xlsx', plannedAppIds: ids, existingServiceAppIds: ids, conflict: { appIds: [], sources: [] } });
    const r = render(<ServiceInitScreen onBack={() => {}} workspacePath={ws} runChild={runChild} previewInit={previewInit} />);
    await tick();
    const headerLine = (r.lastFrame() ?? '').split('\n')[1];
    r.stdin.write('intake.xlsx');
    await tick();
    r.stdin.write('\r');
    await tick();
    r.stdin.write('\r');
    await tick();
    // #3304: skip LLM research; the R re-run below reuses the choice.
    r.stdin.write(DOWN);
    await tick();
    r.stdin.write('\r');
    await tick();
    holdApp = 'hosapp150';
    expect(r.lastFrame() ?? '').toContain('assess every app (300 apps, assessment about 15 h to 20 h)');
    r.stdin.write(DOWN);
    await tick();
    r.stdin.write('\r');
    await tick();
    r.stdin.write('\r'); // #4400: the framework step (SWAO_APM fixed)
    await tick();
    // #3518: "all" is confirmed with the count first; nothing runs before Enter.
    expect(flat(r.lastFrame())).toContain('Apps to assess 300');
    expect(calls).toEqual([]);
    r.stdin.write('\r');
    await tick(100);

    const check = (frame: string) => {
      expect(frame.split('\n').length).toBeLessThanOrEqual(ROWS);
      expect(frame.split('\n')[1]).toBe(headerLine);
      expect(frame).toContain('Service Portfolio Assessment');
    };

    // Research stage, held at 150 of 300.
    let frame = r.lastFrame() ?? '';
    // #4237 / #4256: RunPanel; the stage line names the stage, the item bar counts the apps.
    expect(frame).toContain('Stage 2 of 4');
    expect(frame).toContain('150 of 300 apps researched');
    expect(frame).not.toContain(' -- ');
    check(frame);
    release!();
    await tick(400);

    // Assessment stage, held at the 151st app.
    frame = r.lastFrame() ?? '';
    expect(frame).toContain('Stage 3 of 4');
    expect(frame).toContain('Assessing service apps (All 300)');
    expect(frame).toContain('App 151 of 300: hosapp150, pass compliance evaluation');
    expect(frame).toContain('150 of 300 apps assessed');
    expect(frame).not.toContain(' -- ');
    check(frame);
    release!();
    await tick(600);

    frame = r.lastFrame() ?? '';
    // #4238: FinishPanel with a short summary and the What next menu; the details sit behind Show details.
    expect(frame).toContain('Service Portfolio Assessment complete');
    expect(frame).toContain('300 of 300 apps complete');
    expect(frame).toContain('What next');
    expect(frame).toContain('Re-assess the same 300 apps');
    expect(frame).toContain('Back to main menu');
    // #4238: publish the assessed apps from the menu; #4256: the real run folder, no placeholder, no workspace line under the header.
    expect(frame).toContain('Publish the HTML reports of the 300 assessed apps');
    expect(frame.replace(/\s+/g, ' ')).toContain('apps/hosapp000/wsp/runs/t1/ and the run folders of 299 more apps');
    expect(frame).not.toContain('apps/<id>/');
    expect(frame).not.toContain('Workspace: ');
    expect(frame.split('\n').filter((l) => l.includes('Enter')).length).toBe(1);
    expect(frame).not.toContain(' -- ');
    expect(frame).not.toContain('hosapp000:');
    check(frame);
    expect(calls.filter((c) => c[0] === 'assess')).toHaveLength(300);

    // Show details (third entry), then back to the finish screen.
    r.stdin.write(DOWN);
    await tick();
    r.stdin.write(DOWN);
    await tick();
    r.stdin.write('\r');
    await tick(100);
    frame = r.lastFrame() ?? '';
    expect(frame).toContain('Details of the run');
    expect(frame).toContain('hosapp000: skipped pass count unavailable');
    expect(frame).toContain('more lines');
    check(frame);
    r.stdin.write('\r');
    await tick(100);
    expect(r.lastFrame() ?? '').toContain('What next');

    // Re-run the research, no questions (fourth entry).
    for (let i = 0; i < 3; i++) { r.stdin.write(DOWN); await tick(); }
    r.stdin.write('\r');
    await tick(200);
    frame = r.lastFrame() ?? '';
    expect(frame).toContain('Research re-run complete');
    expect(calls.filter((c) => c[1] === 'research')).toHaveLength(2);
    expect(calls.filter((c) => c[1] === 'research').every((c) => c.includes('--skip-llm'))).toBe(true);
    expect(calls.filter((c) => c[1] === 'init')).toHaveLength(1);
    check(frame);

    // Re-assess the same 300 apps (fifth entry).
    for (let i = 0; i < 4; i++) { r.stdin.write(DOWN); await tick(); }
    r.stdin.write('\r');
    await tick(600);
    frame = r.lastFrame() ?? '';
    expect(frame).toContain('Assessment re-run complete for the same 300 app(s)');
    expect(calls.filter((c) => c[0] === 'assess')).toHaveLength(600);
    check(frame);
    // #4238: Publish the HTML reports (first entry) runs swao publish --app <id> per assessed app.
    r.stdin.write('\r');
    await tick(600);
    frame = r.lastFrame() ?? '';
    expect(frame).toContain('Publish the HTML reports');
    expect(frame).toContain('hosapp000: published (apps/hosapp000/wsp/publications/)');
    expect(calls.filter((c) => c[0] === 'publish')).toHaveLength(300);
    expect(calls.find((c) => c[0] === 'publish')).toEqual(['publish', '--app', 'hosapp000', '--workspace', ws]);
    r.unmount();
  }, 60_000); // #3294 (D-32): 30 s timed out under full-suite load; 12 s alone
});

// #3521: a second intake workbook next to an earlier import is named before anything is scaffolded.
describe('ServiceInitScreen second intake workbook (#3521)', () => {
  const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
  const DOWN = '\u001B[B';

  it('passes the choice for a second intake workbook to the CLI as --replace / --keep', () => {
    expect(buildServiceInitArgs('in.xlsx', '', '/ws', 'replace')).toEqual(['service', 'init', '--from', 'in.xlsx', '--workspace', '/ws', '--replace']);
    expect(buildServiceInitArgs('in.xlsx', '', '/ws', 'keep')).toEqual(['service', 'init', '--from', 'in.xlsx', '--workspace', '/ws', '--keep']);
    expect(buildServiceInitArgs('in.xlsx', '', '/ws', 'refuse')).toEqual(['service', 'init', '--from', 'in.xlsx', '--workspace', '/ws']);
  });

  it('previewServiceInit returns null for a workbook that does not exist (the CLI reports it)', async () => {
    expect(await previewServiceInit(join(tmpdir(), 'swao-does-not-exist', 'intake.xlsx'),'', mkdtempSync(join(tmpdir(), 'swao-svc-prev-')))).toBeNull();
  });

  async function toConflictQuestion(runChild: ServiceChildRunner) {
    const ws = mkdtempSync(join(tmpdir(), 'swao-svc-tui-3521-'));
    dirs.push(ws);
    const preview: ServiceInitPreview = {
      sourceName: 'second.xlsx',
      plannedAppIds: ['app0001', 'app0002'],
      existingServiceAppIds: ['vma001', 'vma002', 'vma003'],
      conflict: { appIds: ['vma001', 'vma002', 'vma003'], sources: ['first.xlsx'] },
    };
    const r = render(<ServiceInitScreen onBack={() => {}} workspacePath={ws} runChild={runChild} previewInit={async () => preview} />);
    await tick();
    r.stdin.write('second.xlsx');
    await tick();
    r.stdin.write('\r'); // intake
    await tick();
    r.stdin.write('\r'); // column map
    await tick();
    r.stdin.write('\r'); // LLM research: run
    await tick(120);
    return r;
  }

  it('names the other workbook and its app count, defaults to Back, and spawns nothing', async () => {
    const calls: string[][] = [];
    const r = await toConflictQuestion(async (args) => { calls.push(args); return 0; });
    const frame = r.lastFrame() ?? '';
    expect(frame.replace(/\s+/g, ' ')).toContain('already holds 3 service app(s) from another intake workbook (first.xlsx)');
    expect(frame).toContain('second.xlsx (2 apps)');
    r.stdin.write('\r'); // Back (first option)
    await tick();
    expect(r.lastFrame() ?? '').toContain('Enter the path to the intake Excel file');
    expect(calls).toEqual([]);
    r.unmount();
  });

  it('Replace runs service init with --replace', async () => {
    const calls: string[][] = [];
    const r = await toConflictQuestion(async (args) => { calls.push(args); return 0; });
    r.stdin.write(DOWN);
    await tick();
    r.stdin.write('\r'); // Replace
    await tick();
    expect(r.lastFrame() ?? '').toContain('What should SWAO run?');
    r.stdin.write(DOWN);
    await tick();
    r.stdin.write(DOWN);
    await tick();
    r.stdin.write('\r'); // scaffold and research only
    await tick();
    r.stdin.write('\r'); // confirm (#3518)
    await tick(300);
    expect(calls[0]).toEqual(expect.arrayContaining(['service', 'init', '--replace']));
    r.unmount();
  });
});

// #3518: "assess every app" is confirmed with scope, app count, duration and LLM calls.
describe('ServiceInitScreen scope confirmation (#3518)', () => {
  const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
  const DOWN = '\u001B[B';
  const ESC = '\u001B';
  const LEFT = '\u001B[D';

  it('computes count, duration and LLM calls per scope', () => {
    const all = planScope('all', 461, { skipLlmResearch: false });
    expect(all).toMatchObject({ assessApps: 461, duration: estimateAssessment(461), researchLlmCalls: 461 * RESEARCH_LLM_CALLS_PER_APP, assessLlmCallsMin: 461 * MIN_ASSESS_LLM_CALLS_PER_APP });
    expect(planScope('top', 461, { skipLlmResearch: true })).toMatchObject({ assessApps: 20, researchLlmCalls: 0 });
    expect(planScope('top', 7, { skipLlmResearch: false }).assessApps).toBe(7);
    expect(planScope('none', 461, { skipLlmResearch: false })).toMatchObject({ assessApps: 0, duration: null, assessLlmCallsMin: 0 });
    expect(planScope('all', null, { skipLlmResearch: false })).toMatchObject({ assessApps: null, researchLlmCalls: null });
    const lines = scopeConfirmationLines(all);
    expect(lines).toContain('Scope: All apps');
    expect(lines).toContain('Service apps after the scaffold: 461');
    expect(lines).toContain('Apps to assess: 461');
    expect(lines.some((l) => l.startsWith('Estimated assessment time: about ') && l.includes('x 461 apps'))).toBe(true);
    expect(lines).toContain(`LLM calls: research ${461 * 4}; assessment at least ${461 * 4}`);
    expect(scopeTag('top', 20)).toBe('Top 20');
    expect(scopeTag('all', 461)).toBe('All 461');
  });

  it('always confirms "all"; small scopes skip only with service_portfolio.confirm_small_scope: false', () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-svc-confirm-'));
    dirs.push(ws);
    expect(needsScopeConfirmation('all', ws)).toBe(true);
    expect(needsScopeConfirmation('top', ws)).toBe(true);
    expect(needsScopeConfirmation('none', ws)).toBe(true);
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\nservice_portfolio:\n  confirm_small_scope: false\n');
    expect(needsScopeConfirmation('all', ws)).toBe(true);
    expect(needsScopeConfirmation('top', ws)).toBe(false);
    expect(needsScopeConfirmation('top', ws, 50)).toBe(true);
    expect(needsScopeConfirmation('none', ws)).toBe(false);
  });

  async function toScopeQuestion(plannedApps: number, runChild: ServiceChildRunner, swaoYml?: string, extra: Partial<ServiceInitPreview> = {}) {
    const ws = mkdtempSync(join(tmpdir(), 'swao-svc-tui-3518-'));
    dirs.push(ws);
    if (swaoYml) writeFileSync(join(ws, '.swao.yml'), swaoYml);
    const ids = Array.from({ length: plannedApps }, (_, i) => `app${String(i).padStart(4, '0')}`);
    const preview: ServiceInitPreview = { sourceName: 'inventory.xlsx', plannedAppIds: ids, existingServiceAppIds: [], conflict: { appIds: [], sources: [] }, ...extra };
    const r = render(<ServiceInitScreen onBack={() => {}} workspacePath={ws} runChild={runChild} previewInit={async () => preview} />);
    await tick();
    r.stdin.write('inventory.xlsx');
    await tick();
    r.stdin.write('\r'); // intake
    await tick();
    r.stdin.write('\r'); // column map
    await tick();
    r.stdin.write('\r'); // LLM research: run
    await tick(120);
    return r;
  }

  // #4489: the Column map gave no vendor column; the scope question says so before the run.
  it('warns on the scope question when no column maps to vendor.name', async () => {
    const warning = 'no column maps to vendor.name: 0 of 3 apps have a vendor name; CVE lookups and vendor consolidation need a vendor column';
    const r = await toScopeQuestion(3, async () => 0, undefined, { vendorWarning: warning });
    const frame = flat(r.lastFrame() ?? '');
    expect(frame).toContain('Column map');
    expect(frame).toContain('0 of 3 apps have a vendor name');
    expect(vendorWarningOf(['other', warning])).toBe(warning);
    expect(vendorWarningOf(['other'])).toBeUndefined();
    r.unmount();
  });

  it('selecting "all" renders the confirmation with count and estimate; Esc asks, the left arrow returns to the scope question without spawning a child', async () => {
    const calls: string[][] = [];
    const r = await toScopeQuestion(461, async (args) => { calls.push(args); return 0; });
    expect(r.lastFrame() ?? '').toContain('assess every app (461 apps, assessment about 23 h to 31 h)');
    r.stdin.write(DOWN);
    await tick();
    r.stdin.write('\r');
    await tick();
    r.stdin.write('\r'); // #4400: the framework step (SWAO_APM fixed)
    await tick();
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain(CONFIRM_TITLE);
    expect(flat(frame)).toContain('Scope All apps');
    expect(flat(frame)).toContain('Apps to assess 461');
    // #4374: the time includes the research stage, each part with its basis.
    expect(flat(frame)).toContain('Estimated time about 25.1 h to 32.8 h');
    expect(flat(frame)).toContain('Research time 2.0 h (1844 call(s) x 4.0 s per call, typical value, not measured yet)');
    expect(frame).not.toContain('Estimated assessment time');
    expect(flat(frame)).toContain('LLM calls research 1844; assessment at least 1844');
    // #4236: Design 126 KeyHints, no double dash (#4235); the cost line is always shown.
    // #4255 (Design 126 sections 7.2 and 7.4): the left arrow goes back, Esc aborts the flow.
    expect(frame).toContain('← back to the frameworks'); // #4400
    expect(frame).toContain('Esc abort');
    expect(frame).not.toContain('Enter -- start');
    expect(flat(frame)).toContain('Expected cost ');
    expect(calls).toEqual([]);
    r.stdin.write(ESC); // asks first: the flow is dirty after the intake step
    await tick(120);
    expect(r.lastFrame() ?? '').toContain('Abort the assessment?');
    r.stdin.write(ESC); // stay
    await tick(120);
    expect(r.lastFrame() ?? '').toContain(CONFIRM_TITLE);
    r.stdin.write(LEFT);
    await tick(120);
    expect(r.lastFrame() ?? '').toContain('Add community frameworks to this run'); // #4400: back to the framework step
    r.stdin.write(LEFT);
    await tick(120);
    expect(r.lastFrame() ?? '').toContain('What should SWAO run? (Top N asks for N next; the frameworks follow)');
    expect(calls).toEqual([]);
    r.unmount();
  });

  it('#4236: above 25 USD the first Enter asks a second confirmation; Tab switches to the cheaper research model', async () => {
    const calls: string[][] = [];
    const yml = ['wsp_version: "0.9"', 'providers:', '  llm:', '    primary:', '      type: anthropic', '      model: claude-opus-4-7', ''].join('\n');
    const r = await toScopeQuestion(461, async (args) => { calls.push(args); return 0; }, yml);
    r.stdin.write(DOWN);
    await tick();
    r.stdin.write('\r'); // all apps
    await tick();
    r.stdin.write('\r'); // #4400: the framework step (SWAO_APM fixed)
    await tick();
    let frame = r.lastFrame() ?? '';
    expect(flat(frame)).toContain('Expected cost about');
    expect(flat(frame)).toContain('Research model Cheaper research model available: claude-haiku-4-5');
    expect(frame).toContain('Enter confirm the scope');
    expect(frame).not.toContain(' -- start');
    r.stdin.write('\t'); // cheaper research model
    await tick();
    expect(flat(r.lastFrame())).toContain('Research model claude-haiku-4-5 for this run');
    r.stdin.write('\r'); // first Enter: still above 25 USD (1844 research calls)
    await tick();
    frame = r.lastFrame() ?? '';
    expect(flat(frame)).toMatch(/The expected cost \d+\.\d\d USD is above 25\.00 USD\. Confirm the cost once more to start the run\./);
    expect(calls).toEqual([]);
    r.stdin.write(LEFT); // #4255: the back key withdraws the cost confirmation, stays on the step
    await tick(120);
    expect(r.lastFrame() ?? '').toContain(CONFIRM_TITLE);
    expect(flat(r.lastFrame())).not.toContain("Confirm the cost once more");
    r.stdin.write('\r');
    await tick();
    r.stdin.write('\r'); // second confirmation
    await tick(400);
    expect(calls.filter((c) => c[0] === 'service' && c[1] === 'init')).toHaveLength(1);
    const research = calls.find((c) => c[0] === 'service' && c[1] === 'research');
    if (research) expect(research).toEqual(expect.arrayContaining(['--model', 'claude-haiku-4-5']));
    r.unmount();
  });

  it('a fast double Enter on the confirmation starts the pipeline exactly once', async () => {
    const calls: string[][] = [];
    const r = await toScopeQuestion(2, async (args) => { calls.push(args); return 0; });
    r.stdin.write('\r'); // top N
    await tick();
    expect(r.lastFrame() ?? '').toContain('How many apps by risk?');
    r.stdin.write('\r'); // keep the default N
    await tick();
    r.stdin.write('\r'); // #4400: the framework step (SWAO_APM fixed)
    await tick();
    expect(r.lastFrame() ?? '').toContain(CONFIRM_TITLE);
    r.stdin.write('\r'); // confirm
    r.stdin.write('\r'); // second Enter before the re-render
    await tick(400);
    expect(calls.filter((c) => c[0] === 'service' && c[1] === 'init')).toHaveLength(1);
    r.unmount();
  });

  it('#4230: with the guidance box open Esc closes the box only and Enter starts no paid run', async () => {
    const calls: string[][] = [];
    const r = await toScopeQuestion(2, async (args) => { calls.push(args); return 0; });
    r.stdin.write('\r'); // top N
    await tick();
    r.stdin.write('\r'); // keep the default N
    await tick();
    r.stdin.write('\r'); // #4400: the framework step (SWAO_APM fixed)
    await tick();
    expect(r.lastFrame() ?? '').toContain(CONFIRM_TITLE);
    r.stdin.write('\u0007'); // Ctrl+G opens the box
    await tick();
    r.stdin.write('\r');
    await tick(200);
    expect(calls).toEqual([]);
    r.stdin.write(ESC); // closes the box, stays on the confirmation
    await tick(120);
    expect(r.lastFrame() ?? '').toContain(CONFIRM_TITLE);
    r.stdin.write('\r');
    await tick(400);
    expect(calls.filter((c) => c[0] === 'service' && c[1] === 'init')).toHaveLength(1);
    r.unmount();
  });

  it('Top N (#3520): an out-of-range N is refused, a valid N is confirmed', async () => {
    const calls: string[][] = [];
    const r = await toScopeQuestion(2, async (args) => { calls.push(args); return 0; });
    r.stdin.write('\r'); // top N
    await tick();
    expect(r.lastFrame() ?? '').toContain('How many apps by risk? (1 to 2; default 2)');
    r.stdin.write('\u007F'); // clear the default
    await tick();
    r.stdin.write('5');
    await tick();
    r.stdin.write('\r');
    await tick();
    expect(r.lastFrame() ?? '').toContain('Enter a whole number from 1 to 2.');
    r.stdin.write('\u007F');
    await tick();
    r.stdin.write('1');
    await tick();
    r.stdin.write('\r');
    await tick();
    r.stdin.write('\r'); // #4400: the framework step (SWAO_APM fixed)
    await tick();
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain(CONFIRM_TITLE);
    expect(flat(frame)).toContain('Scope Top 1 by risk');
    expect(calls).toEqual([]);
    r.unmount();
  });

  it('stops before assessing when the scaffold yields a different count than the one confirmed', async () => {
    const calls: string[][] = [];
    const r = await toScopeQuestion(2, async (args) => { calls.push(args); return 0; });
    r.stdin.write(DOWN);
    await tick();
    r.stdin.write('\r'); // all
    await tick();
    r.stdin.write('\r'); // #4400: the framework step (SWAO_APM fixed)
    await tick();
    r.stdin.write('\r'); // confirm 2 apps
    await tick(400);
    // The mock init writes no app folder, so the workspace holds 0 apps, not the 2 confirmed.
    const stopped = (r.lastFrame() ?? '').replace(/\s+/g, ' ');
    expect(stopped).toContain('Service Portfolio Assessment stopped');
    expect(stopped).toContain('Stopped before the assessment: 0 service app(s) after the scaffold, but 2 were confirmed');
    expect(calls.some((c) => c[0] === 'assess')).toBe(false);
    r.unmount();
  });

  it('#4400: One service picks one service app, keeps SWAO_APM fixed and passes an added framework to --regimes', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-svc-tui-4400-'));
    dirs.push(ws);
    for (const id of ['app0000', 'app0001']) {
      mkdirSync(join(ws, 'apps', id), { recursive: true });
      writeFileSync(join(ws, 'apps', id, '.swao.yml'), ['app_id: ' + id, 'assessment:', '  type: service', ''].join(String.fromCharCode(10)));
    }
    // #4456: only frameworks installed in the workspace are offered.
    cpSync(join(communityFrameworksDir, 'nis2'), join(ws, 'wsp', 'inputs', 'catalogs', 'community', 'nis2'), { recursive: true });
    const calls: string[][] = [];
    const runChild: ServiceChildRunner = async (args) => { calls.push(args); return 0; };
    const preview: ServiceInitPreview = { sourceName: 'inventory.xlsx', plannedAppIds: ['app0000', 'app0001', 'app0002'], existingServiceAppIds: ['app0000', 'app0001'], conflict: { appIds: [], sources: [] } };
    const r = render(<ServiceInitScreen onBack={() => {}} workspacePath={ws} runChild={runChild} previewInit={async () => preview} />);
    await tick();
    r.stdin.write('inventory.xlsx');
    await tick();
    r.stdin.write('\r'); // intake
    await tick();
    r.stdin.write('\r'); // column map
    await tick();
    r.stdin.write('\r'); // LLM research: run
    await tick(120);
    for (let i = 0; i < 3; i++) { r.stdin.write(DOWN); await tick(); }
    expect(r.lastFrame() ?? '').toContain('One service: pick one service app');
    r.stdin.write('\r'); // One service
    await tick();
    expect(r.lastFrame() ?? '').toContain('Which service app should SWAO assess?');
    expect(r.lastFrame() ?? '').toContain('app0002');
    r.stdin.write(DOWN);
    await tick();
    r.stdin.write('\r'); // app0001
    await tick(120);
    let frame = r.lastFrame() ?? '';
    expect(frame).toContain('SWAO_APM');
    expect(frame).toContain('always evaluated in a service run');
    expect(frame).toContain('Add community frameworks to this run');
    expect(frame).toContain('NIS2');
    expect(frame).toContain('More frameworks: copy a framework folder into wsp/inputs/catalogs/community/<folder>/');
    r.stdin.write(' '); // add the first offered framework
    await tick();
    r.stdin.write('\r');
    await tick(120);
    frame = r.lastFrame() ?? '';
    expect(frame).toContain(CONFIRM_TITLE);
    expect(flat(frame)).toContain('Scope One service (app0001)');
    expect(flat(frame)).toContain('Apps to assess 1');
    expect(flat(frame)).toMatch(/Frameworks SWAO_APM \(always evaluated\), [A-Z0-9_]+/);
    expect(calls).toEqual([]);
    r.stdin.write('\r'); // start
    await tick(400);
    // The picked app has a folder: no scaffold; research and assessment of that app only.
    expect(calls.some((c) => c[1] === 'init')).toBe(false);
    expect(calls.find((c) => c[1] === 'research')).toEqual(expect.arrayContaining(['--app', 'app0001']));
    const assess = calls.filter((c) => c[0] === 'assess');
    expect(assess).toHaveLength(1);
    expect(assess[0]!.slice(0, 3)).toEqual(['assess', '--app', 'app0001']);
    const regimes = assess[0]![assess[0]!.indexOf('--regimes') + 1]!.split(',');
    expect(regimes[0]).toBe('SWAO_APM');
    expect(regimes).toHaveLength(2);
    // #4457: every pipeline step logs start and complete in the portfolio log.
    const logDir = join(ws, 'wsp', 'logs');
    const steps = readdirSync(logDir).filter((f) => f.startsWith('portfolio-events-')).flatMap((f) => readFileSync(join(logDir, f), 'utf-8').split(String.fromCharCode(10)).filter(Boolean))
      .map((l) => JSON.parse(l) as { code: string; context: Record<string, unknown> }).filter((e) => e.code.startsWith('service.pipeline.step.'))
      .map((e) => `${e.code.slice('service.pipeline.step.'.length)}:${String(e.context['step'])}`);
    expect(steps.slice(0, 6)).toEqual(['start:discover', 'complete:discover', 'start:research', 'complete:research', 'start:assess', 'complete:assess']);
    r.unmount();
  });
});

// #4255 (Design 126 section 4.4): the confirmation lines as ConfirmPanel rows.
describe('serviceConfirmRows (#4255)', () => {
  it('splits "Label: value" lines, shortens the long labels, keeps a line without a label as a note', () => {
    const rows = serviceConfirmRows(
      ['Scope: All apps', 'Service apps after the scaffold: 461', 'Estimated assessment time: about 23 h'],
      ['Research ranks all 461 apps to pick the top 10', 'Expected cost: about 3.10 USD'],
      'Cheaper research model available: claude-haiku-4-5; Tab switches to it',
    );
    expect(rows).toEqual([
      { label: 'Scope', value: 'All apps' },
      { label: 'Service apps', value: '461' },
      { label: 'Assessment time', value: 'about 23 h' },
      { label: 'Note', value: 'Research ranks all 461 apps to pick the top 10' },
      { label: 'Expected cost', value: 'about 3.10 USD' },
      { label: 'Research model', value: 'Cheaper research model available: claude-haiku-4-5; Tab switches to it' },
    ]);
  });
});

// #4400: the One service scope and the framework step.
describe('One service and the framework step (#4400)', () => {
  it('builds the research and assessment arguments of one service app, SWAO_APM first', () => {
    expect(buildServiceResearchArgs('/ws', { app: 'app0001' })).toEqual(['service', 'research', '--workspace', '/ws', '--app', 'app0001']);
    expect(buildServiceAssessArgs('/ws', 'app0001', ['NIS2', 'SWAO_APM'])).toEqual(['assess', '--app', 'app0001', '--type', 'service', '--workspace', '/ws', '--regimes', 'SWAO_APM,NIS2']);
    expect(buildServiceAssessArgs('/ws', 'app0001', [])).toEqual(['assess', '--app', 'app0001', '--type', 'service', '--workspace', '/ws', '--regimes', 'SWAO_APM']);
  });

  it('plans one app, one research, and names the app and the frameworks on the confirmation', () => {
    const plan = planScope('one', 234, { skipLlmResearch: false });
    expect(plan).toMatchObject({ assessApps: 1, researchLlmCalls: RESEARCH_LLM_CALLS_PER_APP, assessLlmCallsMin: MIN_ASSESS_LLM_CALLS_PER_APP });
    expect(scopeTag('one', 1)).toBe('One service');
    const lines = scopeConfirmationLines(plan, { app: 'app0001', frameworks: ['NIS2'] });
    expect(lines[0]).toBe('Scope: One service (app0001)');
    expect(lines).toContain('Frameworks: SWAO_APM (always evaluated), NIS2');
  });

  it('the back key walks the framework step back to its scope detail', () => {
    expect(serviceBackPhase('frameworks', 'one')).toBe('pick-app');
    expect(serviceBackPhase('frameworks', 'top')).toBe('top-n');
    expect(serviceBackPhase('frameworks', 'all')).toBe('scope');
    expect(serviceBackPhase('pick-app', 'one')).toBe('scope');
    expect(serviceBackPhase('confirm', 'none')).toBe('scope');
    expect(serviceBackPhase('confirm', 'top')).toBe('frameworks');
  });

  it('the TUI hints never name swao assess --type service (Design 103 section 3.6)', () => {
    const cli = serviceGuidanceDetails().find((d) => d.label === 'CLI')!.value;
    expect(cli).toContain('swao service assess --app <id>');
    expect(cli).not.toContain('--type service');
    expect(serviceFinishGuidance({ assessApps: 2, export: true }).cli).not.toContain('--type service');
  });
});
