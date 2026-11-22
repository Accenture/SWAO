// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- TUI tests: no line past the header rule (#4110)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Owner rule (#4110): no text line of a TUI screen extends beyond the `=`
// header rule. ink-testing-library renders at 100 columns, so the rule is
// headerRuleWidth(100) = 98 columns. HW-01 renders the Assessment Type screen
// at every cursor position and with the guidance box expanded; HW-02 renders
// a sample of other screens.

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    LicenseGuard: {
      load: vi.fn(() => ({
        state: {
          tier: 'community' as const, valid: true, remaining_assessments: 48, expiry: '2027-01-01',
          fingerprint: 'abc1234567890abc', licensee: 'Test User', email: 'test@test.com',
          firstRun: '2026-01-01', assessmentCount: 0, assessmentLimit: null, exp: undefined,
        },
      })),
    },
  };
});

import { CredentialStore } from '@swao/core';
import { headerRuleWidth, fitToWidth, TerminalFrame, GUIDANCE_CLOSE_HINT } from '@swao/tui-kit';
import { AssessmentTypeScreen, LzLiveAssessmentScreen } from '@swao/module-app-assessment';
import { PublishScreen, ServeScreen } from '@swao/module-html-report';
import { ToolsMenu } from '../ToolsMenu.js';
import { MainMenu } from '../MainMenu.js';
import { HelpScreen } from '../HelpScreen.js';
import { LicenseScreen } from '../LicenseScreen.js';
import { LzCatalogueUpdateScreen } from '../LzCatalogueUpdateScreen.js';
import { LzConnectionsScreen } from '../LzConnectionsScreen.js';
import { HealthCheckScreen } from '@swao/module-health-check';
import { ReportScreen } from '../ReportScreen.js';
import { ExportBiScreen } from '@swao/module-powerbi';
import { CredentialScreen } from '../CredentialScreen.js';
import { LensesScreen } from '../LensesScreen.js';
import { LlmGatewayUpdateScreen } from '../LlmGatewayUpdateScreen.js';
import { IngestScreen } from '../IngestScreen.js';
import { SupportBundleScreen } from '../SupportBundleScreen.js';
import { LlmAssessmentScreen } from '../LlmAssessmentScreen.js';
import { ServiceInitScreen } from '../ServiceInitScreen.js';
import { UpgradePromptScreen } from '../UpgradePromptScreen.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RULE = headerRuleWidth(100);
const noop = vi.fn();
const settle = (ms = 80): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Lines whose text ends right of the header rule (the rule's own right edge when drawn, else RULE for embedded screens). */
function overlong(frame: string | undefined): string[] {
  const lines = (frame ?? '').split('\n');
  const rule = lines.find((l) => /^\s*={20,}\s*$/.test(l));
  const edge = rule ? rule.trimEnd().length : RULE;
  return lines.filter((l) => l.trimEnd().length > edge);
}

describe('header rule width helpers (#4110)', () => {
  it('headerRuleWidth follows the terminal within 63..100', () => {
    expect(headerRuleWidth(100)).toBe(98);
    expect(headerRuleWidth(200)).toBe(100);
    expect(headerRuleWidth(40)).toBe(63);
    expect(headerRuleWidth(undefined)).toBe(78);
  });

  it('fitToWidth keeps short text and cuts long text with "..." at the width', () => {
    expect(fitToWidth('short', 10)).toBe('short');
    const cut = fitToWidth('a long line that does not fit', 12);
    expect(cut.length).toBeLessThanOrEqual(12);
    expect(cut.endsWith('...')).toBe(true);
    expect(fitToWidth('abc', 0)).toBe('');
  });

  it('fitToWidth middle cut keeps the start and the end (file names in paths, #4115)', () => {
    const path = `D:\\${'x'.repeat(80)}\\claude_desktop_config.json`;
    const cut = fitToWidth(path, 60, 'middle');
    expect(cut).toHaveLength(60);
    expect(cut.startsWith('D:\\')).toBe(true);
    expect(cut.endsWith('claude_desktop_config.json')).toBe(true);
    expect(fitToWidth('short', 40, 'middle')).toBe('short');
  });
});

describe('HW-01: Assessment Type screen stays within the header rule (#4110)', () => {
  it('every cursor position, collapsed and expanded guidance', async () => {
    const { lastFrame, stdin } = render(<AssessmentTypeScreen onSelect={noop} version="0.0.0" onBack={noop} />);
    await settle();
    for (let i = 0; i < 5; i++) {
      expect(overlong(lastFrame())).toEqual([]);
      stdin.write('\x07'); await settle(); // expand
      expect(overlong(lastFrame())).toEqual([]);
      stdin.write('\x07'); await settle(); // collapse
      stdin.write('\u001B[B'); await settle();
    }
  });

  it('shows the short descriptions and keeps the CLI command in the guidance box', async () => {
    const { lastFrame, stdin } = render(<AssessmentTypeScreen onSelect={noop} version="0.0.0" onBack={noop} />);
    await settle();
    const frame = lastFrame() ?? '';
    // #4255: the SelectInput aligns the descriptions in one column.
    expect(frame).toMatch(/Landing Zone Live Assessment\s+based on your live CSP data/);
    expect(frame).not.toMatch(/\]\s.*\s{2}swao /);
    stdin.write('\x07'); await settle();
    expect(lastFrame()).toContain('swao assess --app <id>');
  });
});

