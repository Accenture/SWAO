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

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import type { PassContext, PassResult } from '@swao/core';
import type { Signal } from '@swao/core';
import {
  loadSovereignServiceCatalogue,
  type SovereignServiceCatalogue,
  type SovereignServiceEntry,
} from '../catalogue/reference-catalogues.js';
import { collectDependencyInventory, matchesPattern, type DependencyRef } from './inv-reference-scans.js';

interface DomainEntry {
  jurisdiction: string;
  scc: boolean;
  note: string;
  blocksForResidency?: string[];
  /** sovereign-service-catalogue.yaml id of the same service (#3296 dedupe). */
  serviceId?: string;
}

const EGRESS_CATALOGUE: Record<string, DomainEntry> = {
  'api.alphavantage.co': {
    jurisdiction: 'US',
    scc: false,
    note: 'Alpha Vantage financial data API (US)',
    blocksForResidency: ['DE_only', 'EU_only'],
  },
  'query1.finance.yahoo.com': {
    jurisdiction: 'US',
    scc: false,
    note: 'Yahoo Finance market data (US); no DPA available',
    blocksForResidency: ['DE_only', 'EU_only'],
  },
  'query2.finance.yahoo.com': {
    jurisdiction: 'US',
    scc: false,
    note: 'Yahoo Finance market data (US)',
    blocksForResidency: ['DE_only', 'EU_only'],
  },
  'api.rapidapi.com': {
    jurisdiction: 'US',
    scc: false,
    note: 'RapidAPI US API gateway proxy',
    blocksForResidency: ['DE_only', 'EU_only'],
  },
  'api.coingecko.com': {
    jurisdiction: 'uncertain',
    scc: false,
    note: 'CoinGecko (Malaysia HQ / Cloudflare CDN)',
  },
  'comprehendmedical.amazonaws.com': {
    jurisdiction: 'US',
    scc: false,
    note: 'AWS Comprehend Medical (US-based NLP service)',
    blocksForResidency: ['DE_only', 'EU_only'],
    serviceId: 'aws-comprehend-medical',
  },
  's3.amazonaws.com': {
    jurisdiction: 'US',
    scc: false,
    note: 'AWS S3 (region-dependent; default US)',
  },
};

const KNOWN_EGRESS_PACKAGES: Record<string, { domain: string; note: string }> = {
  alphavantage: { domain: 'api.alphavantage.co', note: 'Alpha Vantage npm client' },
  'yahoo-finance2': { domain: 'query1.finance.yahoo.com', note: 'Yahoo Finance npm client' },
  // #3296: the published AWS SDK v3 package is client-comprehendmedical
  // (no hyphen inside the service name).
  '@aws-sdk/client-comprehendmedical': {
    domain: 'comprehendmedical.amazonaws.com',
    note: 'AWS Comprehend Medical SDK',
  },
};

