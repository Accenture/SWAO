// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Publication renderer
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================
/**
 * Landing zone blocks: lzr-summary, lz-catalog-services, lzr-catalog-header,
 * lzr-catalog-verdict, lzr-catalog-findings, lzr-catalog-remediation, lzr-catalog-finops.
 * Design 041-PUB-06 + Design 068 -- extracted from blocks.ts (Step 9).
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load as yamlLoad } from 'js-yaml';
import type { PublicationModel, LZRSummary } from '../model.js';
import { esc, ragChip, swaoTableScript } from './helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// LZ service metadata loader
// ---------------------------------------------------------------------------

export interface ServiceMetaEntry {
  name: string | null;
  id: string | null;
  abbreviation: string | null;
}

export interface ServiceMeta {
  services: Record<string, ServiceMetaEntry>;
}

export function loadServiceMeta(): ServiceMeta {
  const candidates = [
    join(__dirname, '_lz-catalogues/aws-service-meta.json'),                   // pkg binary: bundle __dirname = dist/ (#1380)
    join(__dirname, '../../../../../../lz-catalogues/aws-service-meta.json'),  // dev + module dist: 6-up from blocks/ (= orig 5-up)
    join(__dirname, '../../../../../lz-catalogues/aws-service-meta.json'),     // 5-up from blocks/ (= orig 4-up pkg binary)
    join(__dirname, '../../../../lz-catalogues/aws-service-meta.json'),        // 4-up safety fallback
  ];
  for (const p of candidates) {
    try {
      const raw = readFileSync(p, 'utf-8');
      return JSON.parse(raw) as ServiceMeta;
    } catch { /* try next */ }
  }
  return { services: {} };
}

export function resolveServiceName(code: string, meta: ServiceMeta): string {
  const entry = meta.services[code];
  if (!entry) return code;
  if (typeof entry.name === 'string' && entry.name) return entry.name;
  if (typeof entry.id === 'string' && entry.id) return entry.id;
  return code;
}

// ---------------------------------------------------------------------------
// Capability code -> native CSP service name
// ---------------------------------------------------------------------------

// Capability code -> native CSP service brand name.
// Source: swao/lz-catalogues/*.json `fulfills` arrays (verified 2026-08-03).
const CAPABILITY_NATIVE_NAMES: Record<string, Record<string, string>> = {
  aws: {
    networking:            'VPC',
    block_storage:         'EBS',
    kubernetes:            'EKS',
    postgresql:            'RDS',
    mysql:                 'RDS',
    mariadb:               'RDS',
    redis:                 'ElastiCache',
    memcached:             'ElastiCache',
    object_storage:        'S3',
    vm_compute:            'EC2',
    serverless_compute:    'Lambda',
    container_orchestration: 'ECS',
    container_registry:    'ECR',
    key_vault:             'KMS',
    secrets_management:    'Secrets Manager',
    audit_logging:         'CloudTrail',
    iac:                   'CloudFormation',
    ci_cd:                 'CodePipeline',
    load_balancer:         'ELB',
    file_storage:          'EFS',
    nosql_database:        'DynamoDB',
    data_warehouse:        'Redshift',
    event_streaming:       'Kinesis',
    queue:                 'SQS',
    messaging:             'SNS',
    data_analytics:        'Athena',
    ml_inference:          'SageMaker',
    managed_llm:           'Bedrock',
    api_gateway:           'API Gateway',
    identity_management:   'Cognito',
    network_firewall:      'Network Firewall',
    waf:                   'WAF',
    threat_detection:      'GuardDuty',
    backup:                'Backup',
    dns:                   'Route 53 Resolver',
    dedicated_connectivity: 'Direct Connect',
  },
  azure: {
    postgresql:            'Azure DB for PostgreSQL',
    mysql:                 'Azure SQL',
    redis:                 'Azure Cache for Redis',
    kubernetes:            'AKS',
    object_storage:        'Azure Blob Storage',
    vm_compute:            'Virtual Machines',
    networking:            'Virtual Network',
    block_storage:         'Managed Disks',
    identity_management:   'Entra ID',
    key_vault:             'Key Vault',
    container_registry:    'Container Registry',
    secrets_management:    'Key Vault',
    nosql_database:        'Cosmos DB',
    event_streaming:       'Event Hubs',
    queue:                 'Service Bus',
    serverless_compute:    'Azure Functions',
    api_gateway:           'API Management',
    data_analytics:        'Synapse Analytics',
    ml_inference:          'Azure ML',
    managed_llm:           'Azure OpenAI',
    audit_logging:         'Azure Monitor',
    iac:                   'ARM / Bicep',
    ci_cd:                 'Azure DevOps',
    backup:                'Azure Backup',
  },
  gcp: {
    postgresql:            'Cloud SQL',
    mysql:                 'Cloud SQL',
    redis:                 'Cloud Memorystore',
    kubernetes:            'GKE',
    object_storage:        'Cloud Storage',
    vm_compute:            'Compute Engine',
    networking:            'VPC',
    block_storage:         'Persistent Disk',
    key_vault:             'Cloud KMS',
    secrets_management:    'Secret Manager',
    container_registry:    'Artifact Registry',
    nosql_database:        'Firestore / Bigtable',
    event_streaming:       'Pub/Sub',
    serverless_compute:    'Cloud Run',
    api_gateway:           'API Gateway',
    data_analytics:        'BigQuery',
    ml_inference:          'Vertex AI',
    managed_llm:           'Vertex AI Gemini',
    audit_logging:         'Cloud Audit Logs',
    iac:                   'Deployment Manager',
    ci_cd:                 'Cloud Build',
    backup:                'Backup and DR',
  },
  stackit: {
    postgresql:            'PostgreSQL Flex',
    redis:                 'Key Value Store',
    kubernetes:            'SKE',
    object_storage:        'Object Storage',
    vm_compute:            'Server',
    networking:            'Virtual Network',
    block_storage:         'Block Storage',
    nosql_database:        'MongoDB Atlas',
    load_balancer:         'Load Balancer',
    dns:                   'DNS',
  },
};

export function capabilityNativeName(code: string, provider: string): string {
  const p = provider.toLowerCase();
  // aws-esc is a sovereign-cloud variant of aws; service brand names are identical.
  const normalized = p === 'aws-esc' ? 'aws' : p;
  return CAPABILITY_NATIVE_NAMES[normalized]?.[code] ?? code;
}

// ---------------------------------------------------------------------------
// LZ verdict / coverage chip helpers
// ---------------------------------------------------------------------------

export function lzrVerdictChip(verdict: string): string {
  const label =
    verdict === 'READY' ? 'Ready'
    : verdict === 'READY_WITH_CHANGES' ? 'Cond. Ready'
    : verdict === 'NEEDS_VERIFICATION' ? 'Needs Verif.'
    : verdict === 'BLOCKED' ? 'Blocked'
    : verdict === 'SOVEREIGNTY_BLOCKED' ? 'Sov. Blocked'
    : verdict;
  const rag =
    verdict === 'READY' ? 'pass'
    : verdict === 'READY_WITH_CHANGES' ? 'partial'
    : verdict === 'NEEDS_VERIFICATION' ? 'partial'
    : 'fail';
  return `<span class="rag rag-${rag} pub-text-xs-nowrap">${esc(label)}</span>`;
}

export function lzCoverageStatus(result: 'pass' | 'fail' | 'not_applicable'): string {
  switch (result) {
    case 'pass': return 'Sovereign';
    case 'not_applicable': return 'Conditional';
    default: return 'Non-Sovereign';
  }
}

export function lzCoverageChip(result: 'pass' | 'fail' | 'not_applicable'): string {
  const label = lzCoverageStatus(result);
  const rag = result === 'pass' ? 'pass' : result === 'not_applicable' ? 'partial' : 'fail';
  return `<span class="rag rag-${rag} pub-text-xs-nowrap">${esc(label)}</span>`;
}

// ---------------------------------------------------------------------------
// LZR services pill renderer (#1290)
// ---------------------------------------------------------------------------

type LzRegionWithServices = {
  services?: string[];
  service_labels?: string[];
  service_count: number;
  services_detected?: string[];
};

function renderServicesPill(r: LzRegionWithServices): string {
  const labels = r.service_labels ?? r.services ?? [];
  const codes = r.services ?? [];
  if (labels.length > 0) {
    const MAX_INLINE = 4;
    const shown = labels.slice(0, MAX_INLINE);
    const rest = labels.length - MAX_INLINE;
    const pills = shown.map((lbl, i) => {
      const code = codes[i] ?? lbl;
      const tip = code !== lbl ? esc(code) : '';
      return tip
        ? `<span class="pub-tag-pill lz-service-pill" title="${tip}">${esc(lbl)}</span>`
        : `<span class="pub-tag-pill lz-service-pill">${esc(lbl)}</span>`;
    }).join(' ');
    const moreText = rest > 0 ? ` <span class="pub-text-secondary-sm">+${rest} more</span>` : '';
    return pills + moreText;
  }
  // Fallback: show app-inventory detected services (not yet catalogue-assessed)
  const detected = r.services_detected ?? [];
  if (detected.length > 0) {
    const MAX_INLINE = 4;
    const shown = detected.slice(0, MAX_INLINE);
    const rest = detected.length - MAX_INLINE;
    const tip = 'Detected in app inventory -- run LZ catalogue fit to assess CSP compatibility';
    const pills = shown.map(name =>
      `<span class="pub-tag-pill lz-service-pill lz-service-detected" title="${tip}">${esc(name)}</span>`
    ).join(' ');
    const moreText = rest > 0 ? ` <span class="pub-text-secondary-sm">+${rest} more</span>` : '';
    return pills + moreText;
  }
  return r.service_count > 0 ? esc(String(r.service_count)) + ' service(s)' : '--';
}

// ---------------------------------------------------------------------------
// Block: lzr-summary
// ---------------------------------------------------------------------------

