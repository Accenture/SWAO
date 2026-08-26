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
  it('shows the correct browser URL after selecting HTML Editor mode', async () => {
    // MODES assigns key '2' to the HTML Editor entry (ACTIVE_MODES index 1).
    // Pressing '2' from mode-select transitions to the editor-confirm phase,
    // which renders the URL the browser will open at.
    const { lastFrame, stdin } = render(<PublishScreen onBack={noop} version="0.0.0-test" />);
    await pressKey(stdin, '2');
    const frame = lastFrame() ?? '';
    // The screen renders: "Your browser will open at: http://127.0.0.1:4001"
    expect(frame).toContain('127.0.0.1');
    expect(frame).toContain('4001');
  });

  it('shows the HTML Editor label on the confirmation screen', async () => {
    const { lastFrame, stdin } = render(<PublishScreen onBack={noop} version="0.0.0-test" />);
    await pressKey(stdin, '2');
    expect(lastFrame() ?? '').toContain('HTML Editor');
  });
});
