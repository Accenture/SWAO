// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Portfolio delta / trend tracking (Design 103 §21.2, #3114).
 *
 * After each `swao service research`: diff the new portfolio summary against the
 * latest snapshot, write `wsp/reports/portfolio-delta-YYYYMMDD.md`, store the
 * summary as `wsp/snapshots/portfolio-summary-YYYYMMDD-HHmmss.json`, and keep
 * the 4 newest snapshots. Snapshots are read leniently: a field missing on
 * either side (older snapshots predate some fields) is "no change".
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PortfolioSummary } from '@swao/core';

export const DELTA_CATEGORIES = [
  'DELTA.APP_ADDED', 'DELTA.APP_REMOVED', 'DELTA.OS_IMPROVED', 'DELTA.OS_DEGRADED', 'DELTA.EOL_CHANGED',
  'DELTA.TIME_CHANGED', 'DELTA.MIGRATION_CHANGED', 'DELTA.CVE_COUNT_CHANGED', 'DELTA.RISK_SCORE_CHANGED',
] as const;
export type DeltaCategory = (typeof DELTA_CATEGORIES)[number];

export interface DeltaItem { category: DeltaCategory; app: string; name: string | null; previous: string; current: string }
export const MAX_SNAPSHOTS = 4;
export const RISK_DELTA_THRESHOLD = 10;

type LooseApp = Record<string, unknown> & { id: string };
const EOL_RANK: Record<string, number> = { GREEN: 0, AMBER: 1, BLOCKED: 2 };

const has = (a: LooseApp, k: string) => a[k] !== undefined && a[k] !== null;
const str = (v: unknown) => (v === null || v === undefined ? '-' : String(v));
const highPlus = (a: LooseApp) => (typeof a['cve_critical_count'] === 'number' ? (a['cve_critical_count'] as number) : 0) + (typeof a['cve_high_count'] === 'number' ? (a['cve_high_count'] as number) : 0);

export function computeDelta(previous: { apps?: unknown[] }, current: { apps?: unknown[] }): DeltaItem[] {
  const prev = new Map(((previous.apps ?? []) as LooseApp[]).filter((a) => a && typeof a.id === 'string').map((a) => [a.id, a]));
  const cur = new Map(((current.apps ?? []) as LooseApp[]).filter((a) => a && typeof a.id === 'string').map((a) => [a.id, a]));
  const out: DeltaItem[] = [];
  const push = (category: DeltaCategory, a: LooseApp, previousV: unknown, currentV: unknown) =>
    out.push({ category, app: a.id, name: (a['name'] as string | null) ?? null, previous: str(previousV), current: str(currentV) });

  for (const [id, c] of cur) {
    const p = prev.get(id);
    if (!p) { push('DELTA.APP_ADDED', c, null, c['time_quadrant']); continue; }
    if (has(p, 'os') && has(c, 'os') && p['os'] !== c['os']) {
      const better = has(p, 'eol_signal') && has(c, 'eol_signal') ? (EOL_RANK[c['eol_signal'] as string] ?? 0) <= (EOL_RANK[p['eol_signal'] as string] ?? 0) : true;
      push(better ? 'DELTA.OS_IMPROVED' : 'DELTA.OS_DEGRADED', c, p['os'], c['os']);
    }
    if (has(p, 'eol_signal') && has(c, 'eol_signal') && p['eol_signal'] !== c['eol_signal']) push('DELTA.EOL_CHANGED', c, p['eol_signal'], c['eol_signal']);
    if (has(p, 'time_quadrant') && has(c, 'time_quadrant') && p['time_quadrant'] !== c['time_quadrant']) push('DELTA.TIME_CHANGED', c, p['time_quadrant'], c['time_quadrant']);
    if (has(p, 'migration_candidate') && has(c, 'migration_candidate') && p['migration_candidate'] !== c['migration_candidate']) push('DELTA.MIGRATION_CHANGED', c, p['migration_candidate'], c['migration_candidate']);
    if (has(p, 'cve_critical_count') && has(c, 'cve_critical_count') && highPlus(p) !== highPlus(c)) push('DELTA.CVE_COUNT_CHANGED', c, highPlus(p), highPlus(c));
    if (typeof p['risk_score'] === 'number' && typeof c['risk_score'] === 'number' && Math.abs((c['risk_score'] as number) - (p['risk_score'] as number)) > RISK_DELTA_THRESHOLD) {
      push('DELTA.RISK_SCORE_CHANGED', c, p['risk_score'], c['risk_score']);
    }
  }
  for (const [id, p] of prev) if (!cur.has(id)) push('DELTA.APP_REMOVED', p, p['time_quadrant'], null);
  return out;
}

