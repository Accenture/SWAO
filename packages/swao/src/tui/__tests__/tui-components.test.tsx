// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- TUI component tests (#0670 Phase 3)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { GuidanceBox } from '@swao/tui-kit';

// ---------------------------------------------------------------------------
// Mock heavy dependencies before importing any screen that references them.
// LicenseGuard reads filesystem state; Header calls it on every render.
// ---------------------------------------------------------------------------

// @swao/core -- findWorkspace reads cwd() for .swao.yml; CredentialStore reads disk.
vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    findWorkspace: vi.fn(() => null),
    saveDefaultWorkspace: vi.fn(),
    CredentialStore: class {
      loadSync() { return {}; }
    },
  };
});

// @swao/module-health-check -- HealthCheckProbeList renders real filesystem probes.
vi.mock('@swao/module-health-check', () => ({
  claudeDesktopConfigPath: '/mock/.config/claude/claude_desktop_config.json',
  HealthCheckProbeList: vi.fn(() => null),
}));

// compliance/regime-picker -- reads workspace .swao.yml and installed catalogs.
vi.mock('../../compliance/regime-picker.js', () => ({
  loadAvailableRegimes: vi.fn(() => [
    { entry: { id: 'GDPR', name: 'General Data Protection Regulation' }, catalogPath: null },
    { entry: { id: 'AI_10_PILLARS', name: 'AI 10 Pillars' }, catalogPath: null },
  ]),
  readRegimesActive: vi.fn(() => []),
  writeRegimesActive: vi.fn(),
  regimePickerRow: vi.fn((r: { entry: { id: string; name: string } }) => ({ label: r.entry.name, value: r.entry.id })),
}));

// commands/lenses -- reads lenses directory and workspace lenses config.
vi.mock('../../commands/lenses.js', () => ({
  listLenses: vi.fn(() => [
    { id: 'cloud-migration', passes: ['INV', 'STATE'], auto_frameworks: [] },
    { id: 'security-review', passes: ['CRYPTO', 'SBOM'], auto_frameworks: [] },
  ]),
  readWorkspaceLenses: vi.fn(() => []),
  writeWorkspaceLenses: vi.fn(),
}));

// commands/init -- scaffold functions write to disk; stub them out in TUI tests.
vi.mock('../../commands/init.js', () => ({
  scaffoldCatalogs: vi.fn(),
  scaffoldPowerBiTemplates: vi.fn(),
  scaffoldLandingZoneStubs: vi.fn(),
  scaffoldImports: vi.fn(),
  scaffoldIngestion: vi.fn(),
  scaffoldSource: vi.fn(),
  ensureGitignore: vi.fn(),
  appSwaoYmlTemplate: vi.fn(() => ''),
}));

vi.mock('../../license/license-guard.js', () => ({
  LicenseGuard: {
    load: vi.fn(() => ({
      state: {
        tier: 'community',
        valid: true,
        remaining_assessments: 48,
        expiry: '2027-01-01',
        // Full LicenseState fields required by LicenseStatusPanel
        fingerprint: 'abc1234567890abc',
        licensee: 'Test User',
        email: 'test@test.com',
        firstRun: '2026-01-01',
        assessmentCount: 5,
        assessmentLimit: null,
        exp: undefined,
      },
    })),
  },
  LicenseInvalidError: class LicenseInvalidError extends Error {},
}));

// ---------------------------------------------------------------------------
// Imports after mock setup
// ---------------------------------------------------------------------------
import { MainMenu }               from '../screens/MainMenu.js';
import { HelpScreen }             from '../screens/HelpScreen.js';
import { ToolsMenu }              from '../screens/ToolsMenu.js';
import { LicenseScreen }          from '../screens/LicenseScreen.js';
import { CredentialScreen }       from '../screens/CredentialScreen.js';
import { RegimeSelectorScreen }   from '../screens/RegimeSelectorScreen.js';
import { LensesScreen }           from '../screens/LensesScreen.js';
import { ReportScreen }           from '../screens/ReportScreen.js';
import { SetupWizard }            from '../screens/SetupWizard.js';
import { LzCatalogueUpdateScreen } from '../screens/LzCatalogueUpdateScreen.js';
import { LicenseGuard }           from '../../license/license-guard.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
const noop = vi.fn();

