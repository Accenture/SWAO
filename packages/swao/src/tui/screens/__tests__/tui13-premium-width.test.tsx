// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, TUI-13 Portfolio Operations and Stakeholder Challenge at 100 and 80 columns (#4257)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4257 (TUI-13, Design 126 sections 3, 7.9 and 10), run 7: Portfolio
// Operations and the Stakeholder Challenge (swao-premium) on ScreenLayout.
//
// PW-01 every phase within headerRuleWidth(columns), guidance collapsed and expanded
// PW-02 the key hint line of the phase sits directly above the guidance box border
// PW-03 no dash punctuation on screen
//
// The screens live in the private premium tree; the tests are skipped where it
// is absent. The CLI child is a fake (child_process mocked); the licence is Enterprise.

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import React from 'react';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PREMIUM = join(dirname(fileURLToPath(import.meta.url)), '../../../../../../../swao-premium/packages/@swao');
const PREMIUM_PRESENT = existsSync(join(PREMIUM, 'module-portfolio/src/tui/PortfolioScreen.tsx')) && existsSync(join(PREMIUM, 'module-challenge/src/tui/ChallengeScreen.tsx'));

const ws = vi.hoisted(() => ({ path: '' }));
vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    findWorkspace: vi.fn(() => ws.path),
    logPortfolio: vi.fn(),
    credentialStore: { get: vi.fn(async () => null) },
    LicenseGuard: { load: vi.fn(() => ({ state: { tier: 'enterprise' as const, valid: true, remaining_assessments: 48, expiry: '2027-01-01', fingerprint: 'abc1234567890abc', licensee: 'Test User', email: 'test@test.com', firstRun: '2026-01-01', assessmentCount: 0, assessmentLimit: null, exp: undefined } })) },
  };
});

type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
const children = vi.hoisted(() => [] as unknown[]);
vi.mock('child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('child_process')>();
  const { EventEmitter: EE } = await import('node:events');
  return {
    ...original,
    spawn: vi.fn(() => {
      const c = Object.assign(new EE(), { stdout: new EE(), stderr: new EE(), kill: () => undefined });
      children.push(c);
      return c;
    }),
  };
});

import { headerRuleWidth, formatKeyHints } from '@swao/tui-kit';
import { renderAt, widest, type RenderedAt } from '../../../__tests__/helpers/render-at.js';

const NL = String.fromCharCode(10);
const DASHES = new RegExp(`[${String.fromCharCode(0x2014)}${String.fromCharCode(0x2013)}]|\\s--\\s`);
const ESC = '\u001B';
const settle = (ms = 120): Promise<void> => new Promise((r) => setTimeout(r, ms));
const lastChild = (): FakeChild => children[children.length - 1] as FakeChild;

const tmp: string[] = [];
afterAll(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** One assessed app with a sample snapshot and one registered landing zone with a live run. */
function workspace(): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-tui13-premium-'));
  tmp.push(d);
  writeFileSync(join(d, '.swao.yml'), ['name: demo', 'landing_zones:', '  - id: otc-test', '    provider: otc', ''].join(NL));
  const wsp = join(d, 'apps', 'sovereign-health', 'wsp');
  mkdirSync(join(wsp, 'inputs', 'terraform'), { recursive: true });
  writeFileSync(join(wsp, 'latest-application.txt'), 'runs/2026-11-10T08-53-21');
  writeFileSync(join(wsp, 'latest.txt'), 'runs/2026-11-10T08-53-21');
  writeFileSync(join(wsp, 'inputs', 'terraform', 'lz-aws-snapshot.json'), JSON.stringify({ sample: true }));
  mkdirSync(join(d, 'landing-zones', 'otc-test', 'wsp', 'runs', '2026-11-08T10-00-00'), { recursive: true });
  return d;
}

/** PW-01 to PW-03 on the current frame: width, hints above the box, no dashes; then the expanded box. */
async function checkFrame(r: RenderedAt, columns: number, hints: string): Promise<void> {
  const collapsed = r.lines().map((l) => l.trimEnd());
  expect(widest(collapsed)).toBeLessThanOrEqual(headerRuleWidth(columns));
  const hintIdx = collapsed.findIndex((l) => l.trim() === hints);
  expect(hintIdx, `hint line "${hints}" in${NL}${collapsed.join(NL)}`).toBeGreaterThanOrEqual(0);
  expect(collapsed[hintIdx + 1]?.trimStart().startsWith('┌')).toBe(true);
  expect(collapsed.join(NL)).not.toMatch(DASHES);
  r.stdin.write('\x07');
  await settle();
  const expanded = r.lines().map((l) => l.trimEnd());
  expect(widest(expanded)).toBeLessThanOrEqual(headerRuleWidth(columns));
  expect(expanded.join(NL)).toContain('Ctrl+G close guidance');
  expect(expanded.join(NL)).not.toMatch(DASHES);
  r.stdin.write('\x07');
  await settle();
}

beforeEach(() => { children.length = 0; ws.path = workspace(); });

