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

// #3571: endpoint seam (Design 121 section 6, binding security rule). A
// redirected token endpoint would receive the real secret, so overrides are
// accepted only (1) for loopback hosts, (2) from the environment
// (`SWAO_LZ_MOCK_ENDPOINTS=<path to the mock's endpoints file>`), never from
// `.swao.yml`, and (3) logged by name (`lz.live.endpoint.override`) and
// returned for the run manifest.
//
// Endpoints file (written by `swao-mock-csp start`):
//   { "<provider>": { "<api-id>": "https://127.0.0.1:<port>/..." } }

import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { logPortfolio } from '@swao/core';

export const MOCK_ENDPOINTS_ENV = 'SWAO_LZ_MOCK_ENDPOINTS';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

export class EndpointOverrideError extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(`[lz live] ${message}`);
    this.name = 'EndpointOverrideError';
  }
}

const EndpointsFileSchema = z.record(z.string(), z.record(z.string(), z.string()));

export interface EndpointOverride {
  api: string;
  url: string;
}

export interface ResolvedEndpoints {
  baseUrls: Record<string, string>;
  /** Stamped into the run manifest; empty without an override. */
  overrides: EndpointOverride[];
}

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/**
 * Merge the driver defaults with the overrides for `provider` from the file
 * named by SWAO_LZ_MOCK_ENDPOINTS. Throws EndpointOverrideError (exit code 2)
 * before any request when the file is unreadable, names an API the driver
 * does not have, or points anywhere but a loopback host over https.
 */
export function resolveEndpoints(
  provider: string,
  defaults: Readonly<Record<string, string>>,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedEndpoints {
  const baseUrls = { ...defaults };
  const file = env[MOCK_ENDPOINTS_ENV];
  if (file === undefined || file === '') return { baseUrls, overrides: [] };
  if (!existsSync(file)) throw new EndpointOverrideError(`${MOCK_ENDPOINTS_ENV} names a file that does not exist: ${file}`);
  let parsed: z.infer<typeof EndpointsFileSchema>;
  try {
    parsed = EndpointsFileSchema.parse(JSON.parse(readFileSync(file, 'utf-8')));
  } catch (err) {
    throw new EndpointOverrideError(`${MOCK_ENDPOINTS_ENV} file is not a JSON object of provider -> api -> URL: ${(err as Error).message}`);
  }
  const forProvider = parsed[provider] ?? {};
  const overrides: EndpointOverride[] = [];
  for (const [api, url] of Object.entries(forProvider)) {
    if (!(api in defaults)) {
      throw new EndpointOverrideError(`endpoint override for unknown ${provider} API "${api}" (known: ${Object.keys(defaults).sort().join(', ')})`);
    }
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new EndpointOverrideError(`endpoint override for ${provider} ${api} is not a URL`);
    }
    if (u.protocol !== 'https:') throw new EndpointOverrideError(`endpoint override for ${provider} ${api} must use https (the mock serves TLS, Design 121 section 7.2)`);
    if (!isLoopbackHost(u.hostname)) {
      throw new EndpointOverrideError(`endpoint override for ${provider} ${api} refused: host ${u.hostname} is not a loopback host (127.0.0.1, ::1, localhost)`);
    }
    baseUrls[api] = url.replace(/\/+$/, '');
    overrides.push({ api, url: baseUrls[api] as string });
    logPortfolio('warn', 'lz.live.endpoint.override', 'Landing zone endpoint overridden for a local mock', { context: { provider, api, host: u.host } });
  }
  return { baseUrls, overrides };
}
