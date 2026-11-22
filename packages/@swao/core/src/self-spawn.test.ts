// #4241: the central self-spawn helper must give variant B (no script path,
// PKG_EXECPATH '') inside a pkg binary and node plus the entry script under
// node. The mixed variant (script path plus PKG_EXECPATH '') is the bug that
// made the binary read its snapshot path as a command.

import { afterEach, describe, expect, it } from 'vitest';
import { isPkgBinary, selfEntryScript, selfSpawnArgs, selfSpawnCommand, selfSpawnEnv } from './self-spawn.js';

const proc = process as { pkg?: unknown };

describe('isPkgBinary (#4241)', () => {
  afterEach(() => { delete proc.pkg; });

  it('is false under node and true when process.pkg is set', () => {
    expect(isPkgBinary()).toBe(false);
    proc.pkg = { entrypoint: 'C:\\snapshot\\swao\\dist\\bundle.cjs' };
    expect(isPkgBinary()).toBe(true);
  });

  it('reads an injected process object', () => {
    expect(isPkgBinary({ pkg: {} })).toBe(true);
    expect(isPkgBinary({})).toBe(false);
  });
});

describe('selfSpawnEnv (#4241)', () => {
  it('sets PKG_EXECPATH to an empty string and keeps the rest', () => {
    const env = selfSpawnEnv({ A: '1', PKG_EXECPATH: 'C:\\swao\\swao.exe' });
    expect(env).toEqual({ A: '1', PKG_EXECPATH: '' });
  });

  it('defaults to process.env without mutating it', () => {
    const env = selfSpawnEnv();
    expect(env['PKG_EXECPATH']).toBe('');
    expect(env['PATH'] ?? env['Path']).toBe(process.env['PATH'] ?? process.env['Path']);
    expect(env).not.toBe(process.env);
  });
});

describe('selfSpawnArgs / selfSpawnCommand (#4241)', () => {
  afterEach(() => { delete proc.pkg; });

  it('node mode: node execPath, entry script first, PKG_EXECPATH cleared', () => {
    const c = selfSpawnCommand(['assess', '--app', 'x'], { isPkg: false, execPath: '/usr/bin/node', scriptPath: '/repo/dist/index.js', env: { K: 'v' } });
    expect(c).toEqual({ command: '/usr/bin/node', args: ['/repo/dist/index.js', 'assess', '--app', 'x'], env: { K: 'v', PKG_EXECPATH: '' } });
  });

  it('pkg mode: the binary, CLI arguments only, PKG_EXECPATH cleared (never the snapshot path)', () => {
    const c = selfSpawnCommand(['lz', 'live', 'probe'], { isPkg: true, execPath: 'C:\\swao\\swao-enterprise-win-x64.exe', scriptPath: 'C:\\snapshot\\swao\\dist\\bundle.cjs', env: { PKG_EXECPATH: 'C:\\swao\\swao-enterprise-win-x64.exe' } });
    expect(c.command).toBe('C:\\swao\\swao-enterprise-win-x64.exe');
    expect(c.args).toEqual(['lz', 'live', 'probe']);
    expect(c.args.some((a) => a.includes('snapshot'))).toBe(false);
    expect(c.env['PKG_EXECPATH']).toBe('');
  });

  it('pkg mode from a simulated process.pkg with the real runtime defaults', () => {
    proc.pkg = { entrypoint: 'C:\\snapshot\\swao\\dist\\bundle.cjs' };
    const c = selfSpawnCommand(['--version']);
    expect(c.command).toBe(process.execPath);
    expect(c.args).toEqual(['--version']);
    expect(c.env['PKG_EXECPATH']).toBe('');
  });

  it('node mode with the real runtime defaults puts process.argv[1] first', () => {
    const c = selfSpawnCommand(['health-check']);
    expect(c.command).toBe(process.execPath);
    expect(c.args).toEqual([selfEntryScript(), 'health-check']);
  });

  it('node mode without an entry script passes the arguments only', () => {
    expect(selfSpawnArgs(['a'], { isPkg: false, scriptPath: '' })).toEqual(['a']);
  });

  it('copies the argument list', () => {
    const args = ['a'];
    const out = selfSpawnArgs(args, { isPkg: true });
    expect(out).toEqual(['a']);
    expect(out).not.toBe(args);
  });
});
