// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4198 SET-10 (Design 125 section 5.7) and #4239 / #4255 (TUI-11): the app
// picker lists applications before service apps, starts on the subject app of
// the setup, is bounded (a workspace of 235 apps fits the window with the key
// hints and the guidance box on screen) and filters by typing.
//
// ink-testing-library is a dependency of packages/swao only, so this file
// renders through ink directly with a fake stdout of a chosen width.

import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render as inkRender, type Instance } from 'ink';
import type { ReactElement } from 'react';
import { AppPickerPhase, appOptionGuidance, appPickerInitialIndex, appPickerOptions, APP_ACTIONS_GROUP, pickerApps, serviceAppsNote } from './AppPickerPhase.js';
import { listWorkspaceApps, readSubjectApp, appKind } from './app-kinds.js';

class FakeStdout extends EventEmitter {
  frames: string[] = [];
  constructor(readonly columns: number, readonly rows: number) { super(); }
  write = (frame: string): boolean => { this.frames.push(frame); return true; };
}
class FakeStdin extends EventEmitter {
  isTTY = true;
  private data: string | null = null;
  write = (d: string): void => { this.data = d; this.emit('readable'); this.emit('data', d); };
  read = (): string | null => { const d = this.data; this.data = null; return d; };
  setEncoding(): void { /* no-op */ }
  setRawMode(): void { /* no-op */ }
  resume(): void { /* no-op */ }
  pause(): void { /* no-op */ }
  ref(): void { /* no-op */ }
  unref(): void { /* no-op */ }
}

const instances: Instance[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const i of instances.splice(0)) i.unmount();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// eslint-disable-next-line no-control-regex
const plain = (t: string): string => t.replace(/\x1b\[[0-9;]*m/g, '');

function render(tree: ReactElement, columns: number, rows = 40): { lines: () => string[]; stdin: FakeStdin } {
  const stdout = new FakeStdout(columns, rows);
  const stdin = new FakeStdin();
  instances.push(inkRender(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new FakeStdout(columns, rows) as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  }));
  return { lines: () => plain(stdout.frames[stdout.frames.length - 1] ?? '').split('\n'), stdin };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));
/** #4484: the picker draws 'Loading apps' first and lists the apps after the scan. */
async function loaded(r: { lines: () => string[] }): Promise<void> {
  for (let i = 0; i < 200 && (r.lines().join(' ').includes('Loading apps') || !r.lines().join(' ').includes('Select app')); i++) await tick();
  await tick();
}

/** A workspace with `service` service apps (app0001...) and the given applications. */
function workspace(applications: string[], service: number, yml = ''): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-4239-'));
  dirs.push(ws);
  writeFileSync(join(ws, '.swao.yml'), yml, 'utf-8');
  for (const id of applications) {
    mkdirSync(join(ws, 'apps', id), { recursive: true });
    writeFileSync(join(ws, 'apps', id, '.swao.yml'), `app_id: ${id}\n`, 'utf-8');
  }
  for (let i = 1; i <= service; i++) {
    const id = `app${String(i).padStart(4, '0')}`;
    mkdirSync(join(ws, 'apps', id), { recursive: true });
    writeFileSync(join(ws, 'apps', id, '.swao.yml'), `app_id: ${id}\nassessment:\n  type: service\n`, 'utf-8');
  }
  return ws;
}

const noop = (): void => undefined;
function picker(ws: string, onSelect: (id: string) => void = noop, assessmentType: 'application' | 'landing-zone' = 'landing-zone', onBack: () => void = noop): ReactElement {
  return (
    <AppPickerPhase
      workspace={ws} assessmentType={assessmentType} typeLabel="Landing Zone Catalog Assessment"
      onSelect={onSelect} onNew={noop} onNewApp={noop} onDelete={noop} onRename={noop}
      onEditCredentials={noop} onBack={onBack} header={{ version: '0.0.0-test', licenseState: null }}
      steps={['Application', 'Credentials', 'Run']} current={0}
    />
  );
}

