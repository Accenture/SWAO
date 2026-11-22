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

// Service Portfolio Assessment screen (Design 103 §3.6, #3075, #3083, #3144).
// Sprint 151 (#3164, #3165, #3166, #3169, #3211): one set of questions up front
// (intake, column map, scope), then init, research, assessment of the chosen
// apps, and the Enterprise export run without further prompts. Every stage is
// a CLI child process, so TUI and CLI share one code path; the screen follows
// the Application Assessment look: Header, ProgressBar, capped LiveOutput,
// GuidanceBox, a heartbeat while a pass runs, and Esc to cancel.

import { useState, useEffect, useMemo, useRef } from 'react';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Box, Text, useInput } from 'ink';
import { load as loadYaml } from 'js-yaml';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { findWorkspace, LicenseGuard, openWithDefaultApp } from '@swao/core';
import { selfSpawnCommand } from '@swao/core';
import { completedPassCount, lastPassName } from '@swao/module-app-assessment';
import { cachedLlmResearch, discoverServiceApps, parseTopN, planServiceInit, NO_VENDOR_COLUMN_WARNING_PREFIX, rankServiceApps, readAssessTopN, resolveServiceIntake, SERVICE_INTAKE_DIR, type IntakeSourceConflict, type OtherSourcePolicy } from '@swao/module-service-assessment';
import {
  ConfirmPanel, FinishPanel, FINISH_MAIN_MENU, FINISH_PANEL_KEYS, guidanceOwnsKey, KEY_HINTS, MultiSelect, PICKER_VISIBLE_COUNT, RunPanel, ScreenLayout, RUN_PANEL_KEYS, RunOutput, SelectInput, StatusRow, TextInput, tone,
  useFlowNavigation, useHeaderWidth, useOptionGuidance, type FinishItem, type GuidanceEntry, type KeyHint, type SelectOption,
} from '@swao/tui-kit';
import { assessmentCost, callCost, cheaperModelLine, cheaperResearchModel, costConfirmationLines, estimateServiceRun, formatUsd, readCostConfirmThreshold, readMeasuredBasis, readServiceConnector, readServiceModels, timeBasis, type CallCost, type ServiceRunEstimate } from './service-run-estimate.js';
import { useScreenHeader } from '../components/screen-header.js';
import { readStoredServiceIntake } from '../../setup/defaults.js';
import { logServiceScreenComplete, logServiceScreenStart, readServiceResearchFacts, serviceRunLlmFields, ServiceAssessBatchLog, ServicePipelineStepLog, type ServiceRunFacts } from '../../commands/service-batch-log.js';
import { communityFrameworksDir } from '@swao/community-frameworks';
import { serviceFrameworkChoice, serviceFrameworkRowDetails, serviceFrameworksLine, serviceRunFrameworks, SERVICE_BASELINE_FRAMEWORK, WORKSPACE_FRAMEWORKS_DIR } from './service-frameworks.js';
import { COMMUNITY_FRAMEWORKS_URL } from '../../commands/framework.js';

type Phase = 'intake' | 'mapping' | 'llm' | 'checking' | 'other-source' | 'scope' | 'top-n' | 'pick-app' | 'frameworks' | 'confirm' | 'running' | 'finished' | 'details';
export type Stage = 'init' | 'research' | 'assess' | 'export';
/** #4400: `one` assesses one service app the operator picks (CLI parity: swao service assess --app <id>). */
export type ServiceScope = 'top' | 'all' | 'one' | 'none';

/** "Top N" for the first assessment run (#3165): several LLM calls and a few minutes per app. */
export const SERVICE_TOP_N = 20;
/** Typical minutes per service app with an LLM (UAT 2026-10-11: 3-4 min). */
const MINUTES_PER_APP: readonly [number, number] = [3, 4];
/**
 * #3518: LLM calls per app for the confirmation step. Research: the four LLM
 * topics (LlmResearchTopic in module-service-assessment research/llm-prompts.ts:37),
 * for every service app unless skipped. Assessment: at least one call each in
 * Pass 04 CTX (pass-04-ctx.ts:325), Pass 09 SYNTH (pass-09-synth.ts:489),
 * Pass 11 COMP (compliance-evaluator.ts:920, one call per 20 controls per regime)
 * and Pass 12 BLOCKS (pass-12-blocks.ts:396); conditional passes add more.
 */
export const RESEARCH_LLM_CALLS_PER_APP = 4;
export const MIN_ASSESS_LLM_CALLS_PER_APP = 4;
const OUTPUT_LINES = 6;
const SUMMARY_ROWS = 8;
/** #4238: lines of the details view. */
const DETAIL_LINES = 14;
/** #4238: keys of the details view. */
const DETAIL_KEYS: readonly KeyHint[] = [{ key: 'Enter', verb: 'back' }, { key: 'Esc', verb: 'back' }];
/** #4255 (Design 126 sections 3 and 4.5): the step bar of the Service flow. */
export const SERVICE_STEPS = ['Intake', 'Column map', 'Research', 'Scope', 'Confirm', 'Run', 'Done'] as const;
/** #4255: the step of the bar each phase belongs to. */
export const SERVICE_PHASE_STEP: Readonly<Record<Phase, number>> = {
  intake: 0, mapping: 1, llm: 2, checking: 2, 'other-source': 3, scope: 3, 'top-n': 3, 'pick-app': 3, frameworks: 3, confirm: 4, running: 5, finished: 6, details: 6,
};
/** #4255: the step title of each phase (block 4). */
export const SERVICE_STEP_TITLE: Readonly<Record<Phase, string>> = {
  intake: 'Intake workbook', mapping: 'Column map', llm: 'LLM research', checking: 'Reading the intake workbook',
  'other-source': 'Second intake workbook', scope: 'Scope', 'top-n': 'Top N', 'pick-app': 'Service app', frameworks: 'Frameworks', confirm: 'Confirm the run',
  running: 'Run', finished: 'Done', details: 'Details',
};
/** #4255 (Design 126 sections 7.2 and 7.4): Esc aborts the flow (AbortDialog after the intake
 *  step); the left arrow, or Shift+Tab in a text input, goes back one step with the values kept. */
const SERVICE_INTAKE_KEYS: readonly KeyHint[] = [{ key: 'Enter', verb: 'next' }, { key: 'Esc', verb: 'abort' }];
const SERVICE_INPUT_KEYS: readonly KeyHint[] = [{ key: 'Enter', verb: 'next' }, { key: 'Shift+Tab', verb: 'back' }, { key: 'Esc', verb: 'abort' }];
const SERVICE_PICKER_KEYS: readonly KeyHint[] = [{ key: '↑↓', verb: 'select' }, { key: 'Enter', verb: 'next' }, { key: '←', verb: 'back' }, { key: 'Esc', verb: 'abort' }];
/** #4255: the phases before the run, where Esc aborts the flow. */
const SERVICE_PRE_RUN: ReadonlySet<string> = new Set(['intake', 'mapping', 'llm', 'other-source', 'scope', 'top-n', 'pick-app', 'frameworks', 'confirm']);
/** #4255 (section 7.1): phases whose content is a text input (the left arrow moves the text cursor). */
const SERVICE_TEXT_PHASES: ReadonlySet<string> = new Set(['intake', 'mapping', 'top-n']);
/** #4255 (section 7.2): the phase the back key returns to; null on the first step. */
export function serviceBackPhase(phase: Phase, scope: ServiceScope | null = null): Phase | null {
  switch (phase) {
    case 'mapping': return 'intake';
    case 'llm': return 'mapping';
    case 'other-source': return 'intake';
    case 'scope': return 'llm';
    case 'top-n': return 'scope';
    case 'pick-app': return 'scope';
    // #4400: the framework step follows the scope details (N, the picked service app).
    case 'frameworks': return scope === 'top' ? 'top-n' : scope === 'one' ? 'pick-app' : 'scope';
    case 'confirm': return scope && scope !== 'none' ? 'frameworks' : 'scope';
    case 'intake': case 'checking': case 'running': case 'finished': case 'details': return null;
  }
}


/** Column mapping page of the user manual (#3220, #3164); English is the root locale. */
export const SERVICE_COLUMN_MAPPING_DOCS_URL = 'https://accenture.github.io/SWAO/service-assessment/column-mapping';

/** A stage the finished screen can re-run on its own, without the questions (#3220, #3165). */
export type RerunStage = 'research' | 'assess' | 'export';
/** #4238: the What next entries of the finish screen. */
export type FinishedAction = RerunStage | 'rank' | 'details' | typeof FINISH_MAIN_MENU;

/** Which single-stage re-runs are offered after a run. */
export interface RerunAvailability {
  /** Number of apps the last run assessed (0 = scaffold and research only: no assessment re-run). */
  assessApps: number;
  /** Enterprise export allowed by the licence. */
  export: boolean;
}

/**
 * #4238 (Design 126 section 4.7): the What next menu of the finish screen in
 * plain words; FinishPanel appends "Back to main menu". The details of the
 * run (research confidence, per-app results) sit behind "Show details".
 */
export function serviceFinishMenu(avail: RerunAvailability, extra: ServiceFinishExtras = {}): SelectOption[] {
  const pub = extra.publishApps ?? 0;
  return [
    ...(pub > 0 ? [{ label: pub === 1 ? 'Publish the HTML report of the assessed app' : `Publish the HTML reports of the ${pub} assessed apps`, value: 'publish' }] : []),
    { label: 'Show the priority list', value: 'rank' },
    ...(extra.workbook ? [{ label: 'Open the portfolio workbook', value: 'workbook' }] : []),
    { label: 'Show details', value: 'details' },
    { label: 'Re-run the research', value: 'research' },
    ...(avail.assessApps > 0 ? [{ label: `Re-assess the same ${avail.assessApps} ${avail.assessApps === 1 ? 'app' : 'apps'}`, value: 'assess' }] : []),
    ...(avail.export ? [{ label: 'Re-run the portfolio workbook export', value: 'export' }] : []),
  ];
}

