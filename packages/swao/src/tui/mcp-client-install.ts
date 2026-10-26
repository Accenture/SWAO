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
 * #3478: per-client targets of `swao mcp install --client` (Design 116 REQ-13
 * table), all written through the safe writer (mcp-safe-writer.ts). Injected
 * into @swao/module-mcp as McpInstallDeps.installClient; the Setup Wizard
 * calls the same function (#3479, TUI/CLI parity).
 *
 * Every path is derived from injected roots (home, XDG config, project folder,
 * Claude Desktop candidates), so tests run against temp folders only and never
 * resolve the operator's real client configs. No secret or token is ever
 * written: entries carry the binary, its arguments, the workspace, the profile
 * or a localhost URL.
 */

import { homedir, tmpdir } from 'os';
import { delimiter, isAbsolute, join, resolve } from 'path';
import { closeSync, existsSync, openSync, readFileSync, rmSync, statSync } from 'fs';
import { spawnSync } from 'child_process';
import {
  findSwaoServerKey,
  resolveClaudeDesktopConfigs,
  selectClaudeDesktopPatchTargets,
  type ClaudeDesktopConfigCandidate,
} from '@swao/core';
import {
  clientDisplayName,
  isSwaoGeneratedAgent,
  renderAgentTemplate,
  type AgentClient,
  type McpClientInstallRequest,
  type McpClientInstallResult,
} from '@swao/module-mcp';
import {
  applyFilePlan,
  deepEqual,
  findSwaoKeyCaseInsensitive,
  readJsonServers,
  planJsonEntryRemove,
  planJsonEntryUpsert,
  planTextFile,
  type ApplyOutcome,
  type FilePlan,
  type JsonEntryTarget,
  type WriterFs,
} from './mcp-safe-writer.js';

/** Roots and side-effect hooks of the installer; every field is injectable for tests. */
export interface McpClientInstallEnv {
  /** User home (default os.homedir()). */
  homeDir?: string;
  /** Environment for XDG_CONFIG_HOME (default process.env). */
  env?: NodeJS.ProcessEnv;
  /** Claude Desktop configs (default resolveClaudeDesktopConfigs()). */
  claudeDesktopCandidates?: () => ReadonlyArray<ClaudeDesktopConfigCandidate>;
  /** Writer file system (tests can fail a rename). */
  fs?: WriterFs;
  /** Clock for backup names. */
  now?: () => Date;
  /**
   * #3479: finds an executable on PATH (default: PATH and PATHEXT scan). Tests
   * always inject this, so the real `claude` CLI is never found or run.
   */
  findExecutable?: (name: string) => string | undefined;
  /** #3479: runs a command (default: spawnSync, shell only for .cmd/.bat shims). */
  runCommand?: (command: string, args: ReadonlyArray<string>) => CommandResult;
}

/** Outcome of one external command. */
export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** #3479: PATH lookup with PATHEXT on Windows (claude is usually an npm .cmd shim there). */
export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  const dirs = (env['PATH'] ?? env['Path'] ?? '').split(delimiter).filter((d) => d !== '');
  const exts = platform === 'win32' ? (env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((x) => x !== '') : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = join(dir, name + ext);
      try {
        if (existsSync(p) && statSync(p).isFile()) return p;
      } catch { /* unreadable entry */ }
    }
  }
  return undefined;
}