export function renderLzrSummary(model: PublicationModel): string {
  const lzr = model.lzr as LZRSummary;
  const cat = lzr.lz_catalogue;
  const regions = lzr.regions;

  const overallClass =
    lzr.overall === 'Ready'
      ? 'callout-info'
      : lzr.overall === 'Not Assessed'
        ? 'callout-info'
        : lzr.overall === 'Blocked' || lzr.overall === 'Sovereignty Blocked'
          ? 'callout-critical'
          : 'callout-warning';

  const currentInfra = lzr.current_infra
    ? `<p class="pub-meta-text-sm">
        Workspace default landing zone: <strong>${esc(lzr.current_infra)}</strong>
      </p>`
    : '';

  // Multi-region matrix: shown when the extractor populated regions[] (#0923).
  if (regions && regions.length > 1) {
    // 3-state aggregate verdict (#1299): All READY / Mixed / All BLOCKED
    const readyCount = regions.filter(
      r => r.overall_verdict === 'READY' || r.overall_verdict === 'READY_WITH_CHANGES',
    ).length;
    const allReady = readyCount === regions.length;
    const allBlocked = readyCount === 0;
    const aggregateLabel = allReady
      ? 'Ready'
      : allBlocked
        ? lzr.overall
        : `${readyCount} of ${regions.length} regions ready`;
    const aggregateClass = allReady
      ? 'callout-info'
      : allBlocked
        ? 'callout-critical'
        : 'callout-warning';

    // Sovereignty gate active when at least one region has a real statement (#0924).
    const sovereigntyInactive = regions.every(
      r => !r.sovereignty_statement || r.sovereignty_statement.startsWith('No sovereignty requirements'),
    );
    const sovereigntyWarning = sovereigntyInactive
      ? `<div class="callout callout-warning pub-text-lg-mb">
    <strong>Sovereignty gate inactive.</strong>
    Service availability was checked but no compliance frameworks were applied to jurisdiction requirements.
    Verdicts may be optimistic -- use a framework that declares sovereignty requirements (e.g. GDPR,
    BSI_C5, or NIST_SP_800_66R2) in <code>assessment.regimes_active</code>
    inside <code>.swao.yml</code> to activate per-region sovereignty screening. Regions outside the
    selected jurisdiction would typically receive <strong>SOVEREIGNTY_BLOCKED</strong> under active
    compliance frameworks.
  </div>`
      : '';

    const regionRows = regions
      .map(r => {
        const rowModClass =
          r.overall_verdict === 'READY' ? ''
          : r.overall_verdict === 'READY_WITH_CHANGES' ? 'pub-tr-warning'
          : r.overall_verdict === 'NEEDS_VERIFICATION' ? 'pub-tr-warning'
          : 'pub-tr-danger';
        const sovNote = sovereigntyInactive
          ? `<span class="pub-subtext">Service availability only</span>`
          : r.sovereignty_statement
            ? `<span class="pub-subtext">${esc(r.sovereignty_statement)}</span>`
            : '';
        return `
    <tr class="pub-tr-border ${rowModClass}">
      <td class="pub-td-mid">
        <span class="pub-provider-badge">${esc(r.provider.toUpperCase())}</span>
      </td>
      <td class="pub-td-mono">${esc(r.region)}</td>
      <td class="pub-td-mid">${lzrVerdictChip(r.overall_verdict)}${sovNote}</td>
      <td class="pub-td-right-sm">${renderServicesPill(r)}</td>
      <td class="pub-td-mid-right">
        ${r.overall_verdict === 'SOVEREIGNTY_BLOCKED'
          ? `<span class="rag rag-fail pub-text-xs-nowrap">Sovereignty</span>`
          : r.blockers > 0
            ? `<span class="pub-text-high-bold">${esc(String(r.blockers))} blocker(s)</span>`
            : `<span class="pub-text-secondary-sm">None</span>`}
      </td>
    </tr>`;
      })
      .join('');

    return `<section id="lzr-summary" class="swao-block swao-block--lzr-summary">
  <h2 id="lzr-summary-h" data-i18n-key="block.lzr_summary.title">Landing Zone Readiness</h2>
  <div class="callout ${aggregateClass} pub-mb-4">
    <strong>${esc(aggregateLabel)}</strong> --
    ${esc(lzr.blockers)} <span data-i18n-key="block.lzr_summary.blockers">blocker(s)</span>
    <span class="pub-text-secondary-faded">${esc(String(regions.length))} regions assessed</span>
  </div>
  ${sovereigntyWarning}
  <table class="pub-table">
    <thead>
      <tr class="pub-tr-primary">
        <th class="pub-td-mid-left">Provider</th>
        <th class="pub-td-mid-left">Region</th>
        <th class="pub-td-mid-left">Verdict</th>
        <th class="pub-td-mid-right">Services</th>
        <th class="pub-td-mid-right">Blockers</th>
      </tr>
    </thead>
    <tbody>${regionRows}</tbody>
  </table>
</section>`;
  }

  // Single-region path: existing checks table.
  const checksRows = lzr.checks
    .map(
      c => `
    <tr class="pub-tr-border">
      <td class="pub-td-mono-sm">${esc(c.id)}</td>
      <td class="pub-td">${esc(c.label)}</td>
      <td class="pub-td">${ragChip(c.result === 'not_applicable' ? 'partial' : c.result)}</td>
    </tr>`,
    )
    .join('');

  const catHeader = cat
    ? `<p class="pub-meta-text">
        LZ Catalogue: <strong>${esc(cat.provider)}</strong> / <code>${esc(cat.region)}</code>
      </p>`
    : '';

  const noChecksMsg = cat
    ? `No service dependencies detected in this run -- all required services resolved to available.`
    : lzr.overall === 'Not Assessed'
      ? 'No landing zone target selected for this assessment. Re-run and select a target LZ to see readiness results.'
      : lzr.blockers > 0
        ? `LZR tag indicates ${esc(String(lzr.blockers))} blocker(s) but no detailed LZR checks were run in this assessment. Run a full LZR pass to see per-check results.`
        : 'No LZR checks recorded for this run.';

  return `<section id="lzr-summary" class="swao-block swao-block--lzr-summary">
  <h2 id="lzr-summary-h" data-i18n-key="block.lzr_summary.title">Landing Zone Readiness</h2>
  <div class="callout ${overallClass} pub-mb-4">
    <strong>${esc(lzr.overall)}</strong> --
    ${esc(lzr.blockers)} <span data-i18n-key="block.lzr_summary.blockers">blocker(s)</span>
  </div>
  ${currentInfra}${catHeader}${
    lzr.checks.length > 0
      ? `<table class="pub-table">
    <thead>
      <tr class="pub-tr-primary">
        <th class="pub-th">ID</th>
        <th class="pub-th"><span data-i18n-key="block.lzr_summary.overall">Service</span></th>
        <th class="pub-th"><span data-i18n-key="compliance_regime.col_status">Status</span></th>
      </tr>
    </thead>
    <tbody>${checksRows}</tbody>
  </table>`
      : `<p class="pub-text-secondary">${noChecksMsg}</p>`
  }
</section>`;
}

// ---------------------------------------------------------------------------
// Helper: cloud-provider-catalogue.yaml section (#1364, #1376, #1377)
// ---------------------------------------------------------------------------

let _cloudCatalogueCache: Map<string, CloudProviderData> | null = null;
function getCloudCatalogue(): Map<string, CloudProviderData> {
  if (!_cloudCatalogueCache) _cloudCatalogueCache = loadCloudProviderCatalogue();
  return _cloudCatalogueCache;
}

// #1590: human-readable display names for compliance regime codes.
const REGIME_DISPLAY_NAMES: Record<string, string> = {
  gdpr: 'General Data Protection Regulation (GDPR)',
  nist_sp_800_66r2: 'NIST SP 800-66r2 (HIPAA Security Rule)',
  nist_sp_800_171: 'NIST SP 800-171 (CUI Protection)',
  nist_sp_800_53: 'NIST SP 800-53 (Security & Privacy Controls)',
  iso_27001: 'ISO/IEC 27001 (Information Security Management)',
  iso_27017: 'ISO/IEC 27017 (Cloud Security Controls)',
  iso_27018: 'ISO/IEC 27018 (Cloud Privacy)',
  bsi_c5: 'BSI C5 (Cloud Computing Compliance Criteria Catalogue)',
  soc2: 'SOC 2 (Service Organization Control 2)',
  pci_dss: 'PCI DSS (Payment Card Industry Data Security Standard)',
  hipaa: 'HIPAA (Health Insurance Portability and Accountability Act)',
  ai_10_pillars: 'AI 10 Pillars (Accenture Responsible AI Framework)',
  eucs: 'EUCS (EU Cybersecurity Certification Scheme for Cloud)',
  enisa: 'ENISA Cloud Security Guidelines',
  csf: 'NIST Cybersecurity Framework (CSF)',
  ccm: 'CSA Cloud Controls Matrix (CCM)',
  fedramp: 'FedRAMP (Federal Risk and Authorization Management Program)',
  irap: 'IRAP (Information Security Registered Assessors Program)',
};

function regimeDisplayName(regimeKey: string): string {
  return REGIME_DISPLAY_NAMES[regimeKey.toLowerCase()] ?? regimeKey.toUpperCase().replace(/_/g, ' ');
}

// Capability codes that use open or interoperable standards (S3, OCI, Kubernetes wire, SQL).
const OPEN_STANDARD_CAP_PREFIXES = [
  'kubernetes', 'k8s', 'postgresql', 'mysql', 'mariadb', 'redis',
  'object_storage', 'block_storage', 'networking', 'dns', 'load_balancer',
  'container_registry', 'nfs',
];
function isOpenStandardCap(code: string): string {
  const lower = code.toLowerCase().replace(/-/g, '_');
  return OPEN_STANDARD_CAP_PREFIXES.some(p => lower === p || lower.startsWith(p + '_') || lower.startsWith(p + '@'))
    ? 'yes' : 'no';
}

// Derive a sovereignty tier label from a provider's certifications.
function deriveSovereigntyTier(certs: Record<string, { status: string }> | undefined): string {
  if (!certs) return '--';
  const attested = (id: string) => certs[id]?.status === 'attested' || certs[id]?.status === 'certified';
  if (attested('eucs_high')) return 'EUCS High';
  if (attested('eucs_substantial')) return 'EUCS Substantial';
  if (attested('bsi_c5')) return 'BSI C5 Attested';
  if (attested('iso_27001')) return 'ISO 27001';
  return '--';
}

