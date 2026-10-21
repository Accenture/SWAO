import { describe, it, expect } from 'vitest';
import { openAiChatCompletionsUrl } from './connector-fetch.js';

describe('openAiChatCompletionsUrl (#3381, #3385)', () => {
  it('appends /v1/chat/completions to a base_url without /v1', () => {
    expect(openAiChatCompletionsUrl('https://llm.example.internal')).toBe('https://llm.example.internal/v1/chat/completions');
    expect(openAiChatCompletionsUrl('https://openrouter.ai/api/')).toBe('https://openrouter.ai/api/v1/chat/completions');
  });
  it('keeps a base_url that already ends in /v1', () => {
    expect(openAiChatCompletionsUrl('https://api.example.com/v1')).toBe('https://api.example.com/v1/chat/completions');
  });
});
