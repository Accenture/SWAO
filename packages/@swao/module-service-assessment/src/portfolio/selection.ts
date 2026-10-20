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
 * Which service apps to assess first (#3165). A full assessment costs several
 * LLM calls and a few minutes per app, so the TUI and CI select the top N:
 *
 * 1. Apps whose operational status is decommissioned, unused, or inactive are
 *    left out (they are Eliminate candidates without an assessment).
 * 2. Highest SWAO_APM risk score first (apps without a score last).
 * 3. Ties: higher integration fan-in first (more dependants), then app ID.
 *
 * A cluster is one app (its members are not separate apps). The ranking reads
 * `wsp/portfolio-summary.json`, so it is meaningful after research; without a
 * summary the apps are returned in ID order.
 *
 * #3290 (Design 110 D-24): apps without a service assessment run keep their
 * place in the ranking (their intake and research scores still order them) but
 * carry `evidence: not_assessed`, so every rank view can mark them.
 *
 * #3280 (Design 103 §22): the summary is the combined portfolio view. The rank
 * stays service-only by default, because its callers feed the top N into
 * `swao assess --type service`; `rankPortfolioApps` ranks both types with the
 * same order rules and carries `assessment_type` on every entry.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PortfolioSummarySchema, portfolioAppType, type PortfolioAssessmentType } from '@swao/core';
import { discoverServiceApps } from '../research/research.js';

const NOT_ASSESSED_STATUS = new Set(['decommissioned', 'unused', 'inactive']);

export interface RankedServiceApp {
  id: string;
  name: string | null;
  risk_score: number | null;
  fan_in: number;
  time_quadrant: string | null;
  operational_status: string | null;
  /**
   * #3290: the summary's evidence label. `not_assessed` = no service assessment
   * run (intake and research scores only); also set for summaries written before
   * #3241 that only carry `assessed: false`. Null when there is no summary.
   */
  evidence: 'sufficient' | 'insufficient' | 'not_assessed' | null;
  /** #3280: `service` for every entry of the default rank; `application` only from rankPortfolioApps. */
  assessment_type: PortfolioAssessmentType;
}

/** #3290: true when a rank or wave view must mark the app as not assessed. */
export function isNotAssessed(a: { evidence?: string | null; assessed?: boolean | null }): boolean {
  return a.evidence === 'not_assessed' || a.assessed === false;
}

export function rankServiceApps(workspacePath: string, opts: { top?: number } = {}): RankedServiceApp[] {
  return rankApps(workspacePath, ['service'], opts);
}

/** #3280: one ranked list over application and service apps (same order rules), each entry with its type. */
export function rankPortfolioApps(workspacePath: string, opts: { top?: number; types?: readonly PortfolioAssessmentType[] } = {}): RankedServiceApp[] {
  return rankApps(workspacePath, opts.types ?? ['application', 'service'], opts);
}

function rankApps(workspacePath: string, types: readonly PortfolioAssessmentType[], opts: { top?: number }): RankedServiceApp[] {
  const summaryPath = join(workspacePath, 'wsp', 'portfolio-summary.json');
  let ranked: RankedServiceApp[];
  const parsed = existsSync(summaryPath) ? PortfolioSummarySchema.safeParse(JSON.parse(readFileSync(summaryPath, 'utf-8'))) : null;
  if (parsed?.success) {
    ranked = parsed.data.apps
      .filter((a) => types.includes(portfolioAppType(a)))
      .filter((a) => !NOT_ASSESSED_STATUS.has(String(a.operational_status ?? '')))
      .map((a) => ({ id: a.id, name: a.name, risk_score: a.risk_score, fan_in: a.fan_in ?? 0, time_quadrant: a.time_quadrant, operational_status: a.operational_status, evidence: isNotAssessed(a) ? 'not_assessed' as const : a.evidence ?? null, assessment_type: portfolioAppType(a) }))
      .sort((x, y) => (y.risk_score ?? -1) - (x.risk_score ?? -1) || y.fan_in - x.fan_in || x.id.localeCompare(y.id));
  } else {
    // No summary yet: service apps in ID order (application apps need the summary to be ranked).
    ranked = types.includes('service')
      ? discoverServiceApps(workspacePath)
        .map((a) => ({ id: a.appId, name: a.appName, risk_score: null, fan_in: 0, time_quadrant: null, operational_status: null, evidence: null, assessment_type: 'service' as const }))
        .sort((x, y) => x.id.localeCompare(y.id))
      : [];
  }
  return opts.top !== undefined ? ranked.slice(0, Math.max(0, opts.top)) : ranked;
}
