// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, LZ Live and Service branch steps at 100 and 80 columns (#4254)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4254 (TUI-10 criterion "width tests at 100 and 80 columns for every step
// and branch", Design 126 sections 3, 9 and 10): the LZ Live steps (Probe
// before and after the probe, Policy Baseline, Org Evidence) and the Service
// steps (Service Setup, Intake Input, Scoring Inputs) render within the
// header rule, with the step title, one key hint line and one guidance box,
// and without hand-written key wording.

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Box, render } from 'ink';
import { headerRuleWidth } from '@swao/tui-kit';
import { ellipsisOffenders } from '../../__tests__/helpers/width-rule.js';
import type { ConnectionsCliRunner } from '../../tui/screens/LzConnectionsScreen.js';
import type { SetupState } from '../../tui/screens/wizard/shared.js';
import type { SetupStepProps } from '../types.js';
import { LzLiveBaselineView, LzLiveEvidenceStep, LzLiveProbeView } from './lz-live-steps.js';
import { ServiceIntakeStep, ServiceScoringStep, ServiceWorkspaceStep } from './service.js';
import type { IntakeParser } from './service-checks.js';

class FakeStdout extends EventEmitter {
  frames: string[] = [];
  constructor(readonly columns: number, readonly rows: number) { super(); }
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

const NL = String.fromCharCode(10);
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const settle = (ms = 120): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Renders at `columns`, optionally presses keys, returns the last frame's lines. */
async function linesAt(el: React.ReactElement, columns: number, keys: string[] = []): Promise<string[]> {
  const stdout = new FakeStdout(columns, 60);
  const stdin = new FakeStdin();
  // The wizard's ScreenLayout gives the step content the header rule width (Design 126 section 10).
  const inst = render(<Box width={headerRuleWidth(columns)} flexDirection="column">{el}</Box>, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new FakeStdout(columns, 60) as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  await settle();
  for (const k of keys) { stdin.write(k); await settle(200); }
  const out = (stdout.frames[stdout.frames.length - 1] ?? '').replace(ANSI, '').split(NL);
  inst.unmount();
  return out;
}

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const LZ = ['name: demo', 'landing_zones:', '  - id: aws-demo-with-a-long-landing-zone-name', '    provider: aws', '    scopes:',
  '      - id: platform', '        kind: platform', '        auth: session-keys',
  '      - id: application-scope-with-a-long-id', '        kind: application', '        auth: session-keys', ''].join(NL);

function ws(yml: string): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-4254-branch-'));
  dirs.push(d);
  writeFileSync(join(d, '.swao.yml'), yml, 'utf-8');
  mkdirSync(join(d, 'wsp', 'inputs', 'catalogs', 'community'), { recursive: true });
  return d;
}

function props(root: string, scope: 'lz-live' | 'service'): SetupStepProps {
  return {
    ctx: { workspaceRoot: root, tier: 'enterprise', scope, scopeLabel: scope === 'lz-live' ? 'Landing Zone Live Assessment' : 'Service Portfolio Assessment', session: {} as SetupState },
    stepNumber: 2, stepCount: 6, onNext: () => undefined, updateSession: () => undefined, setEscapeCaptured: () => undefined, setGuidanceOpen: () => undefined,
  };
}

// A probe result with a long coverage line and a write-capable login (fake identity, built at run time).
const ARN = ['arn', 'aws', 'iam', '', ['1234', '5678', '9012'].join(''), 'user/ops'].join(':');
const run: ConnectionsCliRunner = async (_args, onLine) => {
  onLine(`scope platform: identity ${ARN}, read-only verified`);
  onLine('  coverage: 9 readable');
  onLine(`scope application-scope-with-a-long-id: identity ${ARN}, read-only refused`);
  onLine('  coverage: 4 readable, not readable: kms, organizations, cloudtrail, config, guardduty, securityhub');
  onLine(`  credential is write-capable (${ARN})`);
  return 1;
};

const fakeParse: IntakeParser = async () => ({
  rows: [], sheets: [{ name: 'Inventory', headers: { A: 'App ID' }, mapping: 'default', rows: 3, fields: { id: 'A' } }],
  signals: [], warnings: [], duplicateIds: [],
} as unknown as Awaited<ReturnType<IntakeParser>>);

function intakeWs(): string {
  const d = ws('engagement:\n  name: fixture\n');
  const dir = join(d, 'wsp', 'inputs', 'service-intake');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'a-service-intake-workbook-with-a-long-file-name-for-the-width-test.xlsx'), 'x', 'utf-8');
  return d;
}

const STEPS: Array<[string, string, (columns: number) => Promise<string[]>]> = [
  ['Probe', 'aws-demo-with-a-long-landing-zone-name', (c) => linesAt(<LzLiveProbeView {...props(ws(LZ), 'lz-live')} run={run} />, c)],
  ['Probe', 'accepted for this run; SWAO only reads', (c) => linesAt(<LzLiveProbeView {...props(ws(LZ), 'lz-live')} run={run} />, c, ['\r'])],
  ['Policy Baseline', 'No Client LZ Policy Baseline', (c) => linesAt(<LzLiveBaselineView {...props(ws(LZ), 'lz-live')} probe={{ capabilityTags: [] }} />, c)],
  ['Org Evidence', 'aws-demo-with-a-long-landing-zone-name', (c) => linesAt(<LzLiveEvidenceStep {...props(ws(LZ), 'lz-live')} />, c)],
  ['Service Setup', 'Service', (c) => linesAt(<ServiceWorkspaceStep {...props(ws('engagement:\n  name: fixture\n'), 'service')} />, c)],
  ['Intake Input', 'a-service-intake-workbook', (c) => linesAt(<ServiceIntakeStep {...props(intakeWs(), 'service')} parse={fakeParse} />, c)],
  ['Scoring Inputs', 'Scoring', (c) => linesAt(<ServiceScoringStep {...props(ws('engagement:\n  name: fixture\n'), 'service')} />, c)],
];

describe('LZ Live and Service branch steps within the header rule (#4254)', () => {
  for (const columns of [100, 80]) {
    STEPS.forEach(([title, marker, make], i) => {
      it(`${title} (${i}) at ${columns} columns: title, content, one hint line, one guidance box`, async () => {
        const lines = await make(columns);
        const text = lines.join(NL);
        expect(text).toContain(title);
        expect(text.replace(/\s+/g, ' ')).toContain(marker);
        expect(text.split('Ctrl+G for guidance').length - 1).toBe(1);
        expect(text).not.toMatch(/Esc:|Press Enter|Enter or Esc/);
        for (const l of lines) expect(l.trimEnd().length, l).toBeLessThanOrEqual(headerRuleWidth(columns));
        // #4213 G-08: no ellipsis outside a path or the collapsed guidance box (strict since 2026-11-13).
        expect(ellipsisOffenders(lines, columns)).toEqual([]);
      });
    });
  }
});
