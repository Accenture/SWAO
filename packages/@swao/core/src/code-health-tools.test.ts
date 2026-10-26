// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3487: code health tool location and version pins (fake runner, no real tool).

import { describe, it, expect } from 'vitest';
import { join, resolve } from 'path';
import {
  CODE_HEALTH_TOOL_VERSIONS,
  PROBE_DETECT_OPTIONS,
  TOOL_VERSION_TIMEOUT_MS,
  detectCodeHealthTool,
  detectCodeHealthTools,
  isVersionSupported,
  parseToolVersionNumber,
  resolveJscpdShimEntry,
  toolInvocationCandidates,
} from './code-health-tools.js';
import type { ToolRunRequest, ToolRunResult, ToolRunner } from './tool-runner.js';

const ok = (stdout: string): ToolRunResult => ({ exitCode: 0, stdout, stderr: '', timedOut: false, spawnError: null });
const enoent: ToolRunResult = { exitCode: null, stdout: '', stderr: '', timedOut: false, spawnError: 'spawn lizard ENOENT' };

function fakeRunner(answer: (req: ToolRunRequest) => ToolRunResult): { runner: ToolRunner; calls: ToolRunRequest[] } {
  const calls: ToolRunRequest[] = [];
  return { calls, runner: async (req) => { calls.push(req); return answer(req); } };
}

describe('version pins', () => {
  it('parses the version lines the tools print', () => {
    expect(parseToolVersionNumber('1.17.13\n')).toBe('1.17.13');
    expect(parseToolVersionNumber('4.0.5')).toBe('4.0.5');
    expect(parseToolVersionNumber('lizard 1.17.10 (python 3.12)')).toBe('1.17.10');
    expect(parseToolVersionNumber('no version here')).toBeNull();
  });

  it('checks the supported range (min inclusive, below exclusive)', () => {
    const r = CODE_HEALTH_TOOL_VERSIONS.lizard;
    expect(isVersionSupported('1.17.0', r)).toBe(true);
    expect(isVersionSupported('1.17.13', r)).toBe(true);
    expect(isVersionSupported('1.18.0', r)).toBe(false);
    expect(isVersionSupported('1.16.9', r)).toBe(false);
    expect(isVersionSupported('4.0.5', CODE_HEALTH_TOOL_VERSIONS.jscpd)).toBe(true);
    expect(isVersionSupported('3.5.10', CODE_HEALTH_TOOL_VERSIONS.jscpd)).toBe(false);
    expect(isVersionSupported('garbage', r)).toBe(false);
  });
});

describe('tool location (no shell, fixed argv)', () => {
  it('lizard: executable first, then python -m lizard', () => {
    expect(toolInvocationCandidates('lizard', { platform: 'win32' })).toEqual([
      { command: 'lizard', prefixArgs: [] },
      { command: 'python', prefixArgs: ['-m', 'lizard'] },
    ]);
    expect(toolInvocationCandidates('lizard', { platform: 'linux' })[1]).toEqual({ command: 'python3', prefixArgs: ['-m', 'lizard'] });
  });

  it('jscpd on POSIX: the executable', () => {
    expect(toolInvocationCandidates('jscpd', { platform: 'darwin' })).toEqual([{ command: 'jscpd', prefixArgs: [] }]);
  });

  it('jscpd on Windows: resolves the npm shim entry (global layout) and runs it with node', () => {
    const dir = 'C:\\Users\\u\\AppData\\Roaming\\npm';
    const files = new Set([join(dir, 'jscpd.cmd'), join(dir, 'node_modules', 'jscpd', 'bin', 'jscpd')]);
    const env = { PATH: `C:\\Windows;${dir}` };
    const exists = (p: string): boolean => files.has(p);
    expect(resolveJscpdShimEntry(env, exists)).toBe(join(dir, 'node_modules', 'jscpd', 'bin', 'jscpd'));
    expect(toolInvocationCandidates('jscpd', { platform: 'win32', env, exists })).toEqual([
      { command: 'node', prefixArgs: [join(dir, 'node_modules', 'jscpd', 'bin', 'jscpd')] },
    ]);
  });

  it('jscpd on Windows: local node_modules/.bin layout', () => {
    const bin = 'C:\\proj\\node_modules\\.bin';
    const entry = resolve(bin, '..', 'jscpd', 'bin', 'jscpd');
    const files = new Set([join(bin, 'jscpd.cmd'), entry]);
    expect(resolveJscpdShimEntry({ Path: bin }, (p) => files.has(p))).toBe(entry);
  });

  it('jscpd on Windows: a shim whose entry cannot be resolved counts as absent', async () => {
    const dir = 'C:\\tools';
    const files = new Set([join(dir, 'jscpd.cmd')]);
    const opts = { platform: 'win32' as const, env: { PATH: dir }, exists: (p: string) => files.has(p) };
    expect(toolInvocationCandidates('jscpd', opts)).toEqual([]);
    const { runner, calls } = fakeRunner(() => ok('4.0.5'));
    const d = await detectCodeHealthTool('jscpd', runner, opts);
    expect(d.status).toBe('absent');
    expect(calls).toHaveLength(0);
  });
});

