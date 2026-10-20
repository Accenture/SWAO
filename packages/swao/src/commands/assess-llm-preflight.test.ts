// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- assess LLM provider preflight tests (#3340)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLlmProvider } from '@swao/module-llm-providers';
import type { LlmProvider } from '@swao/module-llm-providers';
import { llmUnavailableWarning, preflightLlmProvider } from './assess-llm-preflight.js';

const KEY_VARS = ['SWAO_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY', 'SWAO_OPENAI_API_KEY', 'OPENAI_API_KEY', 'SWAO_LLM_CONNECTOR', 'SWAO_LLM_PROVIDER'];

describe('preflightLlmProvider (#3340)', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEY_VARS) { saved[k] = process.env[k]; delete process.env[k]; }
  });
  afterEach(() => {
    for (const k of KEY_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('reports anthropic without an API key as unavailable instead of throwing', () => {
    const result = preflightLlmProvider(createLlmProvider, 'sovereign-health', { type: 'anthropic', model: 'claude-opus-4-7' });
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toMatch(/AnthropicLlmProvider: no API key/);
  });

  it('reports openai without an API key as unavailable', () => {
    const result = preflightLlmProvider(createLlmProvider, 'sovereign-health', { type: 'openai' });
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toMatch(/no API key/);
  });

  it('reports an unknown connector as unavailable', () => {
    const result = preflightLlmProvider(createLlmProvider, 'sovereign-health', { connector: 'no-such-connector-3340' });
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toMatch(/Unknown LLM connector/);
  });

  it('reports a provider with a key as available', () => {
    process.env['SWAO_ANTHROPIC_API_KEY'] = 'test-key-not-real';
    const result = preflightLlmProvider(createLlmProvider, 'sovereign-health', { type: 'anthropic' });
    expect(result).toEqual({ available: true });
  });

  it('constructs the provider once with the app id and config, and never calls it', () => {
    const complete = vi.fn();
    const factory = vi.fn(() => ({ name: 'fake', complete } as unknown as LlmProvider));
    const config = { type: 'anthropic' };
    expect(preflightLlmProvider(factory, 'app-a', config)).toEqual({ available: true });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith('app-a', 'gateway-preflight', config);
    expect(complete).not.toHaveBeenCalled();
  });

  it('turns a non-Error throw into a string reason', () => {
    const result = preflightLlmProvider(() => { throw 'boom'; }, undefined, undefined);
    expect(result).toEqual({ available: false, reason: 'boom' });
  });
});

describe('llmUnavailableWarning (#3340)', () => {
  it('names the reason and the skipped passes, without dashes as separators', () => {
    const line = llmUnavailableWarning('AnthropicLlmProvider: no API key.');
    expect(line).toMatch(/^\[warn\] LLM provider unavailable: AnthropicLlmProvider: no API key\./);
    expect(line).toContain('data, ctx, synth, comp, blocks');
    expect(line).toContain('--skip-llm');
    expect(line).not.toMatch(/ -- /);
  });
});
