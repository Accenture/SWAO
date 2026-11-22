// #3589: Tools > Update LZ Catalogue, "Source: Live landing zone catalogue"
// (Design 120 sections 10.2, 14.2). The CLI is mocked at node:child_process;
// the workspace is a real temporary folder. Pins the source selector (shown
// only with a registered landing zone), the dry-run diff before any write,
// the write after confirmation, and --new <slug> with the 077 slug rule.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { EventEmitter } from 'events';
import * as ncp from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ws = vi.hoisted(() => ({ root: null as string | null }));

vi.mock('@swao/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@swao/core')>();
  return {
    ...original,
    findWorkspace: vi.fn(() => ws.root),
    LicenseGuard: { load: vi.fn(() => ({ state: { tier: 'consultant' as const, valid: true, assessmentCount: 0, firstRun: '2026-01-01', fingerprint: 'abc' } })) },
  };
});
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

import { LzCatalogueUpdateScreen } from '../LzCatalogueUpdateScreen.js';
import { buildLiveCatalogueUpdateArgs, dryRunWritable, listLiveCatalogueRuns, validateNewSlug } from '../lz-catalogue-live-flow.js';

type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
const children: { args: string[]; child: FakeChild }[] = [];

beforeEach(() => {
  children.length = 0;
  vi.mocked(ncp.spawn).mockImplementation(((_bin: string, argv: string[]) => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() }) as FakeChild;
    children.push({ args: argv.slice(argv.indexOf('lz')), child });
    return child;
  }) as unknown as typeof ncp.spawn);
});
const tmp: string[] = [];
afterEach(() => { ws.root = null; for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

function workspace(withLz = true): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-lzcu-live-'));
  tmp.push(d);
  writeFileSync(join(d, '.swao.yml'), withLz
    ? 'name: demo\nlanding_zones:\n  - id: otc-prod\n    provider: otc\n    scopes:\n      - id: platform\n        kind: platform\n        auth: iam-password-token\n'
    : 'name: demo\n');
  for (const run of ['2026-11-01T08-00-00', '2026-11-03T08-00-00']) {
    const r = join(d, 'landing-zones', 'otc-prod', 'wsp', 'runs', run);
    mkdirSync(r, { recursive: true });
    writeFileSync(join(r, 'lz-live-catalogue.json'), '{}');
  }
  mkdirSync(join(d, 'landing-zones', 'otc-prod', 'wsp', 'runs', '2026-11-02T08-00-00'), { recursive: true }); // no catalogue
  ws.root = d;
  return d;
}

const settle = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));
const noop = vi.fn();

