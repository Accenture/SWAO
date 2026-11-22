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

// #4192 SET-03 (Design 125 sections 4, 5.2, 9 and 11): the App, Source
// access and Tools steps of the Application branch. Flow per step, the
// branch step order with the engine's health check after the last
// configuration step, and the layout rules (no "--", no CLI syntax, no line
// wider than the header rule).

import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore, type VcsAuthProbeResult } from '@swao/core';
import { headerRuleWidth } from '@swao/tui-kit';
import { ApplicationAppStep } from './ApplicationAppStep.js';
import { ApplicationSourceStep, type ApplicationSourceDeps } from './ApplicationSourceStep.js';
import { ApplicationToolsStep } from './ApplicationToolsStep.js';
import { createApplicationApp } from '../application-app.js';
import { defaultSetupRegistry, buildSetupPlan, entryLabel } from '../index.js';
import type { SetupStepProps, SetupStepResult } from '../types.js';

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
/** Polls until `ok()` holds (vault encryption and the async probe are slower under parallel load). */
async function waitFor(ok: () => boolean, timeoutMs = 5000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!ok() && Date.now() < until) await tick(20);
}
/** #4376: a row of the frame carries the cursor marker and the label. */
function selectedRow(frame: string, label: string): boolean {
  return frame.split('\n').some((line) => line.includes('❯') && line.includes(label));
}
/**
 * #4376: writes `key` and waits until `done()`. Ink attaches the input handler
 * of a new render after the frame is drawn, so under parallel load a key can
 * arrive while the previous handler is still attached and be ignored. The key
 * is written again only while `stillWaiting()` shows the same frame state
 * (the key was not taken), never after the step has moved on.
 */
async function pressUntil(
  r: { stdin: { write: (s: string) => void } },
  key: string,
  done: () => boolean,
  stillWaiting: () => boolean,
  retryMs = 1500,
  timeoutMs = 15000,
): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    r.stdin.write(key);
    const retryAt = Date.now() + retryMs;
    while (!done() && Date.now() < retryAt) await tick(20);
    if (done() || !stillWaiting()) return;
  }
}
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tmp(prefix: string): string { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d; }
function ws(): string {
  const root = tmp('swao-4192-steps-');
  writeFileSync(join(root, '.swao.yml'), 'wsp_version: "0.9"\n', 'utf-8');
  return root;
}

function props(root: string, results: Array<SetupStepResult | undefined>): SetupStepProps {
  return {
    ctx: { workspaceRoot: root, tier: 'community', scope: 'application', scopeLabel: 'Application Assessment', session: {} as SetupStepProps['ctx']['session'] },
    stepNumber: 1,
    stepCount: 7,
    onNext: (r) => results.push(r),
    updateSession: () => undefined,
    setEscapeCaptured: () => undefined,
    setGuidanceOpen: () => undefined,
  };
}

/** Section 9: no "--", no CLI command, no line wider than the header rule (ink-testing-library renders 100 columns). */
function expectLayout(frame: string): void {
  expect(frame).not.toContain('--');
  expect(frame).not.toMatch(/\bswao\s/);
  for (const line of frame.split('\n')) expect(line.trimEnd().length).toBeLessThanOrEqual(headerRuleWidth(100));
}

describe('Application branch step order (#4192, Design 125 sections 4 and 5.2)', () => {
  it('App, Source Access, Playwright, Test Code, Tools, then the engine health check and Ready', () => {
    const reg = defaultSetupRegistry();
    expect(reg.steps('application').map((s) => [s.id, s.order])).toEqual([
      ['application.app', 10], ['application.source', 20], ['application.playwright', 30], ['application.test-code', 40], ['application.tools', 50],
    ]);
    const plan = buildSetupPlan(reg, { kind: 'branch', type: 'application' });
    expect(plan.map(entryLabel)).toEqual(['App', 'Source Access', 'Playwright', 'Test Code', 'Tools', 'Health Check', 'Ready']);
    for (const s of reg.steps('application')) expect(typeof s.check).toBe('function');
  });
});

