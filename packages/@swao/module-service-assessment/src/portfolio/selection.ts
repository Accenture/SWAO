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
 * summary the apps are returned in ID order. #4389: scaffolded service apps the
 * summary does not list (it was written by an application or LZ run before
 * `service init`) are added as not assessed and sort after the scored rows.
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
import { load as yamlLoad } from 'js-yaml';
import { z } from 'zod';
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

/**
 * #4389: the ranking plus what the CLI needs to explain it. `missingFromSummary`
 * lists the scaffolded service apps that `wsp/portfolio-summary.json` does not
 * list (an earlier application or LZ run wrote the summary before `service init`);
 * they are ranked as not assessed. `excludedByStatus` counts the service apps left
 * out as decommissioned, unused or inactive (summary rows and unlisted apps).
 */
export interface ServiceRankDetail {
  apps: RankedServiceApp[];
  /** Service apps found under apps/ (assessment.type service). */
  scaffolded: number;
  /** True when a portfolio summary exists and parses. */
  summaryPresent: boolean;
  /** Scaffolded service apps the summary does not list (sorted by ID); empty without a summary. */
  missingFromSummary: string[];
  /** Service apps left out by operational status. */
  excludedByStatus: number;
}

/** #4389: {@link rankServiceApps} with the counts that name the cause of an empty or partial list. */
export function rankServiceAppsDetailed(workspacePath: string, opts: { top?: number } = {}): ServiceRankDetail {
  return rankAppsDetailed(workspacePath, ['service'], opts);
}

function rankApps(workspacePath: string, types: readonly PortfolioAssessmentType[], opts: { top?: number }): RankedServiceApp[] {
  return rankAppsDetailed(workspacePath, types, opts).apps;
}

/** #4389: `disposition.operational_status` of an app's `.swao.yml` (the key score.ts reads), or null. */
function readOperationalStatus(workspacePath: string, appId: string): string | null {
  try {
    const doc = yamlLoad(readFileSync(join(workspacePath, 'apps', appId, '.swao.yml'), 'utf-8')) as { disposition?: { operational_status?: unknown } } | null;
    const s = doc?.disposition?.operational_status;
    return typeof s === 'string' ? s : null;
  } catch {
    return null;
  }
}

function rankAppsDetailed(workspacePath: string, types: readonly PortfolioAssessmentType[], opts: { top?: number }): ServiceRankDetail {
  const summaryPath = join(workspacePath, 'wsp', 'portfolio-summary.json');
  let ranked: RankedServiceApp[];
  const parsed = existsSync(summaryPath) ? PortfolioSummarySchema.safeParse(JSON.parse(readFileSync(summaryPath, 'utf-8'))) : null;
  const scaffolded = discoverServiceApps(workspacePath);
  let missingFromSummary: string[] = [];
  let excludedByStatus = 0;
  if (parsed?.success) {
    const inTypes = parsed.data.apps.filter((a) => types.includes(portfolioAppType(a)));
    const kept = inTypes.filter((a) => !NOT_ASSESSED_STATUS.has(String(a.operational_status ?? '')));
    excludedByStatus = inTypes.filter((a) => portfolioAppType(a) === 'service').length - kept.filter((a) => portfolioAppType(a) === 'service').length;
    ranked = kept
      .map((a) => ({ id: a.id, name: a.name, risk_score: a.risk_score, fan_in: a.fan_in ?? 0, time_quadrant: a.time_quadrant, operational_status: a.operational_status, evidence: isNotAssessed(a) ? 'not_assessed' as const : a.evidence ?? null, assessment_type: portfolioAppType(a) }));
    // #4389: the summary may predate `service init` (an application or LZ run rebuilt
    // it first). Every scaffolded service app it does not list joins the ranking as
    // not assessed (no risk score, no fan-in), so the usual order rules put it after
    // the scored rows. Listed = any summary row, whatever its type or status, so a row
    // dropped above for its status is not re-added from disk.
    const listed = new Set(parsed.data.apps.map((a) => a.id));
    const unlisted = scaffolded.filter((a) => !listed.has(a.appId));
    missingFromSummary = unlisted.map((a) => a.appId);
    if (types.includes('service')) {
      for (const a of unlisted) {
        const status = readOperationalStatus(workspacePath, a.appId);
        if (NOT_ASSESSED_STATUS.has(String(status ?? ''))) { excludedByStatus += 1; continue; }
        ranked.push({ id: a.appId, name: a.appName, risk_score: null, fan_in: 0, time_quadrant: null, operational_status: status, evidence: 'not_assessed', assessment_type: 'service' });
      }
    }
    ranked.sort((x, y) => (y.risk_score ?? -1) - (x.risk_score ?? -1) || y.fan_in - x.fan_in || x.id.localeCompare(y.id));
  } else {
    // No summary yet: service apps in ID order (application apps need the summary to be ranked).
    ranked = types.includes('service')
      ? scaffolded
        .map((a) => ({ id: a.appId, name: a.appName, risk_score: null, fan_in: 0, time_quadrant: null, operational_status: null, evidence: null, assessment_type: 'service' as const }))
        .sort((x, y) => x.id.localeCompare(y.id))
      : [];
  }
  return {
    apps: opts.top !== undefined ? ranked.slice(0, Math.max(0, opts.top)) : ranked,
    scaffolded: scaffolded.length,
    summaryPresent: parsed?.success === true,
    missingFromSummary,
    excludedByStatus,
  };
}

