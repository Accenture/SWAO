// #4372: the shared cost source and price preflight of an LLM Assessment
// candidate (CLI and TUI).

import { describe, it, expect } from 'vitest';
import { legCostSource, legPriceWarning } from './llm-leg-cost.js';

type Loader = NonNullable<Parameters<typeof legPriceWarning>[2]>;

function loader(connector: Record<string, unknown> | undefined): Loader {
  return (() => (connector ? { file: { connector } } : undefined)) as unknown as Loader;
}

const openrouter = {
  id: 'openrouter', base_url: 'https://openrouter.ai/api',
  models: { default: 'mistralai/mistral-large', catalogue: [{ id: 'mistralai/mistral-large' }] },
};
const anthropic = {
  id: 'anthropic', base_url: 'https://api.anthropic.com',
  models: { default: 'claude-opus-4-7', catalogue: [{ id: 'claude-opus-4-7', cost: { input_per_million: 15, output_per_million: 75 } }, { id: 'claude-new' }] },
};

describe('legCostSource / legPriceWarning (#4372)', () => {
  it('ollama is local, everything else billed', () => {
    expect(legCostSource('ollama')).toBe('local');
    expect(legCostSource('openrouter')).toBe('billed');
  });

  it('OpenRouter model without a price: warning names model and connector file and the billed usage', () => {
    const w = legPriceWarning({ connector: 'openrouter', model: 'mistralai/mistral-large' }, '/ws', loader(openrouter));
    expect(w).toContain('no price for mistralai/mistral-large in openrouter.yaml');
    expect(w).toContain('OpenRouter billed usage');
  });

  it('priced model: no warning; unpriced model of another connector: cost not measured', () => {
    expect(legPriceWarning({ connector: 'anthropic', model: 'claude-opus-4-7' }, '/ws', loader(anthropic))).toBeUndefined();
    expect(legPriceWarning({ connector: 'anthropic', model: 'claude-new' }, '/ws', loader(anthropic))).toContain('the cost dimension is not measured');
  });

  it('local connector or a connector that cannot be loaded: no warning', () => {
    expect(legPriceWarning({ connector: 'ollama', model: 'qwen3' }, '/ws', loader(anthropic))).toBeUndefined();
    expect(legPriceWarning({ connector: 'missing', model: 'x' }, '/ws', loader(undefined))).toBeUndefined();
  });
});
