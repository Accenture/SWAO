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

// MCP HTTP probe + tool call helpers for the Chat screen (#2781).
//
// The SWAO MCP server uses StreamableHTTPServerTransport (MCP SDK).
// Protocol: POST /mcp with JSON-RPC 2.0; response is text/event-stream;
// session token passed via mcp-session-id header after initialize.
//
// All exported functions are pure async -- no React, no singletons --
// so they are testable in isolation against a mock fetch.

/** Parse SSE response body: extract and join all "data: ..." lines. */
export function parseSseBody(body: string): string {
  const parts: string[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trimEnd();
    if (trimmed.startsWith('data:')) {
      const payload = trimmed.slice(5).trim();
      if (payload && payload !== '[DONE]') parts.push(payload);
    }
  }
  if (parts.length === 0) return body;  // not SSE -- return as-is
  if (parts.length === 1) return parts[0];
  return '[' + parts.join(',') + ']';  // chunked streaming -- wrap as array
}

/** Extract text content from a tools/call MCP result object. */
export function extractToolText(json: unknown): string {
  if (!json || typeof json !== 'object') return '';
  const obj = json as Record<string, unknown>;
  // JSON-RPC success: { result: { content: [{ type, text }] } }
  const result = obj['result'];
  if (result && typeof result === 'object') {
    const content = (result as Record<string, unknown>)['content'];
    if (Array.isArray(content)) {
      return content
        .filter((c): c is { text: string } => typeof c === 'object' && c !== null && typeof (c as { text?: unknown }).text === 'string')
        .map(c => c.text)
        .join('\n');
    }
  }
  // JSON-RPC error
  const error = obj['error'];
  if (error && typeof error === 'object') {
    const msg = (error as Record<string, unknown>)['message'];
    if (typeof msg === 'string') return `[MCP error: ${msg}]`;
  }
  return '';
}

export interface McpSession {
  sessionId: string;
  port: number;
}

/**
 * Initialize an MCP session against the running HTTP server.
 * Returns a session token on success; throws on failure.
 */
export async function initMcpSession(port = 3737, timeoutMs = 5000): Promise<McpSession> {
  const url = `http://localhost:${port}/mcp`;
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'swao-chat', version: '1.1.0' },
    },
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) throw new Error(`MCP initialize HTTP ${resp.status}`);
  const sessionId = resp.headers.get('mcp-session-id');
  if (!sessionId) throw new Error('MCP initialize: no mcp-session-id in response');

  // Consume response body (required by fetch)
  await resp.text();

  // Send notifications/initialized (non-fatal if it fails)
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      signal: AbortSignal.timeout(3000),
    });
  } catch { /* non-fatal */ }

  return { sessionId, port };
}

/** Call a single MCP tool; returns the text output or empty string on error. */
export async function callMcpTool(
  session: McpSession,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<string> {
  const url = `http://localhost:${session.port}/mcp`;
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': session.sessionId,
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) return '';
  const text = await resp.text();
  const jsonStr = parseSseBody(text);
  try {
    return extractToolText(JSON.parse(jsonStr));
  } catch {
    return '';
  }
}

/**
 * Collect portfolio context from existing MCP tools. Gracefully skips failures.
 *
 * Tool selection rationale (#2789 revised):
 * - swao_workspace_inventory: app list, ingested files, installed frameworks, run history
 * - swao_portfolio_summary:   cross-app 7R verdicts, coverage/portability scores
 *   (replaces swao_hub which is a write action that generates HTML, not a read tool)
 * - swao_signals:             complete signals + evidence per app
 * - swao_risks:               risk register per app
 * - swao_portfolio_lz:        LZ readiness rollup across all apps
 *   (replaces swao_lz_fit which requires provider+region -- unavailable at session init)
 *
 * All consumers of the MCP server (SWAO chat, Claude Desktop, etc.) benefit from
 * improvements to the existing tools rather than adding parallel WSP-dump tools.
 */
