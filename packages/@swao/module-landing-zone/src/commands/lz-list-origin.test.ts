// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { findWorkspace } from '@swao/core';
import { registerLz } from './lz.js';

// findWorkspace falls back to ~/.config/swao/config.json which can return the
// developer's real workspace even when process.cwd() is a temp dir (#1512).
// Stub it out at module level so each test controls the return value explicitly.
vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  return { ...actual, findWorkspace: vi.fn() };
});

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerLz(program);
  return program;
}

// Minimal valid catalogue used for workspace override tests.
function validCatalogue(provider: string): string {
  return JSON.stringify({
    meta: {
      schema_version: '0.1',
      name: `${provider} test`,
      provider,
      last_updated: '2026-08-06',
      source: { mode: 'curated' },
      confidence: 'medium',
    },
    regions: [{ id: 'test-region', services: [] }],
  });
}

describe('swao lz catalogue list --origin (#1436)', () => {
  let tmp: string | null = null;
  let logLines: string[] = [];

  beforeEach(() => {
    // Default: no workspace (prevents global-config fallback from leaking in).
    vi.mocked(findWorkspace).mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    logLines = [];
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = null;
    }
  });

  it('shows bundled for all providers when no workspace overrides', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-lz-list-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmp);
    vi.spyOn(console, 'log').mockImplementation((msg: unknown) => { logLines.push(String(msg)); });
    const program = buildProgram();
    await program.parseAsync(['node', 'swao', 'lz', 'catalogue', 'list', '--origin']);
    const originLines = logLines.filter((l) => l.includes('ORIGIN'));
    expect(originLines.length).toBeGreaterThan(0);
    for (const line of originLines) {
      expect(line).toContain('bundled');
    }
  });

  it('shows workspace for aws when aws per-provider subdir present in workspace', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-lz-list-'));
    // Override findWorkspace to simulate a workspace at tmp.
    vi.mocked(findWorkspace).mockReturnValue(tmp);
    // Create workspace aws override.
    const awsDir = join(tmp, 'wsp', 'inputs', 'catalogs', 'lz-catalogues', 'aws');
    mkdirSync(awsDir, { recursive: true });
    writeFileSync(join(awsDir, 'index.json'), validCatalogue('aws'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmp);
    vi.spyOn(console, 'log').mockImplementation((msg: unknown) => { logLines.push(String(msg)); });
    const program = buildProgram();
    await program.parseAsync(['node', 'swao', 'lz', 'catalogue', 'list', '--origin']);
    // The aws line should show workspace.
    const awsLine = logLines.find((l) => /^\s+aws\s/.test(l) && l.includes('ORIGIN'));
    expect(awsLine).toBeDefined();
    expect(awsLine).toContain('workspace');
    // Other providers must still show bundled (per-ID isolation).
    const azureLine = logLines.find((l) => /^\s+azure\s/.test(l) && l.includes('ORIGIN'));
    if (azureLine) expect(azureLine).toContain('bundled');
  });

  it('list without --origin does not show ORIGIN column', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-lz-list-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmp);
    vi.spyOn(console, 'log').mockImplementation((msg: unknown) => { logLines.push(String(msg)); });
    const program = buildProgram();
    await program.parseAsync(['node', 'swao', 'lz', 'catalogue', 'list']);
    const originLines = logLines.filter((l) => l.includes('ORIGIN'));
    expect(originLines).toHaveLength(0);
  });

  it('#3298: lists every bundled catalogue from its meta block and the coming-soon providers from _coming-soon.json', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-lz-list-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmp);
    vi.spyOn(console, 'log').mockImplementation((msg: unknown) => { logLines.push(String(msg)); });
    await buildProgram().parseAsync(['node', 'swao', 'lz', 'catalogue', 'list']);
    for (const p of ['aws', 'aws-esc', 'aws-iso-e', 'azure', 'azure-local', 'delos', 'gcp', 'oci', 'otc', 'stackit']) {
      expect(logLines.some((l) => new RegExp(`^\\s+${p}\\s`).test(l)), p).toBe(true);
    }
    expect(logLines.find((l) => /^\s+gcp\s/.test(l))).toMatch(/GCP service catalogue {2}\[updated \d{4}-\d{2}-\d{2}, source scrape, confidence medium, \d+ region\(s\)\]/);
    expect(logLines).toContain('  coming soon: ionos, ovhcloud');
  });

  it('#3298: an older workspace whose catalogue folder carries an index.json keeps working; the index is not read', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-lz-list-'));
    vi.mocked(findWorkspace).mockReturnValue(tmp);
    const dir = join(tmp, 'wsp', 'inputs', 'catalogs', 'lz-catalogues');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.json'), JSON.stringify({
      catalogues: [{ provider: 'ghost', file: 'ghost.json', name: 'Ghost', last_updated: '2020-01-01', source: 'curated', confidence: 'low' }],
      coming_soon: ['ghost-soon'],
    }));
    writeFileSync(join(dir, 'acme.json'), validCatalogue('acme'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmp);
    vi.spyOn(console, 'log').mockImplementation((msg: unknown) => { logLines.push(String(msg)); });
    await buildProgram().parseAsync(['node', 'swao', 'lz', 'catalogue', 'list', '--origin']);
    expect(logLines[0]).toBe(`Landing-zone catalogues (${dir}):`);
    expect(logLines.find((l) => /^\s+acme\s/.test(l))).toMatch(/acme test .*workspace copy.*ORIGIN workspace/);
    expect(logLines.find((l) => /^\s+azure\s/.test(l))).toMatch(/ORIGIN bundled/);
    expect(logLines.join('\n')).not.toMatch(/ghost/);
  });
});
