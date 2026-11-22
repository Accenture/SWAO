// #4285 (absorbs #4289; Design 125 sections 5.7 and 8): with
// assessment.landing_zone.targets [azure:germany, otc:germany, stackit:germany]
// in the workspace .swao.yml, the target pickers of the Application and the LZ
// Catalog Assessment preselect azure:germanywestcentral, otc:eu-de and
// stackit:eu01 (the geography rule `swao assess` applies), and show the
// resolution on screen.
//
// CLI equivalent : swao assess --app <id> (no flags: the same targets)

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

import { AppAssessmentScreen, LzAssessmentScreen } from '@swao/module-app-assessment';
import { setupLzTargetsForPicker } from '../../../commands/lz-target-config.js';
import { providerColumns } from '@swao/core';

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

function workspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'swao-lz-setup-'));
  tmp.push(ws);
  writeFileSync(join(ws, '.swao.yml'), ['name: demo', 'assessment:', '  landing_zone:', '    targets: [azure:germany, otc:germany, stackit:germany]', ''].join('\n'));
  mkdirSync(join(ws, 'apps', 'sovereign-health'), { recursive: true });
  writeFileSync(join(ws, 'apps', 'sovereign-health', '.swao.yml'), 'source:\n  path: ./src\n');
  return ws;
}

const region = (id: string, country: string) => ({ id, display: id, country, label: `${id} - ${country}` });
const HINT = {
  entries: [
    { provider: 'azure', name: 'Azure', label: 'azure - Azure', regions: [region('germanywestcentral', 'DE'), region('northeurope', 'IE')] },
    { provider: 'otc', name: 'OTC', label: 'otc - OTC', regions: [region('eu-de', 'DE'), region('eu-nl', 'NL')] },
    { provider: 'stackit', name: 'STACKIT', label: 'stackit - STACKIT', regions: [region('eu01', 'DE'), region('eu02', 'AT')] },
  ],
};

function scaffold() {
  return {
    imports: vi.fn(), ingestion: vi.fn(), source: vi.fn(), landingZoneStubs: vi.fn(),
    appYmlTemplate: vi.fn(() => ''), lzCatalogueHint: HINT, lenses: [],
    resolveSetupLzTargets: setupLzTargetsForPicker,
  };
}

/** The `[x]`/`[ ]` mark of the picker row naming `id`. */
function mark(frame: string, id: string): string {
  const line = frame.split('\n').find((l) => l.includes(` ${id} - `));
  return line?.includes('[x]') ? 'x' : line ? ' ' : 'missing';
}

function expectSetupPreselection(frame: string): void {
  expect(frame).toContain('Set-up targets (workspace .swao.yml): azure:germany -> azure:germanywestcentral');
  expect(mark(frame, 'germanywestcentral')).toBe('x');
  expect(mark(frame, 'eu-de')).toBe('x');
  expect(mark(frame, 'eu01')).toBe('x');
  expect(mark(frame, 'northeurope')).toBe(' ');
  expect(mark(frame, 'eu-nl')).toBe(' ');
  expect(mark(frame, 'eu02')).toBe(' ');
}

describe('set-up LZ targets preselected with geography resolution (#4285, #4289)', () => {
  it('resolves the geography targets as swao assess does', () => {
    const ws = workspace();
    const s = setupLzTargetsForPicker(ws, 'sovereign-health');
    expect(s.targets).toEqual(['azure:germanywestcentral', 'otc:eu-de', 'stackit:eu01']);
    expect(s.source).toBe('workspace:assessment.landing_zone.targets');
    expect(s.resolved.map((r) => r.requested)).toEqual(['azure:germany', 'otc:germany', 'stackit:germany']);
  });

  it('Application Assessment: the provider step preselects the three CSPs and the region step their default regions', async () => {
    wsRef.path = workspace();
    const { lastFrame, stdin } = render(<AppAssessmentScreen onBack={vi.fn()} version="0.0.0-test" scaffold={scaffold()} />);
    await appsListed(lastFrame);
    await pressKey(stdin, '\r'); // select the app
    await pressKey(stdin, '\r'); // credential hub -> ingest tip
    await pressKey(stdin, '\r'); // ingest tip -> frameworks (none installed)
    await pressKey(stdin, '\r'); // frameworks -> passes
    await pressKey(stdin, '\r'); // passes (defaults) -> run options
    await pressKey(stdin, '\r'); // #4255: run options, Continue -> target LZ provider
    const providers = lastFrame() ?? '';
    // #4296, #4349: provider rows come from the central name map.
    for (const p of ['azure', 'otc', 'stackit'].map((id) => providerColumns(id))) expect(providers.split('\n').find((l) => l.includes(p))).toContain('[x]');
    await pressKey(stdin, '\r'); // providers -> regions
    expectSetupPreselection(lastFrame() ?? '');
  }, 30_000);

  it('LZ Catalog Assessment: the region step preselects the geography default regions', async () => {
    wsRef.path = workspace();
    const { lastFrame, stdin } = render(<LzAssessmentScreen onBack={vi.fn()} version="0.0.0-test" scaffold={scaffold()} />);
    await appsListed(lastFrame);
    await pressKey(stdin, '\r'); // select the app
    await pressKey(stdin, '\r'); // credential hub -> providers
    await pressKey(stdin, '\r'); // providers (preselected) -> frameworks
    await pressKey(stdin, '\r'); // frameworks -> regions
    expectSetupPreselection(lastFrame() ?? '');
  }, 30_000);
});
