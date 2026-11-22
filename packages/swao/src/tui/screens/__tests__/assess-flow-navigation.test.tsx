// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, G-09 cases of the Application and LZ Catalog flows
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4255 (TUI-11, Design 126 sections 4.4, 4.5, 7.2, 7.4 and 7.10): the
// Application and LZ Catalog flows render the step bar and the licence line,
// Esc aborts the flow (AbortDialog once an app is chosen, Esc stays, Enter
// aborts), the left arrow and Shift+Tab go back one step, the credential list
// entries replace the letter keys and the delete confirmation is a ConfirmPanel.

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const wsRef = vi.hoisted(() => ({ path: '' }));

vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    findWorkspace: vi.fn(() => wsRef.path),
    LicenseGuard: {
      load: vi.fn(() => ({
        state: {
          tier: 'community' as const, valid: true, remaining_assessments: 48, expiry: '2027-01-01',
          fingerprint: 'abc1234567890abc', licensee: 'Test User', email: 'test@test.com',
          firstRun: '2026-01-01', assessmentCount: 0, assessmentLimit: null, exp: undefined,
        },
      })),
    },
    CredentialStore: class {
      loadSync(): Record<string, string> { return {}; }
      set(_n: string, _v: string): Promise<void> { return Promise.resolve(); }
    },
    logApp: vi.fn(),
    openWithDefaultApp: vi.fn(),
    copyToClipboard: vi.fn(() => Promise.resolve()),
    findInstalledChromium: vi.fn(() => '/mock/chromium'),
  };
});

import { AppAssessmentScreen, AssessmentTypeScreen, LzAssessmentScreen } from '@swao/module-app-assessment';
import { headerRuleWidth } from '@swao/tui-kit';
import { renderAt, widest } from '../../../__tests__/helpers/render-at.js';

const ESC = '\u001B';
const LEFT = '\u001B[D';
const DOWN = '\u001B[B';
const SHIFT_TAB = '\u001B[Z';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** #4484: the app picker draws "Loading apps" first; wait until the apps are listed. */
async function appsListed(lastFrame: () => string | undefined): Promise<string> {
  const ok = (): boolean => { const f = lastFrame() ?? ''; return f.includes('Select app to assess') && !f.includes('Loading apps'); };
  for (let i = 0; i < 100 && !ok(); i++) await new Promise<void>((r) => setTimeout(r, 50));
  await new Promise<void>((r) => setTimeout(r, 50));
  return lastFrame() ?? '';
}

async function pressKey(stdin: { write: (s: string) => void }, key: string): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 80));
  stdin.write(key);
  await new Promise<void>((r) => setTimeout(r, 80));
}

/** Waits until the frame shows `text` (frames lag under a loaded test run). */
async function frameWith(lastFrame: () => string | undefined, text: string): Promise<string> {
  for (let i = 0; i < 60 && !(lastFrame() ?? '').includes(text); i++) await new Promise<void>((r) => setTimeout(r, 50));
  return lastFrame() ?? '';
}

function workspace(apps: readonly string[] = ['sovereign-health']): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-assess-flow-'));
  tmp.push(ws);
  writeFileSync(join(ws, '.swao.yml'), 'name: demo\n');
  for (const id of apps) {
    mkdirSync(join(ws, 'apps', id), { recursive: true });
    writeFileSync(join(ws, 'apps', id, '.swao.yml'), 'source:\n  path: ./src\n');
  }
  return ws;
}

const region = (id: string, country: string) => ({ id, display: id, country, label: `${id} - ${country}` });
function scaffold() {
  return {
    imports: vi.fn(), ingestion: vi.fn(), source: vi.fn(), landingZoneStubs: vi.fn(),
    appYmlTemplate: vi.fn(() => ''), lenses: [],
    lzCatalogueHint: { entries: [{ provider: 'azure', name: 'Azure', label: 'azure - Azure', regions: [region('germanywestcentral', 'DE')] }] },
  };
}

