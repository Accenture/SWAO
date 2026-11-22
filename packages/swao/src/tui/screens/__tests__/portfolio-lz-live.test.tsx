// #3589: Portfolio Operations, landing zone live entries (Design 120 section 14.2).
// #4124: grouped menu, prerequisites checked before running ("needs: ...").
// #4125: a failed operation shows the full header, the error once and the
// guidance of the operation that ran. The screen lives in the private premium
// tree; the test is skipped where it is absent. The CLI is mocked at child_process.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { EventEmitter } from 'events';
import * as cp from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const PREMIUM_PRESENT = existsSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../../../../swao-premium/packages/@swao/module-portfolio/src/tui/PortfolioScreen.tsx'));

const wsRef = vi.hoisted(() => ({ path: null as string | null }));

vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    findWorkspace: vi.fn(() => wsRef.path),
    LicenseGuard: { load: vi.fn(() => ({ state: { tier: 'enterprise' as const, valid: true, assessmentCount: 0, firstRun: '2026-01-01', fingerprint: 'abc', daysElapsed: 0 } })) },
  };
});
vi.mock('child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('child_process')>();
  return { ...original, spawn: vi.fn() };
});

type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
const spawned: string[][] = [];
const children: FakeChild[] = [];
const tmp: string[] = [];
beforeEach(() => {
  spawned.length = 0;
  children.length = 0;
  wsRef.path = null;
  vi.mocked(cp.spawn).mockImplementation(((_bin: string, argv: string[]) => {
    spawned.push(argv.slice(1));
    const c = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() }) as FakeChild;
    children.push(c);
    return c;
  }) as unknown as typeof cp.spawn);
});
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A workspace with one registered landing zone, a live run, and optionally a portfolio merge. */
function workspace(opts: { merge?: boolean } = {}): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-portfolio-tui-'));
  tmp.push(d);
  writeFileSync(join(d, '.swao.yml'), ['name: demo', 'landing_zones:', '  - id: otc-test', '    provider: otc', ''].join('\n'));
  mkdirSync(join(d, 'landing-zones', 'otc-test', 'wsp', 'runs', '2026-11-08T10-00-00'), { recursive: true });
  if (opts.merge) {
    const run = join(d, 'wsp', 'lz-live-portfolio', 'runs', '2026-11-08T11-00-00');
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, 'lz-live-portfolio.yaml'), 'schema: lz-live-portfolio/1\n');
  }
  return d;
}

const settle = (ms = 80): Promise<void> => new Promise((r) => setTimeout(r, ms));
const DOWN = '\u001B[B';
// Entry order (#4124): 0 Landing Zone Readiness, 1 Engagement Hub, 2 Export BI,
// 3 Merge live runs, 4 Multi-Cloud Governance, 5 Client Policy Baseline Comparison.
async function pick(stdin: { write: (s: string) => void }, index: number): Promise<void> {
  await settle();
  for (let i = 0; i < index; i++) { stdin.write(DOWN); await settle(30); }
  stdin.write('\r'); await settle();
}

describe('PortfolioScreen, grouped menu and prerequisites (#4124)', () => {
  it.skipIf(!PREMIUM_PRESENT)('fresh workspace: both groups with readiness lines; every entry needs something and Enter does not start it', async () => {
    const { PortfolioScreen } = await import('@swao/module-portfolio');
    const { lastFrame, stdin } = render(<PortfolioScreen onBack={vi.fn()} version="0.0.0-test" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Application portfolio');
    expect(frame).toContain('needs at least 1 assessed app; now: none');
    expect(frame).toContain('Landing zone live portfolio');
    expect(frame).toContain('now: 0 landing zones');
    expect(frame).toContain('needs: Merge live runs');
    expect(frame).not.toMatch(/ -- /);
    await pick(stdin, 5);
    expect(spawned).toHaveLength(0);
    expect((lastFrame() ?? '').replace(/\s+/g, ' ')).toContain('Client Policy Baseline Comparison is not available yet');
  });

  it.skipIf(!PREMIUM_PRESENT)('a landing zone with a live run enables the merge; it asks about simulated runs, then runs the CLI', async () => {
    wsRef.path = workspace();
    const { PortfolioScreen } = await import('@swao/module-portfolio');
    const { lastFrame, stdin } = render(<PortfolioScreen onBack={vi.fn()} version="0.0.0-test" />);
    await pick(stdin, 3);
    expect(lastFrame()).toContain('Include simulated runs');
    expect(spawned).toHaveLength(0);
    stdin.write('y'); await settle();
    expect(spawned[0]).toEqual(['assess', '--portfolio', '--type', 'landing-zone-live', '--include-simulated']);
  });

  it.skipIf(!PREMIUM_PRESENT)('a publication without a merge offers to run Merge live runs; y starts it', async () => {
    wsRef.path = workspace();
    const { PortfolioScreen } = await import('@swao/module-portfolio');
    const { lastFrame, stdin } = render(<PortfolioScreen onBack={vi.fn()} version="0.0.0-test" />);
    await pick(stdin, 4);
    expect(spawned).toHaveLength(0);
    expect((lastFrame() ?? '').replace(/\s+/g, ' ')).toContain('Press y to run Merge live runs now');
    stdin.write('y'); await settle();
    expect(lastFrame()).toContain('Include simulated runs');
  });

  it.skipIf(!PREMIUM_PRESENT)('after a merge, Multi-Cloud Governance publishes the lz-live-portfolio profile', async () => {
    wsRef.path = workspace({ merge: true });
    const { PortfolioScreen } = await import('@swao/module-portfolio');
    const { stdin } = render(<PortfolioScreen onBack={vi.fn()} version="0.0.0-test" />);
    await pick(stdin, 4);
    expect(spawned[0]).toEqual(['publish', '--portfolio', '--block-profile', 'lz-live-portfolio']);
  });
});

describe('PortfolioScreen, failed operation (#4125)', () => {
  it.skipIf(!PREMIUM_PRESENT)('renders the full header, the error once with the next step, and the guidance of the operation that ran', async () => {
    wsRef.path = workspace({ merge: true });
    const { PortfolioScreen } = await import('@swao/module-portfolio');
    const { lastFrame, stdin } = render(<PortfolioScreen onBack={vi.fn()} version="0.0.0-test" />);
    await pick(stdin, 4);
    const child = children[0]!;
    const msg = 'Rendering failed: the publication template could not be written to wsp/publications because the folder is read-only';
    child.stderr.emit('data', Buffer.from(`[swao publish] Publishing the landing zone portfolio\n${msg}\n[error] publish.error Publish failed: ${msg}\n`));
    child.emit('close', 1);
    await settle();
    const frame = lastFrame() ?? '';
    expect(frame.split('\n').some((l) => /^\s*={20,}\s*$/.test(l))).toBe(true);
    const flat = frame.replace(/\s+/g, ' ');
    expect(flat.split('the folder is read-only').length - 1).toBe(1);
    expect(flat).toContain('Multi-Cloud Governance failed (exit 1)');
    expect(flat).toContain('Next step: this operation needs a portfolio merge');
    expect(frame).not.toContain('Portfolio LZR Result');
    expect(frame).toContain('Multi-Cloud Governance');
  });
});
