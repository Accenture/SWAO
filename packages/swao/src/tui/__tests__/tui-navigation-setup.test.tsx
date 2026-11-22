// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, gate G-09: navigation of the Setup Wizard flows (#4254)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 126 section 13.2 G-09 and sections 7.2 to 7.5, per Setup Wizard flow
// (the generic Workspace Setup and the branches Application, Service, LZ
// Catalog, LZ Live and LLM), with the real steps of the default registry:
//
// NAV-01 Esc on the first step leaves at once (nothing done yet, no dialog).
// NAV-02 forth: the first step completes and the step bar moves to step 2;
//        back: the back key returns to step 1; forth again reaches step 2.
// NAV-03 abort: after a done step Esc opens the AbortDialog; Esc stays on the
//        same step; Esc and Enter abort to the main menu.
// NAV-04 finish: every later step completes (or is skipped) up to Ready;
//        Ready shows "Enter finish   Esc abort" and Enter returns to the main
//        menu without a dialog.
//
// Sandbox: HOME, USERPROFILE, APPDATA, LOCALAPPDATA and XDG_CONFIG_HOME point
// into a temp folder before any module reads them (the credential vault and
// the global config resolve their paths at import), the workspace is a temp
// folder (the generic Init step uses the working directory, so that flow
// runs with the temp folder as the working directory), child processes are
// faked and the health check is a stub. Nothing reaches the operator profile.

import { describe, it, expect, vi, afterAll } from 'vitest';
import React from 'react';
import { Text, useInput } from 'ink';
import { render } from 'ink-testing-library';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const sandbox = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swao-g09-setup-'));
  const keys = ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME'] as const;
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) {
    saved[k] = process.env[k];
    const d = path.join(root, k);
    fs.mkdirSync(d, { recursive: true });
    process.env[k] = d;
  }
  return { root, saved };
});

vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  return { ...actual, logPortfolio: vi.fn(), setWorkspaceRoot: vi.fn(), saveDefaultWorkspace: vi.fn() };
});
vi.mock('../../license/license-guard.js', () => ({
  LicenseGuard: { load: vi.fn(() => ({ state: { tier: 'enterprise', valid: true, assessmentCount: 0, firstRun: '' } })) },
}));
vi.mock('../screens/wizard/steps/HealthCheckStep.js', () => ({
  HealthCheckStep: ({ onNext }: { onNext: () => void }) => {
    useInput((_i, key) => { if (key.return) onNext(); });
    return <Text>STUB:health-check</Text>;
  },
}));
vi.mock('child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('child_process')>();
  const { EventEmitter: Emitter } = await import('node:events');
  return { ...original, spawn: vi.fn(() => Object.assign(new Emitter(), { stdout: new Emitter(), stderr: new Emitter(), kill: () => true })) };
});

import { ABORT_DIALOG_TEXT } from '@swao/tui-kit';
import type { CredentialStore as CoreCredentialStore } from '@swao/core';
import { SetupWizard } from '../screens/SetupWizard.js';
import { createSetupRegistry, type SetupRegistry } from '../../setup/registry.js';
import { genericSetup } from '../../setup/branches/generic.js';
import { applicationBranch } from '../../setup/branches/application.js';
import { serviceBranch } from '../../setup/branches/service.js';
import { lzCatalogBranch } from '../../setup/branches/lz-catalog.js';
import { lzLiveBranch } from '../../setup/branches/lz-live.js';
import { llmBranch } from '../../setup/branches/llm.js';
import { ApplicationSourceStep } from '../../setup/steps/ApplicationSourceStep.js';
import { ApplicationToolsStep } from '../../setup/steps/ApplicationToolsStep.js';
import type { SetupRunMode, SetupStepProps } from '../../setup/types.js';

