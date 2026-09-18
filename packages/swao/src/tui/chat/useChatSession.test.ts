// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Unit tests for extractProseFromResponse and formatChatPrompt (#2786 follow-up).

import { describe, it, expect } from 'vitest';
import { extractProseFromResponse, formatChatPrompt } from './useChatSession.js';
import type { ChatTurn } from '@swao/core';

describe('extractProseFromResponse (#2786)', () => {
  it('extracts "response" key from JSON envelope', () => {
    const raw = JSON.stringify({ response: 'Hello, I can help you.', language: 'en' });
    expect(extractProseFromResponse(raw)).toBe('Hello, I can help you.');
  });

  it('extracts "message" key from JSON envelope', () => {
    const raw = JSON.stringify({ message: 'No assessments found.', status: 'ok' });
    expect(extractProseFromResponse(raw)).toBe('No assessments found.');
  });

  it('extracts "text" key from JSON envelope', () => {
    const raw = JSON.stringify({ text: 'Here is the summary.' });
    expect(extractProseFromResponse(raw)).toBe('Here is the summary.');
  });

  it('converts literal \\\\n sequences to real newlines in extracted prose', () => {
    const raw = JSON.stringify({ response: 'Line one.\\nLine two.\\n\\nParagraph two.' });
    const result = extractProseFromResponse(raw);
    expect(result).toContain('Line one.\nLine two.');
    expect(result).not.toContain('\\n');
  });

  it('returns non-JSON text as-is', () => {
    const plain = 'This is a plain prose response.';
    expect(extractProseFromResponse(plain)).toBe(plain);
  });

  it('converts literal \\\\n in non-JSON text', () => {
    const raw = 'First paragraph.\\n\\nSecond paragraph.';
    expect(extractProseFromResponse(raw)).toBe('First paragraph.\n\nSecond paragraph.');
  });

  it('handles malformed JSON gracefully by returning text as-is', () => {
    const broken = '{ response: "not valid json" }';
    expect(extractProseFromResponse(broken)).toBe(broken);
  });

  it('trims leading and trailing whitespace', () => {
    expect(extractProseFromResponse('  hello  ')).toBe('hello');
  });

  it('returns empty string for empty input', () => {
    expect(extractProseFromResponse('')).toBe('');
  });

  it('does not extract from JSON arrays (returns as-is)', () => {
    const arr = '[{"item": "one"}]';
    expect(extractProseFromResponse(arr)).toBe(arr);
  });

  it('extracts "reason" from error/refusal JSON envelope (#2791)', () => {
    const raw = JSON.stringify({
      error: 'Unable to provide response',
      reason: 'No portfolio context is loaded.',
      action_taken: 'Refusing to hallucinate',
      response_mode: 'json_only',
    });
    expect(extractProseFromResponse(raw)).toBe('No portfolio context is loaded.');
  });

  it('extracts "description" from error JSON when reason is absent (#2791)', () => {
    const raw = JSON.stringify({ error: 'fail', description: 'Something went wrong.' });
    expect(extractProseFromResponse(raw)).toBe('Something went wrong.');
  });

  it('extracts bare "error" string when it is the only key (#2793)', () => {
    const raw = JSON.stringify({
      error: 'SWAO Portfolio Advisor kann nur in natuerlicher Sprache antworten, nicht im JSON-Format',
    });
    expect(extractProseFromResponse(raw)).toBe(
      'SWAO Portfolio Advisor kann nur in natuerlicher Sprache antworten, nicht im JSON-Format',
    );
  });

  it('extracts German prose with Umlauts from JSON envelope', () => {
    const raw = JSON.stringify({
      response: 'Guten Tag! Ich bin der SWAO Portfolio Advisor.',
      language: 'de',
    });
    expect(extractProseFromResponse(raw)).toBe('Guten Tag! Ich bin der SWAO Portfolio Advisor.');
  });
});

describe('formatChatPrompt (#2781)', () => {
  const sys: ChatTurn = { ts: '', role: 'system', content: 'System instructions.' };
  const u1: ChatTurn  = { ts: '', role: 'user',   content: 'Hello.' };
  const a1: ChatTurn  = { ts: '', role: 'assistant', content: 'Hi there.' };

  it('includes system content at the start', () => {
    const prompt = formatChatPrompt([sys], 'New question');
    expect(prompt.startsWith('System instructions.')).toBe(true);
  });

  it('includes conversation history between system and new turn', () => {
    const prompt = formatChatPrompt([sys, u1, a1], 'Follow-up');
    expect(prompt).toContain('User: Hello.');
    expect(prompt).toContain('Assistant: Hi there.');
  });

  it('ends with "User: ... Assistant:" pattern', () => {
    const prompt = formatChatPrompt([sys], 'My question');
    expect(prompt).toMatch(/User: My question\n\nAssistant:$/);
  });

  it('filters out system messages from the history section', () => {
    const prompt = formatChatPrompt([sys, u1, a1], 'Next');
    const historySection = prompt.split('CONVERSATION HISTORY')[1] ?? '';
    expect(historySection).not.toContain('System instructions.');
  });
});
