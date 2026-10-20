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

// #3284 (Design 110 D-14): providers.llm.max_concurrency in .swao.yml.

import { describe, it, expect } from 'vitest';
import { SwaoYmlSchema } from '../swao-yml.js';

describe('SwaoYmlSchema providers.llm (#3284)', () => {
  it('accepts max_concurrency and keeps the other providers keys', () => {
    const parsed = SwaoYmlSchema.parse({
      providers: {
        llm: { max_concurrency: 2, primary: { type: 'anthropic', model: 'claude-sonnet-4-6' } },
        regime_catalogs: [{ id: 'X', path: 'x.yaml' }],
      },
    });
    expect(parsed.providers?.llm?.max_concurrency).toBe(2);
    expect((parsed.providers?.llm as Record<string, unknown>)['primary']).toEqual({ type: 'anthropic', model: 'claude-sonnet-4-6' });
    expect((parsed.providers as Record<string, unknown>)['regime_catalogs']).toHaveLength(1);
  });

  it('max_concurrency is optional; an empty providers block is accepted', () => {
    expect(SwaoYmlSchema.safeParse({ providers: { llm: { primary: { type: 'ollama' } } } }).success).toBe(true);
    expect(SwaoYmlSchema.safeParse({ providers: null }).success).toBe(true);
    expect(SwaoYmlSchema.safeParse({ providers: { llm: null } }).success).toBe(true);
  });

  it('rejects values outside 1..64 and non-integers', () => {
    for (const v of [0, -1, 65, 2.5, '4']) {
      expect(SwaoYmlSchema.safeParse({ providers: { llm: { max_concurrency: v } } }).success).toBe(false);
    }
  });
});
