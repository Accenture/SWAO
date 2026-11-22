// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Landing zone module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3751 / #3804: one throttling rule for every live driver (Design 121
// section 8.2 `throttled`: "429 with Retry-After, then success; retry
// honoured, run complete"). A 429 answer is retried after the time the CSP
// asks for, bounded:
// - `Retry-After` as delay-seconds or as an HTTP-date (RFC 9110 section
//   10.2.3); without the header the wait doubles from 1 s;
// - at most MAX_RETRIES retries per request, a single wait of at most
//   MAX_WAIT_S and at most MAX_TOTAL_WAIT_S of waiting per request;
// - a 429 that asks for longer than the caps is returned as it is, so the
//   driver records the source as not collected with HTTP 429, never a wait
//   without end.
// A 503 is retried the same way only when it carries `Retry-After` (RFC 9110
// section 15.6.4: the expected length of the outage); a 503 without the
// header stays a per-source failure (Design 121 section 8.2 `partial-outage`).
// Only these statuses are handled here. Protocol-specific throttling inside a
// 200 or 400 body (AWS `ThrottlingException`) stays with the driver
// (aws-client.ts). The request is resent unchanged (same method, headers and
// body; every request a driver sends is a read or an allow-listed token
// request, so a resend changes nothing in the tenant).

import type { FetchLike } from './types.js';

export const MAX_RETRIES = 3;
export const MAX_WAIT_S = 30;
export const MAX_TOTAL_WAIT_S = 60;
const DEFAULT_WAIT_S = 1;

let sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Test seam: replace the wait (milliseconds). */
export function setThrottleSleepForTests(fn: ((ms: number) => Promise<void>) | undefined): void {
  sleep = fn ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
}

/**
 * Seconds to wait from a `Retry-After` value: delay-seconds (digits only) or
 * an HTTP-date; a date in the past is 0. Undefined when absent or unreadable.
 */
export function retryAfterSeconds(value: string | null | undefined, nowMs: number = Date.now()): number | undefined {
  if (value === null || value === undefined) return undefined;
  const v = value.trim();
  if (/^\d{1,10}$/.test(v)) return Number(v);
  // An HTTP-date names a weekday and a GMT time; a bare number or other text is not one.
  if (!/^[A-Za-z]{3},/.test(v)) return undefined;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return undefined;
  return Math.max(0, Math.ceil((t - nowMs) / 1000));
}

export interface ThrottleRetryOptions {
  maxRetries?: number;
  maxWaitS?: number;
  maxTotalWaitS?: number;
  /** Called before each wait (logging; never gets a URL). */
  onRetry?: (info: { attempt: number; waitS: number; method: string; status: number }) => void;
}

/** Wrap a transport so a 429 (or a 503 with `Retry-After`) is retried after its `Retry-After`, within the caps. */
export function createThrottleRetryFetch(inner: FetchLike, opts: ThrottleRetryOptions = {}): FetchLike {
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  const maxWaitS = opts.maxWaitS ?? MAX_WAIT_S;
  const maxTotalWaitS = opts.maxTotalWaitS ?? MAX_TOTAL_WAIT_S;
  return async (url, init) => {
    let waited = 0;
    for (let attempt = 0; ; attempt++) {
      const res = await inner(url, init);
      if ((res.status !== 429 && res.status !== 503) || attempt >= maxRetries) return res;
      const asked = retryAfterSeconds(res.headers.get('retry-after'));
      if (res.status === 503 && asked === undefined) return res;
      const waitS = asked ?? DEFAULT_WAIT_S * 2 ** attempt;
      if (waitS > maxWaitS || waited + waitS > maxTotalWaitS) return res;
      // Drain the refused body so the connection is released before the resend.
      await res.text().catch(() => '');
      opts.onRetry?.({ attempt: attempt + 1, waitS, method: (init?.method ?? 'GET').toUpperCase(), status: res.status });
      await sleep(waitS * 1000);
      waited += waitS;
    }
  };
}
