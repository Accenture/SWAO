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

// Shared LLM provider request helper (#3284, Design 110 D-12 / D-13 / D-14).
//
// Lifted from the Anthropic driver (#3221 / #3225, 00880dce) so every provider
// (anthropic, openai, ollama, open-llm-provider, bedrock) and every call kind
// (text, vision, tools) shares one retry policy, one attempt count, one idle
// watchdog, one concurrency limiter and one event set:
//
//   provider.llm.<provider>.attempt | .waiting | .timeout | .http-error |
//   .retry | .ok | .error | .connectivity-failure
//
// Each provider keeps its own wire format: the helper only sees a per-attempt
// callback that performs the request with the watchdog's AbortSignal and
// returns the parsed result. Event context carries sizes, counts, status,
// latency, tokens and cost only; never the prompt text, the request body or
// image bytes (CLAUDE.md section 5.7).

import { AsyncLocalStorage } from 'node:async_hooks';
import { logPortfolio, logApp } from '@swao/core';
import { acquireLlmSlot } from './concurrency.js';

/** Loop bound for retries; every log line counts "attempt N/LLM_MAX_ATTEMPTS". */
export const LLM_MAX_RETRIES = 5;
export const LLM_MAX_ATTEMPTS = LLM_MAX_RETRIES + 1;
/**
 * Attempt limit of interactive SWAO Chat calls (#3301, Design 110 E-03):
 * 3 attempts wait at most 3 s + 6 s of back-off instead of the ~93 s of the
 * full assessment policy. Applied per call via withLlmAttemptLimit().
 */
export const LLM_CHAT_MAX_ATTEMPTS = 3;
/** Exponential backoff base: 3 s, 6 s, 12 s, 24 s, 48 s. */
export const LLM_RETRY_BASE_MS = 3000;
/** Hard cap per attempt (#1767): covers the full request including the body. */
export const LLM_TOTAL_TIMEOUT_MS = 600000;
/** Per-attempt idle timeout (#3225): headers wait and every gap between body chunks. */
export const DEFAULT_LLM_IDLE_TIMEOUT_MS = 120000;
/**
 * Non-streaming calls receive no bytes until the model has finished, so the
 * idle limit cannot apply to their headers phase. They get at least this much
 * (undici's own default headers timeout, the effective limit before #3284).
 */
export const NON_STREAMING_HEADERS_FLOOR_MS = 300000;
/** Interval of `waiting` events while an attempt is outstanding (#3225). */
export const WAITING_EVENT_INTERVAL_MS = 60000;

/**
 * Idle timeout in ms. `SWAO_LLM_IDLE_TIMEOUT_MS` is the provider-neutral name;
 * `SWAO_ANTHROPIC_IDLE_TIMEOUT_MS` (#3225) is kept as an alias (D-13).
 */
export function resolveLlmIdleTimeoutMs(): number {
  for (const name of ['SWAO_LLM_IDLE_TIMEOUT_MS', 'SWAO_ANTHROPIC_IDLE_TIMEOUT_MS']) {
    const raw = process.env[name];
    if (!raw) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return DEFAULT_LLM_IDLE_TIMEOUT_MS;
}

/** Classify an HTTP status into a short, content-free reason for event logs (#3221). */
export function classifyLlmHttpStatus(status: number): string {
  if (status === 400) return 'bad_request';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 408) return 'request_timeout';
  if (status === 413) return 'payload_too_large';
  if (status === 429) return 'rate_limited';
  if (status === 529) return 'overloaded';
  if (status >= 500) return 'server_error';
  return 'client_error';
}

/** Default transient HTTP statuses: rate limit, request timeout, server errors. */
export function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

/** Thrown when a provider exhausts every attempt on network or transient API
 *  failures. Distinct from programming errors so the pass runner can catch it
 *  and degrade gracefully instead of exiting (#0716). */
export class LlmConnectivityError extends Error {
  constructor(cause: string) {
    super(`LLM connectivity failure: all retries exhausted. Last error: ${cause}`);
    this.name = 'LlmConnectivityError';
  }
}

