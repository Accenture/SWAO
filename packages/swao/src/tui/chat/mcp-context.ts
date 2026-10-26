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

// MCP HTTP probe + tool call helpers for the Chat screen (#2781 #2915).
//
// The SWAO MCP server uses StreamableHTTPServerTransport (MCP SDK).
// Protocol: POST /mcp with JSON-RPC 2.0; response is text/event-stream;
// session token passed via mcp-session-id header after initialize.
//
// All exported functions are pure async -- no React, no singletons --
// so they are testable in isolation against a mock fetch. autoStartMcpServer
// (#3314) spawns the server; its spawned-process test sandboxes HOME.

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import type { LlmTool } from '@swao/module-llm-providers';
import { isSignalIndexLine } from '@swao/core';

/**
 * #3315: transport and parse failures are reported as `[MCP error: ...]`, the
 * same form extractToolText uses for JSON-RPC errors, so the model and the
 * chat log see why a call failed instead of an empty result (an SDK client
 * such as Claude Desktop raises an error in the same cases).
 */
export function mcpError(message: string): string {
  return `[MCP error: ${message}]`;
}

/** True when a callMcpTool result is an `[MCP error: ...]` report (#3315). */
export function isMcpError(text: string): boolean {
  return text.startsWith('[MCP error:');
}

/** One-line description of a fetch rejection: timeout, or message plus cause (#3315). */
export function describeFetchError(err: unknown, timeoutMs: number): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return `no response within ${timeoutMs} ms`;
    const cause = (err as { cause?: unknown }).cause;
    const code = cause instanceof Error ? (cause as { code?: unknown }).code : undefined;
    const causeText = cause instanceof Error ? (code !== undefined ? String(code) : cause.message) : undefined;
    return causeText && !err.message.includes(causeText) ? `${err.message} (${causeText})` : err.message;
  }
  return String(err);
}

/** Short single-line excerpt of a response body for error messages (#3315). */
function bodySnippet(body: string, max = 160): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (!flat) return '(empty body)';
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

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

/**
 * JSON-RPC request ids (#3310). Monotonic per process, never Date.now(): the
 * open-LLM tool loop runs a turn's tool calls in parallel, and two requests in
 * the same millisecond with one id collide in the server's request-to-stream
 * mapping of the session (one call then receives the other call's result).
 */
let rpcIdCounter = 0;
function nextRpcId(): number {
  rpcIdCounter += 1;
  return rpcIdCounter;
}

/**
 * The JSON-RPC response for request `id` from a parsed tools/* body (#3310).
 * A streamed response may carry notifications (progress, logging) before the
 * response; parseSseBody then yields an array, and the response is the
 * message with this id (or, failing that, the one with a result or error).
 */
export function pickRpcResponse(parsed: unknown, id: number): unknown {
  if (!Array.isArray(parsed)) return parsed;
  const isResponse = (m: unknown): m is Record<string, unknown> =>
    !!m && typeof m === 'object' && ('result' in m || 'error' in m);
  return parsed.find(m => isResponse(m) && m['id'] === id) ?? parsed.find(isResponse) ?? null;
}

/**
 * Chat's limit for one MCP tool call (#3310). The action tools spawn the CLI
 * with the server's own 5-minute limit (swao_service_research_run,
 * swao_service_init, swao_service_export); the former 30 s client limit made
 * SWAO Chat abort such calls long before the server's own limit.
 */
export const MCP_TOOL_CALL_TIMEOUT_MS = 300_000;

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

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // #3315: name the failure (refused, timeout) instead of a bare "fetch failed".
    throw new Error(`MCP initialize on port ${port} failed: ${describeFetchError(err, timeoutMs)}`);
  }

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

/**
 * Call a single MCP tool; returns the text output. A failed request, an HTTP
 * error status, an unparseable body or a body without the response for this
 * request returns `[MCP error: ...]` (#3315), never empty text; a JSON-RPC
 * error does the same through extractToolText. Empty text means the tool
 * returned no text content.
 */
