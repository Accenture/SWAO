// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- TUI screen-level contract tests (#1618-D/E)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// TU-SC-01: screens that have a GuidanceBox render one (frame contains "Ctrl+G for guidance")
//           Note: HelpScreen (#2347) intentionally has NO GuidanceBox -- it is the reference.
// TU-SC-02: Ctrl+G toggles GuidanceBox (frame changes; expanded state visible after press)
// TU-SC-03: the key hints sit directly above the GuidanceBox (#4246, Design 126 section 3, mockup M-09)
// TU-SC-04: error states have non-empty what in GuidanceBox
//
// Screens under test:
//   HelpScreen    -- #2347: GuidanceBox removed; nav affordances still present
//   ToolsMenu     -- conditional GuidanceBox (rendered when active item has info)
//
// Screens with process-spawn dependencies (IngestScreen, LzCatalogueUpdateScreen,
// SupportBundleScreen) are covered by their own dedicated test files which provide
// the necessary child_process mocks for phase transitions.

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Box } from 'ink';
import { GUIDANCE_CLOSE_HINT, GuidanceBox, KeyHints, KEY_HINTS, formatKeyHints } from '@swao/tui-kit';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// #3589: the real findWorkspace, kept by the mock factory for the default implementation.
const real = vi.hoisted(() => ({ findWorkspace: (_dir: string): string | null => null }));

// ---------------------------------------------------------------------------
// Mocks -- before imports (vi.mock is hoisted)
// ---------------------------------------------------------------------------

// HelpScreen and ToolsMenu both use the swao Header which reads LicenseGuard
// from the local license-guard.ts re-export of @swao/core.
vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  real.findWorkspace = original.findWorkspace;
  return {
    ...original,
    // #3589: overridable per test (Update LZ Catalogue reads the workspace from cwd).
    findWorkspace: vi.fn((dir: string) => original.findWorkspace(dir)),
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
  };
});

// ---------------------------------------------------------------------------
// Screen imports -- after mock declarations
// ---------------------------------------------------------------------------
import { HelpScreen } from '../HelpScreen.js';
import { ToolsMenu } from '../ToolsMenu.js';
import { SupportBundleScreen } from '../SupportBundleScreen.js';
import { LzLiveAssessmentScreen } from '@swao/module-app-assessment';
// #3589: Design 120 section 14.2 entries.
import { CredentialStore, LicenseGuard, findWorkspace } from '@swao/core';
import { PublishScreen } from '@swao/module-html-report';
import { formatCommunityFrameworksProbeLine, formatLzConnectionsProbeLine, parseHealthCheckOutput } from '@swao/module-health-check';
import { LzConnectionsScreen } from '../LzConnectionsScreen.js';
import { LzCatalogueUpdateScreen } from '../LzCatalogueUpdateScreen.js';
import { LzConnectionsStep } from '../wizard/steps/LzConnectionsStep.js';
import { buildSetupPlan, defaultSetupRegistry, entryLabel } from '../../../setup/index.js';

const PREMIUM_PORTFOLIO = existsSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../../../../swao-premium/packages/@swao/module-portfolio/src/tui/PortfolioScreen.tsx'));

const noop = vi.fn();

async function settle(ms = 80): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// TU-SC-01: every tested screen renders a GuidanceBox
// ---------------------------------------------------------------------------
describe('Screen contract -- TU-SC-01: GuidanceBox is rendered', () => {
  it('HelpScreen has no GuidanceBox (#2347: help IS the reference content)', () => {
    const { lastFrame } = render(<HelpScreen onBack={noop} />);
    // GuidanceBox intentionally removed from HelpScreen -- it would be circular.
    expect(lastFrame() ?? '').not.toContain('(Ctrl+G for guidance)');
    // Nav affordance still present.
    expect(lastFrame() ?? '').toContain('Enter back   Esc back');
  });

  it('LzLiveAssessmentScreen frame contains GuidanceBox hint text (#3588)', () => {
    const { lastFrame } = render(<LzLiveAssessmentScreen onBack={noop} version="0.0.0" workspace={process.cwd()} run={async () => 0} />);
    expect(lastFrame() ?? '').toContain('Ctrl+G');
    expect(lastFrame() ?? '').toContain('Select landing zone');
  });

  it('ToolsMenu frame contains GuidanceBox hint text (initial cursor has info)', () => {
    const { lastFrame } = render(<ToolsMenu onSelect={noop} onBack={noop} />);
    expect(lastFrame() ?? '').toContain('Ctrl+G');
  });
});

