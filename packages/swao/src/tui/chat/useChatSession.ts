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

// useChatSession -- React hook for multi-turn portfolio chat (#2781 #2782).
//
// State machine: init -> mcp-probe -> mcp-tools -> ready <-> thinking
// Graceful degradation: if MCP server is unavailable, chat still works
// with a generic system prompt (no portfolio context).
//
// MCP auto-start: when autoMcp=true, spawns `swao mcp --http` using the
// PKG_EXECPATH: '' pattern (prevents pkg spawn-patch from injecting the
// parent binary path -- see memory pkg-execpath-spawn-fix.md).
// The spawned child is registered with registerChild() so it is cleaned
// up when the TUI exits (killAllChildren in run-app.ts).
//
// LLM calls: delegates to createProviderFromConnector via the workspace
// connector; falls back to createLlmProvider from the factory if no
// connector YAML is found. The complete(prompt) interface is used, with
// full conversation history formatted into the prompt string.
// #3301: every chat call runs with LLM_CHAT_MAX_ATTEMPTS (3) attempts so a
// failing endpoint does not freeze the chat for the full ~93 s assessment
// retry policy, and token usage is read from the call's own result.
//
// History: each turn is appended to wsp/chat/<sessionTs>.ndjson as
// ChatTurn NDJSON (#2782). The token budget guard warns at 80% of the
// model's configured max_tokens.

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type { ChatTurn } from '@swao/core';
import { findWorkspace, guardSecretText, applyFindingsIntegrity, parseSignalIndexLines, mergeSignalIndex } from '@swao/core';
import type { SignalIndexEntry } from '@swao/core';
import {
  getConnector,
  listConnectors,
  createProviderFromConnector,
  withLlmAttemptLimit,
  completeWithUsage,
  completeWithToolsWithUsage,
  LLM_CHAT_MAX_ATTEMPTS,
} from '@swao/module-llm-providers';
import type { LlmProvider, LlmUsage } from '@swao/module-llm-providers';
import { registerChild, registerMcpServerChild } from '../child-process-registry.js';
import {
  chatHistoryPath,
  appendTurn,
  estimateTokens,
  isOverBudget,
} from './chat-history.js';
import {
  initMcpSession,
  callMcpTool,
  listMcpTools,
  fetchPortfolioContext,
  buildSystemPrompt,
  autoStartMcpServer,
  isMcpError,
  mcpError,
  type McpSession,
} from './mcp-context.js';
import type { LlmTool } from '@swao/module-llm-providers';

// #2895: read providers.llm.primary.connector from .swao.yml without a full parse.
export function readSwaoYmlConnectorId(ws: string): string | undefined {
  try {
    const p = join(ws, '.swao.yml');
    if (!existsSync(p)) return undefined;
    const parsed = load(readFileSync(p, 'utf-8')) as Record<string, unknown>;
    const llm = ((parsed?.['providers'] as Record<string, unknown>)?.['llm']) as Record<string, unknown> | undefined;
    const primary = llm?.['primary'] as Record<string, unknown> | undefined;
    return primary?.['connector'] as string | undefined;
  } catch { return undefined; }
}

export type ChatStatus = 'init' | 'mcp-probe' | 'mcp-tools' | 'ready' | 'thinking' | 'error';

export interface ChatSessionOpts {
  /** Workspace root path. Defaults to findWorkspace(cwd). */
  workspace?: string;
  /** Optional app ID to focus the portfolio context on. */
  appId?: string;
  /** LLM model override (overrides connector default). */
  model?: string;
  /** When true, auto-start the MCP HTTP server if not running (default: true). */
  autoMcp?: boolean;
  /** MCP server port (default: 3737). */
  mcpPort?: number;
}

export interface ChatSessionState {
  status: ChatStatus;
  statusDetail: string;
  messages: ChatTurn[];
  mcpAvailable: boolean;
  /** Number of MCP tools available for dynamic tool-calling (#2915). 0 = no tool loop. */
  mcpToolCount: number;
  /** Estimated current context size in tokens (chars/4 across system prompt + all messages). */
  totalTokensIn: number;
  /** Token budget from the configured connector (or 8192 default). */
  tokenBudget: number;
  sendMessage: (content: string) => Promise<void>;
  cleanup: () => void;
}

