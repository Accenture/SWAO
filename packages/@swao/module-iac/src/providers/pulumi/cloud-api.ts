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

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Pulumi Cloud REST API client (design 085 SS13.1)
//
// Endpoint: GET https://api.pulumi.com/api/stacks/{org}/{project}/{stack}/export
// Auth:     Authorization: token <PAT>
// PAT key:  "pulumi-api-token" in the SWAO vault
// ---------------------------------------------------------------------------

export interface PulumiStackRef {
  org: string;
  project: string;
  stack: string;
}

/**
 * Fetch the state export for a Pulumi stack from the Pulumi Cloud REST API.
 * Returns the raw JSON body as a string.
 *
 * Throws with an error message containing the HTTP status code on non-2xx responses.
 * NEVER logs or stores the token value.
 */
export async function fetchPulumiStackExport(
  ref: PulumiStackRef,
  token: string,
  baseUrl = 'https://api.pulumi.com',
): Promise<string> {
  const url = `${baseUrl}/api/stacks/${ref.org}/${ref.project}/${ref.stack}/export`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/json',
    },
  });
  if (!resp.ok) {
    throw new Error(`Pulumi Cloud API ${resp.status}: ${url}`);
  }
  return resp.text();
}

// ---------------------------------------------------------------------------
// Ingestion step
//
// For each stack in .swao.yml iac.pulumi.stacks:
//   1. Read pulumi-api-token from vault
//   2. Fetch stack export via REST API
//   3. Write to wsp/inputs/pulumi/{project}-{stack}.json
//   4. On vault miss or API error: emit INV-07 guidance, continue
// ---------------------------------------------------------------------------

export interface PulumiIngestionResult {
  fetched: string[];
  warnings: string[];
}

export async function ingestPulumiStacks(
  workspacePath: string,
  stacks: PulumiStackRef[],
  vaultReader: (key: string) => string | undefined,
  baseUrl?: string,
): Promise<PulumiIngestionResult> {
  const result: PulumiIngestionResult = { fetched: [], warnings: [] };
  if (stacks.length === 0) return result;

  const token = vaultReader('pulumi-api-token');
  if (!token) {
    result.warnings.push(
      'INV-07: pulumi-api-token not found in vault. Add the key to your SWAO vault to enable Pulumi Cloud API ingestion.',
    );
    return result;
  }

  const outDir = join(workspacePath, 'wsp', 'inputs', 'pulumi');
  mkdirSync(outDir, { recursive: true });

  for (const ref of stacks) {
    const outFile = join(outDir, `${ref.project}-${ref.stack}.json`);
    try {
      const body = await fetchPulumiStackExport(ref, token, baseUrl);
      writeFileSync(outFile, body);
      result.fetched.push(outFile);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.warnings.push(
        `INV-07: Pulumi API fetch failed for ${ref.org}/${ref.project}/${ref.stack}: ${msg}`,
      );
    }
  }

  return result;
}
