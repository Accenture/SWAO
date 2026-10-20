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
import { parseSseBody, extractToolText, buildSystemPrompt, fetchPortfolioContext, listAssessedApps, listMcpTools, callMcpTool, pickRpcResponse, MCP_TOOL_CALL_TIMEOUT_MS, initMcpSession, isMcpError, mcpExitReason } from './mcp-context.js';
import type { McpSession } from './mcp-context.js';
import { existsSync, readdirSync } from 'node:fs';
import { SWAO_MCP_TOOLS } from '@swao/module-mcp';

// ESM-safe module mock for node:fs (#2951 tests need to control filesystem reads)
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readdirSync: vi.fn().mockReturnValue([]),
  };
});

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

describe('fetchPortfolioContext tool selection (#2789 #2951)', () => {
  const mockSession: McpSession = { sessionId: 'test', port: 3737 };
  const calledTools: string[] = [];
  const calledArgs: Array<Record<string, unknown>> = [];

  function mockFetch(): void {
    vi.stubGlobal('fetch', async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string) as { params?: { name?: string; arguments?: Record<string, unknown> } };
      if (body.params?.name) {
        calledTools.push(body.params.name);
        calledArgs.push(body.params.arguments ?? {});
      }
      return {
        ok: true,
        text: async () => 'data: {"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"data"}]}}\n',
      };
    });
  }

  beforeEach(() => {
    calledTools.length = 0;
    calledArgs.length = 0;
    mockFetch();
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([]);
  });
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

  it('portfolio mode with no assessed apps shows empty-state message and calls only global tools (#2951)', async () => {
    // existsSync returns false by default (wsp/runs/ not found)
    const ctx = await fetchPortfolioContext(mockSession, '/ws');
    expect(calledTools).toEqual([
      'swao_workspace_inventory',
      'swao_portfolio_summary',
      'swao_portfolio_lz',
      'swao_list_directory',
      'swao_read_file',
    ]);
    expect(ctx).toContain('No completed assessments found');
    expect(ctx).toContain('swao assess');
  });

  it('portfolio mode with two assessed apps calls per-app tools for each app (#2951)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'app-a', isDirectory: () => true },
      { name: 'app-b', isDirectory: () => true },
    ] as unknown as ReturnType<typeof readdirSync>);

    await fetchPortfolioContext(mockSession, '/ws');

    const signalsCalls = calledArgs.filter((_, i) => calledTools[i] === 'swao_signals');
    const risksCalls   = calledArgs.filter((_, i) => calledTools[i] === 'swao_risks');
    expect(signalsCalls).toHaveLength(2);
    expect(risksCalls).toHaveLength(2);
    expect(signalsCalls[0]).toMatchObject({ app_id: 'app-a' });
    expect(signalsCalls[1]).toMatchObject({ app_id: 'app-b' });
  });

  it('explicit --app scopes to that single app only (#2951)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'app-a', isDirectory: () => true },
      { name: 'app-b', isDirectory: () => true },
    ] as unknown as ReturnType<typeof readdirSync>);

    await fetchPortfolioContext(mockSession, '/ws', 'app-a');

    const signalsCalls = calledArgs.filter((_, i) => calledTools[i] === 'swao_signals');
    expect(signalsCalls).toHaveLength(1);
    expect(signalsCalls[0]).toMatchObject({ app_id: 'app-a' });
  });

  it('swao_signals and swao_risks include app_id in args when app is resolved (#2951)', async () => {
    await fetchPortfolioContext(mockSession, '/ws', 'sovereign-health');

    const signalsArgs = calledArgs.find((_, i) => calledTools[i] === 'swao_signals');
    const risksArgs   = calledArgs.find((_, i) => calledTools[i] === 'swao_risks');
    expect(signalsArgs).toMatchObject({ workspace_path: '/ws', app_id: 'sovereign-health' });
    expect(risksArgs).toMatchObject({ workspace_path: '/ws', app_id: 'sovereign-health' });
  });
});

describe('listAssessedApps (#2951)', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([]);
  });

  it('returns directory names from wsp/runs/', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'app-a', isDirectory: () => true },
      { name: 'app-b', isDirectory: () => true },
    ] as unknown as ReturnType<typeof readdirSync>);
    expect(listAssessedApps('/workspace')).toEqual(['app-a', 'app-b']);
  });

  it('returns empty array when wsp/runs/ does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(listAssessedApps('/workspace')).toEqual([]);
  });

  it('filters out non-directory entries', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'app-a', isDirectory: () => true },
      { name: 'README.md', isDirectory: () => false },
    ] as unknown as ReturnType<typeof readdirSync>);
    expect(listAssessedApps('/workspace')).toEqual(['app-a']);
  });
});