describe('Update LZ Catalogue, live source (#3589)', () => {
  it('without a registered landing zone the screen opens on the provider list (no source selector)', async () => {
    workspace(false);
    const { lastFrame } = render(<LzCatalogueUpdateScreen onBack={noop} onOpenLicense={noop} />);
    expect(lastFrame()).toContain('Select provider');
    expect(lastFrame()).not.toContain('Select the catalogue source');
  });

  it('select LZ + run -> dry-run diff -> confirm -> write', async () => {
    workspace();
    const { lastFrame, stdin } = render(<LzCatalogueUpdateScreen onBack={noop} onOpenLicense={noop} />);
    expect(lastFrame()).toContain('Select the catalogue source');
    expect(lastFrame()).toContain('Source: Internet sources');
    expect(lastFrame()).toContain('Source: Live landing zone catalogue');
    await settle(100);
    stdin.write('2'); await settle();
    expect(lastFrame()).toContain('otc-prod');
    stdin.write('\r'); await settle();
    // runs with a live catalogue only, newest first, after "latest"
    expect(lastFrame()).toContain('2026-11-03T08-00-00');
    expect(lastFrame()).not.toContain('2026-11-02T08-00-00');
    stdin.write('\u001B[B'); await settle();
    stdin.write('\r'); await settle(100);
    expect(children[0]?.args).toEqual(['lz', 'catalogue', 'update', '--provider', 'otc', '--source', 'live', '--lz', 'otc-prod', '--run', '2026-11-03T08-00-00', '--dry-run']);
    children[0]!.child.stdout.emit('data', Buffer.from('otc: +1 region(s), +3 service(s)\n  [dry-run] would write: /ws/wsp/inputs/catalogs/lz-catalogues/otc.json\n'));
    children[0]!.child.emit('close', 0);
    await settle(100);
    expect(lastFrame()).toContain('+3 service(s)');
    expect(lastFrame()).toContain('Write this catalogue');
    expect(children).toHaveLength(1);
    stdin.write('y'); await settle(100);
    expect(children[1]?.args).toEqual(['lz', 'catalogue', 'update', '--provider', 'otc', '--source', 'live', '--lz', 'otc-prod', '--run', '2026-11-03T08-00-00']);
    children[1]!.child.stdout.emit('data', Buffer.from('  written: /ws/wsp/inputs/catalogs/lz-catalogues/otc.json\n'));
    children[1]!.child.emit('close', 0);
    await settle(100);
    expect(lastFrame()).toContain('Update complete. (1 provider file written)');
  });

  it('a dry run with nothing to write (manual catalogue skipped) offers no write', async () => {
    workspace();
    const { lastFrame, stdin } = render(<LzCatalogueUpdateScreen onBack={noop} onOpenLicense={noop} />);
    await settle(100);
    stdin.write('2'); await settle();
    stdin.write('\r'); await settle();
    stdin.write('\r'); await settle(100);
    expect(children[0]?.args).not.toContain('--run');
    children[0]!.child.stdout.emit('data', Buffer.from('otc: source.mode "manual" (hand-maintained, Q-30), skipped\n'));
    children[0]!.child.emit('close', 0);
    await settle(100);
    expect(lastFrame()).toContain('Nothing to write');
    stdin.write('y'); await settle(100);
    expect(children).toHaveLength(1);
  });

  it('build a new catalogue file: slug validated, then --new <slug>', async () => {
    workspace();
    const { lastFrame, stdin } = render(<LzCatalogueUpdateScreen onBack={noop} onOpenLicense={noop} />);
    await settle(100);
    stdin.write('3'); await settle();
    stdin.write('\r'); await settle();
    stdin.write('\r'); await settle();
    expect(lastFrame()).toContain('New catalogue file slug');
    for (const ch of 'Bad Slug') stdin.write(ch);
    await settle();
    stdin.write('\r'); await settle();
    expect(lastFrame()).toContain('catalogue slug must match');
    expect(children).toHaveLength(0);
    for (let i = 0; i < 8; i++) stdin.write('\u007F');
    await settle();
    for (const ch of 'private-dc1') stdin.write(ch);
    await settle();
    stdin.write('\r'); await settle(100);
    expect(children[0]?.args).toEqual(['lz', 'catalogue', 'update', '--new', 'private-dc1', '--source', 'live', '--lz', 'otc-prod', '--dry-run']);
  });

  it('Internet sources continues to the existing provider list; Esc there returns to the selector', async () => {
    workspace();
    const { lastFrame, stdin } = render(<LzCatalogueUpdateScreen onBack={noop} onOpenLicense={noop} />);
    await settle(100);
    stdin.write('1'); await settle();
    expect(lastFrame()).toContain('Select provider');
    stdin.write('\u001B'); await settle();
    expect(lastFrame()).toContain('Select the catalogue source');
  });
});

describe('lz-catalogue-live-flow (#3589)', () => {
  it('argv, writable dry run, slug rule and runs list', () => {
    expect(buildLiveCatalogueUpdateArgs({ lzId: 'a', provider: 'otc', dryRun: false })).toEqual(['lz', 'catalogue', 'update', '--provider', 'otc', '--source', 'live', '--lz', 'a']);
    expect(dryRunWritable(0, ['  [dry-run] would write: x'])).toBe(true);
    expect(dryRunWritable(1, ['  [dry-run] would write: x'])).toBe(false);
    expect(dryRunWritable(0, ['skipped'])).toBe(false);
    expect(validateNewSlug('dc1-cloud')).toBeNull();
    expect(validateNewSlug('1dc')).toMatch(/must match/);
    const d = workspace();
    expect(listLiveCatalogueRuns(d, 'otc-prod')).toEqual(['2026-11-03T08-00-00', '2026-11-01T08-00-00']);
    expect(listLiveCatalogueRuns(d, 'none')).toEqual([]);
  });
});
