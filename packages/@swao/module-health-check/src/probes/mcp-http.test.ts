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

// #4392: probe of the HTTP MCP endpoint with an injected fetch (no socket, no
// port 3737): reachable with version, PID, workspace and binary from the
// welcome screen; not running; another program on the port; the probe session
// is deleted again.

import { describe, it, expect } from 'vitest';
import { formatMcpHttpProbeDetail, probeMcpHttpEndpoint, WELCOME_BINARY_RE, WELCOME_WORKSPACE_RE } from './mcp-http.js';

/** The server block as module-mcp server.ts welcomeServerBlock renders it. */
const WELCOME = [
  'Server',
  '------',
  '  Workspace : /ws/portfolio (folder of the SWAO binary)',
  '  Binary    : /opt/swao/swao-enterprise-linux-x64',
  '  Transport : HTTP on port 3737',
].join('\n');

interface Call { method: string; body: unknown; session: string | undefined }

function fakeServer(opts: { name?: string; sse?: boolean } = {}): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const reply = (obj: unknown, headers: Record<string, string> = {}): Response =>
    new Response(opts.sse ? `event: message\ndata: ${JSON.stringify(obj)}\n\n` : JSON.stringify(obj), { status: 200, headers });
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) as { method?: string; id?: number } : undefined;
    calls.push({ method: init?.method ?? 'GET', body, session: h['mcp-session-id'] });
    if (init?.method === 'DELETE') return new Response('', { status: 200 });
    if (body?.method === 'initialize') {
      return reply({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: opts.name ?? 'swao', version: '1.6.1' } } }, { 'mcp-session-id': 'sess-1', 'x-swao-mcp-pid': '4242' });
    }
    if (body?.method === 'notifications/initialized') return new Response('', { status: 202 });
    if (body?.method === 'tools/call') return reply({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: `intro\n\n${WELCOME}\n\nmore` }] } });
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('#4392 HTTP MCP endpoint probe', () => {
  it('the welcome expressions read the server block lines', () => {
    expect(WELCOME_WORKSPACE_RE.exec(WELCOME)?.[1]).toBe('/ws/portfolio (folder of the SWAO binary)');
    expect(WELCOME_BINARY_RE.exec(WELCOME)?.[1]).toBe('/opt/swao/swao-enterprise-linux-x64');
  });

  for (const sse of [false, true]) {
    it(`reachable SWAO server (${sse ? 'SSE' : 'JSON'} answers): version, pid, workspace, binary; the session is deleted`, async () => {
      const { fetchImpl, calls } = fakeServer({ sse });
      const r = await probeMcpHttpEndpoint({ port: 3737, fetchImpl });
      expect(r).toEqual({
        status: 'reachable',
        url: 'http://localhost:3737/mcp',
        version: '1.6.1',
        pid: 4242,
        workspace: '/ws/portfolio (folder of the SWAO binary)',
        binary: '/opt/swao/swao-enterprise-linux-x64',
      });
      expect(calls.map((c) => (c.body as { method?: string } | undefined)?.method ?? c.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call', 'DELETE']);
      expect(calls.slice(1).every((c) => c.session === 'sess-1')).toBe(true);
      expect((calls[2]!.body as { params: unknown }).params).toEqual({ name: 'swao', arguments: {} });
    });
  }

  it('nothing listening: not_reachable with the error code', async () => {
    const fetchImpl = (async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); }) as typeof fetch;
    expect(await probeMcpHttpEndpoint({ fetchImpl })).toEqual({ status: 'not_reachable', url: 'http://localhost:3737/mcp', reason: 'ECONNREFUSED' });
  });

  it('another program on the port: not_swao, no tool call', async () => {
    const { fetchImpl, calls } = fakeServer({ name: 'other' });
    const r = await probeMcpHttpEndpoint({ port: 4000, fetchImpl });
    expect(r.status).toBe('not_swao');
    expect(r.url).toBe('http://localhost:4000/mcp');
    expect(calls).toHaveLength(1);
  });

  it('formats one line per state; reachable adds workspace and binary', () => {
    const reachable = formatMcpHttpProbeDetail({ status: 'reachable', url: 'http://localhost:3737/mcp', version: '1.6.1', pid: 7, workspace: '/ws (current folder)', binary: '/b/swao' });
    expect(reachable).toEqual([
      '          HTTP endpoint http://localhost:3737/mcp: reachable, SWAO 1.6.1, pid 7',
      '            workspace: /ws (current folder)',
      '            binary: /b/swao',
    ]);
    const down = formatMcpHttpProbeDetail({ status: 'not_reachable', url: 'http://localhost:3737/mcp', reason: 'ECONNREFUSED' });
    expect(down).toHaveLength(1);
    expect(down[0]).toContain('not running (ECONNREFUSED)');
    for (const line of [...reachable, ...down]) expect(line).not.toMatch(/(^|\s)--(\s|$)|\bWARN\b|\bFAIL\b/);
  });
});
