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

import { readdirSync, existsSync, readFileSync } from 'fs';
import { join, extname, basename } from 'path';
import type { PassContext, PassResult } from '@swao/core';
import type { Signal } from '@swao/core';
import { getChecksForProvider } from '../catalogue/lzr-checks-catalogue.js';
import type { LzrCheck } from '../catalogue/lzr-checks-catalogue.js';
import type {
  LandingZoneReadinessResult,
  LZBlockerItem,
  LZWarningItem,
  LZServiceCheck,
  LZPolicyCheck,
  LZNetworkCheck,
} from '@swao/core';
import type { TfResource, TfState } from './tf-state-parser.js';
import { parseTfState, collectResourceTypes, extractSourceServices } from './tf-state-parser.js';
export { parseTfState, extractSourceServices } from './tf-state-parser.js';

// ---------------------------------------------------------------------------
// Check outcomes
//
//   pass           -- requirement met (positive LZR signal)
//   fail           -- requirement unmet: blocker or warning by check.severity
//   not_applicable -- the check does not concern this workload (e.g. a
//                     service the source environment does not use)
//   not_evaluated  -- the check applies but cannot be decided from Terraform
//                     input (no resource types for this provider, quota or
//                     policy data not present in state). Reported, never
//                     silently dropped (#3153).
// ---------------------------------------------------------------------------

type CheckOutcome = 'pass' | 'fail' | 'not_applicable' | 'not_evaluated';

interface CheckEvaluation {
  outcome: CheckOutcome;
  evidence: string[];
  /** Why the check was not evaluated (outcome === 'not_evaluated'). */
  reason?: string;
}

