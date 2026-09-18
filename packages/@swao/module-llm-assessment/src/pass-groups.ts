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

// Per-pass dimension groups + prompt-size views (#1426, Design 092
// s5.3B/s6.2). Every pass of the suite is a dimension group of its own:
// the interactive per-pass table (s8 mockup 2) and the collapsible
// per-pass segments under the headline matrix (s8 mockup 1) both read the
// aggregates produced here. Zero-call passes are rendered EXPLICITLY (a
// model cannot be compared on a pass that made no calls in its leg --
// validated finding, 092 s3.4).

import type { CallRecord, SizeBucket } from './call-record.js';
import { SIZE_BUCKETS } from './call-record.js';
import { normaliseProperty, rankScores } from './comparison-engine.js';
import { metricById } from './metric-catalogue.js';
import type { PropertyScore } from './comparison-engine.js';

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function rate(hits: number, total: number): number | null {
  return total === 0 ? null : Math.round((hits / total) * 1000) / 10;
}

/** Aggregated per-pass values for one leg. Null = not measurable (zero
 *  calls, or no price row for cost). */
export interface PassLegAggregate {
  calls: number;
  dnf: number;
  latency_p50_ms: number | null;
  prompt_tokens_median: number | null;
  completion_tokens_median: number | null;
  cost_usd: number | null;
  parse_valid_rate: number | null;
  schema_conform_rate: number | null;
  size_bucket: SizeBucket | null;   // median prompt bucket for the pass
  // Security signal counts (#1463, Design 092 s5.2).
  refusal_count: number | null;
  redaction_marker_altered_count: number | null;
  pii_reproduction_count: number | null;
  prompt_injection_count: number | null;
}

export interface PassGroup {
  pass_id: string;
  /** Aggregates per leg id; every leg of the run appears, zero-call legs
   *  included with calls: 0. */
  legs: Record<string, PassLegAggregate>;
  /** Pass sub-result rank per leg (from scored per-pass properties). */
  rank: Record<string, number | null>;
}

function aggregateLeg(records: CallRecord[]): PassLegAggregate {
  const done = records.filter((r) => !r.reliability.dnf);
  const priced = done.filter((r) => r.cost_usd.computed !== null);
  const buckets = records.map((r) => r.prompt.size_bucket);
  const bucketMedian = buckets.length === 0
    ? null
    : [...buckets].sort((a, b) => SIZE_BUCKETS.indexOf(a) - SIZE_BUCKETS.indexOf(b))[Math.floor(buckets.length / 2)]!;
  const n = records.length;
  return {
    calls: n,
    dnf: records.filter((r) => r.reliability.dnf).length,
    latency_p50_ms: median(done.map((r) => r.timing.total_ms)),
    prompt_tokens_median: median(records.map((r) => r.tokens.prompt)),
    completion_tokens_median: median(done.map((r) => r.tokens.completion)),
    cost_usd: priced.length === 0
      ? null
      : Math.round(priced.reduce((a, r) => a + (r.cost_usd.computed as number), 0) * 1e6) / 1e6,
    parse_valid_rate: rate(done.filter((r) => r.quality.parse_valid).length, done.length),
    schema_conform_rate: rate(done.filter((r) => r.quality.schema_conform).length, done.length),
    size_bucket: bucketMedian,
    refusal_count: n === 0 ? null : records.filter((r) => r.quality.refusal_detected).length,
    redaction_marker_altered_count: n === 0 ? null : records.filter((r) => r.security.redaction_marker_altered).length,
    pii_reproduction_count: n === 0 ? null : records.filter((r) => r.security.pii_reproduction_detected).length,
    prompt_injection_count: n === 0 ? null : records.filter((r) => r.security.prompt_injection_detected).length,
  };
}

/** Build per-pass dimension groups from all legs' call records. `legIds`
 *  is the full leg list so zero-call legs render explicitly. */
