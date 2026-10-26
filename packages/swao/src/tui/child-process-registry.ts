// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  TUI child-process registry
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// Tracks active subprocesses spawned during assessment runs so they can
// be terminated when the TUI exits (normal, Ctrl+C, or window close).
// On Windows, child processes are not automatically killed when the parent
// exits; this registry bridges that gap.

import type { ChildProcess } from 'node:child_process';
import { spawnSync } from 'node:child_process';

const _registry = new Set<ChildProcess>();

/** Register a spawned child. Automatically deregistered when it exits. */
export function registerChild(child: ChildProcess): void {
  _registry.add(child);
  child.once('exit', () => _registry.delete(child));
}

/** Kill all tracked children. Called on TUI exit to prevent orphans. */
export function killAllChildren(): void {
  for (const child of _registry) {
    try { child.kill(); } catch { /* already exited */ }
  }
  _registry.clear();
}

/**
 * #3461: the MCP HTTP server SWAO Chat started for this TUI, if any. Only this
 * child is stopped on TUI exit. The pid file `swao-mcp-<port>.pid` is never
 * used to find a process to kill: once SWAO Chat attaches to a server another
 * client started (Design 116 REQ-03.6), that server must keep running.
 */
let _mcpServerChild: ChildProcess | null = null;

/** Record the MCP server child the TUI spawned (SWAO Chat auto-start). */
export function registerMcpServerChild(child: ChildProcess): void {
  _mcpServerChild = child;
  child.once('exit', () => { if (_mcpServerChild === child) _mcpServerChild = null; });
}

/**
 * Stop the MCP server the TUI spawned (tree-kill by its PID, so the server's
 * own tool subprocesses go too; it holds the .exe open on Windows and would
 * block rebuilds). Does nothing when the TUI did not start one.
 */
export function killMcpServer(): void {
  const child = _mcpServerChild;
  _mcpServerChild = null;
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
  } catch { /* process already gone -- non-fatal */ }
}
