// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, Export BI run view at 100 and 80 columns (#4256)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4256 criterion 5 (Design 126 sections 3, 7.6 and 10): the running view of
// Export BI (RunPanel) stays within the header rule at 100 and 80 columns,
// its only key hint is "Esc cancel" directly above the guidance box, and Esc
// cancels the short export at once, back to the Export options step. The export child is a mocked spawn
// that never closes, so the view stays on the run.
//
// W-01 every line within headerRuleWidth(columns)
// W-02 the key hint line sits directly above the guidance box border

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ ws: '', spawned: [] as string[][], finish: false, partial: false }));

vi.mock('child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('child_process')>();
  return {
    ...original,
    spawn: vi.fn((_cmd: string, args: string[]) => {
      state.spawned.push(args);
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; pid: undefined; kill: () => void };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.pid = undefined;
      child.kill = () => {};
      // One line of output, then the export keeps running (or, for the finish
      // test, writes the bundle lines of the real export and closes with 0).
      setTimeout(() => child.stdout.emit('data', Buffer.from('[info] Building the star schema for demo\n')), 10);
      // #4498: the star schema is written, the export goes on with the NDJSON mirror.
      if (state.partial) setTimeout(() => child.stdout.emit('data', Buffer.from('[ok] Star CSV bundle written -> star/ (22 files)' + String.fromCharCode(10))), 30);
      if (state.finish) {
        const dir = `${state.ws}/apps/demo/wsp/exports/2026-11-12T10-00-00Z/star`;
        setTimeout(() => {
          child.stdout.emit('data', Buffer.from(`[ok] Star CSV bundle written -> ${dir}/ (22 files)\n[ok] PowerBI template ready -> ${state.ws}/apps/demo/wsp/exports/swao-report.pbit\n`));
          child.emit('close', 0);
        }, 40);
      }
      return child;
    }),
  };
});

vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    findWorkspace: vi.fn(() => state.ws),
    setWorkspaceRoot: vi.fn(),
    logApp: vi.fn(),
    LicenseGuard: {
      load: vi.fn(() => ({
        state: {
          tier: 'consultant' as const, valid: true, remaining_assessments: 48, expiry: '2027-01-01',
          fingerprint: 'abc1234567890abc', licensee: 'Test User', email: 'test@test.com',
          firstRun: '2026-01-01', assessmentCount: 0, assessmentLimit: null, exp: undefined,
        },
      })),
    },
  };
});

import { headerRuleWidth, formatKeyHints, RUN_PANEL_KEYS } from '@swao/tui-kit';
import { ExportBiScreen } from '@swao/module-powerbi';
import { renderAt, widest } from '../../../__tests__/helpers/render-at.js';

const ENTER = '\r';
const ESC = '\u001B';
const NL = String.fromCharCode(10);

async function waitFor(get: () => string, text: string, timeoutMs = 4000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!get().includes(text)) {
    if (Date.now() > end) throw new Error(`timed out waiting for "${text}"; last frame:${NL}${get()}`);
    await new Promise<void>((r) => setTimeout(r, 20));
  }
  // The key handlers of the new view register in an effect after the paint.
  await new Promise<void>((r) => setTimeout(r, 50));
}

beforeAll(() => {
  state.ws = mkdtempSync(join(tmpdir(), 'swao-export-bi-run-'));
  writeFileSync(join(state.ws, '.swao.yml'), 'workspace:\n  name: demo\n');
  mkdirSync(join(state.ws, 'apps', 'demo', 'wsp'), { recursive: true });
  writeFileSync(join(state.ws, 'apps', 'demo', 'wsp', 'latest-application.txt'), '2026-11-12T10-00-00Z\n');
});

afterAll(() => {
  rmSync(state.ws, { recursive: true, force: true });
});

