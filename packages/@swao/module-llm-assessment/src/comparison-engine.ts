// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Comparison engine: relative scoring + sub-results + final result
// (#1425, Design 092 s5.8; operator decision OQ-92-10).
//
// Scoring is RELATIVE to the run's model set -- no hand-maintained
// absolute thresholds:
//   - every scored property normalises to 0..100 between the field's worst
//     (0) and best (100), respecting the metric's direction;
//   - the degenerate-spread guard keeps trivial differences from blowing
//     up into 0-vs-100 verdicts (all legs score 100 when the field's
//     relative spread is below 2%);
//   - traffic lights derive from the normalised score (red = clearly worst
//     of THIS field, not "below an absolute bar"); absolute problems
//     (DNF, truncation, ...) surface as FINDINGS, not thresholds;
//   - group sub-result = mean of the group's normalised scores -> rank;
//   - final result = weighted aggregate of group scores with the weights
//     PUBLISHED next to it. A leg missing a group (e.g. unpriced local leg
//     excluded from cost ranking) gets its weights renormalised over its
//     available groups and is marked partial.
//
// The maths here is verified deterministically (property-based tests +
// hand-computed golden fixtures in comparison-engine.test.ts); an LLM is
// never the arbiter of these numbers (operator, 2026-08-06).

import type { MetricDefinition, MetricGroup } from './metric-catalogue.js';
import { METRIC_GROUPS } from './metric-catalogue.js';

/** Relative spread below which a property is treated as a draw (2%). */
export const DEGENERATE_SPREAD_EPSILON = 0.02;

export type TrafficLight = 'ok' | 'warn' | 'red' | 'none';

export interface PropertyScore {
  metricId: string;
  /** Raw values per leg id; null = leg not rankable on this property. */
  raw: Record<string, number | null>;
  /** Normalised 0..100 per leg id; null = excluded (raw null or neutral). */
  normalised: Record<string, number | null>;
  /** True when the degenerate-spread guard levelled the field. */
  degenerate: boolean;
}

export interface GroupSubResult {
  group: MetricGroup;
  /** Mean of the group's normalised scores per leg; null = no scorable
   *  property for that leg in this group. */
  score: Record<string, number | null>;
  /** Competition ranking (1 = best; ties share the rank); null legs
   *  unranked. */
  rank: Record<string, number | null>;
  light: Record<string, TrafficLight>;
}

export interface FinalResult {
  /** Weighted 0..100 score per leg. */
  score: Record<string, number | null>;
  rank: Record<string, number | null>;
  /** The weights actually applied, normalised to sum 1 -- published with
   *  every rendering of the final result (092 s5.8). */
  weights: Record<string, number>;
  /** Legs whose weights were renormalised over a subset of groups
   *  (missing group scores), with the missing groups named. */
  partial: Record<string, MetricGroup[]>;
}

export function trafficLight(score: number | null): TrafficLight {
  if (score === null) return 'none';
  if (score >= 66) return 'ok';
  if (score >= 33) return 'warn';
  return 'red';
}

/**
 * Normalise one property across legs (092 s5.8). Neutral metrics return
 * all-null (rendered, never scored).
 */
export function normaliseProperty(
  metric: MetricDefinition,
  raw: Record<string, number | null>,
): PropertyScore {
  const legIds = Object.keys(raw);
  const normalised: Record<string, number | null> = {};
  for (const id of legIds) normalised[id] = null;

  if (metric.direction === 'neutral') {
    return { metricId: metric.id, raw, normalised, degenerate: false };
  }

  const present = legIds.filter((id) => raw[id] !== null && Number.isFinite(raw[id]));
  if (present.length === 0) {
    return { metricId: metric.id, raw, normalised, degenerate: false };
  }

  const values = present.map((id) => raw[id] as number);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const scale = Math.max(Math.abs(min), Math.abs(max));

  // Degenerate-spread guard: a field this tight is a draw, not a ranking.
  const spreadRelative = scale === 0 ? 0 : (max - min) / scale;
  if (spreadRelative < DEGENERATE_SPREAD_EPSILON) {
    for (const id of present) normalised[id] = 100;
    return { metricId: metric.id, raw, normalised, degenerate: true };
  }

  for (const id of present) {
    const v = raw[id] as number;
    const zeroToOne = (v - min) / (max - min);
    const better = metric.direction === 'higher' ? zeroToOne : 1 - zeroToOne;
    normalised[id] = Math.round(better * 1000) / 10; // 0..100, 0.1 resolution
  }
  return { metricId: metric.id, raw, normalised, degenerate: false };
}

