// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- TUI tests: LzCatalogueUpdateScreen update states (#0530)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// TU-08 (extension): LzCatalogueUpdateScreen running and done (success/fail) states.
// The basic provider list and community upgrade prompt are covered by
// tui-components.test.tsx; this file adds the in-progress and completion states.
//
// CLI equivalent : swao lz catalogue update --provider <X>
// MCP equivalent : n/a

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { EventEmitter } from 'events';
import * as ncp from 'node:child_process';
import * as nfs from 'node:fs';
import * as lzMod from '@swao/module-landing-zone';

// ---------------------------------------------------------------------------
// Mocks -- before imports (vi.mock is hoisted by Vitest)
// ---------------------------------------------------------------------------

// LzCatalogueUpdateScreen imports LicenseGuard from the local re-export at
// src/license/license-guard.ts which itself re-exports from @swao/core.
// Mocking @swao/core here covers both paths.
vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    findWorkspace: vi.fn(() => null),
    LicenseGuard: {
      load: vi.fn(() => ({
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

      })),
    },
  };
});

// LzCatalogueUpdateScreen uses node:child_process to run `swao lz catalogue update`.
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// #1523: mock node:fs and @swao/module-landing-zone for overwrite-warning tests.
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return {
    ...original,
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => []),
    readFileSync: vi.fn(() => Buffer.from('')),
  };
});

