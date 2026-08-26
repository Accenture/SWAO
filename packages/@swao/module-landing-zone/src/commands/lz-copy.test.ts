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

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerLz(program);
  return program;
}

function destPath(workspaceRoot: string, provider: string): string {
  return join(workspaceRoot, 'wsp', 'inputs', 'catalogs', 'lz-catalogues', provider, 'index.json');
}

describe('swao lz catalogue copy (#1436)', () => {
  let tmp: string | null = null;

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = null;
    }
  });

  it('copies bundled aws catalogue to workspace per-provider directory', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-lz-copy-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const program = buildProgram();
    await program.parseAsync(['node', 'swao', 'lz', 'catalogue', 'copy', 'aws', '--workspace', tmp]);
    const dest = destPath(tmp, 'aws');
    expect(existsSync(dest)).toBe(true);
    const parsed = JSON.parse(readFileSync(dest, 'utf-8')) as { meta: { provider: string } };
    expect(parsed.meta.provider).toBe('aws');
  });

  it('errors and exits on unknown provider', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-lz-copy-'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => {
      throw new Error('process.exit:' + String(_code ?? ''));
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const program = buildProgram();
    await expect(
      program.parseAsync(['node', 'swao', 'lz', 'catalogue', 'copy', 'unknownprovider', '--workspace', tmp])
    ).rejects.toThrow();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('errors when destination already exists without --force', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-lz-copy-'));
    const dest = destPath(tmp, 'aws');
    mkdirSync(join(tmp, 'wsp', 'inputs', 'catalogs', 'lz-catalogues', 'aws'), { recursive: true });
    writeFileSync(dest, '{}');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => {
      throw new Error('process.exit:' + String(_code ?? ''));
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const program = buildProgram();
    await expect(
      program.parseAsync(['node', 'swao', 'lz', 'catalogue', 'copy', 'aws', '--workspace', tmp])
    ).rejects.toThrow();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('overwrites existing destination with --force', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-lz-copy-'));
    const dest = destPath(tmp, 'aws');
    mkdirSync(join(tmp, 'wsp', 'inputs', 'catalogs', 'lz-catalogues', 'aws'), { recursive: true });
    writeFileSync(dest, '{"old": true}');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const program = buildProgram();
    await program.parseAsync(['node', 'swao', 'lz', 'catalogue', 'copy', 'aws', '--workspace', tmp, '--force']);
    const parsed = JSON.parse(readFileSync(dest, 'utf-8')) as { meta: { provider: string } };
    expect(parsed.meta.provider).toBe('aws');
  });

  it('copied file round-trips through resolveProviderCatalogue as workspace provenance', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-lz-copy-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const program = buildProgram();
    await program.parseAsync(['node', 'swao', 'lz', 'catalogue', 'copy', 'aws', '--workspace', tmp]);
    const { catalogue, provenance } = resolveProviderCatalogue('aws', tmp);
    expect(provenance).toBe('workspace');
    expect(catalogue.meta.provider).toBe('aws');
  });

  it('azure workspace copy does not affect aws (per-ID isolation)', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'swao-lz-copy-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const program = buildProgram();
    await program.parseAsync(['node', 'swao', 'lz', 'catalogue', 'copy', 'azure', '--workspace', tmp]);
    const azure = resolveProviderCatalogue('azure', tmp);
    expect(azure.provenance).toBe('workspace');
    const aws = resolveProviderCatalogue('aws', tmp);
    expect(aws.provenance).toBe('bundled');
  });
});
