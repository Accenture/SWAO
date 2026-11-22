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


// #4464: the Pass statistics table at the end of `swao assess` and the signal
// count of one pass for its [pass-done] marker. Pure functions (tested).

import { passLabel } from '@swao/core';
import type { PassStat } from '../schema/index.js';

/**
 * Signals a pass emitted in this run, summed over its pass statistics rows
 * (Pass 10 pushes one row for the live crawl or for the parity-baseline
 * vision). The TUI run summary adds these up, so the [pass-done] marker of
 * every pass, Pass 10 included, must carry it.
 */
export function passSignalsEmitted(stats: readonly PassStat[], num: string): number {
  return stats.filter(s => s.num === num).reduce((n, s) => n + s.signals_emitted, 0);
}

function msToHuman(ms: number): string {
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

/**
 * Lines of the Pass statistics table. `Signals` is the signal count of each
 * pass and sums to the Total row (the run manifest total); `Items` is what a
 * pass counted besides signals (#0846: blocks evaluated, malware items, and
 * for Pass 10 the crawled screens), empty when it equals the signal count.
 */
export function formatPassStatsTable(stats: readonly PassStat[], totalMs: number, totalSignals: number): string[] {
  const COL_PASS = 34;
  const COL_NUM = 8;
  const COL_MS = 10;
  const sep = '-'.repeat(COL_PASS + COL_NUM * 2 + COL_MS + 6);
  const lines = ['', 'Pass statistics', sep,
    `${'Pass'.padEnd(COL_PASS)}  ${'Signals'.padStart(COL_NUM)}  ${'Items'.padStart(COL_NUM)}  ${'Wall clock'.padStart(COL_MS)}`, sep];
  for (const s of stats) {
    const items = s.items_emitted !== undefined && s.items_emitted !== s.signals_emitted ? String(s.items_emitted) : '';
    lines.push(`${passLabel(s.num, s.pass).padEnd(COL_PASS)}  ${String(s.signals_emitted).padStart(COL_NUM)}  ${items.padStart(COL_NUM)}  ${msToHuman(s.wall_clock_ms).padStart(COL_MS)}`);
  }
  lines.push(sep, `${'Total'.padEnd(COL_PASS)}  ${String(totalSignals).padStart(COL_NUM)}  ${''.padStart(COL_NUM)}  ${msToHuman(totalMs).padStart(COL_MS)}`, '');
  lines.push('Items: what a pass counted besides signals (blocks evaluated, malware items, Pass 10 crawled screens).');
  lines.push('');
  return lines;
}
