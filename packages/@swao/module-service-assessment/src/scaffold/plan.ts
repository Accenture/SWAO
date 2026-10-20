// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Scaffold planning (Design 103 §4.2, §17.3, G-02, G-04, G-05, #3079, #3080).
 *
 * Pure: turns parsed intake rows into per-app `.swao.yml` objects. Clustering
 * only applies when the matched INFRA-CAT entry has `cluster_hint: true` and at
 * least `clusterThreshold` rows share its id prefix; UNKNOWN rows never cluster.
 */

import { scaffoldSignal, type ScaffoldSignal } from '@swao/core';
import { classify, idPrefix, type Classification, type InfraCatalogue } from '../catalog/infra-cat.js';
import { resolveOperationalStatus } from '../intake/column-a.js';
import type { IntakeRow, ParsedValue } from '../intake/parser.js';
import type { ServiceAppConfig } from '../schema/service-app.schema.js';
import { estimateCost, resolveCostOptions, type CostOptions } from '../cost/cost-model.js';
import { canonicalTerm, resolveGlossary, CLASSIFICATION_TERMS, CRITICALITY_TERMS, TIME_TERMS } from '../intake/terms.js';

export const DEFAULT_CLUSTER_THRESHOLD = 3;
export const SERVICE_WSP_VERSION = '0.9';

/** Top-level keys the scaffold owns; `--refresh` regenerates only keys still listed here. */
export const GENERATED_FIELDS = [
  'app_id', 'app_name', 'assessment', 'vendor_type', 'site', 'infra_category', 'os_class',
  'sovereign_rating', 'sovereign_alternatives', 'cluster', 'cluster_id', 'cluster_member_count',
  'cluster_members', 'vendor', 'platform', 'hardware', 'network', 'business', 'data',
  'disposition', 'integrations', 'integrations_notes', 'security', 'intake', 'cost',
] as const;

export interface AppPlan {
  appId: string;
  config: ServiceAppConfig;
  classification: Classification;
  /** Member app IDs when this plan is a cluster; empty otherwise. */
  members: string[];
}

export interface ScaffoldPlan {
  apps: AppPlan[];
  signals: ScaffoldSignal[];
  unknownAppIds: string[];
  /** #3210: intake values kept verbatim because no English canonical term is known. */
  warnings: string[];
}

/** Free-text fields carried verbatim in the client's wording (#3210). */
export const SOURCE_TEXT_FIELDS = ['integrations_notes'] as const;

/**
 * #3210: maps intake values to English canonical terms and collects the values
 * it could not map (per `.swao.yml` path) for one scaffold warning each.
 */
class TermMapper {
  readonly unmapped = new Map<string, Set<string>>();
  constructor(private readonly glossary: Record<string, string>) {}

  private map(path: string, raw: string | null, terms: Readonly<Record<string, string>>): { value: string | null; source?: string } {
    if (raw === null) return { value: null };
    const r = canonicalTerm(raw, terms);
    if (!r.mapped) this.unmapped.set(path, (this.unmapped.get(path) ?? new Set<string>()).add(r.value));
    return r.source !== undefined ? { value: r.value, source: r.source } : { value: r.value };
  }
  glossaryTerm(path: string, raw: string | null) { return this.map(path, raw, this.glossary); }
  enumTerm(path: string, raw: string | null, terms: Readonly<Record<string, string>>) { return this.map(path, raw, terms); }

  warnings(): string[] {
    const out: string[] = [];
    for (const [path, values] of this.unmapped) {
      const shown = [...values].slice(0, 20).map((v) => `"${v}"`).join(', ');
      const more = values.size > 20 ? ` and ${values.size - 20} more` : '';
      const glossaryField = path === 'business.domain' || path === 'business.function';
      out.push(glossaryField
        ? `field ${path}: ${values.size} value(s) not in the glossary, kept verbatim: ${shown}${more}; add English terms under service_portfolio.glossary in the workspace .swao.yml`
        : `field ${path}: ${values.size} value(s) not recognised as an English canonical value, kept verbatim: ${shown}${more}`);
    }
    return out;
  }
}

/** `{ key: value, key_source: original }`, with the source key only when the wording differs. */
function withSource(key: string, t: { value: string | null; source?: string }): Record<string, string | null> {
  return t.source !== undefined ? { [key]: t.value, [`${key}_source`]: t.source } : { [key]: t.value };
}

