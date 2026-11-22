// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, gate G-08: every screen at 100 and 80 columns (#4213)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 126 section 13.2 G-08 and section 10 (#4213, row TUI-14): every
// screen, step and branch renders at 100 and 80 columns with no line wider
// than the header rule and no ellipsis outside paths (section 8 rule 5: the
// ellipsis is allowed only in a middle-shortened path and in the first line
// of the collapsed guidance box).
//
// G-08a every screen file has a case here (helpers/screen-cases.tsx plus Help)
//       or a documented exemption.
// G-08b every screen at 100 and 80 columns: the first frame, the guidance box
//       expanded and collapsed again, and the frame after each key of its
//       case; width and ellipsis rule on every frame.
//
// Coverage of the rule at 100 and 80 columns (this file and the files before it):
//
//   Screens (G-08b here, every one): main menu, Setup Wizard (first step),
//     Tools, Assessment type, Application Assessment (application and
//     credentials steps), LZ Catalog Assessment (application and credentials
//     steps), LZ Live Assessment, LLM Assessment, Service Portfolio
//     Assessment, Health Check, Generate Report (application and format),
//     Publish HTML, Serve, Export BI (application, target, options), Licence
//     (menu and tier picker), Credentials (menu and pick list), Lenses, Regime
//     Selector, Update LZ Catalogue, LZ Connections, Update LLM Gateway,
//     Ingest, Support Bundle, Upgrade prompt, Chat notice, Help, and where
//     swao-premium is present Portfolio Operations, Stakeholder Challenge and
//     Generate TF.
//   Later phases, width only (their own files): run and finish screens of
//     Service (ServiceInitScreen.width.test.tsx), Export BI
//     (export-bi-run-width.test.tsx), LLM (llm-run-status.test.tsx,
//     tui-navigation-llm.test.tsx), LZ Live (lz-live-assessment-screen.test.tsx),
//     LZ Catalog steps (assess-flow-navigation.test.tsx), Portfolio and
//     Challenge phases (tui13-premium-width.test.tsx, portfolio-finish.test.tsx),
//     Generate TF (swao-premium generate-tf-screen.test.ts), LZ Connections
//     forms (lz-connections-screen.test.tsx, lz-connections-margin.test.tsx),
//     the per-screen sub-screens of tui13-screens-width.test.tsx and
//     tui13-remaining-width.test.tsx.
//   Enterprise Chat: tui13-chat-width.test.tsx (private, #3348).
//   Setup Wizard steps and branches, width and ellipsis rule (the shared
//     helpers/width-rule.ts; strict, no skip list since 2026-11-13, #4213):
//     step-width.test.tsx
//     (App, Source access, Tools, Assessed app, Test code, Init, Playwright,
//     Secondary LLM, MCP notice), generic-step-width.test.tsx (LLM,
//     Credentials, Health Check, LZ Connections, both type selections, Ready),
//     branch-step-width.test.tsx (Probe, Policy Baseline, Org Evidence, Service
//     Setup, Intake Input, Scoring Inputs), lz-catalog-rows.test.tsx (LZ Catalog
//     Catalogues and Refresh), llm-candidates-layout.test.tsx (LLM Candidates);
//     the Ready step of a branch in setup-frame.test.tsx and the MCP clients in
//     IntegrationsStep.mcp-clients.test.tsx (private) check the width only.

import { describe, it, expect, vi, afterAll } from 'vitest';
import React from 'react';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ws = vi.hoisted(() => ({ path: '' }));
vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    findWorkspace: vi.fn(() => ws.path),
    logPortfolio: vi.fn(),
    LicenseGuard: { load: vi.fn(() => ({ state: { tier: 'enterprise' as const, valid: true, remaining_assessments: 48, expiry: '2027-01-01', fingerprint: 'abc1234567890abc', licensee: 'Test User', email: 'test@test.com', firstRun: '2026-01-01', assessmentCount: 0, assessmentLimit: null, exp: undefined } })) },
  };
});
// Screens that start a CLI child get a fake: one long line (wrapped, never
// cut) and exit 0, so no real process starts.
vi.mock('child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('child_process')>();
  const { EventEmitter } = await import('node:events');
  return {
    ...original,
    spawn: vi.fn(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: { write: () => true, end: () => undefined }, kill: () => true, pid: 0 });
      setTimeout(() => {
        child.stdout.emit('data', Buffer.from(`[ok]  done: ${'the long result line of a child process wraps at the frame width '.repeat(2).trim()}\n`));
        child.emit('close', 0);
      }, 20);
      return child;
    }),
  };
});

