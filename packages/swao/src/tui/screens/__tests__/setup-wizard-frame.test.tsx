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

// #4342 (Design 126 section 3, audit gap U-5): the Setup Wizard frame draws
// the standard key hints and the registry guidance for a step that reports no
// chrome, and no second box when the step renders its own guidance box.
//
// #4341 (Design 126 sections 7.4 and 7.5, gate G-09 per wizard step): one Esc
// owner per key press. A step that does not capture Esc must not also keep,
// skip or continue on it: Esc opens the AbortDialog (the flow is dirty after
// the first step), Esc in the dialog stays on the same step, and the step has
// logged no completion. On a Ready step Esc leaves without the dialog.

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { Text, useInput } from 'ink';
import { render } from 'ink-testing-library';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GuidanceBox, KEY_HINTS, ABORT_DIALOG_TEXT, formatKeyHints, SelectInput, useGuidanceOpen, useOptionGuidance, type SelectOption } from '@swao/tui-kit';
import { SetupStepFrame } from '../../../setup/setup-frame.js';
import { SETUP_ASSESSMENT_TYPES, SETUP_ASSESSMENT_TYPE_LABELS, SETUP_ASSESSMENT_TYPE_MIN_TIER } from '@swao/core';

const { logged } = vi.hoisted(() => ({ logged: [] as Array<{ code: string; context?: Record<string, unknown> }> }));

vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  return {
    ...actual,
    logPortfolio: vi.fn((_level: string, code: string, _msg: string, opts?: { context?: Record<string, unknown> }) => { logged.push({ code, context: opts?.context }); }),
    setWorkspaceRoot: vi.fn(),
  };
});
vi.mock('../../../license/license-guard.js', () => ({
  LicenseGuard: { load: vi.fn(() => ({ state: { tier: 'enterprise' } })) },
}));
vi.mock('../wizard/steps/HealthCheckStep.js', () => ({
  HealthCheckStep: ({ onNext }: { onNext: () => void }) => {
    useInput((_i, key) => { if (key.return) onNext(); });
    return <Text>STUB:health-check</Text>;
  },
}));

import { SetupWizard } from '../SetupWizard.js';
import { createSetupRegistry } from '../../../setup/registry.js';
import type { SetupStepDefinition } from '../../../setup/types.js';
import { ServiceIntakeStep, ServiceScoringStep, ServiceWorkspaceStep } from '../../../setup/branches/service.js';
import { LzCatalogCataloguesStep, LzCatalogRefreshStep, LzCatalogTargetsStep } from '../../../setup/branches/lz-catalog.js';
import { flushSetupStepEvents } from '../../../setup/step-events.js';
import type { SetupStepProps } from '../../../setup/types.js';
import { ApplicationAppStep } from '../../../setup/steps/ApplicationAppStep.js';
import { ApplicationSourceStep } from '../../../setup/steps/ApplicationSourceStep.js';
import { ApplicationToolsStep } from '../../../setup/steps/ApplicationToolsStep.js';
import { LlmSubjectStep } from '../../../setup/steps/LlmSubjectStep.js';
import { ApplicationTestCodeStep } from '../../../setup/branches/application.js';
import type { CredentialStore } from '@swao/core';

/** The Source Access step with a probe that answers at once (no network, no vault). */
function SourceNoProbe(p: SetupStepProps): JSX.Element {
  return <ApplicationSourceStep {...p} deps={{ store: () => ({}) as CredentialStore, probe: async () => ({ status: 'info', apps: [], message: '' }) }} />;
}
/** The Tools step with an empty PATH. */
function ToolsNoPath(p: SetupStepProps): JSX.Element {
  return <ApplicationToolsStep {...p} lookup={{ env: { PATH: '' }, platform: 'linux', isFile: () => false }} />;
}

const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));
const BOX_TITLE_LINE = 'Ctrl+G for guidance';
const count = (frame: string, s: string): number => frame.split(s).length - 1;

function Silent(): JSX.Element { return <Text>SILENT CONTENT</Text>; }
function Advance({ onNext }: SetupStepProps): JSX.Element {
  useInput((_i, key) => { if (key.return) onNext({ status: 'done' }); });
  return <Text>FIRST STEP</Text>;
}
function After(): JSX.Element { return <Text>NEXT STEP REACHED</Text>; }
function OwnBox(): JSX.Element {
  return (
    <>
      <Text>OWN BOX CONTENT</Text>
      <GuidanceBox title="Own box" what="The step draws this box itself." />
    </>
  );
}

