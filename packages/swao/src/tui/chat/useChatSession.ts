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
//
// History: each turn is appended to wsp/chat/<sessionTs>.ndjson as
// ChatTurn NDJSON (#2782). The token budget guard warns at 80% of the
// model's configured max_tokens.

import { useState, useEffect, useRef, useCallback } from 'react';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { ChatTurn } from '@swao/core';
import { findWorkspace } from '@swao/core';
import { listConnectors, createProviderFromConnector } from '@swao/module-llm-providers';
import type { LlmProvider } from '@swao/module-llm-providers';
import { registerChild } from '../child-process-registry.js';
import {
  chatHistoryPath,
  appendTurn,
  estimateTokens,
  isOverBudget,
} from './chat-history.js';
import {
  initMcpSession,
  fetchPortfolioContext,
  buildSystemPrompt,
  type McpSession,
} from './mcp-context.js';

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
  const [totalTokensIn, setTotalTokensIn] = useState(0);
  const [tokenBudget, setTokenBudget] = useState(8192);

  const mcpChildRef = useRef<ChildProcess | null>(null);
  const mcpSessionRef = useRef<McpSession | null>(null);
  const providerRef = useRef<LlmProvider | null>(null);
  const workspaceRef = useRef<string>('');
  const historyPathRef = useRef<string>('');
  const systemPromptRef = useRef<string>('');
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

      // Load LLM provider from workspace connectors
      safeSet(setStatusDetail, 'loading LLM connector');
      try {
        const { connectors } = listConnectors({ workspaceRoot: ws });
        if (connectors.length > 0) {
          const loaded = connectors[0];
          const { provider } = createProviderFromConnector(loaded, { model });
          providerRef.current = provider;
          // #2828: use context window (input capacity) not max_tokens (output limit).
          // max_tokens is the response cap (e.g. 8192); the context window is much larger.
          const modelName = (loaded.file.connector as { model?: string }).model ?? '';
          const knownContextWindows: Array<[RegExp, number]> = [
            [/claude/i, 200_000],
            [/gpt-4o/i, 128_000],
            [/gpt-4/i, 128_000],
            [/gemini-1\.5/i, 1_000_000],
            [/gemini/i, 128_000],
            [/llama/i, 128_000],
          ];
          const contextWindow = knownContextWindows.find(([re]) => re.test(modelName))?.[1] ?? 100_000;
          const inputBudget = Math.floor(contextWindow * 0.85);
          safeSet(setTokenBudget, inputBudget);
        }
      } catch { /* connector load failure is non-fatal -- no LLM = status error later */ }

      // MCP probe
      safeSet(setStatus, 'mcp-probe');
      safeSet(setStatusDetail, 'probing MCP server');
      let mcpSession: McpSession | null = null;

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
          const spawnArgs = isPkg ? ['mcp', '--http', '--port', String(mcpPort)] : ['mcp', '--http', '--port', String(mcpPort)];
          const spawnCmd = isPkg ? swaoCliPath : process.execPath;
          const finalArgs = isPkg ? spawnArgs : [swaoCliPath, ...spawnArgs];

          try {
            const child = spawn(spawnCmd, finalArgs, {
              stdio: 'ignore',
              detached: false,
              // PKG_EXECPATH: '' prevents pkg spawn-patch from re-injecting parent binary path.
              env: { ...process.env, PKG_EXECPATH: '' },
              windowsHide: true,
            });
            mcpChildRef.current = child;
            registerChild(child);

            // Wait for MCP to start -- pkg binary on Windows needs ~5-8 s to
            // unpack, initialise, and bind the port on first launch.
            // Strategy: wait 5 s, probe once; if still down wait 4 s more, probe again.
            await new Promise<void>(resolve => setTimeout(resolve, 5000));
            try {
              mcpSession = await initMcpSession(mcpPort, 4000);
              mcpSessionRef.current = mcpSession;
              safeSet(setMcpAvailable, true);
            } catch {
              // First probe failed -- give it one more chance after 4 extra seconds
              await new Promise<void>(resolve => setTimeout(resolve, 4000));
              try {
                mcpSession = await initMcpSession(mcpPort, 4000);
                mcpSessionRef.current = mcpSession;
                safeSet(setMcpAvailable, true);
              } catch { /* MCP still not up -- proceed without it */ }
            }
          } catch { /* spawn failed -- proceed without MCP */ }
        }
      }

      // Fetch MCP context (if session established)
      let context = '';
      if (mcpSession) {
        safeSet(setStatus, 'mcp-tools');
        safeSet(setStatusDetail, 'loading portfolio context');
        try {
          context = await fetchPortfolioContext(mcpSession, ws, appId);
        } catch { /* context fetch failure is non-fatal */ }
      }

      // Build system prompt and add to messages
      const systemPrompt = buildSystemPrompt(context);
      systemPromptRef.current = systemPrompt;
      const systemTurn: ChatTurn = {
        ts: new Date().toISOString(),
        role: 'system',
        content: systemPrompt,
      };

      if (!isMountedRef.current) return;
      setMessages([systemTurn]);

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

    // Check token budget before calling LLM
    const estimatedIn = estimateTokens(systemPromptRef.current) + estimateTokens(content);
    const newTotalIn = totalTokensIn + estimatedIn;

    if (isOverBudget(newTotalIn, tokenBudget)) {
      const budgetTurn: ChatTurn = {
        ts: new Date().toISOString(),
        role: 'assistant',
        content: `[Warning] Approaching token budget (${newTotalIn}/${tokenBudget} estimated tokens used). Start a new session with /clear or restart the chat to continue.`,
      };
      setMessages(prev => [...prev, budgetTurn]);
      try { appendTurn(historyPathRef.current, budgetTurn); } catch { /* non-fatal */ }
      safeSet(setStatus, 'ready');
      return;
    }

    try {
      // Format: system prompt + prior conversation history + new user message.
      // `messages` is the state BEFORE the new user turn; `content` is appended last.
      const conversationPrompt = formatChatPrompt(messages, content);
      const rawResponse = await providerRef.current.complete(conversationPrompt);
      // Strip JSON envelope and unescape \\n before storing in history (#2786)
      const responseText = extractProseFromResponse(rawResponse);

      const usage = providerRef.current.getLastUsage?.();
      const tokensIn = usage?.input_tokens ?? estimatedIn;
      const tokensOut = usage?.output_tokens ?? estimateTokens(responseText);

      const assistantTurn: ChatTurn = {
        ts: new Date().toISOString(),
        role: 'assistant',
        content: responseText,
        model: providerRef.current.model,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
      };

      setMessages(prev => [...prev, assistantTurn]);
      setTotalTokensIn(prev => prev + tokensIn);
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
    totalTokensIn,
    tokenBudget,
    sendMessage,
    cleanup,
  };
}