const str = (v: ParsedValue | undefined): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: ParsedValue | undefined): number | null => (typeof v === 'number' ? v : null);
const bool = (v: ParsedValue | undefined): boolean | null => (typeof v === 'boolean' ? v : null);
const list = (v: ParsedValue | undefined): string[] | null => (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : null);

function vendorType(v: ParsedValue | undefined): ServiceAppConfig['vendor_type'] {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  if (s.includes('saas')) return 'saas';
  if (s.includes('hybrid')) return 'hybrid';
  if (s.includes('legacy')) return 'legacy';
  return 'on-premises';
}

function buildConfig(row: IntakeRow, cls: Classification, generatedAt: string, costOptions: CostOptions, terms: TermMapper): ServiceAppConfig {
  const v = row.values;
  // #3210: English canonical values; the client's wording is kept in *_source.
  const domain = terms.glossaryTerm('business.domain', str(v.business_domain));
  const fn = terms.glossaryTerm('business.function', str(v.business_function));
  const criticality = terms.enumTerm('business.criticality', str(v.criticality), CRITICALITY_TERMS);
  const classification = terms.enumTerm('data.classification', str(v.data_classification), CLASSIFICATION_TERMS);
  const time = terms.enumTerm('disposition.gartner_time', str(v.gartner_time), TIME_TERMS);
  const domainTerms = row.domains.length > 1 ? row.domains.map((d) => terms.glossaryTerm('business.domain', d)) : null;
  const domainsChanged = domainTerms?.some((t) => t.source !== undefined) ?? false;
  const svc = cls.service;
  const healthImplied = svc?.data_health_implied === true;
  const activeMemory = num(v.active_memory_mb);
  const status = resolveOperationalStatus(row.flag, activeMemory, num(v.memory_mb));
  const { cost, eurMonthly } = estimateCost({ cpu_cores: num(v.cpu_cores), memory_mb: num(v.memory_mb), operational_status: status, os_class: cls.os_class, os: str(v.os) }, costOptions);
  return {
    wsp_version: SERVICE_WSP_VERSION,
    app_id: row.appId,
    app_name: row.appName || null,
    imports_dir: 'wsp/inputs/',
    // SWAO_APM is the service assessment's framework (Design 103 §7); COMP evaluates it.
    assessment: { type: 'service', regimes_active: ['SWAO_APM'] },
    vendor_type: vendorType(v.vendor_type),
    site: cls.site,
    infra_category: cls.infra_category,
    os_class: cls.os_class,
    sovereign_rating: svc?.sovereign_rating ?? null,
    sovereign_alternatives: svc?.sovereign_alternatives ?? [],
    cluster: false,
    cluster_id: null,
    cluster_member_count: null,
    cluster_members: null,
    vendor: {
      name: str(v.vendor_name),
      version: str(v.vendor_version),
      url: str(v.vendor_url),
      support_active: bool(v.vendor_support_active),
      contract_expiry: str(v.contract_expiry),
      ...row.pii,
    },
    platform: {
      os: str(v.os),
      os_eol: str(v.os_eol),
      auth_method: str(v.auth_method),
      backup_enabled: bool(v.backup_enabled),
      sla_uptime: num(v.sla_uptime),
    },
    hardware: {
      cpu_cores: num(v.cpu_cores),
      memory_mb: num(v.memory_mb),
      active_memory_mb: activeMemory,
      disk_count: num(v.disk_count),
      total_disk_mib: num(v.total_disk_mib),
      total_disk_gb: num(v.total_disk_gb),
      est_cloud_cost_eur_mo: eurMonthly,
    },
    network: { ip: str(v.ip), zone: str(v.network_zone) },
    business: {
      ...withSource('function', fn),
      ...withSource('domain', domain),
      domains: domainTerms ? domainTerms.map((t) => t.value as string) : null,
      ...(domainsChanged ? { domains_source: row.domains } : {}),
      ...withSource('criticality', criticality),
      user_count: num(v.user_count),
      annual_cost_eur: num(v.annual_cost_eur),
      license_type: str(v.license_type),
    },
    data: {
      health_data: bool(v.health_data) ?? (healthImplied ? true : null),
      pii: bool(v.data_pii) ?? (healthImplied ? true : null),
      subjects: list(v.data_subjects),
      categories: list(v.data_categories),
      ...withSource('classification', classification),
      residency: str(v.data_residency),
      subprocessors: list(v.subprocessors),
      gdpr_art9: bool(v.gdpr_art9) ?? (healthImplied ? true : null),
      hipaa_phi: bool(v.hipaa_phi),
      regulatory: list(v.regulatory) ?? (svc?.regulatory?.length ? svc.regulatory : null),
      mdr_class: str(v.mdr_class),
    },
    disposition: {
      operational_status: status,
      migration_candidate: bool(v.migration_candidate),
      ...withSource('gartner_time', time),
      migration_project_vendor: str(v.migration_project_vendor),
      ams_sovereign_cloud: bool(v.ams_sovereign_cloud),
    },
    integrations: row.integrations,
    integrations_notes: row.integrationsNotes,
    security: { last_audit_date: str(v.last_audit_date) },
    intake: {
      sheet: row.sheet,
      row: row.row,
      fields: [...row.mappedFields].sort(),
      ...(row.integrationsNotes !== null ? { source_text_fields: [...SOURCE_TEXT_FIELDS] } : {}),
    },
    cost: cost as unknown as ServiceAppConfig['cost'],
    generated_fields: [...GENERATED_FIELDS],
    generated_at: generatedAt,
  };
}