export async function callMcpTool(
  session: McpSession,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = MCP_TOOL_CALL_TIMEOUT_MS,
): Promise<string> {
  const url = `http://localhost:${session.port}/mcp`;
  const id = nextRpcId();
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  });

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': session.sessionId,
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return mcpError(`${toolName} request failed: ${describeFetchError(err, timeoutMs)}`);
  }

  let text: string;
  try {
    text = await resp.text();
  } catch (err) {
    return mcpError(`${toolName} response could not be read: ${describeFetchError(err, timeoutMs)}`);
  }
  if (!resp.ok) return mcpError(`${toolName} HTTP ${resp.status}: ${bodySnippet(text)}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(parseSseBody(text));
  } catch {
    return mcpError(`${toolName} response is not valid JSON-RPC: ${bodySnippet(text)}`);
  }
  const message = pickRpcResponse(parsed, id);
  if (!message || typeof message !== 'object' || !('result' in message || 'error' in message)) {
    return mcpError(`${toolName} response has no result for request id ${id}: ${bodySnippet(text)}`);
  }
  return extractToolText(message);
}

/**
 * Fetch the full tool manifest from the MCP server (#2915).
 *
 * Mirrors what Claude Desktop does at session start: calls tools/list and
 * converts MCP tool definitions (inputSchema) to Anthropic format (input_schema)
 * so they can be passed directly to the Anthropic Messages API.
 * #3315: a failed request, an HTTP error status, an unparseable body or a
 * JSON-RPC error throws with the reason (the caller reports it as
 * `[MCP error: ...]`); a valid result without tools returns an empty array.
 */
export async function listMcpTools(session: McpSession, timeoutMs = 10_000): Promise<LlmTool[]> {
  const url = `http://localhost:${session.port}/mcp`;
  const id = nextRpcId();
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/list',
    params: {},
  });

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': session.sessionId,
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(`tools/list request failed: ${describeFetchError(err, timeoutMs)}`);
  }
  const text = await resp.text();
  if (!resp.ok) throw new Error(`tools/list HTTP ${resp.status}: ${bodySnippet(text)}`);
  let parsed: {
    result?: {
      tools?: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
      }>;
    };
    error?: { message?: unknown };
  } | null;
  try {
    parsed = pickRpcResponse(JSON.parse(parseSseBody(text)), id) as typeof parsed;
  } catch {
    throw new Error(`tools/list response is not valid JSON-RPC: ${bodySnippet(text)}`);
  }
  if (parsed?.error) throw new Error(`tools/list: ${String(parsed.error.message ?? 'JSON-RPC error')}`);
  const tools = parsed?.result?.tools ?? [];
  return tools.map(t => ({
    name: t.name,
    description: t.description ?? '',
    input_schema: t.inputSchema ?? { type: 'object', properties: {} },
  }));
}

/**
 * How long SWAO Chat waits for an auto-started `swao mcp --http` to answer
 * (#3314). The probe polls, so a server that is up returns at once; a child
 * that exits (licence gate, port error) ends the wait at once with its reason.
 * Only a server that neither answers nor exits uses the full limit.
 */
export const MCP_AUTO_START_TIMEOUT_MS = 20_000;

/** Kill a child process and its descendants by PID (#3314). */
export function treeKillChild(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
  } catch { /* already gone */ }
}

/**
 * Why an auto-started `swao mcp` exited (#3314): the [LICENSE] lines when the
 * licence gate refused it, else the first error line of its stderr, else the
 * exit code.
 */
export function mcpExitReason(stderr: string, code: number | null, signal: NodeJS.Signals | null): string {
  const lines = stderr.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const exit = code !== null ? `exit code ${code}` : `signal ${signal ?? 'unknown'}`;
  const lic = lines.findIndex(l => l.startsWith('[LICENSE]'));
  if (lic >= 0) {
    const tier = lines[lic + 1]?.startsWith('Your current tier') ? ` ${lines[lic + 1]}` : '';
    return `swao mcp exited (${exit}): ${lines[lic]}${tier}`;
  }
  const detail = lines.find(l => /error/i.test(l)) ?? lines[lines.length - 1];
  return detail ? `swao mcp exited (${exit}): ${detail.slice(0, 300)}` : `swao mcp exited (${exit})`;
}

/**
 * #3461: stderr of a `swao mcp --http` that found a SWAO MCP server already on
 * its port (module-mcp http-transport.ts alreadyRunningMessage).
 */
export const MCP_ALREADY_RUNNING_RE = /a SWAO MCP server is already running on port \d+/;

export interface McpAutoStartOptions {
  /** Executable (the SWAO binary, or node on a source run). */
  command: string;
  /** Arguments, ending in `mcp --http --port <port>`. */
  args: string[];
  port: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  timeoutMs?: number;
  pollMs?: number;
  /** Called right after spawn (the TUI registers the child for exit cleanup). */
  onSpawn?: (child: ChildProcess) => void;
}