/** #4238: the publish and workbook entries of the What next menu. */
export interface ServiceFinishExtras {
  /** Apps of this run with a complete assessment (Publish their HTML reports). */
  publishApps?: number;
  /** The portfolio workbook was written in this run (Open the portfolio workbook). */
  workbook?: boolean;
  /** The workspace path, named in the guidance (owner 2026-11-10 12:18: not under the header). */
  workspace?: string;
}

/** #4238: what each What next entry does; the CLI equivalents come last (rule 10). */
export function serviceFinishGuidance(avail: RerunAvailability, extra: ServiceFinishExtras = {}): { title: string; what: string; cli: string } {
  return {
    title: 'What next',
    what: [
      ...((extra.publishApps ?? 0) > 0 ? ['Publish writes the HTML report of each assessed app into its wsp/publications/ folder.'] : []),
      'Show the priority list ranks the service apps by risk.',
      ...(extra.workbook ? ['Open the portfolio workbook opens the newest workbook of wsp/reports/ in the default application.'] : []),
      'Show details lists the research confidence and the result of each assessed app.',
      'Re-run the research refreshes CVE, end-of-life, VirusTotal and vendor data.',
      ...(avail.assessApps > 0 ? ['Re-assess runs the same apps again.'] : []),
      ...(avail.export ? ['The export writes the portfolio workbook and the star schema.'] : []),
      'Publish the HTML report of any other app from Publish in the main menu.',
      ...(extra.workspace ? [`Workspace: ${extra.workspace}.`] : []),
    ].join(' '),
    cli: ['swao service rank', 'swao service research', ...(avail.assessApps > 0 ? ['swao service assess --app <id>'] : []), ...(avail.export ? ['swao service export'] : []), 'swao publish --app <id>'].join(', '),
  };
}

/**
 * #4256 (owner 2026-11-10 15:01): the Outputs row with the real run folders, never
 * the placeholder apps/<id>/wsp/runs/: the first complete app's run folder, how
 * many more apps have one, and the workbook folders when the export wrote them.
 */
export function serviceOutputsRow(outcomes: readonly ServiceAssessOutcome[], exportWritten: boolean): string | null {
  const ok = outcomes.filter((o) => o.run !== null && o.exitCode === 0);
  const parts: string[] = [];
  if (ok.length > 0) {
    const first = ok[0]!;
    let run = first.run!.split('\\').join('/');
    while (run.endsWith('/')) run = run.slice(0, -1);
    parts.push(`apps/${first.appId}/wsp/${run}/${ok.length > 1 ? ` and the run folders of ${ok.length - 1} more apps` : ''}`);
  }
  if (exportWritten) parts.push('wsp/reports/ and wsp/star-schema/');
  return parts.length > 0 ? parts.join('; ') : null;
}

/** #4238: the newest portfolio workbook (wsp/reports/*.xlsx), or null. */
export function latestServiceWorkbook(workspace: string): string | null {
  const dir = join(workspace, 'wsp', 'reports');
  try {
    const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.xlsx')).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }));
    files.sort((a, b) => b.t - a.t || a.f.localeCompare(b.f));
    return files[0] ? join(dir, files[0].f) : null;
  } catch {
    return null;
  }
}

/** #4238: the finish title; a long reason moves to a row so the title stays one line. */
export function serviceFinishTitle(text: string): { title: string; reason: string | null } {
  const t = text.trim().replace(/\.$/, '');
  return t.length <= 60 && !t.includes('. ') ? { title: t, reason: null } : { title: 'Service Portfolio Assessment stopped', reason: text.trim() };
}

/** #4238: the first lines of the details view (failures come first), the rest counted. */
export function detailWindow(lines: readonly string[], max: number): string[] {
  if (lines.length <= max) return [...lines];
  return [...lines.slice(0, max - 1), `${lines.length - (max - 1)} more lines; the priority list and each app's run folder have them all.`];
}

/** Detail rows of the guidance panel; the Column mapping docs page comes first so a short terminal still shows it (#3220, #3164). */
export function serviceGuidanceDetails(): Array<{ label: string; value: string }> {
  return [
    { label: 'Column mapping', value: SERVICE_COLUMN_MAPPING_DOCS_URL },
    { label: 'Intake', value: `${SERVICE_INTAKE_DIR}/<workbook>.xlsx (optional column map next to it)` },
    { label: 'CLI', value: 'swao service init | swao service research | swao service rank --top <n> | swao service assess --top <n> | swao service assess --app <id>' },
    { label: 'Output', value: 'apps/<id>/.swao.yml, wsp/portfolio-summary.json, apps/<id>/wsp/runs/' },
  ];
}

/** Spawns one CLI child and streams its output; injectable for tests. */
export type ServiceChildRunner = (args: string[], onText: (text: string) => void) => Promise<number>;

const STAGE_LABEL: Record<Stage, string> = {
  init: 'Scaffolding service apps from the intake',
  research: 'Researching CVE, end-of-life and advisory data',
  assess: 'Assessing service apps',
  export: 'Writing the portfolio workbook and star schema',
};

export interface ServiceInitScreenProps {
  onBack: () => void;
  /** Workspace root; defaults to the workspace containing the current directory. */
  workspacePath?: string;
  /** Test seam: replaces the CLI child process (output text in, exit code out). */
  runChild?: ServiceChildRunner;
  /** Test seam: replaces the in-process init preview (#3521). */
  previewInit?: ServiceInitPreviewer;
  /** #4400: the bundled community frameworks (the framework step); default the copy shipped with SWAO. */
  bundledCommunityDir?: string;
}

/** What `service init` would do, computed in-process before any child runs (#3521, #3518). */
export interface ServiceInitPreview {
  /** Workbook file name. */
  sourceName: string;
  /** App IDs the workbook scaffolds. */
  plannedAppIds: string[];
  /** Service apps under apps/ before the init (any source). */
  existingServiceAppIds: string[];
  /** Service apps of another intake workbook. */
  conflict: IntakeSourceConflict;
  /** #4489: no column maps to vendor.name (CVE lookups and vendor consolidation stay empty). */
  vendorWarning?: string;
}

export type ServiceInitPreviewer = (intake: string, mapping: string, workspace: string) => Promise<ServiceInitPreview | null>;

const unquote = (v: string): string => v.trim().replace(/^"|"$/g, '');

/**
 * #3521: parse and plan the intake in-process (no writes) so the screen can
 * name a second intake workbook before scaffolding. Null when the workbook
 * cannot be read or has duplicate IDs: the CLI child then reports the error.
 */
export async function previewServiceInit(intake: string, mapping: string, workspace: string): Promise<ServiceInitPreview | null> {
  try {
    const from = unquote(intake);
    const located = from ? null : resolveServiceIntake(workspace);
    const intakePath = from ? resolve(from) : located!.intakePath;
    if (!existsSync(intakePath)) return null;
    const m = unquote(mapping);
    const mappingPath = m ? resolve(m) : located?.mappingPath ?? undefined;
    const plan = await planServiceInit({ workspacePath: workspace, intakePath, ...(mappingPath ? { mappingPath } : {}) });
    if (!plan.ok) return null;
    return {
      sourceName: plan.source.name,
      plannedAppIds: plan.plan.apps.map((a) => a.appId),
      existingServiceAppIds: plan.existingServiceAppIds,
      conflict: plan.conflict,
      ...(vendorWarningOf(plan.warnings) ? { vendorWarning: vendorWarningOf(plan.warnings)! } : {}),
    };
  } catch {
    return null;
  }
}

/** #4489: the vendor column warning of the init plan (same text as `swao service init` prints). */
export function vendorWarningOf(warnings: readonly string[]): string | undefined {
  return warnings.find((w) => w.startsWith(NO_VENDOR_COLUMN_WARNING_PREFIX));
}

/** #3304: `skipLlm` adds `--skip-llm` (the four LLM research topics are skipped; earlier findings are kept). */
export function buildServiceResearchArgs(workspace: string, opts: { skipLlm?: boolean; model?: string | null; app?: string | null } = {}): string[] {
  // #4236: the research model chosen on the confirmation step (a cheaper one than the primary).
  // #4400: the One service scope researches the picked app only.
  return ['service', 'research', '--workspace', workspace, ...(opts.app ? ['--app', opts.app] : []), ...(opts.skipLlm ? ['--skip-llm'] : opts.model ? ['--model', opts.model] : [])];
}

/** Enterprise portfolio workbook + star schema (#3117); the CLI enforces the tier gate. */
export function buildServiceExportArgs(workspace: string): string[] {
  return ['service', 'export', '--workspace', workspace];
}

/**
 * One service app per run: `assess --portfolio` is Enterprise-gated, this path works at every tier (#3144).
 * #4400: `added` (the framework step) becomes `--regimes SWAO_APM,<added>`; SWAO_APM is always first,
 * and the assess command adds the set to each app's default frameworks (owner decision 2026-11-15).
 */
export function buildServiceAssessArgs(workspace: string, appId: string, added?: readonly string[]): string[] {
  return ['assess', '--app', appId, '--type', 'service', '--workspace', workspace, ...(added ? ['--regimes', serviceRunFrameworks(added).join(',')] : [])];
}

/** CLI arguments for the given inputs; exported for tests. An empty intake lets the CLI use wsp/inputs/service-intake/ (#3211). */
export function buildServiceInitArgs(intake: string, mapping: string, workspace: string, otherSource: OtherSourcePolicy = 'refuse'): string[] {
  const from = unquote(intake);
  const args = from ? ['service', 'init', '--from', from, '--workspace', workspace] : ['service', 'init', '--workspace', workspace];
  const m = unquote(mapping);
  if (m) args.push('--mapping', m);
  // #3521: the operator's choice for a second intake workbook (CLI parity: --replace / --keep).
  if (otherSource !== 'refuse') args.push(`--${otherSource}`);
  return args;
}

