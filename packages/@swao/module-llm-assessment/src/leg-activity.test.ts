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

// #4470 / #4469: what counts as leg activity and what reaches the run log.

import { describe, it, expect } from 'vitest';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyLegEvent, LegLogTailer, retryReasonText, type LegActivityState } from './leg-activity.js';

describe('applyLegEvent (#4470)', () => {
  it('a heartbeat is progress only when its pass changes', () => {
    const s: LegActivityState = {};
    const hb = (pass_id: string) => applyLegEvent(s, 'l', { code: 'assessment.heartbeat', context: { pass_id } });
    expect(hb('p03').progress).toBe(true);
    expect(hb('p03').progress).toBe(false);
    expect(hb('p03').progress).toBe(false);
    expect(hb('p04').progress).toBe(true);
  });

  it('LLM attempt, waiting and ok are progress without a run-log line; ok clears the attempt', () => {
    const s: LegActivityState = { pass: '03 data' };
    expect(applyLegEvent(s, 'l', { code: 'provider.llm.anthropic.attempt', context: { attempt: 3, max_attempts: 6 } })).toEqual({ progress: true });
    expect(s.attempt).toBe(3);
    expect(applyLegEvent(s, 'l', { code: 'provider.llm.anthropic.waiting', context: {} })).toEqual({ progress: true });
    applyLegEvent(s, 'l', { code: 'provider.llm.anthropic.ok', context: {} });
    expect(s.attempt).toBeUndefined();
  });

  it('a challenge call without a pass is named by its caller', () => {
    const r = applyLegEvent({}, 'l', { code: 'provider.llm.x.retry', context: { caller: 'challenge.lz.lzca-procurement', next_attempt: 2, max_attempts: 6, reason: 'rate_limited', delay_ms: 3000 } });
    expect(r.forward?.message).toBe('leg l: challenge.lz.lzca-procurement: retry 1 of 5 after a rate limit (HTTP 429), attempt 2 of 6 in 3 s');
  });

  it('retryReasonText names the request-helper reasons', () => {
    expect(retryReasonText('timeout_idle_body')).toBe('a body timeout');
    expect(retryReasonText('something_new')).toBe('something new');
  });
});

describe('LegLogTailer', () => {
  it('reads complete lines incrementally and skips events before the run start', () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-tail-'));
    try {
      const f = join(dir, 'app-events-2026-11.ndjson');
      writeFileSync(f, JSON.stringify({ ts: '2026-11-01T00:00:00Z', code: 'old', context: {} }) + '\n');
      const t = new LegLogTailer(dir, '2026-11-16T00:00:00Z');
      expect(t.poll()).toEqual([]);
      appendFileSync(f, JSON.stringify({ ts: '2026-11-16T01:00:00Z', code: 'a', context: { n: 1 } }) + '\n{"ts":"2026-11-16T01:00:01Z","co');
      expect(t.poll().map((e) => e.code)).toEqual(['a']);
      appendFileSync(f, 'de":"b","context":{}}\n');
      expect(t.poll().map((e) => e.code)).toEqual(['b']);
      expect(t.poll()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