export interface McpAutoStartResult {
  session: McpSession | null;
  /** The running server child; null when it exited or was killed. */
  child: ChildProcess | null;
  /** Why no session was established (reported as `[MCP error: ...]`). */
  error?: string;
}

/**
 * Start `swao mcp --http` for SWAO Chat and wait for it to answer (#3314).
 * The child's stderr is read for its whole lifetime (so a long-running server
 * never blocks on a full pipe) and kept as a short tail. When the child exits
 * before answering (for example the Enterprise licence gate refuses it), the
 * wait ends at once with the reason from its stderr and exit code, instead of
 * the former fixed 5 s + 4 s wait. A child that does not answer within the
 * limit is tree-killed by PID, so no process is left behind.
 */
export async function autoStartMcpServer(opts: McpAutoStartOptions): Promise<McpAutoStartResult> {
  const timeoutMs = opts.timeoutMs ?? MCP_AUTO_START_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? 500;
  let child: ChildProcess;
  try {
    child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: false,
      windowsHide: true,
    });
  } catch (err) {
    return { session: null, child: null, error: `swao mcp could not be started: ${err instanceof Error ? err.message : String(err)}` };
  }
  opts.onSpawn?.(child);

  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-8192); });

  const ended = new Promise<{ kind: 'ended'; reason: string }>(resolve => {
    child.once('error', err => resolve({ kind: 'ended', reason: `swao mcp could not be started: ${err.message}` }));
    child.once('close', (code, signal) => resolve({ kind: 'ended', reason: mcpExitReason(stderr, code, signal) }));
  });
  // #3461 (Design 116 REQ-03.6): a busy port no longer kills its holder; the
  // child exits 1 with "a SWAO MCP server is already running". That is
  // success: attach to the running server. The TUI does not own it (child null),
  // so closing the TUI leaves it running for the client that started it.
  const attachIfAlreadyRunning = async (reason: string): Promise<McpAutoStartResult> => {
    if (!MCP_ALREADY_RUNNING_RE.test(stderr)) return { session: null, child: null, error: reason };
    try {
      return { session: await initMcpSession(opts.port, 5000), child: null };
    } catch (err) {
      return { session: null, child: null, error: `${reason} (attach failed: ${err instanceof Error ? err.message : String(err)})` };
    }
  };

  const deadline = Date.now() + timeoutMs;
  let lastProbe = '';
  while (Date.now() < deadline) {
    const probeTimeout = Math.max(500, Math.min(2000, deadline - Date.now()));
    const probe = initMcpSession(opts.port, probeTimeout).then(
      session => ({ kind: 'probe' as const, session }),
      (err: unknown) => {
        lastProbe = err instanceof Error ? err.message : String(err);
        return { kind: 'probe' as const, session: null };
      },
    );
    const outcome = await Promise.race([probe, ended]);
    if (outcome.kind === 'ended') return attachIfAlreadyRunning(outcome.reason);
    if (outcome.session) return { session: outcome.session, child };
    const waited = await Promise.race([
      new Promise<{ kind: 'wait' }>(resolve => setTimeout(() => resolve({ kind: 'wait' }), pollMs)),
      ended,
    ]);
    if (waited.kind === 'ended') return attachIfAlreadyRunning(waited.reason);
  }

  treeKillChild(child);
  return {
    session: null,
    child: null,
    error: `MCP server did not answer on port ${opts.port} within ${Math.round(timeoutMs / 1000)} s${lastProbe ? ` (last probe: ${lastProbe})` : ''}`,
  };
}

/**
 * Returns app IDs that have at least one directory under wsp/runs/ (#2951).
 * Used to enumerate assessed apps for portfolio-mode context loading.
 */