describe('TUI-13 Portfolio Operations at 100 and 80 columns (#4257, run 7)', () => {
  for (const columns of [100, 80]) {
    it.skipIf(!PREMIUM_PRESENT)(`PW menu, snapshot picker, simulated question, run and failure at ${columns} columns`, async () => {
      const { PortfolioScreen } = await import('@swao/module-portfolio');
      const onBack = vi.fn();
      const first = renderAt(<PortfolioScreen onBack={onBack} version="0.0.0" />, columns, 60);
      await settle();
      expect(first.lastFrame()).toContain('Application portfolio');
      expect(first.lastFrame()).toContain('1  Landing Zone Readiness');
      await checkFrame(first, columns, '↑↓ select   Enter open   Esc back');
      first.stdin.write('1');
      await settle();
      expect(first.lastFrame()).toContain('Pick the landing zone snapshot to evaluate');
      await checkFrame(first, columns, '↑↓ select   Enter next   Esc back');
      // Esc on the snapshot picker leaves the screen, as before the layout change.
      first.stdin.write(ESC);
      await settle();
      expect(onBack).toHaveBeenCalledTimes(1);
      first.unmount();
      const r = renderAt(<PortfolioScreen onBack={vi.fn()} version="0.0.0" />, columns, 60);
      await settle();
      r.stdin.write('4');
      await settle();
      expect(r.lastFrame()).toContain('n  No, merge the real runs only');
      expect(r.lastFrame()).toContain('y  Yes, include the simulated runs');
      await checkFrame(r, columns, '↑↓ select   Enter confirm   Esc back');
      r.stdin.write('\r');
      await settle();
      expect(children).toHaveLength(1);
      lastChild().stdout.emit('data', Buffer.from(`[swao assess] Merging the live runs of ${'otc-test '.repeat(12)}\n`));
      await settle();
      await checkFrame(r, columns, 'Esc cancel');
      lastChild().stderr.emit('data', Buffer.from('[error] assess.error Merge failed: no live run could be read from the landing zone folder\n'));
      lastChild().emit('close', 1);
      await settle();
      expect(r.lastFrame()).toContain('Merge live runs failed');
      await checkFrame(r, columns, '↑↓ select   Enter open   Esc abort');
      r.unmount();
    });

    it.skipIf(!PREMIUM_PRESENT)(`PW export summary and PowerBI page at ${columns} columns`, async () => {
      const { PortfolioScreen } = await import('@swao/module-portfolio');
      const onBack = vi.fn();
      const r = renderAt(<PortfolioScreen onBack={onBack} version="0.0.0" />, columns, 60);
      await settle();
      r.stdin.write('3');
      await settle();
      const bundle = join(ws.path, 'wsp', 'exports', '2026-11-13T08-00-00', 'star');
      lastChild().stdout.emit('data', Buffer.from(`[ok]  Portfolio export written  ->  ${bundle}  (1 app(s), CSV + NDJSON + XLSX, 120 rows total)\n[ok]  PowerBI template ready  ->  ${join(ws.path, 'wsp', 'exports', 'swao-portfolio.pbit')}\n`));
      lastChild().emit('close', 0);
      await settle();
      expect(r.lastFrame()).toContain('Portfolio export complete');
      await checkFrame(r, columns, 'Enter next   Esc back');
      r.stdin.write('\r');
      await settle();
      const frame = r.lastFrame();
      expect(frame).toContain('p  Open the portfolio template');
      expect(frame).toContain('c  Copy SWAOWorkspaceRoot');
      expect(frame).toContain('0  Back to main menu');
      expect(frame).not.toMatch(/Press |Escape/);
      await checkFrame(r, columns, '↑↓ select   Enter open   Esc back');
      r.stdin.write('\r'); // the cursor starts on Back to main menu, as Enter returned before
      await settle();
      expect(onBack).toHaveBeenCalledTimes(1);
      r.unmount();
    });
  }
});

describe('TUI-13 Stakeholder Challenge at 100 and 80 columns (#4257, run 7)', () => {
  for (const columns of [100, 80]) {
    it.skipIf(!PREMIUM_PRESENT)(`PW application, agents, output file, run and failure at ${columns} columns`, async () => {
      const { ChallengeScreen } = await import('@swao/module-challenge');
      const r = renderAt(<ChallengeScreen onBack={vi.fn()} onComplete={vi.fn()} version="0.0.0" />, columns, 60);
      await settle();
      expect(r.lastFrame()).toContain('sovereign-health');
      await checkFrame(r, columns, '↑↓ select   Enter next   Esc back');
      r.stdin.write('\r');
      await settle();
      const agents = r.lastFrame();
      expect(agents).toContain('Application Architect');
      expect(agents).toContain('architecture fitness of the plan');
      await checkFrame(r, columns, '↑↓ select   Space toggle   A toggle all   Enter next   Esc back');
      r.stdin.write('\r');
      await settle();
      expect(r.lastFrame()).toContain('Output file path (optional)');
      await checkFrame(r, columns, 'Enter next   Esc back');
      r.stdin.write('\r');
      await settle(250);
      expect(children).toHaveLength(1);
      lastChild().stdout.emit('data', Buffer.from(`[swao challenge] Application Architect reviewing ${'the migration plan '.repeat(8)}\n`));
      await settle();
      expect(r.lastFrame()).toContain('Running the Stakeholder Challenge');
      await checkFrame(r, columns, 'Esc cancel');
      lastChild().emit('close', 1);
      await settle();
      expect(r.lastFrame()).toContain('Stakeholder Challenge failed');
      await checkFrame(r, columns, formatKeyHints([{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'open' }, { key: 'Esc', verb: 'abort' }]));
      r.unmount();
    });
  }
});