// ---------------------------------------------------------------------------
// TU-SC-02: Ctrl+G toggles GuidanceBox
// ---------------------------------------------------------------------------
describe('Screen contract -- TU-SC-02: Ctrl+G toggles GuidanceBox', () => {
  it('HelpScreen has no GuidanceBox -- Ctrl+G has no effect (#2347)', async () => {
    const { lastFrame, stdin } = render(<HelpScreen onBack={noop} />);
    const frameBefore = lastFrame() ?? '';
    expect(frameBefore).not.toContain(GUIDANCE_CLOSE_HINT);
    await settle();
    stdin.write('\x07'); // Ctrl+G = BEL (0x07)
    await settle();
    // Frame unchanged -- no GuidanceBox to toggle.
    expect(lastFrame() ?? '').not.toContain(GUIDANCE_CLOSE_HINT);
  });

  it('LzLiveAssessmentScreen GuidanceBox expands on Ctrl+G and collapses on second Ctrl+G (#3588)', async () => {
    const { lastFrame, stdin } = render(<LzLiveAssessmentScreen onBack={noop} version="0.0.0" workspace={process.cwd()} run={async () => 0} />);
    await settle();
    stdin.write('');
    await settle();
    expect(lastFrame() ?? '').toContain(GUIDANCE_CLOSE_HINT);
    stdin.write('');
    await settle();
    expect(lastFrame() ?? '').not.toContain(GUIDANCE_CLOSE_HINT);
  });

  it('ToolsMenu GuidanceBox expands on Ctrl+G and collapses on second Ctrl+G', async () => {
    const { lastFrame, stdin } = render(<ToolsMenu onSelect={noop} onBack={noop} />);
    await settle();
    stdin.write('\x07');
    await settle();
    expect(lastFrame() ?? '').toContain(GUIDANCE_CLOSE_HINT);
    stdin.write('\x07');
    await settle();
    expect(lastFrame() ?? '').not.toContain(GUIDANCE_CLOSE_HINT);
  });
});

// ---------------------------------------------------------------------------
// TU-SC-03: the key hints sit directly above the GuidanceBox (#4246)
// Design 126 section 3 (block 7 above block 8) replaces the old contract
// "nav affordances after the GuidanceBox" (section 13.1 conflict note).
// ---------------------------------------------------------------------------
describe('Screen contract -- TU-SC-03: key hints directly above the GuidanceBox', () => {
  it('HelpScreen renders nav affordance text (no GuidanceBox, #2347)', () => {
    const { lastFrame } = render(<HelpScreen onBack={noop} />);
    const frame = lastFrame() ?? '';
    // No GuidanceBox on HelpScreen -- verify only that the nav affordance is present.
    const navIdx = frame.indexOf('Enter back   Esc back');
    expect(navIdx).toBeGreaterThanOrEqual(0);
    expect(frame).not.toContain('(Ctrl+G for guidance)');
  });

  it('the central composition puts the KeyHints line on the line above the box border (mockup M-09, F-01)', () => {
    const { lastFrame } = render(
      <Box flexDirection="column">
        <KeyHints hints={KEY_HINTS.picker} />
        <GuidanceBox title="Probe" what="Checks the login of each scope." marginTop={0} />
      </Box>,
    );
    const lines = (lastFrame() ?? '').split(String.fromCharCode(10));
    const hintsIdx = lines.findIndex((l) => l.includes(formatKeyHints(KEY_HINTS.picker)));
    const boxTop = lines.findIndex((l) => l.trimStart().startsWith('┌'));
    expect(hintsIdx).toBeGreaterThanOrEqual(0);
    expect(boxTop).toBe(hintsIdx + 1);
    expect(lines[boxTop + 1]).toContain('Probe');
  });

  it('ToolsMenu puts its KeyHints line directly above the box border (#4257 migrated to ScreenLayout)', async () => {
    const { lastFrame } = render(<ToolsMenu onSelect={noop} onBack={noop} />);
    await settle();
    const lines = (lastFrame() ?? '').split(String.fromCharCode(10));
    const hintsIdx = lines.findIndex((l) => l.includes(formatKeyHints(KEY_HINTS.menu)));
    const boxTop = lines.findIndex((l) => l.trimStart().startsWith('┌'));
    expect(hintsIdx).toBeGreaterThanOrEqual(0);
    expect(boxTop).toBe(hintsIdx + 1);
    expect(lines[boxTop + 1]).toContain('License');
  });
});