// #3160: detection keys for sovereign-service-catalogue.yaml. The catalogue
// records the sovereignty verdict per service but no detection rules, so the
// mapping from client libraries and API host names to catalogue IDs lives
// here (like EGRESS_CATALOGUE above). Only unambiguous keys: vendor-owned
// client packages and vendor API host names. A test asserts that every ID
// exists in the catalogue.
export const SOVEREIGN_SERVICE_DETECTION: Readonly<Record<string, { npm?: string[]; pip?: string[]; domains?: string[] }>> = {
  'anthropic-api': { npm: ['@anthropic-ai/sdk'], pip: ['anthropic'], domains: ['api.anthropic.com'] },
  'openai-api': { npm: ['openai'], pip: ['openai'], domains: ['api.openai.com'] },
  stripe: { npm: ['stripe'], pip: ['stripe'], domains: ['api.stripe.com'] },
  sentry: { npm: ['@sentry/*'], pip: ['sentry-sdk'], domains: ['sentry.io'] },
  datadog: { npm: ['dd-trace'], pip: ['ddtrace'], domains: ['datadoghq.com', 'datadoghq.eu'] },
  'new-relic': { npm: ['newrelic'], pip: ['newrelic'], domains: ['newrelic.com'] },
  'docker-hub': { domains: ['registry-1.docker.io', 'hub.docker.com'] },
  'github-container-registry': { domains: ['ghcr.io'] },
  github: { npm: ['@octokit/*'], pip: ['pygithub'], domains: ['api.github.com'] },
  'gitlab-saas': { npm: ['@gitbeaker/*'], pip: ['python-gitlab'], domains: ['gitlab.com/api'] },
  okta: { npm: ['@okta/*'], pip: ['okta'], domains: ['.okta.com'] },
  auth0: { npm: ['auth0', '@auth0/*'], pip: ['auth0-python'], domains: ['.auth0.com'] },
  'azure-ad': { npm: ['@azure/msal-node', '@azure/msal-browser'], pip: ['msal'], domains: ['login.microsoftonline.com'] },
  slack: { npm: ['@slack/*'], pip: ['slack-sdk', 'slack-bolt'], domains: ['hooks.slack.com', 'slack.com/api'] },
  'microsoft-teams': { domains: ['webhook.office.com'] },
  salesforce: { npm: ['jsforce'], pip: ['simple-salesforce'], domains: ['.my.salesforce.com'] },
  hubspot: { npm: ['@hubspot/api-client'], pip: ['hubspot-api-client'], domains: ['api.hubapi.com'] },
  'jira-cloud': { npm: ['jira-client', 'jira.js'], pip: ['jira'], domains: ['.atlassian.net'] },
  servicenow: { domains: ['.service-now.com'] },
  cloudflare: { npm: ['cloudflare'], pip: ['cloudflare'], domains: ['api.cloudflare.com'] },
  fastly: { npm: ['fastly'], pip: ['fastly'], domains: ['api.fastly.com'] },
  firebase: { npm: ['firebase', 'firebase-admin', '@firebase/*'], pip: ['firebase-admin'], domains: ['firebaseio.com', 'firestore.googleapis.com'] },
  'aws-cognito': { npm: ['@aws-sdk/client-cognito-identity-provider', 'amazon-cognito-identity-js'], domains: ['cognito-idp.'] },
  pagerduty: { npm: ['@pagerduty/pdjs'], pip: ['pdpyras'], domains: ['events.pagerduty.com'] },
  opsgenie: { npm: ['opsgenie-sdk'], pip: ['opsgenie-sdk'], domains: ['api.opsgenie.com'] },
  'aws-comprehend-medical': { npm: ['@aws-sdk/client-comprehendmedical'] },
  'aws-textract': { npm: ['@aws-sdk/client-textract'] },
  'aws-lambda': { npm: ['@aws-sdk/client-lambda'] },
  'aws-ses-v2': { npm: ['@aws-sdk/client-sesv2', '@aws-sdk/client-ses'] },
  'aws-secrets-manager': { npm: ['@aws-sdk/client-secrets-manager', '@aws-sdk/client-ssm'] },
  sonarcloud: { domains: ['sonarcloud.io'] },
};

export interface SovereignServiceHit {
  service: SovereignServiceEntry;
  detectedVia: 'package' | 'source_scan';
  evidence: string[];
}

/** Match the dependency inventory and source-scan domain hits against the sovereign service catalogue. */
export function matchSovereignServices(
  catalogue: SovereignServiceCatalogue,
  deps: DependencyRef[],
  domainHits: Map<string, string>,
): SovereignServiceHit[] {
  const hits: SovereignServiceHit[] = [];
  for (const service of catalogue.services) {
    const rule = SOVEREIGN_SERVICE_DETECTION[service.id];
    if (!rule) continue;
    const pkgEvidence = new Set<string>();
    for (const d of deps) {
      const patterns = d.ecosystem === 'npm' ? rule.npm : d.ecosystem === 'pip' ? rule.pip : undefined;
      if (patterns?.some((p) => matchesPattern(d.name, p, undefined, d.ecosystem))) {
        pkgEvidence.add(`${d.file} (${d.name}${d.version ? `: ${d.version}` : ''})`);
      }
    }
    const domainEvidence = new Set<string>();
    for (const domain of rule.domains ?? []) {
      const file = domainHits.get(domain);
      if (file) domainEvidence.add(`${file} (${domain})`);
    }
    if (pkgEvidence.size === 0 && domainEvidence.size === 0) continue;
    hits.push({
      service,
      detectedVia: pkgEvidence.size > 0 ? 'package' : 'source_scan',
      evidence: [...pkgEvidence, ...domainEvidence].sort(),
    });
  }
  return hits;
}

