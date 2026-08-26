// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI component library -- LlmModelPicker unit tests (#1660)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { LLM_PROVIDER_OPTIONS, formatLlmCurrentLabel } from './LlmModelPicker.js';

describe('LLM_PROVIDER_OPTIONS', () => {
  it('has exactly four options', () => {
    expect(LLM_PROVIDER_OPTIONS).toHaveLength(4);
  });

  it('first option is workspace-default (remove override)', () => {
    expect(LLM_PROVIDER_OPTIONS[0].value).toBe('workspace-default');
  });

  it('includes anthropic, openai, and ollama options', () => {
    const values = LLM_PROVIDER_OPTIONS.map(o => o.value);
    expect(values).toContain('anthropic');
    expect(values).toContain('openai');
    expect(values).toContain('ollama');
  });

  it('every option has a non-empty label', () => {
    for (const opt of LLM_PROVIDER_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });
});

describe('formatLlmCurrentLabel', () => {
  it('returns type alone when app type is set but no model', () => {
    expect(formatLlmCurrentLabel('anthropic', undefined, undefined)).toBe('anthropic');
  });

  it('returns type + model when both are set', () => {
    expect(formatLlmCurrentLabel('ollama', 'llama3', undefined)).toBe('ollama (llama3)');
  });

  it('falls back to workspace default label when no per-app type', () => {
    expect(formatLlmCurrentLabel(undefined, undefined, 'openai')).toBe('workspace default (openai)');
  });

  it('shows "not set" when workspace type is also absent', () => {
    expect(formatLlmCurrentLabel(undefined, undefined, undefined)).toBe('workspace default (not set)');
  });

  it('per-app type takes precedence over workspace type', () => {
    expect(formatLlmCurrentLabel('anthropic', undefined, 'openai')).toBe('anthropic');
  });
});
