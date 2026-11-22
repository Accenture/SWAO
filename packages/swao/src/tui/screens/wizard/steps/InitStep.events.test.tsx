// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- TUI tests: Init step event sequence (#4121)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4121: the Init step logged wizard.engagement.complete twice with two
// meanings ("data collected" from InitStep, "details confirmed" from the
// wizard shell). Each wizard event code is now emitted once per step with one
// meaning; these tests drive the real SetupWizard through the Init step and
// assert the logged event sequence.

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const logged: string[] = [];

vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  return {
    ...actual,
    logPortfolio: vi.fn((_level: string, code: string) => { logged.push(code); }),
    saveDefaultWorkspace: vi.fn(),
    setWorkspaceRoot: vi.fn(),
  };
});

vi.mock('../../../../commands/init.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../commands/init.js')>();
  return { ...actual, runWorkspaceScaffolders: vi.fn() };
});

vi.mock('@swao/module-llm-providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/module-llm-providers')>();
  return { ...actual, seedBundledConnectors: vi.fn(() => ({ copied: [] })) };
});

vi.mock('../../../../license/license-guard.js', () => ({
  LicenseGuard: { load: vi.fn(() => ({ state: { tier: 'enterprise' } })) },
}));

import { SetupWizard } from '../../SetupWizard.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  logged.splice(0);
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

type Rendered = { stdin: { write: (s: string) => void }; lastFrame: () => string | undefined };

/** Polls until `ok()` holds or the time is up (no fixed waits; #4376 run 6 night). */
async function waitFor(ok: () => boolean, timeoutMs = 10000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!ok() && Date.now() < until) await tick(20);
}

/** Waits until the frame has not changed for `quietMs` (at most `timeoutMs`). */
async function settle(r: Rendered, quietMs = 150, timeoutMs = 5000): Promise<void> {
  const until = Date.now() + timeoutMs;
  let last = r.lastFrame();
  let since = Date.now();
  while (Date.now() < until) {
    await tick(20);
    const now = r.lastFrame();
    if (now !== last) { last = now; since = Date.now(); } else if (Date.now() - since >= quietMs) return;
  }
}

/**
 * Writes `key` and waits until `done()`. Ink attaches the input handler of a
 * new frame after drawing it, so under parallel load a key can be ignored; the
 * key is written again only while the frame is unchanged (not taken), never
 * after the step moved on (same rule as application-steps.test.tsx, #4376).
 */
async function pressUntil(r: Rendered, key: string, done: () => boolean, timeoutMs = 15000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until && !done()) {
    // A step draws its new content before its key hints and input handler
    // follow; a key is only written once the frame has settled.
    await settle(r);
    if (done()) return;
    const before = r.lastFrame();
    r.stdin.write(key);
    const retryAt = Date.now() + 1500;
    while (!done() && Date.now() < retryAt) await tick(20);
    if (!done() && r.lastFrame() !== before) await waitFor(done, Math.max(0, until - Date.now()));
  }
}

// The frame without colour codes (the input cursor is drawn inverse inside the typed text).
function plain(r: Rendered): string {
  const f = r.lastFrame() ?? '';
  let out = '';
  for (let i = 0; i < f.length; i++) {
    if (f.charCodeAt(i) === 27 && f[i + 1] === '[') {
      let j = i + 2;
      while (j < f.length && ((f[j]! >= '0' && f[j]! <= '9') || f[j] === ';')) j++;
      if (f[j] === 'm') { i = j; continue; }
    }
    out += f[i];
  }
  return out;
}
const frameHas = (r: Rendered, text: string) => (): boolean => plain(r).includes(text);

/** Types `text` into the field whose prompt is shown (waits for the echo), then Enter until `next` holds. */
async function answer(r: Rendered, text: string, next: () => boolean): Promise<void> {
  if (text) await pressUntil(r, text, frameHas(r, text));
  await pressUntil(r, '\r', next);
}

/**
 * The Init step opens on its intro ("Enter next"), then asks to confirm the
 * portfolio root ("Enter confirm"). Waits for the root confirmation, pressing
 * Enter on the intro only while the intro is still shown.
 */
