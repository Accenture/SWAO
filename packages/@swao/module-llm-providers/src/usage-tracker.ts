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

import type { LlmProvider, LlmUsage, LlmTrace } from './types.js';

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
 * Providers that don't implement `getLastUsage()` are tolerated --
 * call_count still increments; tokens / cost stay at zero.
 */
export class UsageTrackingLlmProvider implements LlmProvider {
  private readonly inner: LlmProvider;
  private acc: AccumulatedUsage = { ...ZERO };
  /** First-call trace for the current pass session. Set once; reset in reset(). */
  private _firstTrace: LlmTrace | undefined;
  /** Forwarded when the inner provider supports vision (#1997). */
  completeVision?: (prompt: string, images: Buffer[]) => Promise<string>;

  // Forward name + model from the wrapped provider so callers reading
  // `tracking.model` after pass execution see the right value (#0217).
  get name() { return this.inner.name; }
  get model() { return this.inner.model; }

  constructor(inner: LlmProvider) {
    this.inner = inner;
    if (inner.completeVision) {
      this.completeVision = async (prompt: string, images: Buffer[]): Promise<string> => {
        const text = await inner.completeVision!(prompt, images);
        const usage = inner.getLastUsage?.();
        this.acc.call_count += 1;
        if (usage) {
          this.acc.input_tokens += usage.input_tokens;
          this.acc.output_tokens += usage.output_tokens;
          this.acc.cost_usd += usage.cost_usd ?? 0;
        }
        return text;
      };
    }
  }

  async complete(prompt: string): Promise<string> {
    const text = await this.inner.complete(prompt);
    const usage = this.inner.getLastUsage?.();
    this.acc.call_count += 1;
    if (usage) {
      this.acc.input_tokens += usage.input_tokens;
      this.acc.output_tokens += usage.output_tokens;
      this.acc.cost_usd += usage.cost_usd ?? 0;
    }
    // #1709: capture the first call's trace (representative sample per pass).
    if (!this._firstTrace) {
      const t = this.inner.getLastTrace?.();
      if (t) this._firstTrace = t;
    }
    return text;
  }

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
