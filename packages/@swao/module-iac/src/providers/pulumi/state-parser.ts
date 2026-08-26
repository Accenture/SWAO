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

import { existsSync, readdirSync, readFileSync } from 'fs';
import { extname, join } from 'path';
import type { IaCResourceGraph } from '../../types.js';

// ---------------------------------------------------------------------------
// Pulumi stack export raw types (design 085 SS6.2)
// ---------------------------------------------------------------------------

interface PulumiRawResource {
  urn: string;
  type: string;
  id?: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
}

interface PulumiExport {
  version?: number;
  deployment?: {
    resources?: PulumiRawResource[];
  };
}

// ---------------------------------------------------------------------------
// State parser
// ---------------------------------------------------------------------------

/**
 * Parse a Pulumi stack export JSON file and normalise to IaCResourceGraph.
 *
 * Filtering rules (design 085 SS7):
 * - pulumi:pulumi:Stack -- the root stack resource, not a real infrastructure resource
 * - pulumi:providers:* -- provider registrations, not infrastructure resources
 *
 * URN format: urn:pulumi:{stack}::{project}::{type}::{name}
 * The logical name is the last segment of the URN.
 */
export function parsePulumiState(filePath: string): IaCResourceGraph {
  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as PulumiExport;
  const resources = raw.deployment?.resources ?? [];

  const normalised = resources
    .filter(
      (r) =>
        !r.type.startsWith('pulumi:pulumi:') &&
        !r.type.startsWith('pulumi:providers:'),
    )
    .map((r) => ({
      type: r.type,
      name: r.urn.split('::')[3] ?? r.type,
      provider: r.type.split(':')[0] ?? 'unknown',
      attributes: { ...(r.inputs ?? {}), ...(r.outputs ?? {}) },
      mode: 'managed' as const,
      sourceToolchain: 'pulumi' as const,
    }));

  return {
    toolchain: 'pulumi',
    formatVersion: String(raw.version ?? '3'),
    resources: normalised,
  };
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/**
 * Collect all Pulumi stack export JSON files from wsp/inputs/pulumi/.
 * Files written there either manually or by the Cloud API ingestion step (#1322).
 */
export function findPulumiStateFiles(workspacePath: string | undefined): string[] {
  if (!workspacePath) return [];
  const dir = join(workspacePath, 'wsp', 'inputs', 'pulumi');
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => extname(f) === '.json')
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}