export function planScaffold(
  rows: readonly IntakeRow[],
  catalogue: InfraCatalogue,
  opts: { clusterThreshold?: number; generatedAt?: string; costOptions?: CostOptions; glossary?: Record<string, string> } = {},
): ScaffoldPlan {
  const terms = new TermMapper(opts.glossary ?? resolveGlossary());
  const costOptions = opts.costOptions ?? resolveCostOptions();
  const threshold = opts.clusterThreshold ?? DEFAULT_CLUSTER_THRESHOLD;
  const generatedAt = opts.generatedAt ?? new Date().toISOString().slice(0, 10);
  const signals: ScaffoldSignal[] = [];

  const classified = rows.map((row) => ({
    row,
    cls: classify(catalogue, {
      appId: row.appId,
      vendorName: typeof row.values.vendor_name === 'string' ? row.values.vendor_name : null,
      appName: row.appName,
      os: typeof row.values.os === 'string' ? row.values.os : null,
    }),
  }));

  // Cluster candidates: cluster_hint entries, grouped by (id prefix, category)
  const groups = new Map<string, typeof classified>();
  for (const c of classified) {
    if (c.cls.infra_category === 'UNKNOWN' || c.cls.service?.cluster_hint !== true) continue;
    const prefix = idPrefix(c.row.appId);
    if (!prefix) continue;
    const key = `${prefix}\u0000${c.cls.infra_category}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const clustered = new Set<IntakeRow>();
  const apps: AppPlan[] = [];

  for (const [key, members] of groups) {
    if (members.length < threshold) continue;
    const prefix = key.split('\u0000')[0] as string;
    const first = members[0] as (typeof classified)[number];
    const clusterId = `${prefix}-cluster`;
    const memberIds = members.map((m) => m.row.appId);
    for (const m of members) clustered.add(m.row);
    const config = buildConfig({ ...first.row, appId: clusterId }, first.cls, generatedAt, costOptions, terms);
    config.app_name = `${first.cls.service?.name ?? first.cls.infra_category} cluster (${members.length} members)`;
    config.cluster = true;
    config.cluster_id = prefix;
    config.cluster_member_count = members.length;
    config.cluster_members = memberIds;
    apps.push({ appId: clusterId, config, classification: first.cls, members: memberIds });
    signals.push(scaffoldSignal('SCAFFOLD.CLUSTER_DETECTED', {
      derivation: `${members.length} rows share id prefix "${prefix}" and category ${first.cls.infra_category} (cluster_hint); consolidated into one assessment (G-02).`,
      evidence: memberIds,
      appId: clusterId,
    }));
  }

  const unknownAppIds: string[] = [];
  for (const c of classified) {
    if (clustered.has(c.row)) continue;
    apps.push({ appId: c.row.appId, config: buildConfig(c.row, c.cls, generatedAt, costOptions, terms), classification: c.cls, members: [] });
    if (c.cls.infra_category === 'UNKNOWN') {
      unknownAppIds.push(c.row.appId);
      signals.push(scaffoldSignal('SCAFFOLD.CATEGORY_UNKNOWN', {
        derivation: 'No INFRA-CAT entry matched the id prefix, vendor, or product name; assign infra_category manually (G-05).',
        evidence: [`sheet "${c.row.sheet}" row ${c.row.row}`],
        appId: c.row.appId,
      }));
    }
  }

  return { apps, signals, unknownAppIds, warnings: terms.warnings() };
}