/** Wait for useEffect listeners to mount, write key, then let React re-render. */
async function pressKey(stdin: { write: (s: string) => void }, key: string): Promise<void> {
  await new Promise<void>(r => setTimeout(r, 50)); // effects mount
  stdin.write(key);
  await new Promise<void>(r => setTimeout(r, 50)); // re-render
}

// ---------------------------------------------------------------------------
// MainMenu (#0670 Ph3 -- L7 component tests)
// ---------------------------------------------------------------------------
describe('MainMenu', () => {
  it('renders all numeric menu items', () => {
    const { lastFrame } = render(<MainMenu onSelect={noop} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Workspace Setup');
    expect(frame).toContain('Health Check');
    expect(frame).toContain('Run Assessment');
    expect(frame).toContain('Generate Report');
    expect(frame).toContain('Tools');
  });

  it('shows the keyboard hint line', () => {
    const { lastFrame } = render(<MainMenu onSelect={noop} />);
    const frame = lastFrame() ?? '';
    // Navigation footer
    expect(frame).toContain('Arrow keys');
  });

  it('calls onSelect with correct target when shortcut key pressed', async () => {
    const onSelect = vi.fn();
    const { stdin } = render(<MainMenu onSelect={onSelect} />);
    await pressKey(stdin, '2'); // key '2' = Health Check
    expect(onSelect).toHaveBeenCalledWith('doctor');
  });

  it('calls onSelect with first item target on Enter', async () => {
    const onSelect = vi.fn();
    const { stdin } = render(<MainMenu onSelect={onSelect} />);
    await pressKey(stdin, '\r'); // Enter
    expect(onSelect).toHaveBeenCalledWith('setup');
  });
});

// ---------------------------------------------------------------------------
// HelpScreen
// ---------------------------------------------------------------------------
describe('HelpScreen', () => {
  it('renders help content without crashing', () => {
    const { lastFrame } = render(<HelpScreen onBack={noop} />);
    const frame = lastFrame() ?? '';
    expect(frame.length).toBeGreaterThan(0);
  });

  it('shows key menu item descriptions', () => {
    const { lastFrame } = render(<HelpScreen onBack={noop} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Workspace Setup');
    expect(frame).toContain('Health Check');
  });

  it('renders troubleshooting section', () => {
    const { lastFrame } = render(<HelpScreen onBack={noop} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Troubleshooting');
  });
});

// ---------------------------------------------------------------------------
// ToolsMenu
// ---------------------------------------------------------------------------
describe('ToolsMenu', () => {
  it('renders all tool items', () => {
    const { lastFrame } = render(<ToolsMenu onSelect={noop} onBack={noop} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('License');
    expect(frame).toContain('Credentials');
    expect(frame).toContain('Help');
  });

  it('calls onBack when Esc pressed', async () => {
    const onBack = vi.fn();
    const { stdin } = render(<ToolsMenu onSelect={noop} onBack={onBack} />);
    await pressKey(stdin, '\x1B'); // Escape
    expect(onBack).toHaveBeenCalled();
  });

  it('calls onSelect with license target when key 1 pressed', async () => {
    const onSelect = vi.fn();
    const { stdin } = render(<ToolsMenu onSelect={onSelect} onBack={noop} />);
    await pressKey(stdin, '1');
    expect(onSelect).toHaveBeenCalledWith('license');
  });

  // #0872 -- lz-catalogue-update is key 3; ingest is key 4.
  // #1515 -- support-bundle is key 5; Help shifted to key 6.
  // lz-catalogue-manage removed (#1522): LZ catalogs auto-seeded during init.
  it('calls onSelect with lz-catalogue-update target when key 3 pressed', async () => {
    const onSelect = vi.fn();
    const { stdin } = render(<ToolsMenu onSelect={onSelect} onBack={noop} />);
    await pressKey(stdin, '3');
    expect(onSelect).toHaveBeenCalledWith('lz-catalogue-update');
  });

  it('calls onSelect with ingest target when key 4 pressed', async () => {
    const onSelect = vi.fn();
    const { stdin } = render(<ToolsMenu onSelect={onSelect} onBack={noop} />);
    await pressKey(stdin, '4');
    expect(onSelect).toHaveBeenCalledWith('ingest');
  });

  it('calls onSelect with support-bundle target when key 5 pressed', async () => {
    const onSelect = vi.fn();
    const { stdin } = render(<ToolsMenu onSelect={onSelect} onBack={noop} />);
    await pressKey(stdin, '5');
    expect(onSelect).toHaveBeenCalledWith('support-bundle');
  });

  it('calls onSelect with help target when key 6 pressed', async () => {
    const onSelect = vi.fn();
    const { stdin } = render(<ToolsMenu onSelect={onSelect} onBack={noop} />);
    await pressKey(stdin, '6');
    expect(onSelect).toHaveBeenCalledWith('help');
  });
});

// ---------------------------------------------------------------------------
// LicenseScreen (#0748 regression -- menu content + header)
// ---------------------------------------------------------------------------
describe('LicenseScreen', () => {
  it('renders the SWAO header bar', () => {
    const { lastFrame } = render(<LicenseScreen onBack={noop} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('S W A O');
    expect(frame).toContain('Licence Management');
  });

  it('shows "Show license status" menu option', () => {
    const { lastFrame } = render(<LicenseScreen onBack={noop} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Show license status');
  });

  it('shows "Request a license upgrade" menu option', () => {
    const { lastFrame } = render(<LicenseScreen onBack={noop} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Request a license upgrade');
  });

  // Regression #0748: "Activate a license key" was removed because activation
  // is handled in a separate tool. This test prevents re-introduction.
  it('does NOT show "Activate a license key" option', () => {
    const { lastFrame } = render(<LicenseScreen onBack={noop} />);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Activate a license key');
    expect(frame).not.toContain('activate');
  });

  it('shows "Back to main menu" option', () => {
    const { lastFrame } = render(<LicenseScreen onBack={noop} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Back to main menu');
  });

  it('calls onBack when Esc pressed in menu state', async () => {
    const onBack = vi.fn();
    const { stdin } = render(<LicenseScreen onBack={onBack} />);
    await pressKey(stdin, '\x1B');
    expect(onBack).toHaveBeenCalled();
  });

  it('shows request tier step after selecting Request', async () => {
    const { lastFrame, stdin } = render(<LicenseScreen onBack={noop} />);
    // Navigate to "Request a license upgrade" (second item, key Down + Enter)
    await pressKey(stdin, '\x1B[B'); // Down arrow
    await pressKey(stdin, '\r');     // Enter
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Consultant|Enterprise/);
  });
});

// ---------------------------------------------------------------------------
// GuidanceBox toggle (#0714)
// ---------------------------------------------------------------------------
describe('GuidanceBox Ctrl+G toggle (#0714)', () => {
  it('starts collapsed and shows Ctrl+G hint', () => {
    const { lastFrame } = render(
      <GuidanceBox title="Test guidance" what="This is the guidance content." affordances={['Enter -- confirm']} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Ctrl+G');
    // #0737: collapsed state shows `what` as a one-line preview; affordances stay hidden.
    expect(frame).toContain('This is the guidance content.');
    expect(frame).not.toContain('Enter -- confirm');
  });

  it('expands on first Ctrl+G press', async () => {
    const { lastFrame, stdin } = render(
      <GuidanceBox title="Test guidance" what="This is the guidance content." affordances={['Enter -- confirm']} />,
    );
    await pressKey(stdin, '\x07'); // BEL = Ctrl+G
    const frame = lastFrame() ?? '';
    expect(frame).toContain('This is the guidance content.');
  });

  it('collapses on second Ctrl+G press (toggle round-trip)', async () => {
    const { lastFrame, stdin } = render(
      <GuidanceBox title="Test guidance" what="This is the guidance content." affordances={['Enter -- confirm']} />,
    );
    await pressKey(stdin, '\x07'); // expand
    await pressKey(stdin, '\x07'); // collapse
    const frame = lastFrame() ?? '';
    // #0737: collapsed state still shows `what` preview; only affordances disappear.
    expect(frame).toContain('This is the guidance content.');
    expect(frame).not.toContain('Enter -- confirm');
    expect(frame).toContain('Ctrl+G');
  });
});

// ---------------------------------------------------------------------------
// CredentialScreen
// ---------------------------------------------------------------------------
describe('CredentialScreen', () => {
  it('renders without crashing', () => {
    const { lastFrame } = render(<CredentialScreen onBack={noop} />);
    expect((lastFrame() ?? '').length).toBeGreaterThan(0);
  });

  it('shows SWAO header', () => {
    const { lastFrame } = render(<CredentialScreen onBack={noop} />);
    expect(lastFrame() ?? '').toContain('S W A O');
  });

  it('shows all credential menu options', () => {
    const { lastFrame } = render(<CredentialScreen onBack={noop} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('List stored credentials');
    expect(frame).toContain('Set / update a credential');
    expect(frame).toContain('Delete a credential');
    expect(frame).toContain('Back to main menu');
  });

  it('calls onBack when Esc pressed in menu', async () => {
    const onBack = vi.fn();
    const { stdin } = render(<CredentialScreen onBack={onBack} />);
    await pressKey(stdin, '\x1B');
    expect(onBack).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// RegimeSelectorScreen
// ---------------------------------------------------------------------------
describe('RegimeSelectorScreen', () => {
  const fakeWorkspace = '/tmp/swao-test-workspace';

  it('renders without crashing', () => {
    const { lastFrame } = render(
      <RegimeSelectorScreen workspacePath={fakeWorkspace} onDone={noop} />,
    );
    expect((lastFrame() ?? '').length).toBeGreaterThan(0);
  });

  it('shows SWAO header', () => {
    const { lastFrame } = render(
      <RegimeSelectorScreen workspacePath={fakeWorkspace} onDone={noop} />,
    );
    expect(lastFrame() ?? '').toContain('S W A O');
  });

  it('shows regime labels from mock (MultiSelect renders full label)', () => {
    const { lastFrame } = render(
      <RegimeSelectorScreen workspacePath={fakeWorkspace} onDone={noop} />,
    );
    const frame = lastFrame() ?? '';
    // regimePickerRow mock returns entry.name as label
    expect(frame).toContain('General Data Protection Regulation');
  });

  it('calls onDone when all frameworks are pre-selected and Enter confirms', async () => {
    const onDone = vi.fn();
    const { stdin } = render(
      <RegimeSelectorScreen workspacePath={fakeWorkspace} onDone={onDone} />,
    );
    // With no stored regimes, all frameworks are pre-selected via the
    // "All frameworks (recommended)" default; Enter confirms immediately.
    await pressKey(stdin, '\r');
    expect(onDone).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// LensesScreen
// ---------------------------------------------------------------------------
describe('LensesScreen', () => {
  it('renders without crashing', () => {
    const { lastFrame } = render(<LensesScreen onBack={noop} />);
    expect((lastFrame() ?? '').length).toBeGreaterThan(0);
  });

  it('shows SWAO header', () => {
    const { lastFrame } = render(<LensesScreen onBack={noop} />);
    expect(lastFrame() ?? '').toContain('S W A O');
  });

  it('shows lens IDs from mock', () => {
    const { lastFrame } = render(<LensesScreen onBack={noop} />);
    const frame = lastFrame() ?? '';
    // Two mock lenses -- rendered by id (lowercase)
    expect(frame).toContain('cloud-migration');
    expect(frame).toContain('security-review');
  });

  it('calls onBack when Esc pressed', async () => {
    const onBack = vi.fn();
    const { stdin } = render(<LensesScreen onBack={onBack} />);
    await pressKey(stdin, '\x1B');
    expect(onBack).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ReportScreen
// ---------------------------------------------------------------------------
describe('ReportScreen', () => {
  it('renders without crashing', () => {
    const { lastFrame } = render(<ReportScreen onBack={noop} />);
    expect((lastFrame() ?? '').length).toBeGreaterThan(0);
  });

  it('shows SWAO header', () => {
    const { lastFrame } = render(<ReportScreen onBack={noop} />);
    expect(lastFrame() ?? '').toContain('S W A O');
  });

  it('shows application ID input on initial render', () => {
    const { lastFrame } = render(<ReportScreen onBack={noop} />);
    const frame = lastFrame() ?? '';
    // ReportScreen starts on phase 'input-app' -- app name text input is first
    expect(frame).toContain('Application ID');
  });

  it('calls onBack when Esc pressed', async () => {
    const onBack = vi.fn();
    const { stdin } = render(<ReportScreen onBack={onBack} />);
    await pressKey(stdin, '\x1B');
    expect(onBack).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// LzCatalogueUpdateScreen (#0872)
// ---------------------------------------------------------------------------

// Consultant-tier return value used in the describe blocks below.
const CONSULTANT_RETURN = {
  state: {
    tier:                  'consultant' as const,
    valid:                 true,
    remaining_assessments: 500,
    expiry:                '2027-01-01',
    fingerprint:           'abc1234567890abc',
    licensee:              'Test User',
    email:                 'test@test.com',
    firstRun:              '2026-01-01',
    assessmentCount:       0,
    assessmentLimit:       null,
    exp:                   undefined,
  },
};

// Community-tier return value used to restore the mock after consultant tests.
const COMMUNITY_RETURN = {
  state: {
    tier:                  'community' as const,
    valid:                 true,
    remaining_assessments: 48,
    expiry:                '2027-01-01',
    fingerprint:           'abc1234567890abc',
    licensee:              'Test User',
    email:                 'test@test.com',
    firstRun:              '2026-01-01',
    assessmentCount:       5,
    assessmentLimit:       null,
    exp:                   undefined,
  },
};

describe('LzCatalogueUpdateScreen', () => {
  it('renders without crashing (community tier)', () => {
    const { lastFrame } = render(<LzCatalogueUpdateScreen onBack={noop} onOpenLicense={noop} />);
    expect((lastFrame() ?? '').length).toBeGreaterThan(0);
  });

  it('shows SWAO header', () => {
    const { lastFrame } = render(<LzCatalogueUpdateScreen onBack={noop} onOpenLicense={noop} />);
    expect(lastFrame() ?? '').toContain('S W A O');
  });

  it('shows Consultant licence upgrade prompt on community tier', () => {
    const { lastFrame } = render(<LzCatalogueUpdateScreen onBack={noop} onOpenLicense={noop} />);
    const frame = lastFrame() ?? '';
    // LicenseGate renders "Consultant licence required" for community tier.
    expect(frame).toContain('Consultant');
    expect(frame).toContain('licence required');
  });

  it('Escape calls onBack on community tier', async () => {
    const onBack = vi.fn();
    const { stdin } = render(<LzCatalogueUpdateScreen onBack={onBack} onOpenLicense={noop} />);
    await pressKey(stdin, '\x1B');
    expect(onBack).toHaveBeenCalled();
  });

  // Consultant-tier tests: override LicenseGuard.load for the duration of each test.
  describe('consultant tier provider picker', () => {
    beforeEach(() => {
      vi.mocked(LicenseGuard.load).mockReturnValue(CONSULTANT_RETURN as unknown as LicenseGuard);
    });

    afterEach(() => {
      // Restore the default community mock so subsequent tests are unaffected.
      vi.mocked(LicenseGuard.load).mockReturnValue(COMMUNITY_RETURN as unknown as LicenseGuard);
    });

    it('shows provider picker (not upgrade prompt)', () => {
      const { lastFrame } = render(<LzCatalogueUpdateScreen onBack={noop} onOpenLicense={noop} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Select provider');
    });

    it('provider list includes all, aws, and aws-esc', () => {
      const { lastFrame } = render(<LzCatalogueUpdateScreen onBack={noop} onOpenLicense={noop} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('all');
      expect(frame).toContain('aws');
      expect(frame).toContain('aws-esc');
    });

    it('Escape calls onBack in provider picker', async () => {
      const onBack = vi.fn();
      const { stdin } = render(<LzCatalogueUpdateScreen onBack={onBack} onOpenLicense={noop} />);
      await pressKey(stdin, '\x1B');
      expect(onBack).toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// SetupWizard (smoke test -- complex multi-step screen)
// ---------------------------------------------------------------------------
describe('SetupWizard', () => {
  it('renders without crashing', () => {
    const { lastFrame } = render(<SetupWizard onBack={noop} />);
    expect((lastFrame() ?? '').length).toBeGreaterThan(0);
  });

  it('shows SWAO header', () => {
    const { lastFrame } = render(<SetupWizard onBack={noop} />);
    expect(lastFrame() ?? '').toContain('S W A O');
  });

  it('shows step bar with Init as first step', () => {
    const { lastFrame } = render(<SetupWizard onBack={noop} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Init');
  });
});