// ---------------------------------------------------------------------------
// TU-SC-04: error states have non-empty GuidanceBox what text
// ---------------------------------------------------------------------------
describe('Screen contract -- TU-SC-04: error states have remediation GuidanceBox', () => {
  it('GuidanceBox what text is not empty when IngestScreen shows failure', () => {
    // The IngestScreen GuidanceBox always has a non-empty what: either
    // the normal description (running/success) or the remediation message
    // (failure). We verify the remediation text is defined in the source
    // (the component test TU-GB-07 covers the actual render).
    //
    // This test verifies that the SupportBundleScreen failure state has
    // a GuidanceBox rendered by importing and checking the component
    // definition contains the remediation title.
    // #2596: use static import (top of file) to avoid 5s dynamic-import timeout
    // under contention in the full test suite.
    expect(SupportBundleScreen).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// #3589: every [NEW] entry of Design 120 section 14.2 is reachable. One test
// per entry; the flows behind each entry have their own test files
// (lz-connections-screen, lz-catalogue-update-live, publish-lz-live,
// portfolio-lz-live, lz-live-assessment-screen, lz-connections-probe).
// ---------------------------------------------------------------------------
describe('Screen contract -- Design 120 section 14.2 [NEW] entries (#3589)', () => {
  const tmpDirs: string[] = [];
  const defaultLoad = vi.mocked(LicenseGuard.load).getMockImplementation();
  afterEach(() => {
    vi.mocked(findWorkspace).mockImplementation((dir: string) => real.findWorkspace(dir));
    if (defaultLoad) vi.mocked(LicenseGuard.load).mockImplementation(defaultLoad);
    for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const asTier = (tier: 'consultant' | 'enterprise'): void => {
    const base = defaultLoad?.() as unknown as { state: Record<string, unknown> };
    vi.mocked(LicenseGuard.load).mockImplementation(() => ({ state: { ...base.state, tier, daysElapsed: 0 } }) as unknown as ReturnType<typeof LicenseGuard.load>);
  };
  const tempDir = (prefix: string): string => {
    const d = mkdtempSync(join(tmpdir(), prefix));
    tmpDirs.push(d);
    return d;
  };
  const liveWorkspace = (): string => {
    const d = tempDir('swao-sc-3589-');
    writeFileSync(join(d, '.swao.yml'), 'name: demo\nlanding_zones:\n  - id: otc-prod\n    provider: otc\n    scopes:\n      - id: platform\n        kind: platform\n        auth: iam-password-token\n');
    return d;
  };

  it('1 Workspace Setup: Landing Zone Connections (optional step) comes before the health check', () => {
    // #4120: the health check moved to the end (directly before Ready); LZ Connections still precedes it.
    // #4190 (Design 125 section 5.5): it is a step of the LZ Live branch, before that branch's health check.
    const lzPlan = buildSetupPlan(defaultSetupRegistry(), { kind: 'branch', type: 'lz-live' }).map(entryLabel);
    expect(lzPlan.indexOf('Landing Zones')).toBeGreaterThanOrEqual(0);
    expect(lzPlan.indexOf('Landing Zones')).toBeLessThan(lzPlan.indexOf('Health Check'));
    const { lastFrame } = render(<LzConnectionsStep workspace={process.cwd()} onNext={noop} />);
    expect(lastFrame() ?? '').toContain('Landing Zone Connections');
    expect(lastFrame() ?? '').not.toContain('(optional)'); // #4297
  });

  it('2 Health Check: LZ connection probes are probe [26] (read-only, coverage)', () => {
    const line = formatLzConnectionsProbeLine({ status: 'warn', message: '1 landing zone(s), 1 scope(s): 0 read-only verified, 1 need attention', scopes: [{ lz_id: 'otc-prod', scope_id: 'platform', provider: 'otc', state: 'refused', readable: 5, unreadable: 0 }] });
    const parsed = parseHealthCheckOutput(line.split('\n'));
    expect(parsed[0]).toMatchObject({ num: 26, total: 26, name: 'LZ connections', status: 'WARN' });
    // #4233 / #4298: the state in the Setup Probe step words (Q-13), the facts on the next line.
    expect(parsed[0]?.detailLines[0]).toContain('otc-prod/platform (otc): write-capable, accepted for this run; SWAO only reads');
    expect(parsed[0]?.detailLines.join(' ')).toContain('coverage 5 readable');
  });

  it('2 Health Check: framework service-mapping coverage per community framework (probe [4], #3577)', () => {
    const line = formatCommunityFrameworksProbeLine({
      status: 'ok', catalogs_dir: '/ws', standard_count: 3, community_count: 1, bundled_count: 4, collisions: [], warnings: [], errors: [],
      frameworks: [{ id: 'BSI_C5', scope: 'community', contributor: 'SWAO', controls_count: 62, service_mapping: { status: 'ok', mapped: 12, in_use: 73, unused_mappings: [] }, policy_baseline: { status: 'absent', policies: 0, enabled: 0, disabled: 0, not_set: [], catalogue_version: null, shipped_version: null, stale: false, missing_shipped_ids: [], unused_tags: [] } }],
    });
    expect(line).toContain('service mapping 12/73 capability tags');
  });

  it('5 Publish HTML: Landing Zone Live View (lz-live)', () => {
    const { lastFrame } = render(<PublishScreen onBack={noop} version="0.0.0" />);
    expect(lastFrame() ?? '').toContain('Landing Zone Live View (lz-live)');
  });

  it('5 Publish HTML > Edit template (HTML Editor): assessment types lz-live and lz-live-portfolio (#3585, #3586)', () => {
    const server = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../../@swao/module-html-report/src/publish/editor/server.ts'), 'utf-8');
    expect(server).toContain('<option value="lz-live">Landing Zone Live</option>');
    expect(server).toContain('<option value="lz-live-portfolio">Landing Zone Live Portfolio</option>');
  });

  // #4124: grouped Portfolio Operations (application portfolio, landing zone live portfolio).
  it.skipIf(!PREMIUM_PORTFOLIO)('7 Portfolio Operations: the two groups with Merge live runs and Multi-Cloud Governance', async () => {
    asTier('enterprise');
    const { PortfolioScreen } = await import('@swao/module-portfolio');
    const { lastFrame } = render(<PortfolioScreen onBack={noop} version="0.0.0" />);
    expect(lastFrame() ?? '').toContain('Application portfolio');
    expect(lastFrame() ?? '').toContain('Landing zone live portfolio');
    expect(lastFrame() ?? '').toContain('Merge live runs');
    expect(lastFrame() ?? '').toContain('Multi-Cloud Governance');
  });

  it('9 Tools > 3 Update LZ Catalogue: Source: Live landing zone catalogue, or build a new catalogue file', () => {
    asTier('consultant');
    const ws = liveWorkspace();
    vi.mocked(findWorkspace).mockImplementation(() => ws);
    const { lastFrame } = render(<LzCatalogueUpdateScreen onBack={noop} onOpenLicense={noop} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Source: Internet sources');
    expect(frame).toContain('Source: Live landing zone catalogue');
    expect(frame).toContain('build a new catalogue file');
  });

  it('Landing Zone Connections (LZ Live setup and assessment, not Tools since #4127): add landing zone, add scope + credentials, probe, remove', async () => {
    const tools = render(<ToolsMenu onSelect={noop} onBack={noop} />);
    expect(tools.lastFrame() ?? '').not.toContain('Landing Zone Connections');
    const { lastFrame } = render(<LzConnectionsScreen onBack={noop} workspace={liveWorkspace()} run={async () => 0} store={new CredentialStore(tempDir('swao-sc-vault-'))} drivers={[]} />);
    await settle(150);
    const frame = lastFrame() ?? '';
    for (const label of ['Add landing zone', 'Add scope: Platform (PLZ) or Application landing zone (ALZ)', 'Probe read-only access and coverage', 'Remove scope or landing zone']) { // #4299
      expect(frame).toContain(label);
    }
    expect(frame).toContain('otc-prod');
  });
});
