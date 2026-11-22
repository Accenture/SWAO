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

// #4223 (owner redesign 2026-11-10, Design 126 sections 6, 7 and 10): the
// rows of a branch Ready step. One compact line per item (state, label, short
// value), the tool items of one group in one row, one Health check row with
// the failed and warned probe names on its line, and the full explanation of
// each row in its guidance entry (the box follows the highlighted row). The
// CLI summary (formatBranchCheck) keeps the full detail of every item.

import { SETUP_BRANCH_STATE_LABELS, type SetupBranchState } from '@swao/core';
import { ROW_INDENT, STATUS_COLUMN_WIDTH, STATUS_MAP, type GuidanceEntry, type StatusLevel } from '@swao/tui-kit';
import { formatReadyHealthLine } from '../tui/screens/wizard/steps/ReadyStep.js';
import { healthIncompleteText } from '../tui/screens/wizard/steps/health-check-run.js';
import type { SetupCheckItem, SetupHealthResult } from './types.js';

export interface ReadyRow {
  level: StatusLevel;
  label: string;
  /** The short value on the row line. */
  value: string;
  /** The guidance of the row when it is highlighted. */
  guidance: GuidanceEntry;
}

/** #4294 / #4223: the branch state as a status level (Design 126 section 6; no new colour token). */
export const BRANCH_STATE_LEVEL: Readonly<Record<SetupBranchState, StatusLevel>> = {
  ready: 'ok',
  'needs-attention': 'warn',
  'not-set-up': 'waiting',
};

/** The branch state word ("ready", "needs attention", "not set up") and its level. */
export function branchStateWord(state: SetupBranchState): { text: string; level: StatusLevel } {
  return { text: SETUP_BRANCH_STATE_LABELS[state], level: BRANCH_STATE_LEVEL[state] };
}

/** The health line's status level (Design 126 section 6). */
export function readyHealthLevel(health: SetupHealthResult | undefined): StatusLevel {
  // #4410: a health check the watchdog stopped is a failed check, also before its first probe.
  if (healthIncompleteText(health)) return 'fail';
  if (!health || health.probeCount === 0) return 'waiting';
  if (health.failCount > 0) return 'fail';
  return health.warnCount > 0 ? 'warn' : 'ok';
}

/** Severity order for the level of a grouped row (the worst member wins). */
const SEVERITY: readonly StatusLevel[] = ['ok', 'cancelled', 'info', 'waiting', 'warn', 'missing', 'fail'];

function worst(levels: readonly StatusLevel[]): StatusLevel {
  return levels.reduce<StatusLevel>((a, l) => (SEVERITY.indexOf(l) > SEVERITY.indexOf(a) ? l : a), 'ok');
}

const stateSection = (level: StatusLevel): { label: string; text: string } => ({ label: 'State', text: `${level}, ${STATUS_MAP[level].meaning}` });

/** The Health check row: counts and the failed and warned probe names on one line. */
export function healthRow(health: SetupHealthResult | undefined): ReadyRow {
  const level = readyHealthLevel(health);
  const incomplete = healthIncompleteText(health);
  const names = health ? [...health.failedProbes.filter((n) => n !== incomplete), ...health.warnedProbes] : [];
  const value = `${formatReadyHealthLine(health)}${names.length > 0 ? `: ${names.join(', ')}` : ''}`;
  const sections = [
    ...(health && health.failedProbes.length > 0 ? [{ label: 'Failed', text: health.failedProbes.join(', ') }] : []),
    ...(health && health.warnedProbes.length > 0 ? [{ label: 'Warnings', text: health.warnedProbes.join(', ') }] : []),
    { label: 'Details', text: 'Health Check in the main menu lists every probe with its result and the fix.' },
  ];
  return {
    level,
    label: 'Health check',
    value,
    guidance: {
      title: 'Health check',
      what: health && health.probeCount > 0
        ? `The health check of this assessment type ran ${value}. A failure keeps the assessment from running; a warning is listed and the assessment still runs.`
        : 'The health check of this assessment type has no result yet.',
      sections,
    },
  };
}

/** Members of one group, in one row: "gitleaks, clamav not found; yara found" (non-ok members first). */
function groupValue(members: readonly SetupCheckItem[]): string {
  const byValue = new Map<string, { names: string[]; ok: boolean }>();
  for (const m of members) {
    const v = m.short ?? m.detail ?? m.state;
    const e = byValue.get(v) ?? { names: [], ok: true };
    e.names.push(m.label);
    if (m.state !== 'ok') e.ok = false;
    byValue.set(v, e);
  }
  return [...byValue.entries()]
    .sort((a, b) => Number(a[1].ok) - Number(b[1].ok))
    .map(([v, e]) => `${e.names.join(', ')} ${v}`)
    .join('; ');
}

/**
 * The Ready rows of a branch: the Health check row first, then one row per
 * item, the items of one group merged into one row at the place of the first
 * member. An item labelled "Health check" (a branch readySummary repeating
 * the health result) is dropped: the Health check row already shows it.
 */
export function readyRows(items: readonly SetupCheckItem[], health: SetupHealthResult | undefined): ReadyRow[] {
  const rows: ReadyRow[] = [healthRow(health)];
  const seen = new Set<string>();
  for (const it of items) {
    if (it.label === 'Health check') continue;
    if (it.group) {
      if (seen.has(it.group.label)) continue;
      seen.add(it.group.label);
      const members = items.filter((m) => m.group?.label === it.group!.label);
      const level = worst(members.map((m) => m.state));
      rows.push({
        level,
        label: it.group.label,
        value: groupValue(members),
        guidance: {
          title: it.group.label,
          what: it.group.what,
          sections: members.map((m) => ({ label: m.label, text: `${m.state}, ${m.detail ?? m.short ?? ''}` })),
        },
      });
      continue;
    }
    const value = it.short ?? it.detail ?? '';
    rows.push({
      level: it.state,
      label: it.label,
      value,
      guidance: {
        title: it.label,
        what: it.detail ?? it.short ?? it.label,
        sections: [stateSection(it.state)],
      },
    });
  }
  return rows;
}

/** Columns of the row indent plus the status column (StatusRow). */
const ROW_LEAD = ROW_INDENT + STATUS_COLUMN_WIDTH;

/**
 * #4223: the label column of the Ready rows: the longest label plus two,
 * capped at 40 percent of the room after the status column. A label longer
 * than the cap takes line 1 on its own (its value goes on line 2 under the
 * label), so no label is ever broken inside a word.
 */
export function readyLabelWidth(rows: readonly Pick<ReadyRow, 'label'>[], width: number): { labelWidth: number; cap: number } {
  const cap = Math.max(12, Math.floor((width - ROW_LEAD) * 0.4));
  const fitting = rows.map((r) => r.label.length).filter((n) => n + 2 <= cap);
  return { labelWidth: Math.min(cap, Math.max(12, ...fitting.map((n) => n + 2))), cap };
}

/** The StatusRow props of one Ready row at `width`. */
export function readyRowProps(row: ReadyRow, labelWidth: number, width: number): { level: StatusLevel; label: string; summary?: string; detail?: string; labelWidth: number } {
  if (row.label.length + 2 <= labelWidth) return { level: row.level, label: row.label, summary: row.value || undefined, labelWidth };
  // A long label: the whole line after the status column, the value under it.
  return { level: row.level, label: row.label, detail: row.value || undefined, labelWidth: Math.max(labelWidth, width - ROW_LEAD) };
}
