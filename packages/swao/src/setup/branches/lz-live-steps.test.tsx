// #4195 SET-06 (Design 125 sections 5.5, 9 and 11): the Landing Zone Live
// setup step components with an injected CLI runner (no process spawned, no
// tenant call). Pins: the probe argv (no accept flag), no identity or other
// native id in a frame, the write-capable flag in the Ready summary, the
// GitHub pointer without an install command, the landing_zones[].frameworks
// write, the ingestion folder, and no line past the header rule (#4110).

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { headerRuleWidth } from '@swao/tui-kit';
import { communityFrameworksDir } from '@swao/community-frameworks';
import type { ConnectionsCliRunner } from '../../tui/screens/LzConnectionsScreen.js';
import type { SetupState } from '../../tui/screens/wizard/shared.js';
import { readLzLiveDefaults } from '../defaults.js';
import type { SetupStepProps, SetupStepResult } from '../types.js';
import { LzLiveBaselineView, LzLiveEvidenceStep, LzLiveProbeView } from './lz-live-steps.js';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

const LZ = ['name: demo', 'landing_zones:', '  - id: aws-demo', '    provider: aws', '    scopes:', '      - id: platform', '        kind: platform', '        auth: session-keys', '      - id: app-1', '        kind: application', '        auth: session-keys', ''].join('\n');

function workspace(yml = LZ, baseline = false): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-lzl-steps-'));
  tmp.push(d);
  writeFileSync(join(d, '.swao.yml'), yml);
  const community = join(d, 'wsp', 'inputs', 'catalogs', 'community');
  mkdirSync(community, { recursive: true });
  if (baseline) cpSync(join(communityFrameworksDir, 'client-lz-policy-baseline'), join(community, 'client-lz-policy-baseline'), { recursive: true });
  return d;
}

function props(ws: string, onNext: (r?: SetupStepResult) => void): SetupStepProps {
  return {
    ctx: { workspaceRoot: ws, tier: 'enterprise', scope: 'lz-live', scopeLabel: 'Landing Zone Live Assessment', session: {} as SetupState },
    stepNumber: 2,
    stepCount: 6,
    onNext,
    updateSession: vi.fn(),
    setEscapeCaptured: vi.fn(),
    setGuidanceOpen: vi.fn(),
  };
}

const ACCOUNT = ['1234', '5678', '9012'].join('');
const ARN = ['arn', 'aws', 'iam', '', ACCOUNT, 'user/ops'].join(':');

function runner(): { run: ConnectionsCliRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: ConnectionsCliRunner = async (args, onLine) => {
    calls.push(args);
    onLine(`scope platform: identity ${ARN}, read-only verified`);
    onLine('  coverage: 9 readable');
    onLine(`scope app-1: identity ${ARN}, read-only refused`);
    onLine('  coverage: 4 readable, not readable: kms');
    onLine('  recording: C:/rec/aws-demo');
    onLine(`  credential is write-capable (${ARN})`);
    return 1;
  };
  return { run, calls };
}

const settle = (ms = 80): Promise<void> => new Promise((r) => setTimeout(r, ms));

function assertWidth(frame: string): void {
  const max = headerRuleWidth(100);
  for (const line of frame.split('\n')) expect(line.length, line).toBeLessThanOrEqual(max);
}

