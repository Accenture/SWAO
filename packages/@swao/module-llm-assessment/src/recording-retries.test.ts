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

// #4469: reliability.retries of a call record is the real retry count of the
// call (the shared request helper counts attempts and retries through the
// @swao/core retry counter); before, it was the successful-call delta and
// read 0 after six attempts.
// #4476: each call record names the model the provider actually called.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordLlmAttempt, recordLlmRetry } from '@swao/core';
import { createRecordingProvider, callRetries, type UsageSnapshot } from './recording-provider.js';
import { createLegRecorderFromEnv, LEG_ENV } from './leg-recorder.js';
import { CallRecordSchema, type CallRecord } from './call-record.js';

const zero: UsageSnapshot = { input_tokens: 0, output_tokens: 0, cost_usd: 0, call_count: 0 };

function recorder(inner: { complete(p: string): Promise<string> }, out: CallRecord[]) {
  return createRecordingProvider(inner, {
    leg: { id: 'or--slow', connector: 'openrouter', model: 'slow/model' },
    usageSnapshot: () => zero,
    costSource: 'billed',
    currentContext: () => ({ passId: '03-data', callSite: 'data_classification' }),
    onRecord: (r) => out.push(r),
  });
}

describe('call record retries (#4469)', () => {
  it('a call that times out twice and then answers records retries 2', async () => {
    const out: CallRecord[] = [];
    const inner = {
      async complete(): Promise<string> {
        // What requestLlmWithRetry does: attempt, retry, attempt, retry, attempt, ok.
        recordLlmAttempt(); recordLlmRetry();
        recordLlmAttempt(); recordLlmRetry();
        recordLlmAttempt();
        return '{"ok":true}';
      },
    };
    await recorder(inner, out).complete('p');
    expect(out).toHaveLength(1);
    expect(out[0]!.reliability.retries).toBe(2);
    expect(out[0]!.reliability.dnf).toBe(false);
  });

  it('an exhausted call records retries = attempts - 1 (6 attempts, 5 retries)', async () => {
    const out: CallRecord[] = [];
    const inner = {
      async complete(): Promise<string> {
        for (let i = 0; i < 6; i++) { recordLlmAttempt(); if (i < 5) recordLlmRetry(); }
        throw new Error('LLM connectivity failure: all retries exhausted. Last error: open-llm-provider: network error after 6 attempts: LLM attempt timed out');
      },
    };
    await expect(recorder(inner, out).complete('p')).rejects.toThrow(/after 6 attempts/);
    expect(out[0]!.reliability.retries).toBe(5);
    expect(out[0]!.reliability.dnf).toBe(true);
  });

  it('concurrent calls keep their own counts', async () => {
    const out: CallRecord[] = [];
    let n = 0;
    const inner = {
      async complete(): Promise<string> {
        const mine = n++;
        recordLlmAttempt();
        if (mine === 0) { recordLlmRetry(); await new Promise((r) => setTimeout(r, 5)); recordLlmAttempt(); }
        return 'x';
      },
    };
    const rp = recorder(inner, out);
    await Promise.all([rp.complete('a'), rp.complete('b')]);
    expect(out.map((r) => r.reliability.retries).sort()).toEqual([0, 1]);
  });

  it('callRetries falls back to the error text, then to the success delta', () => {
    expect(callRetries(undefined, 0, new Error('HTTP 503 after 4 attempts: x'))).toBe(3);
    expect(callRetries(undefined, 3)).toBe(2);
    expect(callRetries({ attempts: 2, retries: 1 }, 0)).toBe(1);
  });
});

describe('model_called (#4476)', () => {
  it('the leg recorder records the model of the wrapped provider next to leg.model', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swao-legrec-4476-'));
    try {
      const sink = join(dir, 'calls.ndjson');
      const rec = createLegRecorderFromEnv({
        [LEG_ENV.RECORD]: sink, [LEG_ENV.LEG_ID]: 'openrouter--anthropic_claude-haiku-5.5',
        [LEG_ENV.CONNECTOR]: 'openrouter', [LEG_ENV.MODEL]: 'anthropic/claude-haiku-5.5',
      })!;
      rec.setPass('challenge-lz-lzca-procurement', 'challenge');
      const wrapped = rec.wrap({ name: 'open-llm-provider', model: 'anthropic/claude-haiku-5.5', complete: async () => 'ok' }, () => zero);
      await wrapped.complete('p');
      const record = CallRecordSchema.parse(JSON.parse(readFileSync(sink, 'utf-8').trim()));
      expect(record.leg.model).toBe('anthropic/claude-haiku-5.5');
      expect(record.model_called).toBe('anthropic/claude-haiku-5.5');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
