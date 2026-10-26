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
import { render as inkRender, Text, type Instance } from 'ink';
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

const Header = ({ subtitle }: { subtitle?: string }): JSX.Element => <Text>{subtitle ?? ''}</Text>;
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
      <ChallengePromptPhase app="demo-app" type="application" isEnterprise onConfirm={() => { confirmed++; }} onBack={() => undefined} Header={Header} offer={offer} />,
    );
    const frame = lastFrame().replace(/\s+/g, ' ');
    expect(frame).toContain('Assessment complete. Run a Stakeholder Challenge?');
    expect(frame).toContain(`of run ${OLD_RUN}) belongs to another run`);
    expect(frame).toContain('CLI equivalent: swao challenge --all-agents --app demo-app');
    await new Promise(r => setTimeout(r, 20));
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
      <ChallengePromptPhase app="demo-app" type="application" isEnterprise onConfirm={() => undefined} onBack={() => undefined} Header={Header} offer={offer} />,
    );
    expect(lastFrame()).not.toContain('another run');
  });
});
