// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- .swao.yml gateway connector passthrough (#1401)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { readLlmPrimaryConfig } from './assess.js';

describe('readLlmPrimaryConfig gateway keys (#1401)', () => {
  it('passes connector + env through from providers.llm.primary', () => {
    const cfg = readLlmPrimaryConfig({
      providers: {
        llm: {
          primary: {
            connector: 'openrouter',
            env: 'prod',
            model: 'mistralai/mistral-large',
          },
        },
      },
    });
    expect(cfg?.connector).toBe('openrouter');
    expect(cfg?.env).toBe('prod');
    expect(cfg?.model).toBe('mistralai/mistral-large');
  });

  it('legacy type-based config is unchanged (no connector key)', () => {
    const cfg = readLlmPrimaryConfig({
      providers: { llm: { primary: { type: 'anthropic', model: 'claude-haiku-4-5-20251001' } } },
    });
    expect(cfg?.connector).toBeUndefined();
    expect(cfg?.type).toBe('anthropic');
    expect(cfg?.model).toBe('claude-haiku-4-5-20251001');
  });
});
