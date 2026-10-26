// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator -- swao mcp install --client: safe writer and Kilo target
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3478 (Design 116 REQ-13.4): golden-file tests for the safe client-config
// writer. Safety: every test runs in a temp sandbox. HOME, USERPROFILE,
// HOMEDRIVE, HOMEPATH, APPDATA, LOCALAPPDATA and XDG_CONFIG_HOME point into it,
// and every path the installer uses (home, XDG config, project folder, Claude
// Desktop candidates) is injected, so no test can read or write a real client
// config.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import type { McpClientInstallRequest } from '@swao/module-mcp';
import { findOnPath, installMcpClient, runCommandSync, type McpClientInstallEnv } from './mcp-client-install.js';
import { NODE_WRITER_FS, backupTimestamp } from './mcp-safe-writer.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mcp-install');
const BOM = String.fromCharCode(0xfeff);
const SANDBOX_KEYS =['HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME'] as const;

let root: string;
let home: string;
let project: string;
let bin: string;
let ws: string;
let saved: Record<string, string | undefined>;
let env: McpClientInstallEnv;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'swao-mcp-install-'));
  home = join(root, 'home');
  project = join(root, 'project');
  bin = join(root, 'bin', 'swao-enterprise-linux-x64');
  ws = join(root, 'workspace');
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  saved = Object.fromEntries(SANDBOX_KEYS.map((k) => [k, process.env[k]]));
  for (const k of SANDBOX_KEYS) process.env[k] = join(root, 'sandbox-env', k);
  // #3479: no test may find or run the real claude CLI; PATH is emptied and the lookup and runner are stubs.
  saved['PATH'] = process.env['PATH'];
  process.env['PATH'] = join(root, 'empty-path');
  env = {
    homeDir: home,
    env: { XDG_CONFIG_HOME: join(home, '.config') },
    claudeDesktopCandidates: () => [],
    findExecutable: () => undefined,
    runCommand: () => { throw new Error('runCommand must be stubbed per test'); },
  };
});

afterEach(() => {
  for (const k of [...SANDBOX_KEYS, 'PATH']) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(root, { recursive: true, force: true });
});

function req(over: Partial<McpClientInstallRequest> = {}): McpClientInstallRequest {
  return {
    client: 'kilo',
    scope: 'user',
    profile: 'starter',
    profileExplicit: false,
    tools: ['swao', 'swao_health_check', 'swao_workspace_inventory', 'swao_frameworks_list', 'swao_passes'],
    transport: 'stdio',
    url: 'http://localhost:3737/mcp',
    agent: false,
    dryRun: false,
    uninstall: false,
    workspace: ws,
    binary: { path: bin, args: ['mcp'] },
    projectDir: project,
    version: '1.5.0',
    ...over,
  };
}

const kiloUser = (): string => join(home, '.config', 'kilo', 'kilo.json');

/** JSON-escaped placeholder values (Windows paths carry backslashes). */
function fill(golden: string): string {
  const esc = (s: string): string => JSON.stringify(s).slice(1, -1);
  return golden.replaceAll('<BIN>', esc(bin)).replaceAll('<WS>', esc(ws));
}

function golden(name: string): string {
  return fill(readFileSync(join(FIXTURES, name), 'utf-8'));
}

function seed(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf-8');
}

function backups(path: string): string[] {
  return existsSync(dirname(path)) ? readdirSync(dirname(path)).filter((f) => f.includes('.swao-backup-')) : [];
}