/** ISO time encoded in a snapshot file name (`portfolio-summary-YYYYMMDD-HHmmss.json`). */
function snapshotTime(name: string | null): string | null {
  const m = name ? /(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(name) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

const stamp = (d: Date) => d.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
const day = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

export function listSnapshots(workspacePath: string): string[] {
  const dir = join(workspacePath, 'wsp', 'snapshots');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => /^portfolio-summary-\d{8}-\d{6}\.json$/.test(n)).sort();
}

export function renderDeltaReport(items: readonly DeltaItem[], meta: { previous: string | null; previousAt: string | null; now: Date; prevCount: number; curCount: number }): string {
  if (!meta.previous) {
    return `# Portfolio Delta Report\n\nGenerated: ${meta.now.toISOString().slice(0, 10)}\n\nNo prior snapshot - baseline established (${meta.curCount} apps).\n`;
  }
  const days = meta.previousAt ? Math.round((meta.now.getTime() - Date.parse(meta.previousAt)) / 86_400_000) : null;
  const lines = [
    '# Portfolio Delta Report',
    `Period: ${meta.previousAt?.slice(0, 10) ?? '-'} -> ${meta.now.toISOString().slice(0, 10)}${days !== null ? ` (${days} days)` : ''}`,
    `Previous snapshot: wsp/snapshots/${meta.previous}`,
    `Apps compared: ${meta.prevCount} (previous) vs ${meta.curCount} (current)`, '', '## Summary',
  ];
  const counts = DELTA_CATEGORIES.map((c) => [c, items.filter((i) => i.category === c).length] as const).filter(([, n]) => n > 0);
  lines.push(...(counts.length > 0 ? counts.map(([c, n]) => `- ${c}: ${n}`) : ['- No changes']), '');
  for (const [c] of counts) {
    lines.push(`## ${c}`, '', '| App | Name | Previous | Current |', '|---|---|---|---|');
    for (const i of items.filter((x) => x.category === c)) lines.push(`| ${i.app} | ${i.name ?? '-'} | ${i.previous} | ${i.current} |`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/** Diff, report, snapshot, prune. Returns the delta items and the report path. */
export function recordPortfolioDelta(workspacePath: string, summary: PortfolioSummary, now: Date = new Date()): { items: DeltaItem[]; reportPath: string; baseline: boolean } {
  const snapDir = join(workspacePath, 'wsp', 'snapshots');
  const reportsDir = join(workspacePath, 'wsp', 'reports');
  const latest = listSnapshots(workspacePath).at(-1) ?? null;
  let previous: { apps?: unknown[]; generated_at?: string } | null = null;
  if (latest) {
    try { previous = JSON.parse(readFileSync(join(snapDir, latest), 'utf-8')) as { apps?: unknown[]; generated_at?: string }; } catch { previous = null; }
  }
  const items = previous ? computeDelta(previous, summary) : [];
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = join(reportsDir, `portfolio-delta-${day(now)}.md`);
  writeFileSync(reportPath, renderDeltaReport(items, {
    previous: previous ? latest : null, previousAt: previous?.generated_at ?? snapshotTime(latest), now,
    prevCount: previous?.apps?.length ?? 0, curCount: summary.apps.length,
  }), 'utf-8');
  mkdirSync(snapDir, { recursive: true });
  writeFileSync(join(snapDir, `portfolio-summary-${stamp(now)}.json`), `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');
  for (const old of listSnapshots(workspacePath).slice(0, -MAX_SNAPSHOTS)) rmSync(join(snapDir, old), { force: true });
  return { items, reportPath, baseline: !previous };
}