/** Raised by the per-attempt watchdog (#3225). Named TimeoutError so the
 *  retry policy treats it like AbortSignal.timeout(). */
export class LlmAttemptTimeoutError extends Error {
  constructor(
    readonly phase: 'headers' | 'body',
    readonly limit: 'idle' | 'total',
    readonly limitMs: number,
  ) {
    super(`LLM attempt timed out (${limit} limit ${limitMs}ms while awaiting ${phase})`);
    this.name = 'TimeoutError';
  }
}

/** A non-2xx response. Providers throw it from their attempt callback; the
 *  helper logs one http-error event and then retries or rethrows. */
export class LlmHttpStatusError extends Error {
  readonly status: number;
  /** API error body excerpt (never the request). Providers sanitise it first. */
  readonly bodyExcerpt: string;
  /** Retry with backoff when true; default from the spec's transient predicate. */
  readonly transient: boolean | undefined;
  /** The provider fixed the request (dropped a field, refreshed a token):
   *  re-send at once without consuming an attempt. */
  readonly retryNow: boolean;
  /** Error to throw instead of this one when it is final. */
  readonly throwAs: Error | undefined;
  /** Extra content-free context for the http-error event. */
  readonly context: Record<string, unknown>;

  constructor(message: string, status: number, opts?: {
    bodyExcerpt?: string;
    transient?: boolean;
    retryNow?: boolean;
    throwAs?: Error;
    context?: Record<string, unknown>;
  }) {
    super(message);
    this.name = 'LlmHttpStatusError';
    this.status = status;
    this.bodyExcerpt = (opts?.bodyExcerpt ?? '').slice(0, 500);
    this.transient = opts?.transient;
    this.retryNow = opts?.retryNow ?? false;
    this.throwAs = opts?.throwAs;
    this.context = opts?.context ?? {};
  }
}

export interface AttemptWatchdog {
  readonly signal: AbortSignal;
  /** Race any await of the attempt against this; it rejects on timeout. */
  race<T>(p: Promise<T>): Promise<T>;
  /** Record received bytes and reset the idle timer. */
  touch(bytes: number): void;
  setPhase(phase: 'headers' | 'body'): void;
  readonly bytesReceived: number;
  readonly phase: 'headers' | 'body';
  dispose(): void;
}

/**
 * Per-attempt watchdog (#3225). `headersIdleMs` is the idle limit while no
 * response headers have arrived; `idleMs` applies from the first `touch()`.
 */
export function startAttemptWatchdog(
  idleMs: number,
  totalMs: number,
  onWaiting: (state: { elapsedMs: number; msSinceData: number; phase: 'headers' | 'body'; bytes: number }) => void,
  headersIdleMs: number = idleMs,
): AttemptWatchdog {
  const controller = new AbortController();
  const startedAt = Date.now();
  let lastDataAt = startedAt;
  let bytes = 0;
  let phase: 'headers' | 'body' = 'headers';
  let rejectTimeout: (err: Error) => void = () => {};
  const timedOut = new Promise<never>((_, reject) => { rejectTimeout = reject; });
  timedOut.catch(() => { /* handled by whichever race() is pending */ });

  let disposed = false;
  const fire = (limit: 'idle' | 'total', limitMs: number): void => {
    if (disposed) return;
    const err = new LlmAttemptTimeoutError(phase, limit, limitMs);
    dispose();
    controller.abort(err);
    rejectTimeout(err);
  };
  const unref = (t: unknown): void => { (t as { unref?: () => void }).unref?.(); };
  let idleTimer: ReturnType<typeof setTimeout> = setTimeout(() => fire('idle', headersIdleMs), headersIdleMs);
  const totalTimer = setTimeout(() => fire('total', totalMs), totalMs);
  const waitingTimer = setInterval(() => {
    const now = Date.now();
    onWaiting({ elapsedMs: now - startedAt, msSinceData: now - lastDataAt, phase, bytes });
  }, WAITING_EVENT_INTERVAL_MS);
  for (const t of [idleTimer, totalTimer, waitingTimer]) unref(t);

  function dispose(): void {
    disposed = true;
    clearTimeout(idleTimer);
    clearTimeout(totalTimer);
    clearInterval(waitingTimer);
  }

  return {
    signal: controller.signal,
    race: <T>(p: Promise<T>) => Promise.race([p, timedOut]),
    touch(n: number) {
      bytes += n;
      lastDataAt = Date.now();
      if (disposed) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => fire('idle', idleMs), idleMs);
      unref(idleTimer);
    },
    setPhase(p) { phase = p; },
    get bytesReceived() { return bytes; },
    get phase() { return phase; },
    dispose,
  };
}

