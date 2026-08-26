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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { LlmCacheLayer } from '../cache.js';
import type { LlmProvider, LlmUsage } from '../types.js';

// #0472 -- LLM cassette cache layer tests.

class FakeLlmProvider implements LlmProvider {
  readonly name = 'anthropic' as const;
  readonly model = 'claude-sonnet-4-6';
  callCount = 0;

  async complete(_prompt: string): Promise<string> {
    this.callCount++;
    return `{"signals":[],"assessment":{"call":${this.callCount}}}`;
  }

  getLastUsage(): LlmUsage {
    return { input_tokens: 100, output_tokens: 50, cost_usd: 0.001 };
  }
}

let tmp: string;
let fake: FakeLlmProvider;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'swao-cache-test-'));
  fake = new FakeLlmProvider();
});

afterEach(() => {
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe('LlmCacheLayer (#0472)', () => {
  it('cache miss calls real LLM and stores response on disk', async () => {
    const cache = new LlmCacheLayer(fake, tmp);
    const response = await cache.complete('prompt-a');
    expect(fake.callCount).toBe(1);
    expect(cache.wasCacheHit()).toBe(false);
    expect(response).toContain('"call":1');

    const cacheDir = join(tmp, 'wsp', 'cache', 'llm', 'claude-sonnet-4-6');
    const files = readdirSync(cacheDir);
    expect(files.length).toBe(1);
    const entry = JSON.parse(readFileSync(join(cacheDir, files[0]), 'utf-8'));
    expect(entry.model).toBe('claude-sonnet-4-6');
    expect(entry.response).toContain('"call":1');
  });

  it('cache hit replays response without calling real LLM', async () => {
    const cache = new LlmCacheLayer(fake, tmp);
    const first = await cache.complete('prompt-b');
    expect(fake.callCount).toBe(1);
    expect(cache.wasCacheHit()).toBe(false);

    const second = await cache.complete('prompt-b');
    expect(fake.callCount).toBe(1);
    expect(cache.wasCacheHit()).toBe(true);
    expect(second).toBe(first);
  });

  it('cache hit returns zero-cost usage', async () => {
    const cache = new LlmCacheLayer(fake, tmp);
    await cache.complete('prompt-c');
    await cache.complete('prompt-c');
    expect(cache.wasCacheHit()).toBe(true);
    const usage = cache.getLastUsage();
    expect(usage?.cost_usd).toBe(0);
    expect(usage?.input_tokens).toBe(0);
  });

  it('different prompts produce separate cache entries', async () => {
    const cache = new LlmCacheLayer(fake, tmp);
    await cache.complete('prompt-x');
    await cache.complete('prompt-y');
    expect(fake.callCount).toBe(2);

    await cache.complete('prompt-x');
    await cache.complete('prompt-y');
    expect(fake.callCount).toBe(2);
    expect(cache.wasCacheHit()).toBe(true);
  });

  it('expired cache entries trigger a fresh LLM call', async () => {
    const cache = new LlmCacheLayer(fake, tmp, 0);
    await cache.complete('prompt-d');
    expect(fake.callCount).toBe(1);

    await cache.complete('prompt-d');
    expect(fake.callCount).toBe(2);
    expect(cache.wasCacheHit()).toBe(false);
  });

  it('stub provider is not wrapped by LlmCacheLayer (no wsp/cache dir created)', async () => {
    const cache = new LlmCacheLayer(fake, tmp);
    await cache.complete('probe');
    const cacheDir = join(tmp, 'wsp', 'cache');
    expect(existsSync(cacheDir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #0483 -- fixture cassette fallback (CI / offline use)
// ---------------------------------------------------------------------------

describe('LlmCacheLayer fixture fallback (#0483 / #0568 DI)', () => {
  // #0568: the fixture cassettes dir is now injected (the cache layer moved to
  // @swao/module-llm-providers and owns no fixture assets). The host passes its
  // packaged dir; tests inject a tmp dir, so the real fallback path is exercised
  // directly instead of only being asserted in integration.
  it('replays an injected fixture cassette when the workspace cache misses (no real LLM call)', async () => {
    const fixtureTmp = mkdtempSync(join(tmpdir(), 'swao-fixture-test-'));
    const workspace = mkdtempSync(join(tmpdir(), 'swao-ws-'));
    const fake2 = new FakeLlmProvider(); // model 'claude-sonnet-4-6'
    const modelSlug = 'claude-sonnet-4-6';
    const sha256 = createHash('sha256').update('fixture-prompt:claude-sonnet-4-6').digest('hex');
    mkdirSync(join(fixtureTmp, modelSlug), { recursive: true });
    writeFileSync(
      join(fixtureTmp, modelSlug, `${sha256}.json`),
      JSON.stringify({ model: modelSlug, prompt_sha256: sha256, cached_at: '2026-06-03T00:00:00Z', response: '{"signals":[],"assessment":{"from_fixture":true}}' }),
      'utf-8',
    );

    // Workspace cache is empty -> the injected fixture dir must serve the reply.
    const cache = new LlmCacheLayer(fake2, workspace, 30, true, fixtureTmp);
    const result = await cache.complete('fixture-prompt');
    expect(fake2.callCount).toBe(0);
    expect(cache.wasCacheHit()).toBe(true);
    expect(result).toContain('from_fixture');

    rmSync(fixtureTmp, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  });

  it('makes a real call when no fixture dir is injected (fallback disabled)', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'swao-ws-'));
    const fake2 = new FakeLlmProvider();
    // No fixtureCassettesDir -> fixture fallback resolves to '' and is skipped.
    const cache = new LlmCacheLayer(fake2, workspace);
    const result = await cache.complete('no-fixture-prompt');
    expect(fake2.callCount).toBe(1);
    expect(cache.wasCacheHit()).toBe(false);
    expect(result).toContain('"call":1');
    rmSync(workspace, { recursive: true, force: true });
  });

  it('prefers the workspace cache over the injected fixture dir', async () => {
    const fixtureTmp = mkdtempSync(join(tmpdir(), 'swao-fixture-test-'));
    const workspace = mkdtempSync(join(tmpdir(), 'swao-ws-'));
    const fake2 = new FakeLlmProvider();
    const modelSlug = 'claude-sonnet-4-6';
    const sha256 = createHash('sha256').update('dual-prompt:claude-sonnet-4-6').digest('hex');
    // Seed BOTH a fixture and a workspace cache entry for the same key.
    mkdirSync(join(fixtureTmp, modelSlug), { recursive: true });
    writeFileSync(
      join(fixtureTmp, modelSlug, `${sha256}.json`),
      JSON.stringify({ model: modelSlug, prompt_sha256: sha256, cached_at: '2026-06-03T00:00:00Z', response: '{"from_fixture":true}' }),
      'utf-8',
    );
    const cacheDir = join(workspace, 'wsp', 'cache', 'llm', modelSlug);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      join(cacheDir, `${sha256}.json`),
      JSON.stringify({ model: modelSlug, prompt_sha256: sha256, cached_at: new Date().toISOString(), response: '{"from_workspace":true}' }),
      'utf-8',
    );

    const cache = new LlmCacheLayer(fake2, workspace, 30, true, fixtureTmp);
    const result = await cache.complete('dual-prompt');
    expect(fake2.callCount).toBe(0);
    expect(result).toContain('from_workspace');

    rmSync(fixtureTmp, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  });
});
