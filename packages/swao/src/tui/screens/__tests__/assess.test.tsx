// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- TUI component tests: AssessScreen (#0530)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// TU-01: AssessScreen renders app list from workspace
// TU-02: AssessScreen shows pass profile when configured
// TU-07: AssessScreen LZ catalogue mode renders provider list
//
// CLI equivalent : swao assess (then type-select -> application / landing-zone-catalog)
// MCP equivalent : n/a (assessment is CLI/TUI-only in this milestone)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Mocks -- declared before imports (vi.mock is hoisted by Vitest)
// ---------------------------------------------------------------------------

vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    findWorkspace: vi.fn(() => '/mock/workspace'),
    LicenseGuard: {
      load: vi.fn(() => ({
        state: {
          tier:                  'community' as const,
          valid:                 true,
          remaining_assessments: 48,
          expiry:                '2027-01-01',
          fingerprint:           'abc1234567890abc',
          licensee:              'Test User',
          email:                 'test@test.com',
          firstRun:              '2026-01-01',
          assessmentCount:       0,
          assessmentLimit:       null,
          exp:                   undefined,
        },

      })),
    },
    CredentialStore: class {
      loadSync(): Record<string, string> { return {}; }
      set(_n: string, _v: string): Promise<void> { return Promise.resolve(); }
    },
    logApp:               vi.fn(),
    openWithDefaultApp:   vi.fn(),
    copyToClipboard:      vi.fn(() => Promise.resolve()),
    findInstalledChromium: vi.fn(() => null),
  };
});

// AssessScreen reads apps and .swao.yml from disk; stub all fs calls.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync:     vi.fn(() => false),
    readdirSync:    vi.fn(() => [] as never[]),
    readFileSync:   vi.fn((_p: unknown) => { throw new Error('mock: file not found'); }),
    writeFileSync:  vi.fn(),
    appendFileSync: vi.fn(),
    mkdirSync:      vi.fn(),
    renameSync:     vi.fn(),
    rmSync:         vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Screen import -- after mock declarations
// ---------------------------------------------------------------------------
import { AssessScreen } from '@swao/module-app-assessment';
import type { LzCatalogueHint } from '@swao/module-app-assessment';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const noop = vi.fn();

/** Normalise path separators for cross-platform mock checks. */
const normPath = (p: unknown): string =>
  typeof p === 'string' ? p.replace(/\\/g, '/') : '';

/** Wait for Ink useEffect mount, send key, then wait for re-render. */
async function pressKey(stdin: { write: (s: string) => void }, key: string): Promise<void> {
  await new Promise<void>(r => setTimeout(r, 50));
  stdin.write(key);
  await new Promise<void>(r => setTimeout(r, 50));
}

/** LZ catalogue hint used for TU-07. */
const LZ_HINT: LzCatalogueHint = {
  entries: [
    { provider: 'aws',     name: 'AWS',     regions: [{ id: 'us-east-1',  display: 'US East (N. Virginia)' }] },
    { provider: 'azure',   name: 'Azure',   regions: [{ id: 'eastus',     display: 'East US'              }] },
    { provider: 'stackit', name: 'STACKIT', regions: [{ id: 'eu01',       display: 'EU01'                 }] },
    { provider: 'gcp',     name: 'GCP',     regions: [{ id: 'us-central1', display: 'US Central (Iowa)'   }] },
  ],
};

/** Minimal scaffold -- all functions are no-ops; caller supplies lzCatalogueHint. */
function makeScaffold(lzCatalogueHint: LzCatalogueHint | null = null) {
  return {
    imports:          vi.fn(),
    ingestion:        vi.fn(),
    source:           vi.fn(),
    landingZoneStubs: vi.fn(),
    appYmlTemplate:   vi.fn(() => ''),
    lzCatalogueHint,
  };
}

// ---------------------------------------------------------------------------
// TU-01: AssessScreen renders app list from workspace
// ---------------------------------------------------------------------------
describe('AssessScreen -- TU-01: app list from workspace', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const np = normPath(p);
      // apps/ dir exists; .swao.yml files do not (profile falls back to defaults)
      return np.endsWith('/mock/workspace/apps');
    });
    vi.mocked(fs.readdirSync).mockImplementation((p, _opts?: unknown) => {
      const np = normPath(p);
      if (np.endsWith('/mock/workspace/apps')) {
        return [
          { name: 'sovereign-health', isDirectory: () => true },
          { name: 'medplum',          isDirectory: () => true },
        ] as unknown as ReturnType<typeof fs.readdirSync>;
      }
      return [] as unknown as ReturnType<typeof fs.readdirSync>;
    });
  });

  afterEach(() => {
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readdirSync).mockReset();
  });

  it('lists both app names in the initial SelectInput', () => {
    const { lastFrame } = render(
      <AssessScreen
        onBack={noop}
        version="0.0.0-test"
        scaffold={makeScaffold()}
        assessmentType="application"
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('sovereign-health');
    expect(frame).toContain('medplum');
  });

  it('shows Application Assessment type label', () => {
    const { lastFrame } = render(
      <AssessScreen
        onBack={noop}
        version="0.0.0-test"
        scaffold={makeScaffold()}
        assessmentType="application"
      />,
    );
    expect(lastFrame() ?? '').toContain('Application Assessment');
  });
});