/** Which public entry point issued the request. */
export type LlmCallKind = 'text' | 'vision' | 'tools';

/** What a successful attempt callback returns. */
export interface LlmAttemptResult<T> {
  value: T;
  status: number;
  /** Content-free ok-event context: tokens_in, tokens_out, cost_usd, ... */
  okContext: Record<string, unknown>;
}

export interface LlmCallSpec<T> {
  /** Event code segment: provider.llm.<provider>.* */
  provider: string;
  /** Human label used in event messages, e.g. 'Anthropic'. */
  label: string;
  model: string;
  kind: LlmCallKind;
  /** Request URL (logged; never carries credentials). */
  endpoint: string;
  /** Concurrency limiter key (see concurrency.ts). */
  limiterKey: string;
  /** True when the response is streamed, so data arrives while the model works. */
  streaming: boolean;
  /** Character count of the post-redaction prompt (never the prompt itself). */
  promptChars: number;
  imageCount?: number;
  /** App id for the app-scope copy of every event. */
  appId?: string;
  /** Extra content-free context for the attempt event. */
  attemptContext?: Record<string, unknown>;
  /** Idle timeout override; default resolveLlmIdleTimeoutMs(). */
  idleTimeoutMs?: number;
  /** Transient HTTP statuses for this provider; default isTransientHttpStatus. */
  isTransientStatus?: (status: number) => boolean;
  /** Extra retryable errors (malformed or truncated responses, SDK throttling). */
  isRetryableError?: (err: Error) => boolean;
  /** Level of the http-error event for a final (non-transient) status. Default 'error'. */
  httpErrorLevel?: 'error' | 'warn';
  /** Error thrown after every attempt failed; default LlmConnectivityError. */
  exhaustedError?: (lastError: Error, attempts: number) => Error;
  /** One attempt: send the request with wd.signal, race every await through wd.race. */
  run: (wd: AttemptWatchdog) => Promise<LlmAttemptResult<T>>;
}