async function toRootConfirm(r: Rendered): Promise<void> {
  const atRoot = (): boolean => plain(r).includes('Enter confirm') && plain(r).includes('Portfolio root');
  await waitFor(() => atRoot() || plain(r).includes('Enter next'));
  if (!atRoot()) await pressUntil(r, '\r', atRoot);
}

// #3373: the portfolio root is the folder SWAO runs in (resolve('.')).
function inPortfolioRoot(dir: string): void {
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
}

const wizardEvents = () => logged.filter((c) => c.startsWith('wizard.'));

describe('Setup Wizard Init step event sequence (#4121)', () => {
  it('new workspace: collected, init.complete, confirmed; every code once', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-4121-new-'));
    dirs.push(ws);
    inPortfolioRoot(ws);
    const r = render(<SetupWizard onBack={() => {}} />);
    // Each answer waits for the next prompt in the frame (no fixed ticks; #4376 run 6 night).
    await toRootConfirm(r);
    await answer(r, '', frameHas(r, 'Engagement name (e.g.'));                 // portfolio root (new workspace)
    await answer(r, 'Demo Engagement', frameHas(r, 'Client code (short slug'));      // engagement name
    await answer(r, 'demo4121', frameHas(r, 'Engagement owner email'));      // client code
    await answer(r, '', frameHas(r, 'Engagement lead name or email'));   // partnership lead
    await answer(r, '', frameHas(r, 'Expected end date'));               // engagement lead
    await answer(r, '', () => logged.includes('wizard.engagement.confirmed')); // end date
    r.unmount();
    const seq = wizardEvents().filter((c) => c !== 'wizard.abort');
    expect(seq).toEqual(['wizard.engagement.collected', 'wizard.init.complete', 'wizard.engagement.confirmed']);
    expect(logged).not.toContain('wizard.engagement.complete');
    expect(existsSync(join(ws, '.swao.yml'))).toBe(true);
  });

  it('existing workspace, continue: init.complete, confirmed; no collected or updated', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-4121-existing-'));
    dirs.push(ws);
    writeFileSync(join(ws, '.swao.yml'), 'engagement:\n  name: Demo\n  client_code: demo\n', 'utf-8');
    inPortfolioRoot(ws);
    const r = render(<SetupWizard onBack={() => {}} />);
    await toRootConfirm(r);
    await pressUntil(r, '\r', frameHas(r, 'Continue with this workspace'));          // portfolio root (existing .swao.yml)
    await pressUntil(r, '\r', () => logged.includes('wizard.engagement.confirmed')); // Enter: continue with this workspace
    r.unmount();
    const seq = wizardEvents().filter((c) => c !== 'wizard.abort');
    expect(seq).toEqual(['wizard.init.complete', 'wizard.engagement.confirmed']);
  });

  it('no wizard event code repeats within one Init step', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-4121-edit-'));
    dirs.push(ws);
    writeFileSync(join(ws, '.swao.yml'), 'engagement:\n  name: Demo\n  client_code: demo\n', 'utf-8');
    inPortfolioRoot(ws);
    const r = render(<SetupWizard onBack={() => {}} />);
    await toRootConfirm(r);
    await pressUntil(r, '\r', frameHas(r, 'Continue with this workspace'));
    await pressUntil(r, '2', frameHas(r, 'Engagement name: Demo'));   // #4254: the entry Edit the engagement details (was the letter E)
    await answer(r, '', frameHas(r, 'Client code (slug)'));     // keep name
    await answer(r, '', frameHas(r, 'Engagement owner email')); // keep code
    await answer(r, '', () => logged.includes('wizard.engagement.confirmed')); // keep lead -> writes .swao.yml
    r.unmount();
    const seq = wizardEvents().filter((c) => c !== 'wizard.abort');
    expect(seq).toEqual(['wizard.engagement.updated', 'wizard.init.complete', 'wizard.engagement.confirmed']);
    expect(new Set(seq).size).toBe(seq.length);
  });
});
