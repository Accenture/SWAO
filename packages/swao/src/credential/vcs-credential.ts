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

// VCS credential helpers (#0421).
//
// The credential key for VCS tokens was renamed from the generic `vcs-token`
// to the provider-scoped format `provider:<provider>:token`
// (e.g. `provider:github:token`, `provider:gitlab:token`).
//
// Migration: reading the old `vcs-token` key falls back gracefully. On the
// next write the caller stores the value under the new key so the vault
// self-heals without any explicit migration step.
//
// Both the new key and the migration fallback are centralised here so that
// assess.ts, vcs-auth-probe.ts, and any future caller share a single
// consistent lookup path.

import type { CredentialStore } from '@swao/core';
import { vcsTokenKey } from '../providers/vcs/auth.js';

const LEGACY_KEY = 'vcs-token';

/**
 * Read the VCS token for the given URL, applying a transparent migration
 * path from the legacy `vcs-token` key to the provider-scoped key.
 *
 * Lookup order:
 *   1. New key `provider:<provider>:token` (or env SWAO_CREDENTIAL_PROVIDER__<PROVIDER>__TOKEN).
 *   2. Legacy key `vcs-token` (or env SWAO_CREDENTIAL_VCS_TOKEN) -- silently
 *      returned so existing setups continue to work. Callers that write the
 *      token back (e.g. credential set) should use `vcsTokenKey(vcsUrl)` so
 *      the vault migrates to the new key on next write.
 *
 * Returns null when neither key is present.
 *
 * `legacyFallback: false` restricts the lookup to the provider-scoped key.
 * The vcs-auth probe uses this (#1416): the catch-all legacy token must not
 * be sent to every host a workspace's fixture .swao.yml files happen to
 * name. Clone-time callers keep the default fallback.
 */
export async function resolveVcsToken(
  store: CredentialStore,
  vcsUrl: string,
  opts: { legacyFallback?: boolean } = {},
): Promise<string | null> {
  const newKey = vcsTokenKey(vcsUrl);
  const newVal = await store.get(newKey);
  if (newVal !== null) return newVal;
  if (opts.legacyFallback === false) return null;
  // Backward-compat: return the legacy value so operators who have not yet
  // re-set their token under the new key are not broken.
  return store.get(LEGACY_KEY);
}

export { vcsTokenKey };