/** Competition ranking over a score map (higher score = better rank).
 *  Ties share a rank; the next rank skips (1, 1, 3). */
export function rankScores(score: Record<string, number | null>): Record<string, number | null> {
  const ranked = Object.entries(score)
    .filter((e): e is [string, number] => e[1] !== null)
    .sort((a, b) => b[1] - a[1]);
  const rank: Record<string, number | null> = {};
  for (const id of Object.keys(score)) rank[id] = null;
  let position = 0;
  let prevScore: number | null = null;
  let prevRank = 0;
  for (const [id, s] of ranked) {
    position += 1;
    const r = prevScore !== null && s === prevScore ? prevRank : position;
    rank[id] = r;
    prevScore = s;
    prevRank = r;
  }
  return rank;
}

/** Group sub-result: mean of the group's normalised property scores per
 *  leg (092 s5.8). Properties where a leg is null simply do not count for
 *  that leg -- absence is not a zero. */
export function groupSubResult(
  group: MetricGroup,
  properties: PropertyScore[],
): GroupSubResult {
  const legIds = new Set<string>();
  for (const p of properties) for (const id of Object.keys(p.normalised)) legIds.add(id);

  const score: Record<string, number | null> = {};
  for (const id of legIds) {
    const vals = properties
      .map((p) => p.normalised[id])
      .filter((v): v is number => v !== null);
    score[id] = vals.length === 0
      ? null
      : Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  }
  const rank = rankScores(score);
  const light: Record<string, TrafficLight> = {};
  for (const id of legIds) light[id] = trafficLight(score[id] ?? null);
  return { group, score, rank, light };
}

/**
 * Weighted final result (092 s5.8). `weights` maps weight keys to group
 * sets so the four published weight knobs (quality, reliability,
 * performance, cost) cover the multi-group quality dimension without the
 * operator configuring eight numbers.
 */
export const WEIGHT_KEY_GROUPS: Record<string, MetricGroup[]> = {
  quality: ['quality-content', 'quality-structural'],
  reliability: ['reliability'],
  performance: ['performance'],
  cost: ['cost'],
  security: ['security'],
};

export const DEFAULT_WEIGHTS: Record<string, number> = {
  quality: 0.5,
  reliability: 0.2,
  performance: 0.15,
  cost: 0.15,
  security: 0.1,
};

export function finalResult(
  groups: GroupSubResult[],
  rawWeights: Record<string, number> = DEFAULT_WEIGHTS,
): FinalResult {
  // Normalise weights to sum 1 (scale-invariant: {2,1} === {0.66,0.33}).
  const entries = Object.entries(rawWeights).filter(([, w]) => w > 0);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  const weights: Record<string, number> = {};
  for (const [k, w] of entries) weights[k] = total === 0 ? 0 : w / total;

  const byGroup = new Map<MetricGroup, GroupSubResult>(groups.map((g) => [g.group, g]));
  const legIds = new Set<string>();
  for (const g of groups) for (const id of Object.keys(g.score)) legIds.add(id);

  const score: Record<string, number | null> = {};
  const partial: Record<string, MetricGroup[]> = {};

  for (const id of legIds) {
    let acc = 0;
    let usedWeight = 0;
    const missing: MetricGroup[] = [];
    for (const [key, w] of Object.entries(weights)) {
      const groupsForKey = WEIGHT_KEY_GROUPS[key] ?? [];
      const scores = groupsForKey
        .map((g) => byGroup.get(g)?.score[id])
        .filter((v): v is number => v !== null && v !== undefined);
      if (scores.length === 0) {
        missing.push(...groupsForKey.filter((g) => METRIC_GROUPS.includes(g)));
        continue;
      }
      const keyScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      acc += keyScore * w;
      usedWeight += w;
    }
    // Renormalise over the weights this leg could actually use (e.g. an
    // unpriced local leg has no cost score -- 092 s4: excluded from cost
    // ranking, marked partial, never punished with an implicit zero).
    score[id] = usedWeight === 0 ? null : Math.round((acc / usedWeight) * 10) / 10;
    if (missing.length > 0) partial[id] = missing;
  }

  return { score, rank: rankScores(score), weights, partial };
}
