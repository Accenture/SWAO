// #4284 (Design 125 section 5.7): the frameworks and passes confirmed in the
// Application Assessment apply to that run only. Starting from the Setup
// Wizard app template, a narrowed framework and pass selection leaves
// apps/<id>/.swao.yml byte-identical; each choice is followed by a
// save-as-default question that starts on No; Yes edits only the changed key
// and keeps every comment.
//
// CLI equivalent : swao assess --app <id> --regimes <ids|none> --passes <list> (run only);
//                  swao regime-select --app <id> (default)

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

import { AppAssessmentScreen } from '@swao/module-app-assessment';
import { appSwaoYmlTemplate } from '../../../commands/init.js';

const here = dirname(fileURLToPath(import.meta.url));
const FRAMEWORKS = join(here, '..', '..', '..', '..', '..', '@swao', 'community-frameworks', 'frameworks');
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
  await new Promise<void>((r) => setTimeout(r, 60));
  stdin.write(key);
  await new Promise<void>((r) => setTimeout(r, 60));
}

const APP_FRAMEWORKS = ['GDPR_DEMO', 'AI_10_PILLARS_DEMO'];

function workspace(): { ws: string; yml: string } {
  const ws = mkdtempSync(join(tmpdir(), 'swao-run-choices-'));
  tmp.push(ws);
  writeFileSync(join(ws, '.swao.yml'), 'name: demo\n');
  const community = join(ws, 'wsp', 'inputs', 'catalogs', 'community');
  for (const f of ['gdpr-demo', 'ai-10-pillars-demo']) cpSync(join(FRAMEWORKS, f), join(community, f), { recursive: true });
  const app = join(ws, 'apps', 'sovereign-health');
  mkdirSync(app, { recursive: true });
  const yml = join(app, '.swao.yml');
  writeFileSync(yml, appSwaoYmlTemplate({ appId: 'sovereign-health', regimes: APP_FRAMEWORKS }));
  return { ws, yml };
}

function scaffold() {
  return {
    imports: vi.fn(), ingestion: vi.fn(), source: vi.fn(), landingZoneStubs: vi.fn(),
    appYmlTemplate: vi.fn(() => ''), lzCatalogueHint: null, lenses: [],
  };
}

/** App list -> credential hub -> ingest tip -> frameworks; deselect the first framework and confirm. */
async function narrowFrameworks(stdin: { write: (s: string) => void }): Promise<void> {
  await pressKey(stdin, '\r'); // select the single app
  await pressKey(stdin, '\r'); // credential hub -> ingest tip
  await pressKey(stdin, '\r'); // ingest tip -> frameworks (no lenses)
  await pressKey(stdin, ' ');  // deselect the first framework
  await pressKey(stdin, '\r'); // confirm
}

describe('AppAssessmentScreen run-time frameworks and passes (#4284)', () => {
  it('a narrowed framework and pass selection leaves the app .swao.yml byte-identical (No on both questions)', async () => {
    const { ws, yml } = workspace();
    wsRef.path = ws;
    const before = readFileSync(yml, 'utf-8');
    expect(before).toContain('# '); // the template carries comments
    const { lastFrame, stdin } = render(<AppAssessmentScreen onBack={vi.fn()} version="0.0.0-test" scaffold={scaffold()} />);
    await appsListed(lastFrame);
    await narrowFrameworks(stdin);
    expect(lastFrame() ?? '').toContain('Save as the new default for this app?');
    expect(lastFrame() ?? '').toContain('assessment.regimes_active');
    expect(readFileSync(yml, 'utf-8')).toBe(before);
    await pressKey(stdin, '\r'); // No
    expect(lastFrame() ?? '').toContain('Select passes to run');
    await pressKey(stdin, ' ');  // toggle the first pass option
    await pressKey(stdin, '\r'); // confirm
    // #4255: the Run options sub-step (stats, LLM cache, source path, iteration); Continue is first.
    expect(lastFrame() ?? '').toContain('Stats table:');
    expect(lastFrame() ?? '').not.toMatch(/\(S\)|\(C\)/);
    await pressKey(stdin, '\r'); // Continue
    expect(lastFrame() ?? '').toContain('assessment.pass_profile');
    await pressKey(stdin, '\r'); // No
    expect(lastFrame() ?? '').not.toContain('Save as the new default for this app?');
    expect(readFileSync(yml, 'utf-8')).toBe(before);
  }, 30_000);

  it('Yes on the framework question edits only assessment.regimes_active; every comment stays', async () => {
    const { ws, yml } = workspace();
    wsRef.path = ws;
    const before = readFileSync(yml, 'utf-8');
    const { lastFrame, stdin } = render(<AppAssessmentScreen onBack={vi.fn()} version="0.0.0-test" scaffold={scaffold()} />);
    await appsListed(lastFrame);
    await narrowFrameworks(stdin);
    await pressKey(stdin, '\u001B[B'); // Down to Yes
    await pressKey(stdin, '\r');
    const after = readFileSync(yml, 'utf-8');
    expect(after).not.toBe(before);
    const comments = (t: string): string[] => t.split('\n').filter((l) => l.trim().startsWith('#'));
    expect(comments(after)).toEqual(comments(before));
    const changed = after.split('\n').filter((l) => !before.split('\n').includes(l));
    expect(changed.every((l) => /regimes_active|^\s*-\s+\w+/.test(l))).toBe(true);
    expect(after.split(String.fromCharCode(10)).some((l) => /^\s*pass_profile:/.test(l))).toBe(false);
  }, 30_000);
});
