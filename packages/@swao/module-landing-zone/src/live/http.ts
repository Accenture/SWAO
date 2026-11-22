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

// #3571: the structural read-only guarantee (Design 120 section 6.3, owner
// decision 2026-11-02). Every driver request passes through this wrapper,
// which refuses anything that is not a read before it is sent, whatever the
// credential allows and whatever per-run flag was passed: GET and HEAD are
// allowed, any other method only when a rule of the driver's allow-list
// matches the path, and only https URLs are sent (Design 121 section 7.2).

//
// #3750 / #3803: the same wrapper makes every driver fail fast on a refused
// token (Design 120 section 6.2, Design 121 section 8.2 `expired-token`). A
// 401 answer to a read (GET / HEAD) means the access token expired or was
// revoked mid-run; it is never a per-source gap. The wrapper throws a
// `LiveTokenRejectedError` (a `LiveAuthError`) and records it in the scope's
// `AuthFailureLatch`, so a driver that catches every error of a source (otc
// records `not_collected` or `unverifiable`) still stops at the next method
// boundary of the scan (scan.ts, session.ts). Token requests are allow-listed
// non-reads and keep their own driver message (wrong key, wrong password).
// The message names the route template, never the request path (ids).

import { LiveAuthError } from './errors.js';
import type { FetchLike, ReadAllowRule } from './types.js';

export class ReadOnlyViolationError extends Error {
  readonly exitCode = 1;
  constructor(readonly provider: string, readonly method: string, readonly path: string, why: string) {
    super(`[lz live] ${provider}: request refused before sending (${method} ${path}): ${why}. SWAO only reads from a landing zone.`);
    this.name = 'ReadOnlyViolationError';
  }
}

const READ_METHODS = new Set(['GET', 'HEAD']);

/** A 401 on a read: the access token was refused mid-run. Stops the run (exit 1). */
export class LiveTokenRejectedError extends LiveAuthError {
  readonly tokenRejected = true;
  constructor(provider: string, readonly route: string) {
    super(provider, 401, `the access token was refused on ${route} (expired or revoked during the run); the run stops instead of recording the remaining sources as not collected. Run again for a new token`);
    this.name = 'LiveAuthError';
  }
}

/** First refused token of a scope run; the scan checks it between driver methods. */
export class AuthFailureLatch {
  private first: LiveTokenRejectedError | undefined;

  record(err: LiveTokenRejectedError): void {
    this.first ??= err;
  }

  get failure(): LiveTokenRejectedError | undefined {
    return this.first;
  }

  /** Throw the recorded refusal, if any. */
  throwIfFailed(): void {
    if (this.first !== undefined) throw this.first;
  }
}

export interface ReadOnlyFetchOptions {
  /** Records a refused token so the scan stops even when a driver swallows the error. */
  latch?: AuthFailureLatch;
  /** Route template of a request path (record.ts routeOf), for the error message. */
  routeOf?: (path: string) => string;
}

export function createReadOnlyFetch(inner: FetchLike, provider: string, allowList: readonly ReadAllowRule[], opts: ReadOnlyFetchOptions = {}): FetchLike {
  return async (url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ReadOnlyViolationError(provider, method, '(unparseable URL)', 'not a URL');
    }
    if (parsed.protocol !== 'https:') {
      throw new ReadOnlyViolationError(provider, method, parsed.pathname, 'only https is allowed');
    }
    if (!READ_METHODS.has(method)) {
      const rule = allowList.find((r) => r.method === method && r.path.test(parsed.pathname));
      if (!rule) throw new ReadOnlyViolationError(provider, method, parsed.pathname, `${method} is not on the read allow-list of the ${provider} driver`);
    }
    const res = await inner(url, init);
    if (res.status === 401 && READ_METHODS.has(method)) {
      const err = new LiveTokenRejectedError(provider, `${method} ${opts.routeOf?.(parsed.pathname) ?? 'a read request'}`);
      opts.latch?.record(err);
      throw err;
    }
    return res;
  };
}