/** Intake workbook and column map found in wsp/inputs/service-intake/, for pre-filling (#3211). */
export function defaultServiceIntake(workspace: string): { intake: string; mapping: string } {
  // #4198 (Design 125 section 5.7): the workbook the Service setup stored comes first.
  const stored = readStoredServiceIntake(workspace);
  if (stored.intake) return { intake: stored.intake, mapping: stored.mapping ?? '' };
  try {
    const r = resolveServiceIntake(workspace);
    return { intake: r.intakePath, mapping: r.mappingPath ?? '' };
  } catch {
    return { intake: '', mapping: '' };
  }
}

/** The app's latest service run (`apps/<id>/wsp/latest-service.txt`, e.g. `runs/<ts>`), or null. */
export function readServiceRunPointer(workspace: string, appId: string): string | null {
  const p = join(workspace, 'apps', appId, 'wsp', 'latest-service.txt');
  try {
    const v = existsSync(p) ? readFileSync(p, 'utf-8').trim() : '';
    return v || null;
  } catch {
    return null;
  }
}

export interface ServiceAssessOutcome {
  appId: string;
  exitCode: number;
  /** Run directory relative to `apps/<id>/wsp/`; null when the assessment produced no new run. */
  run: string | null;
  /** `skipped_passes.length` from the run's scope-coverage.json; null when unreadable. */
  skipped: number | null;
}

/**
 * Read the skipped pass count of the run an assessment just wrote. A pointer
 * equal to `before` means no new run was written (SWAO can print `[error]` and
 * still exit 0), so a stale count from an earlier run is never shown.
 */
export function readServiceAssessOutcome(workspace: string, appId: string, before: string | null, exitCode: number): ServiceAssessOutcome {
  const run = readServiceRunPointer(workspace, appId);
  if (!run || run === before) return { appId, exitCode, run: null, skipped: null };
  try {
    const doc = JSON.parse(readFileSync(join(workspace, 'apps', appId, 'wsp', run, 'scope-coverage.json'), 'utf-8')) as { skipped_passes?: unknown };
    return { appId, exitCode, run, skipped: Array.isArray(doc.skipped_passes) ? doc.skipped_passes.length : null };
  } catch {
    return { appId, exitCode, run, skipped: null };
  }
}


/** `[12/234] app: ...` research progress lines. */
export function parseResearchProgress(text: string): { done: number; total: number } | null {
  const all = [...text.matchAll(/^\[(\d+)\/(\d+)\]\s/gm)];
  const m = all.at(-1);
  return m ? { done: Number(m[1]), total: Number(m[2]) } : null;
}

/** Current pass name and completed pass count, parsed like the Application Assessment screen (#0379, #0403). */
export function parsePassProgress(text: string): { passName: string | null; completed: number } {
  return { passName: lastPassName(text), completed: completedPassCount(text) };
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

/** Rough duration of the assessment stage for `apps` apps, for the scope question. */
export function estimateAssessment(apps: number): string {
  const [lo, hi] = MINUTES_PER_APP;
  const fmt = (min: number) => (min >= 90 ? `${Math.round(min / 60)} h` : `${min} min`);
  return `about ${fmt(apps * lo)} to ${fmt(apps * hi)}`;
}

/** #3518: what a scope choice means in numbers, for the option labels, the confirmation and the stage line. */
export interface ScopePlan {
  scope: ServiceScope;
  /** Service apps in the workspace after the scaffold; null when the workbook could not be read in advance. */
  totalApps: number | null;
  /** Apps the assessment stage runs for; null when not known in advance. */
  assessApps: number | null;
  /** Assessment duration estimate; null when nothing is assessed or the count is unknown. */
  duration: string | null;
  /** LLM calls: research (all apps) plus the assessment minimum. */
  researchLlmCalls: number | null;
  assessLlmCallsMin: number | null;
}

export function planScope(scope: ServiceScope, totalApps: number | null, opts: { skipLlmResearch: boolean; topN?: number }): ScopePlan {
  const topN = opts.topN ?? SERVICE_TOP_N;
  const assessApps = scope === 'none' ? 0 : scope === 'one' ? 1 : totalApps === null ? (scope === 'top' ? topN : null) : scope === 'top' ? Math.min(topN, totalApps) : totalApps;
  return {
    scope,
    totalApps,
    assessApps,
    duration: assessApps ? estimateAssessment(assessApps) : null,
    // #4400: the One service scope researches the picked app only.
    researchLlmCalls: opts.skipLlmResearch ? 0 : scope === 'one' ? RESEARCH_LLM_CALLS_PER_APP : totalApps === null ? null : totalApps * RESEARCH_LLM_CALLS_PER_APP,
    assessLlmCallsMin: assessApps === null ? null : assessApps * MIN_ASSESS_LLM_CALLS_PER_APP,
  };
}

/** Scope tag for the stage line, e.g. "Top 20", "All 461", "no assessment" (#3518). */
export function scopeTag(scope: ServiceScope, assessApps: number | null): string {
  switch (scope) {
    case 'top': return `Top ${assessApps ?? SERVICE_TOP_N}`;
    case 'all': return assessApps === null ? 'All' : `All ${assessApps}`;
    case 'one': return 'One service';
    case 'none': return 'no assessment';
    default: {
      const never: never = scope;
      return String(never);
    }
  }
}

/** Confirmation lines for a scope (#3518): scope, app count, duration and LLM calls. */
export function scopeConfirmationLines(plan: ScopePlan, opts: { withTime?: boolean; app?: string | null; frameworks?: readonly string[] } = {}): string[] {
  const lines = [`Scope: ${plan.scope === 'none' ? 'None (scaffold and research only)' : plan.scope === 'one' ? `One service (${opts.app ?? 'not picked'})` : plan.scope === 'top' ? `Top ${plan.assessApps ?? SERVICE_TOP_N} by risk` : 'All apps'}`];
  lines.push(plan.totalApps === null
    ? 'Service apps after the scaffold: not known in advance (the workbook could not be read before the scaffold)'
    : `Service apps after the scaffold: ${plan.totalApps}`);
  lines.push(`Apps to assess: ${plan.assessApps === null ? 'all scaffolded apps (count not known in advance)' : plan.assessApps}`);
  // #4374: withTime false when the cost view shows the time, research stage and basis included.
  const withTime = opts.withTime ?? true;
  if (withTime && plan.assessApps) {
    const [lo, hi] = MINUTES_PER_APP;
    lines.push(`Estimated assessment time: ${plan.duration} (${lo} to ${hi} min per app x ${plan.assessApps} apps)`);
  } else if (withTime && plan.scope === 'all') {
    lines.push(`Estimated assessment time: ${MINUTES_PER_APP[0]} to ${MINUTES_PER_APP[1]} min per app`);
  }
  const research = plan.researchLlmCalls === null ? `${RESEARCH_LLM_CALLS_PER_APP} per app` : `${plan.researchLlmCalls}`;
  const assess = plan.assessLlmCallsMin === null ? `at least ${MIN_ASSESS_LLM_CALLS_PER_APP} per app` : `at least ${plan.assessLlmCallsMin}`;
  lines.push(`LLM calls: research ${plan.researchLlmCalls === 0 ? '0 (LLM research skipped)' : research}; assessment ${plan.assessApps === 0 ? '0' : assess}`);
  // #4400: SWAO_APM is evaluated in every service run, plus the frameworks added on the framework step.
  if (opts.frameworks && plan.assessApps !== 0) lines.push(`Frameworks: ${serviceFrameworksLine(opts.frameworks)}`);
  return lines;
}

/** #4255: shorter labels of the confirmation rows (the label column stays narrow at 80 columns). */
const CONFIRM_LABELS: Readonly<Record<string, string>> = {
  'Service apps after the scaffold': 'Service apps',
  'Estimated assessment time': 'Assessment time',
};

/**
 * #4255 (Design 126 section 4.4): the confirmation lines as ConfirmPanel rows.
 * A line "Label: value" becomes one row; a line without a label (the ranking
 * note) is a "Note" row; the cheaper research model is its own row.
 */
export function serviceConfirmRows(scopeLines: readonly string[], costLines: readonly string[], researchModel: string | null): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  for (const line of [...scopeLines, ...costLines]) {
    const i = line.indexOf(': ');
    if (i > 0 && i <= 32) {
      const label = line.slice(0, i);
      rows.push({ label: CONFIRM_LABELS[label] ?? label, value: line.slice(i + 2) });
    } else {
      rows.push({ label: 'Note', value: line });
    }
  }
  if (researchModel) rows.push({ label: 'Research model', value: researchModel });
  return rows;
}

/**
 * #3518: the confirmation step may be skipped for "none" and for Top N with
 * N <= 20 only when `service_portfolio.confirm_small_scope: false` is set in the
 * workspace .swao.yml; "all" is always confirmed.
 */
export function needsScopeConfirmation(scope: ServiceScope, workspace: string, topN: number = SERVICE_TOP_N): boolean {
  if (scope === 'all') return true;
  if (scope === 'top' && topN > 20) return true;
  try {
    const doc = loadYaml(readFileSync(join(workspace, '.swao.yml'), 'utf-8')) as { service_portfolio?: { confirm_small_scope?: unknown } } | null;
    return doc?.service_portfolio?.confirm_small_scope !== false;
  } catch {
    return true;
  }
}

/** Stop a child and its own children (SWAO spawns passes and tools); Windows needs taskkill by PID. */
function killChildTree(child: ChildProcess | null): void {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
}

function exportAllowed(): boolean {
  try {
    const guard = LicenseGuard.load();
    guard.requireFeature('service-excel');
    guard.requireFeature('bi-export');
    return true;
  } catch {
    return false;
  }
}

