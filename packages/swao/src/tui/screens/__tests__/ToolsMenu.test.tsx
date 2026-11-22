// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- TUI tests: ToolsMenu tier badge (#2659)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// TU-TM-01: [Consultant+] badge absent for Enterprise licence (#2659)
// TU-TM-02: [Consultant+] badge absent for Consultant licence
// TU-TM-03: [Consultant+] badge present for Community licence (upgrade prompt)

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

// ---------------------------------------------------------------------------
// Mocks -- before imports (vi.mock is hoisted by Vitest)
// ---------------------------------------------------------------------------

let mockTier: 'community' | 'consultant' | 'enterprise' = 'enterprise';

vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    LicenseGuard: {
      load: vi.fn(() => ({
        state: {
          tier:            mockTier,
          valid:           true,
          fingerprint:     'abc1234567890abc',
          firstRun:        '2026-01-01',
          assessmentCount: 0,
          assessmentLimit: null,
          exp:             undefined,
        },
      })),
    },
  };
});

// ---------------------------------------------------------------------------
// Component import -- after mock declarations
// ---------------------------------------------------------------------------
import { ToolsMenu } from '../ToolsMenu.js';

// ---------------------------------------------------------------------------
// TU-TM-01: Enterprise licence -- no [Consultant+] badge
// ---------------------------------------------------------------------------
describe('ToolsMenu -- TU-TM-01: Enterprise licence hides badge (#2659)', () => {
  it('does not show [Consultant+] badge when active tier is enterprise', () => {
    mockTier = 'enterprise';
    const { lastFrame } = render(<ToolsMenu onSelect={vi.fn()} onBack={vi.fn()} />);
    expect(lastFrame() ?? '').not.toContain('[Consultant+]');
  });
});

// ---------------------------------------------------------------------------
// TU-TM-02: Consultant licence -- no [Consultant+] badge
// ---------------------------------------------------------------------------
describe('ToolsMenu -- TU-TM-02: Consultant licence hides badge', () => {
  it('does not show [Consultant+] badge when active tier is consultant', () => {
    mockTier = 'consultant';
    const { lastFrame } = render(<ToolsMenu onSelect={vi.fn()} onBack={vi.fn()} />);
    expect(lastFrame() ?? '').not.toContain('[Consultant+]');
  });
});

// ---------------------------------------------------------------------------
// TU-TM-03: Community licence -- [Consultant+] badge shown as upgrade prompt
// ---------------------------------------------------------------------------
describe('ToolsMenu -- TU-TM-03: Community licence shows badge', () => {
  it('shows [Consultant+] badge when active tier is community', () => {
    mockTier = 'community';
    const { lastFrame } = render(<ToolsMenu onSelect={vi.fn()} onBack={vi.fn()} />);
    expect(lastFrame() ?? '').toContain('[Consultant+]');
  });
});

// ---------------------------------------------------------------------------
// #4126: Tools > Frameworks is removed together with swao framework install,
// uninstall, info and baseline (CLI/TUI parity, owner decision 2026-11-08).
// ---------------------------------------------------------------------------
describe('ToolsMenu -- #4126: no Frameworks entry', () => {
  it('offers no Frameworks item and no install or baseline action; keys stay 1 to 8', () => {
    mockTier = 'enterprise';
    const onSelect = vi.fn();
    const { lastFrame, stdin } = render(<ToolsMenu onSelect={onSelect} onBack={vi.fn()} />);
    const frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/Frameworks/);
    expect(frame).not.toMatch(/\b(install|baseline|upgrade)\b/i);
    expect(frame).toContain('8  Help');
    stdin.write('f');
    expect(onSelect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// #4127: Landing Zone Connections moved to the Landing Zone Live setup branch
// and step 1 of the Landing Zone Live Assessment; Tools keeps 1 to 8.
// ---------------------------------------------------------------------------
describe('ToolsMenu -- #4127: no Landing Zone Connections entry', () => {
  it('lists keys 1 to 8 only and key 9 selects nothing', () => {
    mockTier = 'enterprise';
    const onSelect = vi.fn();
    const { lastFrame, stdin } = render(<ToolsMenu onSelect={onSelect} onBack={vi.fn()} />);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Landing Zone Connections');
    const keys = [...frame.matchAll(/^\s*(?:❯\s*)?(\d) {2}\S/gm)].map((m) => m[1]);
    expect(keys).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '0']);
    stdin.write('9');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