describe('Export BI run view at 100 and 80 columns (#4256 criterion 5)', () => {
  for (const columns of [100, 80]) {
    it(`W-01 and W-02 the running export at ${columns} columns; Esc cancels`, async () => {
      const onBack = vi.fn();
      const r = renderAt(<ExportBiScreen onBack={onBack} version="0.0.0" />, columns, 60);
      const text = (): string => r.lines().map((l) => l.trimEnd()).join(NL);
      await waitFor(text, '❯ demo');
      r.stdin.write(ENTER); // the app
      await waitFor(text, 'Export options');
      r.stdin.write(ENTER); // export now
      await waitFor(text, 'Esc cancel');
      await waitFor(text, 'Building the star schema');
      expect(state.spawned.at(-1)).toEqual(expect.arrayContaining(['export', '--app', 'demo']));
      const lines = r.lines().map((l) => l.trimEnd());
      expect(widest(lines)).toBeLessThanOrEqual(headerRuleWidth(columns));
      const hintIdx = lines.findIndex((l) => l.includes(formatKeyHints(RUN_PANEL_KEYS)));
      expect(hintIdx).toBeGreaterThanOrEqual(0);
      expect(lines[hintIdx + 1]?.trimStart().startsWith('┌')).toBe(true);
      // Design 126 section 7.6: the export is short, so Esc cancels at once
      // (RunPanel confirmCancel false) and returns to the step that started it.
      r.stdin.write(ESC);
      await waitFor(text, 'Export options');
      expect(text()).not.toContain('Esc cancel');
      expect(widest(r.lines().map((l) => l.trimEnd()))).toBeLessThanOrEqual(headerRuleWidth(columns));
      expect(onBack).not.toHaveBeenCalled();
      r.unmount();
    });
  }
});

describe('Export BI finish pages at 100 and 80 columns (#4256 criterion 5)', () => {
  for (const columns of [100, 80]) {
    it(`W-01 and W-02 the summary and the PowerBI page at ${columns} columns`, async () => {
      state.finish = true;
      try {
        const r = renderAt(<ExportBiScreen onBack={vi.fn()} version="0.0.0" />, columns, 60);
        const text = (): string => r.lines().map((l) => l.trimEnd()).join(NL);
        await waitFor(text, '❯ demo');
        r.stdin.write(ENTER);
        await waitFor(text, 'Export options');
        r.stdin.write(ENTER);
        await waitFor(text, 'BI export complete');
        for (const page of ['summary', 'powerbi']) {
          const lines = r.lines().map((l) => l.trimEnd());
          expect(widest(lines), page).toBeLessThanOrEqual(headerRuleWidth(columns));
          const hintIdx = lines.findIndex((l) => l.includes('Esc'));
          expect(hintIdx, page).toBeGreaterThanOrEqual(0);
          expect(lines[hintIdx + 1]?.trimStart().startsWith('┌'), page).toBe(true);
          if (page === 'summary') {
            r.stdin.write(ENTER);
            await waitFor(text, 'Copy SWAOWorkspaceRoot');
          }
        }
        r.unmount();
      } finally {
        state.finish = false;
      }
    });
  }
});

describe('Export BI Stage bar moves per written part (#4498)', () => {
  it('after the star schema the run shows stage 2 of 3 and names the NDJSON mirror', async () => {
    state.partial = true;
    try {
      const r = renderAt(<ExportBiScreen onBack={vi.fn()} version="0.0.0" />, 100, 60);
      const text = (): string => r.lines().map((l) => l.trimEnd()).join(NL);
      await waitFor(text, '❯ demo');
      r.stdin.write(ENTER);
      await waitFor(text, 'Export options');
      r.stdin.write(ENTER);
      await waitFor(text, 'Writing the NDJSON mirror');
      expect(text()).toContain('Stage 2 of 3');
      expect(text()).not.toContain('Stage 1 of 1');
      expect(r.lines().filter((l) => l.includes(formatKeyHints(RUN_PANEL_KEYS)))).toHaveLength(1);
      r.unmount();
    } finally {
      state.partial = false;
    }
  });
});
