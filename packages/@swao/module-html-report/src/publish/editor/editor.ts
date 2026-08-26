// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  HTML report module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * SWAO Publication Editor -- CLI launcher (#0436)
 *
 * Invoked by `swao publish --edit [--app <id>]`.
 * Starts the editor HTTP server and opens it in the default browser.
 */

import { spawn } from 'node:child_process';
import { createEditorServer } from './server.js';
import { findWorkspace } from '@swao/core';

export async function launchEditor(opts: { port?: number; appId?: string; profileVariant?: string }): Promise<void> {
  const workspace = findWorkspace(process.cwd()) ?? process.cwd();
  const server = createEditorServer({ port: opts.port ?? 4001, workspace, appId: opts.appId, profileVariant: opts.profileVariant });
  // server.start() returns the bound port number; we construct the URL here
  // from a numeric value so the string passed to spawn() is never tainted by
  // library input (resolves CodeQL js/shell-command-constructed-from-input).
  const boundPort = await server.start();
  const url = `http://127.0.0.1:${boundPort}`;
  process.stderr.write(`[swao publish template edit] Editor started at ${url}\n`);
  process.stderr.write('[swao publish template edit] Press [Q] in the SWAO TUI to stop the editor and return to the menu.\n');

  // Open browser (non-blocking) -- static import: dynamic import fails in pkg binaries
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }

  // Keep running until SIGINT
  await new Promise<void>((resolve) => {
    process.once('SIGINT', () => {
      server.stop().then(resolve).catch(resolve);
    });
  });
}