export function listAssessedApps(workspace: string): string[] {
  const runsDir = join(workspace, 'wsp', 'runs');
  if (!existsSync(runsDir)) return [];
  try {
    return readdirSync(runsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return [];
  }
}

/**
 * Collect portfolio context from existing MCP tools. Gracefully skips failures.
 *
 * Tool selection rationale (#2789 revised, #2951):
 * - swao_workspace_inventory: app list, ingested files, installed frameworks, run history
 * - swao_portfolio_summary:   cross-app 7R verdicts, coverage/portability scores
 *   (replaces swao_hub which is a write action that generates HTML, not a read tool)
 * - swao_portfolio_lz:        LZ readiness rollup across all apps
 *   (replaces swao_lz_fit which requires provider+region -- unavailable at session init)
 * - swao_signals:             complete signals + evidence, called per assessed app
 * - swao_risks:               risk register, called per assessed app
 * - swao_read_challenge:      challenge findings, called per assessed app
 *
 * When appId is absent (portfolio mode), all assessed apps are enumerated from
 * wsp/runs/ and signals/risks/challenge are fetched for each. When appId is
 * provided, only that app is fetched (existing --app behaviour unchanged).
 */
export async function fetchPortfolioContext(
  session: McpSession,
  workspace: string,
  appId?: string,
  onError?: (label: string, error: string) => void,
): Promise<string> {
  const baseArgs: Record<string, unknown> = { workspace_path: workspace };

  // Portfolio-level tools: always fetched once, independent of app scope.
  const globalSections: Array<{ label: string; toolName: string; args: Record<string, unknown> }> = [
    { label: 'Workspace Inventory',    toolName: 'swao_workspace_inventory', args: baseArgs },
    { label: 'Portfolio Summary',      toolName: 'swao_portfolio_summary',   args: baseArgs },
    { label: 'Landing Zone Readiness', toolName: 'swao_portfolio_lz',        args: baseArgs },
    // #2792: workspace file tree + key config at session init
    { label: 'Workspace Files',        toolName: 'swao_list_directory',      args: {} },
    { label: 'Workspace Config',       toolName: 'swao_read_file',           args: { file_path: '.swao.yml' } },
  ];

  const parts: string[] = [];
  const indexLines: string[] = [];
  for (const { label, toolName, args } of globalSections) {
    try {
      const text = await callMcpTool(session, toolName, args, 15_000);
      // #3315: a failed section is skipped (graceful), not written into the
      // prompt; onError lets the caller record it in the chat log.
      if (isMcpError(text)) onError?.(label, text);
      else if (text.trim()) parts.push(`## ${label}\n${text.trim()}`);
    } catch { /* graceful skip */ }
  }

  // Per-app tools: signals, risks, challenge findings.
  // In portfolio mode (no --app), enumerate all apps that have been assessed.
  const appsToFetch = appId ? [appId] : listAssessedApps(workspace);

  if (appsToFetch.length === 0) {
    parts.push(
      '## Assessment Data\n' +
      '[No completed assessments found in this workspace. ' +
      'Run `swao assess` first to populate signals and risks.]',
    );
  } else {
    for (const id of appsToFetch) {
      const args: Record<string, unknown> = { workspace_path: workspace, app_id: id };
      const suffix = appsToFetch.length > 1 ? ` (${id})` : '';
      const appSections = [
        { label: `Signals and Findings${suffix}`, toolName: 'swao_signals'      },
        { label: `Risk Register${suffix}`,        toolName: 'swao_risks'        },
        // #2913 scoped: challenge findings so the model can answer stakeholder questions
        { label: `Challenge Findings${suffix}`,   toolName: 'swao_read_challenge' },
      ];
      for (const { label, toolName } of appSections) {
        try {
          const text = await callMcpTool(session, toolName, args, 15_000);
          if (isMcpError(text)) onError?.(label, text);
          else if (toolName === 'swao_signals' && text.trim()) {
            // #3418: the compact per-signal lines move to the protected index.
            const split = splitSignalIndex(text);
            indexLines.push(...split.index);
            if (split.rest.trim()) parts.push(`## ${label}\n${split.rest.trim()}`);
          } else if (text.trim()) parts.push(`## ${label}\n${text.trim()}`);
        } catch { /* graceful skip */ }
      }
    }
  }

  return assembleContext(parts, indexLines);
}

/** #2828: cap context size so the system prompt stays within the model's input window. */
export const MAX_CONTEXT_CHARS = 80_000;

const CONTEXT_TRUNCATED_NOTE =
  '\n\n[Context truncated to fit chat session limits. Use specific questions to query individual data.]';

const SIGNAL_INDEX_HEADING = 'Signal index (one line per signal)';

/** #3418: split swao_signals output into its compact index lines and the rest. */
export function splitSignalIndex(text: string): { index: string[]; rest: string } {
  const index: string[] = [];
  const rest: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (isSignalIndexLine(line)) index.push(line.trim());
    else if (line.trim() !== SIGNAL_INDEX_HEADING) rest.push(line);
  }
  return { index, rest: rest.join('\n') };
}

