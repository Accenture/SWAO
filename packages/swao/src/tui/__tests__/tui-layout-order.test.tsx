// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, gate G-07: every screen on ScreenLayout (#4248)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Design 126 section 13.2 G-07 and section 3: every screen (`*Screen.tsx`,
// `*Menu.tsx`, `*Wizard.tsx` in every TUI tree outside tui-kit) renders
// ScreenLayout, which draws the blocks in the fixed order with the key hints
// directly above the guidance box (#4256: or renders through FlowFrame, the
// ScreenLayout frame of the Application and LZ Catalog flows, with no phase
// left on the legacy header). Allowlist of the screens not migrated yet:
// allowlists/tui-layout-order.json (one entry per screen with the migration
// row that moves it; it may only shrink). The render check covers the order
// at 100 columns here (ink-testing-library); tui-kit's ScreenLayout.test.tsx
// covers 100 and 80.

import { describe, it, expect } from 'vitest';
import React from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { ScreenLayout, KEY_HINTS, formatKeyHints } from '@swao/tui-kit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGES_DIR, compareWithAllowlist, loadAllowlist, scan, tuiFiles } from '../../__tests__/helpers/tui-gate.js';
import { isScreenFile, isWizardStepFile, notOnScreenLayout, stepBypassesFrame } from '../../__tests__/helpers/tui-gate-rules.js';

function screenFiles(): string[] {
  return tuiFiles({ includeTuiKit: false }).filter(isScreenFile);
}

