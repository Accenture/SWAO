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
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';

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
 * Kill the SWAO MCP HTTP server by reading the PID file it writes on startup.
 * The MCP server runs as a sibling process (not a TUI child), so it is not
 * tracked by the registry above. Without this, the server holds the .exe open
 * on Windows and blocks rebuilds.
 */
export function killMcpServer(port = 3737): void {
  const pidFile = join(tmpdir(), `swao-mcp-${port}.pid`);
  if (!existsSync(pidFile)) return;
  try {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    if (!isNaN(pid) && pid > 0) process.kill(pid, 'SIGTERM');
  } catch { /* process already gone -- non-fatal */ }
}
