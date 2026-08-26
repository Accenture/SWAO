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
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerProvider,
  getProvider,
  detectToolchain,
  readIaCState,
  registeredToolchains,
} from './registry.js';
import type { IaCProvider, IaCResourceGraph, IaCToolchain } from './types.js';

function makeProvider(toolchain: IaCToolchain, detectResult = false): IaCProvider {
  return {
    toolchain,
    async readState(filePaths: string[]): Promise<IaCResourceGraph> {
      return {
        toolchain,
        formatVersion: 'test',
        resources: filePaths.map((f) => ({
          type: 'test_resource',
          name: f,
          provider: 'test',
          attributes: {},
          mode: 'managed' as const,
          sourceToolchain: toolchain,
        })),
      };
    },
    async detect(_dir: string): Promise<boolean> {
      return detectResult;
    },
  };
}

// Reset registry state between tests by re-importing the module fresh.
// Since the registry is module-level state, we re-register in each test
// using unique toolchain slots via the provider factory.
beforeEach(() => {
  // Clear all entries so tests are isolated.
  const tc = registeredToolchains();
  for (const t of tc) {
    // We cannot delete from the private map directly; instead we overwrite
    // with a no-op provider that never detects.
    registerProvider(makeProvider(t, false));
  }
});

describe('registerProvider / getProvider', () => {
  it('stores and retrieves a provider by toolchain', () => {
    const p = makeProvider('terraform');
    registerProvider(p);
    expect(getProvider('terraform')).toBe(p);
  });

  it('returns undefined for an unregistered toolchain', () => {
    expect(getProvider('bicep')).toBeUndefined();
  });

  it('overwrites an existing entry for the same toolchain', () => {
    const p1 = makeProvider('opentofu');
    const p2 = makeProvider('opentofu');
    registerProvider(p1);
    registerProvider(p2);
    expect(getProvider('opentofu')).toBe(p2);
  });
});

describe('registeredToolchains', () => {
  it('lists all toolchains that have been registered', () => {
    registerProvider(makeProvider('pulumi'));
    const tc = registeredToolchains();
    expect(tc).toContain('pulumi');
  });
});

describe('detectToolchain', () => {
  it('returns the toolchain of the first provider that detects the dir', async () => {
    registerProvider(makeProvider('terraform', false));
    registerProvider(makeProvider('pulumi', true));
    expect(await detectToolchain('/some/dir')).toBe('pulumi');
  });

  it('returns null when no provider detects the dir', async () => {
    registerProvider(makeProvider('terraform', false));
    registerProvider(makeProvider('opentofu', false));
    expect(await detectToolchain('/some/dir')).toBeNull();
  });
});

describe('readIaCState', () => {
  it('delegates to the registered provider and returns IaCResourceGraph', async () => {
    registerProvider(makeProvider('terraform', false));
    const graph = await readIaCState('terraform', ['a.tfstate', 'b.tfstate']);
    expect(graph).not.toBeNull();
    expect(graph?.toolchain).toBe('terraform');
    expect(graph?.resources).toHaveLength(2);
  });

  it('returns null for an unregistered toolchain', async () => {
    expect(await readIaCState('cdktf', ['x.tfstate'])).toBeNull();
  });
});
