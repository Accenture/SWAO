// #3885 (Design 123 section 9.4, CLI/TUI parity): every action of the Landing
// Zone Live Assessment done menu that runs `swao lz <sub>` names a subcommand
// the CLI registers, and the read-only `lz` views (diff, hierarchy) have a TUI
// action. Uses the real command registration and the real done-menu table.
import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { registerLz } from '@swao/module-landing-zone';
import { LIVE_DONE_ACTIONS, doneActionArgs } from '@swao/module-app-assessment';

describe('LZ live done menu vs swao lz subcommands (#3885)', () => {
  const program = new Command('swao');
  registerLz(program);
  const lz = program.commands.find((c) => c.name() === 'lz')!;
  const subs = new Set(lz.commands.map((c) => c.name()));

  it('the CLI registers swao lz hierarchy with --run', () => {
    expect(subs.has('hierarchy')).toBe(true);
    const h = lz.commands.find((c) => c.name() === 'hierarchy')!;
    expect(h.options.map((o) => o.long)).toContain('--run');
  });

  it('every lz action of the done menu names a registered subcommand', () => {
    for (const a of LIVE_DONE_ACTIONS) {
      const r = doneActionArgs(a.id, 'otc-test', 'otc');
      if (!r || !('args' in r) || r.args[0] !== 'lz') continue;
      expect(subs.has(r.args[1]!), `${a.id} -> lz ${r.args[1]}`).toBe(true);
    }
  });

  it('the read-only live views diff and hierarchy both have a TUI action', () => {
    const viaTui = new Set(LIVE_DONE_ACTIONS.flatMap((a) => { const r = doneActionArgs(a.id, 'otc-test', 'otc'); return r && 'args' in r && r.args[0] === 'lz' ? [r.args[1]] : []; }));
    for (const view of ['diff', 'hierarchy']) expect(viaTui.has(view)).toBe(true);
  });
});
