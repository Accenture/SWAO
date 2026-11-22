// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, gate G-09: navigation of the step flows (#4251)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 126 section 13.2 G-09 and section 7: per flow, back keeps the
// values, forward reaches a completed step, finish returns to the main
// menu, Esc aborts with the dialog when dirty, Esc closes the guidance
// first. Scaffold (#4251): one sample flow built from the central parts
// (ScreenLayout, useFlowNavigation, TextInput, SelectInput, ConfirmPanel);
// the flows of the Setup Wizard and the assessments join this file as they
// move to useFlowNavigation (#4254, #4255, #4256, #4257). The main menu
// case of Q-03 ("Exit SWAO?") runs on a sample menu until #4257 moves
// MainMenu.tsx to the hook.

import { describe, it, expect, vi } from 'vitest';
import React, { useState } from 'react';
import { render } from 'ink-testing-library';
import {
  ScreenLayout, SelectInput, TextInput, ConfirmPanel, CONFIRM_PANEL_KEYS, KEY_HINTS, useFlowNavigation,
} from '@swao/tui-kit';
import { ServiceInitScreen } from '../screens/ServiceInitScreen.js';

const KEY = { enter: '\r', esc: '\u001B', left: '\u001B[D', right: '\u001B[C', down: '\u001B[B', shiftTab: '\u001B[Z', ctrlG: '\u0007' } as const;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 40));
type Rendered = ReturnType<typeof render>;
async function press(r: Rendered, ...keys: string[]): Promise<void> {
  for (const k of keys) { r.stdin.write(k); await tick(); }
}

const LICENCE = { tier: 'enterprise' as const, assessmentCount: 12, firstRun: '2026-01-01', exp: '2099-03-31' };
const STEPS = ['Name', 'Region', 'Confirm'];
const REGIONS = [{ label: 'Frankfurt', value: 'eu-de' }, { label: 'Amsterdam', value: 'eu-nl' }];

interface FlowValues { name?: string; region?: string }

/** The sample flow: a text input, a picker and a confirmation, as a wizard would build them. */
function SampleSetupFlow({ onMainMenu, onStart }: { onMainMenu(): void; onStart(v: FlowValues): void }): JSX.Element {
  const [values, setValues] = useState<FlowValues>({});
  const [onTextStep, setOnTextStep] = useState(true);
  const nav = useFlowNavigation({
    steps: STEPS, dirty: values.name !== undefined, onExit: onMainMenu, textInput: onTextStep,
    onFinish: () => { onStart(values); onMainMenu(); },
  });
  if (onTextStep !== (nav.current === 0)) setOnTextStep(nav.current === 0);
  const kind = nav.current === 0 ? 'textInput' : nav.current === 1 ? 'picker' : 'confirm';
  return (
    <ScreenLayout
      header={{ subtitle: 'Setup: Sample', stepInfo: `Step ${nav.current + 1} of 3`, version: '1.6.1', licenseState: LICENCE }}
      steps={{ labels: STEPS, current: nav.current }}
      title={{ title: STEPS[nav.current]!, subtitle: 'Sample step.' }}
      keys={kind === 'confirm' ? CONFIRM_PANEL_KEYS : nav.hints(kind)}
      guidance={{ title: STEPS[nav.current]!, what: `Guidance of the ${STEPS[nav.current]} step.`, onOpenChange: nav.onGuidanceOpenChange }}
    >
      {nav.current === 0 && (
        <TextInput label="Name" initialValue={values.name ?? ''} active={nav.contentActive}
          onSubmit={(v) => { setValues((s) => ({ ...s, name: v })); nav.next(); }} />
      )}
      {nav.current === 1 && (
        <SelectInput label="Region" options={REGIONS} active={nav.contentActive}
          initialIndex={Math.max(0, REGIONS.findIndex((o) => o.value === values.region))}
          onSelect={(v) => { setValues((s) => ({ ...s, region: v })); nav.next(); }} />
      )}
      {nav.current === 2 && (
        <ConfirmPanel title="Start the sample" active={nav.contentActive} onConfirm={nav.next}
          rows={[{ label: 'Name', value: values.name ?? '' }, { label: 'Region', value: values.region ?? '' }]} />
      )}
      {nav.dialog}
    </ScreenLayout>
  );
}

/** Q-03: Esc on the main menu asks "Exit SWAO?"; the 0 Exit entry stays visible. */
function SampleMainMenu({ onExitSwao }: { onExitSwao(): void }): JSX.Element {
  const nav = useFlowNavigation({ steps: ['Main menu'], dirty: true, what: 'exit', onExit: onExitSwao });
  return (
    <ScreenLayout header={{ subtitle: 'Main menu', version: '1.6.1', licenseState: LICENCE }} keys={KEY_HINTS.menu} guidance={{ title: 'Main menu', what: 'Pick a task.' }}>
      <SelectInput label="Main menu" options={[{ label: '1 Assess', value: 'assess' }, { label: '0 Exit', value: 'exit' }]} active={nav.contentActive} onSelect={() => {}} />
      {nav.dialog}
    </ScreenLayout>
  );
}

const title = (r: Rendered): string => {
  const f = r.lastFrame() ?? '';
  return STEPS.find((s) => f.includes(`Guidance of the ${s} step.`)) ?? '';
};

