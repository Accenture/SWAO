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

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { LlmProvider, LlmUsage } from './types.js';

interface CacheEntry {
  model: string;
  prompt_sha256: string;
  cached_at: string;
  response: string;
}

/**
 * LlmCacheLayer wraps any real LlmProvider and caches responses on disk.
 *
 * Cache key: sha256(prompt + ':' + model)
 * Storage: wsp/cache/llm/<model-slug>/<sha256>.json
 *
 * The cache is workspace-local (wsp/cache/ is gitignored -- client data must
 * not be committed). A cache hit replays the stored response without calling
 * the real LLM and records cost_usd = 0.
 *
 * Use wasCacheHit() after complete() to check whether the last call was served
 * from cache. assess.ts reads this to populate data_source.cassette_hit and
 * the run-manifest provenance.cassette_hits list.
 *
 * Bypass: pass --no-cache to swao assess, or use the stub provider (the stub
 * and cache are mutually exclusive -- stub always bypasses).
 */
export class LlmCacheLayer implements LlmProvider {
  private readonly inner: LlmProvider;
  private readonly cacheDir: string;
  private readonly maxAgeDays: number;
  private _lastCacheHit = false;

  private readonly useFixtureFallback: boolean;
  private readonly fixtureCassettesDir: string | undefined;

  /**
   * @param fixtureCassettesDir Directory of committed fixture cassettes for
   *   CI/offline replay (`<dir>/<model-slug>/<sha256>.json`). The host injects
   *   its packaged path (`src/passes/fixtures/cassettes`, snapshotted into the
   *   binary via pkg.assets); this module owns no fixture assets of its own.
   *   When omitted, the fixture fallback is disabled (workspace cache only).
   */
  constructor(
    inner: LlmProvider,
    workspaceAppDir: string,
    maxAgeDays = 30,
    useFixtureFallback = true,
    fixtureCassettesDir?: string,
  ) {
    this.inner = inner;
    const modelSlug = inner.model.replace(/[^a-zA-Z0-9-]/g, '-');
    this.cacheDir = join(workspaceAppDir, 'wsp', 'cache', 'llm', modelSlug);
    this.maxAgeDays = maxAgeDays;
    this.useFixtureFallback = useFixtureFallback;
    this.fixtureCassettesDir = fixtureCassettesDir;
  }

  /** Resolve a fixture cassette path for CI/offline use (no workspace cache needed). */
  private fixtureFile(sha256: string): string {
    if (!this.fixtureCassettesDir) return '';
    const modelSlug = this.inner.model.replace(/[^a-zA-Z0-9-]/g, '-');
    return join(this.fixtureCassettesDir, modelSlug, `${sha256}.json`);
  }

  get name(): LlmProvider['name'] { return this.inner.name; }
  get model(): string { return this.inner.model; }

  wasCacheHit(): boolean { return this._lastCacheHit; }

  async complete(prompt: string): Promise<string> {
    const sha256 = createHash('sha256')
      .update(`${prompt}:${this.inner.model}`)
      .digest('hex');
    const cacheFile = join(this.cacheDir, `${sha256}.json`);

    // 1. Workspace cache (wsp/cache/llm/) -- primary, operator's own recordings
    if (existsSync(cacheFile)) {
      try {
        const entry = JSON.parse(readFileSync(cacheFile, 'utf-8')) as CacheEntry;
        const ageDays = (Date.now() - new Date(entry.cached_at).getTime()) / 86_400_000;
        if (ageDays <= this.maxAgeDays) {
          this._lastCacheHit = true;
          return entry.response;
        }
      } catch { /* expired or corrupt: fall through */ }
    }

    // 2. Fixture cassettes (src/passes/fixtures/cassettes/) -- CI fallback, never expire
    // Skipped when --no-cassette is passed (e.g. when seeding fresh cassettes)
    const fixture = this.fixtureFile(sha256);
    if (this.useFixtureFallback && existsSync(fixture)) {
      try {
        const entry = JSON.parse(readFileSync(fixture, 'utf-8')) as CacheEntry;
        this._lastCacheHit = true;
        return entry.response;
      } catch { /* corrupt fixture: fall through to real call */ }
    }

    this._lastCacheHit = false;
    const response = await this.inner.complete(prompt);

    mkdirSync(this.cacheDir, { recursive: true });
    const entry: CacheEntry = {
      model: this.inner.model,
      prompt_sha256: sha256,
      cached_at: new Date().toISOString(),
      response,
    };
    writeFileSync(cacheFile, JSON.stringify(entry, null, 2), 'utf-8');

    return response;
  }

  getLastUsage(): LlmUsage | undefined {
    if (this._lastCacheHit) return { input_tokens: 0, output_tokens: 0, cost_usd: 0 };
    return this.inner.getLastUsage?.();
  }
}