describe('ApplicationAppStep (#4192)', () => {
  it('without apps asks for an id and a source, and creates the app', async () => {
    const root = ws();
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<ApplicationAppStep {...props(root, results)} />);
    await tick();
    // #4341: the step opens on its menu also without apps; skip is the last entry.
    expect(r.lastFrame()).toContain('Add an app');
    expect(r.lastFrame()).toContain('Skip this step');
    expectLayout(r.lastFrame() ?? '');
    r.stdin.write('\r');
    await tick();
    expect(r.lastFrame()).toContain('App id');
    r.stdin.write('Bad Id');
    await tick();
    r.stdin.write('\r');
    await tick();
    expect(r.lastFrame()).toContain('lower-case');
    for (let i = 0; i < 6; i++) { r.stdin.write('\x7f'); await tick(5); }
    r.stdin.write('demo');
    await tick();
    r.stdin.write('\r');
    await tick();
    expect(r.lastFrame()).toContain('Set the source later');
    expectLayout(r.lastFrame() ?? '');
    r.stdin.write('3');
    await tick();
    expect(results).toEqual([{ status: 'done', summary: 'App demo added' }]);
    expect(existsSync(join(root, 'apps', 'demo', '.swao.yml'))).toBe(true);
    r.unmount();
  });

  it('re-entry shows the current apps and Enter keeps them (idempotent, section 4)', async () => {
    const root = ws();
    createApplicationApp(root, { appId: 'shop', source: { kind: 'later' } });
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<ApplicationAppStep {...props(root, results)} />);
    await tick();
    expect(r.lastFrame()).toContain('Applications in this workspace: shop');
    expect(r.lastFrame()).toContain('Keep the current apps');
    expectLayout(r.lastFrame() ?? '');
    r.stdin.write('\r');
    await tick();
    expect(results).toEqual([{ status: 'kept', summary: 'App: shop' }]);
    r.unmount();
  });

  it('without apps the Skip this step entry skips; Esc does not (#4341)', async () => {
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<ApplicationAppStep {...props(ws(), results)} />);
    await tick();
    r.stdin.write('\x1b');
    await tick(80);
    expect(results).toEqual([]);
    r.stdin.write('2');
    await tick();
    expect(results).toEqual([{ status: 'skipped', summary: 'No app added' }]);
    r.unmount();
  });

  it('the guidance follows the highlighted entry (#4230)', async () => {
    const r = render(<ApplicationAppStep {...props(ws(), [])} />);
    await tick();
    expect(r.lastFrame()).toContain('Asks for the app id');
    r.stdin.write('\u001B[B');
    await tick();
    expect(r.lastFrame()).toContain('Continues without an app');
    r.unmount();
  });
});

describe('ApplicationSourceStep (#4192)', () => {
  it('lists the probe outcomes in plain words, stores a token and checks again', async () => {
    const root = ws();
    // #4490: the step lists the application apps of the workspace only.
    createApplicationApp(root, { appId: 'shop', source: { kind: 'later' } });
    createApplicationApp(root, { appId: 'local', source: { kind: 'later' } });
    const vault = tmp('swao-4192-vault-');
    let calls = 0;
    const deps: ApplicationSourceDeps = {
      store: () => new CredentialStore(vault),
      probe: async (_ws, store): Promise<VcsAuthProbeResult> => {
        calls++;
        const tok = await store.get('provider:github:token');
        return {
          status: tok ? 'ok' : 'warn',
          message: 'probe message with swao credential set (never shown)',
          apps: [
            { app_id: 'shop', vcs_url: 'https://github.com/o/shop', host: 'github.com', outcome: tok ? 'ok' : 'no-token', hint: 'Set via `swao credential set provider:github:token <pat>`' },
            { app_id: 'local', vcs_url: null, host: null, outcome: 'no-vcs-config', hint: 'n/a' },
          ],
        };
      },
    };
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<ApplicationSourceStep {...props(root, results)} deps={deps} />);
    const frameNow = (): string => r.lastFrame() ?? '';
    // #4376: act only on the frame state the key is meant for: the probe list
    // with the action entries and the cursor on the app row.
    await waitFor(() => frameNow().includes('no token in the vault') && frameNow().includes('Check again') && selectedRow(frameNow(), 'shop'), 15000);
    const frame = frameNow();
    expect(frame).toContain('no token in the vault');
    expect(frame).toContain('local source, nothing to check');
    expect(frame).not.toContain('credential set');
    expect(selectedRow(frame, 'shop')).toBe(true);
    expectLayout(frame);
    // #4341: choosing the app (Enter) opens the token input; no letter key.
    // A key that arrives before the step's input handler is attached is lost:
    // press again only while the list is still shown.
    await pressUntil(r, '\r', () => frameNow().includes('Access token for github.com'), () => frameNow().includes('Check again'));
    expect(frameNow()).toContain('Access token for github.com');
    // The token input attaches its handler after the frame shows it: type again only while the field is still empty.
    const stars = '*'.repeat('ghp-test-token'.length);
    await pressUntil(r, 'ghp-test-token', () => frameNow().includes(stars), () => !frameNow().includes('*'));
    expect(frameNow()).not.toContain('ghp-test-token');
    await pressUntil(r, '\r', () => !frameNow().includes('Access token for github.com'), () => frameNow().includes(stars));
    // The vault write and the second probe are slower under parallel load.
    await waitFor(() => frameNow().includes('access confirmed') && frameNow().includes('Check again') && selectedRow(frameNow(), 'shop'), 15000);
    expect(await new CredentialStore(vault).get('provider:github:token')).toBe('ghp-test-token');
    expect(calls).toBe(2);
    expect(frameNow()).toContain('access confirmed');
    // The cursor stays on the app row; with the token stored, Enter finishes the step.
    await pressUntil(r, '\r', () => results.length > 0, () => results.length === 0 && frameNow().includes('access confirmed'));
    expect(results).toEqual([{ status: 'done', summary: 'Source access confirmed' }]);
    r.unmount();
  }, 60000);
});