function buildProviderCatalogueSection(
  providerIds: string[],
  selectedFrameworks?: string[],
  sovereigntyInactive?: boolean,
): string {
  const catalogue = getCloudCatalogue();
  if (catalogue.size === 0) return '';
  const uniqueProviders = [...new Set(providerIds.map(p => p.toLowerCase()))];
  const sections: string[] = [];

  // #1591 / #1612: build framework filter once; applied to both certifications
  // and compliance regime coverage. Normalise to lowercase underscored tokens.
  // When null, no framework filter is active (show all, or note when inactive).
  const frameworkFilter = selectedFrameworks && selectedFrameworks.length > 0
    ? new Set(selectedFrameworks.map(f => f.toLowerCase().replace(/-/g, '_')))
    : null;

  for (const rawId of uniqueProviders) {
    // Match by prefix: "stackit" matches "stackit_de_sovereign", "aws-esc" matches "aws_esc_eusc"
    const providerData = [...catalogue.values()].find(pd =>
      pd.id.toLowerCase().startsWith(rawId.replace('-', '_')) ||
      rawId.replace('-', '_').startsWith(pd.id.toLowerCase().split('_')[0] ?? '')
    );
    if (!providerData) continue;

    // #1615: Certifications -- only show certifications that match the assessed frameworks.
    // When frameworkFilter is active: show only matching certs (assessed subset).
    // When frameworkFilter is null (no sovereignty framework active): show all certs in a
    // clearly labelled "CSP-Declared (not assessed)" section -- never mix with verdicts.
    const certEntries = Object.entries(providerData.certifications);
    const isAssessedCert = (certId: string): boolean => {
      if (!frameworkFilter) return false; // no filter = nothing is "assessed"
      const key = certId.toLowerCase().replace(/-/g, '_');
      return [...frameworkFilter].some(f => key === f || key.startsWith(f + '_'));
    };
    const formatCertRow = ([certId, cert]: [string, { status: string; last_audited?: string; evidence_url?: string; notes?: string }]) => {
      const statusClass = cert.status === 'attested' || cert.status === 'certified' ? 'rag-pass'
        : cert.status === 'in_progress' ? 'rag-partial' : 'rag-fail';
      const auditDate = cert.last_audited ? ` <span class="pub-text-xs-secondary">(audited ${esc(cert.last_audited)})</span>` : '';
      const evLink = cert.evidence_url
        ? ` <a class="pub-link" href="${esc(cert.evidence_url)}" target="_blank" rel="noopener">Evidence</a>`
        : '';
      return `<tr>
          <td class="pub-td"><code>${esc(certId)}</code></td>
          <td class="pub-td"><span class="rag ${statusClass} pub-text-xs-nowrap">${esc(cert.status)}</span>${auditDate}${evLink}</td>
          ${cert.notes ? `<td class="pub-td pub-text-xs">${esc(cert.notes)}</td>` : '<td class="pub-td">--</td>'}
        </tr>`;
    };
    const certRows = certEntries.filter(([certId]) => isAssessedCert(certId)).map(formatCertRow).join('');
    const certDeclaredRows = frameworkFilter
      ? certEntries.filter(([certId]) => !isAssessedCert(certId)).map(formatCertRow).join('')
      : certEntries.map(formatCertRow).join('');

    // #1591: Compliance regime coverage -- only shown when a sovereignty framework is active.
    // When no frameworks are selected (DEMO / availability-only run), show a note instead
    // of displaying all regimes, which would be misleading without a governance context.
    const regimeCoverage = providerData.compliance_regime_coverage ?? {};
    const filteredRegimes = (!frameworkFilter || sovereigntyInactive)
      ? [] // #1591: omit when no framework filter or sovereignty inactive
      : Object.entries(regimeCoverage).filter(([regime]) => {
          const key = regime.toLowerCase().replace(/-/g, '_');
          return frameworkFilter.has(key);
        });
    const regimeRows = filteredRegimes
      .map(([regime, status]) => {
        const regClass = status === 'satisfied' ? 'rag-pass' : status === 'partial' ? 'rag-partial'
          : status === 'in_progress' ? 'rag-partial' : 'rag-fail';
        return `<tr>
          <td class="pub-td" title="${esc(regime.toUpperCase())}">${esc(regimeDisplayName(regime))}</td>
          <td class="pub-td"><span class="rag ${regClass} pub-text-xs-nowrap">${esc(status)}</span></td>
        </tr>`;
      }).join('');

    // Vendor lock-in (#1376)
    const vli = providerData.vendor_lock_in;
    const vliSection = vli
      ? `<div class="pub-mt-4">
          <strong>Vendor Lock-in Analysis</strong>
          <dl class="pub-grid-label-val-sm pub-mt-1">
            ${vli.overall_risk ? `<dt>Overall Risk</dt><dd>${esc(vli.overall_risk)}</dd>` : ''}
            ${vli.portability_score !== undefined ? `<dt>Portability Score</dt><dd>${esc(String((vli.portability_score * 100).toFixed(0)))}%</dd>` : ''}
            ${vli.data_egress_risk ? `<dt>Egress Risk</dt><dd>${esc(vli.data_egress_risk)}</dd>` : ''}
          </dl>
          ${vli.proprietary_apis && vli.proprietary_apis.length > 0
            ? `<p class="pub-text-xs pub-mt-1">Proprietary APIs: ${vli.proprietary_apis.map(a => esc(a.service)).join(', ')}</p>`
            : ''}
        </div>`
      : '';

    if (!certRows && !certDeclaredRows && !regimeRows && !vliSection) continue;

    const providerId = `lz-provider-${rawId.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
    sections.push(`<details open id="${esc(providerId)}" data-sidebar-sub-of="lzr-catalog-header" class="lz-provider-detail pub-mt-4">
      <summary class="lz-provider-summary">
        <span class="lz-provider-name">${esc(rawId.toUpperCase())}</span>
        <span class="lz-provider-detail-label">Provider Catalogue Details</span>
      </summary>
      <div class="lz-provider-content">
      ${certRows ? `<p class="pub-label-bold pub-mt-2">Certifications &amp; Attestations (assessed frameworks)</p>
      <div class="overflow-x-auto"><table class="pub-table pub-table-sm">
        <thead><tr><th>Certification</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>${certRows}</tbody>
      </table></div>` : ''}
      ${certDeclaredRows ? `<p class="pub-label-bold pub-mt-3">CSP-Declared Certifications (not assessed in this run)</p>
      <p class="pub-text-xs pub-mt-1 pub-text-muted">The following certifications are declared by the cloud provider but were not part of the active compliance frameworks for this run. Verify before relying on them for regulatory submissions.</p>
      <div class="overflow-x-auto"><table class="pub-table pub-table-sm">
        <thead><tr><th>Certification</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>${certDeclaredRows}</tbody>
      </table></div>` : ''}
      ${regimeRows ? `<p class="pub-label-bold pub-mt-3">Compliance Regime Coverage</p>
      <p class="pub-text-xs pub-mt-1">CSP-declared coverage level for the active compliance frameworks. "Satisfied" means the provider holds the relevant attestation or certification. Verify with a legal review before relying on this for regulatory submissions.</p>
      <div class="overflow-x-auto"><table class="pub-table pub-table-sm">
        <thead><tr><th>Framework / Regime</th><th>Coverage</th></tr></thead>
        <tbody>${regimeRows}</tbody>
      </table></div>` : (sovereigntyInactive ? `<p class="pub-label-bold pub-mt-3">Compliance Regime Coverage</p>
      <p class="pub-text-xs pub-mt-1 pub-text-muted">No sovereignty framework is active for this run. Regime coverage is not displayed. Add a framework that declares sovereignty requirements (e.g. GDPR, BSI_C5) to <code>assessment.regimes_active</code> in <code>.swao.yml</code> to enable this section.</p>` : '')}
      ${vliSection}
      </div>
    </details>`);
  }

  return sections.join('');
}

// ---------------------------------------------------------------------------
// Blocks: lzr-catalog-* (Design 068 §6, #0790)
// ---------------------------------------------------------------------------

export function renderLzrCatalogHeader(model: PublicationModel): string {
  const lzr = model.lzr as LZRSummary;
  const catalog = lzr.catalog;
  const assessedAt = model.meta.assessed_at;

  const verdictClass =
    lzr.overall === 'Ready'
      ? 'callout-info'
      : lzr.overall.includes('Blocked')
        ? 'callout-critical'
        : 'callout-warning';

  // Multi-provider path: when regions[] is populated by the extractor (multi-target run).
  const regions = lzr.regions;
  if (regions && regions.length > 1) {
    const readyCount = regions.filter(
      r => r.overall_verdict === 'READY' || r.overall_verdict === 'READY_WITH_CHANGES',
    ).length;
    const allReady = readyCount === regions.length;
    const allBlocked = readyCount === 0;
    const aggregateLabel = allReady
      ? lzr.overall
      : allBlocked
        ? lzr.overall
        : `${readyCount} of ${regions.length} regions ready`;
    const aggregateClass = allReady ? 'callout-info' : allBlocked ? 'callout-critical' : 'callout-warning';

    const sovereigntyInactive = regions.every(
      r => !r.sovereignty_statement || r.sovereignty_statement.startsWith('No sovereignty'),
    );

    const regionRows = regions.map(r => {
      const rowModClass =
        r.overall_verdict === 'READY' ? ''
        : r.overall_verdict === 'READY_WITH_CHANGES' ? 'pub-tr-warning'
        : r.overall_verdict === 'NEEDS_VERIFICATION' ? 'pub-tr-warning'
        : 'pub-tr-danger';
      const sovNote = sovereigntyInactive
        ? ''
        : r.sovereignty_statement
          ? `<div class="pub-subtext pub-mt-1">${esc(r.sovereignty_statement)}</div>`
          : '';
      // Audit-coverage: blocker_category badge (#1362), coverage_warning (#1361),
      // assessment_mode + sovereignty_active qualifiers (#1363).
      type ExtRegion = typeof r & {
        blocker_category?: string;
        coverage_warning?: string;
        assessment_mode?: string;
        sovereignty_active?: boolean;
      };
      const xr = r as ExtRegion;
      const blockerCategoryBadge = xr.blocker_category
        ? ` <span class="lz-meta-chip lz-meta-blocker-cat" title="Blocker category">${esc(xr.blocker_category)}</span>`
        : '';
      const coverageWarningNote = xr.coverage_warning
        ? `<div class="pub-subtext pub-mt-1 lz-coverage-warning"><span class="lz-warn-icon">!</span> ${esc(xr.coverage_warning)}</div>`
        : '';
      const modeNote = xr.assessment_mode
        ? `<div class="pub-subtext-xs pub-mt-1">Mode: ${esc(xr.assessment_mode)}${xr.sovereignty_active === false ? ' (sovereignty inactive)' : ''}</div>`
        : '';
      type RegSummary = typeof r & { service_labels?: string[] };
      const labels = ((r as RegSummary).service_labels ?? []).slice(0, 4);
      const rest = ((r as RegSummary).service_labels ?? []).length - 4;
      const servicePills = labels
        .map(l => `<span class="pub-tag-pill lz-service-pill">${esc(l)}</span>`)
        .join(' ');
      const moreText = rest > 0 ? ` <span class="pub-text-secondary-sm">+${rest} more</span>` : '';
      return `
    <tr class="pub-tr-border ${rowModClass}">
      <td class="pub-td-mid">
        <span class="pub-provider-badge">${esc(r.provider.toUpperCase())}</span>
      </td>
      <td class="pub-td-mono">${esc(r.region)}${modeNote}</td>
      <td class="pub-td-mid">
        ${lzrVerdictChip(r.overall_verdict)}${blockerCategoryBadge}${sovNote}${coverageWarningNote}
      </td>
      <td class="pub-td-right-sm">${servicePills}${moreText}</td>
      <td class="pub-td-mid-right">
        ${r.overall_verdict === 'SOVEREIGNTY_BLOCKED'
          ? `<span class="rag rag-fail pub-text-xs-nowrap">Sovereignty</span>`
          : r.blockers > 0
            ? `<span class="pub-text-high-bold">${esc(String(r.blockers))} blocker(s)</span>`
            : `<span class="pub-text-secondary-sm">None</span>`}
      </td>
    </tr>`;
    }).join('');

    return `<section id="lzr-catalog-header" class="swao-block swao-block--lzr-catalog-header">
  <h2 id="lzr-catalog-header-h">Landing Zone Catalog Assessment</h2>
  <p class="pub-meta-text-sm">Assessment Date: <strong><time datetime="${esc(assessedAt)}">${esc(assessedAt.slice(0, 10))}</time></strong> &nbsp;&middot;&nbsp; ${esc(String(regions.length))} regions assessed</p>
  <div class="callout ${aggregateClass} pub-mb-4">
    <strong>${esc(aggregateLabel)}</strong> --
    ${esc(String(lzr.blockers))} blocker(s)
    <span class="pub-text-secondary-faded">${esc(String(regions.length))} regions assessed</span>
  </div>
  <table class="pub-table">
    <thead>
      <tr class="pub-tr-primary">
        <th class="pub-td-mid-left">Provider</th>
        <th class="pub-td-mid-left">Region</th>
        <th class="pub-td-mid-left">Verdict</th>
        <th class="pub-td-mid-right">Services</th>
        <th class="pub-td-mid-right">Blockers</th>
      </tr>
    </thead>
    <tbody>${regionRows}</tbody>
  </table>
  ${buildProviderCatalogueSection(regions.map(r => r.provider), lzr.selected_frameworks, sovereigntyInactive)}
</section>`;
  }

  // Single-provider fallback: simple metadata display.
  const providerDisplay = catalog?.provider
    ? esc(catalog.provider.toUpperCase())
    : 'Unknown Provider';
  const regionsDisplay = (catalog?.assessed_regions ?? [catalog?.region].filter(Boolean))
    .map(r => `<code>${esc(String(r))}</code>`)
    .join(', ');

  return `<section id="lzr-catalog-header" class="swao-block swao-block--lzr-catalog-header">
  <h2 id="lzr-catalog-header-h">Landing Zone Catalog Assessment</h2>
  <dl class="pub-grid-label-val">
    <dt class="pub-label-bold">Provider</dt>
    <dd class="pub-m-0">${providerDisplay}</dd>
    <dt class="pub-label-bold">Assessed Region(s)</dt>
    <dd class="pub-m-0">${regionsDisplay || esc(catalog?.region ?? '')}</dd>
    <dt class="pub-label-bold">Assessment Date</dt>
    <dd class="pub-m-0"><time datetime="${esc(assessedAt)}">${esc(assessedAt.slice(0, 10))}</time></dd>
  </dl>
  <div class="callout ${verdictClass}"><strong>Verdict:</strong> ${esc(lzr.overall)}</div>
</section>`;
}

export function renderLzrCatalogVerdict(model: PublicationModel): string {
  const lzr = model.lzr as LZRSummary;
  const catalog = lzr.catalog;
  const total = catalog?.service_count ?? lzr.checks.length;
  const sovereign = lzr.checks.filter(c => c.result === 'pass').length;
  const conditional = lzr.checks.filter(c => c.result === 'not_applicable').length;
  const nonSovereign = lzr.checks.filter(c => c.result === 'fail').length;
  const pct = total > 0 ? Math.round((sovereign / total) * 100) : 0;

  // #1589: detect when no sovereignty gate was active (DEMO / availability-only run).
  const regions = lzr.regions;
  const sovereigntyInactive = regions !== undefined && regions.length > 0 && regions.every(
    r => (r as Record<string, unknown>)['sovereignty_active'] === false
      || !r.sovereignty_statement
      || r.sovereignty_statement.startsWith('No sovereignty requirements'),
  );

  // Choose vocabulary based on sovereignty gate status.
  const label1 = sovereigntyInactive ? 'Available' : 'Sovereign';
  const label2 = sovereigntyInactive ? 'Partial' : 'Conditional';
  const label3 = sovereigntyInactive ? 'Not Available' : 'Non-Sovereign';
  const pctLabel = sovereigntyInactive ? 'available' : 'sovereign';
  const sectionTitle = sovereigntyInactive ? 'Availability Verdict' : 'Sovereign Fit Verdict';

  const narrativeByVerdict: Record<string, string> = sovereigntyInactive
    ? {
        'Ready': `All required services are available in the assessed region(s). No sovereignty gate was active for the selected frameworks -- add a framework that declares sovereignty requirements to enable sovereign workload evaluation.`,
        'Conditionally Ready': `Some required services are available. No sovereignty gate was active for the selected frameworks.`,
        'Needs Verification': `Service inventory is incomplete. A full service ingestion scan is recommended before treating the landing zone as production-ready.`,
        'Blocked': `One or more required services are not available in the assessed region(s). A change of region or provider may be required.`,
        'Sovereignty Blocked': `The assessed region fails sovereignty requirements derived from the active compliance frameworks. Select a region that satisfies the framework constraints.`,
      }
    : {
        'Ready': `All required services are available and provisioned in the assessed region(s). The landing zone meets sovereign workload criteria.`,
        'Conditionally Ready': `Some required services are available but not yet provisioned. Enabling the flagged services will bring the landing zone to a Sovereign fit.`,
        'Needs Verification': `Service inventory is incomplete. A full service ingestion scan is recommended before certifying sovereign readiness.`,
        'Blocked': `One or more required services are not available in the assessed region(s). A change of region or provider may be required.`,
        'Sovereignty Blocked': `The assessed region fails sovereignty requirements derived from the active compliance frameworks. Select a region that satisfies the framework constraints.`,
      };
  const narrative = narrativeByVerdict[lzr.overall] ?? `Overall verdict: ${lzr.overall}`;

  return `<section id="lzr-catalog-verdict" class="swao-block swao-block--lzr-catalog-verdict">
  <h2 id="lzr-catalog-verdict-h">${esc(sectionTitle)}</h2>
  <p class="pub-mb-4">${esc(narrative)}</p>
  <div class="pub-grid-3col">
    <div class="pub-td-center-card">
      <div class="pub-num-2xl-ok">${esc(String(sovereign))}</div>
      <div class="pub-text-xs-secondary">${esc(label1)}</div>
    </div>
    <div class="pub-td-center-card">
      <div class="pub-num-2xl-warning">${esc(String(conditional))}</div>
      <div class="pub-text-xs-secondary">${esc(label2)}</div>
    </div>
    <div class="pub-td-center-card">
      <div class="pub-num-2xl-critical">${esc(String(nonSovereign))}</div>
      <div class="pub-text-xs-secondary">${esc(label3)}</div>
    </div>
  </div>
  <p class="pub-text-secondary-sm">${esc(String(pct))}% ${esc(pctLabel)} coverage (${esc(String(sovereign))} of ${esc(String(total))} services assessed).</p>
</section>`;
}

export function renderLzrCatalogFindings(model: PublicationModel): string {
  const lzr = model.lzr as LZRSummary;
  const catalog = lzr.catalog;

  // Show ALL checks (sovereign + non-sovereign) as proof of assessment -- not just failures.
  if (lzr.checks.length === 0) {
    return `<section id="lzr-catalog-findings" class="swao-block swao-block--lzr-catalog-findings">
  <h2 id="lzr-catalog-findings-h">Detailed Findings</h2>
  <div class="callout callout-info">No service checks recorded for this run.</div>
</section>`;
  }

  type ExtCheck3 = (typeof lzr.checks)[number] & {
    provider?: string; region?: string; raw_verdict?: string;
    detail?: string; remediation?: string; sovereignty_statement?: string;
    signal_source?: string;
  };
  const extChecks = lzr.checks as ExtCheck3[];

  // #1589: detect sovereignty inactive from per-region flags.
  const findingsRegions = lzr.regions;
  const findingsSovInactive = findingsRegions !== undefined && findingsRegions.length > 0 && findingsRegions.every(
    r => (r as Record<string, unknown>)['sovereignty_active'] === false
      || !r.sovereignty_statement
      || r.sovereignty_statement.startsWith('No sovereignty requirements'),
  );

  const providerValues = [
    ...new Set(
      extChecks
        .map(c => providerDisplayName(c.provider ?? catalog?.provider ?? ''))
        .filter(Boolean),
    ),
  ];
  const verdictValues = [...new Set(extChecks.map(c => c.raw_verdict ?? '').filter(Boolean))];

  const rows = extChecks.map(check => {
    const code = check.signal_ref ?? check.id;
    const rawProvider = check.provider ?? catalog?.provider ?? '';
    const region = check.region ?? catalog?.region ?? '';
    const friendlyName = capabilityFriendlyName(code);
    const rawVerdict = check.raw_verdict ?? '';
    const detail = check.detail
      ?? (check.label.includes(': ') ? check.label.split(': ').slice(1).join(': ') : check.label);
    const remediation = check.remediation ?? '';
    const sovereigntyRule = check.sovereignty_statement ?? '';
    const signalSource = check.signal_source ?? '';
    return {
      provider: providerDisplayName(rawProvider),
      region,
      service: friendlyName,
      code,
      verdict: rawVerdict,
      // #1589: per-row flag so the client-side lz-verdict renderer can use availability
      // vocabulary (Available / Not Available) instead of sovereignty vocabulary when inactive.
      sovereignty_active: !findingsSovInactive,
      detail: detail.slice(0, 400),
      remediation: remediation.slice(0, 500),
      sovereignty_rule: sovereigntyRule,
      signal_source: signalSource,
    };
  });

  const passCount = lzr.checks.filter(c => c.result === 'pass').length;
  const failCount = lzr.checks.filter(c => c.result === 'fail').length;
  const totalCount = lzr.checks.length;
  const passLabel = findingsSovInactive ? 'available' : 'sovereign';
  const failLabel = findingsSovInactive ? 'not available' : 'non-sovereign';

  return `<section id="lzr-catalog-findings" class="swao-block swao-block--lzr-catalog-findings">
  <h2 id="lzr-catalog-findings-h">Detailed Findings</h2>
  <p class="pub-text-md-secondary-mb">
    ${esc(String(totalCount))} service check(s) across ${esc(String(providerValues.length))} provider/region(s):
    ${esc(String(passCount))} ${passLabel}, ${esc(String(failCount))} ${failLabel}.
    Filter by provider or verdict, sort any column, or expand a row for the sovereignty rule and remediation guidance.
  </p>
  ${swaoTableScript('lz-findings', {
    caption: 'Landing zone detailed findings -- all services',
    exportCsv: true,
    columns: [
      {
        id: 'provider', label: 'Provider', field: 'provider', type: 'text', sortable: true,
        filterable: providerValues.length > 1, filterType: 'chips', filterValues: providerValues,
      },
      { id: 'region', label: 'Region', field: 'region', type: 'text', sortable: true },
      { id: 'service', label: 'Service', field: 'service', type: 'text', sortable: true },
      { id: 'code', label: 'Capability', field: 'code', type: 'text', sortable: true },
      {
        id: 'verdict', label: 'Verdict', field: 'verdict', type: 'text', sortable: true,
        render: 'lz-verdict',
        filterable: verdictValues.length > 1, filterType: 'chips', filterValues: verdictValues,
      },
      { id: 'detail', label: 'Detail', field: 'detail', type: 'text', sortable: false },
    ],
    rows,
    expandTemplate:
      '<div class="pub-section-text">' +
      '<div><span class="pub-label-bold">Sovereignty Rule:</span> {{sovereignty_rule}}</div>' +
      '<div class="pub-text-xs-secondary-mt3"><span class="pub-label-bold">Recommended Action:</span> {{remediation}}</div>' +
      '<div class="pub-text-xs-secondary-mt3"><span class="pub-label-bold">Required by Signal:</span> {{signal_source}}</div>' +
      '</div>',
  })}
</section>`;
}

export function renderLzrCatalogRemediation(model: PublicationModel): string {
  const lzr = model.lzr as LZRSummary;

  // #1593: detect whether the sovereignty gate was active for this run.
  const remRegions = lzr.regions;
  const remSovInactive = remRegions !== undefined && remRegions.length > 0 && remRegions.every(
    r => (r as Record<string, unknown>)['sovereignty_active'] === false
      || !r.sovereignty_statement
      || r.sovereignty_statement.startsWith('No sovereignty requirements'),
  );

  const nonSovereign = lzr.checks.filter(c => c.result === 'fail');
  const conditional = lzr.checks.filter(c => c.result === 'not_applicable');

  // #1593: collect NEEDS_VERIFICATION regions (catalogue-only -- no scan evidence yet).
  const needsVerificationRegions = (lzr.regions ?? []).filter(
    r => r.overall_verdict === 'NEEDS_VERIFICATION',
  );

  // #1593: collect compliance regime gaps from the cloud provider catalogue.
  type LZRSummaryWithFw = typeof lzr & { selected_frameworks?: string[] };
  const selectedFw = (lzr as LZRSummaryWithFw).selected_frameworks ?? [];
  const frameworkFilterSet = selectedFw.length > 0
    ? new Set(selectedFw.map(f => f.toLowerCase().replace(/-/g, '_')))
    : null;
  type RegimeGap = { provider: string; region: string; regime: string; status: string };
  const regimeGaps: RegimeGap[] = [];
  const catalogue = getCloudCatalogue();
  for (const rg of lzr.regions ?? []) {
    const provKey = rg.provider.toLowerCase().replace('-', '_');
    const providerData = [...catalogue.values()].find(pd =>
      pd.id.toLowerCase().startsWith(provKey) || provKey.startsWith(pd.id.toLowerCase().split('_')[0] ?? ''),
    );
    if (!providerData) continue;
    for (const [regime, status] of Object.entries(providerData.compliance_regime_coverage ?? {})) {
      const regKey = regime.toLowerCase().replace(/-/g, '_');
      if (frameworkFilterSet && !frameworkFilterSet.has(regKey)) continue;
      if (status !== 'satisfied') {
        regimeGaps.push({ provider: rg.provider, region: rg.region, regime, status: String(status) });
      }
    }
  }

  if (nonSovereign.length === 0 && conditional.length === 0
    && needsVerificationRegions.length === 0 && regimeGaps.length === 0) {
    // #1593: use availability vocabulary when sovereignty gate was not active.
    const allClearMsg = remSovInactive
      ? 'No remediation required -- all assessed services are available in the selected region(s). Note: no sovereignty gate was active for this run. Sovereignty compliance has not been evaluated.'
      : 'No remediation required -- all services are sovereign.';
    return `<section id="lzr-catalog-remediation" class="swao-block swao-block--lzr-catalog-remediation">
  <h2 id="lzr-catalog-remediation-h">Recommended Actions</h2>
  <div class="callout callout-info">${esc(allClearMsg)}</div>
</section>`;
  }

  type ExtCheck2 = (typeof lzr.checks)[number] & {
    provider?: string; region?: string; raw_verdict?: string;
    remediation?: string; sovereignty_statement?: string;
  };

  // Deduplicate remediation text: sovereignty-blocked regions all carry the same
  // remediation advice -- group by (provider, region) and emit one action block per LZ.
  const byLz = new Map<string, { provider: string; region: string; codes: string[]; names: string[]; remediation: string; sovStatement: string }>();
  for (const check of nonSovereign as ExtCheck2[]) {
    const p = check.provider ?? '';
    const r = check.region ?? '';
    const key = `${p}||${r}`;
    const code = check.signal_ref ?? check.id;
    // Row label: friendly name; code shows the CSP brand name in parentheses
    const friendlyLabel = capabilityFriendlyName(code);
    const existing = byLz.get(key);
    if (existing) {
      existing.codes.push(code);
      existing.names.push(friendlyLabel);
    } else {
      byLz.set(key, {
        provider: p, region: r,
        codes: [code], names: [friendlyLabel],
        remediation: check.remediation ?? '',
        sovStatement: check.sovereignty_statement ?? '',
      });
    }
  }

  const items: string[] = [];

  for (const entry of byLz.values()) {
    const lzLabel = (entry.provider && entry.region)
      ? `[${esc(providerDisplayName(entry.provider))} / ${esc(entry.region)}] ` : '';
    const serviceList = entry.names
      .map((n, i) => {
        const code = entry.codes[i] ?? '';
        const cspName = capabilityNativeName(code, entry.provider);
        return `${esc(n)} <code class="pub-inline-code">(${esc(cspName)})</code>`;
      })
      .join(', ');
    const recommendation = entry.remediation
      ? esc(entry.remediation)
      : `Select a sovereign-compliant landing zone that satisfies the active compliance frameworks.`;
    const sovNote = entry.sovStatement
      ? `<div class="pub-text-xs-secondary-mt3">${esc(entry.sovStatement)}</div>` : '';
    items.push(
      `<li class="pub-mb-3">` +
      `<strong>${lzLabel}${serviceList}:</strong> ${recommendation}` +
      sovNote +
      `</li>`,
    );
  }

  for (const check of conditional as ExtCheck2[]) {
    const code = check.signal_ref ?? check.id;
    const name = capabilityFriendlyName(code);
    const cspName = capabilityNativeName(code, check.provider ?? '');
    const lzLabel = (check.provider && check.region) ? `[${esc(providerDisplayName(check.provider))} / ${esc(check.region)}] ` : '';
    items.push(
      `<li class="pub-mb-3"><strong>${lzLabel}${esc(name)} <code class="pub-inline-code">(${esc(cspName)})</code>:</strong> ` +
      `Service is available in the region but not yet provisioned. Enable and configure ` +
      `${esc(cspName)} in the landing zone to achieve sovereign coverage.</li>`,
    );
  }

  // #1593: add NEEDS_VERIFICATION region actions.
  for (const rg of needsVerificationRegions) {
    const lzLabel = `[${esc(providerDisplayName(rg.provider))} / ${esc(rg.region)}] `;
    const mode = (rg as typeof rg & { assessment_mode?: string }).assessment_mode === 'catalogue-sovereignty-only'
      ? 'No service inventory was provided -- the LZ fit ran in catalogue-only mode.'
      : 'Service inventory is incomplete (missing one or more baseline categories).';
    items.push(
      `<li class="pub-mb-3">` +
      `<strong>${lzLabel}Run a service ingestion scan</strong> -- ${mode} ` +
      `Add Terraform or CSPM ingestion files to <code class="pub-inline-code">apps/&lt;app&gt;/ingestion/</code> ` +
      `and re-run the LZ assessment to generate a verified service coverage verdict.</li>`,
    );
  }

  // #1593: add compliance regime gap actions.
  if (regimeGaps.length > 0) {
    items.push(`<li class="pub-mb-3 pub-list-divider"><strong>Compliance Regime Gaps</strong></li>`);
    for (const gap of regimeGaps) {
      const lzLabel = `[${esc(providerDisplayName(gap.provider))} / ${esc(gap.region)}] `;
      const fullName = regimeDisplayName(gap.regime);
      const gapClass = gap.status === 'partial' || gap.status === 'in_progress' ? 'partial' : 'not satisfied';
      items.push(
        `<li class="pub-mb-3">` +
        `<strong>${lzLabel}${esc(fullName)}</strong> -- coverage is ${esc(gapClass)}. ` +
        `Review the provider attestation documents and confirm whether this regime is required ` +
        `for your sovereignty posture before selecting this landing zone.</li>`,
      );
    }
  }

  // Add passing regions: show which LZs already meet requirements and why.
  // #1593: use availability vocabulary when sovereignty gate was not active.
  const regions = lzr.regions;
  if (regions && regions.length > 0) {
    const passingRegions = regions.filter(
      r => r.overall_verdict === 'READY' || r.overall_verdict === 'READY_WITH_CHANGES',
    );
    if (passingRegions.length > 0) {
      const readyListTitle = remSovInactive
        ? 'Available landing zones'
        : 'Sovereignty-ready landing zones';
      items.push(
        `<li class="pub-mb-3 pub-list-divider"><strong>${esc(readyListTitle)}</strong></li>`,
      );
      for (const r of passingRegions) {
        const lzLabel = `[${esc(r.provider.toUpperCase())} / ${esc(r.region)}] `;
        const sovNote = r.sovereignty_statement && !remSovInactive
          ? `<div class="pub-text-xs-secondary-mt3">${esc(r.sovereignty_statement)}</div>`
          : '';
        const readyMsg = remSovInactive
          ? 'All assessed services are available in this region.'
          : 'All assessed services meet sovereignty requirements.';
        const deployMsg = remSovInactive
          ? ''
          : ' This landing zone is cleared for sovereign workload deployment.';
        items.push(
          `<li class="pub-mb-3">` +
          `<strong>${lzLabel}${readyMsg}</strong>${deployMsg}` +
          sovNote +
          `</li>`,
        );
      }
    }
  }

  return `<section id="lzr-catalog-remediation" class="swao-block swao-block--lzr-catalog-remediation">
  <h2 id="lzr-catalog-remediation-h">Recommended Actions</h2>
  <ol class="pub-pl-5">${items.join('')}</ol>
</section>`;
}

// Capability code -> technology-agnostic friendly display name.
// Row labels in the Service Coverage matrix use these so the table stays vendor-neutral;
// CSP-specific brand names (RDS, EC2) appear in cell tooltips and the FinOps table.
const CAPABILITY_FRIENDLY_NAMES: Record<string, string> = {
  postgresql:              'PostgreSQL',
  mysql:                   'MySQL',
  mariadb:                 'MariaDB',
  redis:                   'Redis / Key-Value Store',
  memcached:               'Memcached',
  kubernetes:              'Kubernetes',
  object_storage:          'Object Storage',
  vm_compute:              'Virtual Machine',
  serverless_compute:      'Serverless Compute',
  container_orchestration: 'Container Orchestration',
  container_registry:      'Container Registry',
  networking:              'Networking / Virtual Network',
  block_storage:           'Block Storage',
  file_storage:            'File Storage',
  key_vault:               'Key Management',
  secrets_management:      'Secrets Management',
  audit_logging:           'Audit Logging',
  iac:                     'IaC Toolchain',
  ci_cd:                   'CI/CD Pipeline',
  load_balancer:           'Load Balancer',
  nosql_database:          'NoSQL Database',
  data_warehouse:          'Data Warehouse',
  event_streaming:         'Event Streaming',
  queue:                   'Queue',
  messaging:               'Messaging',
  data_analytics:          'Data Analytics',
  ml_inference:            'ML Inference',
  managed_llm:             'Managed LLM',
  api_gateway:             'API Gateway',
  identity_management:     'Identity Management',
  network_firewall:        'Network Firewall',
  waf:                     'Web Application Firewall',
  threat_detection:        'Threat Detection',
  backup:                  'Backup',
  dns:                     'DNS',
  dedicated_connectivity:  'Dedicated Connectivity',
};

export function capabilityFriendlyName(code: string): string {
  return CAPABILITY_FRIENDLY_NAMES[code] ?? code;
}

// Normalise a provider identifier to a human-readable display label.
function providerDisplayName(provider: string): string {
  if (!provider) return '';
  const p = provider.toLowerCase();
  if (p === 'aws-esc') return 'AWS ESC';
  return provider.toUpperCase();
}

// Load the LZ catalogue JSON for a given provider+region and return a map from
// capability code to {keyCustody, status} sourced from the service that fulfils it.
// Used by the FinOps lens to surface governance-relevant catalogue metadata.
function loadCatalogKeyCustody(
  provider: string,
  region: string,
): Map<string, { keyCustody: string[]; status: string; last_verified: string }> {
  const normalised = provider.toLowerCase() === 'aws-esc' ? 'aws-esc' : provider.toLowerCase();
  const filename = `${normalised}.json`;
  const candidates = [
    // #1380: pkg binary -- build-lib.mjs copies seeds to <bundle dir>/_lz-catalogues/
    // and __dirname inside the bundle is dist/, so the repo-relative candidates
    // below never resolve there (chips silently vanished from the matrix).
    join(__dirname, '_lz-catalogues', filename),
    join(__dirname, '../../../../../../lz-catalogues/', filename),
    join(__dirname, '../../../../../lz-catalogues/', filename),
    join(__dirname, '../../../../lz-catalogues/', filename),
  ];
  const result = new Map<string, { keyCustody: string[]; status: string; last_verified: string }>();
  for (const cpath of candidates) {
    try {
      const raw = readFileSync(cpath, 'utf-8');
      type CatalogSvc = { code: string; status: string; fulfills?: string[]; key_custody?: string[]; last_verified?: string };
      type CatalogJson = { meta?: { confidence?: string }; regions?: Array<{ id: string; services?: CatalogSvc[] }> };
      const catalog = JSON.parse(raw) as CatalogJson;
      const regionData = catalog.regions?.find(r => r.id === region);
      if (!regionData) continue;
      for (const svc of (regionData.services ?? [])) {
        for (const cap of (svc.fulfills ?? [])) {
          if (!result.has(cap)) {
            result.set(cap, {
              keyCustody: svc.key_custody ?? [],
              status: svc.status ?? '',
              last_verified: svc.last_verified ?? '',
            });
          }
        }
      }
      return result;
    } catch { /* try next path */ }
  }
  return result;
}

// Load cloud-provider-catalogue.yaml and return provider data indexed by provider ID.
// Used to surface certifications, vendor_lock_in, and compliance_regime_coverage (#1364, #1376, #1377).
type CloudProviderData = {
  id: string;
  certifications: Record<string, { status: string; last_audited?: string; evidence_url?: string; notes?: string }>;
  vendor_lock_in?: {
    overall_risk?: string;
    portability_score?: number;
    exclusive_capabilities?: string[];
    data_egress_risk?: string;
    proprietary_apis?: Array<{ service: string; risk: string; migration_path?: string }>;
  };
  compliance_regime_coverage?: Record<string, string>;
  residency?: { regions?: string[]; data_residency_guarantees?: string[] };
};

function loadCloudProviderCatalogue(): Map<string, CloudProviderData> {
  const candidates = [
    // #1380: pkg binary -- bundle __dirname is packages/swao/dist, so
    // swao/controls/ sits exactly 3 levels up. Without this candidate the
    // provider-catalogue sections (certifications, regime coverage, vendor
    // lock-in) silently disappeared from packaged builds.
    join(__dirname, '../../../controls/cloud-provider-catalogue.yaml'),
    join(__dirname, '../../../../../../controls/cloud-provider-catalogue.yaml'),
    join(__dirname, '../../../../../controls/cloud-provider-catalogue.yaml'),
    join(__dirname, '../../../../controls/cloud-provider-catalogue.yaml'),
  ];
  const result = new Map<string, CloudProviderData>();
  for (const cpath of candidates) {
    try {
      const raw = readFileSync(cpath, 'utf-8');
      const parsed = yamlLoad(raw) as {
        providers?: Array<{
          id?: string;
          certifications?: Record<string, unknown>;
          vendor_lock_in?: unknown;
          compliance_regime_coverage?: Record<string, string>;
          residency?: { regions?: string[]; data_residency_guarantees?: string[] };
        }>
      } | null;
      for (const p of (parsed?.providers ?? [])) {
        if (typeof p.id !== 'string') continue;
        const certRaw = (p.certifications ?? {}) as Record<string, Record<string, unknown>>;
        const certOut: CloudProviderData['certifications'] = {};
        for (const [certId, certVal] of Object.entries(certRaw)) {
          if (certVal && typeof certVal === 'object') {
            certOut[certId] = {
              status: String(certVal['status'] ?? ''),
              last_audited: typeof certVal['last_audited'] === 'string' ? certVal['last_audited'] : undefined,
              evidence_url: typeof certVal['evidence_url'] === 'string' ? certVal['evidence_url'] : undefined,
              notes: typeof certVal['notes'] === 'string' ? certVal['notes'] : undefined,
            };
          }
        }
        result.set(p.id, {
          id: p.id,
          certifications: certOut,
          vendor_lock_in: p.vendor_lock_in as CloudProviderData['vendor_lock_in'] | undefined,
          compliance_regime_coverage: p.compliance_regime_coverage,
          residency: p.residency,
        });
      }
      if (result.size > 0) return result;
    } catch { /* try next path */ }
  }
  return result;
}

export function renderLzrCatalogFinops(model: PublicationModel): string {
  const lzr = model.lzr as LZRSummary;
  type ExtCheckF = (typeof lzr.checks)[number] & { provider?: string; region?: string };
  const allChecks = lzr.checks as ExtCheckF[];

  if (allChecks.length === 0) {
    return `<section id="lzr-catalog-finops" class="swao-block swao-block--lzr-catalog-finops">
  <h2 id="lzr-service-intelligence-h">Service Intelligence Matrix</h2>
  <div class="callout callout-info">No assessed services found -- run an LZ catalogue assessment first.</div>
</section>`;
  }

  // Per-LZ catalogue key-custody index (loaded once per unique LZ).
  const lzCatalogCache = new Map<string, Map<string, { keyCustody: string[]; status: string; last_verified: string }>>();
  for (const check of allChecks) {
    const provider = check.provider ?? lzr.catalog?.provider ?? '';
    const region = check.region ?? lzr.catalog?.region ?? '';
    const lzKey = `${provider}||${region}`;
    if (!lzCatalogCache.has(lzKey)) {
      lzCatalogCache.set(lzKey, loadCatalogKeyCustody(provider, region));
    }
  }

  const cloudCat = getCloudCatalogue();

  // Helper: find provider data from the cloud-provider-catalogue by the raw check provider string.
  function findCloudProvider(rawProvider: string): CloudProviderData | undefined {
    const key = rawProvider.toLowerCase().replace('-', '_');
    return [...cloudCat.values()].find(pd =>
      pd.id.toLowerCase().startsWith(key) || key.startsWith(pd.id.toLowerCase().split('_')[0] ?? '')
    );
  }

  type SimRow = {
    service: string; code: string; cspName: string; provider: string; region: string;
    availability: string; keyCustody: string;
    dataResidency: string; sovereigntyTier: string; openStandard: string;
    multiRegion: string; lockInRisk: string; complianceRegimes: string;
  };

  const rows: SimRow[] = [];
  const seen = new Set<string>();
  for (const check of allChecks) {
    const code = check.signal_ref ?? check.id;
    const rawProvider = check.provider ?? lzr.catalog?.provider ?? '';
    const region = check.region ?? lzr.catalog?.region ?? '';
    const rowKey = `${code}||${rawProvider}||${region}`;
    if (seen.has(rowKey)) continue;
    seen.add(rowKey);
    const lzKey = `${rawProvider}||${region}`;
    const catEntry = lzCatalogCache.get(lzKey)?.get(code);
    if (!catEntry) continue;

    const pd = findCloudProvider(rawProvider);
    const dataResidency = pd?.residency?.data_residency_guarantees?.[0]?.replace(/_/g, ' ') ?? '--';
    const sovereigntyTier = pd ? deriveSovereigntyTier(pd.certifications) : '--';
    const openStandard = isOpenStandardCap(code);
    const regions = pd?.residency?.regions ?? [];
    const multiRegion = regions.length > 1 ? 'yes' : regions.length === 1 ? 'no' : '--';
    const lockInRisk = pd?.vendor_lock_in?.overall_risk ?? '--';
    const satisfiedRegimes = Object.entries(pd?.compliance_regime_coverage ?? {})
      .filter(([, s]) => s === 'satisfied')
      .map(([k]) => k.toUpperCase())
      .join(', ') || '--';

    rows.push({
      service:          capabilityFriendlyName(code),
      code,
      cspName:          capabilityNativeName(code, rawProvider),
      provider:         providerDisplayName(rawProvider),
      region,
      availability:     catEntry.status === 'ga' ? 'Generally Available' : catEntry.status || '--',
      keyCustody:       catEntry.keyCustody.join(', ') || 'provider-managed',
      dataResidency,
      sovereigntyTier,
      openStandard,
      multiRegion,
      lockInRisk,
      complianceRegimes: satisfiedRegimes,
    });
  }

  if (rows.length === 0) {
    return `<section id="lzr-catalog-finops" class="swao-block swao-block--lzr-catalog-finops">
  <h2 id="lzr-service-intelligence-h">Service Intelligence Matrix</h2>
  <div class="callout callout-info">
    <strong>Catalogue metadata unavailable for this run.</strong>
    Run an LZ catalogue assessment and ensure LZ catalogue files are present under
    <code>lz-catalogues/</code>.
  </div>
</section>`;
  }

  const providerValues = [...new Set(rows.map(r => r.provider))];
  const availValues   = [...new Set(rows.map(r => r.availability))];
  const custodyValues = [...new Set(rows.map(r => r.keyCustody))];
  const residencyVals = [...new Set(rows.map(r => r.dataResidency))];
  const sovTierVals   = [...new Set(rows.map(r => r.sovereigntyTier))];
  const openStdVals   = [...new Set(rows.map(r => r.openStandard))];
  const multiRegVals  = [...new Set(rows.map(r => r.multiRegion))];
  const lockRiskVals  = [...new Set(rows.map(r => r.lockInRisk))];

  return `<section id="lzr-catalog-finops" class="swao-block swao-block--lzr-catalog-finops">
  <h2 id="lzr-service-intelligence-h">Service Intelligence Matrix</h2>
  <p class="pub-text-md-secondary-mb">
    The table below summarises the sovereign characteristics of each assessed cloud service
    across all evaluated providers and regions. Use the column filters to compare services
    by availability, key custody model, data residency, and sovereignty tier.
  </p>
  ${swaoTableScript('lzr-service-intelligence', {
    caption: 'Service Intelligence Matrix -- sovereign characteristics per assessed service',
    exportCsv: true,
    columns: [
      { id: 'service', label: 'Capability', field: 'service', type: 'text', sortable: true,
        filterable: true, filterType: 'text' },
      { id: 'cspName', label: 'CSP Service', field: 'cspName', type: 'text', sortable: true,
        filterable: true, filterType: 'text' },
      { id: 'provider', label: 'Provider', field: 'provider', type: 'text', sortable: true,
        filterable: providerValues.length > 1, filterType: 'chips', filterValues: providerValues },
      { id: 'region', label: 'Region', field: 'region', type: 'text', sortable: true },
      { id: 'availability', label: 'Availability', field: 'availability', type: 'text', sortable: true,
        filterable: availValues.length > 1, filterType: 'chips', filterValues: availValues },
      { id: 'keyCustody', label: 'Key Custody', field: 'keyCustody', type: 'text', sortable: true,
        filterable: custodyValues.length > 1, filterType: 'chips', filterValues: custodyValues },
      { id: 'dataResidency', label: 'Data Residency', field: 'dataResidency', type: 'text', sortable: true,
        filterable: residencyVals.length > 1, filterType: 'chips', filterValues: residencyVals },
      { id: 'sovereigntyTier', label: 'Sovereignty Tier', field: 'sovereigntyTier', type: 'text', sortable: true,
        filterable: sovTierVals.length > 1, filterType: 'chips', filterValues: sovTierVals },
      { id: 'openStandard', label: 'Open Standard', field: 'openStandard', type: 'text', sortable: true,
        filterable: true, filterType: 'chips', filterValues: openStdVals },
      { id: 'multiRegion', label: 'Multi-region', field: 'multiRegion', type: 'text', sortable: true,
        filterable: multiRegVals.length > 1, filterType: 'chips', filterValues: multiRegVals },
      { id: 'lockInRisk', label: 'Lock-in Risk', field: 'lockInRisk', type: 'text', sortable: true,
        filterable: lockRiskVals.length > 1, filterType: 'chips', filterValues: lockRiskVals },
      { id: 'complianceRegimes', label: 'Compliance Regimes', field: 'complianceRegimes', type: 'text', sortable: false },
    ],
    rows,
  })}
</section>`;
}

// ---------------------------------------------------------------------------
// Block: lz-catalog-services (#0789, Design 068 §5)
// ---------------------------------------------------------------------------

// Verdict chip for a single LZ fit item (more granular than lzCoverageChip which uses result).
// nativeName: CSP-specific service brand name (e.g. "RDS" for postgresql on AWS).
// When provided, the tooltip shows "<nativeName>: <detail>" so the user sees both the CSP name
// and the sovereignty/gap reasoning without leaving the matrix view.
function lzItemVerdictChip(
  rawVerdict: string | undefined,
  result: 'pass' | 'fail' | 'not_applicable',
  detail?: string,
  nativeName?: string,
  catalogueMode?: boolean,
  sovereigntyActive: boolean = true,
): string {
  // #1589: when catalogue-only or sovereignty gate was inactive, use availability vocabulary.
  const availabilityMode = catalogueMode || !sovereigntyActive;
  let label: string;
  let rag: string;
  switch (rawVerdict) {
    case 'SUPPORTED':                label = availabilityMode ? 'Available' : 'Sovereign'; rag = 'pass'; break;
    case 'SOVEREIGNTY_GAP':          label = 'Sov. Gap';      rag = 'fail';    break;
    case 'NOT_AVAILABLE_IN_REGION':  label = 'Unavailable';   rag = 'fail';    break;
    case 'AVAILABILITY_NOT_ENABLED': label = 'Not Enabled';   rag = 'partial'; break;
    case 'VERSION_MISMATCH':         label = 'Ver. Mismatch'; rag = 'partial'; break;
    case 'CAPABILITY_MISSING':       label = 'Cap. Missing';  rag = 'partial'; break;
    default:
      label = result === 'pass' ? (availabilityMode ? 'Available' : 'Sovereign')
            : result === 'not_applicable' ? (availabilityMode ? 'Partial' : 'Conditional')
            : (availabilityMode ? 'Not Available' : 'Non-Sovereign');
      rag = result === 'pass' ? 'pass' : result === 'not_applicable' ? 'partial' : 'fail';
  }
  const tooltipText = (nativeName && detail) ? `${nativeName}: ${detail}` : (detail ?? '');
  const titleAttr = tooltipText ? ` title="${esc(tooltipText)}"` : '';
  return `<span class="rag rag-${rag} pub-text-xs-nowrap lz-matrix-chip"${titleAttr}>${esc(label)}</span>`;
}

// ---------------------------------------------------------------------------
// LZ verdict narrative types (local -- mirrors @swao/module-landing-zone; #1358)
// Defined locally to keep @swao/publication-render a leaf package that does not
// depend on @swao/module-landing-zone. Structural typing ensures objects produced
// by generateLzNarrative() from module-landing-zone are accepted here unchanged.
// ---------------------------------------------------------------------------

export interface LzSovereigntyNarrativeBlock {
  passed: boolean;
  operator_jurisdiction: string;
  residency_country: string;
  certifications: string[];
  blockers: string[];
  statement: string;
}

export interface LzServiceCheckNarrativeBlock {
  primitive: string;
  verdict: string;
  service_code?: string;
  reason?: string;
}

export interface LzVerdictNarrativeBlock {
  lz_id: string;
  region_id: string;
  display: string;
  verdict: string;
  sovereignty: LzSovereigntyNarrativeBlock;
  service_checks: LzServiceCheckNarrativeBlock[];
  summary_headline: string;
  summary_body: string;
  evidence_files: string[];
}

// ---------------------------------------------------------------------------
// Block: lz-narrative-single (#1358)
// ---------------------------------------------------------------------------

/**
 * Render an HTML card for a single LZ verdict narrative.
 * Accepts LzVerdictNarrativeBlock (or any structurally compatible object).
 */
export function renderLzNarrativeSingle(
  narrative: LzVerdictNarrativeBlock,
  opts?: { compact?: boolean },
): string {
  const compact = opts?.compact ?? false;
  const verdictClass = `lz-narrative-verdict-${esc(narrative.verdict)}`;

  const serviceRows = narrative.service_checks.map((c) => {
    const verdictCell = c.verdict ? c.verdict.toLowerCase() : 'unknown';
    return (
      `<tr>` +
      `<td>${esc(c.primitive)}</td>` +
      `<td class="lz-check-${esc(verdictCell)}">${esc(c.verdict)}</td>` +
      `<td>${esc(c.service_code ?? '--')}</td>` +
      `</tr>`
    );
  }).join('');

  const certDisplay = narrative.sovereignty.certifications.length > 0
    ? esc(narrative.sovereignty.certifications.join(', '))
    : 'none';

  const sovResult = narrative.sovereignty.passed ? 'PASS' : 'FAIL';

  const bodyHtml = compact
    ? `<p>${esc(narrative.summary_body)}</p>`
    : (
      `<p>${esc(narrative.summary_body)}</p>` +
      `<h4>Service checks</h4>` +
      `<table class="lz-narrative-checks-table">` +
      `<thead><tr><th>Primitive</th><th>Result</th><th>Service</th></tr></thead>` +
      `<tbody>${serviceRows}</tbody>` +
      `</table>` +
      `<h4>Sovereignty</h4>` +
      `<p>Operator jurisdiction: ${esc(narrative.sovereignty.operator_jurisdiction)}` +
      ` (${esc(sovResult)}).` +
      ` Residency: ${esc(narrative.sovereignty.residency_country)}.` +
      ` Certifications: ${certDisplay}.</p>`
    );

  return (
    `<div class="lz-narrative-card ${esc(verdictClass)}">` +
    `<div class="lz-narrative-header">` +
    `<span class="lz-narrative-display">${esc(narrative.display)}</span>` +
    `<span class="lz-verdict-chip lz-verdict-chip-${esc(narrative.verdict)}">${esc(narrative.verdict)}</span>` +
    `</div>` +
    `<p class="lz-narrative-headline">${esc(narrative.summary_headline)}</p>` +
    `<div class="lz-narrative-body">${bodyHtml}</div>` +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// Block: lz-narrative-all (#1358)
// ---------------------------------------------------------------------------

/**
 * Render an HTML section containing all LZ verdict narratives.
 */
export function renderLzNarrativeAll(narratives: LzVerdictNarrativeBlock[]): string {
  if (narratives.length === 0) {
    return (
      `<section class="lz-narrative-section">` +
      `<h3>Landing Zone Verdict Analysis</h3>` +
      `<div class="callout callout-info">No landing zone narratives available for this run.</div>` +
      `</section>`
    );
  }

  const cards = narratives.map((n) => renderLzNarrativeSingle(n)).join('');

  return (
    `<section class="lz-narrative-section">` +
    `<h3>Landing Zone Verdict Analysis</h3>` +
    `<p class="lz-narrative-intro">` +
    `Each landing zone was assessed against the sovereignty requirements and service` +
    ` availability catalogue. The verdicts and reasoning are set out below.` +
    `</p>` +
    cards +
    `</section>`
  );
}

// ---------------------------------------------------------------------------
// Block: lz-catalog-services (#0789, Design 068 §5)
// ---------------------------------------------------------------------------

export function renderLzCatalogServices(model: PublicationModel): string {
  const lzr = model.lzr as LZRSummary;
  const catalog = lzr.catalog;

  if (lzr.checks.length === 0) {
    return `<section id="lz-catalog-services" class="swao-block swao-block--lz-catalog-services">
  <h2 id="lz-catalog-services-h">Service Coverage</h2>
  <div class="callout callout-info">No service coverage data available for this run.</div>
</section>`;
  }

  type ExtCheck = (typeof lzr.checks)[number] & { provider?: string; region?: string; raw_verdict?: string; detail?: string };
  const checks = lzr.checks as ExtCheck[];

  // #1589: build catalogue-mode and sovereignty-active flags per column from lzr.regions.
  const colCatalogueMode = new Map<string, boolean>();
  const colSovereigntyActive = new Map<string, boolean>();
  for (const rg of lzr.regions ?? []) {
    const colKey = `${rg.provider}||${rg.region}`;
    colCatalogueMode.set(colKey, rg.assessment_mode === 'catalogue-sovereignty-only');
    const sovActive = (rg as Record<string, unknown>)['sovereignty_active'];
    colSovereigntyActive.set(colKey, sovActive !== false);
  }

  // Build ordered column list: unique (provider, region) in order of first appearance.
  const colKeys: string[] = [];
  const colData = new Map<string, { provider: string; region: string; ready: boolean }>();
  for (const check of checks) {
    const p = check.provider ?? catalog?.provider ?? '';
    const r = check.region ?? catalog?.region ?? '';
    const key = `${p}||${r}`;
    if (!colData.has(key)) {
      colKeys.push(key);
      colData.set(key, { provider: p, region: r, ready: true });
    }
    if (check.result !== 'pass') colData.get(key)!.ready = false;
  }

  // Build ordered row list: unique service codes in order of first appearance.
  const serviceKeys: string[] = [];
  const seenSvc = new Set<string>();
  for (const check of checks) {
    const code = check.signal_ref ?? check.id;
    if (!seenSvc.has(code)) { seenSvc.add(code); serviceKeys.push(code); }
  }

  // Cell lookup: serviceCode -> colKey -> check.
  const cellMap = new Map<string, Map<string, ExtCheck>>();
  for (const check of checks) {
    const code = check.signal_ref ?? check.id;
    const p = check.provider ?? catalog?.provider ?? '';
    const r = check.region ?? catalog?.region ?? '';
    const colKey = `${p}||${r}`;
    if (!cellMap.has(code)) cellMap.set(code, new Map());
    cellMap.get(code)!.set(colKey, check);
  }

  const colHeaderCells = colKeys.map((key) => {
    const col = colData.get(key)!;
    const highlightClass = col.ready ? ' lz-matrix-col-ready' : '';
    const colProvider = col.provider.toLowerCase();
    const normalizedProvider = colProvider === 'aws-esc' ? 'aws' : colProvider;
    const providerBrandName = normalizedProvider === 'aws' && col.provider.toLowerCase() === 'aws-esc'
      ? 'AWS ESC'
      : col.provider.toUpperCase();
    const verdictNote = col.ready ? 'All services sovereign-ready' : 'Contains non-sovereign services';
    return `<th class="pub-th lz-matrix-col-header${highlightClass}" title="${esc(verdictNote)}">${esc(providerBrandName)} / ${esc(col.region)}</th>`;
  }).join('');

  // Build per-LZ catalogue metadata index for key_custody, status, last_verified (#1360, #1372, #1373).
  const lzCatalogCache2 = new Map<string, Map<string, { keyCustody: string[]; status: string; last_verified: string }>>();
  for (const colKey of colKeys) {
    const col = colData.get(colKey)!;
    if (!lzCatalogCache2.has(colKey)) {
      lzCatalogCache2.set(colKey, loadCatalogKeyCustody(col.provider, col.region));
    }
  }

  const bodyRows = serviceKeys.map((code) => {
    // Row label: vendor-neutral friendly name (PostgreSQL, Virtual Machine, ...).
    // The capability code appears below as a monospace subtext.
    // CSP-specific brand names (RDS, EC2) appear in the cell chip tooltips.
    const friendlyName = capabilityFriendlyName(code);
    const dataCells = colKeys.map((colKey) => {
      const col = colData.get(colKey)!;
      const check = cellMap.get(code)?.get(colKey);
      if (!check) {
        return `<td class="pub-td lz-matrix-cell"><span class="pub-text-muted">--</span></td>`;
      }
      const chipNativeName = capabilityNativeName(code, check.provider ?? col.provider);
      const isCatalogueMode = colCatalogueMode.get(colKey) ?? false;
      const isSovereigntyActive = colSovereigntyActive.get(colKey) ?? true;
      const chip = lzItemVerdictChip(check.raw_verdict, check.result, check.detail ?? check.label, chipNativeName, isCatalogueMode, isSovereigntyActive);
      const catEntry = lzCatalogCache2.get(colKey)?.get(code);
      const keyCustodyText = catEntry?.keyCustody?.length
        ? catEntry.keyCustody.join(', ')
        : '';
      const statusText = catEntry?.status === 'ga'
        ? 'GA'
        : catEntry?.status === 'preview'
          ? 'Preview'
          : catEntry?.status ?? '';
      const lastVerified = catEntry?.last_verified ?? '';
      const signalSrc = (check as Record<string, unknown>)['signal_source'] as string | undefined;
      const metaItems: string[] = [];
      if (keyCustodyText) metaItems.push(`<span class="lz-meta-chip lz-meta-key-custody" title="Key custody model">${esc(keyCustodyText)}</span>`);
      if (statusText) {
        const statusClass = statusText === 'Preview' ? 'lz-meta-chip-preview' : '';
        metaItems.push(`<span class="lz-meta-chip ${statusClass}" title="Service availability status">${esc(statusText)}</span>`);
      }
      if (lastVerified) metaItems.push(`<span class="lz-meta-chip lz-meta-date" title="Last catalogue verification date">${esc(lastVerified)}</span>`);
      if (signalSrc) metaItems.push(`<span class="lz-meta-chip lz-meta-signal" title="WSP signal that required this service">${esc(signalSrc)}</span>`);
      const metaRow = metaItems.length > 0 ? `<div class="lz-matrix-meta">${metaItems.join(' ')}</div>` : '';
      return `<td class="pub-td lz-matrix-cell">${chip}${metaRow}</td>`;
    }).join('');
    return `
    <tr class="pub-tr-border">
      <td class="pub-td lz-matrix-svc"><strong>${esc(friendlyName)}</strong><br><span class="pub-mono-sm pub-text-muted">${esc(code)}</span></td>
      ${dataCells}
    </tr>`;
  }).join('');

  return `<section id="lz-catalog-services" class="swao-block swao-block--lz-catalog-services">
  <h2 id="lz-catalog-services-h">Service Coverage</h2>
  <div class="lz-matrix-scroll">
    <table class="pub-table lz-matrix-table">
      <thead>
        <tr class="pub-tr-primary">
          <th class="pub-th lz-matrix-svc-header">Capability</th>
          ${colHeaderCells}
        </tr>
      </thead>
      <tbody>${bodyRows}
      </tbody>
    </table>
  </div>
</section>`;
}
