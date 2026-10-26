// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI + orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3474 (Design 116 REQ-08.8): SWAO Chat auto-starts the MCP server with the
// full profile, so a workspace mcp.profile for external clients does not
// shrink the chat's tool list.

import { describe, it, expect } from 'vitest';
import { chatMcpAutoStartArgs } from './useChatSession.js';

describe('SWAO Chat MCP auto-start profile (#3474)', () => {
  it('passes --profile full with the HTTP transport and port', () => {
    const args = chatMcpAutoStartArgs(3737);
    expect(args.slice(0, 4)).toEqual(['mcp', '--http', '--port', '3737']);
    const i = args.indexOf('--profile');
    expect(i).toBeGreaterThan(0);
    expect(args[i + 1]).toBe('full');
  });
});
