// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- TUI component tests: HealthCheckScreen (#0530)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// TU-05: DoctorScreen shows all-green state
// TU-06: DoctorScreen shows failing check prominently
//
// CLI equivalent : swao health-check (also: swao doctor)
// MCP equivalent : n/a (health-check output is TUI/CLI-only in this milestone)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { EventEmitter } from 'events';
import * as cp from 'child_process';

// ---------------------------------------------------------------------------
// Mocks -- before imports (vi.mock is hoisted by Vitest)
// ---------------------------------------------------------------------------

vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    findWorkspace: vi.fn(() => null),
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

// HealthCheckScreen spawns `swao health-check`; intercept to avoid real process.
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// HealthCheckScreen reads workspace .swao.yml (best-effort engagement info);
// stub readFileSync so the try-catch in the component returns null safely.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: vi.fn(() => { throw new Error('mock: file not found'); }),
  };
});

// ---------------------------------------------------------------------------
// Screen import -- after mock declarations
// ---------------------------------------------------------------------------
import { HealthCheckScreen } from '@swao/module-health-check';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = vi.fn();

/** Build a minimal fake child process that satisfies HealthCheckScreen's usage. */
function makeFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

// health-check header format: "  [N/M] <Name>...  <STATUS>  <message>"
const ALL_GREEN_LINES = [
  '  [1/2] git..............  ok  git 2.40.0',
  '  [2/2] node.............  ok  v20.0.0',
].join('\n');

const FAILING_GIT_LINES = '  [1/1] git..............  FAIL  not found in PATH';

// ---------------------------------------------------------------------------
// TU-05: DoctorScreen shows all-green state
// ---------------------------------------------------------------------------
describe('HealthCheckScreen -- TU-05: all-green state', () => {
  let fakeChild: ReturnType<typeof makeFakeChild>;

  beforeEach(() => {
    fakeChild = makeFakeChild();
    vi.mocked(cp.spawn).mockReturnValue(fakeChild as unknown as ReturnType<typeof cp.spawn>);
  });

  it('renders without crashing', async () => {
    const { lastFrame } = render(<HealthCheckScreen onBack={noop} version="0.0.0-test" />);
    await new Promise<void>(r => setTimeout(r, 60)); // effect mounts
    fakeChild.stdout.emit('data', Buffer.from(ALL_GREEN_LINES));
    fakeChild.emit('close', 0);
    await new Promise<void>(r => setTimeout(r, 100)); // re-render
    expect((lastFrame() ?? '').length).toBeGreaterThan(0);
  });

  it('shows S W A O header', async () => {
    const { lastFrame } = render(<HealthCheckScreen onBack={noop} version="0.0.0-test" />);
    expect(lastFrame() ?? '').toContain('S W A O');
  });

  it('shows "All probes passed." when all checks exit 0', async () => {
    const { lastFrame } = render(<HealthCheckScreen onBack={noop} version="0.0.0-test" />);
    await new Promise<void>(r => setTimeout(r, 60));
    fakeChild.stdout.emit('data', Buffer.from(ALL_GREEN_LINES));
    fakeChild.emit('close', 0);
    await new Promise<void>(r => setTimeout(r, 100));
    expect(lastFrame() ?? '').toContain('All probes passed.');
  });

  it('does not show the failure banner when all probes are OK', async () => {
    const { lastFrame } = render(<HealthCheckScreen onBack={noop} version="0.0.0-test" />);
    await new Promise<void>(r => setTimeout(r, 60));
    fakeChild.stdout.emit('data', Buffer.from(ALL_GREEN_LINES));
    fakeChild.emit('close', 0);
    await new Promise<void>(r => setTimeout(r, 100));
    expect(lastFrame() ?? '').not.toContain('need attention');
  });
});

// ---------------------------------------------------------------------------
// TU-06: DoctorScreen shows failing check prominently
// ---------------------------------------------------------------------------
describe('HealthCheckScreen -- TU-06: failing check visibility', () => {
  let fakeChild: ReturnType<typeof makeFakeChild>;

  beforeEach(() => {
    fakeChild = makeFakeChild();
    vi.mocked(cp.spawn).mockReturnValue(fakeChild as unknown as ReturnType<typeof cp.spawn>);
  });

  it('does not crash when a probe fails', async () => {
    const { lastFrame } = render(<HealthCheckScreen onBack={noop} version="0.0.0-test" />);
    await new Promise<void>(r => setTimeout(r, 60));
    fakeChild.stdout.emit('data', Buffer.from(FAILING_GIT_LINES));
    fakeChild.emit('close', 1);
    await new Promise<void>(r => setTimeout(r, 100));
    expect((lastFrame() ?? '').length).toBeGreaterThan(0);
  });

  it('shows "need attention" banner when a probe exits with non-zero code', async () => {
    const { lastFrame } = render(<HealthCheckScreen onBack={noop} version="0.0.0-test" />);
    await new Promise<void>(r => setTimeout(r, 60));
    fakeChild.stdout.emit('data', Buffer.from(FAILING_GIT_LINES));
    fakeChild.emit('close', 1);
    await new Promise<void>(r => setTimeout(r, 100));
    expect(lastFrame() ?? '').toContain('need attention');
  });

  it('renders the failing probe name in the output', async () => {
    const { lastFrame } = render(<HealthCheckScreen onBack={noop} version="0.0.0-test" />);
    await new Promise<void>(r => setTimeout(r, 60));
    fakeChild.stdout.emit('data', Buffer.from(FAILING_GIT_LINES));
    fakeChild.emit('close', 1);
    await new Promise<void>(r => setTimeout(r, 100));
    // HealthCheckProbeList parses the "git" probe name from the header line
    expect(lastFrame() ?? '').toContain('git');
  });
});
