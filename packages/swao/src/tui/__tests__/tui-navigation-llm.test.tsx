// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, gate G-09: navigation of the LLM Assessment flow (#4255)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 126 section 13.2 G-09 and section 7, the LLM Assessment case
// (#4255, #4257): the screen renders one ScreenLayout (section 3 order, the
// key hints directly above the guidance box, within the header rule at 100
// and 80 columns); Esc on the first step leaves at once; after an application
// is chosen Esc asks (AbortDialog), Esc stays, Enter aborts; the left arrow
// goes back with the values kept; Esc closes an open guidance box first, also
// right after a stage change; removing a provider is a list entry.
// Kept apart from tui-navigation-flows.test.tsx because the module mocks
// (precondition, connectors) are file-wide.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    credentialStore: { ...original.credentialStore, loadSync: vi.fn(() => ({})) },
    LicenseGuard: {
      load: vi.fn(() => ({
        state: {
          tier: 'consultant' as const, valid: true, remaining_assessments: 500, expiry: '2027-01-01',
          fingerprint: 'abc1234567890abc', licensee: 'Test User', email: 'test@test.com',
          firstRun: '2026-01-01', assessmentCount: 0, assessmentLimit: null, exp: undefined,
        },
      })),
    },
  };
});

vi.mock('@swao/module-llm-assessment', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/module-llm-assessment')>();
  return {
    ...original,
    checkAppAssessmentPrecondition: vi.fn(() => ({ ok: true, latestRun: { runTs: '2026-11-12T10-00-00', passCount: 12, finishedAt: '2026-11-12T10:20:00Z' }, applicationRuns: [{}] })),
    orchestrateLegs: vi.fn(),
  };
});

function connector(id: string, name: string) {
  return {
    path: `/ws/wsp/inputs/llm-gateway/${id}.yaml`,
    origin: 'workspace' as const,
    file: { connector: { id, name, auth: { credential_key: '' }, models: { default: `${id}-default`, catalogue: [] } } },
  };
}

vi.mock('@swao/module-llm-providers', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/module-llm-providers')>();
  return {
    ...original,
    listConnectors: vi.fn(() => ({ connectors: [connector('alpha', 'Alpha Gateway'), connector('beta', 'Beta Gateway')], warnings: [] })),
  };
});

import { headerRuleWidth, formatKeyHints, KEY_HINTS } from '@swao/tui-kit';
import { LlmAssessmentScreen } from '../screens/LlmAssessmentScreen.js';
import { renderAt, widest, type RenderedAt } from '../../__tests__/helpers/render-at.js';

const KEY = { enter: '\r', esc: '\u001B', left: '\u001B[D', down: '\u001B[B', ctrlG: '\u0007' } as const;
const NL = String.fromCharCode(10);

let ws = '';
beforeAll(() => {
  ws = mkdtempSync(join(tmpdir(), 'swao-llm-nav-'));
  writeFileSync(join(ws, '.swao.yml'), 'workspace:\n  name: demo\n');
  mkdirSync(join(ws, 'apps', 'demo'), { recursive: true });
});
afterAll(() => { rmSync(ws, { recursive: true, force: true }); });

function text(r: RenderedAt): string {
  return r.lines().map((l) => l.trimEnd()).join(NL);
}

