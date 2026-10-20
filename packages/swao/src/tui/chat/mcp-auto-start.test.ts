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
 * #3314: `swao mcp` without an Enterprise licence exits non-zero at once with
 * the licence message (stdio and --http), and SWAO Chat's auto-start
 * (autoStartMcpServer) reports that reason as soon as the child exits and
 * leaves no process behind.
 *
 * The CLI cases spawn dist/index.js (and the module-mcp dist it loads) in a
 * sandboxed, licence-less HOME; they are skipped when dist is absent (run
 * `pnpm run build` first). Every spawned child is tree-killed by PID.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoStartMcpServer, treeKillChild } from './mcp-context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '../../..');
const CLI = join(PKG_ROOT, 'dist', 'index.js');
const MODULE_MCP_DIST = resolve(PKG_ROOT, '..', '@swao', 'module-mcp', 'dist', 'commands', 'mcp.js');
const HAS_CLI = existsSync(CLI) && existsSync(MODULE_MCP_DIST);

/** Generous bound: the dist entry can take 10-20 s to load on a busy machine. */
const EXIT_WAIT_MS = 90_000;

const spawned: ChildProcess[] = [];

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createNetServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(err => (err ? rej(err) : res(port)));
    });
    srv.on('error', rej);
  });
}

function isAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function killAll(): void {
  for (const c of spawned.splice(0)) {
    if (c.pid && c.exitCode === null && c.signalCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
      else c.kill('SIGKILL');
    }
  }
}

afterEach(() => { killAll(); });

// ---------------------------------------------------------------------------
// autoStartMcpServer without the CLI: deadline and success paths
// ---------------------------------------------------------------------------

describe('autoStartMcpServer (#3314)', () => {
  it('tree-kills a server that neither answers nor exits and reports the deadline', async () => {
    const port = await freePort();
    let child: ChildProcess | undefined;
    const r = await autoStartMcpServer({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      port,
      timeoutMs: 1500,
      pollMs: 200,
      onSpawn: c => { child = c; spawned.push(c); },
    });
    expect(r.session).toBeNull();
    expect(r.child).toBeNull();
    expect(r.error).toMatch(new RegExp(`^MCP server did not answer on port ${port} within 2 s`));
    await new Promise(res => setTimeout(res, 500));
    expect(isAlive(child?.pid)).toBe(false);
  }, 30_000);

  it('returns the session as soon as the server answers and keeps the child running', async () => {
    const port = await freePort();
    const server = [
      "const http = require('node:http');",
      'http.createServer((req, res) => { req.resume(); req.on("end", () => {',
      "  res.writeHead(200, { 'Content-Type': 'application/json', 'mcp-session-id': 'sess-1' });",
      "  res.end('{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}');",
      `}); }).listen(${port}, '127.0.0.1', () => process.stderr.write('listening\\n'));`,
    ].join('\n');
    const r = await autoStartMcpServer({
      command: process.execPath,
      args: ['-e', server],
      port,
      timeoutMs: 20_000,
      pollMs: 100,
      env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
      onSpawn: c => { spawned.push(c); },
    });
    expect(r.error).toBeUndefined();
    expect(r.session).toEqual({ sessionId: 'sess-1', port });
    expect(r.child).not.toBeNull();
    expect(isAlive(r.child?.pid)).toBe(true);
    treeKillChild(r.child!);
  }, 30_000);

  it('reports a child that exits before answering with its stderr reason', async () => {
    const port = await freePort();
    const r = await autoStartMcpServer({
      command: process.execPath,
      args: ['-e', "process.stderr.write('Error: listen EADDRINUSE\\n'); process.exit(2)"],
      port,
      timeoutMs: 60_000,
      onSpawn: c => { spawned.push(c); },
    });
    expect(r.session).toBeNull();
    expect(r.child).toBeNull();
    expect(r.error).toBe('swao mcp exited (exit code 2): Error: listen EADDRINUSE');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// The real CLI in a licence-less sandbox
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_CLI)('swao mcp without an Enterprise licence (#3314, spawned)', () => {
  let sandbox = '';
  let ws = '';
  let env: Record<string, string> = {};

  beforeAll(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'swao-3314-home-'));
    ws = mkdtempSync(join(tmpdir(), 'swao-3314-ws-'));
    mkdirSync(join(sandbox, 'Local'), { recursive: true });
    mkdirSync(join(sandbox, 'Roaming'), { recursive: true });
    env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'));
    Object.assign(env, {
      HOME: sandbox, USERPROFILE: sandbox, LOCALAPPDATA: join(sandbox, 'Local'), APPDATA: join(sandbox, 'Roaming'),
      XDG_CONFIG_HOME: join(sandbox, '.config'), PKG_EXECPATH: '', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    });
    for (const k of Object.keys(env)) {
      if (k === 'SWAO_BINARY_TIER' || k.startsWith('SWAO_LICENSE') || k.startsWith('SWAO_LICENCE')) delete env[k];
    }
    expect(homedir()).not.toBe(sandbox);
  });

  afterAll(() => {
    killAll();
    for (const d of [sandbox, ws]) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows file lock, best effort */ }
    }
  });

  function runCli(args: string[]): Promise<{ code: number | null; out: string; err: string }> {
    // stdin stays an open pipe (as Claude Desktop holds it), so the process
    // must end on its own rather than on stdin EOF.
    const child = spawn(process.execPath, [CLI, ...args], { cwd: ws, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    spawned.push(child);
    let out = '';
    let err = '';
    child.stdout!.on('data', (c: Buffer) => { out += c.toString(); });
    child.stderr!.on('data', (c: Buffer) => { err += c.toString(); });
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`swao ${args.join(' ')} did not exit within ${EXIT_WAIT_MS} ms: ${err}`)), EXIT_WAIT_MS);
      child.once('close', code => { clearTimeout(timer); res({ code, out, err }); });
    });
  }

  it('`swao mcp` (stdio) prints the licence message on stderr and exits 1 with stdin open', async () => {
    const r = await runCli(['mcp']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('[LICENSE] swao mcp requires an Enterprise licence.');
    expect(r.err).not.toContain('unhandledRejection');
    expect(r.out).toBe('');
  }, EXIT_WAIT_MS + 10_000);

  it('`swao mcp --http` prints the licence message on stderr and exits 1', async () => {
    const port = await freePort();
    const r = await runCli(['mcp', '--http', '--port', String(port)]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('[LICENSE] swao mcp requires an Enterprise licence.');
    expect(r.out).toBe('');
  }, EXIT_WAIT_MS + 10_000);

  it("SWAO Chat's auto-start reports the licence reason when the child exits and leaves no process", async () => {
    const port = await freePort();
    let pid: number | undefined;
    const r = await autoStartMcpServer({
      command: process.execPath,
      args: [CLI, 'mcp', '--http', '--port', String(port)],
      port,
      env,
      cwd: ws,
      // Far beyond the child's exit: the result must come from the exit, not the deadline.
      timeoutMs: EXIT_WAIT_MS,
      onSpawn: c => { pid = c.pid; spawned.push(c); },
    });
    expect(r.session).toBeNull();
    expect(r.child).toBeNull();
    expect(r.error).toBe('swao mcp exited (exit code 1): [LICENSE] swao mcp requires an Enterprise licence. Your current tier: community');
    expect(isAlive(pid)).toBe(false);
  }, EXIT_WAIT_MS + 10_000);
});