describe('app kinds and subject app (#4239)', () => {
  it('lists applications first, service apps after, each group by id', () => {
    const ws = workspace(['zeta', 'sovereign-health'], 2);
    expect(listWorkspaceApps(ws)).toEqual([
      { id: 'sovereign-health', kind: 'application' },
      { id: 'zeta', kind: 'application' },
      { id: 'app0001', kind: 'service' },
      { id: 'app0002', kind: 'service' },
    ]);
    expect(appKind(join(ws, 'apps', 'missing'))).toBe('application');
    expect(listWorkspaceApps(null)).toEqual([]);
  });

  it('reads assessment.subject_app, else assessment.llm.subject_app', () => {
    expect(readSubjectApp(workspace([], 0, 'assessment:\n  subject_app: web\n  llm:\n    subject_app: api\n'))).toBe('web');
    expect(readSubjectApp(workspace([], 0, 'engagement:\n  name: x\nassessment:\n  llm:\n    candidates: []\n    subject_app: "api"\n'))).toBe('api');
    expect(readSubjectApp(workspace([], 0, 'other:\n  subject_app: no\n'))).toBeUndefined();
    expect(readSubjectApp(null)).toBeUndefined();
  });

  it('starts on the subject app, else on the first application', () => {
    const apps = [{ id: 'a', kind: 'application' as const }, { id: 'b', kind: 'application' as const }, { id: 's', kind: 'service' as const }];
    expect(appPickerInitialIndex(apps, 'b')).toBe(1);
    expect(appPickerInitialIndex(apps, 'gone')).toBe(0);
    expect(appPickerInitialIndex(apps, undefined)).toBe(0);
  });

  it('groups the options; the Application picker adds the management entries without a dash', () => {
    const apps = [{ id: 'a', kind: 'application' as const }, { id: 's', kind: 'service' as const }];
    expect(appPickerOptions(apps, 'landing-zone').map((o) => o.group)).toEqual(['Applications', 'Service apps']);
    const app = appPickerOptions(apps, 'application');
    expect(app.map((o) => o.value)).toEqual(['a', '__new__', '__delete__', '__rename__']); // #4400: no service app
    expect(app.slice(1).every((o) => o.group === APP_ACTIONS_GROUP)).toBe(true);
    expect(app.map((o) => o.label).join(' ')).not.toMatch(/--|\+/);
  });
});

describe('app picker guidance per option (#4230)', () => {
  it('names the kind of the highlighted app and marks the subject app', () => {
    const app = appOptionGuidance({ id: 'sovereign-health', kind: 'application' }, 'application', 'sovereign-health');
    expect(app.title).toBe('sovereign-health');
    expect(app.what).toContain('is an application');
    expect(app.sections?.map((x) => x.label)).toEqual(['Preselected']);
    const svc = appOptionGuidance({ id: 'app0001', kind: 'service' }, 'landing-zone');
    expect(svc.what).toContain('service app scaffolded by the Service Portfolio Assessment');
    expect(svc.what).toContain('landing zone targets');
    expect(svc.sections).toEqual([]);
    const options = appPickerOptions([{ id: 'a', kind: 'application' }], 'application');
    expect(options.every((o) => o.guidance !== undefined)).toBe(true);
  });

  it('a cursor move changes the guidance box text', { timeout: 30_000 }, async () => {
    const ws = workspace(['sovereign-health'], 2);
    const r = render(picker(ws), 100);
    await loaded(r);
    for (let i = 0; i < 3; i++) await tick();
    r.stdin.write('\u0007'); // Ctrl+G opens the box
    for (let i = 0; i < 3; i++) await tick();
    expect(r.lines().join(' ')).toContain('is an application');
    r.stdin.write('\u001B[B');
    for (let i = 0; i < 40 && !r.lines().join(' ').includes('service app scaffolded'); i++) await tick();
    expect(r.lines().join(' ')).toContain('service app scaffolded');
  });
});

describe('app picker on the shared height rule (#4348)', () => {
  for (const rows of [24]) {
    it(`235 apps at ${rows} terminal rows: the frame fits and the guidance box stays visible`, { timeout: 30_000 }, async () => {
      const ws = workspace(['sovereign-health'], 234);
      const r = render(picker(ws), 100, rows);
      await loaded(r);
      for (let i = 0; i < 5; i++) await tick();
      const lines = r.lines();
      while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
      expect(lines.length).toBeLessThanOrEqual(rows - 1);
      // #4230: the collapsed box shows the highlighted app (its title) and the Ctrl+G hint.
      expect(lines.join(' ')).toContain('Ctrl+G');
      expect(lines.join(' ')).toContain('sovereign-health');
    });
  }
});

