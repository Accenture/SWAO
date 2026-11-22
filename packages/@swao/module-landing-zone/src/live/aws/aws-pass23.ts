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

// #3574: the Pass 23 LZR live path on the `aws` driver (Design 120 section
// 7.5, owner decision Q-18). `packages/swao/src/lzr/providers/aws-adapter.ts`
// keeps its output schema and snapshot path and calls this for the live
// path, so its EKS and RDS reads use the driver transport: the read-only
// allow-list and AWS action guard, the endpoint seam, SigV4 over the real
// host and the XML reader for RDS (the old path parsed the RDS XML as JSON).
// The Pass 23 path is not a live LZ scan, so it does not go through the Q-21
// registration gate (builtin.ts); it uses the driver object directly.

import { resolveLzCredentials } from '@swao/core';
import type { CredentialStore } from '@swao/core';
import { createReadOnlyFetch } from '../http.js';
import { resolveEndpoints } from '../endpoints.js';
import type { FetchLike, ScopeCtx } from '../types.js';
import { awsDriver, readAwsPass23State } from './aws-driver.js';
import type { AwsPass23State } from './aws-driver.js';

export interface AwsPass23Options {
  lzId: string;
  scopeId: string;
  region: string;
  store: CredentialStore;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
}

const globalFetch: FetchLike = (url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>;

/** Read the Pass 23 EKS and RDS state of one scope and region through the driver transport. */
export async function readAwsPass23StateForScope(opts: AwsPass23Options): Promise<AwsPass23State> {
  const method = awsDriver.authMethods[0];
  if (!method) throw new Error('[lz live] aws driver has no auth method');
  // Endpoint overrides before credentials, credentials (incl. expires-at) before any request (session.ts order).
  const endpoints = resolveEndpoints(awsDriver.provider, awsDriver.defaultBaseUrls, opts.env ?? process.env);
  const credentials = await resolveLzCredentials(opts.store, opts.lzId, opts.scopeId, method.required, method.optional);
  const ctx: ScopeCtx = {
    lzId: opts.lzId,
    provider: awsDriver.provider,
    scopeId: opts.scopeId,
    scopeKind: 'platform',
    auth: method.id,
    regions: [opts.region],
    target: { region: opts.region },
    credentials: credentials as ScopeCtx['credentials'],
    http: { fetch: createReadOnlyFetch(opts.fetchImpl ?? globalFetch, awsDriver.provider, awsDriver.readAllowList), baseUrls: endpoints.baseUrls },
    sources: [],
  };
  return readAwsPass23State(ctx, opts.region);
}
