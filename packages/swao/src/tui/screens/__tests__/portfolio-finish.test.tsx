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

// #4351, #4256 (Design 126 section 4.7): the Portfolio Operations result screen
// is on FinishPanel. Landing Zone Readiness over the picked snapshot ends with
// the snapshot and its provider, the verdict and the real run folder, What next
// as a menu, one key hint line and no hand-written "Press Enter or Escape".
// Enter on a menu entry never leaves the screen; Esc aborts to the main menu.
// The CLI child is a fake (child_process mocked); the licence is Enterprise.

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderAt, widest } from '../../../__tests__/helpers/render-at.js';

type FakeChild = { stdout: { emit: (e: string, d: Buffer) => void }; stderr: unknown; emit: (e: string, code: number) => void; args: string[] };
const child = vi.hoisted(() => ({ all: [] as FakeChild[], ws: '' }));
vi.mock('child_process', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    spawn: vi.fn((_cmd: string, args: string[]) => {
      const c = new EventEmitter() as InstanceType<typeof EventEmitter> & { stdout: InstanceType<typeof EventEmitter>; stderr: InstanceType<typeof EventEmitter>; kill: () => void; args: string[] };
      c.stdout = new EventEmitter();
      c.stderr = new EventEmitter();
      c.kill = () => undefined;
      c.args = args;
      child.all.push(c as unknown as FakeChild);
      return c;
    }),
  };
});
vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    findWorkspace: vi.fn(() => child.ws),
    logPortfolio: vi.fn(),
    LicenseGuard: { load: vi.fn(() => ({ state: { tier: 'enterprise' as const, valid: true, remaining_assessments: 48, expiry: '2027-01-01', fingerprint: 'abc1234567890abc', licensee: 'Test User', email: 'test@test.com', firstRun: '2026-01-01', assessmentCount: 0, assessmentLimit: null, exp: undefined } })) },
  };
});
import { PortfolioScreen } from '@swao/module-portfolio';

const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));
const DOWN = '\u001B[B';
const ESC = '\u001B';
const RUN = '2026-11-12T08-00-00';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); child.all.length = 0; });

function workspace(): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-portfolio-finish-'));
  dirs.push(d);
  writeFileSync(join(d, '.swao.yml'), 'name: demo\n');
  const wsp = join(d, 'apps', 'sovereign-health', 'wsp');
  mkdirSync(join(wsp, 'inputs', 'terraform'), { recursive: true });
  writeFileSync(join(wsp, 'latest-application.txt'), 'runs/2026-11-10T08-53-21');
  writeFileSync(join(wsp, 'inputs', 'terraform', 'lz-aws-snapshot.json'), JSON.stringify({ sample: true }));
  writeFileSync(join(wsp, 'inputs', 'terraform', 'lz-azure-snapshot.json'), JSON.stringify({ sample: true }));
  return d;
}

/** Menu, pick lz-azure-01, both CLI steps succeed; returns the screen on its finish phase. */
async function runLzrToFinish(columns: number, onBack: () => void) {
  child.ws = workspace();
  child.all.length = 0;
  const r = renderAt(<PortfolioScreen onBack={onBack} version="0.0.0" />, columns, 60);
  await tick();
  r.stdin.write('\r'); // Landing Zone Readiness is the first entry
  await tick();
  r.stdin.write(DOWN); // lz-aws-01, then lz-azure-01
  await tick();
  r.stdin.write('\r');
  await tick();
  expect(child.all[0]!.args.slice(-4)).toEqual(['assess', '--portfolio', '--lzr', 'lz-azure-01']);
  const summaryPath = join(child.ws, 'wsp', 'runs', RUN, 'lzr-summary.json');
  mkdirSync(join(child.ws, 'wsp', 'runs', RUN), { recursive: true });
  writeFileSync(summaryPath, JSON.stringify({ overall_verdict: 'ready', counts: { ready: 1, advisory: 0, blocked: 0, skipped: 0 }, apps: [{ app_id: 'sovereign-health', verdict: 'ready' }] }));
  child.all[0]!.stdout.emit('data', Buffer.from(`[ok]  Portfolio LZR: 1 ready, 0 advisory, 0 blocked, 0 skipped\n[ok]  Results written to ${summaryPath}\n`));
  child.all[0]!.emit('close', 0);
  await tick();
  child.all[1]!.stdout.emit('data', Buffer.from('sovereign-health  Azure  lz-azure  READY [SIM]\n'));
  child.all[1]!.emit('close', 0);
  await tick(60);
  return r;
}

describe('Portfolio Operations finish screen (#4351, #4256)', () => {
  for (const columns of [100, 80]) {
    it(`Landing Zone Readiness ends on FinishPanel at ${columns} columns`, async () => {
      const onBack = vi.fn();
      const r = await runLzrToFinish(columns, onBack);
      const lines = r.lines().map((l) => l.trimEnd());
      const text = lines.join('\n');
      expect(text).toContain('Landing Zone Readiness complete');
      expect(text).toMatch(/Snapshot\s+lz-azure-01 {2}Azure, Microsoft Azure, sample data \[SIM\]/);
      expect(text).toMatch(/Verdict\s+READY: 1 ready, 0 advisory, 0 blocked, 0 skipped/);
      expect(text).toContain(`wsp/runs/${RUN}/lzr-summary.json`);
      expect(text).toContain('What next');
      for (const entry of ['Show the report', 'Pick another snapshot', 'Back to Portfolio Operations', 'Back to main menu']) expect(text).toContain(entry);
      expect(text).not.toMatch(/Press Enter|<ts>|Enter confirm/);
      expect(text).not.toContain(' -- ');
      expect(lines.filter((l) => l.trim() === '↑↓ select   Enter open   Esc abort')).toHaveLength(1);
      expect(widest(lines)).toBeLessThanOrEqual(columns);
      r.unmount();
    });
  }

  it('Enter on Show the report opens the report without leaving; Esc returns to the finish, Esc again to the main menu', async () => {
    const onBack = vi.fn();
    const r = await runLzrToFinish(100, onBack);
    r.stdin.write('\r');
    await tick();
    expect(onBack).not.toHaveBeenCalled();
    expect(r.lastFrame()).toContain('Landing Zone Readiness report');
    expect(r.lastFrame()).toContain('READY [SIM]');
    r.stdin.write(ESC);
    await tick(80);
    expect(r.lastFrame()).toContain('What next');
    expect(onBack).not.toHaveBeenCalled();
    r.stdin.write(ESC);
    await tick(80);
    expect(onBack).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it('Pick another snapshot returns to the picker; Back to Portfolio Operations returns to the menu', async () => {
    const onBack = vi.fn();
    const r = await runLzrToFinish(100, onBack);
    r.stdin.write(DOWN);
    await tick();
    r.stdin.write('\r');
    await tick();
    expect(r.lastFrame()).toContain('Pick the landing zone snapshot to evaluate');
    expect(onBack).not.toHaveBeenCalled();
    r.unmount();
    const r2 = await runLzrToFinish(100, onBack);
    r2.stdin.write(DOWN);
    await tick();
    r2.stdin.write(DOWN);
    await tick();
    r2.stdin.write('\r');
    await tick();
    expect(r2.lastFrame()).toContain('Application portfolio');
    expect(onBack).not.toHaveBeenCalled();
    r2.unmount();
  });
});