function registryWith(steps: SetupStepDefinition[]) {
  return createSetupRegistry(
    { steps: [{ id: 'generic.init', label: 'Init', assessmentType: 'generic', order: 10, component: Silent }] },
    SETUP_ASSESSMENT_TYPES.map((t) => ({
      branch: { type: t, label: SETUP_ASSESSMENT_TYPE_LABELS[t], description: 'short', minTier: SETUP_ASSESSMENT_TYPE_MIN_TIER[t] },
      steps: t === 'service' ? steps : [],
    })),
  );
}

let ws: string;
function workspace(): string {
  ws = mkdtempSync(join(tmpdir(), 'swao-wizard-frame-'));
  writeFileSync(join(ws, '.swao.yml'), 'workspace:\n  name: demo\n');
  return ws;
}
afterEach(() => { logged.length = 0; if (ws) rmSync(ws, { recursive: true, force: true }); });

describe('Setup Wizard frame defaults (#4342)', () => {
  it('a step that reports nothing renders the standard key hints and the registry guidance box', async () => {
    const reg = registryWith([
      { id: 'service.silent', label: 'Silent', assessmentType: 'service', order: 10, guidance: 'Registry guidance of the silent step.', component: Silent },
    ]);
    const r = render(<SetupWizard onBack={() => {}} mode={{ kind: 'branch', type: 'service' }} registry={reg} workspaceRoot={workspace()} tier="enterprise" />);
    await tick();
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain('SILENT CONTENT');
    // First step of the flow: no back hint (section 7.2).
    expect(frame).toContain(formatKeyHints(KEY_HINTS.textInput.filter((h) => h.verb !== 'back')));
    expect(frame).toContain('Silent');
    expect(frame).toContain('Registry guidance of the silent step.');
    expect(count(frame, BOX_TITLE_LINE)).toBe(1);
    r.unmount();
  });

  it('a step with a box of its own gets the hints but no second box', async () => {
    const reg = registryWith([
      { id: 'service.own', label: 'Own', assessmentType: 'service', order: 10, guidance: 'Registry guidance that must not show.', component: OwnBox },
    ]);
    const r = render(<SetupWizard onBack={() => {}} mode={{ kind: 'branch', type: 'service' }} registry={reg} workspaceRoot={workspace()} tier="enterprise" />);
    await tick();
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain('OWN BOX CONTENT');
    expect(frame).toContain('Enter next');
    expect(frame).not.toContain('Registry guidance that must not show.');
    expect(count(frame, BOX_TITLE_LINE)).toBe(1);
    r.unmount();
  });

  it('the real Scoring Inputs step shows one guidance box and the frame hint line', async () => {
    const reg = registryWith([
      { id: 'service.scoring', label: 'Scoring Inputs', assessmentType: 'service', order: 10, guidance: 'APM weights, vendor catalogue and research cache.', component: ServiceScoringStep },
    ]);
    const r = render(<SetupWizard onBack={() => {}} mode={{ kind: 'branch', type: 'service' }} registry={reg} workspaceRoot={workspace()} tier="enterprise" />);
    await tick();
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain('Inputs the scoring uses');
    expect(frame).toContain('Enter next');
    expect(count(frame, BOX_TITLE_LINE)).toBe(1);
    r.unmount();
  });
});

const ESC = '\u001B';
const ENTER = '\r';
async function press(r: ReturnType<typeof render>, ...keys: string[]): Promise<void> {
  for (const k of keys) { r.stdin.write(k); await tick(80); }
}

