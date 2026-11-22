// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * #4287 (owner decision D-9, 2026-11-09): the 7R to TIME matching is the
 * single source of an app's 7R verdict. Every artefact (the synthesis pass
 * file and wsp.yaml, apm-score.json, portfolio-summary.json, the
 * publications) takes the label from `resolveSevenRVerdict`, so one app never
 * shows two verdicts.
 *
 * Both directions live here (Design 113 section 8, Design 103 section 22.3):
 * `SEVEN_R_TIME` maps a 7R verdict to its TIME quadrant (application apps
 * derive TIME this way), `TIME_TO_SEVEN_R` maps a TIME quadrant to the default
 * 7R (service apps without a usable synthesis verdict).
 */

import type { SevenRSource, TimeQuadrant } from './portfolio-summary.js';

/** 7R verdict to TIME quadrant. Keys are normalised (lower case, letters only). */
export const SEVEN_R_TIME: Readonly<Record<string, TimeQuadrant>> = {
  retire: 'Eliminate',
  retain: 'Tolerate',
  rehost: 'Migrate',
  relocate: 'Migrate',
  replatform: 'Migrate',
  repurchase: 'Migrate',
  refactor: 'Invest',
  rearchitect: 'Invest',
  rebuild: 'Invest',
};

/** TIME quadrant to the default 7R verdict (Design 113 section 8 table). */
export const TIME_TO_SEVEN_R: Readonly<Record<TimeQuadrant, string>> = {
  Eliminate: 'Retire',
  Tolerate: 'Retain',
  Invest: 'Retain',
  Migrate: 'Rehost',
  'Migrate-Critical': 'Rehost',
};

export function sevenRToTime(label: string | null | undefined): TimeQuadrant | null {
  if (!label) return null;
  return SEVEN_R_TIME[label.toLowerCase().replace(/[^a-z]/g, '')] ?? null;
}

/** Migrate and Migrate-Critical are one decision (move), differing in urgency only. */
function timeFamily(q: TimeQuadrant): string {
  return q === 'Migrate-Critical' ? 'Migrate' : q;
}

/** True when the 7R verdict matches the TIME quadrant under the matching. */
export function sevenRMatchesTime(label: string | null | undefined, time: TimeQuadrant): boolean {
  const mapped = sevenRToTime(label);
  return mapped !== null && timeFamily(mapped) === timeFamily(time);
}

export interface SevenRVerdict {
  label: string;
  source: SevenRSource;
  /** The synthesis verdict when the matching replaced it. */
  synthesis?: string;
  /** Why the synthesis verdict was replaced. */
  reason?: string;
}

/**
 * The 7R verdict of a service app (D-9):
 * 1. The analyst override (`disposition.seven_r`) wins (`analyst`).
 * 2. A synthesis verdict that matches the TIME quadrant is kept (`synthesis`).
 * 3. Otherwise the TIME default (`derived_from_time`); a replaced synthesis
 *    verdict is kept in `synthesis` with the reason, so it stays visible.
 */
export function resolveSevenRVerdict(opts: { time: TimeQuadrant; synthesis?: string | null; analyst?: string | null }): SevenRVerdict {
  const analyst = opts.analyst?.trim();
  if (analyst) return { label: analyst, source: 'analyst' };
  const synthesis = opts.synthesis?.trim();
  if (synthesis && sevenRMatchesTime(synthesis, opts.time)) return { label: synthesis, source: 'synthesis' };
  const label = TIME_TO_SEVEN_R[opts.time];
  if (!synthesis) return { label, source: 'derived_from_time' };
  const mapped = sevenRToTime(synthesis);
  return {
    label,
    source: 'derived_from_time',
    synthesis,
    reason: mapped
      ? `synthesis verdict ${synthesis} maps to TIME ${mapped}, but the TIME classification is ${opts.time}`
      : `synthesis verdict ${synthesis} has no TIME mapping`,
  };
}
