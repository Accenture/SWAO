// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import type { LlmProvider, LlmUsage, LlmTrace, LlmCompletion } from './types.js';
import { completeWithUsage, completeVisionWithUsage } from './completion.js';

export interface AccumulatedUsage {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  call_count: number;
}

const ZERO: AccumulatedUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cost_usd: 0,
  call_count: 0,
};

/**
 * Wrap an `LlmProvider` to accumulate token + cost usage across every
 * `complete()` call. The wrapper passes calls through transparently;
 * the assess loop reads the running totals after each pass and resets
 * the tracker for the next one.
 *
 * #3301: usage is read from each call's own result (`*Detailed()`), so
 * concurrent calls (Pass 11) are attributed correctly. Providers without
 * the detailed methods fall back to the deprecated `getLastUsage()`;
 * providers that surface no usage at all are tolerated -- call_count
 * still increments; tokens / cost stay at zero.
 */
export class UsageTrackingLlmProvider implements LlmProvider {
  private readonly inner: LlmProvider;
  private acc: AccumulatedUsage = { ...ZERO };
  /** Trace of the first call SENT in the current pass session (#1709, #3284).
   *  Under concurrency (Pass 11) calls finish out of order; the sample is the
   *  successful call with the lowest send sequence, not the first to finish. */
  private _firstTrace: LlmTrace | undefined;
  /** Send sequence of the call that produced _firstTrace. */
  private _firstTraceSeq = Number.POSITIVE_INFINITY;
  /** Next send sequence number in this session. */
  private _sendSeq = 0;
  /** Bumped by reset() so calls still in flight from a previous session are ignored. */
  private _session = 0;
  /** Forwarded when the inner provider supports vision (#1997). */
  completeVision?: (prompt: string, images: Buffer[]) => Promise<string>;
  /** completeVision() with the call's own usage (#3301); set with completeVision. */
  completeVisionDetailed?: (prompt: string, images: Buffer[]) => Promise<LlmCompletion>;

  // Forward name + model from the wrapped provider so callers reading
  // `tracking.model` after pass execution see the right value (#0217).
  get name() { return this.inner.name; }
  get model() { return this.inner.model; }
  /** #3284: forward the provider's in-flight limit (Pass 11 fan-out width). */
  get maxConcurrency(): number | undefined { return this.inner.maxConcurrency; }

  constructor(inner: LlmProvider) {
    this.inner = inner;
    if (inner.completeVision) {
      this.completeVisionDetailed = async (prompt: string, images: Buffer[]): Promise<LlmCompletion> => {
        const result = await completeVisionWithUsage(inner, prompt, images);
        this.accumulate(result.usage);
        return result;
      };
      this.completeVision = async (prompt: string, images: Buffer[]): Promise<string> =>
        (await this.completeVisionDetailed!(prompt, images)).text;
    }
  }

  private accumulate(usage: LlmUsage | undefined): void {
    this.acc.call_count += 1;
    if (usage) {
      this.acc.input_tokens += usage.input_tokens;
      this.acc.output_tokens += usage.output_tokens;
      this.acc.cost_usd += usage.cost_usd ?? 0;
    }
  }

  async complete(prompt: string): Promise<string> {
    return (await this.completeDetailed(prompt)).text;
  }

  /** complete() with the call's own usage and trace (#3301). */
  async completeDetailed(prompt: string): Promise<LlmCompletion> {
    const seq = this._sendSeq++;
    const session = this._session;
    const result = await completeWithUsage(this.inner, prompt);
    this.accumulate(result.usage);
    // #1709: capture the first call's trace (representative sample per pass).
    // #3284: "first" means first SENT. A later-sent call that finished earlier
    // is replaced once an earlier-sent call succeeds. #3301: the trace comes
    // from this call's own result (the fallback accepts the shared last trace
    // only when it belongs to this call).
    if (session === this._session && seq < this._firstTraceSeq && result.trace) {
      this._firstTrace = result.trace;
      this._firstTraceSeq = seq;
    }
    return result;
  }

  /** @deprecated #3301: shared state; read `usage` from completeDetailed(). */
  getLastUsage(): LlmUsage | undefined {
    return this.inner.getLastUsage?.();
  }

  getLastTrace(): LlmTrace | undefined {
    return this.inner.getLastTrace?.();
  }

  /** First-call trace captured during this pass session (#1709). */
  getFirstTrace(): LlmTrace | undefined {
    return this._firstTrace;
  }

  /** Snapshot the accumulator without resetting. */
  snapshot(): AccumulatedUsage {
    return { ...this.acc };
  }

  /** Reset for the next pass. */
  reset(): void {
    this.acc = { ...ZERO };
    this._firstTrace = undefined;
    this._firstTraceSeq = Number.POSITIVE_INFINITY;
    this._sendSeq = 0;
    this._session += 1;
  }
}

export function mergeUsage(a: AccumulatedUsage, b: AccumulatedUsage): AccumulatedUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cost_usd: a.cost_usd + b.cost_usd,
    call_count: a.call_count + b.call_count,
  };
}
