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

// #3575: the Pass 23 LZR live path on the `azure` driver (Design 120 section
// 7.5, owner decision Q-18), as aws-pass23.ts does for AWS.
// `packages/swao/src/lzr/providers/azure-adapter.ts` keeps its output schema
// and snapshot path and calls this for the live path, so its reads use the
// driver transport: the read-only allow-list, the endpoint seam, the
// service principal token and one Resource Graph query. The Pass 23 path is
// not a live LZ scan and does not go through the Q-21 registration gate.

import { resolveLzCredentials } from '@swao/core';
import type { CredentialStore } from '@swao/core';
import { createReadOnlyFetch } from '../http.js';
import { resolveEndpoints } from '../endpoints.js';
import type { FetchLike, ScopeCtx } from '../types.js';
import { azureDriver, readAzurePass23State } from './azure-driver.js';
import type { AzurePass23State } from './azure-driver.js';

export interface AzurePass23Options {
  lzId: string;
  scopeId: string;
  subscriptionId: string;
  store: CredentialStore;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
}

const globalFetch: FetchLike = (url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>;

/** Read the Pass 23 AKS, PostgreSQL, Redis, Key Vault and VNet state of one subscription through the driver transport. */
export async function readAzurePass23StateForScope(opts: AzurePass23Options): Promise<AzurePass23State> {
  const method = azureDriver.authMethods[0];
  if (!method) throw new Error('[lz live] azure driver has no auth method');
  // Endpoint overrides before credentials, credentials before any request (session.ts order).
  const endpoints = resolveEndpoints(azureDriver.provider, azureDriver.defaultBaseUrls, opts.env ?? process.env);
  const credentials = await resolveLzCredentials(opts.store, opts.lzId, opts.scopeId, method.required, method.optional);
  const ctx: ScopeCtx = {
    lzId: opts.lzId,
    provider: azureDriver.provider,
    scopeId: opts.scopeId,
    scopeKind: 'platform',
    auth: method.id,
    regions: [],
    target: { subscription: opts.subscriptionId },
    credentials: credentials as ScopeCtx['credentials'],
    http: { fetch: createReadOnlyFetch(opts.fetchImpl ?? globalFetch, azureDriver.provider, azureDriver.readAllowList), baseUrls: endpoints.baseUrls },
    sources: [],
  };
  return readAzurePass23State(ctx);
}