/** Characters cmd.exe would interpret; an argument holding one is refused for a .cmd shim. */
const CMD_META_RE = /["%!^&|<>()\r\n]/;

/**
 * #3479: default command runner. A Windows .cmd / .bat shim needs a shell
 * (Node refuses to spawn it directly); its arguments are quoted and any
 * argument with a cmd.exe metacharacter is refused rather than escaped.
 */
export function runCommandSync(command: string, args: ReadonlyArray<string>): CommandResult {
  const shim = /\.(cmd|bat)$/i.test(command);
  if (shim) {
    const bad = [command, ...args].find((a) => CMD_META_RE.test(a));
    if (bad !== undefined) return { status: 1, stdout: '', stderr: `refused to pass "${bad}" through cmd.exe` };
  }
  const q = (a: string): string => (shim && /\s/.test(a) ? `"${a}"` : a);
  // File-backed stdout/stderr, then a tree kill by PID: on Windows a .cmd shim
  // runs cmd.exe with node as a grandchild, and spawnSync with piped stdio can
  // hang past its timeout there (same pattern as binary-e2e.test.ts runBinary).
  const base = join(tmpdir(), `swao-mcp-install-${process.pid}-${Date.now()}`);
  const outPath = `${base}-out.txt`;
  const errPath = `${base}-err.txt`;
  const outFd = openSync(outPath, 'w');
  const errFd = openSync(errPath, 'w');
  let r: ReturnType<typeof spawnSync> | undefined;
  try {
    r = spawnSync(shim ? q(command) : command, args.map(q), {
      shell: shim,
      stdio: ['ignore', outFd, errFd],
      timeout: 60_000,
      windowsHide: true,
    });
  } finally {
    try { closeSync(outFd); } catch { /* ignore */ }
    try { closeSync(errFd); } catch { /* ignore */ }
  }
  // Only after a timeout or spawn error: a cleanly exited shim leaves no tree behind.
  if (r?.pid && r.error) treeKillSync(r.pid);
  const read = (p: string): string => { try { return readFileSync(p, 'utf-8'); } catch { return ''; } };
  const stdout = read(outPath);
  const stderr = read(errPath);
  for (const p of [outPath, errPath]) { try { rmSync(p, { force: true }); } catch { /* ignore */ } }
  return { status: r?.status ?? null, stdout, stderr: r?.error ? r.error.message : stderr };
}

/** Kills a finished or timed-out command's process tree by PID (never by image name). */
function treeKillSync(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

interface Resolved {
  home: string;
  xdgConfig: string;
}

function roots(e: McpClientInstallEnv): Resolved {
  const env = e.env ?? process.env;
  const home = e.homeDir ?? homedir();
  const xdg = env['XDG_CONFIG_HOME'];
  return { home, xdgConfig: xdg && isAbsolute(xdg) ? xdg : join(home, '.config') };
}

/** Kilo config file (Design 116 REQ-13 table): user `~/.config/kilo/kilo.json`, project `./kilo.json` or `.kilo/kilo.json`. */
export function kiloConfigPath(req: Pick<McpClientInstallRequest, 'scope' | 'projectDir'>, r: Resolved): string {
  if (req.scope === 'user') return join(r.xdgConfig, 'kilo', 'kilo.json');
  const top = join(req.projectDir, 'kilo.json');
  const nested = join(req.projectDir, '.kilo', 'kilo.json');
  return !existsSync(top) && existsSync(nested) ? nested : top;
}

/** The stdio command line for clients that take a workspace and profile: absolute binary, its args, then the flags. */
export function stdioCommandLine(req: McpClientInstallRequest): string[] {
  if (!req.binary) throw new Error('binary is required for an install');
  if (!req.workspace) throw new Error('workspace is required for a stdio install');
  return [resolve(req.binary.path), ...req.binary.args, '--workspace', resolve(req.workspace), '--profile', req.profile];
}

/** Kilo entry: `{"type": "local", "command": [...], "enabled": true}` or `{"type": "remote", "url": ..., "enabled": true}`. */
export function kiloEntry(req: McpClientInstallRequest): Record<string, unknown> {
  return req.transport === 'http'
    ? { type: 'remote', url: req.url, enabled: true }
    : { type: 'local', command: stdioCommandLine(req), enabled: true };
}

/** Claude Desktop entry: the binary and its args, plus --profile only when given (REQ-13 table). */
export function claudeDesktopEntry(req: McpClientInstallRequest): Record<string, unknown> {
  if (!req.binary) throw new Error('binary is required for an install');
  return { command: resolve(req.binary.path), args: [...req.binary.args, ...(req.profileExplicit ? ['--profile', req.profile] : [])] };
}

/** Claude Desktop: a case-insensitive `swao` key first, else the #1285 binary-pattern scan. */
function findClaudeDesktopKey(servers: Record<string, unknown>): string | undefined {
  return findSwaoKeyCaseInsensitive(servers) ?? findSwaoServerKey(servers) ?? undefined;
}

/** #3479: Claude Code `.mcp.json` / CLI entry: `{"type": "http", "url"}` or `{"type": "stdio", "command", "args"}`. */
export function claudeCodeEntry(req: McpClientInstallRequest): Record<string, unknown> {
  if (req.transport === 'http') return { type: 'http', url: req.url };
  const [command, ...args] = stdioCommandLine(req);
  return { type: 'stdio', command, args };
}

/** Project `.mcp.json` of Claude Code. */
export function claudeCodeProjectConfig(projectDir: string): string {
  return join(projectDir, '.mcp.json');
}

/** User config of Claude Code; read for detection only, never written by SWAO (the claude CLI owns it). */
export function claudeCodeUserConfig(home: string): string {
  return join(home, '.claude.json');
}

/** #3479: arguments of `claude mcp add` for the entry (Design 116 REQ-13 table). */
export function claudeMcpAddArgs(req: McpClientInstallRequest, key: string): string[] {
  const head = ['mcp', 'add', '--transport', req.transport, '--scope', req.scope, key];
  return req.transport === 'http' ? [...head, req.url] : [...head, '--', ...stdioCommandLine(req)];
}

/** One step: a file plan (MCP config or agent file) or external commands (claude CLI). */
type Step =
  | { kind: 'file'; plan: FilePlan; label: string }
  | { kind: 'commands'; label: string; command: string; runs: string[][] };

interface EntryPlan {
  steps: Step[];
  /** Server key in effect (agent tool names use it). */
  key: string;
  notes: string[];
}

function refusal(msg: string): McpClientInstallResult {
  return { exitCode: 2, out: [], err: [`[error] swao mcp install: ${msg}`] };
}

function describe(o: ApplyOutcome, label: string): string[] {
  switch (o.status) {
    case 'unchanged': return [`  ${label} ${o.path}: no change`];
    case 'dry-run': return [`  ${label} ${o.path}: would change`, ...o.diff.split('\n').map((l) => `    ${l}`)];
    case 'written': return [`  ${label} ${o.path}: written${o.backup ? ` (backup ${o.backup})` : ' (new file)'}`];
    case 'deleted': return [`  ${label} ${o.path}: removed${o.backup ? ` (backup ${o.backup})` : ''}`];
    case 'error': return [`  ${label} ${o.path}: FAILED (${o.message})`];
  }
}

function fileStep(plan: FilePlan, label: string): Step {
  return { kind: 'file', plan, label };
}

function planKey(plan: FilePlan, fallback: string): string {
  return plan.kind === 'change' && plan.key !== undefined ? plan.key : fallback;
}

const CLAUDE_CODE_OWNED = ['type', 'command', 'args', 'url'] as const;

/** #3479: Claude Code. Project scope and the no-CLI fallback write `.mcp.json`; user scope runs the claude CLI. */
function claudeCodeSteps(req: McpClientInstallRequest, r: Resolved, e: McpClientInstallEnv): EntryPlan {
  const projectTarget: JsonEntryTarget = { path: claudeCodeProjectConfig(req.projectDir), container: 'mcpServers', defaultKey: 'swao', ownedFields: CLAUDE_CODE_OWNED };
  const viaFile = (notes: string[]): EntryPlan => {
    const plan = req.uninstall ? planJsonEntryRemove(projectTarget) : planJsonEntryUpsert(projectTarget, claudeCodeEntry(req));
    return { steps: [fileStep(plan, 'Claude Code project config')], key: planKey(plan, 'swao'), notes };
  };
  if (req.scope === 'project') return viaFile([]);
  const claude = (e.findExecutable ?? ((n: string) => findOnPath(n, e.env ?? process.env)))('claude');
  if (claude === undefined) {
    return viaFile([`The claude CLI is not on PATH, so the user configuration cannot be updated; SWAO used the project config in ${req.projectDir} instead.`]);
  }
  // Detection only: the user config belongs to the claude CLI and is never written here.
  const servers = readJsonServers(claudeCodeUserConfig(r.home), 'mcpServers') ?? {};
  const existing = findSwaoKeyCaseInsensitive(servers);
  const key = existing ?? 'swao';
  const remove = ['mcp', 'remove', key, '--scope', req.scope];
  let runs: string[][];
  if (req.uninstall) {
    runs = existing !== undefined ? [remove] : [];
  } else {
    const desired = claudeCodeEntry(req);
    const current = existing !== undefined ? servers[existing] : undefined;
    const currentOwned = current && typeof current === 'object'
      ? Object.fromEntries(Object.entries(current as Record<string, unknown>).filter(([k]) => (CLAUDE_CODE_OWNED as readonly string[]).includes(k)))
      : undefined;
    if (currentOwned !== undefined && deepEqual(currentOwned, desired)) runs = [];
    else runs = existing !== undefined ? [remove, claudeMcpAddArgs(req, key)] : [claudeMcpAddArgs(req, key)];
  }
  return { steps: [{ kind: 'commands', label: 'Claude Code user config (claude CLI)', command: claude, runs }], key, notes: [] };
}

/** Steps for the MCP entry of one client (no agent file). */
function entrySteps(req: McpClientInstallRequest, r: Resolved, e: McpClientInstallEnv): EntryPlan | McpClientInstallResult {
  const upsertOrRemove = (target: JsonEntryTarget, value: () => unknown): FilePlan =>
    req.uninstall ? planJsonEntryRemove(target) : planJsonEntryUpsert(target, value());
  switch (req.client) {
    case 'kilo': {
      const target: JsonEntryTarget = { path: kiloConfigPath(req, r), container: 'mcp', defaultKey: 'swao', ownedFields: ['type', 'command', 'url', 'enabled'] };
      const plan = upsertOrRemove(target, () => kiloEntry(req));
      return { steps: [fileStep(plan, 'Kilo config')], key: planKey(plan, 'swao'), notes: [] };
    }
    case 'claude-code':
      return claudeCodeSteps(req, r, e);
    case 'claude-desktop': {
      if (req.transport === 'http') return refusal('Claude Desktop is configured over stdio; --transport http is not supported for it');
      if (req.scope === 'project') return refusal('Claude Desktop has no project config; use --scope user');
      const candidates = (e.claudeDesktopCandidates ?? resolveClaudeDesktopConfigs)();
      const targets = req.uninstall ? candidates.filter((c) => existsSync(c.path)) : selectClaudeDesktopPatchTargets(candidates);
      if (targets.length === 0) return refusal('no Claude Desktop config found');
      const steps = targets.map((c) => fileStep(
        upsertOrRemove({ path: c.path, container: 'mcpServers', defaultKey: 'swao', findKey: findClaudeDesktopKey, ownedFields: ['command', 'args'] }, () => claudeDesktopEntry(req)),
        'Claude Desktop config',
      ));
      return { steps, key: 'swao', notes: [] };
    }
    case 'cursor': {
      const target: JsonEntryTarget = { path: cursorConfigPath(req.scope, req.projectDir, r), container: 'mcpServers', defaultKey: 'swao', ownedFields: STDIO_HTTP_OWNED };
      const plan = upsertOrRemove(target, () => cursorEntry(req));
      return { steps: [fileStep(plan, 'Cursor config')], key: planKey(plan, 'swao'), notes: [] };
    }
    case 'vscode': {
      // The user-profile mcp.json location is not documented with a path (verified 2026-10-24); project only.
      if (req.scope === 'user') return refusal('--client vscode --scope user is not yet supported (the user-profile mcp.json path is not documented); use --scope project to write .vscode/mcp.json');
      const target: JsonEntryTarget = { path: join(req.projectDir, '.vscode', 'mcp.json'), container: 'servers', defaultKey: 'swao', ownedFields: STDIO_HTTP_OWNED };
      const plan = upsertOrRemove(target, () => vscodeEntry(req));
      return { steps: [fileStep(plan, 'VS Code workspace config')], key: planKey(plan, 'swao'), notes: [] };
    }
  }
}

const STDIO_HTTP_OWNED = ['type', 'command', 'args', 'url'] as const;

/**
 * #3481: Cursor config (verified against https://cursor.com/docs/context/mcp,
 * 2026-10-24): global `~/.cursor/mcp.json`, project `.cursor/mcp.json`, server
 * map `mcpServers`.
 */
export function cursorConfigPath(scope: McpClientInstallRequest['scope'], projectDir: string, r: Resolved): string {
  return scope === 'user' ? join(r.home, '.cursor', 'mcp.json') : join(projectDir, '.cursor', 'mcp.json');
}

/** #3481: Cursor entry: stdio `{"type": "stdio", "command", "args"}`; remote `{"url"}`. */
export function cursorEntry(req: McpClientInstallRequest): Record<string, unknown> {
  if (req.transport === 'http') return { url: req.url };
  const [command, ...args] = stdioCommandLine(req);
  return { type: 'stdio', command, args };
}

/**
 * #3481: VS Code entry (verified against
 * https://code.visualstudio.com/docs/copilot/reference/mcp-configuration,
 * 2026-10-24): server map `servers` in `.vscode/mcp.json`; stdio
 * `{"type": "stdio", "command", "args"}`, http `{"type": "http", "url"}`.
 */
export function vscodeEntry(req: McpClientInstallRequest): Record<string, unknown> {
  if (req.transport === 'http') return { type: 'http', url: req.url };
  const [command, ...args] = stdioCommandLine(req);
  return { type: 'stdio', command, args };
}

/** #3480: agent file path per client and scope (Design 116 REQ-13 table). */
export function agentFilePath(client: AgentClient, scope: McpClientInstallRequest['scope'], projectDir: string, r: Resolved): string {
  switch (client) {
    case 'kilo':
      return scope === 'user' ? join(r.xdgConfig, 'kilo', 'agents', 'swao.md') : join(projectDir, '.kilo', 'agents', 'swao.md');
    case 'claude-code':
      return scope === 'user' ? join(r.home, '.claude', 'agents', 'swao.md') : join(projectDir, '.claude', 'agents', 'swao.md');
  }
}

function agentClient(client: McpClientInstallRequest['client']): AgentClient | undefined {
  return client === 'kilo' || client === 'claude-code' ? client : undefined;
}

/**
 * #3480 (Design 116 REQ-14): the agent file step. Install renders the template
 * with the server key actually written and the profile tools, regenerated on
 * every run; a swao.md without the SWAO marker is never overwritten (refused)
 * and never deleted (left in place on uninstall).
 */
function agentSteps(req: McpClientInstallRequest, key: string, r: Resolved): { steps: Step[]; notes: string[] } | McpClientInstallResult {
  const client = agentClient(req.client);
  if (!req.agent || client === undefined) return { steps: [], notes: [] };
  const path = agentFilePath(client, req.scope, req.projectDir, r);
  if (req.uninstall) {
    if (!existsSync(path)) return { steps: [], notes: [] };
    const plan = planTextFile(path, null, isSwaoGeneratedAgent, 'SWAO agent file');
    if (plan.kind === 'refuse') return { steps: [], notes: [`Left ${path} in place: it was not generated by SWAO.`] };
    return { steps: [fileStep(plan, 'Agent file')], notes: [] };
  }
  let content: string;
  try {
    content = renderAgentTemplate(client, { serverKey: key, profile: req.profile, tools: req.tools, version: req.version });
  } catch (err) {
    return refusal(`${(err as Error).message}; rename the server entry or pass --no-agent`);
  }
  return { steps: [fileStep(planTextFile(path, content, isSwaoGeneratedAgent, 'SWAO agent file'), 'Agent file')], notes: [] };
}

/** Display form of a command line (quoted where needed). */
function shown(command: string, args: ReadonlyArray<string>): string {
  return [command, ...args].map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a)).join(' ');
}