describe('HW-02: a sample of other screens stays within the header rule (#4110)', () => {
  it('Publish', async () => {
    const { lastFrame } = render(<PublishScreen onBack={noop} version="0.0.0" />);
    await settle();
    expect(overlong(lastFrame())).toEqual([]);
  });

  it('Tools menu', async () => {
    const { lastFrame } = render(<ToolsMenu onSelect={noop} onBack={noop} />);
    await settle();
    expect(overlong(lastFrame())).toEqual([]);
  });

  it('Landing Zone Connections (embedded, guidance expanded)', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'swao-hw-'));
    writeFileSync(join(ws, '.swao.yml'), 'name: demo\n');
    const { lastFrame, stdin } = render(
      <LzConnectionsScreen embedded onBack={noop} workspace={ws} run={async () => 0} store={new CredentialStore(mkdtempSync(join(tmpdir(), 'swao-hw-vault-')))} drivers={[]} />,
    );
    await settle(150);
    expect(overlong(lastFrame())).toEqual([]);
    stdin.write('\x07'); await settle();
    expect(overlong(lastFrame())).toEqual([]);
  });
});

describe('HW-03: further screens, collapsed and expanded guidance (#4110)', () => {
  const cases: Array<[string, () => JSX.Element]> = [
    ['Main menu', () => <MainMenu onSelect={noop} />],
    ['Help', () => <HelpScreen onBack={noop} />],
    ['Licence', () => <LicenseScreen onBack={noop} />],
    ['Update LZ Catalogue', () => <LzCatalogueUpdateScreen onBack={noop} onOpenLicense={noop} />],
    ['Landing Zone Live Assessment', () => <LzLiveAssessmentScreen onBack={noop} version="0.0.0" workspace={process.cwd()} run={async () => 0} />],
  ];
  for (const [name, screen] of cases) {
    it(name, async () => {
      const { lastFrame, stdin } = render(screen());
      await settle(100);
      expect(overlong(lastFrame())).toEqual([]);
      stdin.write('\x07'); await settle(100);
      expect(overlong(lastFrame())).toEqual([]);
    });
  }
});

describe('HW-04: the remaining App screens, collapsed and expanded guidance (#4110)', () => {
  const cases: Array<[string, () => JSX.Element]> = [
    ['Health Check', () => <HealthCheckScreen onBack={noop} version="0.0.0" />],
    ['Generate Report', () => <ReportScreen onBack={noop} onOpenLicense={noop} />],
    ['Export BI', () => <ExportBiScreen onBack={noop} version="0.0.0" />],
    ['Credentials', () => <CredentialScreen onBack={noop} />],
    ['Lenses', () => <LensesScreen onBack={noop} onRunAssessment={noop} />],
    ['Update LLM Gateway', () => <LlmGatewayUpdateScreen onBack={noop} />],
    ['Ingest', () => <IngestScreen onBack={noop} />],
    ['Support bundle', () => <SupportBundleScreen onBack={noop} />],
    ['Serve', () => <ServeScreen onBack={noop} version="0.0.0" />],
    ['LLM Assessment', () => <LlmAssessmentScreen onBack={noop} />],
    ['Service Portfolio', () => <ServiceInitScreen onBack={noop} />],
    ['Upgrade prompt', () => <UpgradePromptScreen feature="Publish HTML" requiredTier="consultant" description="HTML publications of assessment runs" onBack={noop} onOpenLicenseScreen={noop} />],
  ];
  for (const [name, screen] of cases) {
    it(name, async () => {
      const { lastFrame, stdin, unmount } = render(screen());
      await settle(150);
      expect(overlong(lastFrame())).toEqual([]);
      stdin.write('\x07'); await settle(150);
      expect(overlong(lastFrame())).toEqual([]);
      unmount();
    });
  }
});


// #4123 criterion 1 on the owner's screens: inside the App's TerminalFrame,
// Ctrl+G twice leaves the frame identical to the first one, and every frame
// (collapsed, expanded, collapsed) is exactly rows - 1 lines.
describe('HW-05: Ctrl+G twice on the owner screens inside TerminalFrame (#4123)', () => {
  const ROWS = 40;
  const ws = mkdtempSync(join(tmpdir(), 'swao-hw5-'));
  writeFileSync(join(ws, '.swao.yml'), 'name: demo\n');
  const cases: Array<[string, () => JSX.Element]> = [
    ['Publish', () => <PublishScreen onBack={noop} version="0.0.0" />],
    ['Assessment Type', () => <AssessmentTypeScreen onSelect={noop} version="0.0.0" onBack={noop} />],
    ['LZ Connections (embedded)', () => <LzConnectionsScreen embedded onBack={noop} workspace={ws} run={async () => 0} store={new CredentialStore(mkdtempSync(join(tmpdir(), 'swao-hw5-vault-')))} drivers={[]} />],
  ];
  for (const [name, screen] of cases) {
    it(name, async () => {
      const { lastFrame, stdin, unmount } = render(<TerminalFrame rows={ROWS}>{screen()}</TerminalFrame>);
      await settle(150);
      const first = (lastFrame() ?? '').split('\n');
      expect(first).toHaveLength(ROWS - 1);
      stdin.write('\u0007'); await settle(150);
      const expanded = (lastFrame() ?? '').split('\n');
      expect(expanded).toHaveLength(ROWS - 1);
      expect(expanded.join('\n')).toContain(GUIDANCE_CLOSE_HINT);
      stdin.write('\u0007'); await settle(150);
      expect((lastFrame() ?? '').split('\n')).toEqual(first);
      unmount();
    });
  }
});