describe('G-09 Esc owner per wizard step (#4341, Design 126 section 7.5)', () => {
  const cases: Array<[string, SetupStepDefinition['component'], string]> = [
    ['service.workspace', ServiceWorkspaceStep, 'Skip this step'],
    ['service.intake', ServiceIntakeStep, 'Skip this step'],
    ['service.scoring', ServiceScoringStep, 'Inputs the scoring uses'],
    ['service.catalogues', LzCatalogCataloguesStep, 'Landing zone catalogues'],
    ['service.targets', LzCatalogTargetsStep, 'Skip this step'],
    ['service.refresh', LzCatalogRefreshStep, 'Catalogues older than the freshness threshold'],
    // #4341 remainder (day 3): the steps that captured Esc for keep, finish or back.
    ['service.app', ApplicationAppStep, 'Add an app'],
    ['service.source', SourceNoProbe, 'Check again'],
    ['service.tools', ToolsNoPath, 'Check again'],
    ['service.test-code', ApplicationTestCodeStep, 'Skip this step (analyse all code)'],
    ['service.subject', LlmSubjectStep, 'No app is ready for the LLM Assessment'],
  ];
  for (const [id, component, marker] of cases) {
    it(`${id}: Esc opens the AbortDialog only; the step neither keeps, skips nor continues`, async () => {
      const reg = registryWith([
        { id: 'service.first', label: 'First', assessmentType: 'service', order: 10, component: Advance },
        { id, label: 'Under test', assessmentType: 'service', order: 20, component },
        { id: 'service.after', label: 'After', assessmentType: 'service', order: 30, component: After },
      ]);
      const onBack = vi.fn();
      const r = render(<SetupWizard onBack={onBack} mode={{ kind: 'branch', type: 'service' }} registry={reg} workspaceRoot={workspace()} tier="enterprise" />);
      await tick(80);
      await press(r, ENTER);
      await tick(200); // the intake step reads its folder asynchronously
      expect(r.lastFrame()).toContain(marker);
      logged.length = 0;
      await press(r, ESC);
      flushSetupStepEvents();
      expect(r.lastFrame()).toContain(ABORT_DIALOG_TEXT.setup.question);
      await press(r, ESC); // stay
      const frame = r.lastFrame() ?? '';
      expect(frame).toContain(marker);
      expect(frame).not.toContain('NEXT STEP REACHED');
      expect(onBack).not.toHaveBeenCalled();
      expect(logged.filter((e) => e.code === 'wizard.step.complete')).toEqual([]);
      r.unmount();
    });
  }

  it('App step: Shift+Tab in the app id goes back to the step menu, then to the previous step; Esc still aborts (#4341, #4254)', async () => {
    const reg = registryWith([
      { id: 'service.first', label: 'First', assessmentType: 'service', order: 10, component: Advance },
      { id: 'service.app', label: 'App', assessmentType: 'service', order: 20, component: ApplicationAppStep },
    ]);
    const r = render(<SetupWizard onBack={() => {}} mode={{ kind: 'branch', type: 'service' }} registry={reg} workspaceRoot={workspace()} tier="enterprise" />);
    await tick(80);
    await press(r, ENTER, ENTER); // First done; "Add an app"
    expect(r.lastFrame()).toContain('App id');
    expect(r.lastFrame()).toContain('Shift+Tab back');
    await press(r, '\u001B[Z'); // Shift+Tab: back inside the step
    expect(r.lastFrame()).toContain('Skip this step');
    expect(r.lastFrame()).not.toContain('FIRST STEP');
    await press(r, '\u001B[Z'); // Shift+Tab on the step menu: the previous wizard step
    expect(r.lastFrame()).toContain('FIRST STEP');
    r.unmount();
  });

  it('App step: Esc in the app id opens the AbortDialog; the step adds nothing (#4341)', async () => {
    const reg = registryWith([
      { id: 'service.first', label: 'First', assessmentType: 'service', order: 10, component: Advance },
      { id: 'service.app', label: 'App', assessmentType: 'service', order: 20, component: ApplicationAppStep },
    ]);
    const onBack = vi.fn();
    const r = render(<SetupWizard onBack={onBack} mode={{ kind: 'branch', type: 'service' }} registry={reg} workspaceRoot={workspace()} tier="enterprise" />);
    await tick(80);
    await press(r, ENTER, ENTER);
    expect(r.lastFrame()).toContain('App id');
    logged.length = 0;
    await press(r, ESC);
    flushSetupStepEvents();
    expect(r.lastFrame()).toContain(ABORT_DIALOG_TEXT.setup.question);
    expect(onBack).not.toHaveBeenCalled();
    expect(logged.filter((e) => e.code === 'wizard.step.complete' || e.code === 'wizard.application.app.created')).toEqual([]);
    r.unmount();
  });

  it('arrows never advance a step: Right after going back stays on the step until it completes (#4341)', async () => {
    const reg = registryWith([
      { id: 'service.first', label: 'First', assessmentType: 'service', order: 10, component: Advance },
      { id: 'service.after', label: 'After', assessmentType: 'service', order: 20, component: After },
    ]);
    const r = render(<SetupWizard onBack={() => {}} mode={{ kind: 'branch', type: 'service' }} registry={reg} workspaceRoot={workspace()} tier="enterprise" />);
    await tick(80);
    await press(r, ENTER);
    expect(r.lastFrame()).toContain('NEXT STEP REACHED');
    await press(r, '\u001B[Z'); // Shift+Tab: back, values kept
    expect(r.lastFrame()).toContain('FIRST STEP');
    await press(r, '\u001B[C'); // Right arrow
    expect(r.lastFrame()).toContain('FIRST STEP');
    expect(r.lastFrame()).not.toContain('NEXT STEP REACHED');
    r.unmount();
  });

  it('Ready: Esc returns to the main menu at once, without the dialog', async () => {
    const reg = registryWith([
      { id: 'service.first', label: 'First', assessmentType: 'service', order: 10, component: Advance },
    ]);
    const onBack = vi.fn();
    const r = render(<SetupWizard onBack={onBack} mode={{ kind: 'branch', type: 'service' }} registry={reg} workspaceRoot={workspace()} tier="enterprise" />);
    await tick(80);
    await press(r, ENTER, ENTER);
    expect(r.lastFrame()).toContain('Ready');
    await press(r, ESC);
    expect(r.lastFrame()).not.toContain(ABORT_DIALOG_TEXT.setup.question);
    expect(onBack).toHaveBeenCalledTimes(1);
    r.unmount();
  });
});

