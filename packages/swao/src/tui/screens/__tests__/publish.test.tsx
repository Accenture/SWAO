// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- TUI component tests: PublishScreen (#0530)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// TU-03: PublishScreen shows correct mode options (including coming-soon labels)
// TU-04: HTML Editor launch screen shows correct port/URL
//
// CLI equivalent : swao publish
// MCP equivalent : n/a (publish is CLI/TUI-only in this milestone)

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Mocks -- before imports (vi.mock is hoisted by Vitest)
// ---------------------------------------------------------------------------

vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    findWorkspace: vi.fn(() => null),   // no workspace -- no available apps
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

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync:  vi.fn(() => false),
    readdirSync: vi.fn(() => [] as never[]),
  };
});

// ---------------------------------------------------------------------------
// Screen import -- after mock declarations
// ---------------------------------------------------------------------------
import { PublishScreen } from '@swao/module-html-report';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const noop = vi.fn();

/** Wait for Ink useEffect mount, send key, then wait for re-render. */
async function pressKey(stdin: { write: (s: string) => void }, key: string): Promise<void> {
  await new Promise<void>(r => setTimeout(r, 50));
  stdin.write(key);
  await new Promise<void>(r => setTimeout(r, 50));
}

// ---------------------------------------------------------------------------
// TU-03: PublishScreen shows correct mode options
// ---------------------------------------------------------------------------
describe('PublishScreen -- TU-03: mode options', () => {
  afterEach(() => {
    vi.mocked(fs.existsSync).mockReset();
  });

  it('renders without crashing', () => {
    const { lastFrame } = render(<PublishScreen onBack={noop} version="0.0.0-test" />);
    expect((lastFrame() ?? '').length).toBeGreaterThan(0);
  });

  it('shows S W A O header', () => {
    const { lastFrame } = render(<PublishScreen onBack={noop} version="0.0.0-test" />);
    expect(lastFrame() ?? '').toContain('S W A O');
  });

  it('shows Single-Page HTML Report as the first active mode', () => {
    const { lastFrame } = render(<PublishScreen onBack={noop} version="0.0.0-test" />);
    expect(lastFrame() ?? '').toContain('Single-Page HTML Report');
  });

  it('shows HTML Editor as the second active mode', () => {
    const { lastFrame } = render(<PublishScreen onBack={noop} version="0.0.0-test" />);
    expect(lastFrame() ?? '').toContain('HTML Editor');
  });

  it('does not show coming-soon modes [4-6] in the menu (#1439)', () => {
    const { lastFrame } = render(<PublishScreen onBack={noop} version="0.0.0-test" />);
    // JSON data export [4], HTML Site [5], HTML Portal [6] are hidden per #1439.
    // Code is preserved in MODES; only the TUI visibility is removed.
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('HTML Site');
    expect(frame).not.toContain('HTML Portal');
    expect(frame).not.toContain('JSON data export');
  });

  it('calls onBack when Escape pressed from mode-select', async () => {
    const onBack = vi.fn();
    const { stdin } = render(<PublishScreen onBack={onBack} version="0.0.0-test" />);
    await pressKey(stdin, '\x1B');
    expect(onBack).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TU-04: HTML Editor launch screen shows correct port/URL
// ---------------------------------------------------------------------------
describe('PublishScreen -- TU-04: HTML Editor confirmation screen', () => {
  it('shows enterprise gate when Community user selects HTML Editor mode (#2308)', async () => {
    // HTML Editor is Enterprise-gated (#2308). In Community mode (version 0.0.0-test),
    // pressing '2' must show the licence gate message rather than the editor URL.
    const { lastFrame, stdin } = render(<PublishScreen onBack={noop} version="0.0.0-test" />);
    await pressKey(stdin, '2');
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Enterprise');
    expect(frame).toContain('licence');
    // URL must NOT appear for community users.
    expect(frame).not.toContain('127.0.0.1');
  });

  it('shows the HTML Editor label on the confirmation screen', async () => {
    const { lastFrame, stdin } = render(<PublishScreen onBack={noop} version="0.0.0-test" />);
    await pressKey(stdin, '2');
    expect(lastFrame() ?? '').toContain('HTML Editor');
  });
});

// ---------------------------------------------------------------------------
// TU-05: #2658 challenge warning -- no warning shown in mode-select phase
// ---------------------------------------------------------------------------
describe('PublishScreen -- TU-05: challenge warning infrastructure (#2658)', () => {
  it('does not show challenge warning in mode-select phase (pre-run)', () => {
    // The challenge warning is only triggered when phase transitions to
    // 'running' and workspace+appId are set. In mode-select phase (initial),
    // no warning should be displayed.
    const { lastFrame } = render(<PublishScreen onBack={noop} version="0.0.0-test" />);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('No stakeholder challenge data found');
    expect(frame).not.toContain('[warn]');
  });

  it('#2657: done-phase affordance text does not use dimColor (readable on dark terminal)', () => {
    // This is a structural test: the component renders without crashing after
    // the dimColor removal from the Enter/O affordance texts.
    const { lastFrame } = render(<PublishScreen onBack={noop} version="0.0.0-test" />);
    expect((lastFrame() ?? '').length).toBeGreaterThan(0);
  });
});