describe('bounded app picker of 235 apps (#4239)', () => {
  for (const columns of [100, 80]) {
    it(`fits the window with hints and guidance at ${columns} columns; the owner's application is preselected`, { timeout: 30_000 }, async () => {
      const ws = workspace(['sovereign-health'], 234);
      const r = render(picker(ws), columns);
      await loaded(r);
      await tick();
      const lines = r.lines();
      const text = lines.join('\n');
      expect(lines.length).toBeLessThanOrEqual(40);
      expect(text).toContain('Applications');
      expect(text).toContain('Service apps');
      expect(text).toContain('❯ sovereign-health');
      expect(text).toContain('more');
      expect(text).not.toContain('app0234');
      expect(text).toContain('Enter next');
      expect(text).toContain('Ctrl+G');
      expect(text).not.toMatch(/ -- |\|/);
      for (const l of lines) expect([...l].length).toBeLessThanOrEqual(columns);
    });
  }

  it('type-to-filter narrows the full list and Enter picks the match', { timeout: 30_000 }, async () => {
    const ws = workspace(['sovereign-health'], 234);
    const picked: string[] = [];
    const r = render(picker(ws, (id) => picked.push(id)), 100);
    await loaded(r);
    await tick();
    for (const ch of 'app0200') { r.stdin.write(ch); await tick(); }
    // Under a loaded test run the frames lag; wait for the filtered frame.
    for (let i = 0; i < 200 && !r.lines().join(' ').includes('1 of 235'); i++) await tick();
    expect(r.lines().join(' ')).toContain('1 of 235');
    r.stdin.write('\r');
    for (let i = 0; i < 100 && picked.length === 0; i++) await tick();
    expect(picked).toEqual(['app0200']);
  });
});

describe('app picker draws before the scan (#4484, Design 126 section 7.12)', () => {
  it('shows Loading apps in the first frame and drops keys typed while loading', { timeout: 30_000 }, async () => {
    const ws = workspace(['sovereign-health'], 3);
    const picked: string[] = [];
    const r = render(picker(ws, (id) => picked.push(id), 'application'), 100);
    expect(r.lines().join(' ')).toContain('Loading apps');
    expect(r.lines().join(' ')).toContain('Select app to assess');
    r.stdin.write(String.fromCharCode(13)); // Enter while loading
    await loaded(r);
    expect(r.lines().join(' ')).toContain('sovereign-health');
    for (let i = 0; i < 5; i++) await tick();
    expect(picked).toEqual([]);
  });
});

describe('app picker on the flow frame (#4255, Design 126 sections 3 and 7.4)', () => {
  it('shows the step bar and the step title; Esc is the flow abort', { timeout: 30_000 }, async () => {
    const ws = workspace(['sovereign-health'], 0);
    let aborted = 0;
    const r = render(picker(ws, noop, 'application', () => { aborted += 1; }), 100);
    await loaded(r);
    for (let i = 0; i < 3; i++) await tick();
    const text = r.lines().join('\n');
    expect(text).toContain('Credentials');
    expect(text).toContain('Select app to assess');
    expect(text).toContain('Esc abort');
    r.stdin.write('\u001B');
    for (let i = 0; i < 40 && aborted === 0; i++) await tick();
    expect(aborted).toBe(1);
  });
});

describe('the Application picker lists application apps only (#4400)', () => {
  it('drops service apps from the Application picker and counts them in a note; the LZ picker keeps both', () => {
    const apps = [{ id: 'a', kind: 'application' as const }, { id: 's1', kind: 'service' as const }, { id: 's2', kind: 'service' as const }];
    expect(pickerApps(apps, 'application').map((a) => a.id)).toEqual(['a']);
    expect(pickerApps(apps, 'landing-zone').map((a) => a.id)).toEqual(['a', 's1', 's2']);
    expect(serviceAppsNote(apps, 'application')).toBe('2 service apps are not listed: the Service Portfolio Assessment in the main menu assesses them.');
    expect(serviceAppsNote([apps[0]!, apps[1]!], 'application')).toContain('1 service app is not listed');
    expect(serviceAppsNote(apps, 'landing-zone')).toBeNull();
    expect(serviceAppsNote([apps[0]!], 'application')).toBeNull();
  });

  it('renders no service app and the note row; a service subject app is not preselected', { timeout: 30_000 }, async () => {
    const ws = workspace(['sovereign-health'], 3, 'assessment:\n  subject_app: app0002\n');
    const r = render(picker(ws, noop, 'application'), 100);
    for (let i = 0; i < 40 && !r.lines().join(' ').includes('not listed'); i++) await tick();
    const text = r.lines().join('\n');
    expect(text).toContain('❯ sovereign-health');
    expect(text).not.toContain('app0001');
    expect(text).not.toContain('Service apps');
    expect(text).toContain('3 service apps are not listed');
  });
});
