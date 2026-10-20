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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import {
  ServiceInitScreen, ServiceAssessSummary, buildServiceAssessArgs, buildServiceInitArgs, buildServiceExportArgs, buildServiceResearchArgs,
  lineColor, readServiceAssessOutcome, readServiceRunPointer,
  defaultServiceIntake, estimateAssessment, formatDuration, parsePassProgress, parseResearchProgress,
  finishedKeyAction, rerunAffordances, serviceGuidanceDetails, SERVICE_COLUMN_MAPPING_DOCS_URL,
} from '../ServiceInitScreen.js';

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

  it('highlights the SCAFFOLD signal count and the manual-classification prompt', () => {
    expect(lineColor('  SCAFFOLD signals : 4 (written to x)')).toBe('cyan');
    expect(lineColor('2 app(s) could not be auto-classified. Review and assign infra_category manually:')).toBe('yellow');
    expect(lineColor('[error] Scaffold halted')).toBe('red');
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
    expect(mappingFrame).toContain('Press Enter to detect the columns from the headers (recommended)');
    expect(mappingFrame).not.toMatch(/: :/);
    r.stdin.write('\r');
    await tick();
    // #3304: LLM research choice, defaulting to run.
    const llmFrame = r.lastFrame() ?? '';
    expect(llmFrame).toContain('LLM research of vendor profile, certifications, data residency and breach history?');
    expect(llmFrame).toContain('Skip LLM research for this run');
    r.stdin.write('\r');
    await tick();
    const scopeFrame = r.lastFrame() ?? '';
    expect(scopeFrame).toContain('What should SWAO run? (no further questions after this)');
    expect(scopeFrame).toContain('assess the top 20 by risk');
    expect(scopeFrame).toContain('Scaffold and research only');
    r.unmount();
  });
});

// #3220: re-run keys, docs link in the guidance, and a simulated 300-app run.
describe('ServiceInitScreen follow-ups (#3220)', () => {
  const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
  const DOWN = '\u001B[B';
  const ROWS = 40;

  it('maps finished-screen keys to single-stage re-runs, offering only what is available', () => {
    const full = { assessApps: 20, export: true };
    expect(finishedKeyAction('r', {}, full)).toBe('research');
    expect(finishedKeyAction('A', {}, full)).toBe('assess');
    expect(finishedKeyAction('e', {}, full)).toBe('export');
    expect(finishedKeyAction('q', {}, full)).toBe('back');
    expect(finishedKeyAction('', { return: true }, full)).toBe('back');
    expect(finishedKeyAction('', { escape: true }, full)).toBe('back');
    const none = { assessApps: 0, export: false };
    expect(finishedKeyAction('a', {}, none)).toBeNull();
    expect(finishedKeyAction('e', {}, none)).toBeNull();
    expect(finishedKeyAction('x', {}, full)).toBeNull();
    expect(rerunAffordances(full)).toEqual(['R -- re-run research', 'A -- re-assess the same 20 app(s)', 'E -- re-run the export', 'Enter / Esc / Q -- back']);
    expect(rerunAffordances(none)).toEqual(['R -- re-run research', 'Enter / Esc / Q -- back']);
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

    const r = render(<ServiceInitScreen onBack={() => {}} workspacePath={ws} runChild={runChild} />);
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
    r.stdin.write(DOWN);
    await tick();
    r.stdin.write('\r');
    await tick(100);

    const check = (frame: string) => {
      expect(frame.split('\n').length).toBeLessThanOrEqual(ROWS);
      expect(frame.split('\n')[1]).toBe(headerLine);
      expect(frame).toContain('Service Portfolio Assessment');
    };

    // Research stage, held at 150 of 300.
    let frame = r.lastFrame() ?? '';
    expect(frame).toContain('Stage 2/4');
    expect(frame).toContain('Research 150/300 apps');
    check(frame);
    release!();
    await tick(400);

    // Assessment stage, held at the 151st app.
    frame = r.lastFrame() ?? '';
    expect(frame).toContain('Stage 3/4');
    expect(frame).toContain('App 151/300: hosapp150');
    expect(frame).toContain('Pass compliance evaluation');
    check(frame);
    release!();
    await tick(600);

    frame = r.lastFrame() ?? '';
    expect(frame).toContain('Service Portfolio Assessment complete.');
    expect(frame).toContain('Service assessments: 300/300 complete');
    expect(frame).toContain('+292 more');
    expect(frame).toContain('Keys: R -- re-run research | A -- re-assess the same 300 app(s) | Enter / Esc / Q -- back');
    check(frame);
    expect(calls.filter((c) => c[0] === 'assess')).toHaveLength(300);

    // R: research again, no questions.
    r.stdin.write('r');
    await tick(200);
    frame = r.lastFrame() ?? '';
    expect(frame).toContain('Research re-run complete.');
    expect(calls.filter((c) => c[1] === 'research')).toHaveLength(2);
    expect(calls.filter((c) => c[1] === 'research').every((c) => c.includes('--skip-llm'))).toBe(true);
    expect(calls.filter((c) => c[1] === 'init')).toHaveLength(1);
    check(frame);

    // A: the same 300 apps again.
    r.stdin.write('a');
    await tick(600);
    frame = r.lastFrame() ?? '';
    expect(frame).toContain('Assessment re-run complete for the same 300 app(s).');
    expect(calls.filter((c) => c[0] === 'assess')).toHaveLength(600);
    check(frame);
    r.unmount();
  }, 60_000); // #3294 (D-32): 30 s timed out under full-suite load; 12 s alone
});
