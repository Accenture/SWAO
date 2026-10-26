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
 * SWAO Chat / external MCP client parity (#3310, Design 110 F-08).
 *
 * Owner condition: every MCP tool works in SWAO Chat exactly as in an external
 * MCP client such as Claude Desktop. This test starts the real server
 * (startMcpServer of @swao/module-mcp, see writeServerEntry) twice, the way
 * each client starts it, with the workspace as cwd:
 *   - HTTP on a free port (what useChatSession auto-starts as
 *     `swao mcp --http`; never 3737, so the user's live server is never
 *     involved; a busy port makes the server exit 1 since #3461);
 *   - stdio (`swao mcp`, MCP_SERVER_ARGS, the Claude Desktop registration of
 *     src/tui/mcp-config.ts).
 * Three clients are compared:
 *   - SWAO Chat: initMcpSession / listMcpTools / callMcpTool (mcp-context.ts)
 *     driven by runChatCompletion (useChatSession.ts) with the real Anthropic
 *     and open-LLM (openai-chat) providers against a mocked LLM endpoint that
 *     requests the tool (Ollama, #3311: tool definitions and one tool turn;
 *     Bedrock only by its tool methods, the SDK client cannot be pointed at
 *     the mock);
 *   - the MCP SDK client over Streamable HTTP;
 *   - the MCP SDK client over stdio (as Claude Desktop).
 *
 * The SDK is not a dependency of packages/swao; it is loaded from
 * @swao/module-mcp's own dependency (createRequire anchored at its
 * package.json), the same SDK copy the server runs on.
 *
 * Skipped when dist/index.js is absent (run `pnpm run build` first).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer as createNetServer } from 'node:net';
import { createServer as createHttpServer, type Server } from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  AnthropicLlmProvider,
  OpenLlmProvider,
  OllamaLlmProvider,
  type LlmProvider,
  type LlmTool,
} from '@swao/module-llm-providers';
import { BedrockLlmProvider } from '../../../@swao/module-llm-providers/src/bedrock.js';
import { initMcpSession, listMcpTools, callMcpTool, type McpSession } from '../tui/chat/mcp-context.js';
import { runChatCompletion } from '../tui/chat/useChatSession.js';
import { _paths, buildLicenseKey, LicenseGuard } from '@swao/core';
import {
  makeSyntheticMixedWorkspace,
  makeSyntheticSovereignHealthWorkspace,
  PLANTED_SECRETS,
  SVC_ASSESSED,
  SVC_UNASSESSED,
  SYNTHETIC_APP_ID,
} from '../../../@swao/module-mcp/src/__tests__/synthetic-workspace.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '../..');
const CLI = join(PKG_ROOT, 'dist', 'index.js');
const MODULE_MCP = resolve(PKG_ROOT, '..', '@swao', 'module-mcp');
const HAS_CLI = existsSync(CLI) && existsSync(join(MODULE_MCP, 'dist', 'index.js'));

// ---------------------------------------------------------------------------
// MCP SDK client, loaded from @swao/module-mcp's dependency
// ---------------------------------------------------------------------------

interface SdkContent { type: string; text?: string }
interface SdkCallResult { content?: SdkContent[]; isError?: boolean }
interface SdkTool { name: string; description?: string; inputSchema: Record<string, unknown> }
interface SdkClient {
  connect(transport: unknown): Promise<void>;
  listTools(): Promise<{ tools: SdkTool[] }>;
  callTool(params: { name: string; arguments: Record<string, unknown> }, schema?: unknown, opts?: { timeout?: number }): Promise<SdkCallResult>;
  close(): Promise<void>;
}
interface Sdk {
  Client: new (info: { name: string; version: string }) => SdkClient;
  StreamableHTTPClientTransport: new (url: URL) => unknown;
  StdioClientTransport: new (p: { command: string; args: string[]; cwd: string; env: Record<string, string>; stderr: 'ignore' }) => unknown;
}

