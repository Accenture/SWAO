// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3429: role resolution for infrastructure inputs (current vs target).

import { describe, it, expect, vi } from 'vitest';
import { join } from 'path';
import {
  resolveInfraRole, resolveInfraRoleForFile, readInfraRoleOverrides, infraRolePathMatches,
  infraRoleLabel, stripInfraRoleTag,
} from './infra-input-role.js';

describe('resolveInfraRole defaults (#3429)', () => {
  it('lz-*-snapshot.json is target, also ingest-numbered and legacy stub names', () => {
    expect(resolveInfraRole('terraform/lz-aws-snapshot.json')).toBe('target');
    expect(resolveInfraRole('terraform/12 lz-stackit-snapshot.json')).toBe('target');
    expect(resolveInfraRole('terraform/lz-azure-stub.json')).toBe('target');
  });

  it('tfstate and other terraform/pulumi files are current (unchanged behaviour)', () => {
    expect(resolveInfraRole('terraform/prod.tfstate')).toBe('current');
    expect(resolveInfraRole('terraform/plan.json')).toBe('current');
    expect(resolveInfraRole('pulumi/stack.json')).toBe('current');
  });

  it('folder convention infra/current and infra/target wins over filename defaults', () => {
    expect(resolveInfraRole('infra/current/lz-aws-snapshot.json')).toBe('current');
    expect(resolveInfraRole('infra/target/prod.tfstate')).toBe('target');
  });

  it('documentation and README files have no role', () => {
    expect(resolveInfraRole('architecture/overview.md')).toBeUndefined();
    expect(resolveInfraRole('terraform/README.md')).toBeUndefined();
    expect(resolveInfraRole('operations/cmdb.csv')).toBeUndefined();
  });

  it('accepts wsp/inputs/-prefixed and backslash paths', () => {
    expect(resolveInfraRole('wsp/inputs/terraform/lz-aws-snapshot.json')).toBe('target');
    expect(resolveInfraRole('terraform\\prod.tfstate')).toBe('current');
  });
});

describe('infra_roles overrides (#3429)', () => {
  it('first matching override wins', () => {
    const overrides = [
      { path: 'terraform/lz-aws-snapshot.json', role: 'current' as const },
      { path: 'terraform', role: 'target' as const },
    ];
    expect(resolveInfraRole('terraform/lz-aws-snapshot.json', overrides)).toBe('current');
    expect(resolveInfraRole('terraform/prod.tfstate', overrides)).toBe('target');
  });

  it('path matching: file, directory prefix, single and double star', () => {
    expect(infraRolePathMatches('terraform/legacy', 'terraform/legacy/a.json')).toBe(true);
    expect(infraRolePathMatches('terraform/legacy', 'terraform/legacy-b.json')).toBe(false);
    expect(infraRolePathMatches('terraform/*.tfstate', 'terraform/prod.tfstate')).toBe(true);
    expect(infraRolePathMatches('terraform/*.tfstate', 'terraform/sub/prod.tfstate')).toBe(false);
    expect(infraRolePathMatches('**/ocp-*.json', 'exports/2026/ocp-export.json')).toBe(true);
  });

  it('readInfraRoleOverrides keeps valid entries and drops invalid ones', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const out = readInfraRoleOverrides({
        context: { infra_roles: [{ path: 'a.json', role: 'target' }, { path: 'b.json', role: 'future' }, { role: 'current' }] },
      });
      expect(out).toEqual([{ path: 'a.json', role: 'target' }]);
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('readInfraRoleOverrides returns [] when the key is absent', () => {
    expect(readInfraRoleOverrides({ context: { allocations: { ctx: 20000 } } })).toEqual([]);
    expect(readInfraRoleOverrides(null)).toEqual([]);
  });
});

describe('resolveInfraRoleForFile (#3429)', () => {
  const ws = join('C:', 'ws');
  it('resolves files under wsp/inputs by relative path, others by filename only', () => {
    const overrides = [{ path: 'terraform/old.tfstate', role: 'target' as const }];
    expect(resolveInfraRoleForFile(join(ws, 'wsp', 'inputs', 'terraform', 'old.tfstate'), ws, overrides)).toBe('target');
    expect(resolveInfraRoleForFile(join(ws, 'src', 'old.tfstate'), ws, overrides)).toBe('current');
  });
});

describe('labels (#3429)', () => {
  it('labels and strips role tags', () => {
    expect(infraRoleLabel('target')).toBe('[TARGET-LZ]');
    expect(infraRoleLabel('current')).toBe('[CURRENT-INFRA]');
    expect(infraRoleLabel(undefined)).toBe('');
    expect(stripInfraRoleTag('[TARGET-LZ] terraform/x.json')).toBe('terraform/x.json');
    expect(stripInfraRoleTag('terraform/x.json')).toBe('terraform/x.json');
  });
});