/**
 * #3296: the catalogue's blocks_migration only counts for a verified verdict.
 * An unverified entry is never a migration blocker, whatever the file says.
 */
export function sovereignServiceBlocks(s: SovereignServiceEntry): boolean {
  return s.blocks_migration === true && s.portability_verdict === 'unavailable' && s.verdict_confidence === 'verified';
}

/**
 * Verified: unavailable + blocks_migration: critical; unavailable: high;
 * partial: medium; available: low. Unverified (#3296): at most medium.
 */
export function sovereignServiceSeverity(s: SovereignServiceEntry): NonNullable<Signal['severity']> {
  if (s.verdict_confidence !== 'verified') return s.portability_verdict === 'available' ? 'low' : 'medium';
  if (s.portability_verdict === 'unavailable') return sovereignServiceBlocks(s) ? 'critical' : 'high';
  return s.portability_verdict === 'partial' ? 'medium' : 'low';
}

const SEVERITY_RANK: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, informational: 1, positive: 0 };

function sovereignVerdictText(s: SovereignServiceEntry): string {
  return `Sovereign service catalogue verdict for ${s.name} (${s.vendor}): ${s.portability_verdict} (${s.verdict_confidence}, evidence class ${s.sovereign_evidence}, last reviewed ${s.last_reviewed}). blocks_migration: ${sovereignServiceBlocks(s)}.${s.verdict_confidence === 'verified' ? '' : ' The verdict is not verified against a public source, so it is not treated as a migration blocker.'}`;
}