export function buildPassGroups(records: CallRecord[], legIds: string[]): PassGroup[] {
  const passIds = [...new Set(records.map((r) => r.pass_id))].sort();
  const groups: PassGroup[] = [];

  for (const passId of passIds) {
    const passRecords = records.filter((r) => r.pass_id === passId);
    const legs: Record<string, PassLegAggregate> = {};
    for (const legId of legIds) {
      legs[legId] = aggregateLeg(passRecords.filter((r) => r.leg.id === legId));
    }

    // Pass sub-result: normalise the scored per-pass properties through the
    // s5.8 engine and rank by their mean. DNF'd/zero-call legs stay null.
    const scoredProps: PropertyScore[] = [];
    const latencyMetric = metricById('perf.latency_p50_ms');
    const parseMetric = metricById('qs.parse_valid_rate');
    const costMetric = metricById('cost.total_usd');
    const raw = (pick: (a: PassLegAggregate) => number | null): Record<string, number | null> =>
      Object.fromEntries(legIds.map((id) => [id, legs[id]!.calls === 0 ? null : pick(legs[id]!)]));
    if (latencyMetric) scoredProps.push(normaliseProperty(latencyMetric, raw((a) => a.latency_p50_ms)));
    if (parseMetric) scoredProps.push(normaliseProperty(parseMetric, raw((a) => a.parse_valid_rate)));
    if (costMetric) scoredProps.push(normaliseProperty(costMetric, raw((a) => a.cost_usd)));

    const meanScore: Record<string, number | null> = {};
    for (const id of legIds) {
      const vals = scoredProps.map((p) => p.normalised[id]).filter((v): v is number => v !== null);
      meanScore[id] = vals.length === 0 ? null : vals.reduce((a, b) => a + b, 0) / vals.length;
    }

    groups.push({ pass_id: passId, legs, rank: rankScores(meanScore) });
  }
  return groups;
}

/** Prompt-size view (092 s6.2): one value per (bucket, leg) for a chosen
 *  per-call measurement. */
export interface BucketView {
  property: 'latency_p50_ms' | 'parse_valid_rate' | 'truncation_count';
  rows: Array<{
    bucket: SizeBucket;
    values: Record<string, number | null>;
  }>;
}

/** Minimal shape required from the orchestrator's challenge result map. */
interface ChallengeAgentData {
  agent_id: string;
  calls: number;
  dnf: boolean;
  duration_ms: number;
}

/** Zero-call PassLegAggregate for legs where the challenge did not run. */
const ZERO_CHALLENGE_LEG: PassLegAggregate = {
  calls: 0, dnf: 0, latency_p50_ms: null, prompt_tokens_median: null,
  completion_tokens_median: null, cost_usd: null, parse_valid_rate: null,
  schema_conform_rate: null, size_bucket: null, refusal_count: null,
  redaction_marker_altered_count: null, pii_reproduction_count: null,
  prompt_injection_count: null,
};

/** Build C1-namespace PassGroup entries from per-leg challenge results (#1708, Q3).
 *  One PassGroup per unique agent_id, pass_id = "C1-<agent_id>". Legs that did
 *  not run the challenge agent produce zero-call entries (rendered explicitly).
 *  callRecords: per-leg challenge CallRecords keyed by leg id (#1819); when
 *  present, real per-call metrics replace the subprocess-level duration_ms. */
export function buildChallengePassGroups(
  challengeResults: Map<string, { agents: ChallengeAgentData[] }>,
  legIds: string[],
  callRecords?: Map<string, CallRecord[]>,
): PassGroup[] {
  const agentIds = [
    ...new Set(
      [...challengeResults.values()].flatMap((r) => r.agents.map((a) => a.agent_id)),
    ),
  ].sort();

  return agentIds.map((agentId) => {
    const legs: Record<string, PassLegAggregate> = {};
    for (const legId of legIds) {
      const result = challengeResults.get(legId);
      const agent = result?.agents.find((a) => a.agent_id === agentId);
      const agentCallRecords = (callRecords?.get(legId) ?? []).filter(
        (r) => r.pass_id === `challenge-${agentId}`,
      );
      if (agentCallRecords.length > 0) {
        legs[legId] = aggregateLeg(agentCallRecords);
      } else if (agent) {
        legs[legId] = {
          calls: agent.calls, dnf: agent.dnf ? 1 : 0, latency_p50_ms: agent.duration_ms,
          prompt_tokens_median: null, completion_tokens_median: null, cost_usd: null,
          parse_valid_rate: null, schema_conform_rate: null, size_bucket: null,
          refusal_count: null, redaction_marker_altered_count: null,
          pii_reproduction_count: null, prompt_injection_count: null,
        };
      } else {
        legs[legId] = { ...ZERO_CHALLENGE_LEG };
      }
    }

    const raw = (pick: (a: PassLegAggregate) => number | null): Record<string, number | null> =>
      Object.fromEntries(legIds.map((id) => [id, legs[id]!.calls === 0 ? null : pick(legs[id]!)]));
    const latencyMetric = metricById('perf.latency_p50_ms');
    const scoredProps: PropertyScore[] = [];
    if (latencyMetric) scoredProps.push(normaliseProperty(latencyMetric, raw((a) => a.latency_p50_ms)));

    const meanScore: Record<string, number | null> = {};
    for (const id of legIds) {
      const vals = scoredProps.map((p) => p.normalised[id]).filter((v): v is number => v !== null);
      meanScore[id] = vals.length === 0 ? null : vals.reduce((a, b) => a + b, 0) / vals.length;
    }

    return { pass_id: `C1-${agentId}`, legs, rank: rankScores(meanScore) };
  });
}