describe('swao mcp install --client kilo: golden files (#3478)', () => {
  it('new file: creates the user config with the stdio entry', () => {
    const r = installMcpClient(req(), env);
    expect(r.exitCode).toBe(0);
    expect(readFileSync(kiloUser(), 'utf-8')).toBe(golden('kilo-new.expected.json'));
    expect(backups(kiloUser())).toEqual([]);
    expect(r.out.join('\n')).toContain('(new file)');
  });

  it('file with other servers: only the swao entry is added, everything else untouched', () => {
    seed(kiloUser(), readFileSync(join(FIXTURES, 'kilo-other-servers.in.json'), 'utf-8'));
    expect(installMcpClient(req(), env).exitCode).toBe(0);
    expect(readFileSync(kiloUser(), 'utf-8')).toBe(golden('kilo-other-servers.expected.json'));
  });

  it('existing swao entry: updated in place', () => {
    seed(kiloUser(), readFileSync(join(FIXTURES, 'kilo-existing-lower.in.json'), 'utf-8'));
    expect(installMcpClient(req(), env).exitCode).toBe(0);
    expect(readFileSync(kiloUser(), 'utf-8')).toBe(golden('kilo-existing-lower.expected.json'));
  });

  it('existing SWAO entry: updated in place under its own key, no duplicate, operator fields kept', () => {
    seed(kiloUser(), readFileSync(join(FIXTURES, 'kilo-existing-upper.in.json'), 'utf-8'));
    expect(installMcpClient(req(), env).exitCode).toBe(0);
    const text = readFileSync(kiloUser(), 'utf-8');
    expect(text).toBe(golden('kilo-existing-upper.expected.json'));
    const mcp = (JSON.parse(text) as { mcp: Record<string, { environment?: unknown }> }).mcp;
    expect(Object.keys(mcp)).toEqual(['other', 'SWAO']);
    expect(mcp['SWAO']?.environment).toEqual({ SWAO_LOG: 'debug' });
  });

  it('file without an mcp block, tab indented: the block is added in the file layout', () => {
    seed(kiloUser(), readFileSync(join(FIXTURES, 'kilo-no-container.in.json'), 'utf-8'));
    expect(installMcpClient(req(), env).exitCode).toBe(0);
    expect(readFileSync(kiloUser(), 'utf-8')).toBe(golden('kilo-no-container.expected.json'));
  });

  it('unparsable file: nothing changes, exit 2, the file and the parse error are named', () => {
    const broken = '{ "mcp": { "github": { "type": "remote", } }\n';
    seed(kiloUser(), broken);
    const r = installMcpClient(req(), env);
    expect(r.exitCode).toBe(2);
    expect(r.err.join('\n')).toContain(kiloUser());
    expect(r.err.join('\n')).toMatch(/not valid JSON/);
    expect(readFileSync(kiloUser(), 'utf-8')).toBe(broken);
    expect(backups(kiloUser())).toEqual([]);
  });

  it('JSON with comments is refused, never stripped', () => {
    const jsonc = '{\n  // my servers\n  "mcp": {}\n}\n';
    seed(kiloUser(), jsonc);
    const r = installMcpClient(req(), env);
    expect(r.exitCode).toBe(2);
    expect(r.err.join('\n')).toMatch(/comments/);
    expect(readFileSync(kiloUser(), 'utf-8')).toBe(jsonc);
  });

  it('uninstall of an unparsable file: nothing changes, exit 2', () => {
    seed(kiloUser(), '{ nope');
    expect(installMcpClient(req({ uninstall: true }), env).exitCode).toBe(2);
    expect(readFileSync(kiloUser(), 'utf-8')).toBe('{ nope');
  });
});

