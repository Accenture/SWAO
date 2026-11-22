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

// #4345: a throwing wizard step renders the ErrorPanel inside the wizard frame
// and logs tui.crash (error class, message, stack top, screen, step), Back
// leaves with wizard.abort reason crash; Ctrl+C ends the app with reason
// ctrl_c. Reproduction of the owner's exit on the LZ Live Org Evidence step:
// the keys C, c, Enter, Esc and Ctrl+G on a workspace with a registered
// landing zone, rendered in the real wizard.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { EventEmitter } from 'node:events';
import { render as inkRender, Text, useInput } from 'ink';
import { render } from 'ink-testing-library';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
  HealthCheckStep: () => <Text>STUB:health-check</Text>,
}));

import { SetupWizard } from '../SetupWizard.js';
import { createSetupRegistry } from '../../../setup/registry.js';
import { defaultSetupRegistry } from '../../../setup/index.js';
import type { SetupStepDefinition, SetupStepProps } from '../../../setup/types.js';
import { resetTuiCrashState } from '../../crash-report.js';
import { createCtrlCGuard, installCtrlCGuard, resetCtrlCGuard } from '../../ctrl-c-guard.js';

const tick = (ms = 80): Promise<void> => new Promise((r) => setTimeout(r, ms));
const KEY = { enter: '\r', esc: '\u001B', ctrlG: '\u0007', ctrlC: '\u0003' } as const;

function Advance({ onNext }: SetupStepProps): JSX.Element {
  useInput((_i, key) => { if (key.return) onNext({ status: 'done' }); });
  return <Text>FIRST STEP</Text>;
}
function Thrower(): JSX.Element {
  throw new TypeError('evidence row has no folder');
}

function registryWith(steps: SetupStepDefinition[]) {
  return createSetupRegistry(
    { steps: [{ id: 'generic.init', label: 'Init', assessmentType: 'generic', order: 10, component: Advance }] },
    SETUP_ASSESSMENT_TYPES.map((t) => ({
      branch: { type: t, label: SETUP_ASSESSMENT_TYPE_LABELS[t], description: 'short', minTier: SETUP_ASSESSMENT_TYPE_MIN_TIER[t] },
      steps: t === 'service' ? steps : [],
    })),
  );
}

let ws = '';
function workspace(yml = 'workspace:\n  name: demo\n'): string {
  ws = mkdtempSync(join(tmpdir(), 'swao-wizard-crash-'));
  writeFileSync(join(ws, '.swao.yml'), yml);
  return ws;
}
beforeEach(() => { resetTuiCrashState(); });
afterEach(() => {
  logged.length = 0;
  resetTuiCrashState();
  if (ws) rmSync(ws, { recursive: true, force: true });
  ws = '';
});

describe('crash in a wizard step (#4345)', () => {
  it('a throwing step renders the ErrorPanel in the frame and logs tui.crash; Back logs wizard.abort reason crash', async () => {
    const reg = registryWith([
      { id: 'service.first', label: 'First', assessmentType: 'service', order: 10, component: Advance },
      { id: 'service.broken', label: 'Broken', assessmentType: 'service', order: 20, component: Thrower },
    ]);
    const onBack = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = render(<SetupWizard onBack={onBack} mode={{ kind: 'branch', type: 'service' }} registry={reg} workspaceRoot={workspace()} tier="enterprise" />);
    await tick();
    r.stdin.write(KEY.enter);
    await tick(150);
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain('This setup step stopped with an error');
    expect(frame).toContain('evidence row has no folder.');
    expect(frame).toContain('Step 2 of');
    expect(frame).not.toMatch(/\bat Thrower\b/); // no stack on screen
    const crash = logged.find((e) => e.code === 'tui.crash');
    expect(crash?.context).toMatchObject({ origin: 'render', error_class: 'TypeError', message: 'evidence row has no folder', step: 'Broken' });
    expect(Array.isArray(crash?.context?.['stack_top'])).toBe(true);
    r.stdin.write(KEY.enter); // What now: Back
    await tick();
    expect(onBack).toHaveBeenCalledTimes(1);
    r.unmount();
    await tick();
    expect(logged.find((e) => e.code === 'wizard.abort')?.context).toMatchObject({ last_step: 'Broken', reason: 'crash' });
    spy.mockRestore();
  });
});

class FakeStdout extends EventEmitter {
  frames: string[] = [];
  columns = 100;
  rows = 50;
  write = (frame: string): boolean => { this.frames.push(frame); return true; };
}
class FakeStdin extends EventEmitter {
  isTTY = true;
  private queue: string[] = [];
  write = (data: string): void => { this.queue.push(data); this.emit('readable'); };
  read = (): string | null => this.queue.shift() ?? null;
  setEncoding(): void { /* not needed */ }
  setRawMode(): void { /* not needed */ }
  resume(): void { /* not needed */ }
  pause(): void { /* not needed */ }
  ref(): void { /* not needed */ }
  unref(): void { /* not needed */ }
}

const LZ_YML = 'workspace:\n  name: demo\nlanding_zones:\n  - id: otc-prod\n    provider: otc\n    frameworks: [CLIENT_LZ_POLICY_BASELINE]\n    scopes:\n      - id: platform\n        kind: platform\n        auth: iam-password-token\n';

