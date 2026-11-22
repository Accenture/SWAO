// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Health check module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * #4392 (Design 116 section 12.5): probe of the HTTP MCP endpoint that Claude
 * Code and the Claude Desktop Code tab use (`http://localhost:3737/mcp`,
 * ADR-0045). Reachable or not; when a SWAO MCP server answers, its version,
 * PID, workspace (with its source) and binary.
 *
 * No new endpoint: the server has no unauthenticated info route, and adding one
 * would widen the surface. The probe is an ordinary MCP client: `initialize`
 * (serverInfo name and version, the X-SWAO-MCP-PID header), then
 * `notifications/initialized`, then a `tools/call` of the `swao` welcome tool,
 * whose server block names the workspace and the binary (module-mcp
 * server.ts welcomeServerBlock), then DELETE of the probe session. Any MCP
 * client on localhost can read the same welcome text.
 *
 * Informational only: a server that is not running never changes the verdict
 * (it is optional; the TUI or `swao mcp --http` starts it).
 */

/** Default HTTP port of `swao mcp --http` (ADR-0045). */
export const MCP_HTTP_DEFAULT_PORT = 3737;

/** Response header naming the serving PID (module-mcp http-transport.ts SWAO_PID_HEADER). */
const SWAO_PID_HEADER = 'x-swao-mcp-pid';

/**
 * The welcome lines the probe reads back. Same expressions as module-mcp
 * welcome-server-block.test.ts, which pins the format on the server side.
 */
export const WELCOME_WORKSPACE_RE = /^ {2}Workspace : (.+)$/m;
export const WELCOME_BINARY_RE = /^ {2}Binary {4}: (.+)$/m;

export type McpHttpProbeStatus = 'reachable' | 'not_reachable' | 'not_swao';

export interface McpHttpProbeResult {
  status: McpHttpProbeStatus;
  url: string;
  /** serverInfo.version of the answering SWAO MCP server. */
  version?: string;
  pid?: number;
  /** The Workspace line of the welcome screen: `<path> (<source>)` or `none: ...`. */
  workspace?: string;
  binary?: string;
  /** Why the endpoint is not reachable or not SWAO. */
  reason?: string;
}

export interface McpHttpProbeOptions {
  port?: number;
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Per request. */
  timeoutMs?: number;
}

/** Picks the JSON-RPC response from a JSON or SSE body. */
function parseRpcBody(body: string): unknown {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed); } catch { return undefined; }
  }
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    try { return JSON.parse(line.slice(5).trim()); } catch { /* next line */ }
  }
  return undefined;
}

function describeError(err: unknown): string {
  const cause = (err as { cause?: { code?: unknown } } | undefined)?.cause;
  if (cause && typeof cause.code === 'string') return cause.code;
  if (err instanceof Error && err.name === 'TimeoutError') return 'timeout';
  return err instanceof Error ? err.message : String(err);
}

export async function probeMcpHttpEndpoint(opts: McpHttpProbeOptions = {}): Promise<McpHttpProbeResult> {
  const port = opts.port ?? MCP_HTTP_DEFAULT_PORT;
  const url = `http://localhost:${port}/mcp`;
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 2000;
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const post = (body: unknown, sessionId?: string): Promise<Response> => doFetch(url, {
    method: 'POST',
    headers: sessionId ? { ...headers, 'mcp-session-id': sessionId } : headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  let init: Response;
  try {
    init = await post({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'swao-health-check', version: '1' } },
    });
  } catch (err) {
    return { status: 'not_reachable', url, reason: describeError(err) };
  }
  let initBody = '';
  try { initBody = await init.text(); } catch { /* treated as no answer */ }
  const parsed = parseRpcBody(initBody) as { result?: { serverInfo?: { name?: unknown; version?: unknown } } } | undefined;
  const info = parsed?.result?.serverInfo;
  if (info?.name !== 'swao') return { status: 'not_swao', url, reason: `HTTP ${init.status}, not a SWAO MCP server` };

  const pidHeader = init.headers.get(SWAO_PID_HEADER);
  const result: McpHttpProbeResult = {
    status: 'reachable',
    url,
    ...(typeof info.version === 'string' ? { version: info.version } : {}),
    ...(pidHeader && /^\d+$/.test(pidHeader) ? { pid: Number(pidHeader) } : {}),
  };
  const sessionId = init.headers.get('mcp-session-id') ?? undefined;
  if (!sessionId) return result;
  try {
    await (await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId)).text();
    const call = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'swao', arguments: {} } }, sessionId);
    const welcome = parseRpcBody(await call.text()) as { result?: { content?: Array<{ text?: unknown }> } } | undefined;
    const text = (welcome?.result?.content ?? []).map((c) => (typeof c.text === 'string' ? c.text : '')).join('\n');
    const ws = WELCOME_WORKSPACE_RE.exec(text)?.[1];
    const bin = WELCOME_BINARY_RE.exec(text)?.[1];
    if (ws) result.workspace = ws.trim();
    if (bin) result.binary = bin.trim();
  } catch {
    // A server without the welcome tool in its profile, or a slow answer: reachable is still true.
  } finally {
    try {
      await (await doFetch(url, { method: 'DELETE', headers: { 'mcp-session-id': sessionId }, signal: AbortSignal.timeout(timeoutMs) })).text();
    } catch { /* best effort */ }
  }
  return result;
}

/** The continuation line under the SWAO-MCP probe line. */
export function formatMcpHttpProbeDetail(r: McpHttpProbeResult): string[] {
  const indent = '          ';
  switch (r.status) {
    case 'reachable': {
      const head = `${indent}HTTP endpoint ${r.url}: reachable, SWAO ${r.version ?? 'unknown version'}${r.pid !== undefined ? `, pid ${r.pid}` : ''}`;
      return [
        head,
        ...(r.workspace ? [`${indent}  workspace: ${r.workspace}`] : []),
        ...(r.binary ? [`${indent}  binary: ${r.binary}`] : []),
      ];
    }
    case 'not_swao':
      return [`${indent}HTTP endpoint ${r.url}: another program answers (${r.reason ?? 'not a SWAO MCP server'})`];
    case 'not_reachable':
      return [`${indent}HTTP endpoint ${r.url}: not running (${r.reason ?? 'no answer'}); open the SWAO TUI or run swao mcp --http (Enterprise)`];
  }
}