describe('swao mcp install --client kilo: round trip, backups, idempotence, dry run (#3478)', () => {
  const inputs = ['kilo-other-servers.in.json', 'kilo-no-container.in.json'];
  for (const name of inputs) {
    it(`install then uninstall leaves ${name} byte-identical; a backup exists after each write`, () => {
      const original = readFileSync(join(FIXTURES, name), 'utf-8');
      seed(kiloUser(), original);
      let t = 0;
      const clock: McpClientInstallEnv = { ...env, now: () => new Date(Date.UTC(2026, 9, 24, 10, 0, 0, t++)) };
      expect(installMcpClient(req(), clock).exitCode).toBe(0);
      expect(backups(kiloUser())).toHaveLength(1);
      expect(installMcpClient(req({ uninstall: true }), clock).exitCode).toBe(0);
      expect(backups(kiloUser())).toHaveLength(2);
      expect(readFileSync(kiloUser(), 'utf-8')).toBe(original);
    });
  }

  it('round trip keeps CRLF line endings, a BOM and four-space indentation byte for byte', () => {
    const original = BOM + '{\r\n    "mcp": {\r\n        "a": {\r\n            "type": "local",\r\n            "command": ["a"]\r\n        }\r\n    }\r\n}\r\n';
    seed(kiloUser(), original);
    expect(installMcpClient(req(), env).exitCode).toBe(0);
    const installed = readFileSync(kiloUser(), 'utf-8');
    expect(installed.startsWith(BOM)).toBe(true);
    expect(installed.replace(/\r\n/g, '')).not.toContain('\n');
    expect(installed).toContain('\r\n        "swao": {\r\n            "type": "local",');
    expect(installMcpClient(req({ uninstall: true }), env).exitCode).toBe(0);
    expect(readFileSync(kiloUser(), 'utf-8')).toBe(original);
  });

  it('round trip on a single-line file', () => {
    const original = '{"mcp":{"a":{"type":"local","command":["a"],"enabled":true}}}';
    seed(kiloUser(), original);
    expect(installMcpClient(req(), env).exitCode).toBe(0);
    expect(JSON.parse(readFileSync(kiloUser(), 'utf-8'))).toHaveProperty('mcp.swao.type', 'local');
    expect(installMcpClient(req({ uninstall: true }), env).exitCode).toBe(0);
    expect(readFileSync(kiloUser(), 'utf-8')).toBe(original);
  });

  it('install into a missing file then uninstall removes the file again (with a backup)', () => {
    expect(installMcpClient(req(), env).exitCode).toBe(0);
    const r = installMcpClient(req({ uninstall: true }), env);
    expect(r.exitCode).toBe(0);
    expect(existsSync(kiloUser())).toBe(false);
    expect(backups(kiloUser())).toHaveLength(1);
  });

  it('a second identical install changes nothing and says so', () => {
    expect(installMcpClient(req(), env).exitCode).toBe(0);
    const before = readFileSync(kiloUser(), 'utf-8');
    const r = installMcpClient(req(), env);
    expect(r.exitCode).toBe(0);
    expect(r.out.join('\n')).toContain('no change');
    expect(r.out.join('\n')).toContain('No change: SWAO is already configured.');
    expect(readFileSync(kiloUser(), 'utf-8')).toBe(before);
    expect(backups(kiloUser())).toEqual([]);
  });

  it('--dry-run prints a diff and writes nothing: no file, no folder, no backup', () => {
    const r = installMcpClient(req({ dryRun: true }), env);
    expect(r.exitCode).toBe(0);
    expect(r.out.join('\n')).toContain('would change');
    expect(r.out.join('\n')).toContain('+    "swao": {');
    expect(existsSync(join(home, '.config'))).toBe(false);
  });

  it('--dry-run on an existing file leaves it and its folder as they were', () => {
    const original = readFileSync(join(FIXTURES, 'kilo-other-servers.in.json'), 'utf-8');
    seed(kiloUser(), original);
    const r = installMcpClient(req({ dryRun: true }), env);
    expect(r.out.join('\n')).toMatch(/^\s+-\s+}$|^\s+\+\s+},$/m);
    expect(readFileSync(kiloUser(), 'utf-8')).toBe(original);
    expect(readdirSync(dirname(kiloUser()))).toEqual(['kilo.json']);
  });

  it('a failed rename leaves the original file untouched and no temp file behind', () => {
    const original = readFileSync(join(FIXTURES, 'kilo-other-servers.in.json'), 'utf-8');
    seed(kiloUser(), original);
    const r = installMcpClient(req(), { ...env, fs: { ...NODE_WRITER_FS, rename: () => { throw new Error('EBUSY: simulated'); } } });
    expect(r.exitCode).toBe(1);
    expect(r.err.join('\n')).toContain('EBUSY');
    expect(readFileSync(kiloUser(), 'utf-8')).toBe(original);
    expect(readdirSync(dirname(kiloUser())).filter((f) => f.includes('swao-tmp'))).toEqual([]);
  });

  it('backup names carry no colon (illegal on Windows) and include milliseconds', () => {
    expect(backupTimestamp(new Date(Date.UTC(2026, 9, 24, 10, 1, 2, 345)))).toBe('20261024T100102345Z');
  });
});

