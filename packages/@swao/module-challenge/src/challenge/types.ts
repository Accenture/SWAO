// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Challenge module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

export interface WspSignal {
  id: string;
  prefix: string;
  severity: string;
  description: string;
  confidence: number;
  evidence?: string[];
}

export interface WspBlocker {
  id: string;
  description: string;
}

export interface LzCandidate {
  id: string;
  name: string;
  fitScore: number;
  lockInFlags: string[];
}

export interface WspSummary {
  appId: string;
  sevenRLabel: string;
  coverageScore: number;
  landingZone: string;
  assessedAt?: string;
  signals: WspSignal[];
  blockers: WspBlocker[];
  complianceVerdicts: Record<string, string>;
  recommendedNextSteps: string[];
  landingZoneCandidates?: LzCandidate[];
  /** Actual LZ catalog assessment results when a catalog run exists alongside the app assessment (#1360). */
  lzCatalogFit?: LzAssessedTarget[];
}

// -----------------------------------------------------------------------
// LZ Sovereignty Challenge types (#1109)
// -----------------------------------------------------------------------

export interface LzFitItemSummary {
  service_code: string;
  verdict: string;
  detail: string;
}

export interface LzAssessedTarget {
  provider: string;
  region: string;
  overall: string;
  sovereignty_statement: string;
  items: LzFitItemSummary[];
}

/** Summary fed to LZ persona prompts. Built from lz-fit*.yaml passes. */
export interface LzWspSummary {
  appId: string;
  assessedAt?: string;
  /** Frameworks that drove sovereignty gates, e.g. ["BSI_C5", "GDPR"]. */
  frameworks: string[];
  /** True when no app assessment signals were found (catalogue-only run). */
  catalogueOnly: boolean;
  targets: LzAssessedTarget[];
}

export function formatLzContext(lz: LzWspSummary): string {
  const lines: string[] = [
    '--- LZ ASSESSMENT START ---',
    `Application: ${lz.appId}`,
    `Assessment date: ${lz.assessedAt ?? 'unknown'}`,
    `Active sovereignty frameworks: ${lz.frameworks.length > 0 ? lz.frameworks.join(', ') : 'none (DEMO run -- no sovereignty gates active)'}`,
    `Catalogue-only mode: ${lz.catalogueOnly ? 'yes (no prior App Assessment -- service-fit gap analysis skipped)' : 'no'}`,
    '',
    `Targets assessed: ${lz.targets.length}`,
  ];
  for (const t of lz.targets) {
    lines.push(`  ${t.provider}/${t.region}`);
    lines.push(`    Overall verdict: ${t.overall}`);
    lines.push(`    Sovereignty: ${t.sovereignty_statement}`);
    if (t.items.length > 0) {
      lines.push(`    Service gaps (${t.items.length}):`);
      for (const item of t.items) {
        lines.push(`      [${item.verdict}] ${item.service_code}: ${item.detail}`);
      }
    } else {
      lines.push('    Service gaps: none assessed (catalogue-only)');
    }
    lines.push('');
  }
  lines.push('--- LZ ASSESSMENT END ---');
  return lines.join('\n');
}

export function formatWspContext(wsp: WspSummary): string {
  const lines: string[] = [
    '--- WSP START ---',
    `Application: ${wsp.appId}`,
    `Assessment date: ${wsp.assessedAt ?? 'unknown'}`,
    `7R Label: ${wsp.sevenRLabel}`,
    `Coverage score: ${Math.round(wsp.coverageScore * 100)}%`,
    `Recommended landing zone: ${wsp.landingZone}`,
    '',
  ];

  if (wsp.landingZoneCandidates && wsp.landingZoneCandidates.length > 0) {
    lines.push('Landing zone candidates:');
    for (const lz of wsp.landingZoneCandidates) {
      const flags = lz.lockInFlags.length > 0 ? ` [lock-in: ${lz.lockInFlags.join(', ')}]` : '';
      lines.push(`  ${lz.id} (${lz.name}) -- fit score ${lz.fitScore.toFixed(2)}${flags}`);
    }
    lines.push('');
  }

  if (wsp.blockers.length > 0) {
    lines.push('Migration blockers:');
    for (const b of wsp.blockers) {
      lines.push(`  [${b.id}] ${b.description}`);
    }
    lines.push('');
  }

  const complianceEntries = Object.entries(wsp.complianceVerdicts);
  if (complianceEntries.length > 0) {
    lines.push('Compliance verdicts:');
    for (const [regime, verdict] of complianceEntries) {
      lines.push(`  ${regime}: ${verdict}`);
    }
    lines.push('');
  }

  if (wsp.signals.length > 0) {
    lines.push('Assessment signals:');
    for (const s of wsp.signals) {
      lines.push(`  [${s.id}] severity=${s.severity} confidence=${s.confidence.toFixed(2)} -- ${s.description}`);
      if (s.evidence && s.evidence.length > 0) {
        for (const ev of s.evidence.slice(0, 3)) {
          lines.push(`    evidence: ${ev.trim()}`);
        }
      }
    }
    lines.push('');
  }

  if (wsp.recommendedNextSteps.length > 0) {
    lines.push('Recommended next steps:');
    for (const step of wsp.recommendedNextSteps) {
      lines.push(`  - ${step}`);
    }
    lines.push('');
  }

  if (wsp.lzCatalogFit && wsp.lzCatalogFit.length > 0) {
    lines.push('Landing zone catalog assessment results (#1360):');
    for (const t of wsp.lzCatalogFit) {
      lines.push(`  ${t.provider}/${t.region}: ${t.overall}`);
      lines.push(`    Sovereignty: ${t.sovereignty_statement}`);
      if (t.items.length > 0) {
        lines.push(`    Service gaps (${t.items.length}):`);
        for (const item of t.items) {
          lines.push(`      [${item.verdict}] ${item.service_code}: ${item.detail}`);
        }
      } else {
        lines.push('    All services sovereign-ready.');
      }
    }
    lines.push('');
  }

  lines.push('--- WSP END ---');
  return lines.join('\n');
}