describe('ApplicationToolsStep (#4192)', () => {
  it('shows found and missing tools with what each enables; Enter continues with a summary', async () => {
    const lookup = { env: { PATH: '/bin' }, platform: 'linux' as const, isFile: (p: string) => p === '/bin/gitleaks' || p === '/bin/checkov' };
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<ApplicationToolsStep {...props(ws(), results)} lookup={lookup} />);
    await tick();
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain('Security tools');
    expect(frame).toContain('IaC tools');
    expect(frame).toContain('secret scan in every run');
    expect(frame).toContain('not found: malware signature scan');
    expect(frame).toContain('2 of 11 tools found');
    expect(frame).toContain('Check again');
    expectLayout(frame);
    r.stdin.write('\r');
    await tick();
    expect(results).toEqual([{ status: 'kept', summary: '2 of 11 tools found' }]);
    r.unmount();
  });

  it('Check again and Continue are list entries; Esc neither continues nor checks (#4341)', async () => {
    let looks = 0;
    const lookup = { env: { PATH: '/bin' }, platform: 'linux' as const, isFile: () => { looks++; return false; } };
    const results: Array<SetupStepResult | undefined> = [];
    const r = render(<ApplicationToolsStep {...props(ws(), results)} lookup={lookup} />);
    await tick();
    const first = looks;
    r.stdin.write('\x1b');
    await tick(80);
    expect(results).toEqual([]);
    expect(looks).toBe(first);
    for (let i = 0; i < 11; i++) { r.stdin.write('\u001B[B'); await tick(5); }
    await tick();
    expect(r.lastFrame()).toContain('Looks for the tools on PATH again');
    r.stdin.write('\r');
    await tick();
    expect(looks).toBeGreaterThan(first);
    expect(results).toEqual([]);
    r.stdin.write('\u001B[B');
    await tick();
    r.stdin.write('\r');
    await tick();
    expect(results).toEqual([{ status: 'kept', summary: '0 of 11 tools found; gitleaks missing' }]);
    r.unmount();
  });
});

describe('Esc ownership (#4341): no Application step captures Esc; it belongs to the wizard', () => {
  it('App, Source Access and Tools never call setEscapeCaptured', async () => {
    const root = ws();
    const deps: ApplicationSourceDeps = { store: () => new CredentialStore(tmp('swao-4192-vault-')), probe: async () => ({ status: 'info', apps: [], message: '' }) };
    const lookup = { env: { PATH: '/bin' }, platform: 'linux' as const, isFile: () => false };
    const steps = [
      (p: SetupStepProps) => <ApplicationAppStep {...p} />,
      (p: SetupStepProps) => <ApplicationSourceStep {...p} deps={deps} />,
      (p: SetupStepProps) => <ApplicationToolsStep {...p} lookup={lookup} />,
    ];
    for (const make of steps) {
      const calls: boolean[] = [];
      const r = render(make({ ...props(root, []), setEscapeCaptured: (c) => calls.push(c) }));
      await tick();
      expect(calls).toEqual([]);
      r.unmount();
      await tick();
      expect(calls).toEqual([]);
    }
  });
});