describe('swao mcp install --client kilo: paths and transports (#3478)', () => {
  it('written command and workspace are absolute and carry the profile', () => {
    installMcpClient(req({ profile: 'assess' }), env);
    const entry = (JSON.parse(readFileSync(kiloUser(), 'utf-8')) as { mcp: { swao: { command: string[] } } }).mcp.swao;
    expect(isAbsolute(entry.command[0] ?? '')).toBe(true);
    expect(entry.command).toEqual([resolve(bin), 'mcp', '--workspace', resolve(ws), '--profile', 'assess']);
  });

  it('a source run registers node plus the script path before mcp', () => {
    const node = join(root, 'node');
    const script = join(root, 'dist', 'index.js');
    installMcpClient(req({ binary: { path: node, args: [script, 'mcp'] } }), env);
    const entry = (JSON.parse(readFileSync(kiloUser(), 'utf-8')) as { mcp: { swao: { command: string[] } } }).mcp.swao;
    expect(entry.command.slice(0, 3)).toEqual([resolve(node), script, 'mcp']);
  });

  it('http entry uses the given URL and the remote type; the report names swao mcp --http', () => {
    const r = installMcpClient(req({ transport: 'http' }), env);
    const entry = (JSON.parse(readFileSync(kiloUser(), 'utf-8')) as { mcp: { swao: unknown } }).mcp.swao;
    expect(entry).toEqual({ type: 'remote', url: 'http://localhost:3737/mcp', enabled: true });
    expect(r.out.join('\n')).toContain('swao mcp --http --profile starter');
    installMcpClient(req({ transport: 'http', url: 'http://host.docker.internal:3737/mcp' }), env);
    const updated = (JSON.parse(readFileSync(kiloUser(), 'utf-8')) as { mcp: { swao: { url: string } } }).mcp.swao;
    expect(updated.url).toBe('http://host.docker.internal:3737/mcp');
  });

  it('project scope writes ./kilo.json, or .kilo/kilo.json when only that exists', () => {
    installMcpClient(req({ scope: 'project' }), env);
    expect(existsSync(join(project, 'kilo.json'))).toBe(true);
    rmSync(join(project, 'kilo.json'));
    seed(join(project, '.kilo', 'kilo.json'), '{}\n');
    installMcpClient(req({ scope: 'project' }), env);
    expect(existsSync(join(project, 'kilo.json'))).toBe(false);
    expect(JSON.parse(readFileSync(join(project, '.kilo', 'kilo.json'), 'utf-8'))).toHaveProperty('mcp.swao');
  });

  it('XDG_CONFIG_HOME relocates the user config', () => {
    const xdg = join(root, 'xdg');
    installMcpClient(req(), { ...env, env: { XDG_CONFIG_HOME: xdg } });
    expect(existsSync(join(xdg, 'kilo', 'kilo.json'))).toBe(true);
  });

  it('never writes a secret: the entry holds only type, command and enabled', () => {
    installMcpClient(req(), env);
    const entry = (JSON.parse(readFileSync(kiloUser(), 'utf-8')) as { mcp: { swao: Record<string, unknown> } }).mcp.swao;
    expect(Object.keys(entry).sort()).toEqual(['command', 'enabled', 'type']);
  });
});