// ---------------------------------------------------------------------------
// TU-02: AssessScreen shows pass profile when configured
// ---------------------------------------------------------------------------
describe('AssessScreen -- TU-02: pass profile pre-loaded from workspace config', () => {
  // Minimal .swao.yml carrying a saved pass profile
  const PASS_PROFILE_YML = [
    'assessment:',
    '  pass_profile:',
    '    - inv',
    '    - crypto',
  ].join('\n');

  beforeEach(() => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const np = normPath(p);
      if (np.endsWith('/mock/workspace/apps')) return true;
      // .swao.yml present so readAppPassProfile can read the stored profile
      if (np.endsWith('/mock/workspace/apps/sovereign-health/.swao.yml')) return true;
      return false;
    });
    vi.mocked(fs.readdirSync).mockImplementation((p, _opts?: unknown) => {
      const np = normPath(p);
      if (np.endsWith('/mock/workspace/apps')) {
        return [{ name: 'sovereign-health', isDirectory: () => true }] as unknown as ReturnType<typeof fs.readdirSync>;
      }
      return [] as unknown as ReturnType<typeof fs.readdirSync>;
    });
    vi.mocked(fs.readFileSync).mockImplementation((p: unknown, _enc?: unknown) => {
      const np = normPath(p);
      if (np.endsWith('/mock/workspace/apps/sovereign-health/.swao.yml')) {
        return PASS_PROFILE_YML;
      }
      throw new Error('mock: file not found');
    });
  });

  afterEach(() => {
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readdirSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
  });

  it('reaches the pass selection screen after navigating from the app list', async () => {
    // For application type the initial SelectInput order is:
    //   [0] + New app...   <- default cursor position
    //   [1] apps/sovereign-health
    //   [2] -- Delete app...
    //   [3] -- Rename app...
    const { lastFrame, stdin } = render(
      <AssessScreen
        onBack={noop}
        version="0.0.0-test"
        scaffold={makeScaffold()}
        assessmentType="application"
      />,
    );
    // Down: advance cursor from '+ New app...' to 'apps/sovereign-health'
    await pressKey(stdin, '\x1B[B');
    // Enter: select 'sovereign-health' -> input-app-credentials
    await pressKey(stdin, '\r');
    // Enter: credential hub -> input-ingest-tip (added sprint-090 #1015)
    await pressKey(stdin, '\r');
    // Enter: ingest-tip -> input-regimes
    await pressKey(stdin, '\r');
    // Enter: input-regimes with 0 community frameworks installed -> input-passes
    await pressKey(stdin, '\r');
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Select passes to run');
  });
});

// ---------------------------------------------------------------------------
// TU-07: AssessScreen LZ catalogue mode renders provider list
// ---------------------------------------------------------------------------
describe('AssessScreen -- TU-07: landing-zone mode provider picker', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const np = normPath(p);
      return np.endsWith('/mock/workspace/apps');
    });
    vi.mocked(fs.readdirSync).mockImplementation((p, _opts?: unknown) => {
      const np = normPath(p);
      if (np.endsWith('/mock/workspace/apps')) {
        return [{ name: 'sovereign-health', isDirectory: () => true }] as unknown as ReturnType<typeof fs.readdirSync>;
      }
      return [] as unknown as ReturnType<typeof fs.readdirSync>;
    });
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('mock: file not found');
    });
  });

  afterEach(() => {
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readdirSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
  });

  it('shows Landing Zone Catalog Assessment type label on initial render', () => {
    const { lastFrame } = render(
      <AssessScreen
        onBack={noop}
        version="0.0.0-test"
        scaffold={makeScaffold(LZ_HINT)}
        assessmentType="landing-zone"
      />,
    );
    expect(lastFrame() ?? '').toContain('Landing Zone Catalog Assessment');
  });

  it('navigates to provider picker and shows all four test providers', async () => {
    // For landing-zone type the initial SelectInput has only existing apps (no management entries):
    //   [0] apps/sovereign-health  <- default cursor
    // Enter selects the app and goes to input-app-credentials.
    // A second Enter advances from the credential hub to input-lz-provider.
    const { lastFrame, stdin } = render(
      <AssessScreen
        onBack={noop}
        version="0.0.0-test"
        scaffold={makeScaffold(LZ_HINT)}
        assessmentType="landing-zone"
      />,
    );
    // Enter: select 'sovereign-health' -> input-app-credentials
    await pressKey(stdin, '\r');
    // Enter: credential hub -> input-lz-provider (landing-zone branch)
    await pressKey(stdin, '\r');
    const frame = lastFrame() ?? '';
    expect(frame).toContain('AWS');
    expect(frame).toContain('Azure');
    expect(frame).toContain('STACKIT');
    expect(frame).toContain('GCP');
  });
});
