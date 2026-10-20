// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * HTTP plumbing for Pass 24 RESEARCH: per-source sliding-window rate limits,
 * retry with exponential backoff on 429, and timeouts. `fetch`, `sleep`, and
 * `now` are injectable so tests run against a local mock server in
 * milliseconds. Errors never include request headers (API keys travel in
 * headers only).
 */

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** Sliding window: at most `max` calls in any `windowMs` interval. */
export class RateLimiter {
  private readonly stamps: number[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(readonly max: number, readonly windowMs: number, private readonly clock: Clock = realClock) {}

  /** Resolves when a call may proceed; calls are serialised in arrival order. */
  acquire(): Promise<void> {
    const next = this.queue.then(async () => {
      for (;;) {
        const now = this.clock.now();
        while (this.stamps.length > 0 && now - (this.stamps[0] as number) >= this.windowMs) this.stamps.shift();
        if (this.stamps.length < this.max) {
          this.stamps.push(now);
          return;
        }
        await this.clock.sleep(this.windowMs - (now - (this.stamps[0] as number)) + 1);
      }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}

export class HttpError extends Error {
  constructor(readonly status: number | null, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  limiter?: RateLimiter;
  timeoutMs?: number;
  /** Retries on HTTP 429 only (default 3); 5xx and timeouts fail fast so callers can degrade. */
  maxRetries?: number;
}

export interface HttpContext {
  fetch: FetchLike;
  clock: Clock;
  userAgent: string;
}

export async function requestText(ctx: HttpContext, url: string, opts: RequestOptions = {}): Promise<string> {
  const maxRetries = opts.maxRetries ?? 3;
  for (let attempt = 0; ; attempt++) {
    await opts.limiter?.acquire();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await ctx.fetch(url, {
        method: opts.method ?? 'GET',
        headers: { 'user-agent': ctx.userAgent, accept: 'application/json, application/rss+xml, */*', ...(opts.headers ?? {}) },
        ...(opts.body !== undefined ? { body: opts.body } : {}),
        signal: controller.signal,
      });
    } catch (e) {
      throw new HttpError(null, (e as Error).name === 'AbortError' ? `timeout after ${opts.timeoutMs ?? 20_000} ms` : `network error: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429 && attempt < maxRetries) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt;
      await ctx.clock.sleep(backoff);
      continue;
    }
    if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`);
    return res.text();
  }
}

export async function requestJson<T = unknown>(ctx: HttpContext, url: string, opts: RequestOptions = {}): Promise<T> {
  const text = await requestText(ctx, url, opts);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(null, 'invalid JSON response');
  }
}

/** Run a lookup once per key within one research run (dedupes identical queries across apps). */
export class RunCache {
  private readonly map = new Map<string, Promise<unknown>>();
  get<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (!this.map.has(key)) this.map.set(key, load());
    return this.map.get(key) as Promise<T>;
  }
}