describe('swao mcp install --client claude-desktop: safe writer (#3478)', () => {
  it('updates the configured Claude Desktop files through the safe writer and refuses an unparsable one', () => {
    const cfg = join(root, 'Claude', 'claude_desktop_config.json');
    seed(cfg, '{ broken');
    const e: McpClientInstallEnv = { ...env, claudeDesktopCandidates: () => [{ path: cfg, kind: 'conventional', effective: true }] };
    const refused = installMcpClient(req({ client: 'claude-desktop', profile: 'full' }), e);
    expect(refused.exitCode).toBe(2);
    expect(readFileSync(cfg, 'utf-8')).toBe('{ broken');
    seed(cfg, '{\n  "mcpServers": {\n    "swao-mcp": {\n      "command": "/old/swao-enterprise-win-x64.exe",\n      "args": ["mcp"]\n    }\n  }\n}\n');
    expect(installMcpClient(req({ client: 'claude-desktop', profile: 'assess', profileExplicit: true }), e).exitCode).toBe(0);
    const servers = (JSON.parse(readFileSync(cfg, 'utf-8')) as { mcpServers: Record<string, unknown> }).mcpServers;
    expect(Object.keys(servers)).toEqual(['swao-mcp']);
    expect(servers['swao-mcp']).toEqual({ command: resolve(bin), args: ['mcp', '--profile', 'assess'] });
  });

  it('refuses --transport http for Claude Desktop', () => {
    expect(installMcpClient(req({ client: 'claude-desktop', transport: 'http' }), env).exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// #3479: Claude Code (Design 116 REQ-13 table, ADR-0045)
// ---------------------------------------------------------------------------

describe('swao mcp install --client claude-code: .mcp.json golden files (#3479)', () => {
  const mcpJson = (): string => join(project, '.mcp.json');
  const cc = (over: Partial<McpClientInstallRequest> = {}): McpClientInstallRequest =>
    req({ client: 'claude-code', transport: 'http', scope: 'project', ...over });

  it('new file: http entry with the localhost URL', () => {
    expect(installMcpClient(cc(), env).exitCode).toBe(0);
    expect(readFileSync(mcpJson(), 'utf-8')).toBe(golden('claude-code-new.expected.json'));
  });

  it('other servers are kept', () => {
    seed(mcpJson(), readFileSync(join(FIXTURES, 'claude-code-other-servers.in.json'), 'utf-8'));
    expect(installMcpClient(cc(), env).exitCode).toBe(0);
    expect(readFileSync(mcpJson(), 'utf-8')).toBe(golden('claude-code-other-servers.expected.json'));
  });

  it('an existing SWAO entry is updated in place without a duplicate', () => {
    seed(mcpJson(), readFileSync(join(FIXTURES, 'claude-code-existing-upper.in.json'), 'utf-8'));
    expect(installMcpClient(cc(), env).exitCode).toBe(0);
    const text = readFileSync(mcpJson(), 'utf-8');
    expect(text).toBe(golden('claude-code-existing-upper.expected.json'));
    expect(Object.keys((JSON.parse(text) as { mcpServers: object }).mcpServers)).toEqual(['SWAO', 'docs']);
  });

  it('unparsable file: exit 2, unchanged', () => {
    seed(mcpJson(), '{"mcpServers": {,}}');
    expect(installMcpClient(cc(), env).exitCode).toBe(2);
    expect(readFileSync(mcpJson(), 'utf-8')).toBe('{"mcpServers": {,}}');
  });

  it('install then uninstall is byte-identical', () => {
    const original = readFileSync(join(FIXTURES, 'claude-code-other-servers.in.json'), 'utf-8');
    seed(mcpJson(), original);
    installMcpClient(cc(), env);
    expect(installMcpClient(cc({ uninstall: true }), env).exitCode).toBe(0);
    expect(readFileSync(mcpJson(), 'utf-8')).toBe(original);
  });

  it('the default URL is http://localhost:<port>/mcp, never 127.0.0.1; the report names swao mcp --http', () => {
    const r = installMcpClient(cc(), env);
    const text = readFileSync(mcpJson(), 'utf-8');
    expect(text).toContain('http://localhost:3737/mcp');
    expect(text).not.toContain('127.0.0.1');
    expect(r.out.join('\n')).toContain('swao mcp --http');
  });

  it('--transport stdio writes the absolute command with workspace and profile', () => {
    installMcpClient(cc({ transport: 'stdio' }), env);
    const entry = (JSON.parse(readFileSync(mcpJson(), 'utf-8')) as { mcpServers: { swao: unknown } }).mcpServers.swao;
    expect(entry).toEqual({ type: 'stdio', command: resolve(bin), args: ['mcp', '--workspace', resolve(ws), '--profile', 'starter'] });
  });
});

describe('swao mcp install --client claude-code: claude CLI (#3479)', () => {
  const CLAUDE = '/stub/bin/claude';
  const cc = (over: Partial<McpClientInstallRequest> = {}): McpClientInstallRequest =>
    req({ client: 'claude-code', transport: 'http', scope: 'user', ...over });
  function withStub(): { e: McpClientInstallEnv; calls: Array<{ command: string; args: ReadonlyArray<string> }> } {
    const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
    return {
      calls,
      e: { ...env, findExecutable: (n) => (n === 'claude' ? CLAUDE : undefined), runCommand: (command, args) => { calls.push({ command, args }); return { status: 0, stdout: '', stderr: '' }; } },
    };
  }

  it('with claude on PATH the exact claude mcp add arguments are issued and no file is written', () => {
    const { e, calls } = withStub();
    expect(installMcpClient(cc(), e).exitCode).toBe(0);
    expect(calls).toEqual([{ command: CLAUDE, args: ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'swao', 'http://localhost:3737/mcp'] }]);
    expect(existsSync(join(project, '.mcp.json'))).toBe(false);
  });

  it('an existing SWAO entry in the user config is replaced under its own key (remove, then add)', () => {
    seed(join(home, '.claude.json'), JSON.stringify({ mcpServers: { SWAO: { type: 'http', url: 'http://127.0.0.1:3737/mcp' } } }));
    const before = readFileSync(join(home, '.claude.json'), 'utf-8');
    const { e, calls } = withStub();
    installMcpClient(cc(), e);
    expect(calls.map((c) => c.args)).toEqual([
      ['mcp', 'remove', 'SWAO', '--scope', 'user'],
      ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'SWAO', 'http://localhost:3737/mcp'],
    ]);
    expect(readFileSync(join(home, '.claude.json'), 'utf-8')).toBe(before);
  });

  it('a current entry issues no command and says no change; uninstall removes it', () => {
    seed(join(home, '.claude.json'), JSON.stringify({ mcpServers: { swao: { type: 'http', url: 'http://localhost:3737/mcp' } } }));
    const { e, calls } = withStub();
    const r = installMcpClient(cc(), e);
    expect(calls).toEqual([]);
    expect(r.out.join('\n')).toContain('no change');
    installMcpClient(cc({ uninstall: true }), e);
    expect(calls.map((c) => c.args)).toEqual([['mcp', 'remove', 'swao', '--scope', 'user']]);
  });

  it('--dry-run prints the command and runs nothing', () => {
    const { e, calls } = withStub();
    const r = installMcpClient(cc({ dryRun: true }), e);
    expect(calls).toEqual([]);
    expect(r.out.join('\n')).toContain('would run claude mcp add --transport http --scope user swao http://localhost:3737/mcp');
  });

  it('a failing claude command exits 1 with its stderr', () => {
    const e: McpClientInstallEnv = { ...env, findExecutable: () => CLAUDE, runCommand: () => ({ status: 1, stdout: '', stderr: 'policy refused' }) };
    const r = installMcpClient(cc(), e);
    expect(r.exitCode).toBe(1);
    expect(r.err.join('\n')).toContain('policy refused');
  });

  it('findOnPath resolves a Windows .cmd shim through PATHEXT (temp PATH only)', () => {
    const dir = join(root, 'pathdir');
    seed(join(dir, 'claude.cmd'), '@echo off\n');
    expect(findOnPath('claude', { PATH: dir, PATHEXT: '.exe;.cmd' }, 'win32')).toBe(join(dir, 'claude.cmd'));
    expect(findOnPath('claude', { PATH: join(root, 'nothing') }, 'win32')).toBeUndefined();
  });

  it('runCommandSync refuses a cmd.exe metacharacter for a .cmd shim instead of escaping it', () => {
    const r = runCommandSync(join(root, 'claude.cmd'), ['mcp', 'add', 'swao', 'http://localhost:3737/mcp&calc']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('refused');
  });

  it('without claude on PATH the project .mcp.json is written and the report says why', () => {
    const r = installMcpClient(cc(), env);
    expect(r.exitCode).toBe(0);
    expect(readFileSync(join(project, '.mcp.json'), 'utf-8')).toBe(golden('claude-code-new.expected.json'));
    expect(r.out.join('\n')).toContain('not on PATH');
  });
});

// ---------------------------------------------------------------------------
// #3480: agent files (Design 116 REQ-14)
// ---------------------------------------------------------------------------

describe('swao mcp install --agent: agent files (#3480)', () => {
  const kiloAgent = (): string => join(home, '.config', 'kilo', 'agents', 'swao.md');
  const ccAgent = (): string => join(home, '.claude', 'agents', 'swao.md');

  it('Kilo: install writes the agent with the written key and profile; uninstall removes it with a backup', () => {
    seed(kiloUser(), readFileSync(join(FIXTURES, 'kilo-existing-upper.in.json'), 'utf-8'));
    expect(installMcpClient(req({ agent: true }), env).exitCode).toBe(0);
    const text = readFileSync(kiloAgent(), 'utf-8');
    expect(text).toContain('<!-- generated by swao 1.5.0, profile starter -->');
    expect(text).toContain('  SWAO_swao_health_check: allow');
    const r = installMcpClient(req({ agent: true, uninstall: true }), env);
    expect(r.exitCode).toBe(0);
    expect(existsSync(kiloAgent())).toBe(false);
    expect(backups(kiloAgent())).toHaveLength(1);
  });

  it('regenerated on every install: a profile change rewrites the file; an identical run changes nothing', () => {
    installMcpClient(req({ agent: true }), env);
    installMcpClient(req({ agent: true, profile: 'assess', tools: ['swao', 'swao_assess'] }), env);
    expect(readFileSync(kiloAgent(), 'utf-8')).toContain('profile assess');
    const again = installMcpClient(req({ agent: true, profile: 'assess', tools: ['swao', 'swao_assess'] }), env);
    expect(again.out.join('\n')).toContain('No change');
  });

  it('a swao.md not generated by SWAO is refused on install (nothing written) and left in place on uninstall', () => {
    seed(kiloAgent(), '---\ndescription: mine\n---\nMy own agent.\n');
    const r = installMcpClient(req({ agent: true }), env);
    expect(r.exitCode).toBe(2);
    expect(existsSync(kiloUser())).toBe(false);
    expect(readFileSync(kiloAgent(), 'utf-8')).toContain('My own agent.');
    const u = installMcpClient(req({ agent: true, uninstall: true }), env);
    expect(u.exitCode).toBe(0);
    expect(u.out.join('\n')).toContain('not generated by SWAO');
    expect(readFileSync(kiloAgent(), 'utf-8')).toContain('My own agent.');
  });

  it('Claude Code: the agent lists mcp__<key>__<tool> in the sandboxed user agents folder; project scope uses .claude/agents', () => {
    expect(installMcpClient(req({ client: 'claude-code', transport: 'http', agent: true, scope: 'project' }), env).exitCode).toBe(0);
    expect(readFileSync(join(project, '.claude', 'agents', 'swao.md'), 'utf-8')).toContain('tools: mcp__swao__swao, mcp__swao__swao_health_check');
    const calls: string[][] = [];
    const e: McpClientInstallEnv = { ...env, findExecutable: () => '/stub/claude', runCommand: (_c, a) => { calls.push([...a]); return { status: 0, stdout: '', stderr: '' }; } };
    expect(installMcpClient(req({ client: 'claude-code', transport: 'http', agent: true }), e).exitCode).toBe(0);
    expect(readFileSync(ccAgent(), 'utf-8')).toContain('/mcp__swao__start');
  });

  it('--dry-run writes no agent file', () => {
    installMcpClient(req({ agent: true, dryRun: true }), env);
    expect(existsSync(kiloAgent())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #3481: Cursor and VS Code (formats verified against the official docs, 2026-10-24)
// ---------------------------------------------------------------------------

describe('swao mcp install --client cursor and vscode: golden files (#3481)', () => {
  const clients = [
    { client: 'cursor' as const, scope: 'user' as const, path: (): string => join(home, '.cursor', 'mcp.json'), prefix: 'cursor' },
    { client: 'vscode' as const, scope: 'project' as const, path: (): string => join(project, '.vscode', 'mcp.json'), prefix: 'vscode' },
  ];
  for (const c of clients) {
    const r0 = (over: Partial<McpClientInstallRequest> = {}): McpClientInstallRequest =>
      req({ client: c.client, scope: c.scope, profile: 'full', agent: false, ...over });

    it(`${c.client}: new file`, () => {
      { const r = installMcpClient(r0(), env); expect(r.exitCode, JSON.stringify(r)).toBe(0); }
      expect(readFileSync(c.path(), 'utf-8')).toBe(golden(`${c.prefix}-new.expected.json`));
    });

    it(`${c.client}: other servers kept, existing entry updated in place`, () => {
      seed(c.path(), readFileSync(join(FIXTURES, `${c.prefix}-other-servers.in.json`), 'utf-8'));
      { const r = installMcpClient(r0(), env); expect(r.exitCode, JSON.stringify(r)).toBe(0); }
      expect(readFileSync(c.path(), 'utf-8')).toBe(golden(`${c.prefix}-other-servers.expected.json`));
    });

    it(`${c.client}: unparsable file (JSON with comments) exits 2 and stays unchanged`, () => {
      const jsonc = '{\n  // servers\n  "servers": {}\n}\n';
      seed(c.path(), jsonc);
      { const r = installMcpClient(r0(), env); expect(r.exitCode, JSON.stringify(r)).toBe(2); }
      expect(readFileSync(c.path(), 'utf-8')).toBe(jsonc);
      expect(backups(c.path())).toEqual([]);
    });

    it(`${c.client}: install then uninstall is byte-identical`, () => {
      const original = c.client === 'vscode'
        ? readFileSync(join(FIXTURES, 'vscode-other-servers.in.json'), 'utf-8')
        : '{\n  "mcpServers": {\n    "docs": {\n      "url": "https://example.invalid/mcp"\n    }\n  }\n}\n';
      seed(c.path(), original);
      { const r = installMcpClient(r0(), env); expect(r.exitCode, JSON.stringify(r)).toBe(0); }
      { const r = installMcpClient(r0({ uninstall: true }), env); expect(r.exitCode, JSON.stringify(r)).toBe(0); }
      expect(readFileSync(c.path(), 'utf-8')).toBe(original);
    });

    it(`${c.client}: command and workspace are absolute and include --profile`, () => {
      installMcpClient(r0({ profile: 'starter' }), env);
      const data = JSON.parse(readFileSync(c.path(), 'utf-8')) as Record<string, Record<string, { command: string; args: string[] }>>;
      const entry = (data['mcpServers'] ?? data['servers'])?.['swao'];
      expect(isAbsolute(entry?.command ?? '')).toBe(true);
      expect(entry?.args).toEqual(['mcp', '--workspace', resolve(ws), '--profile', 'starter']);
      expect(isAbsolute(entry?.args[2] ?? '')).toBe(true);
    });
  }

  it('cursor project scope writes .cursor/mcp.json in the project folder; http writes a url entry', () => {
    installMcpClient(req({ client: 'cursor', scope: 'project', transport: 'http', agent: false }), env);
    const entry = (JSON.parse(readFileSync(join(project, '.cursor', 'mcp.json'), 'utf-8')) as { mcpServers: { swao: unknown } }).mcpServers.swao;
    expect(entry).toEqual({ url: 'http://localhost:3737/mcp' });
  });

  it('vscode http entry is type http; user scope is not yet supported (exit 2, nothing written)', () => {
    installMcpClient(req({ client: 'vscode', scope: 'project', transport: 'http', agent: false }), env);
    const entry = (JSON.parse(readFileSync(join(project, '.vscode', 'mcp.json'), 'utf-8')) as { servers: { swao: unknown } }).servers.swao;
    expect(entry).toEqual({ type: 'http', url: 'http://localhost:3737/mcp' });
    const r = installMcpClient(req({ client: 'vscode', scope: 'user', agent: false }), env);
    expect(r.exitCode).toBe(2);
    expect(r.err.join('\n')).toContain('not yet supported');
  });
});
