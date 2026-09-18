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

// Per-pass dimension groups, size buckets, head-to-head mode (#1426).

import { describe, it, expect } from 'vitest';
import { CallRecordSchema, sizeBucket, analysisMode } from './call-record.js';
import type { CallRecord } from './call-record.js';
import { buildPassGroups, buildBucketView, buildChallengePassGroups } from './pass-groups.js';

function record(over: {
  leg: string; pass: string; ms?: number; promptTok?: number; dnf?: boolean;
  parse?: boolean; cost?: number | null; truncated?: boolean; index?: number;
}): CallRecord {
  const promptTok = over.promptTok ?? 1000;
  return CallRecordSchema.parse({
    leg: { id: over.leg, connector: over.leg.split('--')[0]!, model: over.leg.split('--')[1] ?? 'm' },
    pass_id: over.pass,
    call_site: 'signal-extraction',
    call_index: over.index ?? 0,
    prompt: { sha256: 'abc', chars: promptTok * 4, tokens_est: promptTok, size_bucket: sizeBucket(promptTok) },
    timing: { started: '2026-08-06T10:00:00Z', total_ms: over.ms ?? 1000 },
    tokens: { prompt: promptTok, completion: 400 },
    cost_usd: { computed: over.cost === undefined ? 0.01 : over.cost, source: over.cost === null ? 'local' : 'billed' },
    quality: {
      parse_valid: over.parse ?? true,
      schema_conform: over.parse ?? true,
      truncated: over.truncated ?? false,
      refusal_detected: false,
    },
    reliability: { retries: 0, rate_limited: false, dnf: over.dnf ?? false },
    security: { redaction_marker_altered: false, foreign_path_count: 0, pii_reproduction_detected: false, prompt_injection_detected: false },
    response_sha256: over.dnf ? undefined : 'def',
  });
}

describe('size buckets + analysis mode (#1426)', () => {
  it('bucket boundaries match Design 092 s6.1', () => {
    expect(sizeBucket(0)).toBe('S');
    expect(sizeBucket(1999)).toBe('S');
    expect(sizeBucket(2000)).toBe('M');
    expect(sizeBucket(15999)).toBe('M');
    expect(sizeBucket(16000)).toBe('L');
    expect(sizeBucket(63999)).toBe('L');
    expect(sizeBucket(64000)).toBe('XL');
  });

  it('exactly 2 legs = head-to-head; 3..5 = field; outside 2..5 refused', () => {
    expect(analysisMode(2)).toBe('head-to-head');
    expect(analysisMode(3)).toBe('field');
    expect(analysisMode(5)).toBe('field');
    expect(() => analysisMode(1)).toThrow(RangeError);
    expect(() => analysisMode(6)).toThrow(RangeError);
  });
});

describe('buildPassGroups (#1426)', () => {
  const legs = ['or--claude', 'or--deepseek', 'ollama--llama'];
  const records: CallRecord[] = [
    record({ leg: 'or--claude', pass: '03-data', ms: 2000 }),
    record({ leg: 'or--deepseek', pass: '03-data', ms: 1000 }),
    record({ leg: 'ollama--llama', pass: '03-data', ms: 4000, cost: null }),
    record({ leg: 'or--claude', pass: '07-ctx', ms: 9000, promptTok: 70000 }),
    record({ leg: 'or--deepseek', pass: '07-ctx', ms: 6000, promptTok: 70000 }),
    record({ leg: 'ollama--llama', pass: '07-ctx', dnf: true, promptTok: 70000 }),
  ];

  const groups = buildPassGroups(records, legs);

  it('produces one group per pass, sorted, with every leg present', () => {
    expect(groups.map((g) => g.pass_id)).toEqual(['03-data', '07-ctx']);
    for (const g of groups) expect(Object.keys(g.legs).sort()).toEqual([...legs].sort());
  });

  it('aggregates per leg: latency, cost (null for unpriced local), rates', () => {
    const g03 = groups[0]!;
    expect(g03.legs['or--deepseek']!.latency_p50_ms).toBe(1000);
    expect(g03.legs['ollama--llama']!.cost_usd).toBeNull();
    expect(g03.legs['or--claude']!.parse_valid_rate).toBe(100);
  });

  it('DNF legs are visible: call counted, latency null, unranked on the pass', () => {
    const g07 = groups[1]!;
    expect(g07.legs['ollama--llama']!.calls).toBe(1);
    expect(g07.legs['ollama--llama']!.dnf).toBe(1);
    expect(g07.legs['ollama--llama']!.latency_p50_ms).toBeNull();
    expect(g07.rank['or--deepseek']).toBe(1);
  });

  it('zero-call legs render explicitly (092 s3.4 validated finding)', () => {
    const withGhost = buildPassGroups(records, [...legs, 'or--ghost']);
    expect(withGhost[0]!.legs['or--ghost']!.calls).toBe(0);
    expect(withGhost[0]!.rank['or--ghost']).toBeNull();
  });

  it('XL prompts land in the XL bucket for the ctx pass', () => {
    expect(groups[1]!.legs['or--claude']!.size_bucket).toBe('XL');
  });
});

