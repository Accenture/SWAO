// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, generic Setup Wizard steps at 100 and 80 columns (#4254)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4254 (TUI-10 criterion "width tests at 100 and 80 columns for every step
// and branch", Design 126 sections 3, 9 and 10): the generic steps not yet
// measured at both widths (LLM, Credentials, Health Check while it runs,
// LZ Connections inside the wizard, the type selection in both forms) render
// within the header rule with the step title, one key hint line and one
// guidance box, and without hand-written key wording. The MCP Client step is
// measured in the private IntegrationsStep tests (public sync rule, #3348).

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Box, render } from 'ink';

// The Health Check step and the credential check spawn the CLI: a fake child
// prints one long probe line and never exits, so the running view is measured.
vi.mock('child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('child_process')>();
  const { EventEmitter: Emitter } = await import('node:events');
  return {
    ...original,
    spawn: vi.fn(() => {
      const child = Object.assign(new Emitter(), { stdout: new Emitter(), stderr: new Emitter(), kill: () => true });
      setTimeout(() => {
        const long = 'connector anthropic-claude reachable but the model list could not be read from the gateway '.repeat(2).trim();
        child.stdout.emit('data', Buffer.from(`  [1/2] llm-gateway......  ok  ${long}\n`));
      }, 20);
      return child;
    }),
  };
});

import { headerRuleWidth } from '@swao/tui-kit';
import { ellipsisOffenders } from '../../../../__tests__/helpers/width-rule.js';
import { ReadyStep } from './ReadyStep.js';
import { LlmStep } from './LlmStep.js';
import { CredentialsStep } from './CredentialsStep.js';
import { HealthCheckStep } from './HealthCheckStep.js';
import { LzConnectionsStep } from './LzConnectionsStep.js';
import { TypeSelectionStep } from '../../../../setup/TypeSelectionStep.js';

class FakeStdout extends EventEmitter {
  frames: string[] = [];
  constructor(readonly columns: number, readonly rows: number) { super(); }
  write = (frame: string): boolean => { this.frames.push(frame); return true; };
}
class FakeStdin extends EventEmitter {
  isTTY = true;
  read = (): string | null => null;
  setEncoding(): void { /* not needed */ }
  setRawMode(): void { /* not needed */ }
  resume(): void { /* not needed */ }
  pause(): void { /* not needed */ }
  ref(): void { /* not needed */ }
  unref(): void { /* not needed */ }
}

const NL = String.fromCharCode(10);
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const settle = (ms = 200): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function linesAt(el: React.ReactElement, columns: number): Promise<string[]> {
  const stdout = new FakeStdout(columns, 60);
  // The wizard's ScreenLayout gives the step content the header rule width (Design 126 section 10).
  const inst = render(<Box width={headerRuleWidth(columns)} flexDirection="column">{el}</Box>, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new FakeStdout(columns, 60) as unknown as NodeJS.WriteStream,
    stdin: new FakeStdin() as unknown as NodeJS.ReadStream,
    debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  await settle();
  const out = (stdout.frames[stdout.frames.length - 1] ?? '').replace(ANSI, '').split(NL);
  inst.unmount();
  return out;
}

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function ws(yml = 'name: demo\n'): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-4254-generic-'));
  dirs.push(d);
  writeFileSync(join(d, '.swao.yml'), yml, 'utf-8');
  return d;
}
const noop = (): void => undefined;

const STEPS: Array<[string, string, () => React.ReactElement]> = [
  ['LLM', 'LLM', () => <LlmStep onNext={noop} workspaceRoot={ws()} />],
  ['Credentials', 'Credentials', () => <CredentialsStep provider="anthropic" onNext={noop} workspaceRoot={ws()} />],
  ['Health Check', 'llm-gateway', () => <HealthCheckStep onNext={noop} />],
  ['Landing Zone Connections', 'Landing Zone Connections', () => <LzConnectionsStep workspace={ws()} onNext={noop} />],
  ['Which assessments will you run?', 'Assessment types:', () => <TypeSelectionStep tier="community" initial={['application']} states={{ application: 'ready' }} onNext={noop} />],
  ['Set up an assessment type', 'Assessment type:', () => <TypeSelectionStep single title="Set up an assessment type" tier="community" initial={[]} states={{}} onNext={noop} />],
  // #4213 G-08: the generic Ready step at 80 columns as well (before only at 100, in a private file).
  ['Ready', 'Demo engagement', () => <ReadyStep state={{ workDir: ws(), engagementName: 'Demo engagement', clientCode: 'X', partnershipLead: 'Y', llmProvider: 'anthropic', llmModel: 'claude-model-with-a-long-identifier-20251001', ollamaEndpoint: '', openLlmBaseUrl: '' }} health={{ probeCount: 26, failCount: 0, warnCount: 1 }} onBack={noop} />],
];


describe('generic Setup Wizard steps within the header rule (#4254)', () => {
  for (const columns of [100, 80]) {
    for (const [title, marker, make] of STEPS) {
      it(`${title} at ${columns} columns: title, content, one hint line, one guidance box`, async () => {
        const lines = await linesAt(make(), columns);
        const text = lines.join(NL);
        expect(text).toContain(title);
        expect(text).toContain(marker);
        expect(text.split('Ctrl+G for guidance').length - 1).toBe(1);
        expect(text).not.toMatch(/Esc:|Press Enter|Enter or Esc/);
        for (const l of lines) expect(l.trimEnd().length, l).toBeLessThanOrEqual(headerRuleWidth(columns));
        // #4213 G-08: no ellipsis outside a path or the collapsed guidance box (strict since 2026-11-13).
        expect(ellipsisOffenders(lines, columns)).toEqual([]);
      });
    }
  }
});