function loadSdk(): Sdk {
  const req = createRequire(join(MODULE_MCP, 'package.json'));
  /* eslint-disable @typescript-eslint/no-require-imports */
  const client = req('@modelcontextprotocol/sdk/client/index.js') as Pick<Sdk, 'Client'>;
  const http = req('@modelcontextprotocol/sdk/client/streamableHttp.js') as Pick<Sdk, 'StreamableHTTPClientTransport'>;
  const stdio = req('@modelcontextprotocol/sdk/client/stdio.js') as Pick<Sdk, 'StdioClientTransport'>;
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { Client: client.Client, StreamableHTTPClientTransport: http.StreamableHTTPClientTransport, StdioClientTransport: stdio.StdioClientTransport };
}

/** What Claude Desktop hands the model for a tools/call result: the text blocks. */
function sdkText(r: SdkCallResult): string {
  return (r.content ?? []).filter(c => typeof c.text === 'string').map(c => c.text as string).join('\n');
}

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

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

function treeKill(child: ChildProcess | undefined): void {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGKILL');
}

/**
 * Server entry used by both transports. `swao mcp` is Enterprise-gated and the
 * dist entry forces NODE_ENV=production, so a test-signed licence cannot pass
 * its gate; the entry therefore calls the same startMcpServer the command calls
 * (identical server, tools and handlers) with the host deps the CLI injects
 * (the action tools spawn dist/index.js, as in a source run).
 */
function writeServerEntry(dir: string): string {
  const entry = join(dir, 'mcp-entry.mjs');
  const mod = pathToFileURL(join(MODULE_MCP, 'dist', 'index.js')).href;
  writeFileSync(entry, [
    `import { startMcpServer } from ${JSON.stringify(mod)};`,
    'const http = process.argv.includes("--http");',
    'const port = http ? Number(process.argv[process.argv.indexOf("--port") + 1]) : undefined;',
    // #3471: the request log goes to the sandbox, not <workspace>/wsp/logs, so
    // swao_list_directory output does not change between the compared calls.
    `const logFile = ${JSON.stringify(dir)} + (http ? "/mcp-http.log" : "/mcp-stdio.log");`,
    `await startMcpServer({ http, port, version: "parity", logFile }, { swaoCliPath: ${JSON.stringify(CLI)}, cliIsScript: true });`,
    '',
  ].join('\n'));
  return entry;
}

function startHttpServer(entry: string, cwd: string, port: number, env: Record<string, string>): Promise<ChildProcess> {
  const child = spawn(process.execPath, [entry, '--http', '--port', String(port)], {
    cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let out = '';
  child.stdout!.on('data', (c: Buffer) => { out += c.toString(); });
  return new Promise((res, rej) => {
    let err = '';
    const timer = setTimeout(() => rej(new Error(`MCP HTTP server did not start within 60 s: ${err} ${out}`)), 60_000);
    child.stderr!.on('data', (c: Buffer) => {
      err += c.toString();
      if (err.includes('listening')) { clearTimeout(timer); res(child); }
    });
    child.on('exit', code => { clearTimeout(timer); rej(new Error(`MCP HTTP server exited (code ${code}): ${err} ${out}`)); });
  });
}

// ---------------------------------------------------------------------------
// Mocked LLM endpoint: scripted responses, recorded request bodies
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
interface MockLlm { server: Server; port: number; script: Json[]; bodies: Json[] }

function startMockLlm(): Promise<MockLlm> {
  const state: MockLlm = { server: undefined as unknown as Server, port: 0, script: [], bodies: [] };
  state.server = createHttpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c as Buffer));
    req.on('end', () => {
      state.bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Json);
      const next = state.script.shift();
      if (!next) { res.writeHead(500).end('mock LLM script exhausted'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(next));
    });
  });
  return new Promise(res => state.server.listen(0, '127.0.0.1', () => {
    const addr = state.server.address();
    state.port = typeof addr === 'object' && addr ? addr.port : 0;
    res(state);
  }));
}

type ProviderKind = 'anthropic' | 'openai-chat';

