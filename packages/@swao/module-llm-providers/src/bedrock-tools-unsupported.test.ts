import { describe, it, expect } from 'vitest';
import { isBedrockToolsUnsupported } from './bedrock.js';

const v = (msg: string, name = 'ValidationException') => Object.assign(new Error(msg), { name });

describe('isBedrockToolsUnsupported (#3311, CodeQL #127)', () => {
  it.each([
    "This model doesn't support tool use.",
    'This model does not support tool use',
    'This model doesnt support tools',
    'Tool use is not supported for this model',
    'tool use not supported',
    'toolUse: unsupported in this region',
    'Model does not support tool calling',
  ])('matches %s', (msg) => {
    expect(isBedrockToolsUnsupported(v(msg))).toBe(true);
  });
  it.each([
    'Malformed input request',
    'The provided model identifier is invalid.',
    'support tool',
  ])('does not match %s', (msg) => {
    expect(isBedrockToolsUnsupported(v(msg))).toBe(false);
  });
  it('requires a ValidationException', () => {
    expect(isBedrockToolsUnsupported(v("doesn't support tool use", 'ThrottlingException'))).toBe(false);
  });
  it('stays fast on long repetitive input', () => {
    const t = Date.now();
    isBedrockToolsUnsupported(v('tooluse'.repeat(50_000)));
    expect(Date.now() - t).toBeLessThan(200);
  });
});
