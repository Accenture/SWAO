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

// #4347 (owner screenshot 2026-11-10, Design 126 sections 7 to 9): the LLM
// Setup Candidates rows at 100 and 80 columns with the model ids of the
// screenshot: the model never runs into the label column and never breaks
// inside its id, the keys are in the KeyHints line (not in the guidance box),
// the guidance follows the highlighted candidate and does not page.

import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink';
import { formatKeyHints, headerRuleWidth } from '@swao/tui-kit';
import { ellipsisOffenders } from '../../__tests__/helpers/width-rule.js';
import { LlmCandidatesStep, candidateGuidance, candidateLabelWidth, connectorLabel, type ConnectorLister } from './LlmCandidatesStep.js';
import { writeAssessmentLlm, type CandidateConnector } from '../llm-values.js';
import type { SetupStepProps } from '../types.js';

class FakeStdout extends EventEmitter {
  frames: string[] = [];
  constructor(readonly columns: number, readonly rows: number) { super(); this.setMaxListeners(50); }
  write = (frame: string): boolean => { this.frames.push(frame); return true; };
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  private data: string | null = null;
  write = (data: string): void => { this.data = data; this.emit('readable'); this.emit('data', data); };
  read = (): string | null => { const d = this.data; this.data = null; return d; };
  setEncoding(): void { /* not needed */ }
  setRawMode(): void { /* not needed */ }
  resume(): void { /* not needed */ }
  pause(): void { /* not needed */ }
  ref(): void { /* not needed */ }
  unref(): void { /* not needed */ }
}

const settle = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));
// eslint-disable-next-line no-control-regex
const plain = (t: string): string => t.replace(/\x1b\[[0-9;]*m/g, '');

let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

const CONNECTORS: CandidateConnector[] = [
  { id: 'anthropic', name: 'Anthropic', defaultModel: 'claude-haiku-4-5-20251001', models: ['claude-haiku-4-5-20251001'], credentialKey: 'anthropic-key', hasCredential: true, prices: { 'claude-haiku-4-5-20251001': { input: 1, output: 5 } } },
  { id: 'openrouter', name: 'OpenRouter', defaultModel: 'mistralai/mistral-large', models: ['mistralai/mistral-large'], credentialKey: 'openrouter-key', hasCredential: false },
  { id: 'stackit', name: 'STACKIT AI Model Serving', defaultModel: 'llama-3.3-70b', models: ['llama-3.3-70b'], credentialKey: 'stackit-key', hasCredential: true },
];
const lister: ConnectorLister = () => CONNECTORS;

function props(root: string): SetupStepProps {
  return {
    ctx: { workspaceRoot: root, tier: 'community', scope: 'llm', scopeLabel: 'LLM Assessment', session: {} as SetupStepProps['ctx']['session'] },
    stepNumber: 1, stepCount: 4, onNext: () => undefined, updateSession: () => undefined,
    setEscapeCaptured: () => undefined, setGuidanceOpen: () => undefined,
  };
}

async function frameAt(columns: number, keys: string[] = []): Promise<string[]> {
  dir = mkdtempSync(join(tmpdir(), 'swao-4347-'));
  writeFileSync(join(dir, '.swao.yml'), 'wsp_version: "0.9"\n', 'utf-8');
  writeAssessmentLlm(dir, { candidates: [{ connector: 'anthropic', model: 'claude-haiku-4-5-20251001' }, { connector: 'openrouter', model: 'mistralai/mistral-large' }] });
  const stdout = new FakeStdout(columns, 60);
  const stdin = new FakeStdin();
  const inst = render(<LlmCandidatesStep {...props(dir)} listConnectors={lister} />, {
    stdout: stdout as unknown as NodeJS.WriteStream, stderr: new FakeStdout(columns, 60) as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream, debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  await settle();
  // #4494: the cursor starts on the keep entry (stored candidates); Down wraps to the first candidate.
  for (const k of [String.fromCharCode(27) + '[B', ...keys]) { stdin.write(k); await settle(30); }
  const lines = plain(stdout.frames[stdout.frames.length - 1] ?? '').split('\n');
  inst.unmount();
  return lines;
}

describe('LLM Setup Candidates rows (#4347)', () => {
  for (const columns of [100, 80]) {
    it(`one row per candidate, model whole in the value column, keys in KeyHints, guidance per candidate at ${columns} columns`, async () => {
      const lines = await frameAt(columns);
      for (const l of lines) expect(l.trimEnd().length, l).toBeLessThanOrEqual(headerRuleWidth(columns));
      expect(ellipsisOffenders(lines, columns)).toEqual([]); // #4213 G-08
      const haiku = lines.find((l) => l.includes('claude-haiku-4-5-20251001'));
      expect(haiku).toMatch(/\[ok\]\s+anthropic\s+claude-haiku-4-5-20251001,/);
      expect(lines.find((l) => l.includes('mistralai/mistral-large'))).toMatch(/\[missing\]\s+openrouter\s+mistralai\/mistral-large,/);
      // The label column is as wide as the longest connector: the value starts at the same column on both rows.
      const col = (l: string, word: string): number => l.indexOf(word);
      expect(col(haiku!, 'claude')).toBe(col(lines.find((l) => l.includes('mistralai'))!, 'mistralai'));
      const hints = lines.findIndex((l) => l.includes(formatKeyHints([{ key: '↑↓', verb: 'select' }, { key: 'D', verb: 'remove' }, { key: 'Enter', verb: 'save' }, { key: 'Esc', verb: 'abort' }])));
      expect(hints).toBeGreaterThan(0);
      const box = lines.slice(hints + 1).join(' ');
      expect(box).toContain('Candidate anthropic claude-haiku-4-5-20251001');
      expect(box).not.toMatch(/Up\/Down|A: add|Esc: keep|Sections \d+ to/);
    });
  }

  it('the guidance follows the highlighted candidate (credential, price when stated)', async () => {
    const lines = await frameAt(100, ['\u001B[B']);
    const box = lines.slice(lines.findIndex((l) => l.startsWith('┌'))).join(' ');
    expect(box).toContain('Candidate openrouter mistralai/mistral-large');
    const g = candidateGuidance({ connector: 'anthropic', model: 'claude-haiku-4-5-20251001' }, CONNECTORS[0]);
    expect(g.sections).toEqual(expect.arrayContaining([
      { label: 'Credential', text: 'credential stored' },
      { label: 'Price', text: '1 input and 5 output per million tokens (connector file)' },
    ]));
    expect(candidateGuidance({ connector: 'openrouter', model: 'mistralai/mistral-large' }, CONNECTORS[1]).sections).toEqual(expect.arrayContaining([{ label: 'Price', text: 'not stated in the connector file' }]));
  });

  it('a cloud provider connector takes its name from the central map (#4296)', () => {
    expect(connectorLabel('stackit')).toBe('STACKIT');
    expect(connectorLabel('openrouter')).toBe('openrouter');
    expect(candidateGuidance({ connector: 'stackit', model: 'llama-3.3-70b' }, CONNECTORS[2]).sections![0]!.text).toBe('STACKIT AI Model Serving (stackit), STACKIT');
    expect(candidateLabelWidth([{ connector: 'anthropic' }, { connector: 'openrouter' }])).toBe('openrouter'.length + 2);
  });
});