/**
 * Strip JSON envelopes from LLM responses (#2786 follow-up).
 *
 * claude-haiku-4-5 occasionally wraps prose in a JSON object despite the
 * system prompt's RESPONSE FORMAT rule. Once one JSON response enters the
 * conversation history, formatChatPrompt feeds it back and the model
 * continues the pattern. This function extracts the prose before the turn
 * is stored, breaking the poisoning cycle.
 *
 * Also converts literal "\\n" sequences (common when the model serialises
 * newlines inside a JSON string value) to real newlines.
 */
export function extractProseFromResponse(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        // Prose keys the model wraps responses in (most common first)
        const proseKey = obj['response'] ?? obj['message'] ?? obj['text'] ?? obj['content'];
        if (typeof proseKey === 'string') {
          return proseKey.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
        }
        // Error/refusal JSON: use 'reason' or 'description' as the display text.
        // The model is instructed not to do this, but this catches it when it does.
        const errorKey = obj['reason'] ?? obj['description'] ?? obj['detail'];
        if (typeof errorKey === 'string') {
          return errorKey.replace(/\\n/g, '\n');
        }
        // Last resort: bare {"error": "human-readable message"} with no other keys.
        // The model sometimes returns this even when told to avoid JSON, e.g.
        // {"error": "SWAO Portfolio Advisor kann nur in natuerlicher Sprache antworten..."}.
        const rawError = obj['error'];
        if (typeof rawError === 'string') {
          return rawError.replace(/\\n/g, '\n');
        }
      }
    } catch {
      // Not valid JSON -- fall through to literal-\n handling below
    }
  }
  // Even for non-JSON output, unescape literal \n the model may emit
  return trimmed.replace(/\\n/g, '\n');
}

/** Format conversation history as a prompt string for the LLM provider. */
export function formatChatPrompt(messages: ChatTurn[], newContent: string): string {
  const history = messages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const systemMsg = messages.find(m => m.role === 'system');
  const systemSection = systemMsg ? `${systemMsg.content}\n\n` : '';
  const historySection = history ? `CONVERSATION HISTORY\n${history}\n\n` : '';

  return `${systemSection}${historySection}User: ${newContent}\n\nAssistant:`;
}

/** One chat request (#3301). */
export interface ChatCompletionRequest {
  system: string;
  /** Conversation so far (excluding the new user message). */
  history: ChatTurn[];
  content: string;
  tools: LlmTool[];
  /** MCP tool executor; tool calling is used only when set and tools exist. */
  onToolCall?: (name: string, input: Record<string, unknown>) => Promise<string>;
  /**
   * #3418: compact signal index (pre-fetched context plus swao_signals tool
   * results). A function is read after the answer, so signals fetched by tool
   * calls during the answer count. When set, every answer runs the
   * findings-integrity post-check before the secret guard.
   */
  signalIndex?: readonly SignalIndexEntry[] | (() => readonly SignalIndexEntry[]);
}

/**
 * #3418: findings-integrity post-check, then the #3415 secret guard. The guard
 * runs last over the combined text, so the integrity note (which quotes
 * evidence paths) is masked like the answer itself.
 */
export function finaliseChatAnswer(text: string, signalIndex?: ChatCompletionRequest['signalIndex']): string {
  const index = typeof signalIndex === 'function' ? signalIndex() : signalIndex;
  const checked = index && index.length > 0 ? applyFindingsIntegrity(text, index).text : text;
  return guardSecretText(checked).text;
}

/** Providers whose model rejected tool calling in this process (#3311). */
const toolsUnsupportedProviders = new WeakSet<LlmProvider>();

/** LlmToolsUnsupportedError of the provider module (#3311), matched by name
 *  so every copy of the module (dist or src) is recognised. */
function isToolsUnsupported(err: unknown): boolean {
  return err instanceof Error && err.name === 'LlmToolsUnsupportedError';
}

