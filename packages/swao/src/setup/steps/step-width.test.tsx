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

// #4254 (Design 126 sections 3, 4.5 and 9, TUI-10 criterion "width tests at
// 100 and 80 columns for every step"): the setup steps migrated to
// SetupStepFrame on day 3 render within the header rule at 100 and 80
// columns (day 3 batch: Init, Playwright, Secondary LLM and the MCP notice too), draw the step title, one key hint line and one guidance box, and
// show no hand-written hint wording ("Esc:", "Press Enter").

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { render } from 'ink';
import { headerRuleWidth } from '@swao/tui-kit';
import { ellipsisOffenders } from '../../__tests__/helpers/width-rule.js';
import { CredentialStore } from '@swao/core';
import type { SetupStepProps } from '../types.js';
import { ApplicationAppStep } from './ApplicationAppStep.js';
import { ApplicationSourceStep } from './ApplicationSourceStep.js';
import { ApplicationToolsStep } from './ApplicationToolsStep.js';
import { LlmSubjectStep } from './LlmSubjectStep.js';
import { TestCodeStep } from '../../tui/screens/wizard/steps/TestCodeStep.js';
import { InitStep } from '../../tui/screens/wizard/steps/InitStep.js';
import { PlaywrightStep } from '../../tui/screens/wizard/steps/IntegrationsStep.js';
import { LlmSecondaryStep } from '../../tui/screens/wizard/steps/LlmSecondaryStep.js';
import { McpUpgradeNotice } from '../branches/generic.js';

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

const settle = (ms = 80): Promise<void> => new Promise((r) => setTimeout(r, ms));
// eslint-disable-next-line no-control-regex
const plain = (t: string): string => t.replace(/\x1b\[[0-9;]*m/g, '');

async function linesAt(el: React.ReactElement, columns: number): Promise<string[]> {
  const stdout = new FakeStdout(columns, 60);
  const inst = render(el, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new FakeStdout(columns, 60) as unknown as NodeJS.WriteStream,
    stdin: new FakeStdin() as unknown as NodeJS.ReadStream,
    debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  await settle();
  const out = plain(stdout.frames[stdout.frames.length - 1] ?? '').split('\n');
  inst.unmount();
  return out;
}

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function ws(): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-4254-width-'));
  dirs.push(d);
  writeFileSync(join(d, '.swao.yml'), 'wsp_version: "0.9"\n', 'utf-8');
  return d;
}
function props(root: string): SetupStepProps {
  return {
    ctx: { workspaceRoot: root, tier: 'enterprise', scope: 'application', scopeLabel: 'Application Assessment', session: {} as SetupStepProps['ctx']['session'] },
    stepNumber: 1, stepCount: 7, onNext: () => undefined, updateSession: () => undefined, setEscapeCaptured: () => undefined, setGuidanceOpen: () => undefined,
  };
}

const STEPS: Array<[string, string, (root: string) => React.ReactElement]> = [
  ['App', 'Add an app', (root) => <ApplicationAppStep {...props(root)} />],
  ['Source access', 'Check again', (root) => {
    // #4490: the step lists the application apps of the workspace only.
    mkdirSync(join(root, 'apps', 'a-very-long-application-identifier'), { recursive: true });
    writeFileSync(join(root, 'apps', 'a-very-long-application-identifier', '.swao.yml'), 'app_id: a-very-long-application-identifier', 'utf-8');
    return (
    <ApplicationSourceStep
      {...props(root)}
      deps={{
        store: () => new CredentialStore(root),
        probe: async () => ({ status: 'warn', message: '', apps: [{ app_id: 'a-very-long-application-identifier', vcs_url: 'https://github.com/o/r', host: 'github.com', outcome: 'no-token', hint: '' }] }),
      }}
    />
    );
  }],
  ['Tools', 'Check again', (root) => <ApplicationToolsStep {...props(root)} lookup={{ env: { PATH: '' }, platform: 'linux', isFile: () => false }} />],
  ['Assessed app', 'No app is ready', (root) => <LlmSubjectStep {...props(root)} />],
  ['Test code', 'Keep the current setting (tag)', () => <TestCodeStep initial="tag" onNext={() => undefined} />],
  // Rendered only, never confirmed: Enter on the Init step would write into the working folder.
  ['Init', 'Portfolio root', () => <InitStep onNext={() => undefined} />],
  ['Playwright', 'Continue without the browser', () => <PlaywrightStep onNext={() => undefined} find={() => null} />],
  ['Secondary LLM', 'No: skip', (root) => <LlmSecondaryStep workspaceRoot={root} primaryProvider="anthropic" onSkip={() => undefined} onNext={() => undefined} />],
  ['MCP Client', 'Enterprise licence', () => <McpUpgradeNotice onNext={() => undefined} />],
];

describe('migrated setup steps within the header rule (#4254)', () => {
  for (const columns of [100, 80]) {
    for (const [title, marker, make] of STEPS) {
      it(`${title} at ${columns} columns: title, content, one hint line, one guidance box`, async () => {
        const lines = await linesAt(make(ws()), columns);
        const text = lines.join('\n');
        expect(text).toContain(title);
        expect(text).toContain(marker);
        expect(text).toContain('Esc abort');
        expect(text.split('Ctrl+G for guidance').length - 1).toBe(1);
        expect(text).not.toMatch(/Esc:|Press Enter|Enter or Esc/);
        for (const l of lines) expect(l.trimEnd().length, l).toBeLessThanOrEqual(headerRuleWidth(columns));
        // #4213 G-08: no ellipsis outside a path or the collapsed guidance box.
        expect(ellipsisOffenders(lines, columns)).toEqual([]);
      });
    }
  }
});