describe('Probe step (#4195)', () => {
  it('probes every landing zone with the plain probe argv and shows no identity or native id', async () => {
    const ws = workspace();
    const { run, calls } = runner();
    const onNext = vi.fn();
    const { lastFrame, stdin } = render(<LzLiveProbeView {...props(ws, onNext)} run={run} />);
    await settle();
    expect(lastFrame()).toContain('aws-demo (AWS, Amazon Web Services): 2 scopes');
    stdin.write('\r');
    await settle(150);
    expect(calls).toEqual([['lz', 'probe', 'aws-demo', '--caller', 'wizard.lz-live.probe']]);
    const frame = lastFrame() ?? '';
    // #4254 (Design 126 F-01, Q-13): StatusRows; the write-capable login is warn with the decided wording.
    expect(frame).toMatch(/\[ok\]\s+aws-demo \/ platform\s+read-only verified/);
    expect(frame).toContain('coverage 9 readable');
    // #4298: the same words as Landing Zone Connections (the summary may wrap onto a second line).
    expect(frame.replace(/\s+/g, ' ')).toMatch(/\[warn\] aws-demo \/ app-1 write-capable, accepted for this run; SWAO only reads/);
    expect(frame).toContain('coverage 4 readable, not readable: kms');
    // #4256: the box follows the highlighted list entry (section 7.8).
    expect(frame).toContain('Continue   (Ctrl+G for guidance)');
    expect(frame).toContain('needs a confirmation per run');
    expect(frame).not.toContain(ACCOUNT);
    expect(frame).not.toContain('recording');
    expect(frame).not.toMatch(/--|\bswao\s/);
    assertWidth(frame);
    stdin.write('\r');
    await settle();
    expect(onNext).toHaveBeenCalledWith({ status: 'done', summary: '2 scopes probed, 1 read-only, 1 write-capable login flagged' });
  });

  it('without a landing zone says so and continues on Enter without a probe', async () => {
    const { run, calls } = runner();
    const onNext = vi.fn();
    const { lastFrame, stdin } = render(<LzLiveProbeView {...props(workspace('name: demo\n'), onNext)} run={run} />);
    await settle();
    expect(lastFrame()).toContain('No landing zone registered yet');
    stdin.write('\r');
    await settle();
    expect(calls).toEqual([]);
    expect(onNext).toHaveBeenCalledWith({ status: 'skipped', summary: 'no landing zone to probe' });
  });

  it('a failed probe shows no output line, so a caller ARN in a driver error never reaches the frame', async () => {
    const onNext = vi.fn();
    const run: ConnectionsCliRunner = async (_args, onLine) => { onLine(`[lz live] User: ${ARN} is not authorized`); return 1; };
    const { lastFrame, stdin } = render(<LzLiveProbeView {...props(workspace(), onNext)} run={run} />);
    await settle();
    stdin.write('\r');
    await settle(150);
    expect(lastFrame()).toMatch(/\[fail\]\s+aws-demo\s+not probed \(exit 1\)/);
    expect(lastFrame()).not.toContain(ACCOUNT);
    stdin.write('\r');
    await settle();
    expect(onNext).toHaveBeenCalledWith({ status: 'done', summary: '0 scopes probed, 0 read-only, 1 landing zone not probed' });
  });

  it('#4256: "Skip this step" is the last list entry and skips the probe (was the letter S)', async () => {
    const { run, calls } = runner();
    const onNext = vi.fn();
    const { lastFrame, stdin } = render(<LzLiveProbeView {...props(workspace(), onNext)} run={run} />);
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Probe all scopes now');
    expect(frame.indexOf('Skip this step')).toBeGreaterThan(frame.indexOf('Probe all scopes now'));
    expect(frame).not.toMatch(/\bP probes|S skips/);
    stdin.write('s');
    await settle();
    expect(onNext).not.toHaveBeenCalled();
    stdin.write('\u001B[B');
    await settle();
    stdin.write('\r');
    await settle();
    expect(calls).toEqual([]);
    expect(onNext).toHaveBeenCalledWith({ status: 'skipped', summary: 'probe skipped' });
  });

  it('#4256: after the probe "Probe again" is a list entry (was the letter P named only in the step text)', async () => {
    const { run, calls } = runner();
    const onNext = vi.fn();
    const { lastFrame, stdin } = render(<LzLiveProbeView {...props(workspace(), onNext)} run={run} />);
    await settle();
    stdin.write('\r');
    await settle(150);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Continue');
    expect(frame).toContain('Probe again');
    expect(frame).not.toContain('P probes again');
    stdin.write('\u001B[B');
    await settle();
    stdin.write('\r');
    await settle(150);
    expect(calls).toHaveLength(2);
    expect(onNext).not.toHaveBeenCalled();
  });
});