function evaluateCheckFromSource(
  check: LzrCheck,
  sourceServices: Map<string, string[]>,
): CheckEvaluation {
  const codes = check.service_dep_codes ?? [];
  if (codes.length === 0) {
    return {
      outcome: 'not_evaluated',
      evidence: [],
      reason: 'Terraform input describes the source environment only; this check needs target landing-zone resources',
    };
  }
  for (const code of codes) {
    const ev = sourceServices.get(code);
    if (ev && ev.length > 0) {
      // #3153: the target must provide the service the source uses. Warning-level
      // checks are reported as warnings instead of being dropped.
      return { outcome: 'fail', evidence: ev.map((e) => `Detected in source environment: ${e}`) };
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
// .tfplan parsing (#3153)
//
// Accepted: the JSON form of a plan (`terraform show -json plan.tfplan`,
// format_version 1.x with planned_values.root_module, including nested
// child_modules). A plan file that already holds a state-shaped document
// (`resources` array) is read as state. The binary plan format written by
// `terraform plan -out` is a zip archive and cannot be read without the
// Terraform binary; it is reported as unparsed with an export hint.
// ---------------------------------------------------------------------------

interface PlanModule {
  resources?: Array<{ mode?: string; type?: string; name?: string; values?: Record<string, unknown> }>;
  child_modules?: PlanModule[];
}

function collectPlanResources(mod: PlanModule | undefined, out: TfResource[]): void {
  if (!mod) return;
  for (const r of mod.resources ?? []) {
    if (r.mode !== undefined && r.mode !== 'managed') continue;
    if (typeof r.type !== 'string' || typeof r.name !== 'string') continue;
    out.push({ type: r.type, name: r.name, instances: [{ attributes: r.values ?? {} }] });
  }
  for (const child of mod.child_modules ?? []) collectPlanResources(child, out);
}

export function parseTfPlan(filePath: string): TfState {
  const buf = readFileSync(filePath);
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) {
    throw new Error('binary plan format; export it with `terraform show -json <plan> > <name>.tfplan`');
  }
  const parsed = JSON.parse(buf.toString('utf-8')) as Record<string, unknown>;
  if (Array.isArray(parsed['resources'])) return parsed as TfState;
  const planned = parsed['planned_values'] as { root_module?: PlanModule } | undefined;
  const resources: TfResource[] = [];
  collectPlanResources(planned?.root_module, resources);
  return { resources };
}

// ---------------------------------------------------------------------------
// Provider derivation (#3153)
//
// The host used to pass providerId 'stackit_de_sovereign' for every landing
// zone, so AWS, Azure and GCP resource types were never applicable. The
// provider is now derived from the selected landing zone, in this order:
//   1. the landing-zone ID itself (an exact catalogue provider ID, or a vendor
//      token such as `aws`, `azure`, `stackit` in an ID like lz-aws-eu-central-1)
//   2. the configured assessment.landing_zone.provider (.swao.yml)
//   3. the dominant target-provider resource prefix in the Terraform input
//   4. stackit_de_sovereign (the previous behaviour), flagged as a default
// ---------------------------------------------------------------------------

export type LzrProviderSource = 'explicit' | 'landing_zone_id' | 'configuration' | 'terraform_resources' | 'default';

export interface LzrProviderDerivation {
  providerId: string;
  source: LzrProviderSource;
}

export const DEFAULT_LZR_PROVIDER_ID = 'stackit_de_sovereign';

/** Provider IDs of controls/cloud-provider-catalogue.yaml that Pass 23 can name. */
const KNOWN_PROVIDER_IDS = new Set([
  'stackit_de_sovereign', 'otc_de_sovereign', 'ionos_de_sovereign', 'cloudferro_eu_sovereign',
  'ovhcloud_eu_sovereign', 'hetzner_de_managed', 'exoscale_ch_sovereign', 'azure_west_europe',
  'aws_eu_central_1', 'aws_eu_sovereign', 'gcp_eu_regions', 'gridscale_de_sovereign',
  'plusserver_de_sovereign', 'contabo_de_managed', 't_systems_de_sovereign', 'ionos_eu_cloud',
]);

/** Vendor token (from a landing-zone ID or a configured CSP short name) to provider ID. */
const VENDOR_TOKEN_TO_PROVIDER: ReadonlyArray<readonly [string, string]> = [
  ['stackit', 'stackit_de_sovereign'],
  ['otc', 'otc_de_sovereign'],
  ['ionos', 'ionos_de_sovereign'],
  ['cloudferro', 'cloudferro_eu_sovereign'],
  ['ovh', 'ovhcloud_eu_sovereign'],
  ['ovhcloud', 'ovhcloud_eu_sovereign'],
  ['hetzner', 'hetzner_de_managed'],
  ['exoscale', 'exoscale_ch_sovereign'],
  ['azure', 'azure_west_europe'],
  ['aws', 'aws_eu_central_1'],
  ['gcp', 'gcp_eu_regions'],
  ['google', 'gcp_eu_regions'],
  ['gridscale', 'gridscale_de_sovereign'],
  ['plusserver', 'plusserver_de_sovereign'],
  ['contabo', 'contabo_de_managed'],
  ['tsystems', 't_systems_de_sovereign'],
];

/** Terraform resource-type prefix of each provider family. */
const RESOURCE_PREFIX_TO_PROVIDER: ReadonlyArray<readonly [string, string]> = [
  ['stackit_', 'stackit_de_sovereign'],
  ['aws_', 'aws_eu_central_1'],
  ['azurerm_', 'azure_west_europe'],
  ['google_', 'gcp_eu_regions'],
  ['opentelekomcloud_', 'otc_de_sovereign'],
  ['ionoscloud_', 'ionos_de_sovereign'],
  ['hcloud_', 'hetzner_de_managed'],
  ['exoscale_', 'exoscale_ch_sovereign'],
  ['ovh_', 'ovhcloud_eu_sovereign'],
];

function providerFromText(text: string): string | null {
  const norm = text.trim().toLowerCase();
  if (norm.length === 0) return null;
  const underscored = norm.replace(/[-\s.]+/g, '_');
  if (KNOWN_PROVIDER_IDS.has(underscored)) return underscored;
  const compact = norm.replace(/[-_\s.]+/g, '');
  const tokens = new Set(norm.split(/[-_\s.]+/).filter((t) => t.length > 0));
  if (compact.includes('tsystems')) tokens.add('tsystems');
  for (const [token, providerId] of VENDOR_TOKEN_TO_PROVIDER) {
    if (!tokens.has(token)) continue;
    // AWS European Sovereign Cloud: lz-aws-esc-..., aws-esc, aws-sovereign.
    if (token === 'aws' && (tokens.has('esc') || tokens.has('sovereign') || tokens.has('eusc'))) return 'aws_eu_sovereign';
    return providerId;
  }
  return null;
}

function providerFromResourceTypes(resourceTypes: Iterable<string>, byType?: Map<string, TfResource[]>): string | null {
  const counts = new Map<string, number>();
  for (const t of resourceTypes) {
    const hit = RESOURCE_PREFIX_TO_PROVIDER.find(([prefix]) => t.startsWith(prefix));
    if (!hit) continue;
    const n = byType?.get(t)?.length ?? 1;
    counts.set(hit[1], (counts.get(hit[1]) ?? 0) + n);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [providerId, n] of counts) {
    if (n > bestN) { best = providerId; bestN = n; }
  }
  return best;
}

export function deriveLzrProviderId(input: {
  landingZoneId: string;
  configuredProvider?: string;
  resourceTypes?: Iterable<string>;
  byType?: Map<string, TfResource[]>;
}): LzrProviderDerivation {
  const fromId = providerFromText(input.landingZoneId);
  if (fromId) return { providerId: fromId, source: 'landing_zone_id' };
  if (input.configuredProvider) {
    const fromConfig = providerFromText(input.configuredProvider);
    if (fromConfig) return { providerId: fromConfig, source: 'configuration' };
  }
  const fromState = input.resourceTypes ? providerFromResourceTypes(input.resourceTypes, input.byType) : null;
  if (fromState) return { providerId: fromState, source: 'terraform_resources' };
  return { providerId: DEFAULT_LZR_PROVIDER_ID, source: 'default' };
}

// ---------------------------------------------------------------------------
// Check evaluation
// ---------------------------------------------------------------------------

function providerResourcePrefix(providerId: string): string | null {
  if (providerId.startsWith('stackit')) return 'stackit_';
  if (providerId.startsWith('aws')) return 'aws_';
  if (providerId.startsWith('azure')) return 'azurerm_';
  if (providerId.startsWith('google') || providerId.startsWith('gcp')) return 'google_';
  if (providerId.startsWith('otc')) return 'opentelekomcloud_';
  if (providerId.startsWith('ionos')) return 'ionoscloud_';
  if (providerId.startsWith('hetzner')) return 'hcloud_';
  if (providerId.startsWith('exoscale')) return 'exoscale_';
  if (providerId.startsWith('ovhcloud')) return 'ovh_';
  return null;
}

// LZC-GEN-03 (private network, no public IP on the data tier) is decided from
// resource attributes rather than resource presence (#3153). Each rule names a
// data-tier resource type and how it exposes a public endpoint.
const DATA_TIER_PUBLIC_RULES: ReadonlyArray<{ type: string; isPublic: (a: Record<string, unknown>) => boolean; what: string }> = [
  { type: 'aws_db_instance', isPublic: (a) => a['publicly_accessible'] === true, what: 'publicly_accessible = true' },
  { type: 'aws_rds_cluster_instance', isPublic: (a) => a['publicly_accessible'] === true, what: 'publicly_accessible = true' },
  { type: 'azurerm_postgresql_flexible_server', isPublic: (a) => a['public_network_access_enabled'] === true, what: 'public_network_access_enabled = true' },
  { type: 'azurerm_postgresql_server', isPublic: (a) => a['public_network_access_enabled'] === true, what: 'public_network_access_enabled = true' },
  { type: 'azurerm_mysql_flexible_server', isPublic: (a) => a['public_network_access_enabled'] === true, what: 'public_network_access_enabled = true' },
  { type: 'azurerm_mssql_server', isPublic: (a) => a['public_network_access_enabled'] === true, what: 'public_network_access_enabled = true' },
  {
    type: 'google_sql_database_instance',
    isPublic: (a) => {
      const settings = Array.isArray(a['settings']) ? (a['settings'][0] as Record<string, unknown> | undefined) : undefined;
      const ipc = settings && Array.isArray(settings['ip_configuration'])
        ? (settings['ip_configuration'][0] as Record<string, unknown> | undefined)
        : undefined;
      return ipc?.['ipv4_enabled'] === true;
    },
    what: 'settings.ip_configuration.ipv4_enabled = true',
  },
  ...['stackit_postgresflex_instance', 'stackit_mongodbflex_instance', 'stackit_sqlserverflex_instance'].map((type) => ({
    type,
    isPublic: (a: Record<string, unknown>) => Array.isArray(a['acl']) && (a['acl'] as unknown[]).some((c) => c === '0.0.0.0/0'),
    what: 'acl allows 0.0.0.0/0',
  })),
];

function evaluateDataTierPrivate(byType: Map<string, TfResource[]>): CheckEvaluation {
  const exposed: string[] = [];
  const privateOnes: string[] = [];
  for (const rule of DATA_TIER_PUBLIC_RULES) {
    for (const r of byType.get(rule.type) ?? []) {
      const attrs = r.instances[0]?.attributes ?? {};
      if (rule.isPublic(attrs)) exposed.push(`${rule.type}.${r.name}: ${rule.what}`);
      else privateOnes.push(`${rule.type}.${r.name}: no public endpoint in Terraform state`);
    }
  }
  if (exposed.length > 0) return { outcome: 'fail', evidence: exposed };
  if (privateOnes.length > 0) return { outcome: 'pass', evidence: privateOnes };
  return {
    outcome: 'not_evaluated',
    evidence: [],
    reason: 'no data-tier resource (managed database) found in Terraform input',
  };
}

function evaluateCheck(
  check: LzrCheck,
  byType: Map<string, TfResource[]>,
  providerId: string,
): CheckEvaluation {
  if (check.id === 'LZC-GEN-03') return evaluateDataTierPrivate(byType);

  if (!check.terraform_resource_types || check.terraform_resource_types.length === 0) {
    const hint = check.checkov_rule_ids?.length
      ? `needs an IaC policy scan (${check.checkov_rule_ids.join(', ')}), not Terraform state`
      : check.category === 'quota'
        ? 'quota availability is not recorded in Terraform state; confirm with the provider'
        : 'no Terraform resource types are defined for this check';
    return { outcome: 'not_evaluated', evidence: [], reason: hint };
  }

  // For generic (providers=all) checks, only consider resource types that match
  // the current provider's namespace. If none match, the check cannot be
  // evaluated via the Terraform strategy for this provider.
  const prefix = providerResourcePrefix(providerId);
  const applicableTypes = prefix
    ? check.terraform_resource_types.filter((t) => t.startsWith(prefix))
    : check.terraform_resource_types;

  if (applicableTypes.length === 0) {
    return {
      outcome: 'not_evaluated',
      evidence: [],
      reason: `no ${providerId} resource types are defined for this check`,
    };
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

  // Required but not found: severity decides blocker vs warning (#3153: warnings
  // used to be dropped here).
  return {
    outcome: 'fail',
    evidence: [`None of [${applicableTypes.join(', ')}] found in Terraform state`],
  };
}

// ---------------------------------------------------------------------------
// Pass 23 entry point
// ---------------------------------------------------------------------------

export interface LzrPassInput {
  /** Explicit provider ID. When omitted it is derived (deriveLzrProviderId). */
  providerId?: string;
  landingZoneId: string;
  /** assessment.landing_zone.provider from .swao.yml, used by the derivation. */
  configuredProvider?: string;
}

export async function runLzrPass(
  ctx: PassContext,
  input: LzrPassInput,
): Promise<PassResult & { lzrResult: LandingZoneReadinessResult }> {
  const { workspacePath, iter, assessedAt } = ctx;
  const { landingZoneId } = input;

  const inputFiles = findLzrInputFiles(workspacePath);

  const states: TfState[] = [];
  const unparsedFiles: Array<{ file: string; reason: string }> = [];
  for (const f of inputFiles) {
    try {
      states.push(extname(f) === '.tfplan' ? parseTfPlan(f) : parseTfState(f));
    } catch (err) {
      unparsedFiles.push({ file: basename(f), reason: (err as Error).message.split('\n')[0] ?? 'unreadable' });
    }
  }

  const byType = collectResourceTypes(states);
  const derivation: LzrProviderDerivation = input.providerId
    ? { providerId: input.providerId, source: 'explicit' }
    : deriveLzrProviderId({
        landingZoneId,
        configuredProvider: input.configuredProvider,
        resourceTypes: byType.keys(),
        byType,
      });
  const providerId = derivation.providerId;
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
  const warnings: LZWarningItem[] = [];
  const serviceChecks: LZServiceCheck[] = [];
  const policyChecks: LZPolicyCheck[] = [];
  const networkChecks: LZNetworkCheck[] = [];
  const checksNotEvaluated: Array<{ check_id: string; category: string; severity: string; reason: string }> = [];
  let sigNum = 1;
  const nextId = (): string => `LZR-${String(sigNum++).padStart(2, '0')}`;

  // In source mode: emit one informational signal per detected service so the
  // service_dep implies tags are visible in the publication and feed future catalogue fits.
  if (isSourceOnlyMode) {
    for (const [serviceCode, ev] of sourceServices) {
      signals.push({
        id: nextId(),
        source: 'static_analysis',
        category: 'infrastructure_platform',
        severity: 'informational',
        derivation: `Source environment analysis: ${serviceCode} service detected in Terraform state`,
        evidence: ev,
        confidence: 'high',
        implies: [`service_dep:${serviceCode}`],
      });
    }
  }

  for (const check of checks) {
    const { outcome, evidence, reason } = isSourceOnlyMode
      ? evaluateCheckFromSource(check, sourceServices)
      : evaluateCheck(check, byType, providerId);

    if (outcome === 'not_applicable') continue;

    if (outcome === 'not_evaluated') {
      const why = reason ?? 'not decidable from Terraform input';
      checksNotEvaluated.push({ check_id: check.id, category: check.category, severity: check.severity, reason: why });
      if (check.category === 'policy') {
        policyChecks.push({ check_id: check.id, rule: check.name, status: 'skipped', note: why });
      } else if (check.category === 'network') {
        networkChecks.push({ check_id: check.id, description: check.name, status: 'skipped', note: why });
      }
      continue;
    }

    const passed = outcome === 'pass';
    if (check.category === 'service') {
      serviceChecks.push({
        service: check.name,
        required: true,
        available_in_lz: true,
        provisioned_in_lz: passed,
        version_compatible: passed ? true : null,
        status: passed ? 'ready' : (check.severity === 'blocker' ? 'blocked' : 'warning'),
      });
    } else if (check.category === 'policy') {
      policyChecks.push({ check_id: check.id, rule: check.name, status: passed ? 'pass' : 'fail', ...(evidence[0] ? { note: evidence[0] } : {}) });
    } else if (check.category === 'network') {
      networkChecks.push({ check_id: check.id, description: check.name, status: passed ? 'pass' : 'fail', ...(evidence[0] ? { note: evidence[0] } : {}) });
    }

    if (passed) {
      signals.push({
        id: nextId(),
        source: 'static_analysis',
        category: 'infrastructure_platform',
        severity: 'positive',
        derivation: `${check.name}: ${evidence[0]}`,
        evidence,
        confidence: 'high',
      });
      continue;
    }

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
        id: nextId(),
        source: 'static_analysis',
        category: 'infrastructure_platform',
        severity: 'high',
        derivation: `${check.name}: requirement not met. ${check.description.trim()}`,
        evidence,
        confidence: 'high',
      });
    } else if (check.severity === 'warning') {
      // #3153: unmet warning-level checks are reported (they were dropped).
      warnings.push({
        check_id: check.id,
        category: check.category as LZWarningItem['category'],
        description: check.description.trim(),
        evidence,
        ...(check.remediation ? { remediation: check.remediation } : {}),
      });
      signals.push({
        id: nextId(),
        source: 'static_analysis',
        category: 'infrastructure_platform',
        severity: 'medium',
        derivation: `${check.name}: advisory, requirement not met. ${check.description.trim()}`,
        evidence,
        confidence: 'high',
      });
    }
  }

  const overall_verdict: LandingZoneReadinessResult['overall_verdict'] = blockers.length > 0
    ? 'blocked'
    : warnings.length > 0
      ? 'advisory'
      : 'ready';

  const lzrResult: LandingZoneReadinessResult = {
    provider_id: providerId,
    landing_zone_id: landingZoneId,
    assessed_at: assessedAt,
    ingestion_strategy: 'terraform',
    blockers,
    warnings,
    service_checks: serviceChecks,
    quota_checks: [],
    policy_checks: policyChecks,
    network_checks: networkChecks,
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
      provider_id_source: derivation.source,
      landing_zone_id: landingZoneId,
      ingestion_strategy: isSourceOnlyMode ? 'source_environment_analysis' : 'terraform',
      source_services_detected: isSourceOnlyMode ? [...sourceServices.keys()] : undefined,
      input_files: inputFiles.length,
      ...(unparsedFiles.length > 0 ? { input_files_unparsed: unparsedFiles } : {}),
      resource_types_found: byType.size,
      checks_run: checks.length - checksNotEvaluated.length,
      checks_not_evaluated: checksNotEvaluated,
      blockers_count: blockers.length,
      warnings_count: warnings.length,
      service_checks_count: serviceChecks.length,
      overall_verdict,
    },
    lzrResult,
  };
}
