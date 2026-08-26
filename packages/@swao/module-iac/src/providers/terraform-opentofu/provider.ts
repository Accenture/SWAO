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

import { existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { spawnSync } from 'child_process';
import type { IaCProvider, IaCResource, IaCResourceGraph, IaCArtefacts, IaCSecurityFinding } from '../../types.js';
import { parseTfState, collectResourceTypes } from './state-parser.js';

// ---------------------------------------------------------------------------
// TerraformOpenTofuProvider
//
// Handles both Terraform (BSL 1.1) and OpenTofu (MPL 2.0) state files.
// The two tools produce identical .tfstate JSON; a single provider covers
// both (design 085 SS5.1).
// ---------------------------------------------------------------------------

export class TerraformOpenTofuProvider implements IaCProvider {
  readonly toolchain = 'terraform' as const;

  async readState(filePaths: string[]): Promise<IaCResourceGraph> {
    const states = filePaths.map(parseTfState);
    const byType = collectResourceTypes(states);
    const resources: IaCResource[] = [];

    for (const [, list] of byType) {
      for (const r of list) {
        resources.push({
          type: r.type,
          name: r.name,
          provider: r.type.split('_')[0] ?? 'unknown',
          attributes: r.instances[0]?.attributes ?? {},
          mode: 'managed',
          sourceToolchain: 'terraform',
        });
      }
    }

    return {
      toolchain: 'terraform',
      formatVersion: 'mixed',
      resources,
    };
  }

  // design 085 SS9, #1327: run IaC static security scan via checkov or kics.
  // graceful degradation: returns [] when neither tool is available (no throw).
  async scanSource(artefacts: IaCArtefacts): Promise<IaCSecurityFinding[]> {
    const firstPath = artefacts.sourceFiles?.[0] ?? artefacts.stateFiles?.[0];
    if (!firstPath) return [];
    const sourceDir = artefacts.sourceFiles ? dirname(firstPath) : dirname(firstPath);

    const checkovResult = runCheckov(sourceDir);
    if (checkovResult !== null) return checkovResult;

    const kicsResult = runKics(sourceDir);
    if (kicsResult !== null) return kicsResult;

    // no-op: caller (pass-06-tf.ts) logs the skip event via logPortfolio.
    return [];
  }

  async detect(dirPath: string): Promise<boolean> {
    if (!existsSync(dirPath)) return false;

    // .terraform/ directory or .terraform.lock.hcl
    if (
      existsSync(join(dirPath, '.terraform')) ||
      existsSync(join(dirPath, '.terraform.lock.hcl'))
    ) {
      return true;
    }

    // Any .tf file in the directory
    try {
      const entries = readdirSync(dirPath);
      if (entries.some((e) => e.endsWith('.tf') || e.endsWith('.tfstate'))) {
        return true;
      }
    } catch {
      // ignore unreadable directory
    }

    // wsp/inputs/terraform/ with .tfstate files
    const tfInputDir = join(dirPath, 'wsp', 'inputs', 'terraform');
    if (existsSync(tfInputDir)) {
      try {
        const entries = readdirSync(tfInputDir);
        if (entries.some((e) => e.endsWith('.tfstate'))) return true;
      } catch {
        // ignore
      }
    }

    return false;
  }
}

// ---------------------------------------------------------------------------
// IaC scanner helpers (checkov + kics)
// ---------------------------------------------------------------------------

type CheckovSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | string;

function normalizeSeverity(s: CheckovSeverity): IaCSecurityFinding['severity'] {
  switch (s.toUpperCase()) {
    case 'CRITICAL': return 'critical';
    case 'HIGH':     return 'high';
    case 'MEDIUM':   return 'medium';
    default:         return 'low';
  }
}

function parseCheckovOutput(raw: string): IaCSecurityFinding[] {
  const parsed = JSON.parse(raw) as unknown;
  const frames = Array.isArray(parsed) ? parsed : [parsed];
  const findings: IaCSecurityFinding[] = [];

  for (const frame of frames) {
    const failed: unknown[] = (frame as Record<string, Record<string, unknown[]>>)
      ?.results?.failed_checks ?? [];
    for (const item of failed) {
      const c = item as Record<string, unknown>;
      const checkMeta = c['check'] as Record<string, unknown> | undefined;
      findings.push({
        ruleId: String(c['check_id'] ?? 'unknown'),
        severity: normalizeSeverity(
          String(c['severity'] ?? checkMeta?.['severity'] ?? 'low'),
        ),
        resource: String(c['resource'] ?? 'unknown'),
        message: String(checkMeta?.['name'] ?? c['check_id'] ?? 'IaC misconfiguration'),
      });
    }
  }
  return findings;
}

function runCheckov(sourceDir: string): IaCSecurityFinding[] | null {
  const result = spawnSync(
    'checkov',
    ['--directory', sourceDir, '-o', 'json', '--compact', '--quiet'],
    { encoding: 'utf-8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (result.error) return null; // ENOENT or spawn failure = not installed
  const out = (result.stdout ?? '').toString().trim();
  if (!out) return null;
  try {
    return parseCheckovOutput(out);
  } catch {
    return []; // partial output on interrupted scan
  }
}

function parseKicsOutput(raw: string): IaCSecurityFinding[] {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const queries: unknown[] = (parsed['queries'] as unknown[]) ?? [];
  const findings: IaCSecurityFinding[] = [];

  for (const q of queries) {
    const query = q as Record<string, unknown>;
    const files: unknown[] = (query['files'] as unknown[]) ?? [];
    for (const f of files) {
      const file = f as Record<string, unknown>;
      findings.push({
        ruleId: String(query['query_id'] ?? 'unknown'),
        severity: normalizeSeverity(String(query['severity'] ?? 'low')),
        resource: String(file['resource_name'] ?? file['file_name'] ?? 'unknown'),
        message: String(query['query_name'] ?? query['query_id'] ?? 'IaC misconfiguration'),
      });
    }
  }
  return findings;
}

function runKics(sourceDir: string): IaCSecurityFinding[] | null {
  const result = spawnSync(
    'kics',
    ['scan', '--path', sourceDir, '--report-formats', 'json', '--output-path', '-', '--no-progress'],
    { encoding: 'utf-8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (result.error) return null; // not installed
  const out = (result.stdout ?? '').toString().trim();
  if (!out) return null;
  try {
    return parseKicsOutput(out);
  } catch {
    return [];
  }
}