describe('G-07 every screen on ScreenLayout (#4248, Design 126 section 13.2)', () => {
  it('flags a screen without ScreenLayout; passes one that renders it', () => {
    expect(isScreenFile('a/tui/screens/ToolsMenu.tsx')).toBe(true);
    expect(isScreenFile('a/tui/screens/SetupWizard.tsx')).toBe(true);
    expect(isScreenFile('a/setup/steps/step-ui.tsx')).toBe(false);
    expect(notOnScreenLayout('return <Box><Header /></Box>;')).toEqual([1]);
    expect(notOnScreenLayout('return <ScreenLayout header={h} keys={k} guidance={g}>x</ScreenLayout>;')).toEqual([]);
  });

  it('#4256: a flow screen on FlowFrame passes only without the legacy header', () => {
    expect(notOnScreenLayout('return <FlowFrame {...frame} keys={k}>x</FlowFrame>;')).toEqual([]);
    expect(notOnScreenLayout('if (a) return <FlowFrame {...frame}>x</FlowFrame>;\nreturn <Box><Header subtitle="x" /></Box>;')).toEqual([1]);
    expect(notOnScreenLayout('if (a) return <FlowFrame {...frame}>x</FlowFrame>;\nreturn <ChallengePromptPhase Header={Header} />;')).toEqual([1]);
    // FlowFrame itself draws ScreenLayout (or, with ownGuidance, the same blocks 1 to 4 in order).
    const frameFile = join(PACKAGES_DIR, '@swao', 'module-app-assessment', 'src', 'tui', 'assess', 'shared', 'flow-frame.tsx');
    const frameText = readFileSync(frameFile, 'utf-8');
    expect(frameText).toMatch(/<ScreenLayout\b/);
    expect(frameText).not.toMatch(/<Header\b/);
  });

  it('a new screen off the layout fails and a migrated screen makes its entry stale', () => {
    const allow = { gate: 'G-07', rule: 'x', entries: { 'a/XScreen.tsx': { count: 1, issue: '#4257' } } };
    expect(compareWithAllowlist({ 'a/XScreen.tsx': [1], 'a/NewScreen.tsx': [1] }, allow).newOffenders).toHaveLength(1);
    expect(compareWithAllowlist({}, allow).stale).toHaveLength(1);
  });

  it('every screen is on ScreenLayout or on the allowlist', () => {
    const verdict = compareWithAllowlist(scan(screenFiles(), notOnScreenLayout), loadAllowlist('tui-layout-order.json'));
    expect(verdict).toEqual({ newOffenders: [], stale: [] });
  });

  it('finds the screens of swao, the modules and swao-premium (guards against a wrong root)', () => {
    const files = screenFiles().map((f) => f.replace(/[\\]/g, '/'));
    // #4344: AssessScreen and LzCatalogueManageScreen are retired (30 screens remain).
    expect(files.length).toBeGreaterThan(25);
    expect(files.some((f) => f.endsWith('tui/screens/SetupWizard.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('tui/screens/ToolsMenu.tsx'))).toBe(true);
  });

  it('the ScreenLayout frame has the section 3 order and the hints directly above the box (100 columns)', () => {
    const { lastFrame, unmount } = render(
      <ScreenLayout
        header={{ subtitle: 'Setup: Application Assessment', stepInfo: 'Step 3 of 8', version: '1.6.1', licenseState: { tier: 'community', assessmentCount: 3, firstRun: '2026-01-01' } }}
        steps={{ labels: ['Init', 'LLM', 'Source access', 'Tools', 'Health check', 'MCP', 'Test code', 'Ready'], current: 3 }}
        title={{ title: 'Tools', subtitle: 'Scanners and IaC tools on this machine, and what each one adds to the assessment.' }}
        keys={KEY_HINTS.picker}
        guidance={{ title: 'Tools', what: 'What each scanner adds to the assessment.' }}
      >
        <Text>CONTENT</Text>
      </ScreenLayout>,
    );
    const lines = (lastFrame() ?? '').split(String.fromCharCode(10)).map((l) => l.trimEnd());
    unmount();
    const idx = [
      lines.findIndex((l) => l.startsWith('S W A O')),
      lines.findIndex((l) => l.startsWith('Community Edition')),
      lines.findIndex((l) => l.includes('Source access') && l.includes('Ready')),
      lines.indexOf('Tools'),
      lines.indexOf('CONTENT'),
      lines.indexOf(formatKeyHints(KEY_HINTS.picker)),
    ];
    for (const i of idx) expect(i).toBeGreaterThanOrEqual(0);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    const hints = idx[5]!;
    expect(lines[hints + 1]!.startsWith(String.fromCodePoint(0x250c))).toBe(true);
    expect(lines[hints + 2]).toContain('Tools   (Ctrl+G for guidance)');
  });
});

// #4343 (audit B-1): G-07 for the Setup Wizard steps. A step hands its title,
// hint line and guidance to the wizard through SetupStepFrame (setup-frame.tsx,
// #4254); a step file that draws a frame block itself (KeyHints, GuidanceBox,
// StepTitle, a header or a ScreenLayout) bypasses the frame. Allowlist:
// allowlists/tui-step-frame.json (one count per drawn block; it may only shrink).
describe('G-07 every Setup Wizard step through SetupStepFrame (#4343, audit B-1)', () => {
  it('flags a step that draws a frame block; passes one on SetupStepFrame', () => {
    expect(isWizardStepFile('/r/swao/packages/swao/src/setup/steps/ApplicationAppStep.tsx')).toBe(true);
    expect(isWizardStepFile('/r/swao/packages/swao/src/tui/screens/wizard/steps/ReadyStep.tsx')).toBe(true);
    expect(isWizardStepFile('/r/swao/packages/swao/src/setup/setup-frame.tsx')).toBe(false);
    expect(isWizardStepFile('/r/swao/packages/swao/src/tui/screens/ToolsMenu.tsx')).toBe(false);
    expect(stepBypassesFrame('return <Box><Text>x</Text><KeyHints hints={k} /></Box>;')).toEqual([1]);
    expect(stepBypassesFrame('return <SetupStepFrame title="Tools" kind="picker">x</SetupStepFrame>;')).toEqual([]);
  });

  it('every wizard step file is on the frame or on the allowlist', () => {
    const files = tuiFiles({ includeTuiKit: false }).filter(isWizardStepFile);
    expect(files.length).toBeGreaterThan(10);
    const verdict = compareWithAllowlist(scan(files, stepBypassesFrame), loadAllowlist('tui-step-frame.json'));
    expect(verdict).toEqual({ newOffenders: [], stale: [] });
  });
});
