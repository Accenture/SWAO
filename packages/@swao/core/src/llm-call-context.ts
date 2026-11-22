// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * #4270: who an LLM call is made for. A caller (service research topic,
 * challenge agent, connectivity check) runs its LLM work inside
 * `withLlmCallContext`; the shared request helper of
 * @swao/module-llm-providers (`requestLlmWithRetry`) reads the innermost
 * context and stamps `caller` and `app_id` on every `provider.llm.*` event,
 * and adds the cost of each successful call to every enclosing context, so a
 * caller can log its own `llm_calls` and `cost_usd` (the sum over a batch then
 * equals the sum of the `provider.llm.*.ok` cost by construction).
 *
 * The context is scoped with AsyncLocalStorage, so concurrent callers (four
 * research topics of one app in parallel) never see each other's context.
 * Lives in @swao/core because the callers (service assessment, challenge)
 * do not depend on the LLM provider module.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface LlmCallContext {
  /** Dotted caller id, for example `service.research.vendor-profile`. */
  readonly caller: string;
  /** App the call is made for, when there is one. */
  readonly appId?: string;
  /** Successful LLM calls made inside this context (nested contexts included). */
  llmCalls: number;
  /** Sum of `cost_usd` of those calls. */
  costUsd: number;
  /** The enclosing context, if any. */
  readonly parent?: LlmCallContext;
}

const store = new AsyncLocalStorage<LlmCallContext>();

/**
 * Run `fn` with an LLM call context. A nested context inherits `appId` from
 * its parent when it names none. Returns `fn`'s result; the context object is
 * passed to `fn` so the caller can read its totals afterwards.
 */
export function withLlmCallContext<T>(
  scope: { caller: string; appId?: string },
  fn: (ctx: LlmCallContext) => Promise<T> | T,
): Promise<T> {
  const parent = store.getStore();
  const appId = scope.appId ?? parent?.appId;
  const ctx: LlmCallContext = {
    caller: scope.caller,
    ...(appId !== undefined ? { appId } : {}),
    llmCalls: 0,
    costUsd: 0,
    ...(parent ? { parent } : {}),
  };
  return store.run(ctx, async () => fn(ctx));
}

/** The innermost LLM call context, or undefined outside every context. */
export function currentLlmCallContext(): LlmCallContext | undefined {
  return store.getStore();
}

/** Event fields of the current context: `caller` and `app_id` (empty outside every context). */
export function llmCallContextFields(): { caller?: string; app_id?: string } {
  const ctx = store.getStore();
  if (!ctx) return {};
  return { caller: ctx.caller, ...(ctx.appId !== undefined ? { app_id: ctx.appId } : {}) };
}

/** Add one successful call and its cost to the current context and every enclosing one. */
export function recordLlmCallUsage(costUsd: unknown): void {
  const cost = typeof costUsd === 'number' && Number.isFinite(costUsd) ? costUsd : 0;
  for (let ctx = store.getStore(); ctx; ctx = ctx.parent) {
    ctx.llmCalls += 1;
    ctx.costUsd += cost;
  }
}

/** Cost rounded for a log line (six decimals, as the provider events). */
export function roundCostUsd(costUsd: number): number {
  return Math.round(costUsd * 1e6) / 1e6;
}

/**
 * #4469: attempts and back-off retries of the LLM requests made inside
 * `withLlmRetryCounter`. The shared request helper of
 * @swao/module-llm-providers bumps the innermost counter (and its parents)
 * once per attempt sent and once per retry; the LLM Assessment recorder
 * reads it after each call, so `reliability.retries` of a call record is the
 * real retry count (a call that exhausted 6 attempts has 5 retries). Kept
 * apart from LlmCallContext so the `caller` of the provider events is not
 * changed by the recorder.
 */
export interface LlmRetryCounter {
  attempts: number;
  retries: number;
  readonly parent?: LlmRetryCounter;
}

const retryStore = new AsyncLocalStorage<LlmRetryCounter>();

/** Run `fn` with a fresh retry counter; the counter is passed to `fn` and stays readable after a throw. */
export function withLlmRetryCounter<T>(fn: (counter: LlmRetryCounter) => Promise<T>): Promise<T> {
  const parent = retryStore.getStore();
  const counter: LlmRetryCounter = { attempts: 0, retries: 0, ...(parent ? { parent } : {}) };
  return retryStore.run(counter, () => fn(counter));
}

/** One attempt sent (shared request helper). */
export function recordLlmAttempt(): void {
  for (let c = retryStore.getStore(); c; c = c.parent) c.attempts += 1;
}

/** One back-off retry (shared request helper). */
export function recordLlmRetry(): void {
  for (let c = retryStore.getStore(); c; c = c.parent) c.retries += 1;
}
