// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3284: providers.llm.max_concurrency is read from the app .swao.yml too and
// handed to the LLM factory (app > workspace > connector > 4).

import { describe, it, expect } from 'vitest';
import { readLlmPrimaryConfig, readLlmMaxConcurrency } from './assess.js';

describe('providers.llm.max_concurrency pass-through (#3284)', () => {
  it('readLlmPrimaryConfig carries max_concurrency next to the primary block', () => {
    const cfg = readLlmPrimaryConfig({ providers: { llm: { max_concurrency: 2, primary: { type: 'ollama', model: 'm' } } } });
    expect(cfg).toMatchObject({ type: 'ollama', max_concurrency: 2 });
  });

  it('readLlmPrimaryConfig carries it for a multi-environment block', () => {
    expect(readLlmPrimaryConfig({ providers: { llm: { max_concurrency: 3, environments: {}, activeEnv: 'x' } } })).toMatchObject({ max_concurrency: 3 });
  });

  it('omits the key when not configured, so the factory falls back to the workspace value, the connector, then 4', () => {
    const cfg = readLlmPrimaryConfig({ providers: { llm: { primary: { type: 'ollama' } } } });
    expect(cfg && 'max_concurrency' in cfg).toBe(false);
  });

  it('readLlmMaxConcurrency reads an app-level value without a primary block', () => {
    expect(readLlmMaxConcurrency({ providers: { llm: { max_concurrency: 1 } } })).toBe(1);
    expect(readLlmMaxConcurrency({ providers: { llm: {} } })).toBeUndefined();
    expect(readLlmMaxConcurrency({})).toBeUndefined();
    // An app-only value is not a primary config: the workspace primary is still used.
    expect(readLlmPrimaryConfig({ providers: { llm: { max_concurrency: 1 } } })).toBeUndefined();
  });
});
