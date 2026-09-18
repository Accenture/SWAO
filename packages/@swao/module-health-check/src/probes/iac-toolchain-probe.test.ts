// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health-check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Unit tests for the IaC toolchain probe (design 085 OI-05, #1328).
//
// subprocess calls are mocked via vi.mock('child_process') so no real IaC
// toolchain needs to be installed in CI. Per CLAUDE.md SS5.9 / issue #1328.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { SpawnSyncReturns } from 'child_process';

vi.mock('child_process', () => ({ spawnSync: vi.fn() }));

import { spawnSync } from 'child_process';
import { buildIaCToolchainProbe } from './iac-toolchain-probe.js';

const mockSpawn = vi.mocked(spawnSync);

function makeSpawnResult(stdout: string, exitCode: number): SpawnSyncReturns<string> {
  return {
    pid: 1234,
    output: [null, stdout, ''],
    stdout,
    stderr: '',
    status: exitCode,
    signal: null,
    error: undefined,
  };
}

function makeNotFoundResult(): SpawnSyncReturns<string> {
  return {
    pid: 0,
    output: [null, '', ''],
    stdout: '',
    stderr: '',
    status: null,
    signal: null,
    error: new Error('ENOENT'),
  };
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('buildIaCToolchainProbe -- all tools found (#1328)', () => {
  it('returns status ok when all five tools are present', () => {
    mockSpawn
      .mockReturnValueOnce(makeSpawnResult('Terraform v1.9.8', 0))
      .mockReturnValueOnce(makeSpawnResult('OpenTofu v1.7.2', 0))
      .mockReturnValueOnce(makeSpawnResult('v3.126.0', 0))
      .mockReturnValueOnce(makeSpawnResult('bridgecrew/checkov 3.2.4', 0))
      .mockReturnValueOnce(makeSpawnResult('Keeping Infrastructure as Code Secure 2.1.3', 0));

    const result = buildIaCToolchainProbe();

    expect(mockSpawn).toHaveBeenCalledTimes(5);
    expect(result.status).toBe('ok');
    expect(result.tools).toHaveLength(5);
    expect(result.tools.every((t) => t.available)).toBe(true);
    expect(result.message).toMatch(/IaC toolchain ready/);
  });

  it('reports correct tool names in declared order', () => {
    mockSpawn.mockReturnValue(makeSpawnResult('v1.0.0', 0));

    const result = buildIaCToolchainProbe();
    expect(result.tools[0]?.name).toBe('terraform');
    expect(result.tools[1]?.name).toBe('opentofu');
    expect(result.tools[2]?.name).toBe('pulumi');
    expect(result.tools[3]?.name).toBe('checkov');
    expect(result.tools[4]?.name).toBe('kics');
  });
});

describe('buildIaCToolchainProbe -- tools not found (#1328)', () => {
  it('returns status warn when no tools are installed', () => {
    mockSpawn.mockReturnValue(makeNotFoundResult());

    const result = buildIaCToolchainProbe();

    expect(result.status).toBe('warn');
    expect(result.tools.every((t) => !t.available)).toBe(true);
    expect(result.tools.every((t) => t.version === null)).toBe(true);
    expect(result.message).toMatch(/No IaC toolchain/);
  });

  it('tool-not-found sets required: false (graceful degradation)', () => {
    mockSpawn.mockReturnValue(makeNotFoundResult());

    const result = buildIaCToolchainProbe();
    expect(result.tools.every((t) => t.required === false)).toBe(true);
  });
});

describe('buildIaCToolchainProbe -- partial toolchain (#1328)', () => {
  it('returns warn + partial message when only terraform is found', () => {
    mockSpawn
      .mockReturnValueOnce(makeSpawnResult('Terraform v1.9.8', 0))
      .mockReturnValueOnce(makeNotFoundResult())
      .mockReturnValueOnce(makeNotFoundResult())
      .mockReturnValueOnce(makeNotFoundResult())
      .mockReturnValueOnce(makeNotFoundResult());

    const result = buildIaCToolchainProbe();

    expect(result.status).toBe('warn');
    expect(result.tools[0]?.available).toBe(true);
    expect(result.tools.slice(1).every((t) => !t.available)).toBe(true);
    expect(result.message).toMatch(/partial/);
    expect(result.message).toMatch(/opentofu/);
    expect(result.message).toMatch(/pulumi/);
    expect(result.message).toMatch(/checkov/);
    expect(result.message).toMatch(/kics/);
  });

  it('version string is taken from first line of stdout only', () => {
    mockSpawn
      .mockReturnValueOnce(makeSpawnResult('Terraform v1.9.8\non darwin_arm64\nProvider requirements...\n', 0))
      .mockReturnValue(makeNotFoundResult());

    const result = buildIaCToolchainProbe();
    expect(result.tools[0]?.version).toBe('Terraform v1.9.8');
  });
});