describe('listMcpTools (#2915)', () => {
  const mockSession: McpSession = { sessionId: 'test', port: 3737 };

  afterEach(() => { vi.unstubAllGlobals(); });

  it('converts MCP inputSchema to Anthropic input_schema format', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      text: async () => 'data: ' + JSON.stringify({
        jsonrpc: '2.0',
        result: {
          tools: [
            { name: 'swao_risks', description: 'Get risks', inputSchema: { type: 'object', properties: { app_id: { type: 'string' } } } },
            { name: 'swao_signals', description: 'Get signals', inputSchema: { type: 'object', properties: {} } },
          ],
        },
      }) + '\n',
    }));

    const tools = await listMcpTools(mockSession);
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('swao_risks');
    expect(tools[0].description).toBe('Get risks');
    expect(tools[0].input_schema).toMatchObject({ type: 'object' });
    expect(tools[1].name).toBe('swao_signals');
  });

  it('throws with the reason on HTTP failure (#3315)', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, text: async () => 'error' }));
    await expect(listMcpTools(mockSession)).rejects.toThrow('tools/list HTTP 500: error');
  });

  it('returns empty array when tools/list result has no tools array', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      text: async () => 'data: {"jsonrpc":"2.0","result":{}}\n',
    }));
    const tools = await listMcpTools(mockSession);
    expect(tools).toEqual([]);
  });

  it('processes all SWAO_MCP_TOOLS entries without filtering (#2913 regression guard)', async () => {
    // Guards against future changes to listMcpTools() that would silently drop
    // tools from the manifest. The SWAO MCP server returns the same tool set to
    // all clients unconditionally (verified at server.ts:3961); listMcpTools()
    // must not filter that set.
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      text: async () => 'data: ' + JSON.stringify({
        jsonrpc: '2.0',
        result: {
          tools: SWAO_MCP_TOOLS.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      }) + '\n',
    }));

    const tools = await listMcpTools(mockSession);
    expect(tools).toHaveLength(SWAO_MCP_TOOLS.length);
    const returnedNames = new Set(tools.map(t => t.name));
    for (const { name } of SWAO_MCP_TOOLS) {
      expect(returnedNames.has(name), `"${name}" missing from listMcpTools output`).toBe(true);
    }
  });
});

describe('callMcpTool request ids, streamed responses and timeout (#3310)', () => {
  const mockSession: McpSession = { sessionId: 'test', port: 3737 };

  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('gives parallel calls in the same millisecond distinct JSON-RPC ids', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const ids: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(String(opts.body)) as { id: unknown; params: { name: string } };
      ids.push(body.id);
      return {
        ok: true,
        text: async () => 'data: ' + JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: body.params.name }] } }) + '\n',
      };
    });
    const out = await Promise.all(['swao_a', 'swao_b', 'swao_c'].map(n => callMcpTool(mockSession, n, {})));
    expect(out).toEqual(['swao_a', 'swao_b', 'swao_c']);
    expect(new Set(ids).size).toBe(3);
  });

  it('returns the tool result when notifications precede it on the stream', async () => {
    let id: unknown;
    vi.stubGlobal('fetch', async (_url: string, opts: RequestInit) => {
      id = (JSON.parse(String(opts.body)) as { id: unknown }).id;
      return {
        ok: true,
        text: async () => [
          'data: ' + JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 1, progress: 1 } }),
          'data: ' + JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'warning', data: '[WARN] x' } }),
          'data: ' + JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'the result' }] } }),
        ].join('\n\n') + '\n',
      };
    });
    expect(await callMcpTool(mockSession, 'swao_x', {})).toBe('the result');
  });

  it('pickRpcResponse prefers the response with the request id and passes single messages through', () => {
    const a = { jsonrpc: '2.0', id: 1, result: { content: [] } };
    const b = { jsonrpc: '2.0', id: 2, result: { content: [] } };
    expect(pickRpcResponse([a, b], 2)).toBe(b);
    expect(pickRpcResponse([{ method: 'notifications/progress' }, a], 9)).toBe(a);
    expect(pickRpcResponse(a, 2)).toBe(a);
    expect(pickRpcResponse([{ method: 'notifications/progress' }], 1)).toBeNull();
  });

  it('allows a tool call the server-side 5-minute CLI limit', async () => {
    expect(MCP_TOOL_CALL_TIMEOUT_MS).toBe(300_000);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => 'data: {"jsonrpc":"2.0","id":1,"result":{"content":[]}}\n' }));
    await callMcpTool(mockSession, 'swao_service_research_run', {});
    expect(timeout).toHaveBeenCalledWith(300_000);
  });
});