describe('G-09 navigation of the step flows (#4251, Design 126 section 13.2)', () => {
  it('back keeps the values, forward reaches a completed step, finish returns to the main menu', async () => {
    const onMainMenu = vi.fn();
    const onStart = vi.fn();
    const r = render(<SampleSetupFlow onMainMenu={onMainMenu} onStart={onStart} />);
    await tick();
    expect(title(r)).toBe('Name');
    await press(r, 'a', 'c', 'm', 'e', KEY.left); // the left arrow stays in the text field
    expect(title(r)).toBe('Name');
    await press(r, KEY.enter);
    expect(title(r)).toBe('Region');
    await press(r, KEY.down, KEY.enter);
    expect(title(r)).toBe('Confirm');
    expect(r.lastFrame()).toContain('Enter confirm   ← back   Esc abort');
    await press(r, KEY.left);
    expect(title(r)).toBe('Region'); // one press, one step
    await press(r, KEY.shiftTab);
    expect(title(r)).toBe('Name');
    expect(r.lastFrame()).toContain('acme'); // value kept
    await press(r, KEY.enter); // keeps the value and moves on
    await press(r, KEY.right); // Region was completed: forward to Confirm
    expect(title(r)).toBe('Confirm');
    expect(r.lastFrame()).toContain('eu-nl');
    await press(r, KEY.enter); // Enter on the last step finishes
    expect(onStart).toHaveBeenCalledWith({ name: 'acme', region: 'eu-nl' });
    expect(onMainMenu).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it('Esc on a clean flow leaves at once; on a dirty flow the dialog asks; Esc stays; Enter aborts', async () => {
    const clean = vi.fn();
    const r1 = render(<SampleSetupFlow onMainMenu={clean} onStart={() => {}} />);
    await tick();
    await press(r1, KEY.esc);
    expect(clean).toHaveBeenCalledTimes(1);
    r1.unmount();

    const dirty = vi.fn();
    const r = render(<SampleSetupFlow onMainMenu={dirty} onStart={() => {}} />);
    await tick();
    await press(r, 'x', KEY.enter, KEY.esc);
    expect(r.lastFrame()).toContain('Abort the setup? Entered values are not saved.');
    expect(r.lastFrame()).toContain('Enter abort   Esc stay');
    await press(r, KEY.esc);
    expect(r.lastFrame()).not.toContain('Abort the setup?');
    expect(title(r)).toBe('Region');
    await press(r, KEY.esc, KEY.enter); // Enter aborts and does not pick a region
    expect(dirty).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it('Esc closes an open guidance box first', async () => {
    const onMainMenu = vi.fn();
    const r = render(<SampleSetupFlow onMainMenu={onMainMenu} onStart={() => {}} />);
    await tick();
    await press(r, KEY.ctrlG, KEY.esc);
    expect(onMainMenu).not.toHaveBeenCalled();
    await press(r, KEY.esc);
    expect(onMainMenu).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it('Q-03: Esc on the main menu asks "Exit SWAO?" and 0 Exit stays visible', async () => {
    const onExitSwao = vi.fn();
    const r = render(<SampleMainMenu onExitSwao={onExitSwao} />);
    await tick();
    await press(r, KEY.esc);
    expect(r.lastFrame()).toContain('Exit SWAO?');
    expect(r.lastFrame()).toContain('Enter exit   Esc stay');
    expect(r.lastFrame()).toContain('0 Exit');
    await press(r, KEY.esc);
    expect(onExitSwao).not.toHaveBeenCalled();
    await press(r, KEY.esc, KEY.enter);
    expect(onExitSwao).toHaveBeenCalledTimes(1);
    r.unmount();
  });
});

// #4255: the Service Portfolio Assessment flow on useFlowNavigation (Design 126
// sections 7.2, 7.4 and 7.5): Esc on the first step leaves at once; after it
// the AbortDialog asks (Esc stays, Enter aborts); Shift+Tab in a text input
// goes back one step with the value kept.
describe('G-09 Service Portfolio Assessment flow (#4255)', () => {
  it('Esc on the intake step leaves at once', async () => {
    const onBack = vi.fn();
    const r = render(<ServiceInitScreen onBack={onBack} />);
    await tick();
    await press(r, KEY.esc);
    expect(onBack).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it('after the intake step Esc asks; Esc stays; Shift+Tab goes back with the path kept; Enter on the dialog aborts', async () => {
    const onBack = vi.fn();
    const r = render(<ServiceInitScreen onBack={onBack} />);
    await tick();
    r.stdin.write('C:/in/intake.xlsx');
    await tick();
    await press(r, KEY.enter);
    expect(r.lastFrame()).toContain('Column map');
    await press(r, KEY.esc);
    expect(r.lastFrame()).toContain('Abort the assessment?');
    await press(r, KEY.esc);
    expect(r.lastFrame()).not.toContain('Abort the assessment?');
    expect(onBack).not.toHaveBeenCalled();
    await press(r, KEY.shiftTab);
    expect(r.lastFrame()).toContain('Enter the path to the intake Excel file');
    await press(r, KEY.enter);
    await press(r, KEY.esc, KEY.enter);
    expect(onBack).toHaveBeenCalledTimes(1);
    r.unmount();
  });
});
