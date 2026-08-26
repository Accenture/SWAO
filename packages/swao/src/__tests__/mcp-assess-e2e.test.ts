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
 * MCP HTTP assess E2E test (#0807-P3): start `swao mcp --http`, call
 * `swao_assess` via tools/call with workspace_path, and verify the
 * response includes pass-completion output (Layer 6 coverage).
 *
 * Skipped when the community binary is absent. Runs the inventory pass
 * only (no LLM, ~30s) to keep the total test time manageable.
 *
 * Protocol: MCP streamable-HTTP transport (JSON-RPC 2.0).
 * Endpoint : POST /mcp
 * Flow     : initialize -> notifications/initialized -> tools/call (swao_assess)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT      = resolve(__dirname, '../../../../');
const PRIVATE_ROOT   = resolve(__dirname, '../../../../../');
const binaryName     = process.platform === 'win32' ? 'swao-community-win.exe' : 'swao-community-linux-x64';
const binaryPath     = join(REPO_ROOT, 'dist-bin', binaryName);
const SOURCE_FIXTURE = join(PRIVATE_ROOT, 'examples', 'portfolio-workspace', 'portfolio');
const hasBinary      = existsSync(binaryPath) && existsSync(SOURCE_FIXTURE);

// Assessment (inv pass) + server startup can take up to 90 s on slow runners.
vi.setConfig({ testTimeout: 120_000 });

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
 * POST JSON to /mcp. Collects the full SSE stream and returns the last
 * JSON-RPC message that carries a `result` or `error` field.
 * Falls back to raw text on parse failure.
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
        // Try plain JSON first (non-streaming response).
        try {
          const parsed = JSON.parse(text) as unknown;
          resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body: parsed });
          return;
        } catch { /* fall through to SSE parsing */ }

        // SSE stream: walk from the end to find the terminal result/error.
        const dataLines = text.split('\n')
          .filter(l => l.startsWith('data:'))
          .map(l => l.slice(5).trim())
          .filter(Boolean);

        let finalBody: unknown = text;
        for (let i = dataLines.length - 1; i >= 0; i--) {
          try {
            const candidate = JSON.parse(dataLines[i]!) as Record<string, unknown>;
            if ('result' in candidate || 'error' in candidate) {
              finalBody = candidate;
              break;
            }
          } catch { /* skip */ }
        }
        resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body: finalBody });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(raw);
  });
}

/** Perform initialize + notifications/initialized; returns the session ID. */
async function openMcpSession(port: number): Promise<string> {
  const initRes = await mcpPost(port, {
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'swao-mcp-assess-e2e', version: '0.0.1' },
    },
    id: 1,
  });
  const sessionId = initRes.headers['mcp-session-id'] as string;
  if (typeof sessionId !== 'string') throw new Error('No mcp-session-id in initialize response');
  await mcpPost(port, { jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-session-id': sessionId });
  return sessionId;
}

let server: ChildProcess | undefined;
let mcpPort: number;
let workspace: string;
let sandboxHome: string;

describe.skipIf(!hasBinary)('MCP assess E2E -- swao_assess inv pass (#0807-P3)', () => {
  beforeAll(async () => {
    // Copy fixture to tmp so the assessment write-outs don't touch the golden fixture.
    const tmpRoot = mkdtempSync(join(tmpdir(), 'swao-mcp-assess-'));
    workspace = join(tmpRoot, 'portfolio');
    cpSync(SOURCE_FIXTURE, workspace, { recursive: true });
    sandboxHome = mkdtempSync(join(tmpdir(), 'swao-mcp-assess-home-'));

    mcpPort = await getFreePort();
    server  = spawn(binaryPath, ['mcp', '--http', '--port', String(mcpPort)], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, HOME: sandboxHome, USERPROFILE: sandboxHome },
    });

    // Wait for the server to signal it is listening (up to 30 s).
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('MCP server did not start within 30 s')), 30_000);
      server!.stderr!.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('listening')) {
          clearTimeout(timer);
          resolve();
        }
      });
      server!.on('exit', code => {
        clearTimeout(timer);
        reject(new Error(`MCP server exited prematurely (code ${code})`));
      });
    });
  }, 150_000);

  afterAll(() => {
    if (server) { server.kill('SIGTERM'); server = undefined; }
    if (workspace) {
      try { rmSync(resolve(workspace, '..'), { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    if (sandboxHome) {
      try { rmSync(sandboxHome, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }, 30_000);

  it('swao_assess inv pass returns a result with pass-completion output', async () => {
    const sessionId = await openMcpSession(mcpPort);

    // Call the assess tool with workspace_path so the server roots the
    // spawned CLI in the correct directory (resolveWorkspace uses it directly).
    const callRes = await mcpPost(mcpPort, {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'swao_assess',
        arguments: {
          app_id:         'sovereign-health',
          workspace_path: workspace,
          passes:         'inv',
        },
      },
      id: 3,
    }, { 'mcp-session-id': sessionId });

    expect(callRes.statusCode).toBe(200);
    const body = callRes.body as Record<string, unknown>;
    // Must have a result, not an error.
    expect(body).toHaveProperty('result');
    expect(body).not.toHaveProperty('error');
    // Stdout from a successful inv pass contains pass-completion markers.
    const resultStr = JSON.stringify(body['result']);
    const mentionsCompletion = /Pass 01|01-inv|run-manifest|passes_executed|inventory/i.test(resultStr);
    expect(mentionsCompletion).toBe(true);
  }, 100_000);
});
