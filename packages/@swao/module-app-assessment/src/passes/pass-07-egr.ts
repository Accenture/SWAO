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

interface DomainEntry {
  jurisdiction: string;
  scc: boolean;
  note: string;
  blocksForResidency?: string[];
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
  '@aws-sdk/client-comprehend-medical': {
    domain: 'comprehendmedical.amazonaws.com',
    note: 'AWS Comprehend Medical SDK',
  },
};

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

function scanSourceFiles(dir: string): Map<string, string> {
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
          for (const domain of Object.keys(EGRESS_CATALOGUE)) {
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

  // Detect egress from source file scan
  const sourceDomains = scanSourceFiles(sourcePath);
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

  // Emit signals for each finding
  let sigNum = 1;
  const eggressDestinations: Array<Record<string, unknown>> = [];

  for (const finding of findings) {
    const isBlocker = finding.blocksForResidency.length > 0;
    signals.push({
      id: `EGR-${String(sigNum).padStart(2, '0')}`,
      source: 'static_analysis',
      category: 'application',
      severity: isBlocker ? 'critical' : finding.entry.jurisdiction === 'uncertain' ? 'medium' : 'high',
      derivation: `${finding.entry.note}. Jurisdiction: ${finding.entry.jurisdiction}. SCC in place: ${finding.entry.scc}. Detected via: ${finding.detectedVia}.${isBlocker ? ' blocks_migration: true for DE_only / EU_only residency.' : ''}`,
      evidence: [finding.source],
      confidence: 'high',
    });

    eggressDestinations.push({
      domain: finding.domain,
      jurisdiction: finding.entry.jurisdiction,
      scc: finding.entry.scc,
      blocks_migration: isBlocker,
      detected_via: finding.detectedVia,
      signal_ref: `EGR-${String(sigNum).padStart(2, '0')}`,
    });

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

  const migrationBlockers = findings.filter((f) => f.blocksForResidency.length > 0).length;

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
    },
  };
}
