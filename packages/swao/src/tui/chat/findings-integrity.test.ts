// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI chat
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3418: chat findings integrity (Design 011 "Findings integrity"). One test per
// acceptance criterion: prompt rules (snapshot), compact index lines survive
// truncation, and a scripted model answer for a test-path crypto signal
// reaches the user with test code and confidence stated.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { formatSignalIndexLine, parseSignalIndexLines, type SignalIndexEntry } from '@swao/core';
import type { LlmProvider } from '@swao/module-llm-providers';
import { buildSystemPrompt, fetchPortfolioContext, assembleContext, capSignalIndex, MAX_CONTEXT_CHARS, type McpSession } from './mcp-context.js';
import { runChatCompletion, finaliseChatAnswer } from './useChatSession.js';

const TEST_CRYPTO: SignalIndexEntry = {
  id: 'CRYPTO-01', app: 'demo', severity: 'medium', severityOriginal: 'high', confidence: 'medium',
  evidenceKind: 'test-code', detection: 'pattern-match', firstEvidence: 'src/test/java/com/acme/HashTest.java:42',
};

function integritySection(prompt: string): string {
  const start = prompt.indexOf('FINDINGS INTEGRITY');
  const end = prompt.indexOf('RESPONSE FORMAT');
  return prompt.slice(start, end).trim();
}

describe('system prompt findings integrity rules (#3418 AC1)', () => {
  it('contains the integrity rules, with and without context', () => {
    for (const prompt of [buildSystemPrompt('## Signals\nCRYPTO-01'), buildSystemPrompt('')]) {
      const section = integritySection(prompt);
      expect(section).toContain('NEVER upgrade it');
      expect(section).toContain('file:line');
      expect(section).toContain('in test code');
      expect(section).toContain('Mention the confidence');
      expect(section).toContain('verified before acting');
      expect(section).toContain('NEVER repeat a secret');
    }
    expect(integritySection(buildSystemPrompt('ctx'))).toMatchSnapshot();
  });

  it('keeps the rules ahead of the portfolio context', () => {
    const prompt = buildSystemPrompt('## Signals\nx');
    expect(prompt.indexOf('FINDINGS INTEGRITY')).toBeLessThan(prompt.indexOf('PORTFOLIO CONTEXT'));
  });
});

describe('truncation keeps every signal index line (#3418 AC4)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const indexLines = Array.from({ length: 40 }, (_, i) => formatSignalIndexLine({
    ...TEST_CRYPTO, id: `CRYPTO-${String(i).padStart(2, '0')}`,
  }));

  it('assembleContext cuts the sections, never the index', () => {
    const parts = [`## Signals and Findings\n${'derivation text '.repeat(10_000)}`];
    const ctx = assembleContext(parts, indexLines);
    expect(ctx.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS + 200);
    expect(ctx).toContain('[Context truncated');
    expect(parseSignalIndexLines(ctx)).toHaveLength(40);
    expect(ctx.startsWith('## Signal Index')).toBe(true);
  });

  it('a very large index keeps the strongest signals whole and names the omitted ones (#2828 window)', () => {
    const many = Array.from({ length: 3000 }, (_, i) => formatSignalIndexLine({
      id: `CRYPTO-${i}`, app: 'demo', severity: i % 3 === 0 ? 'high' : 'low', confidence: 'medium',
      evidenceKind: 'test-code', detection: 'pattern-match', firstEvidence: TEST_CRYPTO.firstEvidence,
    }));
    const ctx = assembleContext(['## Other\nx'], many);
    expect(ctx.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS + 400);
    const kept = parseSignalIndexLines(ctx);
    expect(kept.length).toBeGreaterThan(0);
    // All 1000 high signals rank before any low one.
    expect(kept.filter((e) => e.severity === 'high').length).toBe(Math.min(1000, kept.length));
    expect(ctx).toMatch(/\[\d+ lower-severity signal\(s\) omitted/);
    expect(capSignalIndex(indexLines, 1_000_000)).toEqual({ lines: indexLines, omitted: 0 });
  });

  it('fetchPortfolioContext keeps the index lines of a signals output far beyond the cap', async () => {
    // swao_signals answers with its index lines followed by 200k characters of detail,
    // so the former 80k slice would drop every line after the cut.
    const big = ['All signals for "demo"', 'Signal index (one line per signal)', ...indexLines, '', 'Derivation\n' + 'x'.repeat(200_000)].join('\n');
    const prefix = 'filler '.repeat(20_000); // earlier sections push the signals beyond the cap
    vi.stubGlobal('fetch', async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string) as { params?: { name?: string } };
      const text = body.params?.name === 'swao_signals' ? big : body.params?.name === 'swao_workspace_inventory' ? prefix : 'data';
      return { ok: true, text: async () => `data: ${JSON.stringify({ jsonrpc: '2.0', result: { content: [{ type: 'text', text }] } })}\n` };
    });
    const session: McpSession = { sessionId: 's', port: 3737 };
    const ctx = await fetchPortfolioContext(session, '/ws', 'demo');
    expect(ctx).toContain('[Context truncated');
    const parsed = parseSignalIndexLines(ctx);
    expect(parsed).toHaveLength(40);
    expect(parsed[39]).toMatchObject({ severity: 'medium', confidence: 'medium', evidenceKind: 'test-code', firstEvidence: TEST_CRYPTO.firstEvidence });
  });
});

