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

// #4387: lazy command registration. Every top-level command belongs to a
// CommandGroup whose register() reaches the command module through a
// string-literal dynamic import, so a process only loads the module graph of
// the command it runs. `swao --version` and `swao --help` load no command
// module at all: the root help lists the commands from the generated manifest
// (tiers/root-help-manifest.ts), which the drift test pins byte for byte
// against the full registration. Anything the router cannot place (no
// arguments, an unknown command, the TUI commands) takes the full path, which
// registers every group in the historical order exactly as before.
//
// String-literal specifiers only: esbuild bundles a literal import() behind a
// lazy init wrapper (format cjs), a computed specifier would stay a runtime
// require and break the pkg binary.

import type { Command } from 'commander';

/** One top-level command (plus its aliases) and the registrar that adds it. */
export interface CommandGroup {
  /** The command name first, then its aliases (`health-check`, `doctor`). */
  readonly names: readonly string[];
  /** Registers the command; imports its module on demand. */
  register(program: Command): Promise<void>;
}

/** Per-tier wiring: groups appended after the shared ones, and hooks that adjust a shared command. */
export interface TierCommands {
  readonly tier: 'community' | 'consultant' | 'enterprise';
  /** Groups registered after the shared Community groups, in this order. */
  readonly extraGroups: readonly CommandGroup[];
  /** Runs after the named shared group registered (e.g. `lz` gains `catalogue update`). */
  readonly after?: Readonly<Record<string, (program: Command) => Promise<void> | void>>;
  /** Runs only on the full path, before the groups register (premium TUI screens, #2132). */
  readonly onFull?: () => Promise<void>;
}

/** A root help line: the command term and its description, as Commander renders them. */
export interface RootHelpEntry {
  readonly name: string;
  readonly term: string;
  readonly description: string;
}

/**
 * How a process registers its commands.
 * - `root`: `--version` / `--help` / `help` without a command; manifest placeholders only.
 * - `group`: the invoked command's group only.
 * - `full`: every group (no arguments, unknown command, TUI commands, SWAO_EAGER_COMMANDS=1).
 */
export type CommandMode =
  | { readonly kind: 'root' }
  | { readonly kind: 'group'; readonly group: CommandGroup }
  | { readonly kind: 'full' };

/** Commands that open the TUI, which reads the premium screens and every registration: always full. */
const FULL_PATH_COMMANDS: ReadonlySet<string> = new Set(['menu', 'setup', 'chat']);

const ROOT_FLAGS: ReadonlySet<string> = new Set(['-h', '--help', '-V', '--version']);

/** Chooses the registration path from argv (node, script, args...). */
export function selectCommandMode(
  argv: readonly string[],
  groups: readonly CommandGroup[],
  env: NodeJS.ProcessEnv = process.env,
): CommandMode {
  if (env['SWAO_EAGER_COMMANDS'] === '1') return { kind: 'full' };
  const args = argv.slice(2);
  if (args.length === 0) return { kind: 'full' };
  const first = args.findIndex((a) => !a.startsWith('-'));
  // Flags before the first operand belong to the root program: `--help` / `--version`
  // there are answered by the root (`swao --help assess` prints the root help).
  const leading = first === -1 ? args : args.slice(0, first);
  if (leading.length > 0) {
    return leading.every((a) => ROOT_FLAGS.has(a)) ? { kind: 'root' } : { kind: 'full' };
  }
  const operands = args.filter((a) => !a.startsWith('-'));
  let target = operands[0];
  if (target === 'help') {
    target = operands[1];
    if (target === undefined) return { kind: 'root' };
  }
  if (target === undefined) return { kind: 'full' };
  if (FULL_PATH_COMMANDS.has(target)) return { kind: 'full' };
  const group = groups.find((g) => g.names.includes(target));
  return group ? { kind: 'group', group } : { kind: 'full' };
}

/** The root help lines of a fully registered program (the manifest generator and the drift test use this). */
export function rootHelpEntries(program: Command): RootHelpEntry[] {
  const helper = program.createHelp();
  return helper
    .visibleCommands(program)
    .filter((c) => c.name() !== 'help')
    .map((c) => ({ name: c.name(), term: helper.subcommandTerm(c), description: helper.subcommandDescription(c) }));
}

/**
 * Root help mode: one action-less placeholder per manifest entry, rendered with
 * the recorded term so the help output is identical to the full registration.
 * The help override is set only on this path, so no real subcommand inherits it.
 */
export function registerRootHelpPlaceholders(program: Command, entries: readonly RootHelpEntry[]): void {
  const terms = new Map<string, string>();
  for (const e of entries) {
    program.command(e.name).description(e.description);
    terms.set(e.name, e.term);
  }
  program.configureHelp({
    subcommandTerm: (cmd) => terms.get(cmd.name()) ?? `${cmd.name()}${cmd.registeredArguments.length ? ' [command]' : ''}`,
  });
}

/** Registers the groups for the chosen mode. */
export async function registerCommandGroups(
  program: Command,
  mode: CommandMode,
  groups: readonly CommandGroup[],
  tier: TierCommands,
  rootHelp: readonly RootHelpEntry[],
): Promise<void> {
  if (mode.kind === 'root') {
    registerRootHelpPlaceholders(program, rootHelp);
    return;
  }
  const run = async (g: CommandGroup): Promise<void> => {
    await g.register(program);
    const hook = tier.after?.[g.names[0] ?? ''];
    if (hook) await hook(program);
  };
  if (mode.kind === 'group') {
    await run(mode.group);
    return;
  }
  if (tier.onFull) await tier.onFull();
  for (const g of groups) await run(g);
}
