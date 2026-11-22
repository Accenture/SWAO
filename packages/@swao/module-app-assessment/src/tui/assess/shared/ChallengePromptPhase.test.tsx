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

// #3427: after an assessment the TUI offers the challenge for the new run and
// says when the challenge on disk belongs to another run. Same helper
// (challengeOfferForRun) as the `swao assess` end-of-run hint (CLI parity).
//
// ink-testing-library is a dependency of packages/swao only, so this file
// renders through ink directly with the same minimal in-memory streams.

import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render as inkRender, type Instance } from 'ink';
import type { ReactElement } from 'react';
import { ChallengePromptPhase, challengeOfferForApp } from './ChallengePromptPhase.js';

class FakeStdout extends EventEmitter {
  columns = 120;
  last = '';
  write = (frame: string): boolean => { this.last = frame; return true; };
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

function render(tree: ReactElement): { lastFrame: () => string; stdin: FakeStdin } {
  const stdout = new FakeStdout();
  const stdin = new FakeStdin();
  instances.push(inkRender(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new FakeStdout() as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  }));
  return { lastFrame: () => stdout.last, stdin };
}

// #4256: the prompt renders in the flow frame of the screen.
const FRAME = { header: { subtitle: 'Application Assessment', version: '1.6.1', licenseState: { tier: 'enterprise' as const, assessmentCount: 1, firstRun: '2026-01-01' } }, steps: ['Application', 'Run', 'Done'], current: 2, onGuidanceOpenChange: (): void => undefined, dialog: null };
const OLD_RUN = '2026-10-20T09-00-00';
const NEW_RUN = '2026-10-22T17-15-00';

function workspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-3427-tui-'));
  dirs.push(ws);
  const wsp = join(ws, 'apps', 'demo-app', 'wsp');
  for (const id of [OLD_RUN, NEW_RUN]) {
    mkdirSync(join(wsp, 'runs', id), { recursive: true });
    writeFileSync(join(wsp, 'runs', id, 'wsp.yaml'), 'overall: {}\n');
  }
  const ch = join(wsp, 'challenge-app', '2026-10-20T10-00-00');
  mkdirSync(ch, { recursive: true });
  writeFileSync(join(ch, 'AA_business-owner.yaml'), `agent_id: business-owner\nchallenged_run:\n  run_id: ${OLD_RUN}\nfindings: []\n`);
  return ws;
}

describe('ChallengePromptPhase offer (#3427)', () => {
  it('challengeOfferForApp: stale challenge of the older run, command for the app', () => {
    const offer = challengeOfferForApp(workspace(), 'demo-app', 'application');
    expect(offer?.freshness).toBe('stale');
    expect(offer?.command).toBe('swao challenge --all-agents --app demo-app');
    expect(offer?.note).toContain(`challenge 2026-10-20T10-00-00 of run ${OLD_RUN}`);
  });

  it('prompt names the other run and the CLI equivalent; Enter runs the challenge', async () => {
    const offer = challengeOfferForApp(workspace(), 'demo-app', 'application');
    let confirmed = 0;
    const { lastFrame, stdin } = render(
      <ChallengePromptPhase app="demo-app" type="application" isEnterprise onConfirm={() => { confirmed++; }} onBack={() => undefined} frame={FRAME} offer={offer} />,
    );
    const frame = lastFrame().replace(/\s+/g, ' ');
    // #4256: a ConfirmPanel in the flow frame; the stale note is the risk line, the CLI is in the guidance only.
    expect(frame).toContain('Run a Stakeholder Challenge?');
    expect(frame).toContain('The assessment is complete.');
    expect(frame).toContain(`of run ${OLD_RUN}) belongs to another run`);
    expect(frame).not.toContain('CLI equivalent');
    expect(frame).toContain('Enter confirm');
    await new Promise(r => setTimeout(r, 20));
    stdin.write('\u0007');
    await new Promise(r => setTimeout(r, 20));
    expect(lastFrame().replace(/\s+/g, ' ')).toContain('CLI: swao challenge --all-agents --app demo-app');
    stdin.write('\r');
    await new Promise(r => setTimeout(r, 20));
    expect(confirmed).toBe(1);
  });

  it('no stale note when the new run already has its challenge', () => {
    const ws = workspace();
    const ch = join(ws, 'apps', 'demo-app', 'wsp', 'challenge-app', '2026-10-22T17-30-00');
    mkdirSync(ch, { recursive: true });
    writeFileSync(join(ch, 'AA_finops-lead.yaml'), `agent_id: finops-lead\nchallenged_run:\n  run_id: ${NEW_RUN}\nfindings: []\n`);
    const offer = challengeOfferForApp(ws, 'demo-app', 'application');
    expect(offer).toEqual({ freshness: 'current', command: 'swao challenge --all-agents --app demo-app' });
    const { lastFrame } = render(
      <ChallengePromptPhase app="demo-app" type="application" isEnterprise onConfirm={() => undefined} onBack={() => undefined} frame={FRAME} offer={offer} />,
    );
    expect(lastFrame()).not.toContain('another run');
  });

  it('#4230: with the guidance box open Esc closes the box only and Enter still runs the challenge', async () => {
    let confirmed = 0;
    let back = 0;
    const { stdin } = render(
      <ChallengePromptPhase app="demo-app" type="application" isEnterprise onConfirm={() => { confirmed++; }} onBack={() => { back++; }} frame={FRAME} />,
    );
    const wait = (): Promise<void> => new Promise(r => setTimeout(r, 30));
    await wait();
    stdin.write('\u0007'); // Ctrl+G opens the box
    await wait();
    stdin.write('\u001b'); // Esc closes the box, never leaves the prompt
    await wait();
    expect(back).toBe(0);
    stdin.write('\u0007');
    await wait();
    stdin.write('\r');
    await wait();
    expect(confirmed).toBe(1);
  });
});
