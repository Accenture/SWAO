// #4372: short LLM Assessment candidate labels.

import { describe, it, expect } from 'vitest';
import { candidateLabel, candidateLabels, CANDIDATE_LABEL_MAX } from './llm-candidate-label.js';

describe('candidateLabel (#4372)', () => {
  it('drops date suffix, vendor prefix and the claude- family prefix; joins versions', () => {
    expect(candidateLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(candidateLabel('mistralai/mistral-large')).toBe('Mistral Large');
    expect(candidateLabel('claude-opus-4-7')).toBe('Opus 4.7');
    expect(candidateLabel('anthropic/claude-sonnet-4')).toBe('Sonnet 4');
    expect(candidateLabel('gemini-2-5-pro-2025-06-05')).toBe('Gemini 2.5 Pro');
    expect(candidateLabel('~vendor/qwen3-coder:free')).toBe('Qwen3 Coder');
  });

  it('is at most 14 characters', () => {
    for (const m of ['meta-llama/llama-3.3-70b-instruct', 'deepseek-v4-flash-latest', 'x'.repeat(40)]) {
      expect(candidateLabel(m).length).toBeLessThanOrEqual(CANDIDATE_LABEL_MAX);
    }
    expect(candidateLabel('meta-llama/llama-3.3-70b-instruct')).toBe('Llama 3.3 70b');
  });

  it('unique labels: the same model through two connectors gets the connector id', () => {
    const labels = candidateLabels([
      { id: 'a', connector: 'anthropic', model: 'claude-opus-4-7' },
      { id: 'b', connector: 'openrouter', model: 'anthropic/claude-opus-4-7' },
      { id: 'c', connector: 'openrouter', model: 'mistralai/mistral-large' },
    ]);
    expect(labels['c']).toBe('Mistral Large');
    expect(labels['a']).not.toBe(labels['b']);
    expect(labels['a']).toContain('ant');
    for (const l of Object.values(labels)) expect(l.length).toBeLessThanOrEqual(CANDIDATE_LABEL_MAX);
  });

  it('identical candidates stay unique (numbered)', () => {
    const labels = candidateLabels([
      { id: 'a', connector: 'c', model: 'm-1' },
      { id: 'b', connector: 'c', model: 'm-1' },
    ]);
    expect(new Set(Object.values(labels)).size).toBe(2);
  });
});