/** Build C2-namespace PassGroup entries from per-leg LZ challenge results (#1820).
 *  One PassGroup per unique agent_id, pass_id = "C2-<agent_id>". Legs that did
 *  not run the LZ challenge agent produce zero-call entries.
 *  callRecords: per-leg LZ challenge CallRecords keyed by leg id (#1819). */
export function buildLzChallengePassGroups(
  lzChallengeResults: Map<string, { agents: ChallengeAgentData[] }>,
  legIds: string[],
  callRecords?: Map<string, CallRecord[]>,
): PassGroup[] {
  const agentIds = [
    ...new Set(
      [...lzChallengeResults.values()].flatMap((r) => r.agents.map((a) => a.agent_id)),
    ),
  ].sort();

  return agentIds.map((agentId) => {
    const legs: Record<string, PassLegAggregate> = {};
    for (const legId of legIds) {
      const result = lzChallengeResults.get(legId);
      const agent = result?.agents.find((a) => a.agent_id === agentId);
      const agentCallRecords = (callRecords?.get(legId) ?? []).filter(
        (r) => r.pass_id === `challenge-lz-${agentId}`,
      );
      if (agentCallRecords.length > 0) {
        legs[legId] = aggregateLeg(agentCallRecords);
      } else if (agent) {
        legs[legId] = {
          calls: agent.calls, dnf: agent.dnf ? 1 : 0, latency_p50_ms: agent.duration_ms,
          prompt_tokens_median: null, completion_tokens_median: null, cost_usd: null,
          parse_valid_rate: null, schema_conform_rate: null, size_bucket: null,
          refusal_count: null, redaction_marker_altered_count: null,
          pii_reproduction_count: null, prompt_injection_count: null,
        };
      } else {
        legs[legId] = { ...ZERO_CHALLENGE_LEG };
      }
    }

    const raw = (pick: (a: PassLegAggregate) => number | null): Record<string, number | null> =>
      Object.fromEntries(legIds.map((id) => [id, legs[id]!.calls === 0 ? null : pick(legs[id]!)]));
    const latencyMetric = metricById('perf.latency_p50_ms');
    const scoredProps: PropertyScore[] = [];
    if (latencyMetric) scoredProps.push(normaliseProperty(latencyMetric, raw((a) => a.latency_p50_ms)));

    const meanScore: Record<string, number | null> = {};
    for (const id of legIds) {
      const vals = scoredProps.map((p) => p.normalised[id]).filter((v): v is number => v !== null);
      meanScore[id] = vals.length === 0 ? null : vals.reduce((a, b) => a + b, 0) / vals.length;
    }

    return { pass_id: `C2-${agentId}`, legs, rank: rankScores(meanScore) };
  });
}

export function buildBucketView(
  records: CallRecord[],
  legIds: string[],
  property: BucketView['property'],
): BucketView {
  const rows: BucketView['rows'] = [];
  for (const bucket of SIZE_BUCKETS) {
    const bucketRecords = records.filter((r) => r.prompt.size_bucket === bucket);
    if (bucketRecords.length === 0) continue;
    const values: Record<string, number | null> = {};
    for (const legId of legIds) {
      const legRecords = bucketRecords.filter((r) => r.leg.id === legId);
      const done = legRecords.filter((r) => !r.reliability.dnf);
      if (legRecords.length === 0) { values[legId] = null; continue; }
      switch (property) {
        case 'latency_p50_ms':
          values[legId] = median(done.map((r) => r.timing.total_ms));
          break;
        case 'parse_valid_rate':
          values[legId] = rate(done.filter((r) => r.quality.parse_valid).length, done.length);
          break;
        case 'truncation_count':
          values[legId] = legRecords.filter((r) => r.quality.truncated).length;
          break;
      }
    }
    rows.push({ bucket, values });
  }
  return { property, rows };
}