/** Completion view of the assessment stage: failures first, capped so the frame stays inside the terminal (#3166). */
export function ServiceAssessSummary({ outcomes, total, maxRows = SUMMARY_ROWS }: { outcomes: readonly ServiceAssessOutcome[]; total: number; maxRows?: number }): JSX.Element {
  const isOk = (o: ServiceAssessOutcome) => o.run !== null && o.exitCode === 0;
  const ok = outcomes.filter(isOk).length;
  const ordered = [...outcomes.filter((o) => !isOk(o)), ...outcomes.filter(isOk)];
  const shown = ordered.slice(0, maxRows);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Service assessments: {ok}/{total} complete{outcomes.length < total ? ` (${outcomes.length} of ${total} run so far)` : ''}</Text>
      {shown.map((o) => (
        <Text key={o.appId} {...tone(isOk(o) ? 'text' : 'error')} wrap="wrap">
          {'  '}{o.appId}: {o.run === null
            ? `no new run (exit code ${o.exitCode})`
            : `${o.skipped === null ? 'skipped pass count unavailable' : `${o.skipped} pass(es) skipped`} (${o.run}/scope-coverage.json)${o.exitCode !== 0 ? `, exit code ${o.exitCode}` : ''}`}
        </Text>
      ))}
      {ordered.length > shown.length && <Text {...tone('muted')}>{'  '}+{ordered.length - shown.length} more (the priority list shows every app)</Text>}
    </Box>
  );
}

/**
 * Stage line text (#3518). #4236 / #4237 (D-1): the research stage of a Top N run
 * says that it researches every scaffolded app to rank the top N.
 */
export function stageLabel(stage: Stage, scope: ServiceScope | null, plan: ScopePlan | null, scaffolded: number | null, assessing: number): string {
  if (stage === 'research' && scope === 'top') {
    const all = scaffolded ?? plan?.totalApps;
    const n = plan?.assessApps ?? SERVICE_TOP_N;
    return all !== null && all !== undefined ? `Researching all ${all} apps to rank the top ${n}` : `Researching all apps to rank the top ${n}`;
  }
  return `${STAGE_LABEL[stage]}${scope ? ` (${scopeTag(scope, stage === 'assess' ? assessing : plan?.assessApps ?? null)})` : ''}`;
}

/** #4236 (D-1): cost figures of the confirmation step. */
export interface ServiceCostView {
  estimate: ServiceRunEstimate;
  /** The research model configured in the workspace (service_portfolio.research_model, else the primary). */
  configuredResearch: string | null;
  /** A cheaper research model than the configured one; null when none is known or research is skipped. */
  cheaper: CallCost | null;
}

export function serviceCostView(workspace: string, plan: ScopePlan, researchModelChoice: string | null, now: Date = new Date(), oneAppId: string | null = null): ServiceCostView {
  // #4374: research means from research calls only, assessment and time from earlier service runs.
  const basis = readMeasuredBasis(workspace);
  const measured = basis.researchByModel;
  const models = readServiceModels(workspace);
  // #4497: prices from the workspace connector of the primary model (connector file, discovery, bundled price).
  const connector = readServiceConnector(workspace);
  const configured = callCost(models.research, 'research', measured, connector);
  const researchTopics = plan.researchLlmCalls ?? 0;
  const cheaper = researchTopics > 0 ? cheaperResearchModel(configured, measured, connector) : null;
  // The switched model keeps the figure the offer showed (measured, scaled or price table).
  const research = !researchModelChoice ? configured
    : cheaper?.model === researchModelChoice ? cheaper : callCost(researchModelChoice, 'research', measured, connector);
  // #4400: One service researches one app; the cached topics of the other apps do not count.
  // #4497 / #4485: its own cached topics do, and only its stubs are read.
  const cached = researchTopics === 0 ? 0
    : plan.scope === 'one' ? (oneAppId ? cachedLlmResearch(workspace, now, { appId: oneAppId }).topicsCached : 0)
      : cachedLlmResearch(workspace, now).topicsCached;
  const estimate = estimateServiceRun({
    researchTopics,
    cachedTopics: cached,
    assessCallsMin: plan.assessLlmCallsMin ?? 0,
    assessApps: plan.assessApps,
    research,
    assessment: assessmentCost(models.primary, basis, connector),
    time: timeBasis(basis),
    thresholdUsd: readCostConfirmThreshold(workspace),
  });
  return { estimate, configuredResearch: models.research, cheaper: cheaper?.model ? cheaper : null };
}

/** #4236: hint line of the confirmation step (Design 126 KeyHints; no double dash, #4235). */
/** #4400: `backToFrameworks` when the confirmation follows the framework step (every scope that assesses). */
export function confirmKeyHints(view: ServiceCostView | null, costConfirmed: boolean, backToFrameworks = false): KeyHint[] {
  return [
    { key: 'Enter', verb: 'confirm', object: costConfirmed ? 'the cost and start' : view?.estimate.needsCostConfirmation ? 'the scope' : 'and start' },
    ...(view?.cheaper ? [{ key: 'Tab', verb: 'toggle', object: 'research model' } as KeyHint] : []),
    { key: '←', verb: 'back', object: costConfirmed ? 'to the cost' : backToFrameworks ? 'to the frameworks' : 'to the scope question' },
    { key: 'Esc', verb: 'abort' },
  ];
}

/** #4230: the guidance entry of each LLM research option. */
export const SERVICE_LLM_GUIDANCE: Readonly<Record<'run' | 'skip', GuidanceEntry>> = {
  run: { title: 'Run LLM research', what: 'Four LLM calls per app research the vendor profile, the certifications, the data residency and the breach history. The findings name their sources and stay unverified until a reviewer confirms them.', sections: [{ label: 'Needs', text: 'a workspace LLM (Setup, LLM)' }] },
  skip: { title: 'Skip LLM research', what: 'Scaffolds and assesses without new research. LLM findings of earlier runs stay in the app folders and are used again.' },
};

/** #4230: the guidance entry of each choice for apps of another intake workbook. */
export const SERVICE_OTHER_SOURCE_GUIDANCE: Readonly<Record<'back' | 'replace' | 'keep', GuidanceEntry>> = {
  back: { title: 'Back', what: 'Returns to the intake step to choose another workbook, or to use a new workspace. Nothing is changed.' },
  replace: { title: 'Replace', what: 'Moves the existing service apps to parked-apps/ (nothing is deleted) and scaffolds the apps of this workbook.' },
  keep: { title: 'Keep both', what: 'Adds the apps of this workbook next to the existing ones. Services that both workbooks describe are then listed twice.' },
};

/** #4230: the guidance entry of each run scope. */
export const SERVICE_SCOPE_GUIDANCE: Readonly<Record<ServiceScope, GuidanceEntry>> = {
  top: { title: 'Top N by risk', what: 'Scaffolds every app, researches all of them, ranks them by risk and assesses the N highest. SWAO asks for N next; the confirmation shows the time and the cost.', cli: 'swao service assess --top <n>' },
  all: { title: 'Every app', what: 'Scaffolds, researches and assesses every service app. This takes 3 to 4 minutes and several LLM calls per app.' },
  one: { title: 'One service', what: 'Pick one service app: SWAO scaffolds it if needed, researches it and assesses it. Only that app is researched, so the run takes a few minutes.', cli: 'swao service assess --app <id>' },
  none: { title: 'Scaffold and research only', what: 'Scaffolds and researches every app without the LLM assessment; the priority list is ready afterwards.' },
};

/** #4400: the guidance of the One service app picker and of the framework step. */
export const SERVICE_PICK_APP_GUIDANCE: GuidanceEntry = { title: 'Service app', what: 'Choose the service app to assess. SWAO scaffolds it from the intake workbook when its folder is missing, researches it and assesses it. Type part of a name to filter the list.', cli: 'swao service assess --app <id>' };
export const SERVICE_FRAMEWORKS_GUIDANCE: GuidanceEntry = { title: 'Frameworks', what: `${SERVICE_BASELINE_FRAMEWORK} is evaluated in every service run and stays selected. Mark any other community framework installed in the workspace (${WORKSPACE_FRAMEWORKS_DIR}/) to add it to this run; the app files are not changed.`, cli: 'swao service assess --regimes <ids>' };

