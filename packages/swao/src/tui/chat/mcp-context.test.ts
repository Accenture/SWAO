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

// Unit tests for MCP context helpers (#2781 #2789).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseSseBody, extractToolText, buildSystemPrompt, fetchPortfolioContext } from './mcp-context.js';
import type { McpSession } from './mcp-context.js';

describe('parseSseBody (#2781)', () => {
  it('extracts single data line from SSE response', () => {
    const sse = 'data: {"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"hello"}]}}\n\n';
    const json = parseSseBody(sse);
    expect(json).toContain('"jsonrpc"');
    const parsed = JSON.parse(json);
    expect(parsed.result.content[0].text).toBe('hello');
  });

  it('joins multiple data lines as a JSON array', () => {
    const sse = 'data: {"id":1}\ndata: {"id":2}\n';
    const result = parseSseBody(sse);
    expect(result).toBe('[{"id":1},{"id":2}]');
  });

  it('returns body as-is when no data: prefix is found', () => {
    const raw = '{"jsonrpc":"2.0","result":{}}';
    expect(parseSseBody(raw)).toBe(raw);
  });

  it('skips [DONE] sentinel lines', () => {
    const sse = 'data: {"result":"ok"}\ndata: [DONE]\n';
    const result = parseSseBody(sse);
    expect(result).toBe('{"result":"ok"}');
  });
});

describe('extractToolText (#2781)', () => {
  it('extracts text from a successful tools/call result', () => {
    const result = {
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [
          { type: 'text', text: 'App: sovereign-health' },
          { type: 'text', text: 'Score: 72' },
        ],
      },
    };
    const text = extractToolText(result);
    expect(text).toBe('App: sovereign-health\nScore: 72');
  });

  it('extracts error message from JSON-RPC error response', () => {
    const result = {
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32601, message: 'Method not found' },
    };
    const text = extractToolText(result);
    expect(text).toContain('MCP error');
    expect(text).toContain('Method not found');
  });

  it('returns empty string for null or non-object input', () => {
    expect(extractToolText(null)).toBe('');
    expect(extractToolText('string')).toBe('');
    expect(extractToolText({})).toBe('');
  });
});

describe('buildSystemPrompt (#2781)', () => {
  it('includes context section when context is provided', () => {
    const prompt = buildSystemPrompt('## Workspace\nApp: sovereign-health');
    expect(prompt).toContain('PORTFOLIO CONTEXT');
    expect(prompt).toContain('sovereign-health');
    expect(prompt).toContain('SWAO Portfolio Advisor');
  });

  it('uses fallback text when context is empty', () => {
    const prompt = buildSystemPrompt('');
    expect(prompt).toContain('No portfolio context is available');
    expect(prompt).toContain('swao assess');
  });

  it('does not include raw context markers when context is whitespace-only', () => {
    const prompt = buildSystemPrompt('   \n  ');
    expect(prompt).toContain('No portfolio context is available');
  });

  // #2786 -- LLM must not respond in JSON format
  it('system prompt forbids JSON output (#2786)', () => {
    const prompt = buildSystemPrompt('');
    expect(prompt).toContain('NEVER output JSON');
  });

  it('system prompt explicitly bans JSON error/refusal objects (#2791)', () => {
    const prompt = buildSystemPrompt('');
    expect(prompt).toContain('NEVER respond with {"error"');
  });

  it('system prompt requires natural language prose (#2786)', () => {
    const prompt = buildSystemPrompt('ctx');
    expect(prompt).toContain('natural language prose');
  });

  // #2787 -- multilingual support
  it('system prompt instructs language detection (#2787)', () => {
    const prompt = buildSystemPrompt('');
    expect(prompt).toContain('Detect the language');
  });

  it('system prompt does not restrict to English only (#2787)', () => {
    const prompt = buildSystemPrompt('ctx');
    // Must NOT contain a claim that English is the only language
    expect(prompt).not.toMatch(/respond in English only/i);
    expect(prompt).not.toMatch(/configured to respond in English/i);
  });
});

describe('fetchPortfolioContext tool selection (#2789)', () => {
  const mockSession: McpSession = { sessionId: 'test', port: 3737 };
  const calledTools: string[] = [];

  function mockFetch(): void {
    vi.stubGlobal('fetch', async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string) as { params?: { name?: string } };
      if (body.params?.name) calledTools.push(body.params.name);
      return {
        ok: true,
        text: async () => 'data: {"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"data"}]}}\n',
      };
    });
  }

  beforeEach(() => { calledTools.length = 0; mockFetch(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('calls swao_portfolio_summary not swao_hub (#2789)', async () => {
    await fetchPortfolioContext(mockSession, '/ws');
    expect(calledTools).toContain('swao_portfolio_summary');
    expect(calledTools).not.toContain('swao_hub');
  });

  it('calls swao_portfolio_lz not swao_lz_fit (#2789)', async () => {
    await fetchPortfolioContext(mockSession, '/ws');
    expect(calledTools).toContain('swao_portfolio_lz');
    expect(calledTools).not.toContain('swao_lz_fit');
  });

  it('calls the expected 7 tools in order (#2789, #2792)', async () => {
    await fetchPortfolioContext(mockSession, '/ws');
    expect(calledTools).toEqual([
      'swao_workspace_inventory',
      'swao_portfolio_summary',
      'swao_signals',
      'swao_risks',
      'swao_portfolio_lz',
      'swao_list_directory',
      'swao_read_file',
    ]);
  });

  it('still calls swao_signals and swao_risks', async () => {
    await fetchPortfolioContext(mockSession, '/ws');
    expect(calledTools).toContain('swao_signals');
    expect(calledTools).toContain('swao_risks');
  });
});