export async function fetchPortfolioContext(
  session: McpSession,
  workspace: string,
  appId?: string,
): Promise<string> {
  const baseArgs: Record<string, unknown> = { workspace_path: workspace };
  const appArgs: Record<string, unknown> = appId
    ? { workspace_path: workspace, app_id: appId }
    : baseArgs;

  const sections: Array<{ label: string; toolName: string; args: Record<string, unknown> }> = [
    { label: 'Workspace Inventory',    toolName: 'swao_workspace_inventory', args: baseArgs },
    { label: 'Portfolio Summary',      toolName: 'swao_portfolio_summary',   args: baseArgs },
    { label: 'Signals and Findings',   toolName: 'swao_signals',             args: appArgs  },
    { label: 'Risk Register',          toolName: 'swao_risks',               args: appArgs  },
    { label: 'Landing Zone Readiness', toolName: 'swao_portfolio_lz',        args: baseArgs },
  ];

  const parts: string[] = [];
  for (const { label, toolName, args } of sections) {
    try {
      const text = await callMcpTool(session, toolName, args, 15_000);
      if (text.trim()) parts.push(`## ${label}\n${text.trim()}`);
    } catch { /* graceful skip */ }
  }

  return parts.join('\n\n');
}

/**
 * Build the system prompt. If context is empty (MCP unavailable),
 * falls back to a generic SWAO advisor prompt.
 * Fixes #2786 (JSON responses) and #2787 (English-only responses).
 */
export function buildSystemPrompt(context: string): string {
  const intro = [
    'You are SWAO Portfolio Advisor, an expert assistant embedded in the Sovereign',
    'Workload Assessment and Onboarding platform.',
    '',
    'You help cloud migration architects and engagement managers understand and act',
    'on SWAO assessment results for their portfolio of applications.',
  ].join('\n');

  const guidelines = [
    'INTERACTION GUIDELINES',
    '======================',
    '- Be concise and specific; reference actual findings, risks, and scores when relevant.',
    '- Use the portfolio context below to answer questions; do not make up assessment data.',
    "- When asked about an app not in the context, say you don't have data for it.",
    '- Suggest next steps based on SWAO workflow: assess -> report -> publish -> challenge.',
    '- Keep answers actionable for the engagement team.',
  ].join('\n');

  const responseFormat = [
    'RESPONSE FORMAT (follow strictly)',
    '==================================',
    '- Write in natural language prose.',
    '- NEVER output JSON, YAML, XML, code blocks, or any structured data format',
    '  unless the user explicitly asks for raw data (e.g. "show me the JSON").',
    '- Do not wrap answers in a status object, error object, or any other envelope.',
    '- NEVER respond with {"error":...}, {"reason":...}, or any JSON refusal object.',
    '  If you cannot answer something, say so plainly in one sentence of prose.',
    '- One to three short paragraphs per answer is the target length.',
  ].join('\n');

  const languageRules = [
    'LANGUAGE',
    '=========',
    '- Detect the language of the user\'s message and respond in that same language.',
    '- If the user writes in German, respond in German including correct Umlauts',
    '  (a-Umlaut, o-Umlaut, u-Umlaut, sz/ss).',
    '- If the user writes in French, Spanish, Dutch, or any other language, respond',
    '  in kind.',
    '- Default to English only when the user\'s language is ambiguous or mixed.',
    '- NEVER claim to be restricted to a single language or refuse to respond in',
    '  the user\'s language.',
  ].join('\n');

  // Repeated at the very end so it is the last instruction the model reads
  // before generating a reply (#2786 follow-up: history poisoning prevention).
  const finalReminder = 'REMEMBER: plain text prose only. Never output JSON.';

  const sections = `${intro}\n\n${guidelines}\n\n${responseFormat}\n\n${languageRules}`;

  if (context.trim()) {
    return `${sections}\n\nPORTFOLIO CONTEXT\n=================\n${context.trim()}\n\n${finalReminder}`;
  }

  return `${sections}\n\nNote: No portfolio context is available. Answer general SWAO questions and suggest running \`swao assess\` to load assessment data.\n\n${finalReminder}`;
}
