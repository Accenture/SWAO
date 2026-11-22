// #4256 (Design 126 sections 4.9 and 7.10): the LLM preflight of the
// Application and LZ Catalog flows in the flow frame. A check that does not
// pass offers its choices as list entries (was the letter W and the
// hand-written "Press Enter or Esc" lines). Without a stored key the phase
// warns at once and sends nothing (no fetch).
//
// ink-testing-library is a dependency of packages/swao only, so this file
// renders through ink directly with the same minimal in-memory streams.

import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { render as inkRender, type Instance } from 'ink';
import type { ReactElement } from 'react';
import { PreflightLlmPhase } from './PreflightLlmPhase.js';
import type { LocalConnectorInfo } from './types.js';

class FakeStdout extends EventEmitter {
  columns = 100;
  rows = 50;
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
afterEach(() => { for (const i of instances.splice(0)) i.unmount(); });

// eslint-disable-next-line no-control-regex
const plain = (t: string): string => t.replace(/\x1b\[[0-9;]*m/g, '');
const wait = (): Promise<void> => new Promise((r) => setTimeout(r, 40));
/** Polls until `cond` holds (under a loaded suite a fixed wait let Enter land before the cursor moved). */
async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
}
const CURSOR = String.fromCharCode(0x276f); // the tui-kit picker cursor marker
/** The frame line that holds `label` carries the picker cursor marker. */
const cursorOn = (frame: string, label: string): boolean => frame.split('\n').some((l) => l.includes(label) && l.includes(CURSOR));

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
  return { lastFrame: () => plain(stdout.last), stdin };
}

const FRAME = {
  header: { subtitle: 'Application Assessment', version: '1.6.1', licenseState: { tier: 'enterprise' as const, assessmentCount: 1, firstRun: '2026-01-01' } },
  steps: ['Application', 'Run', 'Done'], current: 1, onGuidanceOpenChange: (): void => undefined, dialog: null,
};
const CONNECTOR = { id: 'gateway-a', protocol: 'openai' } as unknown as LocalConnectorInfo;

describe('PreflightLlmPhase in the flow frame (#4256)', () => {
  it('without a key: a warn row, the choices as list entries, no letter key text', async () => {
    const calls: string[] = [];
    const { lastFrame, stdin } = render(
      <PreflightLlmPhase connector={CONNECTOR} apiKey={undefined} app="sovereign-health" frame={FRAME}
        onPass={() => { calls.push('pass'); }} onBack={() => { calls.push('back'); }} onRunWithoutLlm={() => { calls.push('no-llm'); }} />,
    );
    await wait();
    const frame = lastFrame();
    expect(frame).toContain('LLM connectivity check');
    expect(frame).toMatch(/\[warn\]\s+gateway-a\s+no credential stored, not checked/);
    expect(frame).toContain('Start the run anyway');
    expect(frame).toContain('Run without the LLM');
    expect(frame).toContain('Back to the credentials');
    expect(frame).not.toMatch(/Press W|Press Enter|Press .*Esc| -- /);
    // Under the loaded workspace suite a key written before the list reads input
    // is lost (the fake stdin holds one chunk and emits it once): wait for the
    // cursor on the first entry, then press Down until the cursor moves.
    await until(() => cursorOn(lastFrame(), 'Start the run anyway'));
    for (let i = 0; i < 5 && !cursorOn(lastFrame(), 'Run without the LLM'); i++) {
      stdin.write('\u001B[B'); // Down to "Run without the LLM"
      await until(() => cursorOn(lastFrame(), 'Run without the LLM'), 600);
    }
    expect(cursorOn(lastFrame(), 'Run without the LLM')).toBe(true);
    stdin.write('\r');
    await until(() => calls.length > 0);
    expect(calls).toEqual(['no-llm']);
  });

  it('without onRunWithoutLlm the entry is not offered; Esc goes back', async () => {
    const calls: string[] = [];
    const { lastFrame, stdin } = render(
      <PreflightLlmPhase connector={CONNECTOR} apiKey={undefined} app="sovereign-health" frame={FRAME}
        onPass={() => { calls.push('pass'); }} onBack={() => { calls.push('back'); }} />,
    );
    await wait();
    expect(lastFrame()).not.toContain('Run without the LLM');
    stdin.write('\u001B');
    await wait();
    expect(calls).toEqual(['back']);
  });
});