describe('buildBucketView (#1426, 092 s6.2)', () => {
  const legs = ['a--m', 'b--m'];
  const records: CallRecord[] = [
    record({ leg: 'a--m', pass: 'p1', ms: 500, promptTok: 1000 }),
    record({ leg: 'b--m', pass: 'p1', ms: 700, promptTok: 1000 }),
    record({ leg: 'a--m', pass: 'p2', ms: 5000, promptTok: 70000, truncated: true }),
    record({ leg: 'b--m', pass: 'p2', ms: 4000, promptTok: 70000 }),
  ];

  it('latency per bucket per leg; buckets with no calls omitted', () => {
    const v = buildBucketView(records, legs, 'latency_p50_ms');
    expect(v.rows.map((r) => r.bucket)).toEqual(['S', 'XL']);
    expect(v.rows[0]!.values['a--m']).toBe(500);
    expect(v.rows[1]!.values['b--m']).toBe(4000);
  });

  it('truncation counts per bucket', () => {
    const v = buildBucketView(records, legs, 'truncation_count');
    const xl = v.rows.find((r) => r.bucket === 'XL')!;
    expect(xl.values['a--m']).toBe(1);
    expect(xl.values['b--m']).toBe(0);
  });
});

// buildChallengePassGroups (#1708, Q3)
describe('buildChallengePassGroups', () => {
  const legIds = ['leg-a', 'leg-b'];

  it('returns one PassGroup per challenge agent, pass_id is C1-<agentId>', () => {
    const challengeResults = new Map([
      ['leg-a', { agents: [{ agent_id: 'app-architect', calls: 5, dnf: false, duration_ms: 3200 }] }],
      ['leg-b', { agents: [{ agent_id: 'app-architect', calls: 4, dnf: false, duration_ms: 2900 }] }],
    ]);
    const groups = buildChallengePassGroups(challengeResults, legIds);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.pass_id).toBe('C1-app-architect');
  });

  it('leg aggregate captures calls, dnf=0, latency from duration_ms', () => {
    const challengeResults = new Map([
      ['leg-a', { agents: [{ agent_id: 'app-architect', calls: 5, dnf: false, duration_ms: 3200 }] }],
      ['leg-b', { agents: [{ agent_id: 'app-architect', calls: 4, dnf: true, duration_ms: 2900 }] }],
    ]);
    const groups = buildChallengePassGroups(challengeResults, legIds);
    const agg_a = groups[0]!.legs['leg-a']!;
    const agg_b = groups[0]!.legs['leg-b']!;
    expect(agg_a.calls).toBe(5);
    expect(agg_a.dnf).toBe(0);
    expect(agg_a.latency_p50_ms).toBe(3200);
    expect(agg_b.dnf).toBe(1);
  });

  it('leg with no challenge result gets calls=0 and null latency', () => {
    const challengeResults = new Map([
      ['leg-a', { agents: [{ agent_id: 'app-architect', calls: 5, dnf: false, duration_ms: 3200 }] }],
      // leg-b has no challenge result
    ]);
    const groups = buildChallengePassGroups(challengeResults, legIds);
    const agg_b = groups[0]!.legs['leg-b']!;
    expect(agg_b.calls).toBe(0);
    expect(agg_b.latency_p50_ms).toBeNull();
  });

  it('returns empty array when no challenge results', () => {
    const groups = buildChallengePassGroups(new Map(), legIds);
    expect(groups).toHaveLength(0);
  });

  it('multiple agents produce multiple groups, sorted by agentId', () => {
    const challengeResults = new Map([
      ['leg-a', {
        agents: [
          { agent_id: 'security', calls: 3, dnf: false, duration_ms: 1000 },
          { agent_id: 'app-architect', calls: 5, dnf: false, duration_ms: 3200 },
        ],
      }],
    ]);
    const groups = buildChallengePassGroups(challengeResults, ['leg-a']);
    expect(groups.map((g) => g.pass_id)).toEqual(['C1-app-architect', 'C1-security']);
  });
});