describe('detectCodeHealthTool', () => {
  it('present: first candidate answers with a supported version', async () => {
    const { runner, calls } = fakeRunner(() => ok('1.17.13\n'));
    const d = await detectCodeHealthTool('lizard', runner, { platform: 'linux' });
    expect(d).toMatchObject({ name: 'lizard', status: 'present', version: '1.17.13', supported_range: '>=1.17.0 <1.18.0' });
    expect(d.invocation).toEqual({ command: 'lizard', prefixArgs: [] });
    expect(calls[0]?.args).toEqual(['--version']);
  });

  it('falls back to python -m lizard when the executable is not on PATH', async () => {
    const { runner, calls } = fakeRunner((req) => (req.command === 'lizard' ? enoent : ok('1.17.10')));
    const d = await detectCodeHealthTool('lizard', runner, { platform: 'linux' });
    expect(d.status).toBe('present');
    expect(d.invocation).toEqual({ command: 'python3', prefixArgs: ['-m', 'lizard'] });
    expect(calls[1]?.args).toEqual(['-m', 'lizard', '--version']);
  });

  it('absent: every candidate fails (ENOENT, non-zero exit, timeout)', async () => {
    let n = 0;
    const { runner } = fakeRunner(() => (n++ === 0 ? enoent : { exitCode: 1, stdout: '', stderr: 'No module named lizard', timedOut: false, spawnError: null }));
    expect((await detectCodeHealthTool('lizard', runner, { platform: 'linux' })).status).toBe('absent');
    const timeout = fakeRunner(() => ({ exitCode: null, stdout: '', stderr: '', timedOut: true, spawnError: null }));
    expect((await detectCodeHealthTool('jscpd', timeout.runner, { platform: 'linux' })).status).toBe('absent');
  });

  it('retries a timed-out version probe once (cold start)', async () => {
    let n = 0;
    const { runner, calls } = fakeRunner(() => (n++ === 0 ? { exitCode: null, stdout: '', stderr: '', timedOut: true, spawnError: null } : ok('4.0.5')));
    expect((await detectCodeHealthTool('jscpd', runner, { platform: 'linux' })).status).toBe('present');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.timeoutMs).toBe(TOOL_VERSION_TIMEOUT_MS);
  });

  it('health-check probe options: 5 s ceiling and no retry, so a hanging interpreter cannot stall the probe', async () => {
    const { runner, calls } = fakeRunner(() => ({ exitCode: null, stdout: '', stderr: '', timedOut: true, spawnError: null }));
    expect((await detectCodeHealthTool('lizard', runner, { platform: 'linux', ...PROBE_DETECT_OPTIONS })).status).toBe('absent');
    expect(calls).toHaveLength(2); // one call per candidate (lizard, python3 -m lizard), no retries
    expect(calls.every((c) => c.timeoutMs === 5_000)).toBe(true);
  });

  it('unsupported_version: outside the pin, or no parsable version', async () => {
    const old = fakeRunner(() => ok('3.5.10'));
    expect(await detectCodeHealthTool('jscpd', old.runner, { platform: 'linux' })).toMatchObject({ status: 'unsupported_version', version: '3.5.10' });
    const junk = fakeRunner(() => ok('jscpd (dev build)'));
    expect(await detectCodeHealthTool('jscpd', junk.runner, { platform: 'linux' })).toMatchObject({ status: 'unsupported_version', version: null });
  });

  it('detectCodeHealthTools keeps the canonical order', async () => {
    const { runner } = fakeRunner(() => ok('1.17.13'));
    const list = await detectCodeHealthTools(runner, ['lizard', 'jscpd'], { platform: 'linux' });
    expect(list.map((t) => t.name)).toEqual(['jscpd', 'lizard']);
  });
});