/** One-line notice shown once when Chat degrades to no-tools mode (#3311). */
export function toolsUnsupportedNotice(model: string): string {
  return `[Note: the model ${model} does not support tool calling, so SWAO MCP tools are off for this chat; answers use the portfolio context only.]`;
}

/**
 * Send one chat message (#3301). Runs with the per-call attempt limit
 * LLM_CHAT_MAX_ATTEMPTS (the shared helper's scoped option; assessment calls
 * keep their full policy) and returns the usage of this call from its result.
 */
export function runChatCompletion(
  provider: LlmProvider,
  req: ChatCompletionRequest,
): Promise<{ text: string; usage: LlmUsage | undefined }> {
  return withLlmAttemptLimit(LLM_CHAT_MAX_ATTEMPTS, async () => {
    // #2915: use dynamic tool-calling when available (Claude Desktop parity).
    // Requires: provider supports completeWithTools, MCP session is active, tools were fetched.
    // #3311: ollama and bedrock connectors offer tools too; a model without
    // tool support (detected from the API error, LlmToolsUnsupportedError)
    // degrades to the prompt without tools below, with a one-time notice.
    let notice = '';
    if (provider.completeWithTools && req.onToolCall && req.tools.length > 0 && !toolsUnsupportedProviders.has(provider)) {
      // Convert ChatTurn history to the flat messages format (filter system messages)
      const llmMessages = req.history
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
      llmMessages.push({ role: 'user', content: req.content });
      try {
        const result = await completeWithToolsWithUsage(provider, {
          system: req.system,
          messages: llmMessages,
          tools: req.tools,
          onToolCall: req.onToolCall,
        });
        // Tool-calling responses are already prose -- no JSON stripping needed
        // #3415: chat output guard -- an echoed secret is masked before the
        // answer is displayed or written to the NDJSON history.
        // #3418: findings-integrity post-check before the guard.
        return { text: finaliseChatAnswer(result.text, req.signalIndex), usage: result.usage };
      } catch (err) {
        if (!isToolsUnsupported(err)) throw err;
        toolsUnsupportedProviders.add(provider);
        notice = `${toolsUnsupportedNotice(provider.model)}\n\n`;
      }
    }
    // Fallback: format as a single prompt string (no tool calling)
    const result = await completeWithUsage(provider, formatChatPrompt(req.history, req.content));
    // Strip JSON envelope and unescape \n before storing in history (#2786)
    // #3415: chat output guard (see above).
    return { text: notice + finaliseChatAnswer(extractProseFromResponse(result.text), req.signalIndex), usage: result.usage };
  });
}

/**
 * Chat's MCP tool executor (#3315). A failed call reaches the model as
 * `[MCP error: ...]` (callMcpTool) and is recorded in the chat log; it is not
 * added as a visible turn, which would put consecutive assistant turns into
 * the tool loop's history.
 */
export async function callMcpToolLogged(
  session: McpSession,
  historyPath: string,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  const text = await callMcpTool(session, name, input);
  if (isMcpError(text)) {
    try {
      appendTurn(historyPath, { ts: new Date().toISOString(), role: 'assistant', content: `${text} (tool ${name})` });
    } catch { /* non-fatal */ }
  }
  return text;
}

/**
 * #3474 (Design 116 REQ-08.8): arguments of the SWAO Chat MCP auto-start. The
 * chat always starts the full profile, so a workspace `mcp.profile` meant for
 * external clients does not shrink the chat's tool list. When the chat attaches
 * to a running server it uses whatever that server lists.
 */
export function chatMcpAutoStartArgs(port: number): string[] {
  return ['mcp', '--http', '--port', String(port), '--profile', 'full'];
}

