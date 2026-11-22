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

// #4392 (Design 116 section 12.6): the TUI starts the HTTP MCP server
// (`swao mcp --http`, pinned to the open workspace) so Claude Code and the
// Claude Desktop Code tab can connect while the TUI is open, and stops it on
// exit (killMcpServer in run-app.ts). When another SWAO already serves the
// port, the TUI shows it as connected and leaves it running.
//
// The MCP server is Enterprise only (F-105). This public slot holds no server
// code: the Enterprise entry registers the starter (tiers/mcp-chat-enterprise.ts,
// tui/chat/tui-mcp-server.ts, both outside the public sync); in Community and
// Consultant nothing is registered and startTuiMcpServer is a silent no-op.

import { useSyncExternalStore } from 'react';

/** Default HTTP port of `swao mcp --http` (ADR-0045). */
export const TUI_MCP_PORT = 3737;

export type TuiMcpServerState =
  /** Nothing to show: no starter (Community, Consultant), switched off, no workspace or no licence. */
  | { kind: 'off' }
  | { kind: 'starting'; port: number }
  /** Started by this TUI; stops when the TUI closes. */
  | { kind: 'running'; port: number }
  /** Another SWAO serves the port; it stays running. */
  | { kind: 'connected'; port: number }
  | { kind: 'failed'; port: number; reason: string };

export interface TuiMcpServerStartRequest {
  port: number;
  workspace: string;
}

/** Starts or attaches; resolves with the final state (never `starting`). */
export type TuiMcpServerStarter = (req: TuiMcpServerStartRequest) => Promise<TuiMcpServerState>;

let starter: TuiMcpServerStarter | undefined;
let state: TuiMcpServerState = { kind: 'off' };
const listeners = new Set<() => void>();

function setState(next: TuiMcpServerState): void {
  state = next;
  for (const l of listeners) l();
}

/** Enterprise entry only (registerEnterpriseMcpChat). */
export function registerTuiMcpServerStarter(impl: TuiMcpServerStarter | undefined): void {
  starter = impl;
}

export function tuiMcpServerState(): TuiMcpServerState {
  return state;
}

export function subscribeTuiMcpServerState(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Tests: back to the start state, no starter. */
export function resetTuiMcpServerForTest(): void {
  starter = undefined;
  setState({ kind: 'off' });
}

export interface StartTuiMcpServerOptions {
  /** The open workspace (findWorkspace of the cwd); none means no start. */
  workspace: string | null | undefined;
  port?: number;
  /** SWAO_MCP_AUTOSTART=0 switches the start off (test runs set it, src/__tests__/setup.ts). */
  env?: NodeJS.ProcessEnv;
}

/**
 * Starts the server for the TUI in the background (the first frame never
 * waits for it). A silent no-op without a starter, with SWAO_MCP_AUTOSTART=0
 * or without a workspace.
 */
export async function startTuiMcpServer(opts: StartTuiMcpServerOptions): Promise<void> {
  const env = opts.env ?? process.env;
  if (!starter || env['SWAO_MCP_AUTOSTART'] === '0' || !opts.workspace) return;
  const port = opts.port ?? TUI_MCP_PORT;
  setState({ kind: 'starting', port });
  try {
    setState(await starter({ port, workspace: opts.workspace }));
  } catch (err) {
    setState({ kind: 'failed', port, reason: err instanceof Error ? err.message : String(err) });
  }
}

/** One short line for the main menu footer; null when there is nothing to show. */
export function formatTuiMcpServerState(s: TuiMcpServerState): string | null {
  switch (s.kind) {
    case 'off':
      return null;
    case 'starting':
      return `MCP server: starting on port ${s.port}`;
    case 'running':
      return `MCP server: running on port ${s.port}, stops when SWAO closes`;
    case 'connected':
      return `MCP server: connected on port ${s.port} (another SWAO, stays running)`;
    case 'failed':
      return `MCP server: not started (${s.reason.length > 80 ? `${s.reason.slice(0, 77)}...` : s.reason})`;
  }
}

/** The current server state for a TUI screen. */
export function useTuiMcpServerState(): TuiMcpServerState {
  return useSyncExternalStore(subscribeTuiMcpServerState, tuiMcpServerState, tuiMcpServerState);
}
