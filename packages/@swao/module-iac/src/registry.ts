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

import type { IaCProvider, IaCResourceGraph, IaCToolchain } from './types.js';

// Module-level provider registry. Populated at startup when each provider
// module calls registerProvider(). Keyed by toolchain identifier.
const _registry = new Map<IaCToolchain, IaCProvider>();

// ---------------------------------------------------------------------------
// Registry API (design 085 SS4.2)
// ---------------------------------------------------------------------------

export function registerProvider(provider: IaCProvider): void {
  _registry.set(provider.toolchain, provider);
}

export function getProvider(toolchain: IaCToolchain): IaCProvider | undefined {
  return _registry.get(toolchain);
}

/** Walk registered providers in insertion order; return first match. */
export async function detectToolchain(dirPath: string): Promise<IaCToolchain | null> {
  for (const [, provider] of _registry) {
    if (await provider.detect(dirPath)) {
      return provider.toolchain;
    }
  }
  return null;
}

/** Convenience: look up a provider and call readState. Returns null if unregistered. */
export async function readIaCState(
  toolchain: IaCToolchain,
  filePaths: string[],
): Promise<IaCResourceGraph | null> {
  const provider = _registry.get(toolchain);
  if (!provider) return null;
  return provider.readState(filePaths);
}

/** Expose a read-only view of all registered toolchains (for diagnostics). */
export function registeredToolchains(): IaCToolchain[] {
  return [..._registry.keys()];
}