/** The real LZ Live branch, started at its Org Evidence step (the steps before it advance on Enter). */
function evidenceOnlyRegistry() {
  const real = defaultSetupRegistry();
  const evidence = real.branch('lz-live').steps.find((s) => s.id === 'lz-live.evidence')!;
  return createSetupRegistry(
    { steps: [{ id: 'generic.init', label: 'Init', assessmentType: 'generic', order: 10, component: Advance }] },
    SETUP_ASSESSMENT_TYPES.map((t) => ({
      branch: { type: t, label: SETUP_ASSESSMENT_TYPE_LABELS[t], description: 'short', minTier: SETUP_ASSESSMENT_TYPE_MIN_TIER[t] },
      steps: t === 'lz-live'
        ? [{ id: 'lz-live.before', label: 'Policy Baseline', assessmentType: 'lz-live', order: 30, component: Advance }, evidence]
        : [],
    })),
  );
}

function mount(stdin: FakeStdin, onBack: () => void) {
  const stdout = new FakeStdout();
  const inst = inkRender(
    <SetupWizard onBack={onBack} mode={{ kind: 'branch', type: 'lz-live' }} registry={evidenceOnlyRegistry()} workspaceRoot={ws} tier="enterprise" />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: new FakeStdout() as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true, exitOnCtrlC: false, patchConsole: false,
    },
  );
  // eslint-disable-next-line no-control-regex
  const last = (): string => (stdout.frames[stdout.frames.length - 1] ?? '').replace(/\x1b\[[0-9;]*m/g, '');
  return { inst, last };
}

describe('reproduction: LZ Live Setup, Org Evidence step (#4345)', () => {
  it('C, c, Ctrl+G, Esc and Enter never end the process; the folder is created on entry (#4346)', async () => {
    workspace(LZ_YML);
    const stdin = new FakeStdin();
    const onBack = vi.fn();
    const { inst, last } = mount(stdin, onBack);
    let exited = false;
    void inst.waitUntilExit().then(() => { exited = true; }, () => { exited = true; });
    await tick();
    stdin.write(KEY.enter); await tick();
    expect(last()).toContain('Org Evidence');
    // #4346: the step creates the ingestion folder on entry; the former C key is gone.
    expect(existsSync(join(ws, 'landing-zones', 'otc-prod', 'ingestion'))).toBe(true);
    expect(last()).not.toContain('not created');
    stdin.write('C'); await tick();
    stdin.write('c'); await tick();
    stdin.write(KEY.ctrlG); await tick();
    stdin.write(KEY.esc); await tick(); // closes the guidance box
    expect(last()).toContain('Org Evidence');
    stdin.write(KEY.esc); await tick(); // the AbortDialog
    expect(last()).toContain('Abort the setup?');
    stdin.write(KEY.esc); await tick(); // stay
    stdin.write(KEY.enter); await tick();
    expect(exited).toBe(false);
    expect(logged.some((e) => e.code === 'tui.crash')).toBe(false);
    inst.unmount();
    await tick(); // let the unmount cleanup log before the next test
  });

  it('one Ctrl+C asks and keeps the step; a second within 2 seconds ends the app: wizard.abort reason ctrl_c (#4379)', async () => {
    workspace(LZ_YML);
    const stdin = new FakeStdin();
    let unmountApp: (() => void) | null = null;
    const guard = createCtrlCGuard({ onQuit: () => { setImmediate(() => unmountApp?.()); } });
    const uninstall = installCtrlCGuard(stdin, guard);
    const { inst, last } = mount(stdin, vi.fn());
    unmountApp = inst.unmount;
    let exited = false;
    const done = inst.waitUntilExit().then(() => { exited = true; });
    await tick();
    stdin.write(KEY.enter); await tick();
    expect(last()).toContain('Org Evidence');
    stdin.write(KEY.ctrlC); await tick();
    expect(exited).toBe(false);
    expect(guard.armed()).toBe(true);
    expect(last()).toContain('Org Evidence');
    expect(logged.some((e) => e.code === 'wizard.abort')).toBe(false);
    stdin.write(KEY.ctrlC);
    await done;
    uninstall();
    guard.dispose();
    resetCtrlCGuard();
    await tick(); // the unmount cleanup runs with the passive effects
    expect(logged.find((e) => e.code === 'wizard.abort')?.context).toMatchObject({ last_step: 'Org Evidence', reason: 'ctrl_c' });
  });

  it('a Ctrl+C followed by another key never quits, and a later Esc exit is not logged as ctrl_c (#4379)', async () => {
    workspace(LZ_YML);
    const stdin = new FakeStdin();
    const onQuit = vi.fn();
    const guard = createCtrlCGuard({ onQuit });
    const uninstall = installCtrlCGuard(stdin, guard);
    const { inst, last } = mount(stdin, vi.fn());
    await tick();
    stdin.write(KEY.enter); await tick();
    stdin.write(KEY.ctrlC); await tick();
    stdin.write('x'); await tick();
    expect(guard.armed()).toBe(false);
    stdin.write(KEY.ctrlC); await tick();
    expect(onQuit).not.toHaveBeenCalled();
    expect(last()).toContain('Org Evidence');
    inst.unmount();
    uninstall();
    guard.dispose();
    resetCtrlCGuard();
    await tick();
    expect(logged.find((e) => e.code === 'wizard.abort')?.context).toMatchObject({ reason: 'exit' });
  });
});
