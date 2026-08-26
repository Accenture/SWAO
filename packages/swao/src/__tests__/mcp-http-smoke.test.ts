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

/**
 * MCP HTTP smoke test (#0670 Phase 2): start `swao mcp --http` as a child
 * process, confirm tool listing works over the HTTP transport, then shut
 * down cleanly.
 *
 * Uses the binary at dist-bin/swao-community-win.exe (Windows) or the
 * community Linux binary.  All tests are skipped when the binary is absent.
 *
 * Protocol: MCP streamable-HTTP transport (JSON-RPC 2.0).
 * Endpoint: POST /mcp
 * Flow: initialize -> tools/list
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = resolve(__dirname, '../../../../');
const binaryName = process.platform === 'win32' ? 'swao-community-win.exe' : 'swao-community-linux-x64';
const binaryPath = join(REPO_ROOT, 'dist-bin', binaryName);
const hasBinary  = existsSync(binaryPath);

/** Find a free TCP port by binding then releasing. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(err => { if (err) reject(err); else resolve(port); });
    });
    srv.on('error', reject);
  });
}

/**
 * POST JSON to /mcp and return { statusCode, headers, body }.
 * The server responds with SSE (text/event-stream); extract the first
 * `data:` line and parse it as JSON.
 */
function mcpPost(
  port: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ statusCode: number; headers: IncomingMessage['headers']; body: unknown }> {
  return new Promise((resolve, reject) => {
    const raw = JSON.stringify(body);
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/mcp',
      method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(raw),
        'Accept':         'application/json, text/event-stream',
        ...extraHeaders,
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c as Buffer));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          // SSE format: extract first `data:` line.
          const dataLine = text.split('\n').find(l => l.startsWith('data:'));
          if (dataLine) {
            try { parsed = JSON.parse(dataLine.slice(5).trim()); }
            catch { parsed = text; }
          } else {
            parsed = text;
          }
        }
        resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body: parsed });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(raw);
  });
}

let server: ChildProcess | undefined;
let mcpPort: number;

describe('swao mcp --http smoke (#0670 Phase 2)', () => {
  beforeAll(async () => {
    if (!hasBinary) return;
    mcpPort = await getFreePort();
    server  = spawn(binaryPath, ['mcp', '--http', '--port', String(mcpPort)], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    // Wait for the "listening" line on stderr (up to 10 s).
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('MCP server did not start within 10 s')), 10_000);
      server!.stderr!.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('listening')) {
          clearTimeout(timer);
          resolve();
        }
      });
      server!.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`MCP server exited prematurely (code ${code})`));
      });
    });
  }, 30_000);

  afterAll(() => {
    if (server) { server.kill('SIGTERM'); server = undefined; }
  });

  it.skipIf(!hasBinary)('initialize handshake succeeds', async () => {
    const initMsg = {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'swao-smoke', version: '0.0.1' },
      },
      id: 1,
    };
    const res = await mcpPost(mcpPort, initMsg);
    expect(res.statusCode).toBe(200);
    // Session ID must be returned for all subsequent requests.
    expect(typeof res.headers['mcp-session-id']).toBe('string');
    const body = res.body as Record<string, unknown>;
    expect(body).toHaveProperty('result');
    const result = body['result'] as Record<string, unknown>;
    expect(result).toHaveProperty('protocolVersion');
    expect(result).toHaveProperty('capabilities');
  });

  it.skipIf(!hasBinary)('tools/list returns at least 20 tools', async () => {
    // Initialize a fresh session to get a session ID.
    const initRes = await mcpPost(mcpPort, {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'swao-smoke', version: '0.0.1' },
      },
      id: 1,
    });
    const sessionId = initRes.headers['mcp-session-id'] as string;
    expect(typeof sessionId).toBe('string');

    // Send initialized notification.
    await mcpPost(mcpPort, { jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-session-id': sessionId });

    // List tools.
    const listRes = await mcpPost(mcpPort, { jsonrpc: '2.0', method: 'tools/list', params: {}, id: 2 }, { 'mcp-session-id': sessionId });
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.body as Record<string, unknown>;
    expect(listBody).toHaveProperty('result');
    const tools = (listBody['result'] as Record<string, unknown>)['tools'] as unknown[];
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThanOrEqual(20);
    // Every tool must have a name and description.
    for (const tool of tools as Array<Record<string, unknown>>) {
      expect(typeof tool['name']).toBe('string');
      expect(typeof tool['description']).toBe('string');
    }
  });
});
