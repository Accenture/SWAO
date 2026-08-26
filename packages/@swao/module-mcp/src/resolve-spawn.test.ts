// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  MCP module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

import { describe, it, expect } from 'vitest';
import { resolveSpawn } from './server.js';
import type { McpHostDeps } from './server.js';

// #0574: the MCP server spawns the host swao CLI to run tools. After the module
// extraction the CLI path can no longer be derived from __dirname, so the host
// injects it via McpHostDeps and resolveSpawn() turns that into the concrete
// spawn (cmd, cmdArgs). The named MCP integration tests assert tool *definitions*
// but never exercise this spawn path, so this unit test pins the DI branches
// directly (fast, no subprocess) per the half-fix-detection discipline.
describe('resolveSpawn (#0574 CLI-path DI)', () => {
  const args = ['health-check', '--format', 'json'];

  it('dev (cliIsScript): runs the node execPath with [hostScript, ...args]', () => {
    const deps: McpHostDeps = { swaoCliPath: '/repo/packages/swao/dist/index.js', cliIsScript: true };
    const { cmd, cmdArgs } = resolveSpawn(deps, args);
    expect(cmd).toBe(process.execPath);
    expect(cmdArgs).toEqual(['/repo/packages/swao/dist/index.js', 'health-check', '--format', 'json']);
  });

  it('pkg binary (not cliIsScript): runs the binary directly with args (execPath IS swao)', () => {
    const deps: McpHostDeps = { swaoCliPath: '/opt/swao/swao-linux', cliIsScript: false };
    const { cmd, cmdArgs } = resolveSpawn(deps, args);
    expect(cmd).toBe('/opt/swao/swao-linux');
    expect(cmdArgs).toEqual(['health-check', '--format', 'json']);
  });

  it('null deps: defensive fallback to node execPath + this process argv entry', () => {
    const { cmd, cmdArgs } = resolveSpawn(null, args);
    expect(cmd).toBe(process.execPath);
    expect(cmdArgs).toEqual([process.argv[1] ?? '', 'health-check', '--format', 'json']);
  });
});