describe('MCP transport and parse failures surface as [MCP error: ...] (#3315)', () => {
  const mockSession: McpSession = { sessionId: 'test', port: 3737 };

  afterEach(() => { vi.unstubAllGlobals(); });

  function refused(): Error {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3737'), { code: 'ECONNREFUSED' });
    return new TypeError('fetch failed', { cause });
  }

  it('callMcpTool reports a refused connection instead of throwing or returning empty text', async () => {
    vi.stubGlobal('fetch', async () => { throw refused(); });
    const text = await callMcpTool(mockSession, 'swao_risks', {});
    expect(text).toBe('[MCP error: swao_risks request failed: fetch failed (ECONNREFUSED)]');
    expect(isMcpError(text)).toBe(true);
  });

  it('callMcpTool reports a timeout', async () => {
    vi.stubGlobal('fetch', async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); });
    expect(await callMcpTool(mockSession, 'swao_risks', {}, 1234)).toBe('[MCP error: swao_risks request failed: no response within 1234 ms]');
  });

  it('callMcpTool reports an HTTP error status with a body excerpt', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404, text: async () => '{"error":"Session not found"}' }));
    expect(await callMcpTool(mockSession, 'swao_risks', {})).toBe('[MCP error: swao_risks HTTP 404: {"error":"Session not found"}]');
  });

  it('callMcpTool reports an unparseable body', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, text: async () => 'data: {not json\n' }));
    const text = await callMcpTool(mockSession, 'swao_risks', {});
    expect(text).toMatch(/^\[MCP error: swao_risks response is not valid JSON-RPC: data: \{not json\]$/);
  });

  it('callMcpTool reports a stream without the response to its request', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true, status: 200,
      text: async () => 'data: ' + JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} }) + '\n',
    }));
    expect(await callMcpTool(mockSession, 'swao_risks', {})).toMatch(/^\[MCP error: swao_risks response has no result for request id \d+: /);
  });

  it('callMcpTool still returns empty text for a valid result without text content', async () => {
    vi.stubGlobal('fetch', async (_u: string, opts: RequestInit) => {
      const id = (JSON.parse(String(opts.body)) as { id: number }).id;
      return { ok: true, status: 200, text: async () => 'data: ' + JSON.stringify({ jsonrpc: '2.0', id, result: { content: [] } }) + '\n' };
    });
    expect(await callMcpTool(mockSession, 'swao_risks', {})).toBe('');
  });

  it('listMcpTools throws on a refused connection, an unparseable body and a JSON-RPC error', async () => {
    vi.stubGlobal('fetch', async () => { throw refused(); });
    await expect(listMcpTools(mockSession)).rejects.toThrow('tools/list request failed: fetch failed (ECONNREFUSED)');
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, text: async () => '<html>proxy</html>' }));
    await expect(listMcpTools(mockSession)).rejects.toThrow('tools/list response is not valid JSON-RPC: <html>proxy</html>');
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, text: async () => 'data: {"jsonrpc":"2.0","error":{"code":-32600,"message":"Bad Request"}}\n' }));
    await expect(listMcpTools(mockSession)).rejects.toThrow('tools/list: Bad Request');
  });

  it('initMcpSession names the failure instead of a bare "fetch failed"', async () => {
    vi.stubGlobal('fetch', async () => { throw refused(); });
    await expect(initMcpSession(3737, 100)).rejects.toThrow('MCP initialize on port 3737 failed: fetch failed (ECONNREFUSED)');
  });

  it('fetchPortfolioContext skips failed sections instead of writing errors into the prompt', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.stubGlobal('fetch', async (_u: string, opts: RequestInit) => {
      const body = JSON.parse(String(opts.body)) as { id: number; params: { name: string } };
      if (body.params.name === 'swao_portfolio_summary') throw refused();
      return { ok: true, status: 200, text: async () => 'data: ' + JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: `ok ${body.params.name}` }] } }) + '\n' };
    });
    const errors: Array<[string, string]> = [];
    const ctx = await fetchPortfolioContext(mockSession, '/ws', undefined, (label, error) => errors.push([label, error]));
    expect(ctx).toContain('ok swao_workspace_inventory');
    expect(ctx).not.toContain('Portfolio Summary');
    expect(ctx).not.toContain('MCP error');
    // The skipped section is reported to the caller for the chat log.
    expect(errors).toEqual([['Portfolio Summary', '[MCP error: swao_portfolio_summary request failed: fetch failed (ECONNREFUSED)]']]);
  });
});

describe('mcpExitReason (#3314)', () => {
  it('reports the licence gate lines of a refused swao mcp', () => {
    const stderr = '[LICENSE] swao mcp requires an Enterprise licence.\nYour current tier: community\n\nTo upgrade: swao license request --tier enterprise\nContact: https://github.com/Accenture/SWAO/discussions\n';
    expect(mcpExitReason(stderr, 1, null)).toBe('swao mcp exited (exit code 1): [LICENSE] swao mcp requires an Enterprise licence. Your current tier: community');
  });

  it('falls back to the first error line, then to the exit code', () => {
    expect(mcpExitReason('starting\nError: listen EADDRINUSE :::3737\n    at x\n', 1, null)).toBe('swao mcp exited (exit code 1): Error: listen EADDRINUSE :::3737');
    expect(mcpExitReason('', null, 'SIGTERM')).toBe('swao mcp exited (signal SIGTERM)');
  });
});