function readJson(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function allDeps(pkg: Record<string, unknown>): Record<string, string> {
  return {
    ...((pkg.dependencies ?? {}) as Record<string, string>),
    ...((pkg.devDependencies ?? {}) as Record<string, string>),
  };
}

interface EgressFinding {
  domain: string;
  source: string;
  detectedVia: 'package' | 'source_scan';
  entry: DomainEntry;
  blocksForResidency: string[];
}

function scanSourceFiles(dir: string, domains: string[] = Object.keys(EGRESS_CATALOGUE)): Map<string, string> {
  const hits = new Map<string, string>();
  const allowed = new Set(['.ts', '.js', '.mjs', '.cjs']);

  function walk(d: string): void {
    if (!existsSync(d)) return;
    const entries = readdirSync(d);
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'fixtures') continue;
      const full = join(d, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (allowed.has(extname(entry))) {
        try {
          const content = readFileSync(full, 'utf-8');
          for (const domain of domains) {
            if (content.includes(domain)) {
              hits.set(domain, full.replace(dir + '/', '').replace(dir + '\\', ''));
            }
          }
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  walk(dir);
  return hits;
}

export async function runEgrPass(ctx: PassContext): Promise<PassResult> {
  const { sourcePath, iter, assessedAt } = ctx;
  const signals: Signal[] = [];
  const findings: EgressFinding[] = [];

  const pkg = readJson(join(sourcePath, 'package.json'));
  const deps = pkg ? allDeps(pkg) : {};

  // Detect egress from package catalogue
  for (const [pkgName, pkgInfo] of Object.entries(KNOWN_EGRESS_PACKAGES)) {
    if (pkgName in deps) {
      const domainEntry = EGRESS_CATALOGUE[pkgInfo.domain];
      if (domainEntry) {
        findings.push({
          domain: pkgInfo.domain,
          source: `package.json (${pkgName}: ${deps[pkgName]})`,
          detectedVia: 'package',
          entry: domainEntry,
          blocksForResidency: domainEntry.blocksForResidency ?? [],
        });
      }
    }
  }

  // Detect egress from source file scan (one walk covers the egress domains
  // and the sovereign service host names, #3160)
  const sovereignDomains = Object.values(SOVEREIGN_SERVICE_DETECTION).flatMap((r) => r.domains ?? []);
  const sourceDomains = scanSourceFiles(sourcePath, [...new Set([...Object.keys(EGRESS_CATALOGUE), ...sovereignDomains])]);
  for (const [domain, filePath] of sourceDomains) {
    const alreadyFound = findings.some((f) => f.domain === domain);
    if (!alreadyFound) {
      const domainEntry = EGRESS_CATALOGUE[domain];
      if (domainEntry) {
        findings.push({
          domain,
          source: filePath,
          detectedVia: 'source_scan',
          entry: domainEntry,
          blocksForResidency: domainEntry.blocksForResidency ?? [],
        });
      }
    } else {
      // Enrich existing finding with source file evidence
      const existing = findings.find((f) => f.domain === domain);
      if (existing && existing.detectedVia === 'package') {
        existing.source = `${existing.source}; ${filePath}`;
      }
    }
  }

  // --- Sovereign service availability (sovereign-service-catalogue.yaml, #3160) ---
  // Matched before the egress signals are emitted so that an egress
  // destination and a catalogue service naming the same service produce ONE
  // signal (#3296): the egress signal carries the catalogue verdict and the
  // service is not reported a second time. The catalogue's free-text
  // eu_details and remediation are not copied into signals.
  let sovereignServiceCheck: string;
  let sovereignHits: SovereignServiceHit[] = [];
  const sovereignCat = loadSovereignServiceCatalogue();
  if (!sovereignCat.ok) {
    sovereignServiceCheck = `skipped: ${sovereignCat.reason}`;
  } else {
    const inventory = collectDependencyInventory(sourcePath);
    sovereignHits = matchSovereignServices(sovereignCat.data, inventory.deps, sourceDomains);
    sovereignServiceCheck = sovereignHits.length > 0 ? 'matched' : 'no_match';
  }
  const pendingHits = new Map(sovereignHits.map((h) => [h.service.id, h]));
  const sovereignServices: Array<Record<string, unknown>> = [];
  const recordService = (hit: SovereignServiceHit, signalRef: string, egressDomain?: string): void => {
    const s = hit.service;
    sovereignServices.push({
      service_id: s.id,
      name: s.name,
      category: s.category,
      portability_verdict: s.portability_verdict,
      verdict_confidence: s.verdict_confidence,
      sovereign_evidence: s.sovereign_evidence,
      blocks_migration: sovereignServiceBlocks(s),
      detected_via: hit.detectedVia,
      last_reviewed: s.last_reviewed,
      signal_ref: signalRef,
      ...(egressDomain ? { merged_with_egress_destination: egressDomain } : {}),
    });
  };

  // Emit signals for each finding
  let sigNum = 1;
  const eggressDestinations: Array<Record<string, unknown>> = [];

  for (const finding of findings) {
    const id = `EGR-${String(sigNum).padStart(2, '0')}`;
    const hit = finding.entry.serviceId ? pendingHits.get(finding.entry.serviceId) : undefined;
    // A verified catalogue verdict governs severity and blocker status: it is
    // sourced and reviewed, while the egress catalogue records only the host
    // jurisdiction. An unverified verdict leaves the egress rating unchanged.
    const verified = hit !== undefined && hit.service.verdict_confidence === 'verified';
    const residencyBlocker = finding.blocksForResidency.length > 0;
    const isBlocker = hit !== undefined && verified ? sovereignServiceBlocks(hit.service) : residencyBlocker;
    const egressSeverity: NonNullable<Signal['severity']> = residencyBlocker
      ? 'critical'
      : finding.entry.jurisdiction === 'uncertain' ? 'medium' : 'high';
    const severity = hit !== undefined && verified ? sovereignServiceSeverity(hit.service) : egressSeverity;
    signals.push({
      id,
      source: 'static_analysis',
      category: 'application',
      severity,
      derivation: `${finding.entry.note}. Jurisdiction: ${finding.entry.jurisdiction}. SCC in place: ${finding.entry.scc}. Detected via: ${finding.detectedVia}.${isBlocker && !verified ? ' blocks_migration: true for DE_only / EU_only residency.' : ''}${hit ? ` ${sovereignVerdictText(hit.service)}` : ''}`,
      evidence: hit ? [...new Set([finding.source, ...hit.evidence])] : [finding.source],
      confidence: 'high',
      ...(hit ? { implies: [`sovereign_service:${hit.service.id}`] } : {}),
    });

    eggressDestinations.push({
      domain: finding.domain,
      jurisdiction: finding.entry.jurisdiction,
      scc: finding.entry.scc,
      blocks_migration: isBlocker,
      detected_via: finding.detectedVia,
      signal_ref: id,
      ...(hit ? { sovereign_service_id: hit.service.id } : {}),
    });
    if (hit) {
      recordService(hit, id, finding.domain);
      pendingHits.delete(hit.service.id);
    }

    sigNum++;
  }

  // Detect missing sovereignty allowlist
  const hasDataProviderDir = existsSync(join(sourcePath, 'apps', 'api', 'src', 'services', 'data-provider'));
  const hasAllowlist = (() => {
    if (!hasDataProviderDir) return false;
    try {
      const content = readFileSync(
        join(sourcePath, 'apps', 'api', 'src', 'services', 'data-provider', 'data-provider.service.ts'),
        'utf-8',
      );
      return /allowlist|allowedDomains|sovereignProviders|blocklist/.test(content);
    } catch {
      return false;
    }
  })();

  if (hasDataProviderDir && !hasAllowlist) {
    signals.push({
      id: `EGR-${String(sigNum).padStart(2, '0')}`,
      source: 'static_analysis',
      category: 'application',
      severity: 'high',
      derivation: `No provider-sovereignty allowlist or geographic routing guard found in data provider service layer. Providers can be added without egress sovereignty enforcement.`,
      evidence: ['apps/api/src/services/data-provider/data-provider.service.ts'],
      confidence: 'medium',
    });
    sigNum++;
  }

  // One signal per remaining catalogue service, numbered after the egress
  // and allowlist signals so existing EGR numbering is unchanged.
  for (const hit of sovereignHits) {
    if (!pendingHits.has(hit.service.id)) continue;
    const s = hit.service;
    const id = `EGR-${String(sigNum).padStart(2, '0')}`;
    signals.push({
      id,
      source: 'static_analysis',
      category: 'application',
      severity: sovereignServiceSeverity(s),
      derivation: `${s.name} detected via ${hit.detectedVia}. ${sovereignVerdictText(s)} Confirm the configured region and contract before relying on the verdict.`,
      evidence: hit.evidence,
      confidence: hit.detectedVia === 'package' ? 'high' : 'medium',
      implies: [`sovereign_service:${s.id}`],
    });
    recordService(hit, id);
    sigNum++;
  }

  // Ensure at least one signal even if no egress found
  if (signals.length === 0) {
    signals.push({
      id: 'EGR-01',
      source: 'static_analysis',
      category: 'application',
      severity: 'informational',
      derivation: 'No known egress domains or packages detected in source scan. Manual review recommended.',
      evidence: ['package.json'],
      confidence: 'low',
    });
    eggressDestinations.push({ note: 'none_detected' });
  }

  const migrationBlockers = eggressDestinations.filter((d) => d.blocks_migration === true).length;

  return {
    pass: {
      id: 7,
      name: 'egress',
      signal_prefix: 'EGR',
      status: 'complete',
      iter,
      assessed_at: assessedAt,
    },
    signals,
    assessment: {
      egress_destinations: eggressDestinations,
      migration_blockers: migrationBlockers,
      sovereignty_claim_verified: false,
      sovereign_services: sovereignServices,
      sovereign_service_blockers: sovereignServices.filter((s) => s.blocks_migration === true).length,
      sovereign_services_merged_with_egress: sovereignServices.filter((s) => s.merged_with_egress_destination !== undefined).length,
      sovereign_service_check: sovereignServiceCheck,
    },
  };
}