import { headerRuleWidth } from '@swao/tui-kit';
import { REPO_ROOT, repoPath, tuiFiles } from '../../__tests__/helpers/tui-gate.js';
import { isScreenFile } from '../../__tests__/helpers/tui-gate-rules.js';
import { renderAt, widest } from '../../__tests__/helpers/render-at.js';
import { SCREEN_EXEMPT, fixtureWorkspace, screenCases, type ScreenCase } from '../../__tests__/helpers/screen-cases.js';
import { widthOffenders } from '../../__tests__/helpers/width-rule.js';
import { HelpScreen } from '../screens/HelpScreen.js';

const NL = String.fromCharCode(10);
const CTRL_G = String.fromCharCode(7);
const settle = (ms = 150): Promise<void> => new Promise((r) => setTimeout(r, ms));

ws.path = fixtureWorkspace();
afterAll(() => { if (ws.path) rmSync(ws.path, { recursive: true, force: true }); });

const HELP: ScreenCase = { name: 'Help', file: 'swao/packages/swao/src/tui/screens/HelpScreen.tsx', element: async () => <HelpScreen onBack={() => undefined} /> };
const CASES: ScreenCase[] = [...screenCases(ws.path), HELP];

describe('G-08 every screen at 100 and 80 columns (#4213, Design 126 sections 8, 10 and 13.2)', () => {
  it('the rule fails on a line past the rule and on a cut text; a path and the collapsed guidance box pass', () => {
    const wide = 'x'.repeat(headerRuleWidth(80) + 1);
    expect(widthOffenders(wide, 80)).toHaveLength(1);
    expect(widthOffenders('  Checking the gateway connector...', 100)).toHaveLength(1);
    expect(widthOffenders('  Folder: C:\\Users\\...\\apps\\shop\\wsp', 100)).toEqual([]);
    expect(widthOffenders('  run in /home/.../wsp/runs', 100)).toEqual([]);
    expect(widthOffenders('  OpenAI API key (sk-...)', 100)).toEqual([]);
    const box = (first: string): string => ['\u250c\u2500\u2510', `\u2502 ${first}`, '\u2502 The app of this...', '\u2514\u2500\u2518'].join(NL);
    expect(widthOffenders(box('Application   (Ctrl+G for guidance)'), 100)).toEqual([]);
    expect(widthOffenders(box('Application   Ctrl+G close guidance'), 100)).toHaveLength(1);
    expect(widthOffenders(box('Abort the setup?'), 100), 'another bordered panel is not exempt').toHaveLength(1);
    expect(widthOffenders(`${box('Application   (Ctrl+G for guidance)')}${NL}  Cut text...`, 100)).toHaveLength(1);
  });

  it('G-08a every screen file has a case or a documented exemption', () => {
    const covered = new Set([...CASES.map((c) => c.file), ...Object.keys(SCREEN_EXEMPT)]);
    const files = tuiFiles({ includeTuiKit: false }).filter(isScreenFile).map(repoPath);
    expect(files.filter((f) => !covered.has(f)), 'a new screen needs a case in helpers/screen-cases.tsx').toEqual([]);
    const premiumPresent = existsSync(join(REPO_ROOT, 'swao-premium', 'packages'));
    expect(CASES.filter((c) => !existsSync(join(REPO_ROOT, c.file)) && !(c.file.startsWith('swao-premium/') && !premiumPresent)).map((c) => c.file)).toEqual([]);
  });

  for (const columns of [100, 80]) {
    for (const c of CASES) {
      it(`G-08b ${c.name} at ${columns} columns`, async () => {
        const element = await c.element();
        if (!element) return; // swao-premium absent (public tree)
        const r = renderAt(element, columns, 60);
        const frames: Array<[string, string]> = [];
        await settle();
        frames.push(['first frame', r.lastFrame()]);
        r.stdin.write(CTRL_G); await settle();
        frames.push(['guidance expanded', r.lastFrame()]);
        r.stdin.write(CTRL_G); await settle();
        frames.push(['guidance toggled back', r.lastFrame()]);
        for (const [i, k] of (c.keys ?? []).entries()) {
          r.stdin.write(k); await settle();
          frames.push([`after key ${i + 1}`, r.lastFrame()]);
        }
        r.unmount();
        // Strict since 2026-11-13 (#4213 criterion 3): the picker detail column wraps
        // (`detailLines`, @swao/tui-kit components/picker.ts) and no screen cuts text.
        const offenders = frames.flatMap(([label, f]) => widthOffenders(f, columns).map((o) => `${label}: ${o}`));
        expect(offenders, `${c.name} at ${columns} columns`).toEqual([]);
        expect(widest(frames[0]![1].split(NL))).toBeGreaterThan(0);
      });
    }
  }
});