/**
 * #3418: share of the context the signal index may take (about 250 signals at
 * 80,000 characters). Below it every line is kept whole; above it whole lines
 * of the lowest severities are left out, with a note, so a large portfolio
 * cannot push the prompt past the model's window (#2828).
 */
export const SIGNAL_INDEX_SHARE = 0.6;

const INDEX_SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'informational', 'positive'];

function indexLineRank(line: string): number {
  const sev = /\| severity: (\S+)/.exec(line)?.[1] ?? '';
  const i = INDEX_SEVERITY_ORDER.indexOf(sev);
  return i >= 0 ? i : INDEX_SEVERITY_ORDER.length;
}

/** #3418: the index lines that fit `maxChars`, strongest severity first kept; original order preserved. */
export function capSignalIndex(lines: string[], maxChars: number): { lines: string[]; omitted: number } {
  const total = lines.reduce((n, l) => n + l.length + 1, 0);
  if (total <= maxChars) return { lines, omitted: 0 };
  const order = lines.map((l, i) => ({ i, r: indexLineRank(l) })).sort((a, b) => a.r - b.r || a.i - b.i);
  const keep = new Set<number>();
  let used = 0;
  for (const { i } of order) {
    const len = (lines[i] ?? '').length + 1;
    if (used + len > maxChars) break;
    keep.add(i);
    used += len;
  }
  return { lines: lines.filter((_, i) => keep.has(i)), omitted: lines.length - keep.size };
}

/**
 * #3418: the pre-fetched context. The signal index (one compact line per
 * signal: severity, confidence, evidence kind, detection, first evidence)
 * comes first and is never cut by the section truncation; only the remaining
 * sections are cut to the budget left after the index, so a truncated context
 * still carries the facts of every signal of every app (up to
 * SIGNAL_INDEX_SHARE of the budget, see capSignalIndex).
 */
export function assembleContext(parts: string[], indexLines: string[], maxChars = MAX_CONTEXT_CHARS): string {
  const kept = capSignalIndex(indexLines, Math.floor(maxChars * SIGNAL_INDEX_SHARE));
  const index = kept.lines.length > 0
    ? `## Signal Index (severity, confidence, evidence kind and detection as assessed)\n${kept.lines.join('\n')}` +
      (kept.omitted > 0
        ? `\n[${kept.omitted} lower-severity signal(s) omitted from this index to fit the chat context; call swao_signals with a prefix filter for them.]`
        : '')
    : '';
  const joined = parts.join('\n\n');
  const budget = Math.max(0, maxChars - (index ? index.length + 2 : 0));
  const rest = joined.length > budget ? joined.slice(0, budget) + CONTEXT_TRUNCATED_NOTE : joined;
  return [index, rest].filter((x) => x.length > 0).join('\n\n');
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

  // #3418: findings integrity. The chat states findings exactly as SWAO
  // assessed them; the answer post-check (applyFindingsIntegrity) appends a
  // deterministic note when an answer breaks these rules anyway.
  const findingsIntegrity = [
    'FINDINGS INTEGRITY (follow strictly)',
    '====================================',
    '- State every finding with the severity SWAO assessed. NEVER upgrade it: no stronger',
    '  severity word, no "critical" or "must be replaced" for a finding SWAO rated lower.',
    '- Name the signal ID and its evidence as file:line (the "first evidence" of the',
    '  Signal Index, or the Evidence lines of swao_signals / swao_signal_detail).',
    '- When the evidence kind is test-code, say that the finding is in test code; when it',
    '  is mixed, say that part of the evidence is test code. A severity shown as',
    '  "medium (assessed high)" was lowered because the evidence is test code only.',
    '- Mention the confidence of every finding you cite. For pattern-match detections and',
    '  for low or medium confidence, say the finding should be verified before acting.',
    '- A secret found in test code is still a finding. NEVER repeat a secret, password,',
    '  token or key value, even if it appears in the context; name only the file and line.',
    '- Do not add claims, impacts or deadlines that the signal does not state.',
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

  const sections = `${intro}\n\n${guidelines}\n\n${findingsIntegrity}\n\n${responseFormat}\n\n${languageRules}`;

  if (context.trim()) {
    return `${sections}\n\nPORTFOLIO CONTEXT\n=================\n${context.trim()}\n\n${finalReminder}`;
  }

  return `${sections}\n\nNote: No portfolio context is available. Answer general SWAO questions and suggest running \`swao assess\` to load assessment data.\n\n${finalReminder}`;
}
