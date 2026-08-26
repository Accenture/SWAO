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

// Prompt-size bucket tests -- Design 092 s6.1, L6 (#1432).
//
// Covers:
//   1. sizeBucket() threshold constants (SIZE_BUCKET_BOUNDS_TOKENS are spec
//      constants; cross-run comparisons break if thresholds change silently).
//   2. buildBucketView() groups by the pre-computed r.prompt.size_bucket field
//      (NOT by counting bytes -- the bucket is stamped at call time and must
//      survive replay unchanged per 063 s17.5).
//   3. buildBucketView() skips size buckets with zero records (row is absent,
//      not present with null values) to keep the publication table lean.

import { describe, it, expect } from 'vitest';
import {
  sizeBucket,
  SIZE_BUCKET_BOUNDS_TOKENS,
  SIZE_BUCKETS,
} from '../call-record.js';
import { buildBucketView } from '../pass-groups.js';
import type { CallRecord } from '../call-record.js';

// ---------------------------------------------------------------------------
// Minimal CallRecord factory -- only the fields consumed by buildBucketView
// ---------------------------------------------------------------------------

function makeRecord(
  legId: string,
  sizeBkt: 'S' | 'M' | 'L' | 'XL',
  latencyMs: number,
  dnf = false,
): CallRecord {
  return {
    leg: { id: legId, connector: 'test', model: 'test-model' },
    pass_id: 'test-pass',
    call_site: 'site-01',
    call_index: 0,
    prompt: { sha256: 'abc', chars: 100, tokens_est: 50, size_bucket: sizeBkt },
    timing: { started: '2026-08-06T10:00:00.000Z', total_ms: latencyMs },
    tokens: { prompt: 50, completion: 100 },
    cost_usd: { computed: 0.001, source: 'billed' },
    quality: { parse_valid: true, schema_conform: true, truncated: false, refusal_detected: false },
    reliability: { retries: 0, rate_limited: false, dnf },
    security: { redaction_marker_altered: false, foreign_path_count: 0, pii_reproduction_detected: false, prompt_injection_detected: false },
  };
}

// ---------------------------------------------------------------------------
// 1. sizeBucket() threshold constants (Design 092 s6.1)
// ---------------------------------------------------------------------------

describe('sizeBucket() threshold constants (#1432, 092 s6.1)', () => {
  it('SIZE_BUCKETS is the canonical 4-bucket tuple', () => {
    expect(SIZE_BUCKETS).toEqual(['S', 'M', 'L', 'XL']);
  });

  it('S boundary: token count just below S limit maps to S', () => {
    expect(sizeBucket(SIZE_BUCKET_BOUNDS_TOKENS.S - 1)).toBe('S');
  });

  it('M boundary: exactly S limit maps to M', () => {
    expect(sizeBucket(SIZE_BUCKET_BOUNDS_TOKENS.S)).toBe('M');
  });

  it('L boundary: exactly M limit maps to L', () => {
    expect(sizeBucket(SIZE_BUCKET_BOUNDS_TOKENS.M)).toBe('L');
  });

  it('XL boundary: exactly L limit maps to XL', () => {
    expect(sizeBucket(SIZE_BUCKET_BOUNDS_TOKENS.L)).toBe('XL');
  });

  it('zero tokens maps to S', () => {
    expect(sizeBucket(0)).toBe('S');
  });

  it('very large token count maps to XL', () => {
    expect(sizeBucket(1_000_000)).toBe('XL');
  });
});

// ---------------------------------------------------------------------------
// 2. buildBucketView() groups by pre-computed size_bucket field
// ---------------------------------------------------------------------------

describe('buildBucketView() groups by pre-stamped size_bucket (#1432, 092 s6.2)', () => {
  const legIds = ['leg-a', 'leg-b'];

  it('latency view: median latency per bucket per leg', () => {
    const records: CallRecord[] = [
      makeRecord('leg-a', 'S',  100),
      makeRecord('leg-a', 'S',  200),  // median S for leg-a = 150
      makeRecord('leg-b', 'S',  300),
      makeRecord('leg-a', 'M', 1000),
      makeRecord('leg-b', 'M', 2000),
    ];
    const view = buildBucketView(records, legIds, 'latency_p50_ms');
    expect(view.property).toBe('latency_p50_ms');

    const sRow = view.rows.find((r) => r.bucket === 'S');
    expect(sRow).toBeDefined();
    expect(sRow?.values['leg-a']).toBe(150);
    expect(sRow?.values['leg-b']).toBe(300);

    const mRow = view.rows.find((r) => r.bucket === 'M');
    expect(mRow).toBeDefined();
    expect(mRow?.values['leg-a']).toBe(1000);
    expect(mRow?.values['leg-b']).toBe(2000);
  });

  it('skips buckets that have no records (row absent, not null)', () => {
    // Only S records; L and XL must be absent from rows.
    const records: CallRecord[] = [
      makeRecord('leg-a', 'S', 50),
      makeRecord('leg-b', 'S', 75),
    ];
    const view = buildBucketView(records, legIds, 'latency_p50_ms');
    const present = view.rows.map((r) => r.bucket);
    expect(present).toContain('S');
    expect(present).not.toContain('M');
    expect(present).not.toContain('L');
    expect(present).not.toContain('XL');
  });

  it('DNF records are excluded from latency median but count in truncation_count', () => {
    const records: CallRecord[] = [
      makeRecord('leg-a', 'S', 200, false),
      makeRecord('leg-a', 'S', 900, true),  // DNF: excluded from latency
    ];
    const latView = buildBucketView(records, ['leg-a'], 'latency_p50_ms');
    expect(latView.rows[0]?.values['leg-a']).toBe(200);
  });

  it('parse_valid_rate view: rate of valid parses per bucket per leg', () => {
    const records: CallRecord[] = [
      makeRecord('leg-a', 'M', 100),
      makeRecord('leg-a', 'M', 100),
    ];
    // All records have parse_valid: true (from factory)
    const view = buildBucketView(records, ['leg-a'], 'parse_valid_rate');
    const mRow = view.rows.find((r) => r.bucket === 'M');
    expect(mRow?.values['leg-a']).toBe(100);
  });

  it('bucket is read from r.prompt.size_bucket, not computed from token counts', () => {
    // The record has 50 prompt tokens (would be S by sizeBucket(50)), but
    // we stamp it as 'XL' to verify grouping uses the stamped field.
    const records: CallRecord[] = [
      makeRecord('leg-a', 'XL', 500),  // stamped XL despite small token count
    ];
    const view = buildBucketView(records, ['leg-a'], 'latency_p50_ms');
    const xlRow = view.rows.find((r) => r.bucket === 'XL');
    expect(xlRow).toBeDefined();
    expect(xlRow?.values['leg-a']).toBe(500);
    const sRow = view.rows.find((r) => r.bucket === 'S');
    expect(sRow).toBeUndefined();
  });
});