export function ServiceInitScreen({ onBack, workspacePath, runChild, previewInit = previewServiceInit, bundledCommunityDir = communityFrameworksDir }: ServiceInitScreenProps): JSX.Element {
  const workspace = useRef(workspacePath ?? findWorkspace(process.cwd()) ?? process.cwd());
  const canExport = useRef<boolean | null>(null);
  const exportOk = (): boolean => (canExport.current ??= exportAllowed());
  const defaults = useRef(defaultServiceIntake(workspace.current));
  const [phase, setPhase] = useState<Phase>('intake');
  const header = useScreenHeader('Service Portfolio Assessment');
  const [intake, setIntake] = useState(defaults.current.intake);
  const [stage, setStage] = useState<Stage | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [appCount, setAppCount] = useState<number | null>(null);
  const [research, setResearch] = useState<{ done: number; total: number } | null>(null);
  const [researchSummary, setResearchSummary] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [currentApp, setCurrentApp] = useState<string | null>(null);
  const [passName, setPassName] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<ServiceAssessOutcome[]>([]);
  const [appDurations, setAppDurations] = useState<number[]>([]);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [stageStart, setStageStart] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const childRef = useRef<ChildProcess | null>(null);
  const cancelledRef = useRef(false);
  const pipelineStartedRef = useRef(false);
  const backRef = useRef(false);
  const guidanceOpenRef = useRef(false);
  // #4230 (Design 126 sections 7.8 and 9): the box of the LLM, other-source and
  // scope pickers follows the highlighted option (one entry per option).
  const { entry: optionEntry, onCursorChange: onOptionCursor } = useOptionGuidance(SERVICE_LLM_GUIDANCE.run);
  // #4256: RunPanel needs the open state of the guidance box; a key per run remounts it (it cancels once per mount).
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const [runKey, setRunKey] = useState(0);
  // #4238: the lines of the details view (Show details, Show the priority list).
  const [details, setDetails] = useState<{ title: string; lines: string[] } | null>(null);
  // #3304: the LLM research choice, reused by the R re-run.
  const skipLlmRef = useRef(false);
  // #4236 (D-1): research model chosen on the confirmation step (null: the configured one),
  // and the second confirmation above the cost threshold.
  const [researchModelChoice, setResearchModelChoice] = useState<string | null>(null);
  const researchModelRef = useRef<string | null>(null);
  const [costConfirmed, setCostConfirmed] = useState(false);
  // #3521: in-process plan of the init and the choice for a second intake workbook.
  const [preview, setPreview] = useState<ServiceInitPreview | null>(null);
  const [otherSource, setOtherSource] = useState<OtherSourcePolicy>('refuse');
  // #3518: the chosen scope, shown in the confirmation step and the stage line.
  const [scope, setScope] = useState<ServiceScope | null>(null);
  // #3520: N for "Top N by risk"; workspace default service_portfolio.assess_top_n (else 20).
  const topNDefault = useRef<{ n: number; warning: string | null } | null>(null);
  if (topNDefault.current === null) {
    try { topNDefault.current = { n: readAssessTopN(workspace.current), warning: null }; }
    catch (e) { topNDefault.current = { n: SERVICE_TOP_N, warning: (e as Error).message }; }
  }
  const [topN, setTopN] = useState<number>(topNDefault.current.n);
  const topNRef = useRef(topN);
  // #4400: the One service scope: the picked service app; the frameworks added to SWAO_APM (null: the step did not run).
  const [oneApp, setOneApp] = useState<string | null>(null);
  const oneAppRef = useRef<string | null>(null);
  const [addedFrameworks, setAddedFrameworks] = useState<string[] | null>(null);
  const addedFrameworksRef = useRef<string[] | null>(null);
  const scopeRef = useRef<ServiceScope | null>(null);
  const [topNError, setTopNError] = useState<string | null>(null);

  // Heartbeat (#3169): the child is silent for minutes during LLM passes.
  useEffect(() => {
    if (phase !== 'running') return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => () => { backRef.current = true; killChildTree(childRef.current); }, []);

  // #4255 (Design 126 sections 7.4 and 7.5): the flow abort. The screen reads the keys
  // itself (its phases are the steps), so the hook provides the dialog and the decision.
  const nav = useFlowNavigation({ steps: SERVICE_STEPS, dirty: phase !== 'intake', onExit: () => { backRef.current = true; onBack(); }, what: 'assessment', active: false });

  useInput((input, key) => {
    if (backRef.current) return;
    // #4230 (Design 126 section 7.8): an open guidance box owns Esc, PgUp and PgDn only.
    if (guidanceOwnsKey(key, guidanceOpenRef.current)) return;
    // #4256: RunPanel owns Esc during a run (cancel after the AbortDialog).
    if (phase === 'running') return;
    if (nav.dialogOpen) return; // #4255: the AbortDialog owns Enter and Esc
    // #4255 (Design 126 sections 7.2 and 7.4): before the run Esc aborts the flow
    // (AbortDialog after the intake step); the left arrow, or Shift+Tab in a text
    // input, goes back one step with the values kept. On the confirmation the back
    // key withdraws the second cost confirmation first.
    if (SERVICE_PRE_RUN.has(phase)) {
      if (key.escape) { nav.requestAbort(); return; }
      if ((key.tab && key.shift) || (key.leftArrow && !SERVICE_TEXT_PHASES.has(phase))) {
        if (phase === 'confirm' && costConfirmed) { setCostConfirmed(false); return; }
        if (phase === 'other-source') setPreview(null);
        const to = serviceBackPhase(phase, scope);
        if (to) setPhase(to);
        return;
      }
    }
    if (phase === 'details') {
      if (key.escape || key.return || key.leftArrow) setPhase('finished');
      return;
    }
    if (phase === 'confirm') {
      // #3518: Enter starts, Esc returns to the scope question (never leaves the screen).
      // #4236: Tab switches to the cheaper research model; above the cost threshold
      // the first Enter asks for a second confirmation, Esc withdraws it.
      if (key.tab && !key.shift && costView?.cheaper) {
        const next = researchModelChoice === null ? costView.cheaper.model : null;
        setResearchModelChoice(next);
        researchModelRef.current = next;
        setCostConfirmed(false);
      }
      // #4255: Enter belongs to the ConfirmPanel (confirmStart).
      return;
    }
    if (phase === 'finished') {
      // #4238: FinishPanel reads Enter and the arrows; Esc aborts to the main menu.
      if (key.escape) { backRef.current = true; onBack(); }
      return;
    }
    if (key.escape) { backRef.current = true; onBack(); }
  });

  const spawnChild = (args: string[], onText: (text: string) => void): Promise<number> => runChild
    ? runChild(args, (text) => { onText(text); setLines((prev) => [...prev, ...text.split(/\r\n|\r|\n/).map((l) => l.trimEnd()).filter(Boolean)].slice(-200)); })
    : new Promise((resolve) => {
    const selfCmd = selfSpawnCommand(args, { env: { ...process.env, NODE_OPTIONS: [process.env['NODE_OPTIONS'], '--no-deprecation'].filter(Boolean).join(' ') } });
    const child = spawn(selfCmd.command, selfCmd.args, {
      env: selfCmd.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    childRef.current = child;
    const append = (chunk: Buffer): void => {
      const text = chunk.toString();
      onText(text);
      // #3400: split on CR too, so a child's \r-updated progress line does not
      // glue to the next output (the "234o Assessment complete" artifact).
      const next = text.split(/\r\n|\r|\n/).map((l) => l.trimEnd()).filter(Boolean);
      setLines((prev) => [...prev, ...next].slice(-200));
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', () => resolve(1));
    child.on('close', (code) => { childRef.current = null; resolve(code ?? 1); });
  });

  const startStage = (s: Stage): void => { setStage(s); setStageStart(Date.now()); setLines([]); };
  // #4301: what the run produced, for assess.service.complete (reset at each start).
  const runFactsRef = useRef<ServiceRunFacts>({});
  // #4457: start, progress (every 15 s) and complete events of each pipeline step.
  const stepsRef = useRef<ServicePipelineStepLog | null>(null);
  const cancelled = (): boolean => cancelledRef.current || backRef.current;
  const finish = (ok: boolean, text: string): void => {
    stepsRef.current?.complete(cancelled() ? 'cancelled' : ok ? 'ok' : 'failed');
    stepsRef.current = null;
    logServiceScreenComplete(workspace.current, { ok, text }, runFactsRef.current); setResult({ ok, text }); setStage(null); setPhase('finished');
  };

  // Stages, shared by the full pipeline and the single-stage re-runs (#3220).
  const researchStage = async (ws: string): Promise<number> => {
    startStage('research');
    stepsRef.current?.start('research');
    setResearch(null);
    const researchStartedAt = Date.now();
    const researchLines: string[] = [];
    const code = await spawnChild(buildServiceResearchArgs(ws, { skipLlm: skipLlmRef.current, model: researchModelRef.current, app: scopeRef.current === 'one' ? oneAppRef.current : null }), (t) => {
      const p = parseResearchProgress(t);
      if (p) setResearch(p);
      researchLines.push(...t.split('\n').filter((l) => /^Research complete|^\s+Confidence|^\s{4}\S|RESEARCH signals|Not researched/.test(l)));
    });
    setResearchSummary(researchLines.map((l) => l.trimEnd()));
    const research = readServiceResearchFacts(ws, researchStartedAt); // #4301: the child's own completion event
    if (research) runFactsRef.current = { ...runFactsRef.current, research };
    stepsRef.current?.complete(code === 0 ? 'ok' : 'failed', { exit_code: code, ...(research ? { llm_calls: research.llmCalls } : {}) });
    return code;
  };

  // Sequential: each assessment rebuilds wsp/portfolio-summary.json, so parallel runs would race.
  const assessStage = async (ws: string, picked: readonly string[]): Promise<void> => {
    setSelected([...picked]);
    setOutcomes([]);
    setAppDurations([]);
    startStage('assess');
    stepsRef.current?.start('assess', { apps_total: picked.length });
    const batchLog = new ServiceAssessBatchLog(ws, picked, { selection: `${picked.length} app(s) picked in the TUI`, caller: 'tui.service', mirror: false }); // #4273
    for (const appId of picked) {
      if (cancelled()) break;
      setCurrentApp(appId);
      setPassName(null);
      const t0 = Date.now();
      const before = readServiceRunPointer(ws, appId);
      const code = await spawnChild(buildServiceAssessArgs(ws, appId, addedFrameworksRef.current ?? undefined), (t) => {
        const p = parsePassProgress(t);
        if (p.passName) setPassName(p.passName);
      });
      setAppDurations((prev) => [...prev, Date.now() - t0]);
      setOutcomes((prev) => [...prev, readServiceAssessOutcome(ws, appId, before, code)]);
      const after = readServiceRunPointer(ws, appId);
      // #4457: cost, LLM calls and model of the run the child wrote (run-manifest.json).
      batchLog.progress({ appId, status: code === 0 ? 'ok' : 'failed', exitCode: code, durationMs: Date.now() - t0, ...serviceRunLlmFields(ws, appId, before, after), ...(code !== 0 ? { reason: `the assessment exited with code ${code}` } : {}) });
    }
    if (cancelled()) batchLog.cancel(); else batchLog.complete();
    const sum = batchLog.summary(); // #4301
    runFactsRef.current = { ...runFactsRef.current, assess: { ok: sum.ok, failed: sum.failed, costUsd: sum.costUsd, llmCalls: sum.llmCalls } };
    stepsRef.current?.complete(cancelled() ? 'cancelled' : sum.failed > 0 ? 'failed' : 'ok', { apps_ok: sum.ok, apps_failed: sum.failed, llm_calls: sum.llmCalls });
    setCurrentApp(null);
  };

  const exportStage = async (ws: string): Promise<void> => {
    if (exportOk()) {
      startStage('export');
      stepsRef.current?.start('export');
      const exportCode = await spawnChild(buildServiceExportArgs(ws), () => {});
      stepsRef.current?.complete(exportCode === 0 ? 'ok' : 'failed', { exit_code: exportCode });
      setExportNote(exportCode === 0 ? 'Portfolio workbook and star schema written (wsp/reports/, wsp/star-schema/).' : `The portfolio export exited with code ${exportCode}.`);
    } else {
      setExportNote('Portfolio workbook skipped: it needs an Enterprise licence.');
    }
  };

  const runPipeline = async (mapping: string, scope: ServiceScope): Promise<void> => {
    // #3518: a fast second Enter can arrive before the phase change re-renders
    // the input handler; the ref makes the pipeline start exactly once.
    if (pipelineStartedRef.current) return;
    pipelineStartedRef.current = true;
    const ws = workspace.current;
    logServiceScreenStart(ws, { run: 'pipeline', scope, apps: totalAppsAfterInit }); // #4273
    runFactsRef.current = {};
    stepsRef.current = new ServicePipelineStepLog(ws, { run: 'pipeline' }); // #4457
    // #3518: the app count the operator confirmed for "all".
    const confirmedAll = scope === 'all' ? totalAppsAfterInit : null;
    setRunKey((k) => k + 1);
    setPhase('running');

    // #4400: One service scaffolds only when the picked app has no folder yet.
    const picked = scope === 'one' ? oneAppRef.current : null;
    stepsRef.current?.start('discover', picked ? { app_id: picked } : {});
    if (!(picked && discoverServiceApps(ws).some((a) => a.appId === picked))) {
      startStage('init');
      stepsRef.current?.start('scaffold');
      const initCode = await spawnChild(buildServiceInitArgs(intake, mapping, ws, otherSource), () => {});
      if (cancelled()) return finish(false, 'Cancelled during the scaffold.');
      if (initCode !== 0) return finish(false, `The service scaffold exited with code ${initCode}; see the output above.`);
      stepsRef.current?.complete('ok', { exit_code: initCode });
      stepsRef.current?.start('discover');
    }
    const apps = discoverServiceApps(ws).map((a) => a.appId);
    stepsRef.current?.complete('ok', { apps_found: apps.length });
    if (picked && !apps.includes(picked)) return finish(false, `Stopped: the intake workbook did not scaffold the service app ${picked}. Nothing was assessed.`);
    setAppCount(apps.length);
    runFactsRef.current = { ...runFactsRef.current, appsImported: apps.length };

    const researchCode = await researchStage(ws);
    if (cancelled()) return finish(false, 'Cancelled during research.');

    // #3518: never assess more apps than the operator confirmed.
    if (scope === 'all' && confirmedAll !== apps.length) {
      return finish(false, `Stopped before the assessment: ${apps.length} service app(s) after the scaffold, but ${confirmedAll === null ? 'the count was not known when you confirmed' : `${confirmedAll} were confirmed`}. Nothing was assessed; start the Service Portfolio Assessment again to confirm the current count.`);
    }

    if (scope !== 'none') {
      let chosen = picked ? [picked] : apps;
      if (!picked && scope === 'top') {
        stepsRef.current?.start('rank', { top: topNRef.current });
        chosen = rankServiceApps(ws, { top: topNRef.current }).map((a) => a.id);
        stepsRef.current?.complete('ok', { apps_ranked: chosen.length });
      }
      await assessStage(ws, chosen);
      if (cancelled()) return finish(false, 'Cancelled; the apps assessed so far are kept.');
    }

    await exportStage(ws);
    const researchNote = researchCode === 0 ? '' : ` Research exited with code ${researchCode}.`;
    finish(researchCode === 0, scope === 'none' ? `Scaffold and research complete.${researchNote}` : `Service Portfolio Assessment complete.${researchNote}`);
  };

  /** #3220 (#3165): one stage again, same workspace and scope, no questions. */
  const rerunStage = async (s: RerunStage): Promise<void> => {
    const ws = workspace.current;
    cancelledRef.current = false;
    setRunKey((k) => k + 1);
    logServiceScreenStart(ws, { run: `re-run ${s}` }); // #4273
    runFactsRef.current = {};
    stepsRef.current = new ServicePipelineStepLog(ws, { run: `re-run ${s}` }); // #4457
    setPhase('running');
    if (s === 'research') {
      const code = await researchStage(ws);
      if (cancelled()) return finish(false, 'Cancelled during research.');
      return finish(code === 0, code === 0 ? 'Research re-run complete.' : `Research exited with code ${code}.`);
    }
    if (s === 'assess') {
      const picked = selected;
      await assessStage(ws, picked);
      if (cancelled()) return finish(false, 'Cancelled; the apps assessed so far are kept.');
      return finish(true, `Assessment re-run complete for the same ${picked.length} app(s).`);
    }
    setExportNote(null);
    await exportStage(ws);
    finish(true, 'Export re-run complete.');
  };

  const [mapping, setMapping] = useState('');

  // #3518: service apps the workspace holds after the scaffold: existing ones
  // (minus those parked by Replace) plus the planned ones. Null when the
  // workbook could not be read in advance.
  const totalAppsAfterInit: number | null = preview
    ? new Set([
      ...preview.existingServiceAppIds.filter((id) => !(otherSource === 'replace' && preview.conflict.appIds.includes(id))),
      ...preview.plannedAppIds,
    ]).size
    : null;
  const scopePlan = (s: ServiceScope): ScopePlan => planScope(s, totalAppsAfterInit, { skipLlmResearch: skipLlmRef.current, topN });
  // #4236 (D-1): the expected cost of the confirmed scope, recomputed when the
  // confirmation opens or the research model changes.
  const costView = useMemo(() => (phase === 'confirm' && scope ? serviceCostView(workspace.current, scopePlan(scope), researchModelChoice, new Date(), scope === 'one' ? oneApp : null) : null),
    [phase, scope, researchModelChoice, topN, totalAppsAfterInit, oneApp]);
  // #4255: Enter on the ConfirmPanel; above the cost threshold the first Enter asks
  // for a second confirmation (#4236), the second starts the run.
  const confirmStart = (): void => {
    if (!scope || backRef.current) return;
    if (costView?.estimate.needsCostConfirmation && !costConfirmed) { setCostConfirmed(true); return; }
    void runPipeline(mapping, scope);
  };
  const proceed = (s: ServiceScope, n: number): void => {
    if (needsScopeConfirmation(s, workspace.current, n)) setPhase('confirm');
    else void runPipeline(mapping, s);
  };
  const chooseScope = (s: ServiceScope): void => {
    setScope(s);
    scopeRef.current = s;
    // #3520: "Top N" asks for N (default from the workspace) before confirming.
    if (s === 'top') { setTopNError(null); setPhase('top-n'); return; }
    // #4400: One service asks for the service app, then for the frameworks.
    if (s === 'one') { setPhase('pick-app'); return; }
    if (s === 'all') { setPhase('frameworks'); return; }
    addedFrameworksRef.current = null;
    proceed(s, topN);
  };
  // #4400: the service apps the One service picker offers: the workspace after the scaffold
  // (existing apps, minus those parked by Replace, plus the planned ones), else the current folders.
  const pickableApps = useMemo((): string[] => {
    if (phase !== 'pick-app') return [];
    const ids = preview
      ? [...preview.existingServiceAppIds.filter((id) => !(otherSource === 'replace' && preview.conflict.appIds.includes(id))), ...preview.plannedAppIds]
      : discoverServiceApps(workspace.current).map((a) => a.appId);
    return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
  }, [phase, preview, otherSource]);
  const pickApp = (id: string): void => {
    setOneApp(id);
    oneAppRef.current = id;
    setPhase('frameworks');
  };
  // #4400 (Design 103 section 7, D-10): SWAO_APM fixed, the other community frameworks to add.
  const frameworkChoice = useMemo(() => (phase === 'frameworks' ? serviceFrameworkChoice(workspace.current, bundledCommunityDir) : null), [phase, bundledCommunityDir]);
  // #4456: the framework names cut to the picker row (one line per framework).
  const pickerWidth = useHeaderWidth();
  const frameworkDetails = useMemo(() => (frameworkChoice ? serviceFrameworkRowDetails(frameworkChoice.options, pickerWidth) : []), [frameworkChoice, pickerWidth]);
  const confirmFrameworks = (chosen: string[]): void => {
    const added = chosen.filter((id) => id !== SERVICE_BASELINE_FRAMEWORK);
    setAddedFrameworks(added);
    // Nothing added: no --regimes, each app keeps its default frameworks (the assess command adds SWAO_APM).
    addedFrameworksRef.current = added.length > 0 ? added : null;
    if (scope) proceed(scope, topNRef.current);
  };
  // #3520: the offered N never exceeds the number of service apps.
  const topNOffered = totalAppsAfterInit === null ? topN : Math.max(1, Math.min(topN, totalAppsAfterInit));
  const submitTopN = (v: string): void => {
    const max = totalAppsAfterInit;
    const n = parseTopN(v === '' ? String(topNOffered) : v, max);
    if (n === null) { setTopNError(`Enter a whole number from 1 to ${max ?? 'the number of service apps'}.`); return; }
    setTopN(n);
    topNRef.current = n;
    setPhase('frameworks'); // #4400
  };

  /** #3521: plan the init before the scope question; a second intake workbook needs a choice first. */
  const checkIntake = async (): Promise<void> => {
    setPhase('checking');
    const p = await previewInit(intake, mapping, workspace.current);
    if (backRef.current) return;
    setPreview(p);
    setOtherSource('refuse');
    setPhase(p && p.conflict.appIds.length > 0 ? 'other-source' : 'scope');
  };
  const stages: Stage[] = ['init', 'research', 'assess', 'export'];
  const stageIndex = stage ? stages.indexOf(stage) : 0;
  const avg = appDurations.length > 0 ? appDurations.reduce((a, b) => a + b, 0) / appDurations.length : null;
  const remaining = selected.length - outcomes.length;
  const etaMs = avg !== null && remaining > 0 ? avg * remaining : undefined;
  // #4238: the details behind "Show details": research confidence, per-app results, the export note.
  const detailLines = (): string[] => {
    const isOk = (o: ServiceAssessOutcome): boolean => o.run !== null && o.exitCode === 0;
    const ordered = [...outcomes.filter((o) => !isOk(o)), ...outcomes.filter(isOk)];
    return [
      ...(appCount !== null ? [`Apps scaffolded: ${appCount}`] : []),
      ...researchSummary.map((l) => l.trim()),
      ...ordered.map((o) => `${o.appId}: ${o.run === null ? `no new run (exit code ${o.exitCode})` : `${o.skipped === null ? 'skipped pass count unavailable' : `${o.skipped} passes skipped`} (${o.run})`}`),
      ...(exportNote ? [exportNote] : []),
      ...(result && !result.ok ? lines.slice(-OUTPUT_LINES) : []),
    ];
  };
  // #4255 (Design 126 section 7.9): the key hint line of the current phase.
  const serviceKeys: readonly KeyHint[] = (() => {
    switch (phase) {
      case 'intake': return SERVICE_INTAKE_KEYS;
      case 'mapping': case 'top-n': return SERVICE_INPUT_KEYS;
      case 'llm': case 'other-source': case 'scope': case 'pick-app': return SERVICE_PICKER_KEYS;
      case 'frameworks': return KEY_HINTS.multiSelect; // #4400
      case 'confirm': return confirmKeyHints(costView, costConfirmed, scope !== null && scope !== 'none');
      case 'running': return RUN_PANEL_KEYS;
      case 'finished': return FINISH_PANEL_KEYS;
      case 'details': return DETAIL_KEYS;
      default: return [];
    }
  })();
  // #4238: the publish and workbook entries of the finish menu.
  const okApps = (): string[] => outcomes.filter((o) => o.run !== null && o.exitCode === 0).map((o) => o.appId);
  const workbookWritten = (): boolean => !!exportNote?.startsWith('Portfolio workbook and');
  const finishExtras = (): ServiceFinishExtras => ({ publishApps: okApps().length, workbook: workbookWritten(), workspace: workspace.current });
  // #4238: "Publish the HTML reports" runs swao publish --app <id> for each assessed app and lists the result.
  const publishAssessed = async (): Promise<void> => {
    const apps = okApps();
    const out: string[] = [];
    setDetails({ title: 'Publish the HTML reports', lines: [`Publishing ${apps.length} app(s)...`] });
    setPhase('details');
    for (const appId of apps) {
      const code = await spawnChild(['publish', '--app', appId, '--workspace', workspace.current], () => {});
      out.push(code === 0 ? `${appId}: published (apps/${appId}/wsp/publications/)` : `${appId}: publish stopped with exit code ${code}`);
      setDetails({ title: 'Publish the HTML reports', lines: [...out] });
    }
  };
  // #4238: "Open the portfolio workbook" opens the newest workbook in the default application.
  const openWorkbook = (): void => {
    const file = latestServiceWorkbook(workspace.current);
    const opened = file !== null && openWithDefaultApp(file);
    setDetails({ title: 'Portfolio workbook', lines: [file === null ? 'No workbook found in wsp/reports/.' : opened ? `Opened ${file}` : `Could not open ${file}; open it from wsp/reports/.`] });
    setPhase('details');
  };
  // #4238: "Show the priority list" runs swao service rank and shows its lines.
  const showRank = async (): Promise<void> => {
    const out: string[] = [];
    setDetails({ title: 'Priority list', lines: ['Ranking the service apps...'] });
    setPhase('details');
    const code = await spawnChild(['service', 'rank', '--workspace', workspace.current, '--top', String(Math.max(topNRef.current, selected.length || SERVICE_TOP_N))], (t) => {
      out.push(...t.split(/\r\n|\r|\n/).map((l) => l.trimEnd()).filter(Boolean));
    });
    setDetails({ title: 'Priority list', lines: code === 0 ? out : [...out, `The ranking stopped with exit code ${code}.`] });
  };

  return (
    <ScreenLayout
      header={header}
      steps={{ labels: [...SERVICE_STEPS], current: SERVICE_PHASE_STEP[phase] }}
      // #4256 (owner 2026-11-10 12:18): the run and finish screens have no second title line;
      // the header names the assessment, the workspace path is in the guidance.
      title={phase === 'running' || phase === 'finished' ? undefined : { title: SERVICE_STEP_TITLE[phase], subtitle: `Workspace: ${workspace.current}` }}
      keys={serviceKeys}
      guidance={{
        // #4255: collapsed on every step (sprint-055 rule); ScreenLayout keeps one box
        // mounted for the flow, so the #3220 intake-only expansion is gone.
        initiallyCollapsed: true,
        ...(phase === 'finished' || phase === 'details'
          // #4238: the finish guidance explains each What next entry with its CLI equivalent.
          ? { entry: serviceFinishGuidance({ assessApps: selected.length, export: exportOk() }, finishExtras()) }
          : phase === 'llm' || phase === 'other-source' || phase === 'scope'
            ? { entry: optionEntry }
          : phase === 'pick-app' || phase === 'frameworks'
            // #4400: the box follows the highlighted app or framework; the step entry when the list is empty.
            ? { entry: phase === 'pick-app' ? (pickableApps.length > 0 ? optionEntry : SERVICE_PICK_APP_GUIDANCE) : (frameworkChoice && frameworkChoice.options.length > 0 ? optionEntry : SERVICE_FRAMEWORKS_GUIDANCE) }
          : phase === 'running'
            ? { entry: { title: stage ? STAGE_LABEL[stage] : 'Service Portfolio Assessment', what: 'The run goes through four stages: scaffold the service apps, research them, assess the chosen apps one by one, and export the portfolio workbook. Esc asks before it cancels; the apps finished so far are kept. Workspace: ' + workspace.current + '.' } }
            : {
              title: 'Service Portfolio Assessment',
              what: 'Assesses third-party, SaaS, and COTS applications from an Excel inventory, with no source code required. Each row becomes one app folder; phone, e-mail, and contact columns are stored as yes/no flags only. Drop more documents into apps/<id>/ingestion/ and re-run to improve the evidence.',
              details: serviceGuidanceDetails(),
            }),
        onOpenChange: (open) => { guidanceOpenRef.current = open; setGuidanceOpen(open); nav.onGuidanceOpenChange(open); },
      }}
    >
      {nav.dialog ?? (
      <Box flexDirection="column">
        {phase === 'intake' && (
          <>
            <TextInput
              label="Enter the path to the intake Excel file (or drag and drop)"
              labelAbove
              initialValue={defaults.current.intake}
              onSubmit={(v) => { if (v.trim() || defaults.current.intake) { setIntake(v.trim() || defaults.current.intake); setPhase('mapping'); } }}
            />
            {/* #4213 (Design 126 section 8 rule 5): the tip wraps, it is never cut. */}
            <Text {...tone('muted')} wrap="wrap">
              {defaults.current.intake ? `Found in ${SERVICE_INTAKE_DIR} and filled in above.` : `Tip: place the workbook in ${SERVICE_INTAKE_DIR} to have it picked up automatically.`}
            </Text>
          </>
        )}

        {phase === 'mapping' && (
          <>
            <TextInput
              label="Column map (optional). Leave it empty to detect the columns from the headers (recommended); enter a YAML path only if your workbook uses other headers or a different layout"
              labelAbove
              initialValue={defaults.current.mapping}
              onSubmit={(v) => { setMapping(v); setPhase('llm'); }}
            />
            {defaults.current.mapping !== '' && <Text {...tone('muted')} wrap="wrap">Column map found next to the workbook and filled in above.</Text>}
            <Text {...tone('muted')} wrap="wrap">Column mapping guide: {SERVICE_COLUMN_MAPPING_DOCS_URL}</Text>
          </>
        )}

        {phase === 'llm' && (
          <SelectInput
            label="LLM research of vendor profile, certifications, data residency and breach history? (4 LLM calls per app; needs a workspace LLM)"
            options={[
              { value: 'run', label: 'Run LLM research (recommended; findings are model-cited and unverified until reviewed)', guidance: SERVICE_LLM_GUIDANCE.run },
              { value: 'skip', label: 'Skip LLM research for this run (earlier LLM findings are kept)', guidance: SERVICE_LLM_GUIDANCE.skip },
            ]}
            onCursorChange={onOptionCursor}
            onSelect={(v) => { skipLlmRef.current = v === 'skip'; void checkIntake(); }}
          />
        )}

        {phase === 'checking' && <Text {...tone('muted')}>Reading the intake workbook...</Text>}

        {phase === 'other-source' && preview && (
          <>
            <StatusRow
              level="warn"
              label="Other workbook"
              detail={`The workspace already holds ${preview.conflict.appIds.length} service app(s) from another intake workbook (${preview.conflict.sources.join(', ')}). Scaffolding ${preview.sourceName} (${preview.plannedAppIds.length} apps) next to them lists services twice when both workbooks describe the same servers.`}
            />
            <SelectInput
              label={`How should SWAO treat the ${preview.conflict.appIds.length} existing app(s)?`}
              // The non-destructive choice comes first, so a stray Enter changes nothing.
              options={[
                { value: 'back', label: 'Back: choose another intake workbook (or use a new workspace)', guidance: SERVICE_OTHER_SOURCE_GUIDANCE.back },
                { value: 'replace', label: `Replace: move them to parked-apps/ and scaffold ${preview.sourceName}`, guidance: SERVICE_OTHER_SOURCE_GUIDANCE.replace },
                { value: 'keep', label: `Keep both: add ${preview.plannedAppIds.length} app(s) next to the ${preview.conflict.appIds.length} existing ones`, guidance: SERVICE_OTHER_SOURCE_GUIDANCE.keep },
              ]}
              onCursorChange={onOptionCursor}
              onSelect={(v) => {
                if (v === 'back') { setPreview(null); setPhase('intake'); return; }
                setOtherSource(v as OtherSourcePolicy);
                setPhase('scope');
              }}
            />
          </>
        )}

        {/* #4489: the Column map gave no vendor column; CVE lookups and vendor consolidation will be empty. */}
        {phase === 'scope' && preview?.vendorWarning && <StatusRow level="warn" label="Column map" detail={preview.vendorWarning} />}
        {phase === 'scope' && (
          <SelectInput
            label="What should SWAO run? (Top N asks for N next; the frameworks follow)"
            options={[
              { value: 'top', label: `Scaffold, research all apps, assess the top N by risk (recommended; N next, default ${scopePlan('top').assessApps ?? topN}: assessment ${estimateAssessment(scopePlan('top').assessApps || topN)}, research time on the confirmation)` },
              // #3518: the "all" label names the app count and the total time.
              { value: 'all', label: totalAppsAfterInit === null
                ? 'Scaffold, research and assess every app (app count not known in advance; 3 to 4 min and several LLM calls per app)'
                : `Scaffold, research and assess every app (${totalAppsAfterInit} apps, assessment ${estimateAssessment(totalAppsAfterInit)})` },
              { value: 'none', label: 'Scaffold and research only (no LLM assessment)', guidance: SERVICE_SCOPE_GUIDANCE.none },
              // #4400 (owner 2026-11-14): the fourth scope, last so the earlier choices keep their place.
              { value: 'one', label: 'One service: pick one service app, scaffold it if needed, research and assess it', guidance: SERVICE_SCOPE_GUIDANCE.one },
            ].map((o) => ('guidance' in o ? o : { ...o, guidance: SERVICE_SCOPE_GUIDANCE[o.value as ServiceScope] }))}
            onCursorChange={onOptionCursor}
            onSelect={(v) => chooseScope(v as ServiceScope)}
          />
        )}

        {phase === 'top-n' && (
          <>
            <TextInput
              label={`How many apps by risk? (1 to ${totalAppsAfterInit ?? 'the number of service apps'}; default ${topNOffered})`}
              labelAbove
              initialValue={String(topNOffered)}
              onSubmit={submitTopN}
            />
            {topNError && <Text {...tone('error')} wrap="wrap">{topNError}</Text>}
            {topNDefault.current?.warning && <StatusRow level="warn" label="Top N default" detail={`${topNDefault.current.warning}; using ${SERVICE_TOP_N}.`} />}
            <Text {...tone('muted')} wrap="wrap">Default from service_portfolio.assess_top_n in the workspace .swao.yml (20 when unset). CLI: swao service assess --top {'<n>'}</Text>
          </>
        )}

        {/* #4400: One service, the service app to assess. */}
        {phase === 'pick-app' && (pickableApps.length > 0 ? (
          <SelectInput
            label="Which service app should SWAO assess?"
            options={pickableApps.map((id) => ({ value: id, label: id, guidance: { ...SERVICE_PICK_APP_GUIDANCE, title: id } }))}
            onCursorChange={onOptionCursor}
            initialIndex={Math.max(0, oneApp ? pickableApps.indexOf(oneApp) : 0)}
            visibleCount={PICKER_VISIBLE_COUNT}
            filter={pickableApps.length > 9}
            itemNoun="service apps"
            showKeyHints={false}
            onSelect={pickApp}
          />
        ) : (
          <StatusRow level="warn" label="No service apps" detail="The intake workbook lists no service app. Go back and choose another scope or another workbook." />
        ))}

        {/* #4400 (Design 103 section 7, D-10): SWAO_APM selected and fixed, other frameworks to add. */}
        {phase === 'frameworks' && frameworkChoice && (
          <>
            {frameworkChoice.baseline
              ? <StatusRow level="ok" label={SERVICE_BASELINE_FRAMEWORK} detail={`always evaluated in a service run (${frameworkChoice.baseline.source === 'workspace' ? 'workspace copy' : 'bundled with SWAO'})`} />
              : <StatusRow level="warn" label={SERVICE_BASELINE_FRAMEWORK} detail="not found in the workspace or the bundled frameworks; the run reports it as missing" />}
            <MultiSelect
              label="Add community frameworks to this run (optional)"
              // #4456: one line per framework, the name cut to the row width.
              options={frameworkChoice.options.map((f, i) => ({ value: f.id, label: f.id, detail: frameworkDetails[i] ?? '', guidance: { title: f.id, what: `${f.name} (installed in the workspace). ${SERVICE_FRAMEWORKS_GUIDANCE.what}`, cli: SERVICE_FRAMEWORKS_GUIDANCE.cli } }))}
              onCursorChange={onOptionCursor}
              initialSelected={(addedFrameworks ?? []).filter((id) => frameworkChoice.options.some((o) => o.id === id))}
              onConfirm={confirmFrameworks}
              allowEmptyConfirm
              visibleCount={PICKER_VISIBLE_COUNT}
              filter={frameworkChoice.options.length > 9}
              itemNoun="frameworks"
              showKeyHints={false}
              active={!guidanceOpen && !nav.dialogOpen}
            />
            {/* #4456: installed frameworks only; where to get more. */}
            <Text {...tone('muted')}>{`${frameworkChoice.options.length === 0 ? 'No other community framework is installed in this workspace. ' : ''}More frameworks: copy a framework folder into ${WORKSPACE_FRAMEWORKS_DIR}/<folder>/ from`}</Text>
            <Text {...tone('muted')} wrap="truncate">{COMMUNITY_FRAMEWORKS_URL}</Text>
          </>
        )}

        {phase === 'confirm' && scope && (
          // #4255 (Design 126 section 4.4): the confirmation is a ConfirmPanel under the step bar.
          // The panel reads Enter (not while the guidance box or the AbortDialog is open); the
          // screen keeps Tab (cheaper research model) and the back key, which withdraws the
          // second cost confirmation first.
          <ConfirmPanel
            title="Start the Service Portfolio Assessment"
            subtitle="Confirm what SWAO will run."
            rows={serviceConfirmRows(
              scopeConfirmationLines(scopePlan(scope), { withTime: !costView, app: oneApp, ...(addedFrameworks ? { frameworks: addedFrameworks } : {}) }),
              costView ? costConfirmationLines(costView.estimate, { totalApps: scopePlan(scope).totalApps, assessApps: scopePlan(scope).assessApps, topRanking: scope === 'top' }) : [],
              // #4374: the cheaper model and the basis of its figure.
              costView?.cheaper ? (researchModelChoice === null ? cheaperModelLine(costView.cheaper) : `${researchModelChoice} for this run; Tab switches back to ${costView.configuredResearch ?? 'the configured model'}`) : null,
            )}
            {...(costConfirmed && costView ? { risk: `The expected cost ${formatUsd(costView.estimate.totalUsd)} is above ${formatUsd(costView.estimate.thresholdUsd)}. Confirm the cost once more to start the run.` } : {})}
            onConfirm={confirmStart}
            // #4230: Enter starts a paid run, so it is not read while the guidance box is open.
            active={!guidanceOpen && !nav.dialogOpen}
          />
        )}

        {phase === 'running' && stage && (
          // #4237 / #4256: RunPanel; the stage line never wraps, the stage percentage includes the apps
          // done, the output is titled and wrapped with shortened user paths and no double dash.
          <RunPanel
            key={`run-${runKey}`}
            title={stageLabel(stage, scope, scope ? scopePlan(scope) : null, appCount, selected.length)}
            progress={{
              stage: stageIndex + 1,
              stages: stages.length,
              label: stage === 'assess'
                ? `App ${Math.min(outcomes.length + 1, selected.length)} of ${selected.length}: ${currentApp ?? ''}, ${passName ? `pass ${passName.replace(/_/g, ' ')}` : 'starting'}`
                : STAGE_LABEL[stage],
              ...(stage === 'research' && research ? { itemsDone: research.done, itemsTotal: research.total, itemsLabel: 'Apps', itemsNoun: 'apps researched' } : {}),
              ...(stage === 'assess' ? { itemsDone: outcomes.length, itemsTotal: Math.max(1, selected.length), itemsLabel: 'Apps', itemsNoun: 'apps assessed' } : {}),
              elapsedMs: now - stageStart,
              ...(stage === 'assess' && etaMs !== undefined ? { etaMs } : {}),
            }}
            lines={lines}
            maxLines={OUTPUT_LINES}
            onCancel={() => { cancelledRef.current = true; killChildTree(childRef.current); }}
            guidanceOpen={guidanceOpen}
          />
        )}

        {phase === 'finished' && result && (() => {
          const avail = { assessApps: selected.length, export: exportOk() };
          const { title, reason } = serviceFinishTitle(result.text);
          const okCount = outcomes.filter((o) => o.run !== null && o.exitCode === 0).length;
          const failed: FinishItem[] = outcomes
            .filter((o) => !(o.run !== null && o.exitCode === 0))
            .slice(0, 3)
            .map((o) => ({ level: 'fail', label: o.appId, reason: o.run === null ? `no new run (exit code ${o.exitCode})` : `exit code ${o.exitCode}` }));
          const rows = [
            ...(reason ? [{ label: 'Reason', value: reason }] : []),
            ...(appCount !== null ? [{ label: 'Apps', value: `${appCount} service apps in the workspace` }] : []),
            ...(researchSummary.length > 0 ? [{ label: 'Research', value: researchSummary[0]!.trim() }] : []),
            ...(selected.length > 0 ? [{ label: 'Assessed', value: `${okCount} of ${selected.length} apps complete${okCount < selected.length ? `, ${selected.length - okCount} need attention` : ''}` }] : []),
            ...(() => { const out = serviceOutputsRow(outcomes, workbookWritten()); return out ? [{ label: 'Outputs', value: out }] : []; })(),
          ];
          return (
            <FinishPanel
              title={title}
              level={result.ok ? 'ok' : 'warn'}
              rows={rows}
              items={failed}
              next={serviceFinishMenu(avail, finishExtras())}
              onSelect={(v) => {
                if (v === FINISH_MAIN_MENU) { backRef.current = true; onBack(); return; }
                if (v === 'details') { setDetails({ title: 'Details of the run', lines: detailLines() }); setPhase('details'); return; }
                if (v === 'rank') { void showRank(); return; }
                if (v === 'publish') { void publishAssessed(); return; }
                if (v === 'workbook') { openWorkbook(); return; }
                void rerunStage(v as RerunStage);
              }}
            />
          );
        })()}

        {phase === 'details' && details && (
          <Box flexDirection="column">
            <Text bold>{details.title}</Text>
            <RunOutput lines={detailWindow(details.lines, DETAIL_LINES)} maxLines={DETAIL_LINES} />
          </Box>
        )}
      </Box>
      )}
    </ScreenLayout>
  );
}
