// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { readdirSync, existsSync } from 'fs';
import { join, extname } from 'path';
import type { PassContext, PassResult } from '@swao/core';
import type { Signal } from '@swao/core';
import { getChecksForProvider } from '../catalogue/lzr-checks-catalogue.js';
import type { LzrCheck } from '../catalogue/lzr-checks-catalogue.js';
import type { LandingZoneReadinessResult, LZBlockerItem, LZServiceCheck } from '@swao/core';
import type { TfResource } from './tf-state-parser.js';
import { parseTfState, collectResourceTypes, extractSourceServices } from './tf-state-parser.js';
export { parseTfState, extractSourceServices } from './tf-state-parser.js';

function evaluateCheckFromSource(
  check: LzrCheck,
  sourceServices: Map<string, string[]>,
): { outcome: CheckOutcome; evidence: string[] } {
  const codes = check.service_dep_codes ?? [];
  if (codes.length === 0) return { outcome: 'not_applicable', evidence: [] };
  for (const code of codes) {
    const ev = sourceServices.get(code);
    if (ev && ev.length > 0) {
      return {
        outcome: check.severity === 'blocker' ? 'fail' : 'not_applicable',
        evidence: ev.map((e) => `Detected in source environment: ${e}`),
      };
    }
  }
  return { outcome: 'not_applicable', evidence: [] };
}

// ---------------------------------------------------------------------------
// Input file discovery
// ---------------------------------------------------------------------------

export function findLzrInputFiles(workspacePath: string): string[] {
  // #0227 / #0232: LZ Terraform state and plan files live under
  // wsp/inputs/terraform/ (per-app scope). The legacy <app>/imports/
  // path has been retired.
  // Ingestion creates numbered copies ("12 terraform-prod.tfstate") alongside
  // originals. Deduplicate by canonical basename, preferring the clean-named file.
  const tfDir = join(workspacePath, 'wsp', 'inputs', 'terraform');
  if (!existsSync(tfDir)) return [];
  const byCanonical = new Map<string, string>();
  for (const f of readdirSync(tfDir)) {
    if (extname(f) !== '.tfstate' && extname(f) !== '.tfplan') continue;
    const canonical = f.replace(/^\d+ /, '');
    const existing = byCanonical.get(canonical);
    if (!existing || f === canonical) {
      byCanonical.set(canonical, join(tfDir, f));
    }
  }
  return [...byCanonical.values()];
}

// ---------------------------------------------------------------------------
// Check evaluation
// ---------------------------------------------------------------------------

type CheckOutcome = 'pass' | 'fail' | 'not_applicable';

function providerResourcePrefix(providerId: string): string | null {
  if (providerId.startsWith('stackit')) return 'stackit_';
  if (providerId.startsWith('aws')) return 'aws_';
  if (providerId.startsWith('azure')) return 'azurerm_';
  if (providerId.startsWith('google') || providerId.startsWith('gcp')) return 'google_';
  return null;
}

function evaluateCheck(
  check: LzrCheck,
  byType: Map<string, TfResource[]>,
  providerId: string,
): { outcome: CheckOutcome; evidence: string[] } {
  if (!check.terraform_resource_types || check.terraform_resource_types.length === 0) {
    return { outcome: 'not_applicable', evidence: [] };
  }

  // For generic (providers=all) checks, only consider resource types that match
  // the current provider's namespace. If none match, the check is not applicable
  // via the Terraform strategy for this provider.
  const prefix = providerResourcePrefix(providerId);
  const applicableTypes = prefix
    ? check.terraform_resource_types.filter((t) => t.startsWith(prefix))
    : check.terraform_resource_types;

  if (applicableTypes.length === 0) {
    return { outcome: 'not_applicable', evidence: [] };
  }

  const found: string[] = [];
  for (const rt of applicableTypes) {
    const resources = byType.get(rt);
    if (resources && resources.length > 0) {
      for (const r of resources) {
        found.push(`${rt}.${r.name} found in Terraform state`);
      }
    }
  }

  if (found.length > 0) {
    // Special case: BSI C5 encryption -- verify server_side_encryption attribute
    if (check.id === 'LZC-STACKIT-04') {
      const buckets = byType.get('stackit_objectstorage_bucket') ?? [];
      const unencrypted = buckets.filter((b) => {
        const sse = b.instances[0]?.attributes['server_side_encryption'] as Record<string, unknown> | undefined;
        return !sse?.['enabled'];
      });
      if (unencrypted.length > 0) {
        return {
          outcome: 'fail',
          evidence: unencrypted.map((b) => `${b.type}.${b.name}: server_side_encryption not enabled`),
        };
      }
    }
    return { outcome: 'pass', evidence: found };
  }

  // Service is required but not found -- severity determines blocker vs warning
  return {
    outcome: check.severity === 'blocker' ? 'fail' : 'not_applicable',
    evidence: [`None of [${check.terraform_resource_types.join(', ')}] found in Terraform state`],
  };
}

// ---------------------------------------------------------------------------
// Pass 23 entry point
// ---------------------------------------------------------------------------