vi.mock('@swao/module-landing-zone', () => ({
  resolveLzCataloguesDir: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// Screen import -- after mock declarations
// ---------------------------------------------------------------------------
import { LzCatalogueUpdateScreen } from '../LzCatalogueUpdateScreen.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = vi.fn();

/** Build a minimal fake child process satisfying LzCatalogueUpdateScreen's usage. */
function makeFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { on: typeof EventEmitter.prototype.on };
    stderr: EventEmitter & { on: typeof EventEmitter.prototype.on };
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter() as typeof child.stdout;
  child.stderr = new EventEmitter() as typeof child.stderr;
  child.kill = vi.fn();
  return child;
}

/** Wait for Ink useEffect mount, send key, then wait for re-render. */
async function pressKey(stdin: { write: (s: string) => void }, key: string): Promise<void> {
  await new Promise<void>(r => setTimeout(r, 50));
  stdin.write(key);
  await new Promise<void>(r => setTimeout(r, 50));
}

// ---------------------------------------------------------------------------
// TU-08: LzCatalogueUpdateScreen in-progress and completion states
// ---------------------------------------------------------------------------
describe('LzCatalogueUpdateScreen -- TU-08: update in-progress and done states', () => {
  let fakeChild: ReturnType<typeof makeFakeChild>;

  beforeEach(() => {
    fakeChild = makeFakeChild();
    vi.mocked(ncp.spawn).mockReturnValue(fakeChild as unknown as ReturnType<typeof ncp.spawn>);
  });

  // Transition to 'running' by selecting the first provider option ('all').
  // Selecting an item via Enter fires SelectInput.onSelect which calls setPhase('running').
  it('shows the in-progress message when a provider is selected', async () => {
    const { lastFrame, stdin } = render(
      <LzCatalogueUpdateScreen onBack={noop} onOpenLicense={noop} />,
    );
    // Enter on the default selected item ('all') -> setPhase('running') -> useEffect spawns
    await pressKey(stdin, '\r');
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Updating');
    expect(frame).toContain('all');
  });

  it('shows "Update complete." after spawn exits with code 0', async () => {
    const { lastFrame, stdin } = render(
      <LzCatalogueUpdateScreen onBack={noop} onOpenLicense={noop} />,
    );
    await pressKey(stdin, '\r');                          // -> 'running'
    await new Promise<void>(r => setTimeout(r, 60));     // useEffect mounts
    fakeChild.stdout.emit('data', Buffer.from('fetching aws catalogue...\n'));
    fakeChild.emit('close', 0);
    await new Promise<void>(r => setTimeout(r, 100));    // re-render
    expect(lastFrame() ?? '').toContain('Update complete.');
  });

  it('shows failure message after spawn exits with non-zero code', async () => {
    const { lastFrame, stdin } = render(
      <LzCatalogueUpdateScreen onBack={noop} onOpenLicense={noop} />,
    );
    await pressKey(stdin, '\r');                          // -> 'running'
    await new Promise<void>(r => setTimeout(r, 60));
    fakeChild.stderr.emit('data', Buffer.from('error: network unreachable\n'));
    fakeChild.emit('close', 1);
    await new Promise<void>(r => setTimeout(r, 100));
    expect(lastFrame() ?? '').toContain('Update failed');
  });

  it('does not crash if spawn emits no output before close', async () => {
    const { lastFrame, stdin } = render(
      <LzCatalogueUpdateScreen onBack={noop} onOpenLicense={noop} />,
    );
    await pressKey(stdin, '\r');
    await new Promise<void>(r => setTimeout(r, 60));
    fakeChild.emit('close', 0);
    await new Promise<void>(r => setTimeout(r, 100));
    expect((lastFrame() ?? '').length).toBeGreaterThan(0);
    expect(lastFrame() ?? '').toContain('Update complete.');
  });
});

// ---------------------------------------------------------------------------
// TU-08b: warn-overwrite phase (#1523)
// ---------------------------------------------------------------------------
describe('LzCatalogueUpdateScreen -- TU-08b: overwrite warning (#1523)', () => {
  let fakeChild: ReturnType<typeof makeFakeChild>;

  beforeEach(() => {
    fakeChild = makeFakeChild();
    vi.mocked(ncp.spawn).mockReturnValue(fakeChild as unknown as ReturnType<typeof ncp.spawn>);
    // Default: no modified files (bundledDir absent)
    vi.mocked(nfs.existsSync).mockReturnValue(false);
    vi.mocked(lzMod.resolveLzCataloguesDir).mockReturnValue(null);
  });

  it('skips warning when no modified files (bundled dir absent)', async () => {
    const { lastFrame, stdin } = render(
      <LzCatalogueUpdateScreen onBack={noop} onOpenLicense={noop} />,
    );
    await pressKey(stdin, '\r'); // select 'all' -> detectModifiedCatalogues returns []
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Warning');
    expect(frame).toContain('Updating');
  });

  it('shows warning screen when modified files are detected', async () => {
    // findWorkspace returns '/fake/ws' so catalogDir exists; bundledDir exists;
    // file hashes differ -> file is flagged as modified.
    const { findWorkspace: mockFW } = await import('@swao/core');
    vi.mocked(mockFW).mockReturnValue('/fake/ws');
    vi.mocked(nfs.existsSync).mockReturnValue(true);
    vi.mocked(nfs.readdirSync).mockReturnValue(['gcp-europe-west3.json'] as unknown as ReturnType<typeof nfs.readdirSync>);
    vi.mocked(lzMod.resolveLzCataloguesDir).mockReturnValue('/bundled');
    // Workspace file and bundled file return different buffers -> modified
    vi.mocked(nfs.readFileSync)
      .mockReturnValueOnce(Buffer.from('workspace-content'))
      .mockReturnValueOnce(Buffer.from('bundled-content'));

    const { lastFrame, stdin } = render(
      <LzCatalogueUpdateScreen onBack={noop} onOpenLicense={noop} />,
    );
    await pressKey(stdin, '\r');
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Warning');
    expect(frame).toContain('gcp-europe-west3.json');
    expect(frame).toContain('modified');
  });

  it('proceeds to running on Enter in warn-overwrite phase', async () => {
    const { findWorkspace: mockFW } = await import('@swao/core');
    vi.mocked(mockFW).mockReturnValue('/fake/ws');
    vi.mocked(nfs.existsSync).mockReturnValue(true);
    vi.mocked(nfs.readdirSync).mockReturnValue(['gcp-europe-west3.json'] as unknown as ReturnType<typeof nfs.readdirSync>);
    vi.mocked(lzMod.resolveLzCataloguesDir).mockReturnValue('/bundled');
    vi.mocked(nfs.readFileSync)
      .mockReturnValueOnce(Buffer.from('ws'))
      .mockReturnValueOnce(Buffer.from('bundled'));

    const { lastFrame, stdin } = render(
      <LzCatalogueUpdateScreen onBack={noop} onOpenLicense={noop} />,
    );
    await pressKey(stdin, '\r'); // -> warn-overwrite
    expect(lastFrame() ?? '').toContain('Warning');
    await pressKey(stdin, '\r'); // Enter -> proceed -> running
    expect(lastFrame() ?? '').toContain('Updating');
  });

  it('calls onBack on Esc in warn-overwrite phase', async () => {
    const onBack = vi.fn();
    const { findWorkspace: mockFW } = await import('@swao/core');
    vi.mocked(mockFW).mockReturnValue('/fake/ws');
    vi.mocked(nfs.existsSync).mockReturnValue(true);
    vi.mocked(nfs.readdirSync).mockReturnValue(['gcp-europe-west3.json'] as unknown as ReturnType<typeof nfs.readdirSync>);
    vi.mocked(lzMod.resolveLzCataloguesDir).mockReturnValue('/bundled');
    vi.mocked(nfs.readFileSync)
      .mockReturnValueOnce(Buffer.from('ws'))
      .mockReturnValueOnce(Buffer.from('bundled'));

    const { stdin } = render(
      <LzCatalogueUpdateScreen onBack={onBack} onOpenLicense={noop} />,
    );
    await pressKey(stdin, '\r'); // -> warn-overwrite
    await pressKey(stdin, '\x1B'); // Esc -> cancel
    expect(onBack).toHaveBeenCalled();
  });
});