function isRetryableNetworkError(err: Error): boolean {
  // "fetch failed" = TCP-level failure; ECONNRESET / ETIMEDOUT = transient.
  // AbortError / TimeoutError arise from abort signals (#1086).
  // "terminated" = undici closes the response body mid-stream (#2016).
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  return err.message === 'fetch failed'
    || /ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(err.message)
    || err.message === 'terminated';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Maximum immediate re-sends (retryNow) per call; guards against loops. */
const MAX_IMMEDIATE_RESENDS = 2;

const attemptLimit = new AsyncLocalStorage<number>();

/**
 * Run `fn` with a lower attempt limit for every LLM request it issues: the
 * per-call attempt option of the shared helper. The limit is scoped to `fn`
 * (AsyncLocalStorage), so concurrent calls elsewhere keep LLM_MAX_ATTEMPTS;
 * nothing global changes. Only for interactive or probing callers that must
 * answer quickly: the health-check live ping keeps its historical 4 attempts
 * inside its 35 s ceiling, SWAO Chat uses LLM_CHAT_MAX_ATTEMPTS (#3301).
 * Assessment calls always use LLM_MAX_ATTEMPTS. Event lines then count
 * "attempt N/<limit>". Values are clamped to 1..LLM_MAX_ATTEMPTS.
 */
export function withLlmAttemptLimit<T>(maxAttempts: number, fn: () => Promise<T>): Promise<T> {
  const n = Math.max(1, Math.min(LLM_MAX_ATTEMPTS, Math.floor(maxAttempts)));
  return attemptLimit.run(n, fn);
}

/**
 * Run one LLM request with the shared retry policy, idle watchdog,
 * concurrency limiter and event set.
 */
export async function requestLlmWithRetry<T>(spec: LlmCallSpec<T>): Promise<T> {
  const { provider, label, model, kind, appId } = spec;
  const code = (suffix: string): string => `provider.llm.${provider}.${suffix}`;
  const kindCtx: Record<string, unknown> = kind === 'vision'
    ? { kind, image_count: spec.imageCount ?? 0 }
    : { kind };
  const kindLabel = kind === 'vision' ? ' vision' : kind === 'tools' ? ' tool-call' : '';
  const idleMs = spec.idleTimeoutMs ?? resolveLlmIdleTimeoutMs();
  const headersIdleMs = spec.streaming ? idleMs : Math.max(idleMs, NON_STREAMING_HEADERS_FLOOR_MS);
  const transientStatus = spec.isTransientStatus ?? isTransientHttpStatus;
  const base = { provider, model, ...kindCtx };
  // One count per call: LLM_MAX_ATTEMPTS unless a probe lowered it.
  const maxAttempts = attemptLimit.getStore() ?? LLM_MAX_ATTEMPTS;

  // Every event goes to the portfolio log and, in an app context, to the app
  // log too (#2002 / #3284). App-scope http-error stays at warn (#1896).
  const emit = (level: 'info' | 'warn' | 'error', suffix: string, msg: string, ctx: Record<string, unknown>): void => {
    logPortfolio(level, code(suffix), msg, { context: ctx });
    if (appId) {
      const appLevel = suffix === 'http-error' && level === 'error' ? 'warn' : level;
      // mirror: false -- the portfolio copy already printed it on the console.
      logApp(appId, appLevel, code(suffix), msg, { context: ctx, mirror: false });
    }
  };

  let lastError: Error = new Error('unreachable');
  let lastReason = 'unknown';
  let immediateResends = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delayMs = LLM_RETRY_BASE_MS * Math.pow(2, attempt - 1);
      // #1088: include the actual error so network failures are visible without
      // --debug. #3225: `attempt` is the 1-based number of the attempt that just
      // failed; the denominator is LLM_MAX_ATTEMPTS everywhere.
      const causeStr = (lastError.cause instanceof Error)
        ? ` (cause: ${lastError.cause.message})`
        : (lastError.cause ? ` (cause: ${String(lastError.cause)})` : '');
      emit('warn', 'retry',
        `${label}${kindLabel} attempt ${attempt}/${maxAttempts} failed (${lastError.message}${causeStr}), retrying in ${delayMs / 1000}s as attempt ${attempt + 1}/${maxAttempts}`,
        { ...base, attempt, next_attempt: attempt + 1, max_attempts: maxAttempts, reason: lastReason, delay_ms: delayMs });
      await sleep(delayMs);
    }

    // #3284 / D-14: wait for a slot before the attempt is sent; the queue wait
    // never counts against the idle watchdog.
    const slot = await acquireLlmSlot(spec.limiterKey);
    const attemptNo = attempt + 1;
    const attemptStartedAt = Date.now();
    emit('info', 'attempt', `${label} ${model}${kindLabel} call attempt ${attemptNo}/${maxAttempts}`, {
      ...base,
      endpoint: spec.endpoint,
      attempt: attemptNo,
      max_attempts: maxAttempts,
      prompt_chars: spec.promptChars,
      idle_timeout_ms: idleMs,
      queued_ms: slot.queuedMs,
      ...(spec.attemptContext ?? {}),
    });

    const wd = startAttemptWatchdog(idleMs, LLM_TOTAL_TIMEOUT_MS, (st) => {
      // A non-streaming call is expected to be silent until it finishes.
      const expectSilence = !spec.streaming && st.phase === 'headers';
      const stalled = !expectSilence && st.msSinceData >= WAITING_EVENT_INTERVAL_MS;
      emit(stalled ? 'warn' : 'info', 'waiting',
        `${label} ${model}${kindLabel} attempt ${attemptNo}/${maxAttempts} still waiting after ${st.elapsedMs}ms (${st.phase}, ${st.msSinceData}ms since last data)`,
        {
          ...base, attempt: attemptNo, max_attempts: maxAttempts,
          phase: st.phase, elapsed_ms: st.elapsedMs, ms_since_data: st.msSinceData,
          bytes_received: st.bytes, idle_timeout_ms: idleMs, streaming: spec.streaming,
        });
    }, headersIdleMs);

    try {
      const result = await spec.run(wd);
      const latencyMs = Date.now() - attemptStartedAt;
      emit('info', 'ok', `${label} ${model}${kindLabel} -> ${result.status} in ${latencyMs}ms`, {
        ...base,
        attempt: attemptNo,
        max_attempts: maxAttempts,
        http_status: result.status,
        latency_ms: latencyMs,
        ...result.okContext,
      });
      return result.value;
    } catch (caught) {
      const err = caught instanceof Error ? caught : new Error(String(caught));
      const latencyMs = Date.now() - attemptStartedAt;

      if (err instanceof LlmHttpStatusError) {
        const reason = classifyLlmHttpStatus(err.status);
        const transient = err.transient ?? transientStatus(err.status);
        const level = transient || err.retryNow ? 'warn' : (spec.httpErrorLevel ?? 'error');
        emit(level, 'http-error',
          `${label}${kindLabel} HTTP ${err.status} (${reason}) on attempt ${attemptNo}/${maxAttempts}`, {
            ...base, attempt: attemptNo, max_attempts: maxAttempts,
            http_status: err.status, reason, latency_ms: latencyMs,
            body_excerpt: err.bodyExcerpt, transient, retry_now: err.retryNow,
            ...err.context,
          });
        if (err.retryNow && immediateResends < MAX_IMMEDIATE_RESENDS) {
          immediateResends += 1;
          attempt--; // the provider fixed the request; do not consume an attempt
          continue;
        }
        if (!transient) throw err.throwAs ?? err;
        lastError = err;
        lastReason = reason;
        continue;
      }

      if (err instanceof LlmAttemptTimeoutError) {
        // #3225: name the stall before the retry event fires.
        emit('warn', 'timeout',
          `${label} ${model}${kindLabel} attempt ${attemptNo}/${maxAttempts} timed out after ${latencyMs}ms (${err.limit} limit ${err.limitMs}ms, awaiting ${err.phase})`, {
            ...base, attempt: attemptNo, max_attempts: maxAttempts,
            phase: err.phase, limit: err.limit, limit_ms: err.limitMs,
            elapsed_ms: latencyMs, bytes_received: wd.bytesReceived,
          });
        lastError = err;
        lastReason = `timeout_${err.limit}_${err.phase}`;
        continue;
      }

      const retryable = isRetryableNetworkError(err) || (spec.isRetryableError?.(err) ?? false);
      if (!retryable) {
        // #3221: every non-retryable failure leaves an error-level event.
        emit('error', 'error',
          `${label} ${model}${kindLabel} attempt ${attemptNo}/${maxAttempts} failed: ${err.name}`, {
            ...base, attempt: attemptNo, max_attempts: maxAttempts,
            reason: 'non_retryable', error_name: err.name,
            error_message: err.message.slice(0, 300), latency_ms: latencyMs,
          });
        throw caught;
      }
      lastError = err;
      lastReason = 'network_or_malformed_response';
    } finally {
      wd.dispose();
      slot.release();
    }
  }

  emit('error', 'connectivity-failure',
    `All ${maxAttempts} ${label}${kindLabel} attempts exhausted for model ${model}.`, {
      ...base, max_attempts: maxAttempts, reason: lastReason, last_error: lastError.message.slice(0, 300),
    });
  throw spec.exhaustedError ? spec.exhaustedError(lastError, maxAttempts) : new LlmConnectivityError(lastError.message);
}