describe('scripted model answer for a test-path crypto signal (#3418 AC3)', () => {
  // A scripted stub that overstates the finding the way the field chat did.
  const ESCALATING = 'CRYPTO-01 is a critical weakness: MD5 must be replaced before go-live.';

  function stub(answer: string): LlmProvider {
    return {
      name: 'stub',
      model: 'unit',
      complete: async () => 'unused',
      completeDetailed: async () => ({ text: answer, usage: { input_tokens: 1, output_tokens: 1, cost_usd: 0 } }),
    };
  }

  it('the delivered answer states test code and confidence and flags the escalation', async () => {
    const r = await runChatCompletion(stub(ESCALATING), { system: '', history: [], content: 'Summarise', tools: [], signalIndex: [TEST_CRYPTO] });
    expect(r.text.startsWith(ESCALATING)).toBe(true);
    expect(r.text).toContain('[Findings integrity check]');
    expect(r.text).toMatch(/in test code/);
    expect(r.text).toMatch(/confidence medium/);
    expect(r.text).toContain('stronger than the assessed severity');
    expect(r.text).toContain('src/test/java/com/acme/HashTest.java:42');
  });

  it('the tool-calling path runs the same check and reads the index after the answer', async () => {
    let index: SignalIndexEntry[] = [];
    const provider: LlmProvider = {
      ...stub('unused'),
      completeWithTools: async () => 'unused',
      completeWithToolsDetailed: async (params) => {
        await params.onToolCall('swao_signals', { app_id: 'demo' });
        return { text: ESCALATING, usage: { input_tokens: 1, output_tokens: 1, cost_usd: 0 } };
      },
    };
    const r = await runChatCompletion(provider, {
      system: '', history: [], content: 'Summarise',
      tools: [{ name: 'swao_signals', description: 'd', input_schema: { type: 'object', properties: {} } }],
      onToolCall: async () => { index = [TEST_CRYPTO]; return formatSignalIndexLine(TEST_CRYPTO); },
      signalIndex: () => index,
    });
    expect(r.text).toMatch(/in test code/);
    expect(r.text).toMatch(/confidence medium/);
  });

  it('an answer that states the signal as assessed passes unchanged', async () => {
    const ok = 'CRYPTO-01 is a medium severity pattern match in test code (src/test/java/com/acme/HashTest.java:42), medium confidence; verify it before acting.';
    const r = await runChatCompletion(stub(ok), { system: '', history: [], content: 'q', tools: [], signalIndex: [TEST_CRYPTO] });
    expect(r.text).toBe(ok);
  });

  it('the secret guard still runs last over answer and note', () => {
    const out = finaliseChatAnswer('CRYPTO-01 uses password=Sup3rS3cretValue42 and must be replaced.', [TEST_CRYPTO]);
    expect(out).not.toContain('Sup3rS3cretValue42');
    expect(out).toContain('[Findings integrity check]');
  });
});