/**
 * #4389: the operator line for an empty service ranking, naming the cause:
 * no service app scaffolded, or every one left out by its operational status.
 */
export function emptyServiceRankMessage(d: Pick<ServiceRankDetail, 'scaffolded' | 'excludedByStatus'>): string {
  if (d.scaffolded === 0) return 'No service apps to assess: none scaffolded under apps/ (run swao service init first).';
  return `No service apps to assess: all ${d.scaffolded} scaffolded service app(s) are decommissioned, unused or inactive.`;
}

/**
 * #4389: the note for a ranking that holds service apps missing from the
 * portfolio summary, or null when there are none.
 */
export function missingFromSummaryNote(d: Pick<ServiceRankDetail, 'missingFromSummary'>): string | null {
  const n = d.missingFromSummary.length;
  if (n === 0) return null;
  return `${n} service app(s) are not yet in wsp/portfolio-summary.json (an earlier application or landing zone run wrote it before swao service init); they are ranked as not assessed after the scored apps. Run swao service research to score them.`;
}

/** Default "top N" of the first assessment run (#3165). */
export const DEFAULT_ASSESS_TOP_N = 20;

const AssessTopNSchema = z.number().int().min(1);

/**
 * #3520: the workspace default for "Top N by risk" (`service_portfolio.assess_top_n`
 * in the workspace `.swao.yml`), used by the TUI scope question and
 * `swao service assess --top`. Missing file or key: {@link DEFAULT_ASSESS_TOP_N}.
 * A value that is not a positive integer throws, naming the key.
 */
export function readAssessTopN(workspacePath: string): number {
  const p = join(workspacePath, '.swao.yml');
  if (!existsSync(p)) return DEFAULT_ASSESS_TOP_N;
  const doc = yamlLoad(readFileSync(p, 'utf-8')) as { service_portfolio?: { assess_top_n?: unknown } } | null;
  const raw = doc?.service_portfolio?.assess_top_n;
  if (raw === undefined || raw === null) return DEFAULT_ASSESS_TOP_N;
  const parsed = AssessTopNSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`service_portfolio.assess_top_n in ${p} must be a positive integer (got ${JSON.stringify(raw)})`);
  return parsed.data;
}

/**
 * #3520: parse an operator-entered N for "Top N by risk". Returns the integer
 * when it lies in 1..max (max = number of service apps, when known), otherwise
 * null so the caller can keep asking.
 */
export function parseTopN(input: string, max: number | null): number | null {
  const s = input.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (n < 1) return null;
  if (max !== null && n > max) return null;
  return n;
}
