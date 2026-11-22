// #4498: the post-pass step lines of swao assess and their one parser.
import { describe, it, expect } from 'vitest';
import { formatPostStepLine, parsePostStepLine, postStepLabel } from './post-step-line.js';

describe('post-pass step lines (#4498)', () => {
  it('formats and parses the step and its progress; the last line of a chunk wins', () => {
    expect(postStepLabel('portfolio_summary')).toBe('Portfolio summary');
    const start = formatPostStepLine('Portfolio summary');
    const progress = formatPostStepLine('Portfolio summary', { done: 106, total: 235, noun: 'apps' });
    expect(progress).toBe('[post] Portfolio summary: 106 of 235 apps');
    expect(parsePostStepLine(start)).toEqual({ label: 'Portfolio summary' });
    expect(parsePostStepLine(`[ok]  Pass 12, blocks\n${start}\n${progress}\n`)).toEqual({ label: 'Portfolio summary', done: 106, total: 235, noun: 'apps' });
    expect(parsePostStepLine('[ok]  Pass 12, blocks')).toBeNull();
  });
});