afterAll(() => {
  for (const [k, v] of Object.entries(sandbox.saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(sandbox.root, { recursive: true, force: true });
});

/** Source Access with a probe that answers at once (no network, no vault). */
function SourceNoProbe(p: SetupStepProps): JSX.Element {
  return <ApplicationSourceStep {...p} deps={{ store: () => ({}) as CoreCredentialStore, probe: async () => ({ status: 'info', apps: [], message: '' }) }} />;
}
/** Tools with an empty PATH (no scanner found, deterministic rows). */
function ToolsNoPath(p: SetupStepProps): JSX.Element {
  return <ApplicationToolsStep {...p} lookup={{ env: { PATH: '' }, platform: 'linux', isFile: () => false }} />;
}

/** The default registry, with the two Application steps that probe the machine made deterministic. */
function registry(): SetupRegistry {
  const application = {
    ...applicationBranch,
    steps: applicationBranch.steps.map((s) => (s.id === 'application.source' ? { ...s, component: SourceNoProbe }
      : s.id === 'application.tools' ? { ...s, component: ToolsNoPath } : s)),
  };
  return createSetupRegistry(genericSetup, [application, serviceBranch, lzCatalogBranch, lzLiveBranch, llmBranch]);
}

const KEY = { enter: '\r', esc: '\u001B', left: '\u001B[D', down: '\u001B[B', shiftTab: '\u001B[Z' } as const;
const { enter: E, esc: X, left: L, down: D } = KEY;
const tick = (ms = 150): Promise<void> => new Promise((r) => setTimeout(r, ms));
type Rendered = ReturnType<typeof render>;
async function press(r: Rendered, ...keys: string[]): Promise<void> {
  for (const k of keys) { r.stdin.write(k); await tick(); }
}
/** The step position from the header ("Step 2 of 5"). */
function stepOf(r: Rendered): string {
  return /Step \d+ of \d+/.exec(r.lastFrame() ?? '')?.[0] ?? '';
}

interface Flow {
  name: string;
  mode: SetupRunMode;
  total: number;
  /** Keys that complete the first step. */
  first: string[];
  /** The back key on step 2 (Left arrow on a list, Shift+Tab in a text input). */
  back: string;
  /** Keys that complete the first step again after going back (the values are kept). */
  again: string[];
  /** Keys from step 2 to the Ready step. */
  toReady: string[];
  /** The generic Init step uses the working directory. */
  chdir?: boolean;
}

const FLOWS: Flow[] = [
  // Init: confirm the portfolio root, then "Continue with this workspace"; LLM: Anthropic,
  // its model, no secondary; Credentials: empty key; MCP Client: Enter; Health Check stub.
  { name: 'generic Workspace Setup', mode: { kind: 'generic' }, total: 6, first: [E, E], back: L, again: [E, E], toReady: [E, E, D, E, E, E, E], chdir: true },
  // App: 2 Skip; Source Access: Continue; Playwright: continue without; Test Code: default; Tools; Health Check.
  { name: 'Application', mode: { kind: 'branch', type: 'application' }, total: 7, first: ['2'], back: L, again: ['2'], toReady: [D, E, E, E, D, D, E, E] },
  // Service Setup: set up and confirm; Intake Input: Skip this step; Scoring Inputs; Health Check.
  { name: 'Service', mode: { kind: 'branch', type: 'service' }, total: 5, first: [E, E], back: L, again: [E], toReady: [D, D, E, E, E] },
  // Catalogues; Targets: the highlighted provider, its first geography, confirm; Refresh; Health Check.
  { name: 'LZ Catalog', mode: { kind: 'branch', type: 'lz-catalog' }, total: 5, first: [E], back: L, again: [E], toReady: [E, E, E, E, E] },
  // Landing Zones: 2 Skip; Probe, Policy Baseline and Org Evidence without a landing zone; Health Check.
  { name: 'LZ Live', mode: { kind: 'branch', type: 'lz-live' }, total: 6, first: ['2'], back: L, again: ['2'], toReady: [E, E, E, E] },
  // Candidates: Skip this step; Subject: Continue (no app ready); Health Check.
  { name: 'LLM', mode: { kind: 'branch', type: 'llm' }, total: 4, first: [D, E], back: L, again: [D, E], toReady: [E, E] },
];

function start(flow: Flow): { r: Rendered; onBack: ReturnType<typeof vi.fn>; done: () => void } {
  const ws = mkdtempSync(join(sandbox.root, 'ws-'));
  writeFileSync(join(ws, '.swao.yml'), 'workspace:\n  name: demo\n');
  const cwd = process.cwd();
  if (flow.chdir) process.chdir(ws);
  const onBack = vi.fn();
  const r = render(<SetupWizard onBack={onBack} mode={flow.mode} registry={registry()} workspaceRoot={ws} tier="enterprise" />);
  return { r, onBack, done: () => { r.unmount(); if (flow.chdir) process.chdir(cwd); } };
}

describe('G-09 navigation of the Setup Wizard flows (#4254, Design 126 sections 7.2 to 7.5)', () => {
  it('the profile folders point into the sandbox', () => {
    expect(homedir().startsWith(sandbox.root)).toBe(true);
    expect(process.env['LOCALAPPDATA']?.startsWith(sandbox.root)).toBe(true);
  });

  for (const flow of FLOWS) {
    describe(flow.name, { timeout: 20_000 }, () => {
      it('NAV-01 Esc on the first step leaves at once, without the dialog', async () => {
        const { r, onBack, done } = start(flow);
        try {
          await tick(400);
          expect(stepOf(r)).toBe(`Step 1 of ${flow.total}`);
          await press(r, X);
          expect(r.lastFrame()).not.toContain(ABORT_DIALOG_TEXT.setup.question);
          expect(onBack).toHaveBeenCalledTimes(1);
        } finally { done(); }
      });

      it('NAV-02 forth to step 2, back to step 1, forth again', async () => {
        const { r, onBack, done } = start(flow);
        try {
          await tick(400);
          await press(r, ...flow.first);
          expect(stepOf(r)).toBe(`Step 2 of ${flow.total}`);
          await press(r, flow.back);
          expect(stepOf(r)).toBe(`Step 1 of ${flow.total}`);
          await press(r, ...flow.again);
          expect(stepOf(r)).toBe(`Step 2 of ${flow.total}`);
          expect(onBack).not.toHaveBeenCalled();
        } finally { done(); }
      });

      it('NAV-03 after a done step Esc asks; Esc stays on the step; Esc and Enter abort', async () => {
        const { r, onBack, done } = start(flow);
        try {
          await tick(400);
          await press(r, ...flow.first);
          expect(stepOf(r)).toBe(`Step 2 of ${flow.total}`);
          await press(r, X);
          expect(r.lastFrame()).toContain(ABORT_DIALOG_TEXT.setup.question);
          expect(r.lastFrame()).toContain('Enter abort   Esc stay');
          await press(r, X);
          expect(r.lastFrame()).not.toContain(ABORT_DIALOG_TEXT.setup.question);
          expect(stepOf(r)).toBe(`Step 2 of ${flow.total}`);
          expect(onBack).not.toHaveBeenCalled();
          await press(r, X, E);
          expect(onBack).toHaveBeenCalledTimes(1);
        } finally { done(); }
      });

      it('NAV-04 every step to Ready; Enter finishes to the main menu', async () => {
        const { r, onBack, done } = start(flow);
        try {
          await tick(400);
          await press(r, ...flow.first, ...flow.toReady);
          const frame = r.lastFrame() ?? '';
          expect(stepOf(r), frame).toBe(`Step ${flow.total} of ${flow.total}`);
          expect(frame).toContain('Ready');
          expect(frame).toContain('Enter finish   Esc abort');
          expect(onBack).not.toHaveBeenCalled();
          await press(r, E);
          expect(r.lastFrame()).not.toContain(ABORT_DIALOG_TEXT.setup.question);
          expect(onBack).toHaveBeenCalledTimes(1);
        } finally { done(); }
      });
    });
  }
});