export function useChatSession(opts: ChatSessionOpts = {}): ChatSessionState {
  const {
    workspace: wsOpt,
    appId,
    model,
    autoMcp = true,
    mcpPort = 3737,
  } = opts;

  const [status, setStatus] = useState<ChatStatus>('init');
  const [statusDetail, setStatusDetail] = useState('');
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [mcpAvailable, setMcpAvailable] = useState(false);
  const [mcpToolCount, setMcpToolCount] = useState(0);
  const [totalTokensIn, setTotalTokensIn] = useState(0);
  const [tokenBudget, setTokenBudget] = useState(8192);

  const mcpChildRef = useRef<ChildProcess | null>(null);
  const mcpSessionRef = useRef<McpSession | null>(null);
  const mcpToolsRef = useRef<LlmTool[]>([]);
  const providerRef = useRef<LlmProvider | null>(null);
  const workspaceRef = useRef<string>('');
  const historyPathRef = useRef<string>('');
  const systemPromptRef = useRef<string>('');
  // #3418: signal facts for the findings-integrity post-check.
  const signalIndexRef = useRef<SignalIndexEntry[]>([]);
  const isMountedRef = useRef(true);

  const safeSet = useCallback(<T>(setter: (v: T) => void, value: T) => {
    if (isMountedRef.current) setter(value);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    const sessionTs = new Date().toISOString().replace(/[:.]/g, '-');

    async function initialize(): Promise<void> {
      // Resolve workspace
      const ws = wsOpt ?? findWorkspace(process.cwd()) ?? process.cwd();
      workspaceRef.current = ws;
      historyPathRef.current = chatHistoryPath(ws, sessionTs);

      // Load LLM provider from workspace connectors.
      // #2895: priority chain:
      //   1. SWAO_LLM_CONNECTOR env var
      //   2. providers.llm.primary.connector from .swao.yml
      //   3. First workspace connector discovered by listConnectors()
      safeSet(setStatusDetail, 'loading LLM connector');
      try {
        const namedId = process.env['SWAO_LLM_CONNECTOR'] ?? readSwaoYmlConnectorId(ws);
        let loaded = namedId ? getConnector(namedId, { workspaceRoot: ws }) : undefined;
        if (!loaded) {
          const { connectors } = listConnectors({ workspaceRoot: ws });
          if (connectors.length > 0) loaded = connectors[0];
        }
        if (loaded) {
          const { provider } = createProviderFromConnector(loaded, { model });
          providerRef.current = provider;
          // #2828: use context window (input capacity) not max_tokens (output limit).
          // max_tokens is the response cap (e.g. 8192); the context window is much larger.
          const modelName = loaded.file.connector.models.default ?? '';
          const knownContextWindows: Array<[RegExp, number]> = [
            [/claude/i, 200_000],
            [/gpt-4o/i, 128_000],
            [/gpt-4/i, 128_000],
            [/gemini-1\.5/i, 1_000_000],
            [/gemini/i, 128_000],
            [/llama/i, 128_000],
          ];
          const contextWindow = knownContextWindows.find(([re]) => re.test(modelName))?.[1] ?? 100_000;
          const inputBudget = Math.floor(contextWindow * 0.92);
          safeSet(setTokenBudget, inputBudget);
        }
      } catch { /* connector load failure is non-fatal -- no LLM = status error later */ }

      // MCP probe
      safeSet(setStatus, 'mcp-probe');
      safeSet(setStatusDetail, 'probing MCP server');
      let mcpSession: McpSession | null = null;
      // #3314 / #3315: MCP start-up failures, shown in the chat and the chat log.
      const mcpNotices: string[] = [];

      try {
        mcpSession = await initMcpSession(mcpPort, 2000);
        mcpSessionRef.current = mcpSession;
        safeSet(setMcpAvailable, true);
      } catch {
        if (autoMcp) {
          // Auto-start the MCP server
          safeSet(setStatusDetail, 'starting MCP server');
          const isPkg = !!(process as { pkg?: unknown }).pkg;
          const swaoCliPath = isPkg ? process.execPath : (process.argv[1] ?? process.execPath);
          const spawnArgs = chatMcpAutoStartArgs(mcpPort); // #3474
          const spawnCmd = isPkg ? swaoCliPath : process.execPath;
          const finalArgs = isPkg ? spawnArgs : [swaoCliPath, ...spawnArgs];

          // #3314: poll until the server answers (pkg binary on Windows needs
          // ~5-8 s on first launch) and stop at once when the child exits, with
          // the reason from its stderr (for example the Enterprise licence gate).
          // A server that never answers is tree-killed; nothing is left behind.
          const started = await autoStartMcpServer({
            command: spawnCmd,
            args: finalArgs,
            port: mcpPort,
            // PKG_EXECPATH: '' prevents pkg spawn-patch from re-injecting parent binary path.
            env: { ...process.env, PKG_EXECPATH: '' },
            onSpawn: child => {
              mcpChildRef.current = child;
              registerChild(child);
              // #3461: TUI exit stops only this child, never a PID from the pid file.
              registerMcpServerChild(child);
            },
          });
          mcpChildRef.current = started.child;
          if (started.session) {
            mcpSession = started.session;
            mcpSessionRef.current = mcpSession;
            safeSet(setMcpAvailable, true);
          } else if (started.error) {
            mcpNotices.push(mcpError(started.error));
          }
        }
      }

      // Fetch MCP tool manifest and portfolio context (if session established)
      let context = '';
      if (mcpSession) {
        safeSet(setStatus, 'mcp-tools');
        safeSet(setStatusDetail, 'loading MCP tools');
        try {
          // #2915: fetch full tool manifest so the LLM can call tools dynamically
          // (same as Claude Desktop -- tools/list -> pass to every Anthropic API call)
          const tools = await listMcpTools(mcpSession);
          mcpToolsRef.current = tools;
          safeSet(setMcpToolCount, tools.length);
        } catch (err) {
          // Non-fatal: tool calling degrades gracefully, but the reason is reported (#3315).
          mcpNotices.push(mcpError(err instanceof Error ? err.message : String(err)));
        }

        safeSet(setStatusDetail, 'loading portfolio context');
        try {
          // #3315: failed context sections are recorded in the chat log (NDJSON
          // only; a visible turn here would lead the tool loop's history).
          context = await fetchPortfolioContext(mcpSession, ws, appId, (label, error) => {
            try {
              appendTurn(historyPathRef.current, { ts: new Date().toISOString(), role: 'assistant', content: `${error} (context: ${label})` });
            } catch { /* non-fatal */ }
          });
        } catch { /* context fetch failure is non-fatal */ }
      }

      // Build system prompt and add to messages
      const systemPrompt = buildSystemPrompt(context);
      systemPromptRef.current = systemPrompt;
      signalIndexRef.current = parseSignalIndexLines(context);
      const systemTurn: ChatTurn = {
        ts: new Date().toISOString(),
        role: 'system',
        content: systemPrompt,
      };

      if (!isMountedRef.current) return;
      // #3314 / #3315: MCP start-up failures appear in the chat and the chat log.
      const noticeTurns: ChatTurn[] = mcpNotices.map(content => ({ ts: new Date().toISOString(), role: 'assistant', content }));
      for (const turn of noticeTurns) {
        try { appendTurn(historyPathRef.current, turn); } catch { /* non-fatal */ }
      }
      setMessages([systemTurn, ...noticeTurns]);

      if (!providerRef.current) {
        safeSet(setStatus, 'error');
        safeSet(setStatusDetail, 'No LLM connector configured. Run `swao setup` to configure an LLM gateway.');
        return;
      }

      safeSet(setStatus, 'ready');
      safeSet(setStatusDetail, '');
    }

    initialize().catch(err => {
      safeSet(setStatus, 'error');
      safeSet(setStatusDetail, String(err?.message ?? err ?? 'Unknown initialization error'));
    });

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const sendMessage = useCallback(async (content: string): Promise<void> => {
    if (status !== 'ready' || !providerRef.current) return;

    // #2829: intercept /clear before sending to LLM.
    if (content.trim() === '/clear') {
      const systemTurn: ChatTurn = { ts: new Date().toISOString(), role: 'system', content: systemPromptRef.current };
      setMessages([systemTurn]);
      setTotalTokensIn(0);
      const confirmTurn: ChatTurn = {
        ts: new Date().toISOString(),
        role: 'assistant',
        content: 'Session cleared. Context reset.',
      };
      setMessages(prev => [...prev, confirmTurn]);
      try { appendTurn(historyPathRef.current, confirmTurn); } catch { /* non-fatal */ }
      safeSet(setStatus, 'ready');
      return;
    }

    safeSet(setStatus, 'thinking');

    const userTurn: ChatTurn = {
      ts: new Date().toISOString(),
      role: 'user',
      content,
    };

    const currentMessages = [...messages, userTurn];
    setMessages(currentMessages);

    // Append user turn to history
    try { appendTurn(historyPathRef.current, userTurn); } catch { /* non-fatal */ }

    // Check token budget before calling LLM.
    // Estimate CURRENT context size (not cumulative): system prompt + all prior messages + new user message.
    // This avoids the double-counting issue where each API call's full input_tokens would accumulate.
    const contextChars = systemPromptRef.current.length
      + messages.reduce((s, m) => s + m.content.length, 0)
      + content.length;
    const contextEstimate = Math.ceil(contextChars / 4);

    if (isOverBudget(contextEstimate, tokenBudget, 0.85)) {
      const budgetTurn: ChatTurn = {
        ts: new Date().toISOString(),
        role: 'assistant',
        content: `[Warning] Approaching token budget (${contextEstimate}/${tokenBudget} estimated tokens used). Start a new session with /clear or restart the chat to continue.`,
      };
      setMessages(prev => [...prev, budgetTurn]);
      try { appendTurn(historyPathRef.current, budgetTurn); } catch { /* non-fatal */ }
      safeSet(setStatus, 'ready');
      return;
    }

    try {
      const provider = providerRef.current;
      const mcpSession = mcpSessionRef.current;

      // #3301: 3 attempts per chat call; usage from this call's own result.
      const { text: responseText, usage } = await runChatCompletion(provider, {
        system: systemPromptRef.current,
        history: messages,
        content,
        tools: mcpToolsRef.current,
        ...(mcpSession
          ? {
            onToolCall: async (name: string, input: Record<string, unknown>) => {
              const out = await callMcpToolLogged(mcpSession, historyPathRef.current, name, input);
              // #3418: signals fetched during the answer join the integrity index.
              const fresh = parseSignalIndexLines(out);
              if (fresh.length > 0) signalIndexRef.current = mergeSignalIndex(signalIndexRef.current, fresh);
              return out;
            },
          }
          : {}),
        signalIndex: () => signalIndexRef.current,
      });

      const tokensOut = usage?.output_tokens ?? estimateTokens(responseText);

      const assistantTurn: ChatTurn = {
        ts: new Date().toISOString(),
        role: 'assistant',
        content: responseText,
        model: provider.model,
        tokens_in: contextEstimate,
        tokens_out: tokensOut,
      };

      setMessages(prev => [...prev, assistantTurn]);
      // Track current context size (not cumulative) -- includes assistant response for next check.
      const contextAfter = Math.ceil(
        (systemPromptRef.current.length + currentMessages.reduce((s, m) => s + m.content.length, 0) + responseText.length) / 4
      );
      setTotalTokensIn(contextAfter);
      try { appendTurn(historyPathRef.current, assistantTurn); } catch { /* non-fatal */ }
    } catch (err) {
      const errorTurn: ChatTurn = {
        ts: new Date().toISOString(),
        role: 'assistant',
        content: `[error] LLM call failed: ${String(err instanceof Error ? err.message : err)}`,
      };
      setMessages(prev => [...prev, errorTurn]);
      try { appendTurn(historyPathRef.current, errorTurn); } catch { /* non-fatal */ }
    } finally {
      safeSet(setStatus, 'ready');
    }
  }, [status, messages, totalTokensIn, tokenBudget, safeSet]);

  const cleanup = useCallback(() => {
    isMountedRef.current = false;
    if (mcpChildRef.current) {
      try { mcpChildRef.current.kill(); } catch { /* already exited */ }
      mcpChildRef.current = null;
    }
  }, []);

  return {
    status,
    statusDetail,
    messages,
    mcpAvailable,
    mcpToolCount,
    totalTokensIn,
    tokenBudget,
    sendMessage,
    cleanup,
  };
}