describe('G-09 LZ Catalog flow (#4255)', () => {
  it('step bar and licence line; Esc on a chosen app asks, Esc stays, the left arrow goes back, Enter on the dialog aborts', async () => {
    wsRef.path = workspace();
    const onBack = vi.fn();
    const { lastFrame, stdin } = render(<LzAssessmentScreen onBack={onBack} version="0.0.0-test" scaffold={scaffold()} />);
    const picker = await appsListed(lastFrame);
    expect(picker).toContain('Providers');
    expect(picker).toContain('Regions');
    await pressKey(stdin, '\r'); // the app
    const creds = await frameWith(lastFrame, 'Credentials for this app');
    // Section 7.10: list entries instead of the letter keys R, A and L.
    expect(creds).toContain('Continue');
    expect(creds).toContain('Repository URL');
    expect(creds).toContain('LLM provider for this run');
    expect(creds).toContain('Esc abort');
    expect(creds).not.toMatch(/ -- |\|/);
    await pressKey(stdin, ESC);
    expect(await frameWith(lastFrame, 'Abort the assessment?')).toContain('Enter abort');
    await pressKey(stdin, ESC); // stay
    expect(await frameWith(lastFrame, 'Credentials for this app')).not.toContain('Abort the assessment?');
    expect(onBack).not.toHaveBeenCalled();
    await pressKey(stdin, LEFT); // back to the app picker
    expect(await appsListed(lastFrame)).toContain('Select app to assess');
    await pressKey(stdin, '\r');
    await frameWith(lastFrame, 'Credentials for this app');
    await pressKey(stdin, ESC);
    await frameWith(lastFrame, 'Abort the assessment?');
    await pressKey(stdin, '\r');
    expect(onBack).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('Esc on the first step leaves at once (nothing chosen)', async () => {
    wsRef.path = workspace();
    const onBack = vi.fn();
    const { lastFrame, stdin } = render(<LzAssessmentScreen onBack={onBack} version="0.0.0-test" scaffold={scaffold()} />);
    await appsListed(lastFrame);
    await pressKey(stdin, ESC);
    expect(onBack).toHaveBeenCalledTimes(1);
  }, 30_000);
});

describe('G-09 Application flow (#4255)', () => {
  it('a credential entry opens its input; Shift+Tab goes back to the list; the left arrow from Inputs goes back to the credentials', async () => {
    wsRef.path = workspace();
    const { lastFrame, stdin } = render(<AppAssessmentScreen onBack={vi.fn()} version="0.0.0-test" scaffold={scaffold()} />);
    const picker = await appsListed(lastFrame);
    expect(picker).toContain('○ Passes  ○ Target');
    await pressKey(stdin, '\r'); // the app
    const creds = await frameWith(lastFrame, 'Credentials for this app');
    expect(creds).toContain('Target URL');
    expect(creds).toContain('MFA secret');
    await pressKey(stdin, DOWN); // Repository URL
    await pressKey(stdin, '\r');
    expect(await frameWith(lastFrame, 'Shift+Tab back')).toContain('Shift+Tab back');
    await pressKey(stdin, SHIFT_TAB);
    await frameWith(lastFrame, 'Credentials for this app');
    await pressKey(stdin, '\r'); // the cursor starts on Continue again
    const inputs = await frameWith(lastFrame, 'Ingestion folder');
    expect(inputs).toContain('Inputs');
    await pressKey(stdin, LEFT);
    expect(await frameWith(lastFrame, 'Credentials for this app')).toContain('Credentials for this app');
  }, 30_000);

  it('delete an app through the ConfirmPanel (were y, n and Escape)', async () => {
    const ws = workspace(['sovereign-health', 'old-app']);
    wsRef.path = ws;
    const { lastFrame, stdin } = render(<AppAssessmentScreen onBack={vi.fn()} version="0.0.0-test" scaffold={scaffold()} />);
    await appsListed(lastFrame);
    for (const ch of 'Delete') await pressKey(stdin, ch);
    await frameWith(lastFrame, 'Delete an app');
    await pressKey(stdin, '\r');
    await frameWith(lastFrame, 'old-app');
    // The list is sorted by name: old-app first.
    await pressKey(stdin, ' ');
    await pressKey(stdin, '\r');
    const confirm = await frameWith(lastFrame, 'permanently?');
    expect(confirm).toContain('apps/old-app/');
    expect(confirm).toContain('Enter confirm');
    expect(confirm).not.toMatch(/Type y|Escape to cancel/);
    await pressKey(stdin, '\r');
    expect(await frameWith(lastFrame, 'Deleted 1 app')).toContain('Deleted 1 app: old-app');
    expect(existsSync(join(ws, 'apps', 'old-app'))).toBe(false);
    expect(existsSync(join(ws, 'apps', 'sovereign-health'))).toBe(true);
  }, 30_000);
});

describe('Target LZ step: "Skip this step" (#4255, Design 126 section 7.7)', () => {
  it('the provider list ends with the action entry "Skip this step" (no checkbox)', async () => {
    wsRef.path = workspace();
    const { lastFrame, stdin, unmount } = render(<AppAssessmentScreen onBack={vi.fn()} version="0.0.0-test" scaffold={scaffold()} />);
    await appsListed(lastFrame);
    // Enter through the steps before the Target LZ step (their defaults).
    for (let i = 0; i < 12 && !(lastFrame() ?? '').includes('Cloud provider(s)'); i++) await pressKey(stdin, String.fromCharCode(13));
    const frame = await frameWith(lastFrame, 'Cloud provider(s)');
    expect(frame).toContain('Cloud provider(s)');
    const rows = frame.split(String.fromCharCode(10));
    const skip = rows.find((l) => l.includes('Skip this step')) ?? '';
    expect(skip).not.toBe('');
    expect(skip).not.toContain('[');
    expect(rows.indexOf(skip)).toBeGreaterThan(rows.findIndex((l) => l.includes('[') && l.includes('Azure')));
    unmount();
  }, 60_000);
});

describe('Assessment Type menu on ScreenLayout (#4255, #4230)', () => {
  it('a number key opens the type; with the guidance open the arrows move and the box follows', async () => {
    const onSelect = vi.fn();
    const onBack = vi.fn();
    const { lastFrame, stdin } = render(<AssessmentTypeScreen onSelect={onSelect} version="0.0.0-test" onBack={onBack} />);
    const menu = await frameWith(lastFrame, 'Select Assessment Type');
    expect(menu).toContain('Esc back');
    expect(menu).not.toMatch(/ -- |\|/);
    await pressKey(stdin, '\u0007'); // Ctrl+G opens the box
    await pressKey(stdin, DOWN);
    expect(await frameWith(lastFrame, 'swao service')).toContain('swao service');
    await pressKey(stdin, ESC); // the box takes Esc
    expect(onBack).not.toHaveBeenCalled();
    await pressKey(stdin, '3');
    expect(onSelect).toHaveBeenCalledWith('landing-zone-catalog');
  }, 30_000);
});

describe('LZ Catalog flow steps at 100 and 80 columns (#4255, Design 126 section 10)', () => {
  for (const columns of [100, 80]) {
    it(`credentials, providers and regions stay within the header rule at ${columns} columns`, async () => {
      wsRef.path = workspace();
      const r = renderAt(<LzAssessmentScreen onBack={vi.fn()} version="0.0.0-test" scaffold={scaffold()} />, columns, 40);
      const wait = async (text: string): Promise<string[]> => {
        for (let i = 0; i < 60 && !r.lastFrame().includes(text); i++) await new Promise<void>((res) => setTimeout(res, 50));
        expect(r.lastFrame()).toContain(text);
        return r.lines();
      };
      const step = async (key: string): Promise<void> => {
        await new Promise<void>((res) => setTimeout(res, 80));
        r.stdin.write(key);
      };
      await wait('Select app to assess');
      await appsListed(r.lastFrame);
      expect(widest(r.lines())).toBeLessThanOrEqual(headerRuleWidth(columns));
      await step('\r');
      expect(widest(await wait('Credentials for this app'))).toBeLessThanOrEqual(headerRuleWidth(columns));
      await step('\r'); // Continue
      expect(widest(await wait('Cloud provider(s)'))).toBeLessThanOrEqual(headerRuleWidth(columns));
      await step(' '); // select azure
      await step('\r');
      await wait('Frameworks');
      await step('\r');
      expect(widest(await wait('Target region(s)'))).toBeLessThanOrEqual(headerRuleWidth(columns));
      r.unmount();
    }, 30_000);
  }
});

describe('Esc after a step change with the guidance box open (#4255, Design 126 section 7.5)', () => {
  it('the box of the new step starts collapsed, so Esc reaches the flow', async () => {
    wsRef.path = workspace();
    const onBack = vi.fn();
    const { lastFrame, stdin } = render(<LzAssessmentScreen onBack={onBack} version="0.0.0-test" scaffold={scaffold()} />);
    await appsListed(lastFrame);
    await pressKey(stdin, '\u0007'); // open the box on the app picker
    await pressKey(stdin, '\r'); // Enter still picks the app (section 7.8)
    await frameWith(lastFrame, 'Credentials for this app');
    await pressKey(stdin, ESC);
    expect(await frameWith(lastFrame, 'Abort the assessment?')).toContain('Abort the assessment?');
  }, 30_000);
});
