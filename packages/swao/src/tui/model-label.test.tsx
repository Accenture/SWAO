// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator, model labels on screen (#4220)
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4220: a latest alias reads in words on screen; price and mark go to the
// detail column; the raw id stays the option value and shows in the guidance.

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { SelectInput } from '@swao/tui-kit';
import { modelLabel, modelOption, OTHER_MODEL_OPTION, isLatestAlias } from './model-label.js';

describe('modelLabel (#4220)', () => {
  it('reads a latest alias in words and keeps a concrete id', () => {
    expect(modelLabel('~deepseek/deepseek-pro-latest')).toBe('DeepSeek Pro (latest)');
    expect(modelLabel('~openai/gpt-5-latest')).toBe('GPT 5 (latest)');
    expect(modelLabel('~anthropic/claude-sonnet-latest-2026')).toBe('Claude Sonnet (latest)');
    expect(modelLabel('anthropic/claude-sonnet-4')).toBe('anthropic/claude-sonnet-4');
    expect(isLatestAlias('~x/y-latest')).toBe(true);
    expect(isLatestAlias('x/y')).toBe(false);
  });

  it('modelOption: the raw id is the value, price and mark in the detail, the id in the guidance', () => {
    const o = modelOption({ id: '~deepseek/deepseek-pro-latest', cost: { input_per_million: 0.27000000001, output_per_million: 1.1 } }, 'OpenRouter', 'current');
    expect(o.value).toBe('~deepseek/deepseek-pro-latest');
    expect(o.label).toBe('DeepSeek Pro (latest)');
    expect(o.detail).toBe('current, $0.27/M in, $1.1/M out');
    expect(o.guidance?.sections?.find((s) => s.label === 'Model id')?.text).toBe('~deepseek/deepseek-pro-latest');
    expect(o.guidance?.sections?.some((s) => s.label === 'Latest')).toBe(true);
    expect(modelOption({ id: 'mistralai/mistral-large' }, 'OpenRouter').detail).toBeUndefined();
  });

  it('a model list at width 100 has no ellipsis and no explanation inside a label', () => {
    const options = [
      OTHER_MODEL_OPTION,
      modelOption({ id: '~deepseek/deepseek-pro-latest', cost: { input_per_million: 0.27, output_per_million: 1.1 } }, 'OpenRouter', 'current'),
      modelOption({ id: 'anthropic/claude-sonnet-4', cost: { input_per_million: 3, output_per_million: 15 } }, 'OpenRouter', 'default'),
      modelOption({ id: 'meta-llama/llama-3.3-70b-instruct' }, 'OpenRouter'),
    ];
    const { lastFrame, unmount } = render(<SelectInput label="Model" options={options} onSelect={() => undefined} showKeyHints={false} />);
    const lines = (lastFrame() ?? '').split('\n');
    unmount();
    expect(lines.join('\n')).not.toMatch(/…|\.\.\./);
    expect(lines.join('\n')).not.toContain('~deepseek');
    expect(lines.find((l) => l.includes('DeepSeek Pro (latest)'))).toContain('current, $0.27/M in, $1.1/M out');
    expect(lines.find((l) => l.includes('Other model'))).toContain('type any model id the platform serves');
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(100);
  });
});