async function waitFor(r: RenderedAt, pred: (t: string) => boolean, what: string, timeoutMs = 4000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!pred(text(r))) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}; last frame:${NL}${text(r)}`);
    await new Promise<void>((res) => setTimeout(res, 20));
  }
  // The key handlers of the new frame register in an effect after the paint.
  await new Promise<void>((res) => setTimeout(res, 50));
}

async function press(r: RenderedAt, key: string): Promise<void> {
  r.stdin.write(key);
  await new Promise<void>((res) => setTimeout(res, 40));
}

const onPicker = (t: string): boolean => t.includes('Select application to assess');
const onProviders = (t: string): boolean => t.includes('Select connector for LLM Provider 1');

describe('G-09 LLM Assessment flow (#4255, Design 126 section 13.2)', () => {
  it('Esc on the application step leaves at once', async () => {
    const onBack = vi.fn();
    const r = renderAt(<LlmAssessmentScreen workspacePath={ws} onBack={onBack} />, 100, 60);
    await waitFor(r, onPicker, 'the app picker');
    await press(r, KEY.esc);
    expect(onBack).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it('after the application Esc asks; Esc stays; the left arrow goes back; Enter on the dialog aborts', async () => {
    const onBack = vi.fn();
    const r = renderAt(<LlmAssessmentScreen workspacePath={ws} onBack={onBack} />, 100, 60);
    await waitFor(r, onPicker, 'the app picker');
    await press(r, KEY.enter);
    await waitFor(r, onProviders, 'the provider step');
    await press(r, KEY.esc);
    await waitFor(r, (t) => t.includes('Abort the assessment?'), 'the AbortDialog');
    expect(text(r)).toContain(formatKeyHints(KEY_HINTS.abortDialog));
    await press(r, KEY.esc);
    await waitFor(r, onProviders, 'the provider step again');
    expect(onBack).not.toHaveBeenCalled();
    await press(r, KEY.left);
    await waitFor(r, onPicker, 'the app picker after back');
    await press(r, KEY.enter);
    await waitFor(r, onProviders, 'the provider step');
    await press(r, KEY.esc);
    await waitFor(r, (t) => t.includes('Abort the assessment?'), 'the AbortDialog');
    await press(r, KEY.enter);
    expect(onBack).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it('Esc closes an open guidance box first, also on the stage after a stage change', async () => {
    const onBack = vi.fn();
    const r = renderAt(<LlmAssessmentScreen workspacePath={ws} onBack={onBack} />, 100, 60);
    await waitFor(r, onPicker, 'the app picker');
    await press(r, KEY.ctrlG);
    await waitFor(r, (t) => t.includes('Ctrl+G close guidance'), 'the open box');
    await press(r, KEY.enter); // Enter still selects with the box open (section 7.8)
    await waitFor(r, onProviders, 'the provider step');
    // The new stage starts with the box collapsed, so Esc is the flow's: the dialog asks.
    expect(text(r)).not.toContain('Ctrl+G close guidance');
    await press(r, KEY.esc);
    await waitFor(r, (t) => t.includes('Abort the assessment?'), 'the AbortDialog');
    await press(r, KEY.esc);
    await waitFor(r, onProviders, 'the provider step again');
    await press(r, KEY.ctrlG);
    await waitFor(r, (t) => t.includes('Ctrl+G close guidance'), 'the open box');
    await press(r, KEY.esc);
    await waitFor(r, (t) => !t.includes('Ctrl+G close guidance'), 'the box closed');
    expect(text(r)).not.toContain('Abort the assessment?');
    expect(onBack).not.toHaveBeenCalled();
    r.unmount();
  });

  it('a provider is removed with the list entry "Remove the last LLM Provider"; the left arrow keeps the list', async () => {
    // A workspace whose LLM setup stores two candidates: the provider step starts with both.
    const ws2 = mkdtempSync(join(tmpdir(), 'swao-llm-nav-legs-'));
    try {
      writeFileSync(join(ws2, '.swao.yml'), ['workspace:', '  name: demo', 'assessment:', '  llm:', '    candidates:', '      - connector: alpha', '      - connector: beta', ''].join(NL));
      mkdirSync(join(ws2, 'apps', 'demo'), { recursive: true });
      const r = renderAt(<LlmAssessmentScreen workspacePath={ws2} onBack={vi.fn()} />, 100, 60);
      await waitFor(r, onPicker, 'the app picker');
      await press(r, KEY.enter);
      await waitFor(r, (t) => t.includes('LLM Providers (2/5)'), 'the provider step with two providers');
      expect(text(r)).toContain('Remove the last LLM Provider');
      await press(r, KEY.down);
      await press(r, KEY.down);
      await waitFor(r, (t) => t.includes('Remove the last LLM Provider   (Ctrl+G'), 'the remove entry highlighted (the box follows it)');
      await press(r, KEY.enter);
      await waitFor(r, (t) => t.includes('LLM Providers (1/5)'), 'one provider left');
      expect(text(r)).toContain('alpha / alpha-default');
      expect(text(r)).not.toContain('beta / beta-default');
      // The left arrow goes back to the application step.
      await press(r, KEY.left);
      await waitFor(r, onPicker, 'the app picker');
      // Section 7.2: back keeps the values; the same application again shows the kept list.
      await press(r, KEY.enter);
      await waitFor(r, (t) => t.includes('LLM Providers (1/5)'), 'the kept provider list');
      expect(text(r)).not.toContain('beta / beta-default');
      r.unmount();
    } finally {
      rmSync(ws2, { recursive: true, force: true });
    }
  });
});

describe('W-01 and W-02 the LLM Assessment on ScreenLayout (#4257)', () => {
  for (const columns of [100, 80]) {
    it(`app picker and provider step at ${columns} columns`, async () => {
      const r = renderAt(<LlmAssessmentScreen workspacePath={ws} onBack={vi.fn()} />, columns, 60);
      await waitFor(r, onPicker, 'the app picker');
      for (const step of ['picker', 'providers']) {
        const lines = r.lines().map((l) => l.trimEnd());
        expect(widest(lines), step).toBeLessThanOrEqual(headerRuleWidth(columns));
        const hints = step === 'picker' ? '↑↓ select   Type filter   Enter next   Esc abort' : formatKeyHints(KEY_HINTS.picker);
        const idx = lines.findIndex((l) => l.includes(hints));
        expect(idx, step).toBeGreaterThanOrEqual(0);
        expect(lines[idx + 1]?.trimStart().startsWith('┌'), step).toBe(true);
        // Section 3: header, licence line, step bar, then the content.
        const order = [
          lines.findIndex((l) => l.startsWith('S W A O')),
          lines.findIndex((l) => l.includes('Consultant Edition')),
          lines.findIndex((l) => l.includes('LLM Providers') && l.includes('Review')),
        ];
        for (const i of order) expect(i, step).toBeGreaterThanOrEqual(0);
        expect([...order].sort((a, b) => a - b), step).toEqual(order);
        if (step === 'picker') {
          await press(r, KEY.enter);
          await waitFor(r, onProviders, 'the provider step');
        }
      }
      r.unmount();
    });
  }
});

// #4255 A-22 to A-26 (Design 126 Appendix A, the LLM "Select Application" screen):
// the guidance box fits the window, one colon on the label, no double hyphen,
// keys on the KeyHints line, the CLI in the box's CLI field, not in the body.
describe('LLM app picker, Appendix A rows A-22 to A-26 (#4255)', () => {
  it('in a 24-row window the guidance box stays whole (it stays collapsed when the open box would not fit)', async () => {
    const r = renderAt(<LlmAssessmentScreen workspacePath={ws} onBack={vi.fn()} />, 100, 24);
    await waitFor(r, onPicker, 'the app picker');
    const collapsed = text(r);
    expect(collapsed).toContain('Select application to assess:');
    expect(collapsed).not.toContain('assess::');
    expect(collapsed).not.toMatch(/ -- /);
    expect(collapsed).toContain('↑↓ select   Type filter   Enter next   Esc abort');
    await press(r, KEY.ctrlG);
    await press(r, KEY.down); // a key after the toggle, so the frame has settled
    const lines = r.lines().map((l) => l.trimEnd()).filter((l) => l !== '');
    expect(lines.length).toBeLessThanOrEqual(23);
    expect(lines[lines.length - 1]?.trimStart().startsWith('└')).toBe(true);
    r.unmount();
  });

  it('with room the box opens: sections on their own rows, the command on the CLI line only', async () => {
    const r = renderAt(<LlmAssessmentScreen workspacePath={ws} onBack={vi.fn()} />, 100, 60);
    await waitFor(r, onPicker, 'the app picker');
    await press(r, KEY.ctrlG);
    await waitFor(r, (t) => t.includes('Ctrl+G close guidance'), 'the open box');
    const lines = r.lines().map((l) => l.trimEnd());
    expect(lines.join(NL)).not.toMatch(/ -- /);
    const cmd = lines.filter((l) => l.includes('swao assess'));
    expect(cmd.length).toBeGreaterThan(0);
    for (const l of cmd) expect(l).toMatch(/CLI/);
    r.unmount();
  });
});