export interface LzrPassInput {
  providerId: string;
  landingZoneId: string;
}

export async function runLzrPass(
  ctx: PassContext,
  input: LzrPassInput,
): Promise<PassResult & { lzrResult: LandingZoneReadinessResult }> {
  const { workspacePath, iter, assessedAt } = ctx;
  const { providerId, landingZoneId } = input;

  const inputFiles = findLzrInputFiles(workspacePath);

  const states = inputFiles
    .filter((f) => extname(f) === '.tfstate')
    .map(parseTfState);

  const byType = collectResourceTypes(states);
  const checks = getChecksForProvider(providerId);

  // Determine whether the tfstate represents the SOURCE environment (e.g., Hostinger VPS
  // docker containers) or the TARGET provider (STACKIT/AWS/GCP resources).
  // Source mode fires when no target-provider resource types are present but docker
  // containers or other source-environment resources are.
  const prefix = providerResourcePrefix(providerId);
  const hasTargetResources = prefix
    ? [...byType.keys()].some((t) => t.startsWith(prefix))
    : false;
  const sourceServices = extractSourceServices(byType);
  const isSourceOnlyMode = !hasTargetResources && sourceServices.size > 0;

  const signals: Signal[] = [];
  const blockers: LZBlockerItem[] = [];
  const serviceChecks: LZServiceCheck[] = [];
  let sigNum = 1;

  // In source mode: emit one informational signal per detected service so the
  // service_dep implies tags are visible in the publication and feed future catalogue fits.
  if (isSourceOnlyMode) {
    for (const [serviceCode, ev] of sourceServices) {
      signals.push({
        id: `LZR-${String(sigNum).padStart(2, '0')}`,
        source: 'static_analysis',
        category: 'infrastructure_platform',
        severity: 'informational',
        derivation: `Source environment analysis: ${serviceCode} service detected in Terraform state`,
        evidence: ev,
        confidence: 'high',
        implies: [`service_dep:${serviceCode}`],
      });
      sigNum++;
    }
  }

  for (const check of checks) {
    const { outcome, evidence } = isSourceOnlyMode
      ? evaluateCheckFromSource(check, sourceServices)
      : evaluateCheck(check, byType, providerId);

    if (outcome === 'not_applicable') continue;

    if (check.category === 'service' && check.terraform_resource_types) {
      const isProvisioned = outcome === 'pass';
      const serviceCheck: LZServiceCheck = {
        service: check.name,
        required: true,
        available_in_lz: true,
        provisioned_in_lz: isProvisioned,
        version_compatible: isProvisioned ? true : null,
        status: isProvisioned ? 'ready' : (check.severity === 'blocker' ? 'blocked' : 'warning'),
      };
      serviceChecks.push(serviceCheck);
    }

    if (outcome === 'pass') {
      signals.push({
        id: `LZR-${String(sigNum).padStart(2, '0')}`,
        source: 'static_analysis',
        category: 'infrastructure_platform',
        severity: 'positive',
        derivation: `${check.name}: ${evidence[0]}`,
        evidence,
        confidence: 'high',
      });
      sigNum++;
    } else {
      if (check.severity === 'blocker') {
        blockers.push({
          check_id: check.id,
          category: check.category as LZBlockerItem['category'],
          description: check.description.trim(),
          evidence,
          remediation: check.remediation ?? '',
          blocks_migration: true,
        });
        signals.push({
          id: `LZR-${String(sigNum).padStart(2, '0')}`,
          source: 'static_analysis',
          category: 'infrastructure_platform',
          severity: 'high',
          derivation: `${check.name}: required resource not found. ${check.description.trim()}`,
          evidence,
          confidence: 'high',
        });
        sigNum++;
      }
    }
  }

  const hasBlockers = blockers.length > 0;
  const overall_verdict: LandingZoneReadinessResult['overall_verdict'] = hasBlockers
    ? 'blocked'
    : 'ready';

  const lzrResult: LandingZoneReadinessResult = {
    provider_id: providerId,
    landing_zone_id: landingZoneId,
    assessed_at: assessedAt,
    ingestion_strategy: 'terraform',
    blockers,
    warnings: [],
    service_checks: serviceChecks,
    quota_checks: [],
    policy_checks: [],
    network_checks: [],
    overall_verdict,
  };

  return {
    pass: {
      id: 23,
      name: 'lzr',
      signal_prefix: 'LZR',
      status: 'complete',
      iter,
      assessed_at: assessedAt,
    },
    signals,
    assessment: {
      provider_id: providerId,
      landing_zone_id: landingZoneId,
      ingestion_strategy: isSourceOnlyMode ? 'source_environment_analysis' : 'terraform',
      source_services_detected: isSourceOnlyMode ? [...sourceServices.keys()] : undefined,
      input_files: inputFiles.length,
      resource_types_found: byType.size,
      checks_run: checks.filter(
        (c) => c.terraform_resource_types?.length || c.service_dep_codes?.length,
      ).length,
      blockers_count: blockers.length,
      service_checks_count: serviceChecks.length,
      overall_verdict,
    },
    lzrResult,
  };
}
