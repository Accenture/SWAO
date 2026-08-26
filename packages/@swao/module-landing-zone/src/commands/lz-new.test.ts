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

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { registerLz } from './lz.js';
import { resolveProviderCatalogue } from '../catalogue/loader.js';
import { LzServiceCatalogueSchema } from '@swao/core';

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerLz(program);
  return program;
}

function destPath(workspaceRoot: string, provider: string): string {
  return join(workspaceRoot, 'wsp', 'inputs', 'catalogs', 'lz-catalogues', provider, 'index.json');
}

describe('swao lz catalogue new (#1436)', () => {
  let tmp: string | null = null;

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = null;
    }
  });

  it('creates scaffold at workspace canonical path', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-lz-new-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const program = buildProgram();
    await program.parseAsync(['node', 'swao', 'lz', 'catalogue', 'new', 'mycloud', '--workspace', tmp]);
    const dest = destPath(tmp, 'mycloud');
    expect(existsSync(dest)).toBe(true);
  });

  it('scaffold is strict-schema-valid JSON (#1436 AC -- scaffold must not immediately brick list)', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-lz-new-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const program = buildProgram();
    await program.parseAsync(['node', 'swao', 'lz', 'catalogue', 'new', 'testprovider', '--workspace', tmp]);
    const dest = destPath(tmp, 'testprovider');
    const raw = JSON.parse(readFileSync(dest, 'utf-8'));
    // Must parse without throwing under the strict Zod schema.
    expect(() => LzServiceCatalogueSchema.parse(raw)).not.toThrow();
  });

  it('scaffold provider field matches argument', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-lz-new-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const program = buildProgram();
    await program.parseAsync(['node', 'swao', 'lz', 'catalogue', 'new', 'newcloud', '--workspace', tmp]);
    const dest = destPath(tmp, 'newcloud');
    const parsed = JSON.parse(readFileSync(dest, 'utf-8')) as { meta: { provider: string } };
    expect(parsed.meta.provider).toBe('newcloud');
  });

  it('errors when destination already exists without --force', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-lz-new-'));
    const dest = destPath(tmp, 'aws');
    mkdirSync(join(tmp, 'wsp', 'inputs', 'catalogs', 'lz-catalogues', 'aws'), { recursive: true });
    writeFileSync(dest, '{}');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => {
      throw new Error('process.exit:' + String(_code ?? ''));
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const program = buildProgram();
    await expect(
      program.parseAsync(['node', 'swao', 'lz', 'catalogue', 'new', 'aws', '--workspace', tmp])
    ).rejects.toThrow();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('overwrites with --force', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-lz-new-'));
    const dest = destPath(tmp, 'aws');
    mkdirSync(join(tmp, 'wsp', 'inputs', 'catalogs', 'lz-catalogues', 'aws'), { recursive: true });
    writeFileSync(dest, '{"old": true}');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const program = buildProgram();
    await program.parseAsync(['node', 'swao', 'lz', 'catalogue', 'new', 'aws', '--workspace', tmp, '--force']);
    const parsed = JSON.parse(readFileSync(dest, 'utf-8')) as { meta: { provider: string } };
    expect(parsed.meta.provider).toBe('aws');
  });

  it('scaffold round-trips through resolveProviderCatalogue as workspace provenance', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-lz-new-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const program = buildProgram();
    await program.parseAsync(['node', 'swao', 'lz', 'catalogue', 'new', 'aws', '--workspace', tmp]);
    // The scaffold must load without error and be provenance:workspace.
    const { catalogue, provenance } = resolveProviderCatalogue('aws', tmp);
    expect(provenance).toBe('workspace');
    expect(catalogue.meta.provider).toBe('aws');
  });
});
