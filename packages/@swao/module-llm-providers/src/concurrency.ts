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

// Provider-level LLM concurrency limiter (#3284, Design 110 D-14).
//
// The host builds a new provider instance per pass, so the limiter lives in a
// module-level registry keyed by provider + endpoint origin. Every HTTP attempt
// of every provider instance that talks to the same endpoint shares one slot
// pool, so a client gateway's rate limit is respected across all passes.
//
// The limit is configured by `providers.llm.max_concurrency` in .swao.yml
// (default 4). A gateway connector may set its own `max_concurrency`; the
// .swao.yml value wins when both are set.

/** Default number of LLM requests in flight per endpoint. */
export const DEFAULT_LLM_MAX_CONCURRENCY = 4;
/** Upper bound accepted from configuration. */
export const MAX_LLM_MAX_CONCURRENCY = 64;

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private limit: number) {}

  get max(): number { return this.limit; }
  get inFlight(): number { return this.active; }
  get queued(): number { return this.waiters.length; }

  setLimit(n: number): void {
    this.limit = n;
    this.drain();
  }

  acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => { this.active += 1; resolve(); });
    });
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    this.drain();
  }

  private drain(): void {
    while (this.active < this.limit && this.waiters.length > 0) {
      const next = this.waiters.shift();
      next?.();
    }
  }
}

const registry = new Map<string, Semaphore>();

function semaphoreFor(key: string): Semaphore {
  let s = registry.get(key);
  if (!s) {
    s = new Semaphore(DEFAULT_LLM_MAX_CONCURRENCY);
    registry.set(key, s);
  }
  return s;
}

/** Validate a configured value; undefined when absent or invalid. */
export function normaliseMaxConcurrency(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return undefined;
  if (raw < 1 || raw > MAX_LLM_MAX_CONCURRENCY) return undefined;
  return raw;
}

/** Limiter key: provider name + endpoint origin (path and query dropped). */
export function llmLimiterKey(provider: string, endpoint: string): string {
  try {
    return `${provider}|${new URL(endpoint).origin}`;
  } catch {
    return `${provider}|${endpoint}`;
  }
}

/** Set the in-flight limit for one endpoint key. */
export function setLlmConcurrencyLimit(key: string, limit: number): void {
  const n = normaliseMaxConcurrency(limit) ?? DEFAULT_LLM_MAX_CONCURRENCY;
  semaphoreFor(key).setLimit(n);
}

/**
 * Configure the limiter of a freshly built provider. `limit` is the resolved
 * configuration value (.swao.yml, then connector); absent or invalid values
 * fall back to DEFAULT_LLM_MAX_CONCURRENCY. Providers without a
 * `concurrencyKey` (fixtures, stubs) are left alone.
 */
export function applyLlmConcurrency(provider: object, limit: number | undefined): void {
  const key = (provider as { concurrencyKey?: unknown }).concurrencyKey;
  if (typeof key !== 'string' || !key) return;
  setLlmConcurrencyLimit(key, normaliseMaxConcurrency(limit) ?? DEFAULT_LLM_MAX_CONCURRENCY);
}

/** Current in-flight limit for one endpoint key (default 4). */
export function getLlmConcurrencyLimit(key: string): number {
  return registry.get(key)?.max ?? DEFAULT_LLM_MAX_CONCURRENCY;
}

/** Wait for a slot. Returns the release function and the time spent queued. */
export async function acquireLlmSlot(key: string): Promise<{ release: () => void; queuedMs: number }> {
  const s = semaphoreFor(key);
  const startedAt = Date.now();
  await s.acquire();
  let released = false;
  return {
    queuedMs: Date.now() - startedAt,
    release: () => {
      if (released) return;
      released = true;
      s.release();
    },
  };
}

/** Test hook: forget every limiter. */
export function resetLlmConcurrencyLimitersForTests(): void {
  registry.clear();
}