// #4394 (criterion 3, Setup Wizard): one owner of the guidance open state
// (tui-kit guidance-open.ts, provided by SetupWizard). With the box open the
// picker of a real wizard step still moves (Down, number keys), the step reads
// the open state from useGuidanceOpen, and the open box owns Esc only: the
// first Esc closes the box, the second opens the AbortDialog (#4230, #4254).
describe('Setup Wizard guidance box open state (#4394, Design 126 section 7.8)', () => {
  const OPTIONS: SelectOption[] = [
    { label: 'Option one', value: 'one', guidance: { title: 'First option', what: 'ONE_TEXT' } },
    { label: 'Option two', value: 'two', guidance: { title: 'Second option', what: 'TWO_TEXT' } },
    { label: 'Option three', value: 'three', guidance: { title: 'Third option', what: 'THREE_TEXT' } },
  ];
  const seen: boolean[] = [];
  const picked: string[] = [];
  function GuidedPicker(): JSX.Element {
    const guidance = useGuidanceOpen();
    const { entry, onCursorChange } = useOptionGuidance({ title: 'Pick one', what: 'STEP_TEXT' });
    useInput((_i, key) => { if (key.downArrow) seen.push(guidance.isOpen()); });
    return (
      <SetupStepFrame title="Pick one" kind="picker" guidance={entry}>
        <SelectInput label="Pick" options={OPTIONS} numbered showKeyHints={false} onCursorChange={onCursorChange} onSelect={(v) => picked.push(v)} />
      </SetupStepFrame>
    );
  }

  it('Ctrl+G opens the box; Down moves the cursor and the box follows; a number selects; Esc closes the box first', async () => {
    seen.length = 0; picked.length = 0;
    const reg = registryWith([
      { id: 'service.first', label: 'First', assessmentType: 'service', order: 10, component: Advance },
      { id: 'service.pick', label: 'Pick', assessmentType: 'service', order: 20, component: GuidedPicker },
    ]);
    const onBack = vi.fn();
    const r = render(<SetupWizard onBack={onBack} mode={{ kind: 'branch', type: 'service' }} registry={reg} workspaceRoot={workspace()} tier="enterprise" />);
    await tick(80);
    await press(r, ENTER);
    expect(r.lastFrame()).toContain('First option');
    await press(r, String.fromCharCode(7));
    expect(r.lastFrame()).toContain('ONE_TEXT');
    expect(r.lastFrame()).toContain('close guidance');
    await press(r, String.fromCharCode(27) + '[B');
    let frame = r.lastFrame() ?? '';
    expect(frame).toContain('Second option');
    expect(frame).toContain('TWO_TEXT');
    expect(frame).toContain('close guidance');
    await press(r, String.fromCharCode(27) + '[B');
    expect(r.lastFrame()).toContain('THREE_TEXT');
    expect(seen).toEqual([true, true]);
    await press(r, String.fromCharCode(27));
    frame = r.lastFrame() ?? '';
    expect(frame).not.toContain('close guidance');
    expect(frame).not.toContain(ABORT_DIALOG_TEXT.setup.question);
    await press(r, String.fromCharCode(27) + '[B');
    expect(seen).toEqual([true, true, false]);
    await press(r, String.fromCharCode(27));
    expect(r.lastFrame()).toContain(ABORT_DIALOG_TEXT.setup.question);
    await press(r, String.fromCharCode(27));
    await press(r, String.fromCharCode(7), '1');
    expect(picked).toEqual(['one']);
    expect(onBack).not.toHaveBeenCalled();
    r.unmount();
  });
});
