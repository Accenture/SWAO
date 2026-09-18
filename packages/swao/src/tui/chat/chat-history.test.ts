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

// Unit tests for chat history helpers (#2782).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import {
  chatHistoryPath,
  appendTurn,
  parseTurnLine,
  estimateTokens,
  isOverBudget,
  type ChatTurn,
} from './chat-history.js';

describe('chatHistoryPath (#2782)', () => {
  it('constructs the correct path under wsp/chat/', () => {
    const p = chatHistoryPath('/workspace', '2026-09-17T12-00-00-000Z');
    // Use sep-agnostic check: path contains wsp + chat as adjacent segments.
    expect(p).toContain(`wsp${sep}chat${sep}`);
    expect(p).toContain('2026-09-17T12-00-00-000Z.ndjson');
  });
});

describe('appendTurn + parseTurnLine (#2782)', () => {
  let tmpDir: string;
  let histPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'swao-chat-history-'));
    histPath = join(tmpDir, 'wsp', 'chat', 'test.ndjson');
  });

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the file and directories on first write', () => {
    const turn: ChatTurn = {
      ts: '2026-09-17T12:00:00.000Z',
      role: 'user',
      content: 'What are the main risks?',
    };
    appendTurn(histPath, turn);
    const content = readFileSync(histPath, 'utf-8');
    expect(content.trim()).toBe(JSON.stringify(turn));
  });

  it('appends subsequent turns as separate lines', () => {
    const turn: ChatTurn = {
      ts: '2026-09-17T12:00:01.000Z',
      role: 'assistant',
      content: 'The main risks are sovereignty and compliance gaps.',
      model: 'claude-sonnet-5',
      tokens_in: 100,
      tokens_out: 50,
    };
    appendTurn(histPath, turn);
    const lines = readFileSync(histPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const parsed = JSON.parse(lines[1]);
    expect(parsed.role).toBe('assistant');
    expect(parsed.tokens_in).toBe(100);
  });

  it('parseTurnLine validates against ChatTurnSchema', () => {
    const valid = '{"ts":"2026-09-17T12:00:00.000Z","role":"user","content":"hello"}';
    const result = parseTurnLine(valid);
    expect(result).not.toBeNull();
    expect(result?.role).toBe('user');
  });

  it('parseTurnLine returns null for invalid JSON', () => {
    expect(parseTurnLine('{broken')).toBeNull();
  });

  it('parseTurnLine returns null when role is invalid', () => {
    const invalid = '{"ts":"2026-09-17T12:00:00.000Z","role":"bot","content":"hi"}';
    expect(parseTurnLine(invalid)).toBeNull();
  });
});

describe('estimateTokens (#2782)', () => {
  it('estimates 1 token per 4 chars (ceiling)', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(8000))).toBe(2000);
  });
});

describe('isOverBudget (#2782)', () => {
  it('returns false below 80% of budget', () => {
    expect(isOverBudget(7999, 10000)).toBe(false);
    expect(isOverBudget(0, 10000)).toBe(false);
  });

  it('returns true at and above 80% of budget', () => {
    expect(isOverBudget(8000, 10000)).toBe(true);
    expect(isOverBudget(9000, 10000)).toBe(true);
    expect(isOverBudget(10000, 10000)).toBe(true);
  });

  it('respects a custom threshold', () => {
    expect(isOverBudget(9000, 10000, 0.9)).toBe(true);
    expect(isOverBudget(8999, 10000, 0.9)).toBe(false);
  });
});