/**
 * #3478: runs `swao mcp install --client` for one request. Plans every file
 * first; when any plan is refused (unparsable file, foreign agent file) nothing
 * is written and the run exits 2. Then applies each step (dry run, no change,
 * backup plus atomic write, or the claude CLI) and prints files, backups, undo
 * and restart hints.
 */
export function installMcpClient(req: McpClientInstallRequest, e: McpClientInstallEnv = {}): McpClientInstallResult {
  const r = roots(e);
  const entry = entrySteps(req, r, e);
  if (!('steps' in entry)) return entry;
  const agent = agentSteps(req, entry.key, r);
  if (!('steps' in agent)) return agent;
  const steps = [...entry.steps, ...agent.steps];
  entry.notes.push(...agent.notes);
  const refused = steps.flatMap((s) => (s.kind === 'file' && s.plan.kind === 'refuse' ? [s.plan.reason] : []));
  if (refused.length > 0) return { exitCode: 2, out: [], err: refused.map((m) => `[error] swao mcp install: ${m}`) };

  const name = clientDisplayName(req.client);
  const out: string[] = [];
  const action = req.uninstall ? 'Removing SWAO from' : 'Configuring SWAO for';
  out.push(`${req.dryRun ? '[dry run] ' : ''}${action} ${name} (scope ${req.scope}${req.uninstall ? '' : `, transport ${req.transport}, profile ${req.profile}`}):`);
  let failed = false;
  let changed = false;
  for (const s of steps) {
    if (s.kind === 'commands') {
      if (s.runs.length === 0) { out.push(`  ${s.label}: no change`); continue; }
      changed = true;
      for (const args of s.runs) {
        if (req.dryRun) { out.push(`  ${s.label}: would run ${shown('claude', args)}`); continue; }
        const res = (e.runCommand ?? runCommandSync)(s.command, args);
        if (res.status === 0) {
          out.push(`  ${s.label}: ran ${shown('claude', args)}`);
        } else {
          failed = true;
          out.push(`  ${s.label}: FAILED ${shown('claude', args)} (exit ${res.status ?? 'none'}${res.stderr.trim() ? `: ${res.stderr.trim()}` : ''})`);
          break;
        }
      }
      continue;
    }
    if (s.plan.kind !== 'change') continue;
    const o = applyFilePlan(s.plan, { dryRun: req.dryRun, ...(e.fs ? { fs: e.fs } : {}), ...(e.now ? { now: e.now() } : {}) });
    if (o.status === 'error') failed = true;
    if (o.status === 'written' || o.status === 'deleted' || o.status === 'dry-run') changed = true;
    out.push(...describe(o, s.label));
  }
  out.push(...entry.notes, ...hints(req, name, changed));
  if (failed) return { exitCode: 1, out: [], err: ['ERROR: Failed to update the MCP client config.', ...out] };
  return { exitCode: 0, out, err: [] };
}

function hints(req: McpClientInstallRequest, name: string, changed: boolean): string[] {
  if (!changed) return [req.uninstall ? 'Nothing to remove.' : 'No change: SWAO is already configured.'];
  if (req.dryRun) return ['Nothing was written (dry run).'];
  const lines: string[] = [];
  if (req.uninstall) {
    lines.push(`Undo: run swao mcp install --client ${req.client} --scope ${req.scope}, or restore a backup file listed above.`);
  } else {
    lines.push(`Undo: swao mcp install --client ${req.client} --scope ${req.scope} --uninstall (or restore a backup file listed above).`);
    if (req.transport === 'http') {
      lines.push(`Start the server before using ${name}: swao mcp --http --profile ${req.profile}${req.workspace ? ` --workspace "${req.workspace}"` : ''}`);
      lines.push(`${name} connects to ${req.url}; it does not start the server.`);
    }
  }
  lines.push(`Restart ${name} (or reload its MCP servers) to apply the change.`);
  return lines;
}