describe('Policy Baseline step (#4195)', () => {
  const probe = { capabilityTags: [] as string[] };

  it('without a baseline names the GitHub folder, offers no install, and continues', async () => {
    const onNext = vi.fn();
    const { lastFrame, stdin } = render(<LzLiveBaselineView {...props(workspace(), onNext)} probe={probe} />);
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('No Client LZ Policy Baseline in wsp/inputs/catalogs/community/');
    // #4340: the exact framework folder, the target folder and the file to edit.
    expect(frame.replace(/\s+/g, '')).toContain('https://github.com/Accenture/SWAO/tree/main/community-frameworks/client-lz-policy-baseline');
    expect(frame.replace(/\s+/g, ' ')).toContain('into wsp/inputs/catalogs/community/client-lz-policy-baseline/ and set your policies in its policy-baseline.yaml');
    expect(frame).not.toMatch(/--|\bswao\s|install/);
    assertWidth(frame);
    stdin.write('\r');
    await settle();
    expect(onNext).toHaveBeenCalledWith({ status: 'kept', summary: 'no policy baseline' });
  });

  it('#4501: a framework version or name with " -- " reaches the screen normalised (no spaced double hyphen)', async () => {
    const ws = workspace(LZ, true);
    const meta = join(ws, 'wsp', 'inputs', 'catalogs', 'community', 'client-lz-policy-baseline', 'framework-meta.yaml');
    writeFileSync(meta, readFileSync(meta, 'utf-8')
      .replace('version: "1.0.0"', 'version: "2026-Q2 -- demo subset 2026-07-02"')
      .replace('name: "Client LZ Policy Baseline (German public agency default)"', 'name: "Client LZ Policy Baseline -- Live-Presentation"'));
    const { lastFrame, stdin } = render(<LzLiveBaselineView {...props(ws, vi.fn())} probe={probe} />);
    await settle();
    stdin.write('\r');
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('CLIENT_LZ_POLICY_BASELINE (2026-Q2, demo subset 2026-07-02)');
    expect(frame).not.toContain(' -- ');
  });

  it('with a valid baseline, Enter offers the frameworks per landing zone and saves landing_zones[].frameworks', async () => {
    const ws = workspace(LZ, true);
    const onNext = vi.fn();
    const { lastFrame, stdin } = render(<LzLiveBaselineView {...props(ws, onNext)} probe={probe} />);
    await settle();
    expect(lastFrame()).toContain('CLIENT_LZ_POLICY_BASELINE: valid, version 1.0.0');
    assertWidth(lastFrame() ?? '');
    stdin.write('\r');
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Frameworks for aws-demo (1 of 1)');
    expect(frame).toContain('[x] CLIENT_LZ_POLICY_BASELINE');
    assertWidth(frame);
    stdin.write('\r');
    await settle();
    expect(readLzLiveDefaults(ws).landingZones[0]?.frameworks).toEqual(['CLIENT_LZ_POLICY_BASELINE']);
    expect(onNext).toHaveBeenCalledWith({ status: 'done', summary: '1 valid baseline, frameworks set for 1 of 1 landing zone' });
  });

  it('Enter over a stored value the catalogue names differently or no longer holds leaves .swao.yml byte-identical', async () => {
    const yml = `${LZ}    frameworks:\n      - client-lz-policy-baseline\n      - GONE\n`;
    const ws = workspace(yml, true);
    const onNext = vi.fn();
    const { lastFrame, stdin } = render(<LzLiveBaselineView {...props(ws, onNext)} probe={probe} />);
    await settle();
    stdin.write('\r');
    await settle();
    expect(lastFrame()).toContain('[x] CLIENT_LZ_POLICY_BASELINE');
    expect(lastFrame()).toContain('Kept, not in the workspace catalogue: GONE');
    stdin.write('\r');
    await settle();
    expect(readFileSync(join(ws, '.swao.yml'), 'utf-8')).toBe(yml);
    expect(onNext).toHaveBeenCalledWith({ status: 'kept', summary: '1 valid baseline, frameworks set for 1 of 1 landing zone' });
  });

  it('Space deselects and the keep entry (last row, was the letter S) keeps the stored value without writing', async () => {
    const ws = workspace(LZ, true);
    const onNext = vi.fn();
    const { stdin, lastFrame } = render(<LzLiveBaselineView {...props(ws, onNext)} probe={probe} />);
    await settle();
    stdin.write('\r');
    await settle();
    stdin.write(' ');
    await settle();
    for (let i = 0; i < 12; i++) { stdin.write('\u001B[B'); await settle(); } // down to the last row: keep
    expect(lastFrame()).toContain('Keep the current frameworks and continue');
    stdin.write('\r');
    await settle();
    expect(readLzLiveDefaults(ws).landingZones[0]?.frameworks).toEqual([]);
    expect(onNext).toHaveBeenCalledWith({ status: 'kept', summary: '1 valid baseline, frameworks set for 0 of 1 landing zone' });
  });
});

describe('Org Evidence step (#4195, #4050)', () => {
  it('#4346: entering the step creates the ingestion folder (ok, created), no C key; a second entry changes nothing', async () => {
    const ws = workspace();
    const onNext = vi.fn();
    const { lastFrame, unmount } = render(<LzLiveEvidenceStep {...props(ws, onNext)} />);
    await settle();
    expect(existsSync(join(ws, 'landing-zones', 'aws-demo', 'ingestion'))).toBe(true);
    expect(lastFrame()).toMatch(/\[ok\]\s+aws-demo\s+landing-zones\/aws-demo\/ingestion\/ created/);
    expect(lastFrame()).not.toContain('C creates');
    expect(lastFrame()).not.toContain('ict_risk_management_framework.pdf'); // the naming example is in the guidance
    assertWidth(lastFrame() ?? '');
    unmount();
    writeFileSync(join(ws, 'landing-zones', 'aws-demo', 'ingestion', 'exit_strategy.pdf'), 'x');
    const again = render(<LzLiveEvidenceStep {...props(ws, vi.fn())} />);
    await settle();
    expect(again.lastFrame()).toMatch(/\[ok\]\s+aws-demo\s+landing-zones\/aws-demo\/ingestion\/ 1 document/);
    expect(readFileSync(join(ws, 'landing-zones', 'aws-demo', 'ingestion', 'exit_strategy.pdf'), 'utf-8')).toBe('x');
    again.unmount();
    rmSync(join(ws, 'landing-zones', 'aws-demo', 'ingestion', 'exit_strategy.pdf'));
    const third = render(<LzLiveEvidenceStep {...props(ws, onNext)} />);
    await settle();
    third.stdin.write('\r');
    await settle();
    expect(onNext).toHaveBeenCalledWith({ status: 'kept', summary: '0 organisational documents in 1 ingestion folder' });
  });
});
