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

// ---------------------------------------------------------------------------
// Terraform state types (TFv4 native + TFv5 show-json normalised shape)
// ---------------------------------------------------------------------------

export interface TfResource {
  type: string;
  name: string;
  instances: Array<{
    attributes: Record<string, unknown>;
  }>;
}

export interface TfState {
  resources?: TfResource[];
}

// TFv5 show format: `terraform show -json` output.
// format_version "1.0" = state; "1.2" = plan (planned_values, not supported here).
interface TfShowResource {
  mode: string;
  type: string;
  name: string;
  values: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Source-environment service detection
//
// Maps docker container image names (or inferred identifiers) to abstract
// service_dep codes used by the LZ catalogue fit. Used when tfstate describes
// a SOURCE environment (VPS/docker) rather than a TARGET cloud provider.
// ---------------------------------------------------------------------------

export const IMAGE_TO_SERVICE_DEP: ReadonlyArray<readonly [string, string]> = [
  ['postgres', 'postgresql'],
  ['postgresql', 'postgresql'],
  ['redis', 'redis'],
  ['redis-stack', 'redis'],
  ['keydb', 'redis'],
  ['mongo', 'mongodb'],
  ['mongodb', 'mongodb'],
  ['mysql', 'mysql'],
  ['mariadb', 'mariadb'],
  ['minio', 'object_storage'],
  ['rabbitmq', 'message_queue'],
  ['kafka', 'message_queue'],
] as const;

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

export function parseTfState(filePath: string): TfState {
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  if (typeof parsed['format_version'] === 'string') {
    // TFv5 show-json: normalise to TFv4-compatible shape.
    const rootModule = (parsed['values'] as Record<string, unknown> | undefined)?.['root_module'] as
      | Record<string, unknown>
      | undefined;
    const showResources = (rootModule?.['resources'] as TfShowResource[] | undefined) ?? [];
    return {
      resources: showResources
        .filter((r) => r.mode === 'managed')
        .map((r) => ({
          type: r.type,
          name: r.name,
          instances: [{ attributes: r.values }],
        })),
    };
  }

  return parsed as TfState;
}

export function collectResourceTypes(states: TfState[]): Map<string, TfResource[]> {
  const byType = new Map<string, TfResource[]>();
  for (const state of states) {
    for (const resource of state.resources ?? []) {
      const list = byType.get(resource.type) ?? [];
      list.push(resource);
      byType.set(resource.type, list);
    }
  }
  return byType;
}

export function extractSourceServices(byType: Map<string, TfResource[]>): Map<string, string[]> {
  const detected = new Map<string, string[]>();
  const containers = byType.get('docker_container') ?? [];
  for (const c of containers) {
    const attrs = c.instances[0]?.attributes ?? {};
    const image = (attrs['image'] ?? '') as string;

    if (!image.startsWith('sha256:')) {
      const imageName = (image.split(':')[0] ?? '').split('/').pop()?.toLowerCase() ?? '';
      for (const [pattern, serviceCode] of IMAGE_TO_SERVICE_DEP) {
        if (imageName === pattern || imageName.startsWith(pattern + '-')) {
          const ev = detected.get(serviceCode) ?? [];
          ev.push(`docker_container.${c.name} (image: ${image})`);
          detected.set(serviceCode, ev);
          break;
        }
      }
      continue;
    }

    // SHA256 digest: `terraform show -json` stores the pulled image digest.
    // Fall back to env vars, command, then Terraform resource name.
    const env = (attrs['env'] ?? []) as string[];
    const cmd = (attrs['command'] ?? []) as string[];
    const digest = `${image.slice(0, 19)}...`;

    let inferredCode: string | null = null;
    let inferredEvidence = '';

    if (env.some((e) => e.startsWith('POSTGRES_DB=') || e.startsWith('POSTGRES_USER='))) {
      inferredCode = 'postgresql';
      inferredEvidence = 'postgres env vars';
    } else if (cmd[0] === 'postgres') {
      inferredCode = 'postgresql';
      inferredEvidence = 'postgres command';
    } else {
      for (const [pattern, serviceCode] of IMAGE_TO_SERVICE_DEP) {
        if (c.name === pattern || c.name.startsWith(`${pattern}-`) || c.name.startsWith(`${pattern}_`)) {
          inferredCode = serviceCode;
          inferredEvidence = `resource name '${c.name}'`;
          break;
        }
      }
    }

    if (inferredCode) {
      const ev = detected.get(inferredCode) ?? [];
      ev.push(`docker_container.${c.name} (${inferredEvidence}; digest: ${digest})`);
      detected.set(inferredCode, ev);
    }
  }
  return detected;
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/**
 * Collect all .tfstate files relevant to an app assessment.
 * Priority order:
 *   1. wsp/inputs/terraform/ (workspace-managed ingestion folder)
 *   2. Root of the app source tree (committed terraform.tfstate, etc.)
 *
 * The ingestion pass creates numbered copies alongside originals
 * (e.g. "12 terraform-prod.tfstate" beside "terraform-prod.tfstate").
 * We deduplicate by canonical basename (stripping leading "NNN " prefix)
 * and prefer the clean-named file when both exist.
 */
export function findTfstateFiles(workspacePath: string | undefined, sourcePath: string): string[] {
  const byCanonical = new Map<string, string>();

  function addDir(dir: string): void {
    if (!existsSync(dir)) return;
    try {
      for (const f of readdirSync(dir)) {
        if (extname(f) !== '.tfstate') continue;
        const canonical = f.replace(/^\d+ /, '');
        const full = join(dir, f);
        const existing = byCanonical.get(canonical);
        // Prefer the clean-named file over an ingestion-numbered copy.
        if (!existing || f === canonical) {
          byCanonical.set(canonical, full);
        }
      }
    } catch {
      // ignore unreadable directory
    }
  }

  if (workspacePath) addDir(join(workspacePath, 'wsp', 'inputs', 'terraform'));
  addDir(sourcePath);

  return [...byCanonical.values()];
}
