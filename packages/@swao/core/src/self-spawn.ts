// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #4241: the single place that knows how SWAO starts itself as a child process.
//
// There are two ways for a pkg binary to start itself:
//
//   A. `<exe> <snapshot entry> ...args` with PKG_EXECPATH inherited: the child
//      sees PKG_EXECPATH equal to itself and runs argv[1] as the script.
//   B. `<exe> ...args` with PKG_EXECPATH set to '': the empty value stops the
//      pkg spawn patch from injecting the parent path, so the child starts its
//      bundled entry and reads args as CLI arguments.
//
// Mixing them (script path plus PKG_EXECPATH '') makes the child read the
// snapshot path as its command ("unknown command <snapshot>/bundle.cjs",
// #4241); omitting both (no script path, PKG_EXECPATH inherited) makes the
// child load the first CLI argument as a module (#4260, #3319). Under
// `node dist/index.js` both variants work, so only the binary shows the bug.
//
// SWAO uses variant B everywhere: under pkg the command is the binary and the
// arguments are the CLI arguments; under node the command is node and the
// entry script comes first. PKG_EXECPATH is always '' (harmless under node).
// The audit gate tests/audit-gates/self-spawn-central.gate.mjs fails on any
// `spawn(process.execPath` or `process.argv[1]` outside this file.

/** Runtime facts the helper reads; injectable for tests. */
export interface SelfSpawnRuntime {
  /** True inside a pkg binary; defaults to isPkgBinary(). */
  isPkg?: boolean;
  /** The running executable; defaults to process.execPath. */
  execPath?: string;
  /** The entry script under node; defaults to process.argv[1]. */
  scriptPath?: string;
}

export interface SelfSpawnOptions extends SelfSpawnRuntime {
  /** Base environment of the child; defaults to process.env. PKG_EXECPATH is always overridden. */
  env?: NodeJS.ProcessEnv;
}

/** Command, arguments and environment for starting SWAO as a child process. */
export interface SelfSpawnCommand {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** True when SWAO runs as a pkg binary (process.pkg is set by the pkg bootstrap). */
export function isPkgBinary(proc: object = process): boolean {
  return Boolean((proc as { pkg?: unknown }).pkg);
}

/** The entry script of a source run (`node dist/index.js`); undefined when there is none. */
export function selfEntryScript(): string | undefined {
  return process.argv[1];
}

/**
 * Environment for a child that may be a pkg binary: the base environment with
 * PKG_EXECPATH set to '' so the child starts its bundled entry with the given
 * arguments. Also used for spawning another SWAO binary (MCP version probe)
 * and for external tools started from the binary (tool-runner).
 */
export function selfSpawnEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, PKG_EXECPATH: '' };
}

/** The arguments for a self spawn: the CLI arguments under pkg, the entry script plus the CLI arguments under node. */
export function selfSpawnArgs(args: ReadonlyArray<string>, runtime: SelfSpawnRuntime = {}): string[] {
  const isPkg = runtime.isPkg ?? isPkgBinary();
  if (isPkg) return [...args];
  const script = runtime.scriptPath ?? selfEntryScript();
  return script ? [script, ...args] : [...args];
}

/**
 * The command, arguments and environment that start SWAO itself with `args`
 * (variant B, see the file header). Use as
 * `const self = selfSpawnCommand(args, { env }); spawn(self.command, self.args, { ...opts, env: self.env })`.
 */
export function selfSpawnCommand(args: ReadonlyArray<string>, opts: SelfSpawnOptions = {}): SelfSpawnCommand {
  return {
    command: opts.execPath ?? process.execPath,
    args: selfSpawnArgs(args, opts),
    env: selfSpawnEnv(opts.env ?? process.env),
  };
}