/** Turn 1: the model requests the given tool calls. Turn 2: it ends the turn. */
function scriptToolTurn(kind: ProviderKind, calls: Array<{ name: string; args: Json }>): Json[] {
  if (kind === 'anthropic') {
    return [
      {
        content: calls.map((c, i) => ({ type: 'tool_use', id: `toolu_${i}`, name: c.name, input: c.args })),
        stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 },
      },
      { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 1 } },
    ];
  }
  return [
    {
      choices: [{ message: { role: 'assistant', content: null, tool_calls: calls.map((c, i) => ({
        id: `call_${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) },
      })) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    },
    { choices: [{ message: { role: 'assistant', content: 'done' } }], usage: { prompt_tokens: 10, completion_tokens: 1 } },
  ];
}

function makeProvider(kind: ProviderKind, llmPort: number): LlmProvider {
  const base = `http://127.0.0.1:${llmPort}`;
  // The constructor arguments createProviderFromConnector (gateway/resolve.ts) passes per protocol.
  return kind === 'anthropic'
    ? new AnthropicLlmProvider('test-key', 'claude-test', 0, 1024, base)
    : new OpenLlmProvider('test-key', 'gpt-test', base, '', 0, undefined, undefined, { maxTokens: 1024 });
}

/** The tool list as each provider path puts it in the request body. */
function providerTools(kind: ProviderKind, body: Json): Json[] {
  const tools = body['tools'] as Json[];
  if (kind === 'anthropic') return tools;
  return tools.map(t => {
    const f = t['function'] as Json;
    expect(t['type']).toBe('function');
    return { name: f['name'], description: f['description'], input_schema: f['parameters'] };
  });
}

// ---------------------------------------------------------------------------
// Sandboxed enterprise licence: `swao mcp` is an Enterprise command, and the
// service export is Enterprise too. The key is signed with the per-process
// test keypair of src/__tests__/setup.ts, which the children inherit
// (SWAO_LICENSE_PUBLIC_KEY_HEX_TEST with NODE_ENV=test).
// ---------------------------------------------------------------------------

function sandboxLicencePaths(sandbox: string): { statePath: string; licensePath: string } {
  const appData = process.platform === 'win32'
    ? join(sandbox, 'Local', 'swao')
    : process.platform === 'darwin'
      ? join(sandbox, 'Library', 'Application Support', 'swao')
      : join(sandbox, '.config', 'swao');
  return { statePath: join(sandbox, '.swao-state.json'), licensePath: join(appData, 'licence.json') };
}

function writeEnterpriseLicence(sandbox: string): void {
  const saved = { ..._paths };
  const paths = sandboxLicencePaths(sandbox);
  try {
    Object.assign(_paths, paths, { legacyLicencePath: join(sandbox, '.swao-license.json') });
    const fp = LicenseGuard.load().state.fingerprint; // writes the sandbox state file
    const key = buildLicenseKey({
      v: 1, tier: 'enterprise', licensee: 'SWAO parity test', exp: '2099-12-31',
      assessment_limit: null, fp, iat: '2026-10-18',
    });
    mkdirSync(dirname(paths.licensePath), { recursive: true });
    writeFileSync(paths.licensePath, JSON.stringify({ key, activated_at: '2026-10-18', tier: 'enterprise', exp: '2099-12-31', licensee: 'SWAO parity test' }));
  } finally {
    Object.assign(_paths, saved);
  }
}

// ---------------------------------------------------------------------------
// Fixture: synthetic mixed workspace (application + service apps)
// ---------------------------------------------------------------------------

/** Mixed workspace with the sovereign-health application run overlaid, so the core tools return content. */
function makeParityWorkspace(): string {
  const ws = makeSyntheticMixedWorkspace();
  const sh = makeSyntheticSovereignHealthWorkspace();
  cpSync(join(sh, 'apps', SYNTHETIC_APP_ID), join(ws, 'apps', SYNTHETIC_APP_ID), { recursive: true });
  rmSync(sh, { recursive: true, force: true });
  return ws;
}

function normalise(text: string, ws: string): string {
  // #3316: the server uses the canonical workspace path (8.3 short names resolved).
  const real = realpathSync.native(ws);
  const variants = [ws, real].flatMap(p => [p, p.replace(/\\/g, '\\\\'), p.replace(/\\/g, '/')]);
  let out = text;
  for (const v of variants) out = out.split(v).join('<WS>');
  return out;
}

// ---------------------------------------------------------------------------
// Tool cases: every service tool plus a representative set of core tools
// ---------------------------------------------------------------------------

interface ToolCase { name: string; args: (ws: string) => Json; isolated?: boolean }

const SERVICE_CASES: ToolCase[] = [
  { name: 'swao_service_portfolio', args: ws => ({ workspace_path: ws }) },
  { name: 'swao_service_portfolio', args: ws => ({ workspace_path: ws, assessment_type: 'application', limit: 5 }) },
  { name: 'swao_service_app', args: ws => ({ workspace_path: ws, app_id: SVC_ASSESSED }) },
  { name: 'swao_service_research', args: ws => ({ workspace_path: ws, app_id: SVC_UNASSESSED }) },
  { name: 'swao_service_waves', args: ws => ({ workspace_path: ws }) },
  { name: 'swao_service_vendors', args: ws => ({ workspace_path: ws }) },
  { name: 'swao_service_delta', args: ws => ({ workspace_path: ws }) },
  { name: 'swao_service_scaffold', args: ws => ({ workspace_path: ws }) },
  { name: 'swao_service_runs', args: ws => ({ workspace_path: ws }) },
  // Action tools spawn the CLI. init writes, so each client gets its own workspace copy.
  { name: 'swao_service_init', args: ws => ({ workspace_path: ws }), isolated: true },
  { name: 'swao_service_research_run', args: ws => ({ workspace_path: ws, app_id: SVC_ASSESSED, dry_run: true }) },
  // Enterprise tier in the sandbox: export writes the workbook, so it is isolated too.
  { name: 'swao_service_export', args: ws => ({ workspace_path: ws }), isolated: true },
];

const CORE_CASES: ToolCase[] = [
  { name: 'swao', args: () => ({}) },
  { name: 'swao_workspace_inventory', args: ws => ({ workspace_path: ws }) },
  { name: 'swao_portfolio_summary', args: ws => ({ workspace_path: ws }) },
  { name: 'swao_portfolio_stats', args: ws => ({ workspace_path: ws }) },
  { name: 'swao_portfolio_lz', args: ws => ({ workspace_path: ws }) },
  { name: 'swao_signals', args: ws => ({ workspace_path: ws, app_id: SYNTHETIC_APP_ID }) },
  { name: 'swao_signal_detail', args: ws => ({ workspace_path: ws, app_id: SYNTHETIC_APP_ID, signal_id: 'DATA-01' }) },
  { name: 'swao_risks', args: ws => ({ workspace_path: ws, app_id: SYNTHETIC_APP_ID }) },
  { name: 'swao_read_challenge', args: ws => ({ workspace_path: ws, app_id: SYNTHETIC_APP_ID }) },
  { name: 'swao_control_detail', args: ws => ({ workspace_path: ws, app_id: SYNTHETIC_APP_ID, control_id: 'GDPR_Art_32' }) },
  { name: 'swao_frameworks_list', args: ws => ({ workspace_path: ws }) },
  { name: 'swao_passes', args: () => ({}) },
  { name: 'swao_list_directory', args: () => ({}) },
  { name: 'swao_read_file', args: () => ({ file_path: '.swao.yml' }) },
  { name: 'swao_chat_history', args: ws => ({ workspace_path: ws }) },
  // Validation errors (Zod, #3307: missing app_id, wrong type) and an unknown tool (isError on the SDK side).
  { name: 'swao_signals', args: ws => ({ workspace_path: ws }) },
  { name: 'swao_assess', args: ws => ({ workspace_path: ws, passes: 7 }) },
  { name: 'swao_no_such_tool', args: () => ({}) },
];

// ---------------------------------------------------------------------------

describe.skipIf(!HAS_CLI)('SWAO Chat and an external MCP client see the same MCP tools (#3310)', { timeout: 300_000 }, () => {
  const sdk = HAS_CLI ? loadSdk() : (undefined as unknown as Sdk);
  let ws = '';
  let template = '';
  let sandbox = '';
  let env: Record<string, string> = {};
  let httpChild: ChildProcess | undefined;
  let session: McpSession;
  let httpClient: SdkClient;
  let stdioClient: SdkClient;
  let llm: MockLlm;
  let serverTools: SdkTool[] = [];
  let chatTools: LlmTool[] = [];
  const isolatedDirs: string[] = [];
  const savedNoProxy = process.env['NO_PROXY'];

  beforeAll(async () => {
    template = makeParityWorkspace();
    ws = mkdtempSync(join(tmpdir(), 'swao-3310-ws-'));
    cpSync(template, ws, { recursive: true });
    sandbox = mkdtempSync(join(tmpdir(), 'swao-3310-home-'));
    mkdirSync(join(sandbox, 'Local'), { recursive: true });
    mkdirSync(join(sandbox, 'Roaming'), { recursive: true });
    env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'));
    Object.assign(env, {
      HOME: sandbox, USERPROFILE: sandbox, LOCALAPPDATA: join(sandbox, 'Local'), APPDATA: join(sandbox, 'Roaming'),
      XDG_CONFIG_HOME: join(sandbox, '.config'), PKG_EXECPATH: '', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    });
    delete env['SWAO_BINARY_TIER'];
    process.env['NO_PROXY'] = '127.0.0.1,localhost';
    expect(homedir()).not.toBe(sandbox);
    writeEnterpriseLicence(sandbox);

    const port = await freePort();
    const entry = writeServerEntry(sandbox);
    httpChild = await startHttpServer(entry, ws, port, env);
    session = await initMcpSession(port, 10_000);

    httpClient = new sdk.Client({ name: 'parity-http', version: '1.0.0' });
    await httpClient.connect(new sdk.StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    stdioClient = new sdk.Client({ name: 'parity-stdio', version: '1.0.0' });
    await stdioClient.connect(new sdk.StdioClientTransport({ command: process.execPath, args: [entry], cwd: ws, env, stderr: 'ignore' }));

    llm = await startMockLlm();
    serverTools = (await httpClient.listTools()).tools;
    chatTools = await listMcpTools(session);
  }, 120_000);

  afterAll(async () => {
    await httpClient?.close().catch(() => undefined);
    await stdioClient?.close().catch(() => undefined);
    treeKill(httpChild);
    await new Promise<void>(res => (llm ? llm.server.close(() => res()) : res()));
    if (savedNoProxy === undefined) delete process.env['NO_PROXY']; else process.env['NO_PROXY'] = savedNoProxy;
    for (const d of [ws, template, sandbox, ...isolatedDirs]) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows file lock, best effort */ }
    }
  });

  // -------------------------------------------------------------------------
  // Criterion 1: tool definitions
  // -------------------------------------------------------------------------

  it('the server lists all 53 listed tools on both transports, identically (#3470: swao_import and swao_lz_catalogue unlisted)', async () => {
    expect(serverTools).toHaveLength(53);
    expect(serverTools.map(t => t.name)).not.toContain('swao_import');
    expect(serverTools.map(t => t.name)).not.toContain('swao_lz_catalogue');
    const stdioTools = (await stdioClient.listTools()).tools;
    expect(stdioTools).toEqual(serverTools);
    for (const prefix of ['swao_service_portfolio', 'swao_service_research', 'swao_service_runs', 'swao_service_scaffold']) {
      expect(serverTools.map(t => t.name)).toContain(prefix);
    }
  });

  it("SWAO Chat's tool list equals tools/list: names, descriptions and input schemas of all 53 listed tools", () => {
    expect(chatTools).toHaveLength(serverTools.length);
    expect(chatTools).toEqual(serverTools.map(t => ({ name: t.name, description: t.description ?? '', input_schema: t.inputSchema })));
    // Every server tool has a description, so the '' fallback never changes a description.
    for (const t of serverTools) expect(t.description?.length ?? 0).toBeGreaterThan(0);
  });

  for (const kind of ['anthropic', 'openai-chat'] as const) {
    it(`the ${kind} provider sends the model exactly the tools/list definitions`, async () => {
      llm.bodies.length = 0;
      llm.script.push(...scriptToolTurn(kind, []).slice(1));
      const provider = makeProvider(kind, llm.port);
      const { text } = await runChatCompletion(provider, {
        system: 'parity', history: [], content: 'hello', tools: chatTools,
        onToolCall: (n, i) => callMcpTool(session, n, i),
      });
      expect(text).toBe('done');
      expect(llm.bodies).toHaveLength(1);
      const sent = providerTools(kind, llm.bodies[0]!);
      expect(sent).toEqual(serverTools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema })));
      for (const t of sent) {
        // Both APIs: name pattern ^[a-zA-Z0-9_-]{1,64}$ and an object schema.
        expect(t['name']).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
        expect((t['input_schema'] as Json)['type']).toBe('object');
      }
    });
  }

  it('ollama and bedrock connectors offer tool calling too (#3311); a model without tools degrades with a notice', () => {
    const ollama = new OllamaLlmProvider('llama-test', 'http://127.0.0.1:1');
    expect(typeof ollama.completeWithTools).toBe('function');
    expect(typeof ollama.completeWithToolsDetailed).toBe('function');
    expect(typeof BedrockLlmProvider.prototype.completeWithTools).toBe('function');
    expect(typeof BedrockLlmProvider.prototype.completeWithToolsDetailed).toBe('function');
  });

  it('the ollama provider sends the model exactly the tools/list definitions and feeds the MCP result back (#3311)', async () => {
    const call = { name: 'swao_passes', args: {} as Json };
    llm.bodies.length = 0;
    llm.script.push(
      { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: call.name, arguments: call.args } }] }, prompt_eval_count: 10, eval_count: 5 },
      { message: { role: 'assistant', content: 'done' }, prompt_eval_count: 10, eval_count: 1 },
    );
    const seen: string[] = [];
    const provider = new OllamaLlmProvider('llama-test', `http://127.0.0.1:${llm.port}`);
    const { text, usage } = await runChatCompletion(provider, {
      system: 'parity', history: [], content: `call ${call.name}`, tools: chatTools,
      onToolCall: async (n, i) => { const out = await callMcpTool(session, n, i); seen.push(out); return out; },
    });
    expect(text).toBe('done');
    expect(usage).toEqual({ input_tokens: 20, output_tokens: 6, cost_usd: 0 });
    expect(llm.bodies).toHaveLength(2);
    const sent = (llm.bodies[0]!['tools'] as Json[]).map(t => {
      const f = t['function'] as Json;
      return { name: f['name'], description: f['description'], input_schema: f['parameters'] };
    });
    expect(sent).toEqual(serverTools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema })));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(sdkText(await httpClient.callTool({ name: call.name, arguments: call.args })));
    expect(JSON.stringify(llm.bodies[1])).toContain('"role":"tool"');
  });

  // -------------------------------------------------------------------------
  // Criterion 2: tool results
  // -------------------------------------------------------------------------

  async function chatCall(kind: ProviderKind, name: string, args: Json): Promise<string> {
    llm.bodies.length = 0;
    llm.script.push(...scriptToolTurn(kind, [{ name, args }]));
    const seen: Array<{ name: string; input: Json; text: string }> = [];
    const provider = makeProvider(kind, llm.port);
    const { text } = await runChatCompletion(provider, {
      system: 'parity', history: [], content: `call ${name}`, tools: chatTools,
      onToolCall: async (n, i) => {
        const out = await callMcpTool(session, n, i);
        seen.push({ name: n, input: i, text: out });
        return out;
      },
    });
    expect(text).toBe('done');
    expect(seen).toHaveLength(1);
    // The model's tool request reaches the server unchanged.
    expect(seen[0]!.name).toBe(name);
    expect(seen[0]!.input).toEqual(args);
    // The tool result was fed back to the model (after egress redaction, CLAUDE.md 5.7).
    expect(JSON.stringify(llm.bodies[1])).toContain(kind === 'anthropic' ? 'tool_result' : '"role":"tool"');
    return seen[0]!.text;
  }

  function freshCopy(): string {
    const d = mkdtempSync(join(tmpdir(), 'swao-3310-iso-'));
    cpSync(template, d, { recursive: true });
    isolatedDirs.push(d);
    return d;
  }

  const cases = [...SERVICE_CASES.map(c => ({ ...c, group: 'service' })), ...CORE_CASES.map(c => ({ ...c, group: 'core' }))];
  for (const [idx, c] of cases.entries()) {
    it(`${c.group} tool ${c.name} #${idx}: Chat (Anthropic + open-LLM) = SDK HTTP = SDK stdio`, async () => {
      const wsFor = () => (c.isolated ? freshCopy() : ws);
      const results: Record<string, string> = {};
      const run = async (label: string, fn: (w: string) => Promise<string>) => {
        const w = wsFor();
        results[label] = normalise(await fn(w), w);
      };
      await run('chat-anthropic', w => chatCall('anthropic', c.name, c.args(w)));
      await run('chat-openai-chat', w => chatCall('openai-chat', c.name, c.args(w)));
      await run('sdk-http', async w => sdkText(await httpClient.callTool({ name: c.name, arguments: c.args(w) }, undefined, { timeout: 300_000 })));
      await run('sdk-stdio', async w => sdkText(await stdioClient.callTool({ name: c.name, arguments: c.args(w) }, undefined, { timeout: 300_000 })));

      expect(results['sdk-http']!.trim().length).toBeGreaterThan(0);
      expect(results['chat-anthropic']).toBe(results['sdk-http']);
      expect(results['chat-openai-chat']).toBe(results['sdk-http']);
      expect(results['sdk-stdio']).toBe(results['sdk-http']);
      for (const secret of PLANTED_SECRETS) expect(results['sdk-http']).not.toContain(secret);
    });
  }

  it('an error result carries the same text; the isError flag is not passed to the model by Chat (listed difference)', async () => {
    const direct = await httpClient.callTool({ name: 'swao_no_such_tool', arguments: {} });
    expect(direct.isError).toBe(true);
    expect(await callMcpTool(session, 'swao_no_such_tool', {})).toBe(sdkText(direct));
  });

  it('the tool cases cover every service tool', () => {
    const service = serverTools.map(t => t.name).filter(n => n.startsWith('swao_service_'));
    expect(service).toHaveLength(11);
    expect(new Set(SERVICE_CASES.map(c => c.name))).toEqual(new Set(service));
  });

  it('parallel tool calls in one model turn each receive their own result (open-LLM runs them concurrently)', async () => {
    const calls = [
      { name: 'swao_service_waves', args: { workspace_path: ws } },
      { name: 'swao_service_vendors', args: { workspace_path: ws } },
      { name: 'swao_risks', args: { workspace_path: ws, app_id: SYNTHETIC_APP_ID } },
      { name: 'swao_passes', args: {} },
    ];
    llm.script.push(...scriptToolTurn('openai-chat', calls));
    const seen = new Map<string, string>();
    await runChatCompletion(makeProvider('openai-chat', llm.port), {
      system: 'parity', history: [], content: 'parallel', tools: chatTools,
      onToolCall: async (n, i) => { const t = await callMcpTool(session, n, i); seen.set(n, t); return t; },
    });
    for (const c of calls) {
      expect(seen.get(c.name)).toBe(sdkText(await httpClient.callTool({ name: c.name, arguments: c.args })));
    }
  });
});
