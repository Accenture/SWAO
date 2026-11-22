// #4283 (Design 125 section 5.7): confirming the lens step of the Application
// Assessment does not write the workspace .swao.yml; a save-as-default
// question (starts on No) follows when the choice differs from the default,
// and only Yes calls saveWorkspaceLenses, once.
//
// CLI equivalent : swao assess --lenses <list|none> (run only); swao lenses set (default)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import * as fs from 'fs';

vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    findWorkspace: vi.fn(() => '/mock/workspace'),
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
    findInstalledChromium: vi.fn(() => null),
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => [] as never[]),
    readFileSync: vi.fn((_p: unknown) => { throw new Error('mock: file not found'); }),
    writeFileSync: vi.fn(),
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    renameSync: vi.fn(),
    rmSync: vi.fn(),
  };
});

import { AppAssessmentScreen } from '@swao/module-app-assessment';

const normPath = (p: unknown): string => (typeof p === 'string' ? p.replace(/\\/g, '/') : '');

/** #4484: the app picker draws "Loading apps" first; wait until the apps are listed. */
async function appsListed(lastFrame: () => string | undefined): Promise<string> {
  const ok = (): boolean => { const f = lastFrame() ?? ''; return f.includes('Select app to assess') && !f.includes('Loading apps'); };
  for (let i = 0; i < 100 && !ok(); i++) await new Promise<void>((r) => setTimeout(r, 50));
  await new Promise<void>((r) => setTimeout(r, 50));
  return lastFrame() ?? '';
}

async function pressKey(stdin: { write: (s: string) => void }, key: string): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 50));
  stdin.write(key);
  await new Promise<void>((r) => setTimeout(r, 50));
}

const LENSES = [
  { id: 'cloud-migration', passes: ['INV', 'STATE'], auto_frameworks: [] },
  { id: 'security-focus', passes: ['SBOM'], auto_frameworks: [] },
];

function makeScaffold(save: (wp: string, ids: string[]) => void) {
  return {
    imports: vi.fn(),
    ingestion: vi.fn(),
    source: vi.fn(),
    landingZoneStubs: vi.fn(),
    appYmlTemplate: vi.fn(() => ''),
    lzCatalogueHint: null,
    lenses: LENSES,
    readWorkspaceLenses: vi.fn(() => [] as string[]),
    saveWorkspaceLenses: save,
  };
}

/** App list -> credential hub -> ingest tip -> lens step; toggle the first lens and confirm. */
async function confirmFirstLens(stdin: { write: (s: string) => void }): Promise<void> {
  await pressKey(stdin, '\r'); // select the single app
  await pressKey(stdin, '\r'); // credential hub -> ingest tip
  await pressKey(stdin, '\r'); // ingest tip -> lenses
  await pressKey(stdin, ' ');  // toggle cloud-migration
  await pressKey(stdin, '\r'); // confirm
}

describe('AppAssessmentScreen lens step (#4283)', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockImplementation((p) => normPath(p).endsWith('/mock/workspace/apps'));
    vi.mocked(fs.readdirSync).mockImplementation((p, _opts?: unknown) => {
      if (normPath(p).endsWith('/mock/workspace/apps')) {
        return [{ name: 'sovereign-health', isDirectory: () => true }] as unknown as ReturnType<typeof fs.readdirSync>;
      }
      return [] as unknown as ReturnType<typeof fs.readdirSync>;
    });
  });
  afterEach(() => {
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readdirSync).mockReset();
    vi.mocked(fs.writeFileSync).mockClear();
  });

  it('confirming asks the save question and writes nothing; No continues without a write', async () => {
    const save = vi.fn();
    const { lastFrame, stdin } = render(<AppAssessmentScreen onBack={vi.fn()} version="0.0.0-test" scaffold={makeScaffold(save)} />);
    await appsListed(lastFrame);
    await confirmFirstLens(stdin);
    expect(lastFrame() ?? '').toContain('Save these lenses as the workspace default?');
    expect(save).not.toHaveBeenCalled();
    await pressKey(stdin, '\r'); // No (the default answer)
    expect(save).not.toHaveBeenCalled();
    expect(lastFrame() ?? '').not.toContain('Save these lenses as the workspace default?');
    const ymlWrites = vi.mocked(fs.writeFileSync).mock.calls.filter((c) => normPath(c[0]).endsWith('.swao.yml'));
    expect(ymlWrites).toHaveLength(0);
  });

  it('Yes saves the lenses once', async () => {
    const save = vi.fn();
    const { lastFrame, stdin } = render(<AppAssessmentScreen onBack={vi.fn()} version="0.0.0-test" scaffold={makeScaffold(save)} />);
    await appsListed(lastFrame);
    await confirmFirstLens(stdin);
    await pressKey(stdin, '\u001B[B'); // Down to Yes
    await pressKey(stdin, '\r');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('/mock/workspace', ['cloud-migration']);
  });
});
