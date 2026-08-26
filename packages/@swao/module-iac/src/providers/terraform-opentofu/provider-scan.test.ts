// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  IaC provider abstraction module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Unit tests for TerraformOpenTofuProvider.scanSource (design 085 SS9, #1327).
//
// All subprocess calls are mocked via vi.mock('child_process') -- per
// CLAUDE.md SS5.9, no real checkov/kics invocations in CI.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { SpawnSyncReturns } from 'child_process';

vi.mock('child_process', () => ({ spawnSync: vi.fn() }));

import { spawnSync } from 'child_process';
import { TerraformOpenTofuProvider } from './provider.js';

const mockSpawn = vi.mocked(spawnSync);

function makeCheckovResult(findings: object[]): SpawnSyncReturns<string> {
  const json = JSON.stringify({
    results: {
      failed_checks: findings,
      passed_checks: [],
    },
  });
  return { pid: 1, output: [null, json, ''], stdout: json, stderr: '', status: 0, signal: null, error: undefined };
}

function makeNotFound(): SpawnSyncReturns<string> {
  return { pid: 0, output: [null, '', ''], stdout: '', stderr: '', status: null, signal: null, error: new Error('ENOENT') };
}

function makeEmptyOutput(): SpawnSyncReturns<string> {
  return { pid: 1, output: [null, '', ''], stdout: '', stderr: '', status: 1, signal: null, error: undefined };
}

const FAKE_ARTEFACTS = { sourceFiles: ['/tmp/src/main.tf'] };

afterEach(() => {
  vi.resetAllMocks();
});

describe('TerraformOpenTofuProvider.scanSource -- checkov found (#1327)', () => {
  it('parses checkov JSON output into IaCSecurityFindings', async () => {
    mockSpawn.mockReturnValueOnce(makeCheckovResult([
      {
        check_id: 'CKV_AWS_18',
        resource: 'aws_s3_bucket.my_bucket',
        severity: 'MEDIUM',
        check: { name: 'Ensure the S3 bucket has access logging enabled' },
      },
    ]));

    const provider = new TerraformOpenTofuProvider();
    const findings = await provider.scanSource(FAKE_ARTEFACTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe('CKV_AWS_18');
    expect(findings[0]?.severity).toBe('medium');
    expect(findings[0]?.resource).toBe('aws_s3_bucket.my_bucket');
    expect(findings[0]?.message).toMatch(/access logging/);
  });

  it('returns empty array when checkov finds no violations (empty failed_checks)', async () => {
    mockSpawn.mockReturnValueOnce({ ...makeCheckovResult([]), stdout: JSON.stringify({ results: { failed_checks: [], passed_checks: [] } }) });

    const provider = new TerraformOpenTofuProvider();
    const findings = await provider.scanSource(FAKE_ARTEFACTS);
    expect(findings).toHaveLength(0);
  });

  it('normalizes severity strings to lowercase union', async () => {
    mockSpawn.mockReturnValueOnce(makeCheckovResult([
      { check_id: 'CKV_AWS_1', resource: 'r.a', severity: 'CRITICAL', check: { name: 'c1' } },
      { check_id: 'CKV_AWS_2', resource: 'r.b', severity: 'HIGH',     check: { name: 'c2' } },
      { check_id: 'CKV_AWS_3', resource: 'r.c', severity: 'MEDIUM',   check: { name: 'c3' } },
      { check_id: 'CKV_AWS_4', resource: 'r.d', severity: 'LOW',      check: { name: 'c4' } },
    ]));

    const provider = new TerraformOpenTofuProvider();
    const findings = await provider.scanSource(FAKE_ARTEFACTS);
    expect(findings.map((f) => f.severity)).toEqual(['critical', 'high', 'medium', 'low']);
  });
});

describe('TerraformOpenTofuProvider.scanSource -- checkov unavailable, kics fallback (#1327)', () => {
  it('falls back to kics when checkov is not installed', async () => {
    mockSpawn
      .mockReturnValueOnce(makeNotFound()) // checkov ENOENT
      .mockReturnValueOnce({              // kics success
        pid: 2,
        output: [null, JSON.stringify({
          queries: [{
            query_id: 'aa25ad20',
            query_name: 'S3 Bucket Without Versioning',
            severity: 'HIGH',
            files: [{ resource_name: 'aws_s3_bucket.app', file_name: 'main.tf' }],
          }],
        }), ''],
        stdout: JSON.stringify({ queries: [{ query_id: 'aa25ad20', query_name: 'S3 Bucket Without Versioning', severity: 'HIGH', files: [{ resource_name: 'aws_s3_bucket.app', file_name: 'main.tf' }] }] }),
        stderr: '', status: 50, signal: null, error: undefined,
      });

    const provider = new TerraformOpenTofuProvider();
    const findings = await provider.scanSource(FAKE_ARTEFACTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe('aa25ad20');
    expect(findings[0]?.severity).toBe('high');
    expect(findings[0]?.resource).toBe('aws_s3_bucket.app');
  });
});

describe('TerraformOpenTofuProvider.scanSource -- neither tool available (#1327)', () => {
  it('returns empty array (no throw) when neither checkov nor kics is installed', async () => {
    mockSpawn.mockReturnValue(makeNotFound());

    const provider = new TerraformOpenTofuProvider();
    const findings = await provider.scanSource(FAKE_ARTEFACTS);
    expect(findings).toHaveLength(0);
    expect(Array.isArray(findings)).toBe(true);
  });
});

describe('TerraformOpenTofuProvider.scanSource -- partial output / errors (#1327)', () => {
  it('returns empty array when checkov produces empty stdout (no findings, no error)', async () => {
    mockSpawn
      .mockReturnValueOnce(makeEmptyOutput())  // checkov -- empty stdout triggers null from runCheckov
      .mockReturnValue(makeNotFound());         // kics -- not installed

    const provider = new TerraformOpenTofuProvider();
    const findings = await provider.scanSource(FAKE_ARTEFACTS);
    expect(findings).toHaveLength(0);
  });

  it('returns empty array when no source files in artefacts', async () => {
    const provider = new TerraformOpenTofuProvider();
    const findings = await provider.scanSource({});
    expect(findings).toHaveLength(0);
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
