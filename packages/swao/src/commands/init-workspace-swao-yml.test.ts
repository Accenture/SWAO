// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3344: `swao init` writes a minimal workspace-root .swao.yml so the
// documented `swao init` then `swao assess --app <id>` flow finds the
// workspace; an existing workspace .swao.yml is never overwritten.
// #3347: `swao init --reconfigure` without --name scaffolds no app.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Command } from 'commander';
import { load } from 'js-yaml';

// saveDefaultWorkspace writes to the operator's ~/.config/swao/config.json; keep tests off it.
vi.mock('@swao/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@swao/core')>();
  return { ...actual, saveDefaultWorkspace: vi.fn() };
});

import { findWorkspace } from '@swao/core';
import { ensureWorkspaceSwaoYml, registerInit } from './init.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'swao-init-ws-'));
  dirs.push(d);
  return d;
}

function runInit(args: string[]): number | undefined {
  const program = new Command('swao').exitOverride();
  registerInit(program);
  let exitCode: number | undefined;
  const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { exitCode = code; throw new Error('exit'); }) as typeof process.exit);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    program.parse(['init', ...args], { from: 'user' });
  } catch { /* exit sentinel */ } finally {
    exit.mockRestore(); log.mockRestore(); err.mockRestore();
  }
  return exitCode;
}

describe('ensureWorkspaceSwaoYml (#3344)', () => {
  it('writes a minimal workspace .swao.yml (wsp_version, engagement stub, imports_dir) when absent', () => {
    const ws = tmp();
    expect(ensureWorkspaceSwaoYml(ws)).toBe(true);
    const parsed = load(readFileSync(join(ws, '.swao.yml'), 'utf-8')) as Record<string, unknown>;
    expect(parsed['wsp_version']).toBe('0.9');
    expect(parsed['engagement']).toMatchObject({ client_code: '' });
    expect(parsed['imports_dir']).toBe('wsp/inputs/');
  });

  it('never overwrites an existing workspace .swao.yml', () => {
    const ws = tmp();
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\nengagement: { name: "Kept" }\n', 'utf-8');
    expect(ensureWorkspaceSwaoYml(ws)).toBe(false);
    expect(readFileSync(join(ws, '.swao.yml'), 'utf-8')).toContain('Kept');
  });
});

describe('swao init writes the workspace .swao.yml (#3344)', () => {
  it('init <dir> --name demo-app: findWorkspace resolves the workspace from its root', () => {
    const ws = tmp();
    expect(findWorkspace(ws)).not.toBe(ws);
    expect(runInit([ws, '--name', 'demo-app'])).toBe(0);
    expect(existsSync(join(ws, '.swao.yml'))).toBe(true);
    expect(existsSync(join(ws, 'apps', 'demo-app', '.swao.yml'))).toBe(true);
    expect(findWorkspace(ws)).toBe(ws);
  });

  it('a re-run on an app scaffolded without it repairs the missing workspace .swao.yml', () => {
    const ws = tmp();
    mkdirSync(join(ws, 'apps', 'demo-app'), { recursive: true });
    writeFileSync(join(ws, 'apps', 'demo-app', '.swao.yml'), 'app: demo-app\n', 'utf-8');
    expect(runInit([ws, '--name', 'demo-app'])).toBe(0);
    expect(existsSync(join(ws, '.swao.yml'))).toBe(true);
    expect(readFileSync(join(ws, 'apps', 'demo-app', '.swao.yml'), 'utf-8')).toBe('app: demo-app\n');
  });

  it('an existing workspace .swao.yml survives init', () => {
    const ws = tmp();
    writeFileSync(join(ws, '.swao.yml'), 'wsp_version: "0.9"\nengagement: { name: "Kept" }\n', 'utf-8');
    expect(runInit([ws, '--name', 'demo-app'])).toBe(0);
    expect(readFileSync(join(ws, '.swao.yml'), 'utf-8')).toContain('Kept');
  });
});

// #3347: --reconfigure without --name reconfigures the workspace only.
describe('swao init --reconfigure without --name scaffolds no app (#3347)', () => {
  function listTree(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      out.push(p);
      if (e.isDirectory()) out.push(...listTree(p));
    }
    return out.sort();
  }

  it('leaves apps/ unchanged (no apps/my-app) and both .swao.yml files byte-identical', () => {
    const ws = tmp();
    expect(runInit([ws, '--name', 'demo-app'])).toBe(0);
    const appsBefore = listTree(join(ws, 'apps'));
    const wsYml = readFileSync(join(ws, '.swao.yml'));
    const appYml = readFileSync(join(ws, 'apps', 'demo-app', '.swao.yml'));

    expect(runInit([ws, '--reconfigure'])).toBe(0);

    expect(existsSync(join(ws, 'apps', 'my-app'))).toBe(false);
    expect(listTree(join(ws, 'apps'))).toEqual(appsBefore);
    expect(readFileSync(join(ws, '.swao.yml')).equals(wsYml)).toBe(true);
    expect(readFileSync(join(ws, 'apps', 'demo-app', '.swao.yml')).equals(appYml)).toBe(true);
  });

  it('on an empty directory creates no apps/ entry and writes the workspace .swao.yml', () => {
    const ws = tmp();
    expect(runInit([ws, '--reconfigure'])).toBe(0);
    expect(existsSync(join(ws, '.swao.yml'))).toBe(true);
    expect(existsSync(join(ws, 'apps', 'my-app'))).toBe(false);
  });

  it('--reconfigure --name <id> still refreshes that app without overwriting its .swao.yml', () => {
    const ws = tmp();
    expect(runInit([ws, '--name', 'demo-app'])).toBe(0);
    const appYml = readFileSync(join(ws, 'apps', 'demo-app', '.swao.yml'));
    expect(runInit([ws, '--reconfigure', '--name', 'demo-app'])).toBe(0);
    expect(readFileSync(join(ws, 'apps', 'demo-app', '.swao.yml')).equals(appYml)).toBe(true);
    expect(existsSync(join(ws, 'apps', 'my-app'))).toBe(false);
  });
});
