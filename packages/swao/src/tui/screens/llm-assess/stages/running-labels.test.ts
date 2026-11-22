// #4372: the run screen shows short candidate labels in its progress lines.

import { describe, it, expect } from 'vitest';
import { labelProgressLine } from './RunningStage.js';

describe('labelProgressLine (#4372)', () => {
  it('replaces the leg id with its label; an id that prefixes another is not misapplied', () => {
    const labels = {
      'anthropic--claude-sonnet-4': 'Sonnet 4',
      'anthropic--claude-sonnet-4-5': 'Sonnet 4.5',
    };
    expect(labelProgressLine('leg anthropic--claude-sonnet-4-5: complete (5 calls)', labels)).toBe('Sonnet 4.5: complete (5 calls)');
    expect(labelProgressLine('leg anthropic--claude-sonnet-4: complete (5 calls)', labels)).toBe('Sonnet 4: complete (5 calls)');
    expect(labelProgressLine('run cancelled by the operator', labels)).toBe('run cancelled by the operator');
  });
});
